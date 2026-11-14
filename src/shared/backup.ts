export interface BackupStatus {
  /** The folder daily backups go to, or null until the owner picks one. */
  folder: string | null
  /** Calendar day (YYYY-MM-DD) of the newest backup in that folder. */
  lastBackupDay: string | null
}
