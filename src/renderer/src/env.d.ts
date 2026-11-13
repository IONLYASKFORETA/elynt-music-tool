import type { ElyntApi } from '../../shared/api'

declare global {
  interface Window {
    elynt: ElyntApi
  }
}
