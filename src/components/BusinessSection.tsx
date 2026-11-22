import { useState, type ChangeEvent } from 'react'
import type { BusinessDetails, BusinessInvoice } from '../types'
import { corporationEstimate, emptyBusiness, soleTraderTotals, validBusinessDate } from '../engine/business'

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
  const sole = current.status === 'soleTrader' || current.status === 'both'
  const company = current.status === 'company' || current.status === 'both'
  const totals = soleTraderTotals(current, taxYearId)
  const estimate = corporationEstimate(current)
  const patch = (change: Partial<BusinessDetails>) => onChange((previous) => ({ ...previous, ...change }))
  const updateInvoice = (id: string, change: Partial<BusinessInvoice>) => onChange((previous) => ({
    ...previous, invoices: previous.invoices.map((item) => item.id === id ? { ...item, ...change, confirmed: false } : item),
  }))
  const add = (businessType: BusinessInvoice['business'], source = 'Manual entry', amount = 0, sourceHash?: string) =>
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
        setMessage(`${file.name}: this file is already recorded. Check for duplicate invoices before adding another copy.`)
      } else {
        add(businessType, file.name, result.amount ?? 0, result.hash)
        setMessage(`${file.name}: ${result.warning} Review and confirm the entry below.`)
      }
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function entries(businessType: BusinessInvoice['business']) {
    return <>
      <label className="ghost-btn document-file-label">
        {busy ? 'Reading invoice...' : 'Upload invoice (PDF or image)'}
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff" disabled={busy}
          onChange={(event) => void upload(event, businessType)} />
      </label>{' '}
      <button type="button" className="add-btn" onClick={() => add(businessType)}>+ Enter invoice manually</button>
      {current.invoices.filter((invoice) => invoice.business === businessType).map((invoice) => (
        <div className="entry-row" key={invoice.id}>
          <strong>{invoice.source}</strong>
          <label className="field small">Type
            <select value={invoice.kind} onChange={(event) => updateInvoice(invoice.id, { kind: event.target.value as BusinessInvoice['kind'] })}>
              <option value="income">Sales income</option><option value="expense">Allowable business expense</option>
            </select>
          </label>
          <label className="field small">{businessType === 'soleTrader' && current.soleTraderBasis === 'cash' ? 'Payment received / paid date' : 'Invoice / bill date'}
            <input type="date" value={invoice.date} onChange={(event) => updateInvoice(invoice.id, { date: event.target.value })} />
          </label>
          <label className="field small">Tax-relevant amount (£)
            <input type="number" min="0" step="0.01" value={invoice.amount}
              onChange={(event) => updateInvoice(invoice.id, { amount: Number(event.target.value) })} />
          </label>
          <label className="field checkbox">
            <input type="checkbox" checked={invoice.confirmed} disabled={!validBusinessDate(invoice.date) || !Number.isFinite(invoice.amount) || invoice.amount <= 0}
              onChange={(event) => onChange((previous) => ({
                ...previous, invoices: previous.invoices.map((item) => item.id === invoice.id ? { ...item, confirmed: event.target.checked } : item),
              }))} />
            <span>Confirmed: correct business, date, amount and tax treatment; not a duplicate</span>
          </label>
          {invoice.confirmed && <span className="hint">Only included when its date falls within the selected {businessType === 'company' ? 'company accounting period' : 'tax year'}.</span>}
          <button type="button" className="remove-btn" onClick={() => onRemove(invoice.id)}>Remove invoice</button>
        </div>
      ))}
    </>
  }

  return <div className="card">
    <h2>Self-employment and company</h2>
    <label className="field">Were you self-employed or did you trade through your own limited company?
      <select value={current.status} onChange={(event) => patch({ status: event.target.value as BusinessDetails['status'] })}>
        <option value="unknown">Please confirm</option><option value="none">Neither</option>
        <option value="soleTrader">Sole trader</option><option value="company">Limited company</option>
        <option value="both">Both</option>
      </select>
    </label>
    <p className="hint">A sole trader may not have a P60. If you also have employment, enter its P60 separately. Company invoices are not personal income. Changing status excludes entries for inactive businesses without deleting them.</p>
    {message && <p className="hint" role="status">{message}</p>}
    {sole && <section>
      <h3>Sole trader</h3>
      <label className="field">Accounting basis
        <select value={current.soleTraderBasis} onChange={(event) => onChange((previous) => ({
          ...previous, soleTraderBasis: event.target.value as BusinessDetails['soleTraderBasis'],
          invoices: previous.invoices.map((item) => item.business === 'soleTrader' ? { ...item, confirmed: false } : item),
        }))}>
          <option value="cash">Cash basis</option><option value="traditional">Traditional (accruals)</option>
        </select>
      </label>
      <p className="hint">Use the payment date for cash basis, or the invoice/bill date for traditional accounting. Enter only the amount received or paid for partial payments. Review VAT, allowable business use and duplicates; unconfirmed entries are excluded. Invoice dates alone may not capture all accruals or tax-year adjustments.</p>
      {entries('soleTrader')}
      <p>Confirmed {taxYearId} sales £{money(totals.income)} − expenses £{money(totals.expenses)} = profit/loss £{money(totals.profit)}. Positive profit is included in personal income tax; losses are not automatically offset.</p>
      <p className="hint error">The personal calculation excludes self-employed National Insurance, payments on account and any student-loan repayment. Check trading allowance, capital allowances, losses and other adjustments with HMRC or an adviser.</p>
    </section>}
    {company && <section>
      <h3>Limited company corporation tax estimate</h3>
      <p className="hint">Company accounts use traditional accounting, not cash basis. Enter your salary and dividends separately in personal income; company profit and corporation tax never enter your personal return.</p>
      <label className="field small">Accounting period start<input type="date" value={current.companyStart} onChange={(event) => patch({ companyStart: event.target.value })} /></label>
      <label className="field small">Accounting period end<input type="date" value={current.companyEnd} onChange={(event) => patch({ companyEnd: event.target.value })} /></label>
      <label className="field checkbox"><input type="checkbox" checked={current.companySimpleCase}
        onChange={(event) => patch({ companySimpleCase: event.target.checked })} />
        <span>Confirm a UK-resident ordinary trading company, no associated companies, no distributions received, no ring-fence or close investment holding company rules, and no other taxable profits or adjustments.</span>
      </label>
      <p className="hint">Estimate available only for a full 12-month period from 1 April 2024 to 31 March 2027, using confirmed entries. Unconfirmed invoices are excluded. Check tax adjustments, capital allowances, losses, VAT and filing deadlines separately.</p>
      {entries('company')}
      {estimate ? <p>Confirmed sales £{money(estimate.income)} − expenses £{money(estimate.expenses)} = profit/loss £{money(estimate.profit)}. Estimated corporation tax: £{money(estimate.tax)}.</p>
        : <p className="hint error">No corporation tax estimate: confirm the assumptions and enter a supported full-year accounting period.</p>}
    </section>}
  </div>
}
