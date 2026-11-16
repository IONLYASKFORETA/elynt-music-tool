import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BenchConfig, BenchReport } from '../shared/bench'
import { EXPORT_FORMATS, isExportFormatId, type ExportRequest } from '../shared/export'
import { benchPassed, formatBenchReport, lumaPsnr, parseBenchArgs } from './export/bench'
import { createVideoExports } from './export/exports'
import { decodeFrame, probeExport, resolveFfmpegPath } from './export/ffmpeg'
import { channels } from '../shared/api'
import type { TrackAnalysis, TrackAnalysisState } from '../shared/analysis'
import { createAnalysisQueue, createTrackAnalysisStore } from './analysis'
import { createBackups } from './backup'
import { openSuiteDatabase } from './db/database'
import { resolveHelperCommand } from './helper/command'
import { createHelperSupervisor } from './helper/supervisor'
import { createMixProjects } from './mix-project'
import { watchMixProject, type MixProjectWatcher } from './mix-project-watcher'
import { createMediaShelf } from './media-shelf'
import { createMixSetupStore } from './mix-setup'
import { createProfileStore } from './profile'
import { createReleaseStore } from './releases'
import type { PresetLevel } from '../shared/vision-history'
import { createPresetStore, createVisionHistoryStore } from './vision-history'
import { isKeyName } from '../shared/keys'
import { ClaudeError, createClaudeClient, createUsageLog } from './claude'
import { createGeminiTransport, createMoodListener } from './gemini'
import { createApiKeys } from './keys/api-keys'
import { createCredentialVault } from './keys/key-vault'
import { CLIP_EXTENSIONS, IMAGE_EXTENSIONS } from '../shared/media'
import { REFERENCE_EXTENSIONS, type MixSetup } from '../shared/mix-setup'
import type { ArtistProfile } from '../shared/profile'
import type { StartRelease } from '../shared/release'
import { parseStepAction, type StepAction } from '../shared/release-plan-actions'
import { createTrackStems, type StemSplitter } from './stems'
import { createSubjectImages, type SubjectGenerator } from './subject-images'
import { MEDIA_SCHEME, mediaPath, type SubjectImageRequest } from '../shared/subject-images'
import { createTrackLibrary } from './tracks'
import { createVisionFlow } from './visions/flow'
import { createVisionStore } from './visions/store'
import type { VisionFlowRequest, WorkingVision } from '../shared/visions'
import { loadSafeZones } from './safe-zones'

const MIXDOWN_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac', 'mp3']
/**
 * A split may go this long without a progress line before it counts as stuck.
 * Long, because the first split downloads the ~700 MB model and only says so once.
 */
const SPLIT_IDLE_TIMEOUT_MS = 30 * 60 * 1000
/**
 * An image may go this long without a progress line before it counts as stuck. Long, because the
 * first one downloads FLUX.2 klein 4B and its text encoder (about 16 GB) and only says so once.
 */
const IMAGE_IDLE_TIMEOUT_MS = 60 * 60 * 1000
/** Most subject options one press can ask for. */
const MAX_SUBJECT_OPTIONS = 6
/** How often a running app checks whether today's backup is due (so it also runs past midnight). */
const BACKUP_CHECK_MS = 60 * 60 * 1000

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07070a',
    title: 'Elynt Music Tool',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

// Media on disk reaches the renderer through the app's own scheme, so the preview and export can
// fetch it like any URL: subject images (V9), and the media shelf and cover art (V18). Clips must be
// seekable and CORS-clean for WebGPU to copy their frames. Registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

// The export benchmark runs against a throwaway library, never the owner's own database.
const bench = parseBenchArgs(process.argv)
if (bench) app.setPath('userData', mkdtempSync(join(tmpdir(), 'elynt-bench-')))

app.whenReady().then(start).catch((error: unknown) => {
  dialog.showErrorBox('Elynt Music Tool could not start', error instanceof Error ? error.message : String(error))
  app.quit()
})

