import type { ReviewItem } from '../engine/reviewChecklist'

interface Props {
  items: ReviewItem[]
  onNavigate: (tab: 'Documents' | 'Personal' | 'Income' | 'Computation' | 'Reliefs') => void
}

export function ReviewChecklist({ items, onNavigate }: Props) {
  const unresolved = items.filter((item) => item.severity !== 'info')
  const actionCount = unresolved.filter((item) => item.severity === 'action').length
  const checkCount = unresolved.filter((item) => item.severity === 'check').length

  return (
    <div className="card review-card">
      <h2>Review before relying on the computation</h2>
      <p className="hint">
        This checklist highlights values that need verification or reconciliation. It does not replace checking the source documents.
      </p>

      <div className="review-summary" aria-label="Review summary">
        <div>
          <span className="review-summary-number">{actionCount}</span>
          <span>must check</span>
        </div>
        <div>
          <span className="review-summary-number">{checkCount}</span>
          <span>worth checking</span>
        </div>
        <div className={unresolved.length === 0 ? 'ready' : ''}>
          <span className="review-summary-number">{unresolved.length === 0 ? '✓' : unresolved.length}</span>
          <span>{unresolved.length === 0 ? 'ready to review' : 'open items'}</span>
        </div>
      </div>

      {unresolved.length === 0 ? (
        <div className="review-empty" role="status">
          <strong>No outstanding verification items found.</strong>
          <p>Review the computation and still-check advisory items before using the figures.</p>
        </div>
      ) : (
        <div className="review-items">
          {unresolved.map((item) => (
            <section className={`review-item review-${item.severity}`} key={item.id}>
              <div className="review-item-copy">
                <span className="review-item-tag">
                  {item.severity === 'action' ? 'Must check' : 'Worth checking'}
                </span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
              <button type="button" className="ghost-btn" onClick={() => onNavigate(item.tab)}>
                Open {item.tab}
              </button>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
