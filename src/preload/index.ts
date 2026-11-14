import { contextBridge, ipcRenderer } from 'electron'
import { channels, type ElyntApi } from '../shared/api'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    addFromPickedMixdown: () => ipcRenderer.invoke(channels.addFromPickedMixdown)
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
  }
}

contextBridge.exposeInMainWorld('elynt', api)
