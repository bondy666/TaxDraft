import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { searchEntries, type SearchEntry, type SearchTab } from '../engine/searchIndex'

interface Props {
  entries: SearchEntry[]
  onOpen: (tab: SearchTab, text: string) => void
}

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)
}

function snippet(text: string, terms: string[], length = 180): string {
  if (text.length <= length) return text
  const lower = text.toLowerCase()
  const first = Math.min(...terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0), Infinity)
  const start = Number.isFinite(first) ? Math.max(0, first - 60) : 0
  return `${start > 0 ? '…' : ''}${text.slice(start, start + length)}${start + length < text.length ? '…' : ''}`
}

export function SearchBox({ entries, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { results, total } = useMemo(() => searchEntries(entries, query), [entries, query])
  const terms = query.trim().split(/\s+/).filter(Boolean)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      const typing = target.closest('input, textarea, select, [contenteditable="true"]')
      if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      }
    }
    function onClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [])

  useEffect(() => setActive(0), [query])

  function choose(entry: SearchEntry) {
    setOpen(false)
    onOpen(entry.tab, entry.title)
  }

  return (
    <div className="app-search" ref={containerRef}>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && !!query.trim()}
        aria-controls="app-search-results"
        aria-label="Search the whole app"
        placeholder="Search everything… (Ctrl+K)"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
          else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
          else if (event.key === 'Enter' && results[active]) { event.preventDefault(); choose(results[active]) }
        }}
      />
      {open && !!query.trim() && (
        <div className="app-search-results" id="app-search-results" role="listbox" aria-label="Search results">
          <p className="app-search-count" role="status">
            {total === 0 ? 'No matches' : total > results.length
              ? `Showing top ${results.length} of ${total} matches`
              : `${total} match${total === 1 ? '' : 'es'}`}
          </p>
          {results.map((entry, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={`${entry.id}-${index}`}
              className={`app-search-result${index === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(entry)}
            >
              <span className="app-search-where">{entry.tab} › {entry.section}</span>
              <strong>{highlight(entry.title, terms)}</strong>
              {entry.detail && <small>{highlight(snippet(entry.detail, terms), terms)}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
