import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { channels } from '../shared/api'
import { openSuiteDatabase } from './db/database'
import { createTrackLibrary } from './tracks'

const MIXDOWN_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac', 'mp3']

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

  app.on('will-quit', () => db.close())

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
