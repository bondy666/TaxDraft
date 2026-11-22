import type { ReactNode } from 'react'

export function FigureHelp({ children }: { children: ReactNode }) {
  return (
    <details className="figure-help">
      <summary aria-label="How was this figure calculated?" title="How was this figure calculated?">?</summary>
      <div className="figure-help-content">{children}</div>
    </details>
  )
}
