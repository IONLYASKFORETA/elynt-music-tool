import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { channels, type ElyntApi } from '../shared/api'
import type { TrackAnalysisState } from '../shared/analysis'
import type { HelperStatus } from '../shared/helper'
import type { MixProjectChangeEvent } from '../shared/mix-project'
import type { SplitJob } from '../shared/stems'
import type { SubjectJob } from '../shared/subject-images'

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
  subjectImages: {
    list: (trackId) => ipcRenderer.invoke(channels.listSubjectImages, trackId),
    generate: (trackId, request, count) => ipcRenderer.invoke(channels.generateSubjectImages, trackId, request, count),
    regenerate: (imageId) => ipcRenderer.invoke(channels.regenerateSubjectImage, imageId),
    remove: (imageId) => ipcRenderer.invoke(channels.removeSubjectImage, imageId),
    jobs: () => ipcRenderer.invoke(channels.subjectJobs),
    onJob: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, job: SubjectJob | { trackId: number; state: 'done' }) => listener(job)
      ipcRenderer.on(channels.subjectJobChanged, handler)
      return () => ipcRenderer.off(channels.subjectJobChanged, handler)
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
  releases: {
    list: () => ipcRenderer.invoke(channels.listReleases),
    get: (releaseId) => ipcRenderer.invoke(channels.getRelease, releaseId),
    start: (input) => ipcRenderer.invoke(channels.startRelease, input),
    openToday: (releaseId) => ipcRenderer.invoke(channels.openReleaseToday, releaseId),
    actOnStep: (releaseId, stepId, action) => ipcRenderer.invoke(channels.actOnPlanStep, releaseId, stepId, action),
    moveReleaseDay: (releaseId, newDay) => ipcRenderer.invoke(channels.moveReleaseDay, releaseId, newDay)
  },
  exports: {
    chooseOutput: (trackTitle, format) => ipcRenderer.invoke(channels.chooseExportOutput, trackTitle, format),
    start: (request) => ipcRenderer.invoke(channels.startExport, request),
    writeFrame: (jobId, frame) => ipcRenderer.invoke(channels.writeExportFrame, jobId, frame),
    finish: (jobId) => ipcRenderer.invoke(channels.finishExport, jobId),
    cancel: (jobId) => ipcRenderer.invoke(channels.cancelExport, jobId),
    reveal: (path) => ipcRenderer.invoke(channels.revealExport, path)
  },
  visualizer: {
    safeZones: () => ipcRenderer.invoke(channels.safeZones),
    askNote: (request) => ipcRenderer.invoke(channels.askVisionNote, request)
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
  liveSet: {
    pickAndRead: () => ipcRenderer.invoke(channels.pickAndReadLiveSet)
  },
  mixProject: {
    open: (trackId) => ipcRenderer.invoke(channels.openMixProject, trackId),
    pickFolder: (trackId) => ipcRenderer.invoke(channels.pickMixProjectFolder, trackId),
    onChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, event: MixProjectChangeEvent) => listener(event)
      ipcRenderer.on(channels.mixProjectChanged, handler)
      return () => ipcRenderer.off(channels.mixProjectChanged, handler)
    }
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
  visionHistory: {
    current: (key) => ipcRenderer.invoke(channels.currentVisionHistory, key),
    record: (key, vision) => ipcRenderer.invoke(channels.recordVisionHistory, key, vision),
    undo: (key) => ipcRenderer.invoke(channels.undoVision, key),
    redo: (key) => ipcRenderer.invoke(channels.redoVision, key),
    saveSnapshot: (key, name) => ipcRenderer.invoke(channels.saveVisionSnapshot, key, name),
    listSnapshots: (key) => ipcRenderer.invoke(channels.listVisionSnapshots, key),
    restoreSnapshot: (id) => ipcRenderer.invoke(channels.restoreVisionSnapshot, id),
    deleteSnapshot: (id) => ipcRenderer.invoke(channels.deleteVisionSnapshot, id)
  },
  presets: {
    save: (level, name, data) => ipcRenderer.invoke(channels.savePreset, level, name, data),
    list: (level) => ipcRenderer.invoke(channels.listPresets, level),
    delete: (id) => ipcRenderer.invoke(channels.deletePreset, id)
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
  },
  media: {
    list: () => ipcRenderer.invoke(channels.listMedia),
    addPicked: () => ipcRenderer.invoke(channels.addPickedMedia),
    remove: (id) => ipcRenderer.invoke(channels.removeMedia, id),
    setLogo: (id) => ipcRenderer.invoke(channels.setLogo, id),
    coverArt: (trackId) => ipcRenderer.invoke(channels.getCoverArt, trackId),
    attachPickedCoverArt: (trackId) => ipcRenderer.invoke(channels.attachPickedCoverArt, trackId),
    removeCoverArt: (trackId) => ipcRenderer.invoke(channels.removeCoverArt, trackId)
  }
}

contextBridge.exposeInMainWorld('elynt', api)
