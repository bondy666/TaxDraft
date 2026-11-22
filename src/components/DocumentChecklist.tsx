import type { DocumentChecklist, DocumentChecklistItem } from '../engine/documentChecklist'

function ItemList({ items, mark }: { items: DocumentChecklistItem[]; mark: string }) {
  return (
    <ul className="doc-list">
      {items.map((item) => (
        <li key={item.id}>
          <span className="doc-mark" aria-hidden="true">{mark}</span>
          <span><strong>{item.label}</strong><small>{item.detail}</small></span>
        </li>
      ))}
    </ul>
  )
}

export function DocumentChecklistPanel({ checklist, filesChosen, onOpenIncome }: {
  checklist: DocumentChecklist
  filesChosen: boolean
  onOpenIncome: () => void
}) {
  const missing = checklist.items.filter((item) => item.need === 'needed' && !item.found)
  const found = checklist.items.filter((item) => item.need !== 'notNeeded' && item.found)
  const notNeeded = checklist.items.filter((item) => item.need === 'notNeeded' && item.found)
  const ifApplies = checklist.items.filter((item) => item.need === 'optional' && !item.found)

  return (
    <section className="doc-checklist" aria-labelledby="doc-checklist-heading">
      <p className="step-label">CHECK <span>02</span></p>
      <h3 id="doc-checklist-heading">
        {checklist.companyMode ? 'Documents for your company’s Corporation Tax' : 'Documents for your personal tax'}
      </h3>
      <p className="hint">Based on what you’ve entered and the files you’ve chosen. The list updates as you go.</p>

      {checklist.askAboutBusiness && (
        <div className="doc-prompt" role="status">
          <span>We found invoices. Did you work for yourself this year?</span>
          <button type="button" className="add-btn" onClick={onOpenIncome}>Answer in Income</button>
        </div>
      )}

      <div className="doc-groups">
        <div className="doc-group doc-missing">
          <h4>{filesChosen ? 'Still needed' : 'You’ll need'} <span className="evidence-count">{missing.length}</span></h4>
          {missing.length ? <ItemList items={missing} mark="!" />
            : <p className="hint">Nothing else is needed for what you’ve entered so far.</p>}
        </div>
        {found.length > 0 && (
          <div className="doc-group doc-found">
            <h4>{filesChosen ? 'Found' : 'Already provided'} <span className="evidence-count">{found.length}</span></h4>
            <ItemList items={found} mark="✓" />
          </div>
        )}
        {notNeeded.length > 0 && (
          <div className="doc-group doc-not-needed">
            <h4>Not needed — you can leave these out <span className="evidence-count">{notNeeded.length}</span></h4>
            <ItemList items={notNeeded} mark="–" />
          </div>
        )}
      </div>

      {ifApplies.length > 0 && (
        <details className="doc-optional" open={!missing.length && !found.length}>
          <summary>Only if it applies to you ({ifApplies.length})</summary>
          <ItemList items={ifApplies} mark="?" />
        </details>
      )}
    </section>
  )
}
