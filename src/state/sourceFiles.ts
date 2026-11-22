import { useSyncExternalStore } from 'react'

// The documents selected on the Documents tab, kept only in memory (never saved) so other tabs can open a source.
let files = new Map<string, File>()
const listeners = new Set<() => void>()

export function setSourceFiles(selected: File[]) {
  files = new Map(selected.map((file) => [file.name, file]))
  listeners.forEach((listener) => listener())
}

export function useSourceFiles(): Map<string, File> {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    () => files,
  )
}
