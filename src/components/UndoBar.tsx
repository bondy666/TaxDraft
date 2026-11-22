import { useEffect, useState } from 'react'
import type { UndoEntry } from '../engine/undo'

interface Props {
  last?: UndoEntry
  count: number
  onUndo: () => void
}

export function UndoBar({ last, count, onUndo }: Props) {
  const [dismissedId, setDismissedId] = useState<number>()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.key === 'z' && (event.ctrlKey || event.metaKey)) || event.shiftKey) return
      // Leave Ctrl+Z inside text fields to the browser's own text undo.
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (!last) return
      event.preventDefault()
      onUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, onUndo])

  if (!last || dismissedId === last.id) return null
  return (
    <div className="undo-bar" role="status" aria-live="polite">
      <span>{last.label}.</span>
      <button type="button" className="undo-btn" onClick={onUndo}>Undo</button>
      {count > 1 && <span className="undo-more">{count - 1} earlier change{count === 2 ? '' : 's'} can also be undone (Ctrl+Z)</span>}
      <button type="button" className="undo-dismiss" aria-label="Dismiss" onClick={() => setDismissedId(last.id)}>✕</button>
    </div>
  )
}
