import type { ReliefFlag } from '../types'

const severityMeta: Record<ReliefFlag['severity'], { label: string; className: string }> = {
  action: { label: 'Worth acting on', className: 'flag-action' },
  check: { label: 'Worth checking', className: 'flag-check' },
  info: { label: 'For your records', className: 'flag-info' },
}

export function ReliefsPanel({ flags }: { flags: ReliefFlag[] }) {
  const order: ReliefFlag['severity'][] = ['action', 'check', 'info']
  const sorted = [...flags].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))

  return (
    <div className="card">
      <h2>Reliefs &amp; things to check</h2>
      <p className="hint">
        Generated from what you've entered, plus a standing checklist of items accountants routinely ask about.
        Nothing here is filed automatically — treat it as a prompt to double-check, not a final answer.
      </p>
      <div className="flag-list">
        {sorted.map((f) => (
          <div className={`flag-card ${severityMeta[f.severity].className}`} key={f.id}>
            <div className="flag-tag">{severityMeta[f.severity].label}</div>
            <div className="flag-title">{f.title}</div>
            <div className="flag-detail">{f.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
