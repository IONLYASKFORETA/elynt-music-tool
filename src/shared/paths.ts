/** "C:\\Bounces\\SUPERFLY.wav" -> "SUPERFLY". Handles Windows and POSIX separators. */
export function titleFromFileName(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export function fileExtension(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

/** Windows paths ignore case. */
export function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