function start(): void {
  // One SQLite file for the whole suite, in the app's data folder (ADR 0002).
  const db = openSuiteDatabase(join(app.getPath('userData'), 'elynt.sqlite'))
  const tracks = createTrackLibrary(db)
  const profile = createProfileStore(db)
  const mixSetup = createMixSetupStore(db, tracks)
  const releases = createReleaseStore(db, { tracks, profile })
  // Keys stay in the Windows credential vault (ADR 0001). Every Claude and Gemini call is costed in api_usage.
  const keys = createApiKeys(createCredentialVault())
  const usage = createUsageLog(db)

  ipcMain.handle(channels.listTracks, () => tracks.list())
  ipcMain.handle(channels.renameTrack, (_event, trackId: number, title: unknown) => tracks.rename(trackId, String(title)))
  ipcMain.handle(channels.addFromPickedMixdown, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick a mixdown',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: MIXDOWN_EXTENSIONS }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    if (result.canceled || !path) return null
    const track = tracks.addFromMixdown(path)
    // A new track is analysed straight away; picking a known one again doesn't redo it.
    if (!analysisStore.get(track.id)) analysis.enqueue(track.id)
    return track
  })

  // The Python helper does the heavy work (ADR 0001). It runs under WSL2 on Windows (ADR 0003).
  const helper = createHelperSupervisor({
    command: resolveHelperCommand({ platform: process.platform, appRoot: app.getAppPath(), env: process.env })
  })

  // Track analysis (V1) is saved on the track, so every tool reads the same sections.
  const analysisStore = createTrackAnalysisStore(db)
  const analysis = createAnalysisQueue({
    store: analysisStore,
    tracks,
    helper,
    // With a Gemini key, Gemini also listens for mood detail (V12). Without one, or offline, it's skipped.
    moodListen: createMoodListener({
      keys,
      usage,
      transport: createGeminiTransport(),
      onError: (error) => console.warn('Gemini mood listen skipped:', error instanceof Error ? error.message : error)
    }),
    onChange: (state) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channels.analysisChanged, state)
    }
  })
  ipcMain.handle(channels.getAnalysis, (_event, trackId: number) => analysisStore.get(trackId))
  // The "What I heard" check (V3): the owner's corrections replace the heard analysis on the track.
  const broadcastAnalysis = (state: TrackAnalysisState) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channels.analysisChanged, state)
    return state
  }
  ipcMain.handle(channels.saveAnalysisCorrection, (_event, trackId: number, corrected: TrackAnalysis) =>
    broadcastAnalysis(analysisStore.saveCorrection(trackId, corrected))
  )
  ipcMain.handle(channels.skipAnalysisCheck, (_event, trackId: number) => broadcastAnalysis(analysisStore.skipCheck(trackId)))
  ipcMain.handle(channels.rerunAnalysis, (_event, trackId: number) => {
    if (!tracks.get(trackId)) throw new Error(`No track with id ${trackId}`)
    return analysis.enqueue(trackId)
  })
  analysis.resume()
  helper.onStatus((status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channels.helperStatusChanged, status)
  })
  ipcMain.handle(channels.helperStatus, () => helper.status())
  // The Live Set reader (M1): the helper parses the .als.
  ipcMain.handle(channels.pickAndReadLiveSet, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick a Live Set',
      properties: ['openFile'],
      filters: [{ name: 'Ableton Live Set', extensions: ['als'] }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    if (result.canceled || !path) return null
    const liveSet = await helper.call('liveset.read', { path: helper.toHelperPath(path) })
    // The helper answers with its own view of the path (WSL under WSL2); hand back the app's.
    return { ...liveSet, path }
  })
  // The project folder (M2): picked once per track; the newest .als is read with the Live Set reader,
  // and a watcher reports a newer .als or new bounces so later tickets can re-run.
  const mixProjects = createMixProjects({
    db,
    tracks,
    // The helper answers with its own view of the path (WSL under WSL2); keep the app's.
    readLiveSet: async (path) => ({ ...(await helper.call('liveset.read', { path: helper.toHelperPath(path) })), path })
  })
  const projectWatchers = new Map<number, { folder: string; watcher: MixProjectWatcher }>()
  const watchProject = (trackId: number) => {
    const folder = mixProjects.folderOf(trackId)
    const current = projectWatchers.get(trackId)
    if (current && current.folder === folder) return
    current?.watcher.close()
    projectWatchers.delete(trackId)
    if (folder === null) return
    const watcher = watchMixProject(folder, (changes) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channels.mixProjectChanged, { trackId, changes })
    })
    projectWatchers.set(trackId, { folder, watcher })
  }
  ipcMain.handle(channels.openMixProject, (_event, trackId: number) => {
    watchProject(trackId)
    return mixProjects.open(trackId)
  })
  ipcMain.handle(channels.pickMixProjectFolder, async (event, trackId: number) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const current = mixProjects.folderOf(trackId)
    const options: Electron.OpenDialogOptions = {
      title: "Pick this track's Ableton project folder",
      properties: ['openDirectory'],
      ...(current ? { defaultPath: current } : {})
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const [folder] = result.filePaths
    if (result.canceled || !folder) return null
    mixProjects.setFolder(trackId, folder)
    watchProject(trackId)
    return mixProjects.open(trackId)
  })
  ipcMain.handle(channels.probeTrack, (_event, trackId: number) => {
    const track = tracks.get(trackId)
    if (!track) throw new Error(`No track with id ${trackId}`)
    return helper.call('audio.probe', { path: helper.toHelperPath(track.mixdownPath) })
  })
  helper.start()

  // Stems (V2): the owner's own bounces, or a split by the helper when there are none. Own stems always win.
  const stemsRoot = join(app.getPath('userData'), 'stems')
  const splitter: StemSplitter = async (track, onProgress) => {
    // A fresh folder per split, so replacing a split set can delete exactly its files.
    const folder = join(stemsRoot, String(track.id), `split-${Date.now()}`)
    const result = await helper.call(
      'stems.split',
      { path: helper.toHelperPath(track.mixdownPath), outDir: helper.toHelperPath(folder) },
      { timeoutMs: SPLIT_IDLE_TIMEOUT_MS, onProgress }
    )
    return {
      folder,
      model: result.model,
      // The helper answers with its own view of the path (WSL under WSL2); store the app's.
      stems: result.stems.map((s) => ({ name: s.name, path: join(folder, s.path.split(/[\\/]/).pop()!) }))
    }
  }
  const stems = createTrackStems({ db, tracks, splitter })
  stems.onJob((job) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channels.splitJobChanged, job)
  })
  ipcMain.handle(channels.listStems, (_event, trackId: number) => stems.list(trackId))
  ipcMain.handle(channels.splitJobs, () => stems.jobs())
  ipcMain.handle(channels.splitStems, (_event, trackId: number) => stems.split(trackId))
  ipcMain.handle(channels.removeOwnStem, (_event, stemId: number) => stems.removeOwn(stemId))
  // Only a path the database holds for that track is ever read.
  ipcMain.handle(channels.readStem, async (_event, trackId: number, stemId: number) => {
    const stem = stems.list(trackId).find((s) => s.id === stemId)
    if (!stem) throw new Error(`Track ${trackId} has no stem with id ${stemId}.`)
    return readFile(stem.path)
  })
  ipcMain.handle(channels.attachPickedStems, async (event, trackId: number) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick your stems for this track',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: MIXDOWN_EXTENSIONS }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : stems.attachOwn(trackId, result.filePaths)
  })

  // Subject images (V9): the helper's local image model makes them ahead of time; they stay on disk.
  const subjectsRoot = join(app.getPath('userData'), 'subjects')
  const generator: SubjectGenerator = async (request, onProgress) => {
    const result = await helper.call(
      'image.generate',
      { prompt: request.prompt, outPath: helper.toHelperPath(request.outPath), ...(request.seed === undefined ? {} : { seed: request.seed }) },
      { timeoutMs: IMAGE_IDLE_TIMEOUT_MS, onProgress }
    )
    console.log(`Subject image made in ${result.seconds} s (${result.model}, ${result.width}x${result.height})`)
    return { seed: result.seed, model: result.model, width: result.width, height: result.height, seconds: result.seconds }
  }
  const subjectImages = createSubjectImages({ db, tracks, generator, root: subjectsRoot })
  subjectImages.onJob((job) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channels.subjectJobChanged, job)
  })
  ipcMain.handle(channels.listSubjectImages, (_event, trackId: number) => subjectImages.list(trackId))
  ipcMain.handle(channels.generateSubjectImages, (_event, trackId: number, request: SubjectImageRequest, count: unknown) => {
    if (request?.ground !== 'black' && request?.ground !== 'off-white') throw new Error(`Unknown ground: ${String(request?.ground)}`)
    const palette = Array.isArray(request.palette) ? request.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))) : undefined
    const n = Math.min(MAX_SUBJECT_OPTIONS, Math.max(1, Math.floor(Number(count) || 1)))
    return subjectImages.generate(trackId, { motif: String(request.motif ?? ''), ground: request.ground, ...(palette ? { palette } : {}) }, n)
  })
  ipcMain.handle(channels.regenerateSubjectImage, (_event, imageId: number) => subjectImages.regenerate(imageId))
  ipcMain.handle(channels.removeSubjectImage, (_event, imageId: number) => subjectImages.remove(imageId))
  ipcMain.handle(channels.subjectJobs, () => subjectImages.jobs())

  // Only files the track library knows about can be read, never an arbitrary path from the UI.
  ipcMain.handle(channels.readMixdown, async (_event, trackId: number) => {
    const track = tracks.get(trackId)
    if (!track) throw new Error(`No track with id ${trackId}.`)
    return readFile(track.mixdownPath)
  })

  // Video export (ADR 0001): the window renders frames, FFmpeg here encodes them with the mixdown.
  const ffmpegPath = resolveFfmpegPath()
  const exports = createVideoExports({ ffmpegPath, tracks })
  const finishedExports = new Set<string>()
  ipcMain.handle(channels.chooseExportOutput, async (event, trackTitle: unknown, format: unknown) => {
    if (!isExportFormatId(format)) throw new Error(`Unknown export format: ${String(format)}`)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const safeTitle = String(trackTitle).replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'Export'
    const options: Electron.SaveDialogOptions = {
      title: 'Export video',
      defaultPath: join(app.getPath('videos'), `${safeTitle} ${EXPORT_FORMATS[format].height}p${EXPORT_FORMATS[format].fps}.mp4`),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  })
  ipcMain.handle(channels.startExport, (_event, request: ExportRequest) => exports.start(request))
  ipcMain.handle(channels.writeExportFrame, (_event, jobId: string, frame: Uint8Array) => exports.writeFrame(jobId, frame))
  ipcMain.handle(channels.finishExport, async (_event, jobId: string) => {
    const result = await exports.finish(jobId)
    finishedExports.add(result.outputPath)
    return result
  })
  ipcMain.handle(channels.cancelExport, (_event, jobId: string) => exports.cancel(jobId))
  // Only videos this run exported can be shown, never an arbitrary path from the UI.
  ipcMain.handle(channels.revealExport, (_event, path: string) => {
    if (finishedExports.has(path)) shell.showItemInFolder(path)
  })

  const benchConfig: BenchConfig | null = bench && {
    ...(() => {
      const track = tracks.addFromMixdown(resolve(bench.trackPath))
      return { trackId: track.id, trackTitle: track.title }
    })(),
    encoder: bench.encoder,
    formats: bench.formats,
    limitSeconds: bench.limitSeconds,
    outDir: mkdtempSync(join(tmpdir(), 'elynt-bench-videos-'))
  }
  ipcMain.handle(channels.safeZones, () => loadSafeZones(join(app.getPath('userData'), 'safe-zones.json')))
  ipcMain.handle(channels.benchConfig, () => benchConfig)
  ipcMain.handle(channels.benchCheckFile, async (_event, path: string, frame: number, renders: Uint8Array[], width: number, height: number) => {
    if (!benchConfig || !finishedExports.has(path)) throw new Error('Only the benchmark can check its own videos.')
    const facts = await probeExport(ffmpegPath, path)
    const decoded = await decodeFrame(ffmpegPath, path, frame, width, height)
    return {
      videoBitrate: facts.videoBitrate,
      audioSeconds: facts.audio.seconds,
      videoSeconds: facts.video.seconds,
      frames: facts.video.frames,
      psnr: renders.map((rgba) => lumaPsnr(decoded, rgba))
    }
  })
  ipcMain.handle(channels.benchReport, (_event, report: BenchReport) => {
    if (!bench) return
    const out = resolve(bench.outPath)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, formatBenchReport(report))
    writeFileSync(out.replace(/\.md$/i, '') + '.json', JSON.stringify(report, null, 2))
    const passed = benchPassed(report)
    console.log(`Export benchmark ${passed ? 'passed' : 'FAILED'}; report at ${out}`)
    app.exit(passed ? 0 : 1)
  })

  // The Claude client is shared by all three tools and logs the cost of every call to api_usage.
  const claude = createClaudeClient({ keys, usage })

  const keyName = (name: unknown) => {
    if (!isKeyName(name)) throw new Error(`Unknown key: ${String(name)}`)
    return name
  }
  ipcMain.handle(channels.keyStatus, () => keys.status())
  ipcMain.handle(channels.saveKey, async (_event, name: unknown, value: unknown) => {
    await keys.save(keyName(name), String(value ?? ''))
    return keys.status()
  })
  ipcMain.handle(channels.removeKey, async (_event, name: unknown) => {
    await keys.remove(keyName(name))
    return keys.status()
  })
  // The vision flow (V10): Claude writes three visions; each call is costed against the track.
  // With ELYNT_RECORD_CLAUDE_DIR set, every raw reply is also saved there, to replay in tests.
  const visionStore = createVisionStore(db)
  const recordDir = process.env['ELYNT_RECORD_CLAUDE_DIR']
  const visionFlow = createVisionFlow({
    claude,
    usage,
    store: visionStore,
    tracks,
    analysis: (trackId) => analysisStore.get(trackId)?.analysis ?? null,
    artistName: () => profile.get().artistName ?? '',
    onReply: recordDir
      ? (reply) => {
          mkdirSync(recordDir, { recursive: true })
          writeFileSync(join(recordDir, `visions-${Date.now()}.json`), JSON.stringify(reply, null, 1))
        }
      : undefined
  })
  ipcMain.handle(channels.latestVisions, (_event, trackId: number) => visionStore.latestSet(trackId))
  ipcMain.handle(channels.generateVisions, async (_event, request: VisionFlowRequest) => {
    const result = await visionFlow.run(request)
    console.log(
      `Visions for track ${request.trackId}: $${result.set.costUsd.toFixed(3)} in ${result.set.attempts} call(s); ` +
        `Visualizer total for the track $${result.trackCostUsd.toFixed(3)}.`
    )
    return result
  })
  ipcMain.handle(channels.getWorkingVision, (_event, trackId: number) => visionStore.getWorking(trackId))
  ipcMain.handle(channels.saveWorkingVision, (_event, trackId: number, vision: unknown, from: WorkingVision['from']) => {
    if (!tracks.get(trackId)) throw new Error(`No track with id ${trackId}.`)
    return visionStore.saveWorking(trackId, vision, from)
  })
  ipcMain.handle(channels.visionTrackCost, (_event, trackId: number) => usage.totalCostUsd({ tool: 'visualizer', trackId }))

  ipcMain.handle(channels.testAnthropicKey, async () => {
    try {
      await claude.text({ tool: 'suite', tier: 'fast', prompt: 'Reply with the word ok.', maxTokens: 64 })
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof ClaudeError ? error.message : String(error) }
    }
  })

  // Daily backup (ADR 0002): on launch, which catches up a missed day, then hourly while running.
  const backups = createBackups({ db, settingsFile: join(app.getPath('userData'), 'backup-settings.json') })
  const backupIfDue = () => {
    try {
      backups.runIfDue()
    } catch (error) {
      console.error('Daily backup failed', error)
    }
  }
  backupIfDue()
  const backupTimer = setInterval(backupIfDue, BACKUP_CHECK_MS)

  ipcMain.handle(channels.backupStatus, () => backups.status())
  ipcMain.handle(channels.chooseBackupFolder, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a backup folder (for example in OneDrive or Dropbox)',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const [folder] = result.filePaths
    if (result.canceled || !folder) return null
    backups.setFolder(folder)
    return backups.status()
  })
  ipcMain.handle(channels.exportEverything, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Export everything',
      defaultPath: join(app.getPath('documents'), `Elynt export ${new Date().toISOString().slice(0, 10)}.sqlite`),
      filters: [{ name: 'Elynt export (SQLite)', extensions: ['sqlite'] }]
    }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    backups.exportEverything(result.filePath)
    return result.filePath
  })

  // The media shelf (V18): own images, clips and logo by path, for any track; and each track's cover art.
  const media = createMediaShelf({
    db,
    tracks,
    probeClip: async (path) => {
      const facts = await probeExport(ffmpegPath, path)
      return { durationSeconds: facts.video.seconds, fps: facts.video.fps }
    }
  })
  // Only files the app made (subject images) or the owner put on the media shelf or as cover art
  // are served, never an arbitrary path.
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const generated = mediaPath(request.url)
    const path = media.pathFor(request.url) ?? (generated && subjectImages.isKnownPath(generated) ? generated : null)
    if (!path) return new Response('Not found', { status: 404 })
    // Range headers pass through, so a clip can seek.
    const response = await net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
  ipcMain.handle(channels.listMedia, () => media.list())
  ipcMain.handle(channels.addPickedMedia, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Add images and clips to the media shelf',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and clips', extensions: [...IMAGE_EXTENSIONS, ...CLIP_EXTENSIONS] }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : media.add(result.filePaths)
  })
  ipcMain.handle(channels.removeMedia, (_event, id: number) => {
    media.remove(id)
    return media.list()
  })
  ipcMain.handle(channels.setLogo, (_event, id: number | null) => {
    media.setLogo(id)
    return media.list()
  })
  ipcMain.handle(channels.getCoverArt, (_event, trackId: number) => media.coverArt(trackId))
  ipcMain.handle(channels.attachPickedCoverArt, async (event, trackId: number) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: "Pick this track's cover art",
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    if (!result.canceled && path) media.setCoverArt(trackId, path)
    return media.coverArt(trackId)
  })
  ipcMain.handle(channels.removeCoverArt, (_event, trackId: number) => media.setCoverArt(trackId, null))

  ipcMain.handle(channels.getProfile, () => profile.get())
  ipcMain.handle(channels.saveProfile, (_event, input: ArtistProfile) => profile.save(input))

  ipcMain.handle(channels.listReleases, () => releases.list())
  ipcMain.handle(channels.getRelease, (_event, releaseId: number) => releases.get(releaseId))
  ipcMain.handle(channels.startRelease, (_event, input: StartRelease) =>
    releases.start({ trackId: Number(input.trackId), releaseDay: String(input.releaseDay) })
  )
  ipcMain.handle(channels.openReleaseToday, (_event, releaseId: number) => releases.openToday(Number(releaseId)))
  ipcMain.handle(channels.actOnPlanStep, (_event, releaseId: number, stepId: string, action: StepAction) =>
    releases.actOnStep(Number(releaseId), String(stepId), parseStepAction(action))
  )
  ipcMain.handle(channels.moveReleaseDay, (_event, releaseId: number, newDay: string) =>
    releases.moveReleaseDay(Number(releaseId), String(newDay))
  )

  const visionHistory = createVisionHistoryStore(db)
  const presets = createPresetStore(db)
  ipcMain.handle(channels.currentVisionHistory, (_event, key: unknown) => visionHistory.current(String(key)))
  ipcMain.handle(channels.recordVisionHistory, (_event, key: unknown, vision: unknown) => visionHistory.record(String(key), vision))
  ipcMain.handle(channels.undoVision, (_event, key: unknown) => visionHistory.undo(String(key)))
  ipcMain.handle(channels.redoVision, (_event, key: unknown) => visionHistory.redo(String(key)))
  ipcMain.handle(channels.saveVisionSnapshot, (_event, key: unknown, name: unknown) => visionHistory.saveSnapshot(String(key), String(name)))
  ipcMain.handle(channels.listVisionSnapshots, (_event, key: unknown) => visionHistory.listSnapshots(String(key)))
  ipcMain.handle(channels.restoreVisionSnapshot, (_event, id: unknown) => visionHistory.restoreSnapshot(Number(id)))
  ipcMain.handle(channels.deleteVisionSnapshot, (_event, id: unknown) => visionHistory.deleteSnapshot(Number(id)))
  ipcMain.handle(channels.savePreset, (_event, level: PresetLevel, name: unknown, data: unknown) => presets.save(level, String(name), data))
  ipcMain.handle(channels.listPresets, (_event, level?: PresetLevel) => presets.list(level))
  ipcMain.handle(channels.deletePreset, (_event, id: unknown) => presets.delete(Number(id)))

  ipcMain.handle(channels.getMixSetup, (_event, trackId: number) => mixSetup.get(trackId))
  ipcMain.handle(channels.saveMixSetup, (_event, input: MixSetup) => mixSetup.save(input))
  ipcMain.handle(channels.pickReferenceTracks, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick up to 3 reference tracks',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: REFERENCE_EXTENSIONS }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  app.on('will-quit', () => {
    for (const { watcher } of projectWatchers.values()) watcher.close()
    helper.stop()
    clearInterval(backupTimer)
    db.close()
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
