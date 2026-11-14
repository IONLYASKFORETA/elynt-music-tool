import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { channels, type ElyntApi } from '../shared/api'
import type { HelperStatus } from '../shared/helper'
import type { SplitJob } from '../shared/stems'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    addFromPickedMixdown: () => ipcRenderer.invoke(channels.addFromPickedMixdown),
    readMixdown: (trackId) => ipcRenderer.invoke(channels.readMixdown, trackId)
  },
  stems: {
    list: (trackId) => ipcRenderer.invoke(channels.listStems, trackId),
    attachPicked: (trackId) => ipcRenderer.invoke(channels.attachPickedStems, trackId),
    removeOwn: (stemId) => ipcRenderer.invoke(channels.removeOwnStem, stemId),
    split: (trackId) => ipcRenderer.invoke(channels.splitStems, trackId),
    jobs: () => ipcRenderer.invoke(channels.splitJobs),
    onJob: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, job: SplitJob | { trackId: number; state: 'done' }) => listener(job)
      ipcRenderer.on(channels.splitJobChanged, handler)
      return () => ipcRenderer.off(channels.splitJobChanged, handler)
    }
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
  mixSetup: {
    get: (trackId) => ipcRenderer.invoke(channels.getMixSetup, trackId),
    save: (setup) => ipcRenderer.invoke(channels.saveMixSetup, setup),
    pickReferenceTracks: () => ipcRenderer.invoke(channels.pickReferenceTracks),
    // File.path is gone in current Electron; webUtils is the supported way to get a dropped file's path.
    pathForDroppedFile: (file) => webUtils.getPathForFile(file)
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
