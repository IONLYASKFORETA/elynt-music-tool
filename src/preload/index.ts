import { contextBridge, ipcRenderer } from 'electron'
import { channels, type ElyntApi } from '../shared/api'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    addFromPickedMixdown: () => ipcRenderer.invoke(channels.addFromPickedMixdown)
  },
  backup: {
    status: () => ipcRenderer.invoke(channels.backupStatus),
    chooseFolder: () => ipcRenderer.invoke(channels.chooseBackupFolder),
    exportEverything: () => ipcRenderer.invoke(channels.exportEverything)
  }
}

contextBridge.exposeInMainWorld('elynt', api)
