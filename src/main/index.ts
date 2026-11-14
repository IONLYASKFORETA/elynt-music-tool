import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { BenchConfig, BenchReport } from '../shared/bench'
import { EXPORT_FORMATS, isExportFormatId, type ExportRequest } from '../shared/export'
import { benchPassed, formatBenchReport, lumaPsnr, parseBenchArgs } from './export/bench'
import { createVideoExports } from './export/exports'
import { decodeFrame, probeExport, resolveFfmpegPath } from './export/ffmpeg'
import { channels } from '../shared/api'
import { createBackups } from './backup'
import { openSuiteDatabase } from './db/database'
import { resolveHelperCommand } from './helper/command'
import { createHelperSupervisor } from './helper/supervisor'
import { createProfileStore } from './profile'
import { isKeyName } from '../shared/keys'
import { ClaudeError, createClaudeClient, createUsageLog } from './claude'
import { createApiKeys } from './keys/api-keys'
import { createCredentialVault } from './keys/key-vault'
import type { ArtistProfile } from '../shared/profile'
import { createTrackLibrary } from './tracks'

const MIXDOWN_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac', 'mp3']
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

  ipcMain.handle(channels.listTracks, () => tracks.list())
  ipcMain.handle(channels.addFromPickedMixdown, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Pick a mixdown',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: MIXDOWN_EXTENSIONS }]
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    return result.canceled || !path ? null : tracks.addFromMixdown(path)
  })

  // The Python helper does the heavy work (ADR 0001). It runs under WSL2 on Windows (ADR 0003).
  const helper = createHelperSupervisor({
    command: resolveHelperCommand({ platform: process.platform, appRoot: app.getAppPath(), env: process.env })
  })
  helper.onStatus((status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channels.helperStatusChanged, status)
  })
  ipcMain.handle(channels.helperStatus, () => helper.status())
  ipcMain.handle(channels.probeTrack, (_event, trackId: number) => {
    const track = tracks.get(trackId)
    if (!track) throw new Error(`No track with id ${trackId}`)
    return helper.call('audio.probe', { path: helper.toHelperPath(track.mixdownPath) })
  })
  helper.start()

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

  // Keys stay in the Windows credential vault (ADR 0001). The Claude client is
  // shared by all three tools and logs the cost of every call to api_usage.
  const keys = createApiKeys(createCredentialVault())
  const claude = createClaudeClient({ keys, usage: createUsageLog(db) })

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

  ipcMain.handle(channels.getProfile, () => profile.get())
  ipcMain.handle(channels.saveProfile, (_event, input: ArtistProfile) => profile.save(input))

  app.on('will-quit', () => {
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
