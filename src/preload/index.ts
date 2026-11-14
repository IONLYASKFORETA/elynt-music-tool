import { contextBridge, ipcRenderer } from 'electron'
import { channels, type ElyntApi } from '../shared/api'
import type { HelperStatus } from '../shared/helper'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    addFromPickedMixdown: () => ipcRenderer.invoke(channels.addFromPickedMixdown)
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
