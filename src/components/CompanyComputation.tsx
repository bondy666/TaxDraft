import type { BusinessDetails } from '../types'
import { corporationEstimate, corporationEstimateIssues } from '../engine/business'

const fmt = (amount: number) => (amount < 0 ? '−' : '') +
  Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`ledger-row ${strong ? 'strong' : ''}`}>
      <span className="ledger-label">{label}</span>
      <span className="ledger-leader" aria-hidden="true" />
      <span className="ledger-value figure">{value}</span>
    </div>
  )
}

export function CompanyComputation({ business }: { business?: BusinessDetails }) {
  const estimate = corporationEstimate(business)
  const issues = corporationEstimateIssues(business)
  return (
    <div className="card ledger">
      <h2>Corporation Tax estimate{estimate && business ? ` — ${business.companyStart} to ${business.companyEnd}` : ''}</h2>
      {!estimate ? (
        <>
          <p>Before we can estimate your company’s Corporation Tax, go to Income and:</p>
          <ul className="hint error">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </>
      ) : (
        <>
          <div className="ledger-section-title">Profit</div>
          <Row label="Confirmed sales" value={fmt(estimate.income)} />
          <Row label="Confirmed business costs" value={`(${fmt(estimate.expenses)})`} />
          <Row label="Profit" value={fmt(estimate.profit)} strong />
          <div className="ledger-section-title">Tax</div>
          {estimate.band === 'small' && <Row label={`£${fmt(estimate.taxableProfit)} at the 19% small profits rate`} value={fmt(estimate.tax)} />}
          {estimate.band === 'main' && <Row label={`£${fmt(estimate.taxableProfit)} at the 25% main rate`} value={fmt(estimate.tax)} />}
          {estimate.band === 'marginal' && <>
            <Row label={`£${fmt(estimate.taxableProfit)} at the 25% main rate`} value={fmt(estimate.taxableProfit * 0.25)} />
            <Row label="Less marginal relief (£250,000 − profit) × 3/200" value={`(${fmt(estimate.marginalRelief)})`} />
          </>}
          <Row label="Estimated Corporation Tax" value={fmt(estimate.tax)} strong />
          {estimate.profit < 0 && <p className="hint">The company made a loss, so no Corporation Tax is due for this period.</p>}
          <p className="hint">This estimate uses only your confirmed invoices and receipts. It doesn’t include capital
            allowances, losses from other years or other tax adjustments. Check it with an accountant before filing.</p>
        </>
      )}
    </div>
  )
}
