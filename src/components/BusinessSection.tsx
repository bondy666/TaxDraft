import { useState, type ChangeEvent } from 'react'
import type { BusinessDetails, BusinessInvoice } from '../types'
import {
  corporationEstimate, corporationEstimateIssues, emptyBusiness, hasCompany, hasSoleTrade, soleTraderTotals, taxYearBounds,
  validBusinessDate,
} from '../engine/business'

const money = (amount: number) => amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const uid = () => globalThis.crypto.randomUUID()

export function BusinessSection({ business, taxYearId, onChange, onRemove }: {
  business?: BusinessDetails
  taxYearId: string
  onChange: (update: (current: BusinessDetails) => BusinessDetails) => void
  onRemove: (id: string) => void
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const current = business ?? emptyBusiness()
  const sole = hasSoleTrade(current)
  const company = hasCompany(current)
  const companyMode = company && current.taxMode === 'company'
  const totals = soleTraderTotals(current, taxYearId)
  const estimate = corporationEstimate(current)
  const issues = corporationEstimateIssues(current)
  const patch = (change: Partial<BusinessDetails>) => onChange((previous) => ({ ...previous, ...change }))
  const updateInvoice = (id: string, change: Partial<BusinessInvoice>) => onChange((previous) => ({
    ...previous, invoices: previous.invoices.map((item) => item.id === id ? { ...item, ...change, confirmed: false } : item),
  }))
  const add = (businessType: BusinessInvoice['business'], source = 'Entered by hand', amount = 0, sourceHash?: string) =>
    onChange((previous) => ({
      ...previous, invoices: [...previous.invoices, {
        id: uid(), business: businessType, kind: 'income', source, date: '', amount, confirmed: false,
        ...(sourceHash ? { sourceHash } : {}),
      }],
    }))

  async function upload(event: ChangeEvent<HTMLInputElement>, businessType: BusinessInvoice['business']) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const { readBusinessInvoice } = await import('../engine/documentImport')
      const result = await readBusinessInvoice(file)
      if (current.invoices.some((invoice) => invoice.sourceHash === result.hash)) {
        setMessage(`${file.name} has already been added.`)
      } else {
        add(businessType, file.name, result.amount ?? 0, result.hash)
        setMessage(`${file.name}: ${result.warning} Then tick Confirmed.`)
      }
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function entries(businessType: BusinessInvoice['business']) {
    const bounds = businessType === 'soleTrader' ? taxYearBounds(taxYearId)
      : validBusinessDate(current.companyStart) && validBusinessDate(current.companyEnd)
        ? { start: current.companyStart, end: current.companyEnd } : null
    const period = businessType === 'soleTrader' ? 'tax year' : 'accounting period'
    const dateLabel = businessType === 'soleTrader' && current.soleTraderBasis === 'cash' ? 'Date paid' : 'Invoice date'
    const list = current.invoices.filter((invoice) => invoice.business === businessType)
    return <>
      <p className="hint">Add each invoice you sent and each receipt or bill for business costs. Check the details, then
        tick <strong>Confirmed</strong>. Only confirmed entries are counted.</p>
      <div className="document-actions">
        <label className="add-btn document-file-label">
          {busy ? 'Reading invoice…' : 'Upload an invoice or receipt'}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff" disabled={busy}
            onChange={(event) => void upload(event, businessType)} />
        </label>
        <button type="button" className="ghost-btn" onClick={() => add(businessType)}>Add one by hand</button>
      </div>
      {list.map((invoice) => {
        const outside = invoice.confirmed && bounds && validBusinessDate(invoice.date) &&
          (invoice.date < bounds.start || invoice.date > bounds.end)
        return (
          <div className="entry-row business-entry" key={invoice.id}>
            <strong className="business-entry-source">{invoice.source}</strong>
            <label className="field small">Type
              <select value={invoice.kind} onChange={(event) => updateInvoice(invoice.id, { kind: event.target.value as BusinessInvoice['kind'] })}>
                <option value="income">Sale (money in)</option><option value="expense">Business cost (money out)</option>
              </select>
            </label>
            <label className="field small">{dateLabel}
              <input type="date" value={invoice.date} onChange={(event) => updateInvoice(invoice.id, { date: event.target.value })} />
            </label>
            <label className="field small">Amount (£)
              <input type="number" min="0" step="0.01" value={invoice.amount}
                onChange={(event) => updateInvoice(invoice.id, { amount: Number(event.target.value) })} />
            </label>
            <label className="field checkbox">
              <input type="checkbox" checked={invoice.confirmed}
                disabled={!validBusinessDate(invoice.date) || !Number.isFinite(invoice.amount) || invoice.amount <= 0}
                onChange={(event) => onChange((previous) => ({
                  ...previous, invoices: previous.invoices.map((item) => item.id === invoice.id ? { ...item, confirmed: event.target.checked } : item),
                }))} />
              <span>Confirmed</span>
            </label>
            <button type="button" className="remove-btn" aria-label={`Remove ${invoice.source}`} onClick={() => onRemove(invoice.id)}>✕</button>
            {outside && <p className="hint error business-entry-note">Dated outside this {period}, so it isn’t counted.</p>}
          </div>
        )
      })}
    </>
  }

  return <div className="card">
    <h2>{companyMode ? 'Your company' : 'Working for yourself'}</h2>
    <div className="form-grid">
      <label className="field">Did you work for yourself in this tax year?
        <select value={current.status} onChange={(event) => patch({ status: event.target.value as BusinessDetails['status'] })}>
          <option value="unknown">Please choose</option>
          <option value="none">No</option>
          <option value="soleTrader">Yes, self-employed (sole trader)</option>
          <option value="company">Yes, through my own limited company</option>
          <option value="both">Yes, both</option>
        </select>
      </label>
    </div>

    {company && (
      <fieldset className="mode-choice">
        <legend>What do you want to work out?</legend>
        <label><input type="radio" name="tax-mode" checked={!companyMode} onChange={() => patch({ taxMode: 'personal' })} />
          <span><strong>Your personal tax</strong> (Self Assessment)</span></label>
        <label><input type="radio" name="tax-mode" checked={companyMode} onChange={() => patch({ taxMode: 'company' })} />
          <span><strong>Your company’s Corporation Tax</strong></span></label>
      </fieldset>
    )}
    {message && <p className="hint" role="status">{message}</p>}

    {!companyMode && company && (
      <p className="hint">Your company’s invoices aren’t needed for your personal tax. Enter any salary it paid you
        under Employment (from its P60) and any dividends under Dividends.</p>
    )}

    {!companyMode && sole && <section className="business-block">
      <h3>Sole trader income and costs</h3>
      <div className="form-grid">
        <label className="field">How do you count your income?
          <select value={current.soleTraderBasis} onChange={(event) => onChange((previous) => ({
            ...previous, soleTraderBasis: event.target.value as BusinessDetails['soleTraderBasis'],
            invoices: previous.invoices.map((item) => item.business === 'soleTrader' ? { ...item, confirmed: false } : item),
          }))}>
            <option value="cash">When money is received or paid (cash basis, most sole traders)</option>
            <option value="traditional">When I invoice or am billed (traditional accounting)</option>
          </select>
        </label>
      </div>
      {entries('soleTrader')}
      <p className="business-total">Profit this tax year: sales £{money(totals.income)} − costs £{money(totals.expenses)}
        {' '}= <strong>£{money(totals.profit)}</strong></p>
      {totals.profit < 0 && <p className="hint">A loss isn’t taken off your other income automatically.</p>}
      <details className="business-notes">
        <summary>What this doesn’t include</summary>
        <ul>
          <li>Class 4 National Insurance, payments on account and student loan repayments.</li>
          <li>The £1,000 trading allowance, capital allowances and loss relief.</li>
          <li>VAT: if you’re VAT-registered, enter amounts without VAT.</li>
          <li>Only the business share of mixed costs (such as a phone) should be entered.</li>
        </ul>
      </details>
    </section>}

    {companyMode && <section className="business-block">
      <h3>Accounting period</h3>
      <div className="form-grid">
        <label className="field">Period start<input type="date" value={current.companyStart} onChange={(event) => patch({ companyStart: event.target.value })} /></label>
        <label className="field">Period end<input type="date" value={current.companyEnd} onChange={(event) => patch({ companyEnd: event.target.value })} /></label>
      </div>
      <label className="field checkbox">
        <input type="checkbox" checked={current.companySimpleCase} onChange={(event) => patch({ companySimpleCase: event.target.checked })} />
        <span>My company is a simple case</span>
      </label>
      <details className="business-notes">
        <summary>What counts as a simple case?</summary>
        <ul>
          <li>A UK company that trades normally, with no other companies under the same control.</li>
          <li>No dividends received from other companies, and no investment or oil and gas rules.</li>
          <li>No other income, capital allowances or tax adjustments to make. Otherwise, ask an accountant.</li>
        </ul>
      </details>
      <h3>Sales and costs</h3>
      {entries('company')}
      {estimate
        ? <p className="business-total">Estimated Corporation Tax: <strong>£{money(estimate.tax)}</strong>. See Computation for the working.</p>
        : <ul className="hint error">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    </section>}
  </div>
}
