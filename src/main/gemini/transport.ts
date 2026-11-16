import { readFile } from 'node:fs/promises'
import type { GeminiTransport, GenerateContentResponse, UploadedFile } from './mood-listen'

const BASE_URL = 'https://generativelanguage.googleapis.com'
/** A large mixdown can take a while to upload; the generate call itself is quick. */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000
const GENERATE_TIMEOUT_MS = 2 * 60 * 1000
/** Audio uploads are usually ACTIVE at once; this only covers a slow PROCESSING step. */
const PROCESSING_WAIT_MS = 60 * 1000

interface FileResource {
  name: string
  uri: string
  mimeType: string
  state?: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED'
}

/** Gemini's REST API over fetch: the Files API resumable upload, then generateContent. */
export function createGeminiTransport(): GeminiTransport {
  const request = async (url: string, init: RequestInit & { timeoutMs: number }) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs) })
    if (!response.ok) throw new Error(`Gemini answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
    return response
  }

  return {
    async uploadFile(apiKey, { path, mimeType, displayName }): Promise<UploadedFile> {
      const bytes = await readFile(path)
      const start = await request(`${BASE_URL}/upload/v1beta/files`, {
        method: 'POST',
        timeoutMs: GENERATE_TIMEOUT_MS,
        headers: {
          'x-goog-api-key': apiKey,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file: { display_name: displayName } })
      })
      const uploadUrl = start.headers.get('x-goog-upload-url')
      if (!uploadUrl) throw new Error('Gemini gave no upload address')

      const done = await request(uploadUrl, {
        method: 'POST',
        timeoutMs: UPLOAD_TIMEOUT_MS,
        headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
        body: bytes
      })
      let file = ((await done.json()) as { file: FileResource }).file

      const deadline = Date.now() + PROCESSING_WAIT_MS
      while (file.state === 'PROCESSING' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
        const poll = await request(`${BASE_URL}/v1beta/${file.name}`, { timeoutMs: GENERATE_TIMEOUT_MS, headers: { 'x-goog-api-key': apiKey } })
        file = (await poll.json()) as FileResource
      }
      if (file.state && file.state !== 'ACTIVE') throw new Error(`Gemini couldn't take the mixdown (${file.state})`)
      return { name: file.name, uri: file.uri, mimeType: file.mimeType || mimeType }
    },

    async generateContent(apiKey, model, body): Promise<GenerateContentResponse> {
      const response = await request(`${BASE_URL}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        timeoutMs: GENERATE_TIMEOUT_MS,
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      return (await response.json()) as GenerateContentResponse
    },

    async deleteFile(apiKey, name) {
      await request(`${BASE_URL}/v1beta/${name}`, {
        method: 'DELETE',
        timeoutMs: GENERATE_TIMEOUT_MS,
        headers: { 'x-goog-api-key': apiKey }
      })
    }
  }
}
