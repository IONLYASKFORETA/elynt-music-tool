import { contextBridge, ipcRenderer } from 'electron'
import { channels, type ElyntApi } from '../shared/api'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    addFromPickedMixdown: () => ipcRenderer.invoke(channels.addFromPickedMixdown),
    readMixdown: (trackId) => ipcRenderer.invoke(channels.readMixdown, trackId)
  }
}

contextBridge.exposeInMainWorld('elynt', api)
