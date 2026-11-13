import { contextBridge, ipcRenderer } from 'electron'
import { channels, type ElyntApi } from '../shared/api'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    pickMixdown: () => ipcRenderer.invoke(channels.pickMixdown)
  }
}

contextBridge.exposeInMainWorld('elynt', api)
