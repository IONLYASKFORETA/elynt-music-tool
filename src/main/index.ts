import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { channels } from '../shared/api'
import { createBackups } from './backup'
import { openSuiteDatabase } from './db/database'
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

app.whenReady().then(start).catch((error: unknown) => {
  dialog.showErrorBox('Elynt Music Tool could not start', error instanceof Error ? error.message : String(error))
  app.quit()
})

function start(): void {
  // One SQLite file for the whole suite, in the app's data folder (ADR 0002).
  const db = openSuiteDatabase(join(app.getPath('userData'), 'elynt.sqlite'))
  const tracks = createTrackLibrary(db)

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

  app.on('will-quit', () => {
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
