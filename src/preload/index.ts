import { contextBridge, ipcRenderer } from 'electron'
import { channels, type ElyntApi } from '../shared/api'
import type { HelperStatus } from '../shared/helper'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    addFromPickedMixdown: () => ipcRenderer.invoke(channels.addFromPickedMixdown),
    readMixdown: (trackId) => ipcRenderer.invoke(channels.readMixdown, trackId)
  },
  keys: {
    status: () => ipcRenderer.invoke(channels.keyStatus),
    save: (name, value) => ipcRenderer.invoke(channels.saveKey, name, value),
    remove: (name) => ipcRenderer.invoke(channels.removeKey, name),
    testAnthropic: () => ipcRenderer.invoke(channels.testAnthropicKey)
  },
  backup: {
    status: () => ipcRenderer.invoke(channels.backupStatus),
    chooseFolder: () => ipcRenderer.invoke(channels.chooseBackupFolder),
    exportEverything: () => ipcRenderer.invoke(channels.exportEverything)
  },
  profile: {
    get: () => ipcRenderer.invoke(channels.getProfile),
    save: (profile) => ipcRenderer.invoke(channels.saveProfile, profile)
  },
  exports: {
    chooseOutput: (trackTitle, format) => ipcRenderer.invoke(channels.chooseExportOutput, trackTitle, format),
    start: (request) => ipcRenderer.invoke(channels.startExport, request),
    writeFrame: (jobId, frame) => ipcRenderer.invoke(channels.writeExportFrame, jobId, frame),
    finish: (jobId) => ipcRenderer.invoke(channels.finishExport, jobId),
    cancel: (jobId) => ipcRenderer.invoke(channels.cancelExport, jobId),
    reveal: (path) => ipcRenderer.invoke(channels.revealExport, path)
  },
  bench: {
    config: () => ipcRenderer.invoke(channels.benchConfig),
    checkFile: (path, frame, renders, width, height) => ipcRenderer.invoke(channels.benchCheckFile, path, frame, renders, width, height),
    report: (report) => ipcRenderer.invoke(channels.benchReport, report)
  },
  helper: {
    status: () => ipcRenderer.invoke(channels.helperStatus),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: HelperStatus) => listener(status)
      ipcRenderer.on(channels.helperStatusChanged, handler)
      return () => ipcRenderer.off(channels.helperStatusChanged, handler)
    },
    probeTrack: (trackId) => ipcRenderer.invoke(channels.probeTrack, trackId)
  }
}

contextBridge.exposeInMainWorld('elynt', api)
