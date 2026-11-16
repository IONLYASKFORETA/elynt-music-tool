import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { channels, type ElyntApi } from '../shared/api'
import type { TrackAnalysisState } from '../shared/analysis'
import type { HelperStatus } from '../shared/helper'
import type { SplitJob } from '../shared/stems'

const api: ElyntApi = {
  tracks: {
    list: () => ipcRenderer.invoke(channels.listTracks),
    addFromPickedMixdown: () => ipcRenderer.invoke(channels.addFromPickedMixdown),
    readMixdown: (trackId) => ipcRenderer.invoke(channels.readMixdown, trackId),
    rename: (trackId, title) => ipcRenderer.invoke(channels.renameTrack, trackId, title)
  },
  stems: {
    list: (trackId) => ipcRenderer.invoke(channels.listStems, trackId),
    attachPicked: (trackId) => ipcRenderer.invoke(channels.attachPickedStems, trackId),
    removeOwn: (stemId) => ipcRenderer.invoke(channels.removeOwnStem, stemId),
    read: (trackId, stemId) => ipcRenderer.invoke(channels.readStem, trackId, stemId),
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
  mixSetup: {
    get: (trackId) => ipcRenderer.invoke(channels.getMixSetup, trackId),
    save: (setup) => ipcRenderer.invoke(channels.saveMixSetup, setup),
    pickReferenceTracks: () => ipcRenderer.invoke(channels.pickReferenceTracks),
    // File.path is gone in current Electron; webUtils is the supported way to get a dropped file's path.
    pathForDroppedFile: (file) => webUtils.getPathForFile(file)
  },
  analysis: {
    get: (trackId) => ipcRenderer.invoke(channels.getAnalysis, trackId),
    rerun: (trackId) => ipcRenderer.invoke(channels.rerunAnalysis, trackId),
    saveCorrection: (trackId, analysis) => ipcRenderer.invoke(channels.saveAnalysisCorrection, trackId, analysis),
    skipCheck: (trackId) => ipcRenderer.invoke(channels.skipAnalysisCheck, trackId),
    onChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: TrackAnalysisState) => listener(state)
      ipcRenderer.on(channels.analysisChanged, handler)
      return () => ipcRenderer.off(channels.analysisChanged, handler)
    }
  },
  visions: {
    latest: (trackId) => ipcRenderer.invoke(channels.latestVisions, trackId),
    generate: (request) => ipcRenderer.invoke(channels.generateVisions, request),
    getWorking: (trackId) => ipcRenderer.invoke(channels.getWorkingVision, trackId),
    saveWorking: (trackId, vision, from) => ipcRenderer.invoke(channels.saveWorkingVision, trackId, vision, from),
    trackCost: (trackId) => ipcRenderer.invoke(channels.visionTrackCost, trackId)
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
