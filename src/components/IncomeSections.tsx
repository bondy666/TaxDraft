import type {
  BankSource, BankReliefCandidate, EmploymentIncome, PropertyLet, PropertyExpenseEvidence, SavingsInterest, DividendIncome, PensionIncome, OtherIncome, Reliefs,
} from '../types'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import {
  allocateProperty, allocateToNewProperty, applyExpenseDecisions, moveBankReference, possibleDuplicateExpenses, reviewPropertyExpense,
  similarExpenseDecisions, suggestPropertyName,
} from '../engine/propertyImport'
import { confirmBankRelief } from '../engine/bankImport'
import { evidencedPropertyExpenses, labelledInterest, mortgagePayments } from '../engine/propertyExpenses'
import { otherIncomePayers, rentReceiptOwners, setPayerTaxable, type OtherIncomePayer } from '../engine/otherIncome'
import { openSource, parseSource } from '../engine/sourceViewer'
import { useSourceFiles } from '../state/sourceFiles'
import { FigureHelp } from './FigureHelp'

type Mutators<T> = {
  add: (item: T) => void
  update: (id: string, patch: Partial<T>) => void
  remove: (id: string) => void
}

const uid = () => Math.random().toString(36).slice(2, 8)
const money = (v: number) => v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function NumField({ value, onChange, label, help, min, max, step }: {
  value: number; onChange: (v: number) => void; label: string; help?: ReactNode
  min?: number; max?: number; step?: number
}) {
  const id = useId()
  return (
    <div className="field small">
      <span className="field-label-row">
        <label htmlFor={id}>{label}</label>
        {help && <FigureHelp>{help}</FigureHelp>}
      </span>
      <input id={id} type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function TextField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="field small">
      <span>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="remove-btn" onClick={onClick} aria-label="Remove">✕</button>
}

// ---- Employment (P60 / P11D) --------------------------------------------------

export function EmploymentSection({ items, m }: { items: EmploymentIncome[]; m: Mutators<EmploymentIncome> }) {
  return (
    <div className="card">
      <h2>Employment — P60 / P11D</h2>
      {items.map((e) => (
        <div className="entry-row" key={e.id}>
          <TextField label="Employer" value={e.employer} onChange={(v) => m.update(e.id, { employer: v })} />
          <NumField label="P60 pay (£)" value={e.p60Pay} onChange={(v) => m.update(e.id, { p60Pay: v })} />
          <NumField label="Tax deducted (£)" value={e.taxDeducted} onChange={(v) => m.update(e.id, { taxDeducted: v })} />
          <NumField label="P11D benefits (£)" value={e.benefitsInKind} onChange={(v) => m.update(e.id, { benefitsInKind: v })} />
          <RemoveButton onClick={() => m.remove(e.id)} />
          {e.p60Source && (
            <label className="field checkbox">
              <input type="checkbox" checked={e.p60Source.verified} onChange={(event) => {
                if (e.p60Source) m.update(e.id, { p60Source: { ...e.p60Source, verified: event.target.checked } })
              }} />
              <span>P60 auto-populated from {e.p60Source.fileName}: {e.p60Source.verified ? 'verified' : 'check employer, pay and tax against the original'}</span>
            </label>
          )}
        </div>
      ))}
      <button type="button" className="add-btn" onClick={() => m.add({ id: uid(), employer: '', p60Pay: 0, taxDeducted: 0, benefitsInKind: 0 })}>
        + Add employment
      </button>
    </div>
  )
}

// ---- Property lets --------------------------------------------------

function ExpenseListSummary({ item }: { item: PropertyLet }) {
  const listed = (item.expenseEvidence ?? []).reduce((sum, expense) => sum + expense.allowableAmount, 0)
  const unlisted = Math.round((item.allowableExpenses - listed) * 100) / 100
  return (
    <section className="expense-comparison">
      <h4>{item.name || 'Unnamed property'} — included expenses: £{money(item.allowableExpenses)}</h4>
      {item.expenseEvidence?.length ? (
        <div className="expense-table-scroll">
          <table className="expense-table">
            <caption>Expense evidence for {item.name || 'Unnamed property'}</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Expense / source</th><th scope="col">Recorded (£)</th><th scope="col">Included (£)</th></tr></thead>
            <tbody>{item.expenseEvidence.map((expense) => (
              <tr key={expense.id}>
                <td>{expense.date}</td>
                <td>{expense.description}<small>{expense.source} · row {expense.row}</small></td>
                <td className="expense-money">{money(expense.amount)}</td>
                <td className="expense-money">{money(expense.allowableAmount)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="hint error">No itemised expense evidence is available for this total. Check the original records before combining.</p>}
      {unlisted !== 0 && <p className="hint error">Amount not explained by included rows: £{money(unlisted)}. Reconcile this manual/summary balance before confirming.</p>}
    </section>
  )
}

function PropertyRentalFigureHelp({ item }: { item: PropertyLet }) {
  const includedBankReceipts = (item.bankEvidence ?? []).filter((evidence) =>
    evidence.kind === 'possibleRent' && evidence.includedInRent,
  )
  const unconfirmedBankReceipts = (item.bankEvidence ?? []).filter((evidence) =>
    evidence.kind === 'possibleRent' && !evidence.includedInRent,
  )
  return (
    <div className="figure-breakdown">
      <strong>Rental income before ownership: £{money(item.rentalIncome)}</strong>
      {item.documentNote && <p>Imported document details: {item.documentNote}</p>}
      {includedBankReceipts.length > 0 && (
        <>
          <p>Confirmed bank receipts added to this figure:</p>
          <ul>{includedBankReceipts.map((evidence, index) => (
            <li key={`${evidence.label}-${index}`}>{evidence.label}: £{money(evidence.incoming)}</li>
          ))}</ul>
        </>
      )}
      {unconfirmedBankReceipts.length > 0 && (
        <>
          <p>Possible bank receipts not included in rental income:</p>
          <ul>{unconfirmedBankReceipts.map((evidence, index) => (
            <li key={`${evidence.label}-${index}`}>{evidence.label}: £{money(evidence.incoming)} (not included until confirmed)</li>
          ))}</ul>
        </>
      )}
      {!item.documentNote && includedBankReceipts.length === 0 && unconfirmedBankReceipts.length === 0 && (
        <p>This amount was entered manually; no transaction-level rental evidence is attached to it.</p>
      )}
      <p className="figure-breakdown-total">
        Tax share: £{money(item.rentalIncome)} × {(item.ownershipShare * 100).toLocaleString('en-GB')}% ownership
        = £{money(item.rentalIncome * item.ownershipShare)}.
      </p>
    </div>
  )
}

function PropertyExpensesFigureHelp({ item }: { item: PropertyLet }) {
  const expenses = item.expenseEvidence ?? []
  const includedTotal = evidencedPropertyExpenses(item)
  return (
    <div className="figure-breakdown">
      <strong>How allowable expenses add up</strong>
      {expenses.length ? (
        <ul>
          {expenses.map((expense) => {
            const included = expense.treatment === 'interest' || expense.treatment === 'repayment'
              ? 0 : expense.allowableAmount
            return (
              <li key={expense.id}>
                <span>{expense.date} — {expense.description} (row {expense.row}): recorded £{money(expense.amount)}; included £{money(included)}</span>
                <small>{expense.source} · {expense.reason}</small>
              </li>
            )
          })}
        </ul>
      ) : <p>No itemised expense rows are attached. The current allowable total is £{money(item.allowableExpenses)}.</p>}
      <p className="figure-breakdown-total">
        Included running-expense rows total £{money(includedTotal)} before ownership. Tax share:
        {' '}£{money(includedTotal)} × {(item.ownershipShare * 100).toLocaleString('en-GB')}% = £{money(includedTotal * item.ownershipShare)}.
      </p>
      {item.expenseReconciliation ? <p>Unexplained legacy balance £{money(item.expenseReconciliation)} is excluded.</p> : null}
    </div>
  )
}

function InterestOnlyMortgageField({ item, onChange }: { item: PropertyLet; onChange: (patch: Partial<PropertyLet>) => void }) {
  const payments = mortgagePayments(item)
  return (
    <div className="interest-only-mortgage">
      <label className="field checkbox">
        <input type="checkbox" checked={item.interestOnlyMortgage ?? false} onChange={(event) => {
          const checked = event.target.checked
          // Unticking drops the payments total, which overstates interest on a repayment mortgage.
          onChange(checked || payments.source === 'none'
            ? { interestOnlyMortgage: checked }
            : { interestOnlyMortgage: false, mortgageInterest: labelledInterest(item) })
        }} />
        <span>Interest-only mortgage</span>
      </label>
      {item.interestOnlyMortgage && (
        <p className="hint">{payments.source === 'none'
          ? 'No mortgage payments are recorded for this property yet. Enter the interest from the lender’s annual statement, or assign the lender’s bank reference or mortgage rows to fill it automatically.'
          : `Every payment on an interest-only mortgage is interest, so the annual interest is the £${money(payments.total)} paid in ${payments.count} ${
            payments.source === 'ledger' ? `mortgage row${payments.count === 1 ? '' : 's'} in the property documents`
              : `lender bank reference${payments.count === 1 ? '' : 's'}`}. It updates as that evidence changes. This is the whole property’s interest — your ownership share is applied in the calculation — so check it against the lender’s annual statement.`}</p>
      )}
    </div>
  )
}

function PropertyInterestFigureHelp({ item }: { item: PropertyLet }) {
  const interestRows = (item.expenseEvidence ?? []).filter((expense) => expense.treatment === 'interest' ||
    (item.interestOnlyMortgage && expense.treatment === 'repayment'))
  const interestOnlyBank = item.interestOnlyMortgage && mortgagePayments(item).source === 'bank'
  const evidenceTotal = interestRows.reduce((sum, expense) => sum + expense.amount, 0)
  const difference = Math.round((item.mortgageInterest - evidenceTotal) * 100) / 100
  return (
    <div className="figure-breakdown">
      <strong>Annual mortgage/finance interest entered: £{money(item.mortgageInterest)}</strong>
      {item.documentNote && <p>Source document note: {item.documentNote}</p>}
      {item.interestOnlyMortgage && <p>Interest-only mortgage: all mortgage payments are counted as interest.</p>}
      {interestOnlyBank ? <p>
        Taken from the outgoing payments to the lender in this property’s bank references:
        {' '}{(item.bankEvidence ?? []).filter((evidence) => evidence.kind === 'mortgage' && evidence.outgoing > 0)
          .map((evidence) => `${evidence.label} £${money(evidence.outgoing)}`).join(', ')}.
      </p> : interestRows.length ? (
        <>
          <p>Interest evidence rows:</p>
          <ul>{interestRows.map((expense) => (
            <li key={expense.id}>
              {expense.date} — {expense.description} (row {expense.row}): £{money(expense.amount)}
              <small>{expense.source}</small>
            </li>
          ))}</ul>
          <p>Evidence rows total £{money(evidenceTotal)}; the annual interest field above is the figure used in the calculation.</p>
          {difference !== 0 && <p>The annual field differs from these rows by £{money(difference)}. Check it against the lender’s annual interest statement.</p>}
        </>
      ) : <p>
        No itemised interest rows are attached, so this is a single entered or imported annual total, not a sum of
        mortgage-payment transactions. The available rows cannot explain or reconcile this amount; check it against
        the lender’s annual interest statement.
      </p>}
      <p className="figure-breakdown-total">
        Tax share: £{money(item.mortgageInterest)} × {(item.ownershipShare * 100).toLocaleString('en-GB')}% ownership
        = £{money(item.mortgageInterest * item.ownershipShare)}.{item.interestOnlyMortgage ? '' : ' Principal repayments are not interest and are excluded.'}
      </p>
    </div>
  )
}

const NEW_PROPERTY = '__new__'

/** The item's source as a link that opens the picture, highlighted text or row, when its file is selected in Documents. */
function SourceLink({ source, row, amount }: { source: string; row?: number; amount?: number }) {
  const files = useSourceFiles()
  const [error, setError] = useState('')
  const file = files.get(parseSource(source).fileName)
  if (!file) return <span title="Select this file's folder in Documents to open it from here.">{source}</span>
  return (
    <>
      <button type="button" className="source-link" title="Open where this item was found"
        onClick={() => openSource(file, source, { row, amount }).catch((cause) =>
          setError(`Could not open ${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`))}>
        {source}
      </button>
      {error && <span className="hint error" role="alert"> {error}</span>}
    </>
  )
}

function PropertyAllocation({ item, items, onAllocate, onAllocateNew }: {
  item: PropertyLet; items: PropertyLet[]
  onAllocate: (sourceId: string, targetId: string, receiptIsRent: boolean, confirmSeparateExpenses: boolean) => void
  onAllocateNew: (sourceId: string, name: string, receiptIsRent: boolean, confirmSeparateExpenses: boolean) => void
}) {
  const [targetId, setTargetId] = useState('')
  const [newName, setNewName] = useState(() => suggestPropertyName(item.name))
  const [receiptIsRent, setReceiptIsRent] = useState(false)
  const [confirmSeparateExpenses, setConfirmSeparateExpenses] = useState(false)
  const [error, setError] = useState('')
  const creating = targetId === NEW_PROPERTY
  const target = items.find((candidate) => candidate.id === targetId)
  const namedProperties = items.filter((candidate) => candidate.id !== item.id && !candidate.name.startsWith('Unallocated'))
  const possibleRent = !!item.bankEvidence?.some((evidence) => evidence.kind === 'possibleRent' && !evidence.includedInRent)
  const needsRentConfirmation = item.rentalIncome > 0 || possibleRent
  const rentalTotalConflict = needsRentConfirmation && !!target && target.rentalIncome > 0
  return (
    <div>
      <label className="field">
        <span>Which property does this bank receipt, mortgage or cost evidence belong to?</span>
        <select value={targetId} onChange={(event) => {
          setTargetId(event.target.value)
          setReceiptIsRent(false)
          setConfirmSeparateExpenses(false)
          setError('')
        }}>
          <option value="">Choose property</option>
          {namedProperties.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || 'Unnamed property'}</option>)}
          <option value={NEW_PROPERTY}>+ New property…</option>
        </select>
      </label>
      {!namedProperties.length && !creating && (
        <p className="hint">
          No named properties yet. Choose “+ New property…”, or include the workbook that lists your properties in the
          folder you select in Documents.
        </p>
      )}
      {creating && (
        <label className="field">
          <span>New property name</span>
          <input type="text" value={newName} placeholder="e.g. Drayton Park"
            onChange={(event) => { setNewName(event.target.value); setError('') }} />
        </label>
      )}
      {needsRentConfirmation && (
        <label className="field checkbox">
          <input type="checkbox" checked={receiptIsRent} onChange={(event) => setReceiptIsRent(event.target.checked)} />
          <span>{item.rentalIncome > 0 && possibleRent
            ? `I confirm the saved £${money(item.rentalIncome)} total and incoming bank references are rent for this property`
            : item.rentalIncome > 0
              ? `I confirm the saved £${money(item.rentalIncome)} figure is rental income for this property`
              : 'I confirm these incoming references are rent for this property, not a deposit or transfer'}</span>
        </label>
      )}
      {rentalTotalConflict && (
        <p className="hint">
          This property already has a rental-income total. Use the receipt review in Documents to choose whether these
          receipts are additional or already included; do not combine totals here.
        </p>
      )}
      {item.allowableExpenses > 0 && target && target.allowableExpenses > 0 && (
        <div className="expense-allocation-comparison">
          <h3>Check both expense lists before combining</h3>
          <ExpenseListSummary item={item} />
          <ExpenseListSummary item={target} />
          <p><strong>Combined allowable expenses: £{money(Math.round((item.allowableExpenses + target.allowableExpenses) * 100) / 100)}</strong></p>
        <label className="field checkbox">
          <input type="checkbox" checked={confirmSeparateExpenses}
            onChange={(event) => setConfirmSeparateExpenses(event.target.checked)} />
          <span>I have checked that these are separate, non-duplicated expenses; combine both expense totals</span>
        </label>
        </div>
      )}
      <button type="button" className="ghost-btn"
        disabled={!targetId || (creating && !newName.trim()) || (needsRentConfirmation && !receiptIsRent) || rentalTotalConflict} onClick={() => {
        try {
          if (creating) {
            allocateToNewProperty(items, item.id, newName, 'preview', receiptIsRent, confirmSeparateExpenses)
            onAllocateNew(item.id, newName.trim(), receiptIsRent, confirmSeparateExpenses)
          } else {
            allocateProperty(items, item.id, targetId, receiptIsRent, confirmSeparateExpenses)
            onAllocate(item.id, targetId, receiptIsRent, confirmSeparateExpenses)
          }
          setError('')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }}>{creating ? 'Create property and assign' : 'Assign document figures and expenses'}</button>
      {error && <p role="alert" className="hint error">{error}</p>}
    </div>
  )
}

function PropertyExpenseReview({ item, expense, duplicateOf, onChange, onDelete, onDecided }: {
  item: PropertyLet; expense: PropertyExpenseEvidence; duplicateOf?: PropertyExpenseEvidence
  onChange: (patch: Partial<PropertyLet>) => void
  onDelete: () => void
  onDecided: (next: PropertyLet) => void
}) {
  const [amount, setAmount] = useState(String(expense.allowableAmount || expense.amount))
  const [error, setError] = useState('')
  const separatelyHandled = expense.treatment === 'interest' || expense.treatment === 'repayment'
  function apply(value: number) {
    try {
      const next = reviewPropertyExpense(item, expense.id, value)
      onChange({ allowableExpenses: next.allowableExpenses, expenseEvidence: next.expenseEvidence,
        expenseReconciliation: next.expenseReconciliation, documentVerified: false })
      onDecided(next)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <tr className={`property-expense ${expense.treatment === 'runningCost' ? '' : 'needs-review'}${duplicateOf ? ' possible-duplicate' : ''}${expense.amount === 0 ? ' zero-amount' : ''}`}>
      <td>{expense.date || <em>No date</em>}</td>
      <td>
        <strong>{expense.description}</strong>
        <small><SourceLink source={expense.source} row={expense.row} amount={expense.amount} /> · row {expense.row}</small>
        {duplicateOf && (
          <small className="duplicate-note">
            Possible duplicate of “{duplicateOf.description}” ({duplicateOf.date || 'no date'}, {duplicateOf.source}). Delete one if they are the same cost.
          </small>
        )}
        {expense.amount === 0 && (
          <small className="duplicate-note">No amount was recorded. Check the original document, or delete the row if it isn’t a cost.</small>
        )}
        <details><summary>Why / what to check</summary><p className="hint">{expense.reason}</p></details>
      </td>
      <td className="expense-money">{money(expense.amount)}</td>
      <td className="expense-money">{money(expense.allowableAmount)}</td>
      <td>
        <strong>{expense.treatment === 'interest' ? 'Interest — relieved separately'
          : expense.treatment === 'repayment' ? item.interestOnlyMortgage ? 'Interest-only payment — relieved separately' : 'Repayment — excluded'
            : expense.allowableAmount > 0 ? 'Included — check business use' : 'Not included — review'}</strong>
        {(expense.treatment === 'interest' || (expense.treatment === 'repayment' && item.interestOnlyMortgage)) &&
          <small>Included in the annual interest amount above; £0 here avoids deducting it twice.</small>}
        {expense.treatment === 'review' && <small>Check allowability / business portion</small>}
      </td>
      <td>
      {!separatelyHandled && (
        <div className="expense-actions">
          <label className="field small">
            <span>Allowable business amount (£)</span>
            <input type="number" min="0" max={expense.amount} step="0.01" value={amount}
              onChange={(event) => setAmount(event.target.value)} />
          </label>
          <button type="button" className="ghost-btn" onClick={() => {
            if (!amount.trim()) { setError('Enter an allowable business amount, or choose Exclude.'); return }
            apply(Number(amount))
          }}>Apply allowable amount</button>
          <button type="button" className="ghost-btn" onClick={() => apply(0)}>Exclude</button>
        </div>
      )}
      {separatelyHandled && (
        <span className="hint">{expense.treatment === 'interest' || item.interestOnlyMortgage
          ? 'Recorded in the annual interest amount above.'
          : 'Mortgage principal repayments are not running expenses.'}</span>
      )}
      {error && <p className="hint error" role="alert">{error}</p>}
      <button type="button" className="ghost-btn delete-expense-btn" onClick={onDelete}
        aria-label={`Delete ${expense.description} £${money(expense.amount)}`}>Delete row</button>
      </td>
    </tr>
  )
}

function BankReferenceMove({ item, items, index, onMove }: {
  item: PropertyLet; items: PropertyLet[]; index: number
  onMove: (sourceId: string, targetId: string, index: number) => void
}) {
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState('')
  const assigning = item.name.startsWith('Unallocated')
  return (
    <div className="entry-row">
      <label className="field small">
        <span>{assigning ? 'Assign' : 'Move'} {item.bankEvidence?.[index]?.label} bank reference to</span>
        <select value={targetId} onChange={(event) => { setTargetId(event.target.value); setError('') }}>
          <option value="">Choose a named property</option>
          {items.filter((candidate) => candidate.id !== item.id && !candidate.name.startsWith('Unallocated'))
            .map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || 'Unnamed property'}</option>)}
        </select>
      </label>
      <button type="button" className="ghost-btn" disabled={!targetId} onClick={() => {
        try {
          moveBankReference(items, item.id, targetId, index)
          onMove(item.id, targetId, index)
          setTargetId('')
          setError('')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }}>{assigning ? 'Assign bank reference only' : 'Move bank reference only'}</button>
      {error && <p className="hint error" role="alert">{error}</p>}
    </div>
  )
}

export function PropertySection({ items, m, onAllocate, onAllocateNew, onMoveBank, onRemoveRentalIncome, onRemoveExpenses }: {
  items: PropertyLet[]; m: Mutators<PropertyLet>
  onAllocate: (sourceId: string, targetId: string, receiptIsRent: boolean, confirmSeparateExpenses: boolean) => void
  onMoveBank: (sourceId: string, targetId: string, index: number) => void
  onRemoveRentalIncome: (propertyId: string, evidenceIds: string[]) => void
  onAllocateNew: (sourceId: string, name: string, receiptIsRent: boolean, confirmSeparateExpenses: boolean) => void
  onRemoveExpenses: (propertyId: string, expenseIds: string[], label: string) => void
}) {
  const update = (id: string, patch: Partial<PropertyLet>) => m.update(id, { ...patch, documentVerified: false })
  const unallocatedCount = items.filter((item) => item.name.startsWith('Unallocated')).length
  /** After a cost is decided, similar costs in the same property, offered for the same decision. All start ticked. */
  const [expensePrompt, setExpensePrompt] = useState<{
    propertyId: string; decidedId: string; label: string; decision: string; ids: string[]; unticked: Record<string, boolean>
  } | null>(null)
  function offerSimilarExpenses(next: PropertyLet, expense: PropertyExpenseEvidence) {
    const similar = similarExpenseDecisions(next, expense.id)
    const decided = next.expenseEvidence?.find((entry) => entry.id === expense.id)
    const share = decided && decided.amount > 0 ? decided.allowableAmount / decided.amount : 0
    setExpensePrompt(similar.length ? {
      propertyId: next.id, decidedId: expense.id, label: expense.description,
      decision: share === 0 ? 'exclude' : share === 1 ? 'include all of' : `include ${Math.round(share * 1000) / 10}% of`,
      ids: similar.map(({ expense: row }) => row.id), unticked: {},
    } : null)
  }
  function renderExpensePrompt(p: PropertyLet) {
    if (expensePrompt?.propertyId !== p.id) return null
    // Recomputed from the current rows, so anything decided individually in the meantime drops out.
    const offered = similarExpenseDecisions(p, expensePrompt.decidedId)
      .filter(({ expense }) => expensePrompt.ids.includes(expense.id))
    if (!offered.length) return null
    const chosen = offered.filter(({ expense }) => !expensePrompt.unticked[expense.id])
    return (
      <div className="similar-prompt" role="region" aria-label="Similar costs">
        <h4>Treat similar costs the same way?</h4>
        <p className="hint">
          You chose to {expensePrompt.decision} “{expensePrompt.label}”. {offered.length} more
          cost{offered.length === 1 ? ' looks' : 's look'} like it. Untick any that should be treated differently.
        </p>
        <ul className="similar-list">{offered.map(({ expense, allowableAmount }) => (
          <li key={expense.id}>
            <label className="field checkbox">
              <input type="checkbox" checked={!expensePrompt.unticked[expense.id]}
                onChange={(event) => setExpensePrompt({
                  ...expensePrompt, unticked: { ...expensePrompt.unticked, [expense.id]: !event.target.checked },
                })} />
              <span><strong>{expense.description}</strong> — {expense.date || 'no date'}, £{money(expense.amount)}
                {' '}(allowable £{money(expense.allowableAmount)} → £{money(allowableAmount)})</span>
            </label>
          </li>
        ))}</ul>
        <div className="document-actions">
          <button type="button" className="add-btn" disabled={!chosen.length} onClick={() => {
            const next = applyExpenseDecisions(p, chosen.map(({ expense, allowableAmount }) => ({ id: expense.id, allowableAmount })))
            update(p.id, { allowableExpenses: next.allowableExpenses, expenseEvidence: next.expenseEvidence,
              expenseReconciliation: next.expenseReconciliation })
            setExpensePrompt(null)
          }}>Apply to {chosen.length}</button>
          <button type="button" className="ghost-btn" onClick={() => setExpensePrompt(null)}>No thanks</button>
        </div>
      </div>
    )
  }
  return (
    <div className="card">
      <h2>Land and property</h2>
      <p className="hint">
        Enter allowable expenses <em>excluding</em> mortgage/finance interest — that's relieved separately as a
        20% tax reducer below, not deducted from income.
      </p>
      {!!unallocatedCount && (
        <aside className="unallocated-evidence-help" role="note">
          <strong>{unallocatedCount} unallocated evidence record{unallocatedCount === 1 ? '' : 's'} — not additional properties</strong>
          <p>
            Unallocated figures are excluded from the tax calculation. Review rent receipt-by-receipt in Documents;
            bank repayments do not tell you the annual mortgage interest. Use the individual reference controls below
            only to attach a bank reference to a named property.
          </p>
        </aside>
      )}
      {items.map((p) => (
        <section className={`entry-block property-entry ${p.name.startsWith('Unallocated') ? 'property-unallocated' : ''}`}
          aria-labelledby={`property-heading-${p.id}`} key={p.id}>
          <header className="property-entry-header">
            <span className="property-entry-label">{p.name.startsWith('Unallocated')
              ? 'Unallocated bank/document evidence — not a property' : 'Property'}</span>
            <h3 id={`property-heading-${p.id}`}>{p.name || 'New property'}</h3>
            <p>{p.name.startsWith('Unallocated')
              ? 'This is a holding record for evidence that has not been matched to a named property. Nothing here is included in the tax calculation.'
              : 'All figures, evidence and controls inside this bordered section relate only to this property.'}</p>
          </header>
          {p.name.startsWith('Unallocated') ? (
            <div className="unallocated-evidence-summary" role="note">
              <strong>Tax calculation status: excluded until assigned</strong>
              {!!p.rentalIncome && <p>Old unallocated rental total: £{money(p.rentalIncome)}. Use Documents to review its individual incoming receipts and match them to a property.</p>}
              {!!p.allowableExpenses && <p>Unassigned expense total: £{money(p.allowableExpenses)}. It is not claimed for any property yet.</p>}
              {!!p.mortgageInterest && <p>Unassigned annual-interest figure: £{money(p.mortgageInterest)}. Confirm it against the lender’s annual interest statement before assigning.</p>}
              <RemoveButton onClick={() => m.remove(p.id)} />
            </div>
          ) : (
            <>
              <h4 className="property-subheading">Property details and tax totals</h4>
              <div className="entry-row">
                <TextField label="Property" value={p.name} onChange={(v) => update(p.id, { name: v })} />
                <NumField
                  label="Your ownership share (0–1)"
                  value={p.ownershipShare}
                  min={0} max={1} step={0.5}
                  onChange={(v) => update(p.id, { ownershipShare: v })}
                />
                <RemoveButton onClick={() => m.remove(p.id)} />
              </div>
              <div className="entry-row">
                <NumField label="Rental income (£)" value={p.rentalIncome} onChange={(v) => update(p.id, { rentalIncome: v })}
                  help={<PropertyRentalFigureHelp item={p} />} />
                {p.expenseEvidence ? <div className="field small">
                  <span className="field-label-row">
                    <span>Allowable expenses from included document rows (£)</span>
                    <FigureHelp><PropertyExpensesFigureHelp item={p} /></FigureHelp>
                  </span>
                  <output>{money(evidencedPropertyExpenses(p))}</output>
                </div> : <NumField
                  label="Allowable expenses excl. interest (£)"
                  value={p.allowableExpenses}
                  onChange={(v) => update(p.id, { allowableExpenses: v })}
                  help={<PropertyExpensesFigureHelp item={p} />}
                />}
                {p.interestOnlyMortgage && mortgagePayments(p).source !== 'none' ? <div className="field small">
                  <span className="field-label-row">
                    <span>Annual mortgage/finance interest for this property (£)</span>
                    <FigureHelp><PropertyInterestFigureHelp item={p} /></FigureHelp>
                  </span>
                  <output>{money(p.mortgageInterest)}</output>
                </div> : <NumField
                  label="Annual mortgage/finance interest for this property (£)"
                  value={p.mortgageInterest}
                  onChange={(v) => update(p.id, { mortgageInterest: v })}
                  help={<PropertyInterestFigureHelp item={p} />}
                />}
              </div>
              <InterestOnlyMortgageField item={p} onChange={(patch) => update(p.id, patch)} />
            </>
          )}
          {!p.name.startsWith('Unallocated') && p.expenseEvidence?.some((expense) => expense.treatment === 'interest') && (
            <p className="hint property-interest-note">
              Interest rows are listed below as evidence. Their running-expense amount is £0 because the interest is
              recorded separately in the annual interest field above.
            </p>
          )}
          {p.documentSources && (
            <>
              <h4 className="property-subheading">{p.name.startsWith('Unallocated') ? 'Source file details' : 'Source evidence and verification'}</h4>
              <p className="hint">{p.documentNote}</p>
              {!p.name.startsWith('Unallocated') && <label className="field checkbox">
                <input type="checkbox" checked={p.documentVerified ?? false}
                  onChange={(event) => m.update(p.id, { documentVerified: event.target.checked })} />
                <span>Auto-populated property figures: {p.documentVerified ? 'verified' : 'check ownership, missing amounts, allocation and allowable costs'}</span>
              </label>}
            </>
          )}
          {!!p.rentalIncomeEvidence?.length && (
            <>
              <h4 className="property-subheading">Rental-income sources — {p.name}</h4>
              <details>
                <summary>{p.rentalIncomeEvidence.length} reconciled receipt{p.rentalIncomeEvidence.length === 1 ? '' : 's'}</summary>
                <p className="hint">
                  Matched to the wrong property? Remove receipts here: amounts they added are taken off this property’s
                  rental income, and the receipts reappear in Documents → Potential rental income sources to match again.
                </p>
                <button type="button" className="ghost-btn" onClick={() => {
                  if (window.confirm(`Remove all ${p.rentalIncomeEvidence!.length} matched receipts from ${p.name}? Amounts they added will be taken off its rental income.`)) {
                    onRemoveRentalIncome(p.id, p.rentalIncomeEvidence!.map((evidence) => evidence.id))
                  }
                }}>Remove all matched receipts</button>
                <ul>{p.rentalIncomeEvidence.map((evidence) => (
                  <li key={evidence.id}>
                    {evidence.date} — {evidence.description} — £{money(evidence.amount)} ({evidence.treatment === 'added'
                      ? 'added to rental income' : 'already included in rental income'})
                    {evidence.basis === 'unclassifiedIncome' ? ' · identified as unclassified income' : ''}
                    {' '}· {evidence.source}
                    {' '}<button type="button" className="remove-btn" aria-label={`Remove receipt ${evidence.date} £${money(evidence.amount)}`}
                      onClick={() => onRemoveRentalIncome(p.id, [evidence.id])}>Remove</button>
                  </li>
                ))}</ul>
              </details>
            </>
          )}
          {!!p.bankEvidence?.length && <h4 className="property-subheading">
            {p.name.startsWith('Unallocated') ? 'Unassigned bank references — not tax amounts' : `Bank references — ${p.name}`}
          </h4>}
          {p.bankEvidence?.map((evidence, index) => (
            <div className="property-bank-reference" key={`${evidence.label}-${index}`}>
            <p className="hint" key={`${evidence.label}-${index}`}>
              {evidence.label} — bank incoming: £{money(evidence.incoming)}; outgoing: £{money(evidence.outgoing)}.
              {' '}{evidence.kind === 'mortgage'
                ? p.name.startsWith('Unallocated')
                  ? 'Unassigned lender-related payment reference only. The outgoing amount is not mortgage interest and is not included in tax. Use the lender’s annual statement for interest.'
                  : p.interestOnlyMortgage
                    ? mortgagePayments(p).source === 'bank'
                      ? 'Interest-only mortgage: the outgoing payments are counted as the annual interest above.'
                      : 'Interest-only mortgage: not counted, because the mortgage rows in the property documents record the same payments.'
                    : 'Lender reference only. The outgoing amount is not mortgage interest; use the lender’s annual statement for interest.'
                : p.name.startsWith('Unallocated')
                  ? 'Unassigned incoming reference only. It is not included as rent; review the individual receipt in Documents.'
                  : evidence.includedInRent ? 'Confirmed and included in rental income.'
                    : 'Possible rent receipt: review the incoming source in Documents before adding it to rental income.'}
            </p>
            <BankReferenceMove item={p} items={items} index={index} onMove={onMoveBank} />
            </div>
          ))}
          {!!p.expenseEvidence?.length && (
            <details className="property-expense-review" open>
              <summary>Expense breakdown for {p.name || 'this property'} — {p.expenseEvidence.length} recorded expenses</summary>
              <p className="hint">
                Highlighted costs are not assumed allowable. Confirm only the rental-business amount;
                check petrol/travel against journey records and avoid duplicate mileage claims.
                {p.name.startsWith('Unallocated')
                  ? ' These expenses are not included in the tax calculation until assigned to a named property.'
                  : ' The expense total above is calculated only from included document rows. Unexplained balances are excluded from the tax calculation.'}
              </p>
              {renderExpensePrompt(p)}
              <div className="expense-table-scroll">
              <table className="expense-table">
                <caption>Expense review for {p.name || 'Unnamed property'} — amounts before ownership apportionment</caption>
                <thead><tr>
                  <th scope="col">Date</th><th scope="col">Expense / source</th>
                  <th scope="col">Recorded (£)</th><th scope="col">Running expense (£)</th>
                  <th scope="col">Status</th><th scope="col">Your decision</th>
                </tr></thead>
                <tbody>
              {(() => {
                const duplicates = possibleDuplicateExpenses(p)
                return p.expenseEvidence.map((expense) => (
                  <PropertyExpenseReview key={`${expense.id}:${expense.allowableAmount}`}
                    item={p} expense={expense} duplicateOf={duplicates.get(expense.id)}
                    onChange={(patch) => m.update(p.id, patch)}
                    onDecided={(next) => offerSimilarExpenses(next, expense)}
                    onDelete={() => onRemoveExpenses(p.id, [expense.id],
                      `Deleted expense “${expense.description}” (£${money(expense.amount)}) from ${p.name || 'property'}`)} />
                ))
              })()}
                </tbody>
                <tfoot><tr>
                  <th scope="row" colSpan={2}>Listed totals</th>
                  <td className="expense-money">{money(p.expenseEvidence.reduce((sum, expense) => sum + expense.amount, 0))}</td>
                  <td className="expense-money">{money(p.expenseEvidence.reduce((sum, expense) => sum + expense.allowableAmount, 0))}</td>
                  <td colSpan={2}>Recorded totals include excluded costs and separate interest.</td>
                </tr></tfoot>
              </table>
              </div>
              <p className="hint">
                {p.name.startsWith('Unallocated') ? 'Unassigned expense total' : 'Property allowable-expense total'}: £{money(p.allowableExpenses)}.
              </p>
              {(() => {
                const files = [...new Set(p.expenseEvidence.map((expense) => expense.source.split(' / ')[0]))]
                return (
                  <div className="expense-file-actions">
                    <span className="hint">Rows by source file (e.g. remove a file you have renamed or replaced):</span>
                    {files.map((file) => {
                      const ids = p.expenseEvidence!.filter((expense) => expense.source.split(' / ')[0] === file).map((expense) => expense.id)
                      return (
                        <button type="button" className="ghost-btn" key={file} onClick={() => {
                          if (window.confirm(`Delete all ${ids.length} expense rows from ${file} in ${p.name || 'this property'}? You can undo this.`)) {
                            onRemoveExpenses(p.id, ids, `Deleted ${ids.length} expense row${ids.length === 1 ? '' : 's'} from ${file}`)
                          }
                        }}>Delete all {ids.length} from {file}</button>
                      )
                    })}
                  </div>
                )
              })()}
            </details>
          )}
          {!!p.expenseReconciliation && (
            <div className="expense-reconciliation-note" role="note">
              <strong>About the old £{money(p.expenseReconciliation)} expense total</strong>
              <p>
                This amount was saved on this property in an earlier version of the return. It was not found in
                itemised expense records, so it has been removed from the property expenses used in the tax calculation.
                It is not a bill or tax payment, and none of this old amount is currently included.
              </p>
              <p>
                If receipts or statements support some of these costs, include only the allowable amount in this
                property’s expense records above. Otherwise, leave it out; you do not need to subtract this figure elsewhere.
              </p>
            </div>
          )}
          {p.documentSources && p.name.startsWith('Unallocated') && (
            <div className="property-allocation-section">
              <h4 className="property-subheading">Assign document figures to a property</h4>
              <p className="hint">
                “Assign document figures and expenses” moves this record’s saved totals, expenses and bank references
                to the selected property. Any saved rent total requires your confirmation. If the property already has
                rental income, use Documents to decide whether receipts are additional or already included. The separate
                “Assign bank reference only” controls below move references without changing tax figures.
              </p>
              <PropertyAllocation item={p} items={items} onAllocate={onAllocate} onAllocateNew={onAllocateNew} />
            </div>
          )}
          {p.documentSources && !p.name.startsWith('Unallocated') && (
            <p className="hint">These figures belong to {p.name}. They are kept separate from other properties.
              Assign only unallocated bank receipts or mortgage evidence to this property.</p>
          )}
        </section>
      ))}
      <button
        type="button"
        className="add-btn"
        onClick={() => m.add({ id: uid(), name: '', ownershipShare: 1, rentalIncome: 0, allowableExpenses: 0, mortgageInterest: 0 })}
      >
        + Add property
      </button>
    </div>
  )
}

// ---- Savings / dividends / pensions / other --------------------------------------------------

function BankEvidence({ source, onVerify }: { source: BankSource; onVerify: (source: BankSource) => void }) {
  return (
    <div className="bank-income-evidence">
      <details><summary>Bank source: {source.fileName} — recorded £{money(source.recordedAmount)}</summary>
        <p className="hint">{source.evidence}</p></details>
      <label className="field checkbox">
        <input type="checkbox" checked={source.verified} onChange={(event) => onVerify({ ...source, verified: event.target.checked })} />
        <span>I have verified the amount and tax treatment; it is not duplicated in another entry/export</span>
      </label>
    </div>
  )
}

export function SavingsSection({ items, m }: { items: SavingsInterest[]; m: Mutators<SavingsInterest> }) {
  return (
    <div className="card">
      <h2>Interest received</h2>
      {items.map((s) => (
        <div className="entry-row" key={s.id}>
          <TextField label="Source" value={s.source} onChange={(v) => m.update(s.id, { source: v })} />
          <NumField label="Amount (£)" value={s.amount} onChange={(v) => m.update(s.id, { amount: v })} />
          <RemoveButton onClick={() => m.remove(s.id)} />
          {s.bankSource && <BankEvidence source={s.bankSource} onVerify={(bankSource) => m.update(s.id, { bankSource })} />}
        </div>
      ))}
      <button type="button" className="add-btn" onClick={() => m.add({ id: uid(), source: '', amount: 0 })}>
        + Add interest
      </button>
    </div>
  )
}

export function DividendSection({ items, m }: { items: DividendIncome[]; m: Mutators<DividendIncome> }) {
  return (
    <div className="card">
      <h2>Dividends</h2>
      {items.map((d) => (
        <div className="entry-row" key={d.id}>
          <TextField label="Source" value={d.source} onChange={(v) => m.update(d.id, { source: v })} />
          <NumField label="Amount (£)" value={d.amount} onChange={(v) => m.update(d.id, { amount: v })} />
          <RemoveButton onClick={() => m.remove(d.id)} />
          {d.bankSource && <BankEvidence source={d.bankSource} onVerify={(bankSource) => m.update(d.id, { bankSource })} />}
        </div>
      ))}
      <button type="button" className="add-btn" onClick={() => m.add({ id: uid(), source: '', amount: 0 })}>
        + Add dividend
      </button>
    </div>
  )
}

export function PensionSection({ items, m }: { items: PensionIncome[]; m: Mutators<PensionIncome> }) {
  return (
    <div className="card">
      <h2>Pensions received</h2>
      <p className="hint">Include State Pension here too — use the annual rate for the year.</p>
      {items.map((p) => (
        <div className="entry-row" key={p.id}>
          <TextField label="Source" value={p.source} onChange={(v) => m.update(p.id, { source: v })} />
          <NumField label="Amount (£)" value={p.amount} onChange={(v) => m.update(p.id, { amount: v })} />
          <NumField label="Tax deducted (£)" value={p.taxDeducted} onChange={(v) => m.update(p.id, { taxDeducted: v })} />
          <RemoveButton onClick={() => m.remove(p.id)} />
        </div>
      ))}
      <button type="button" className="add-btn" onClick={() => m.add({ id: uid(), source: '', amount: 0, taxDeducted: 0 })}>
        + Add pension
      </button>
    </div>
  )
}

function OtherBankReceipts({ entry, rentOwners, onChange, onRemove }: {
  entry: OtherIncome; rentOwners: Map<string, string>
  onChange: (patch: Partial<OtherIncome>) => void; onRemove: () => void
}) {
  const payers = otherIncomePayers(entry, rentOwners)
  const regularPayers = payers.filter((payer) => payer.receipts.length > 1)
  const oneOffPayers = payers.filter((payer) => payer.receipts.length === 1)
  const row = (payer: OtherIncomePayer) => (
    <div className={`suggestion-row${payer.regular ? ' rental-regular' : ''}`} key={payer.payer}>
      <div>
        <strong>{payer.label}</strong>
        {payer.regular && (
          <span className="evidence-badges">
            <span className="evidence-badge evidence-badge-recognised">
              Same amount, consecutive months: £{payer.regular.amount.toFixed(2)} × {payer.regular.months}
            </span>
          </span>
        )}
        <p className="hint">{payer.source} · Total: £{money(payer.total)}</p>
        <details>
          <summary>Review {payer.receipts.length} receipt{payer.receipts.length === 1 ? '' : 's'}</summary>
          <ul>{payer.receipts.map((receipt) => (
            <li key={receipt.id}>{receipt.date} — {receipt.description} — £{receipt.amount.toFixed(2)}
              {rentOwners.has(receipt.id) && ` (counted as rent for ${rentOwners.get(receipt.id)})`}</li>
          ))}</ul>
        </details>
      </div>
      <div className="suggestion-values">
        {payer.rentProperty && payer.receipts.every((receipt) => rentOwners.has(receipt.id))
          ? <p className="hint">Already counted as rent for {payer.rentProperty}.</p>
          : (
            <label className="field checkbox">
              <input type="checkbox" checked={payer.taxable}
                onChange={(event) => onChange({ receipts: setPayerTaxable(entry, payer.payer, event.target.checked) })} />
              <span>Taxable income</span>
            </label>
          )}
      </div>
    </div>
  )
  return (
    <section className="other-receipts">
      <div className="other-receipts-head">
        <h3>Money paid in{entry.bankSource ? ` — ${entry.bankSource.fileName}` : ''}</h3>
        <RemoveButton onClick={onRemove} />
      </div>
      <p className="hint">Payments into your account that we couldn’t identify, grouped by who paid. Tick only those
        that are taxable income, such as freelance or casual work. Leave gifts, transfers between your own accounts,
        refunds and loan repayments unticked.</p>
      {regularPayers.map(row)}
      {!!oneOffPayers.length && (
        <details className="one-off-rental" open={oneOffPayers.some((payer) => payer.taxable) || !regularPayers.length}>
          <summary>{oneOffPayers.length} one-off payment{oneOffPayers.length === 1 ? '' : 's'}</summary>
          {oneOffPayers.map(row)}
        </details>
      )}
      <p className="business-total">Counted as taxable: <strong>£{money(entry.amount)}</strong></p>
      {entry.bankSource && (
        <label className="field checkbox">
          <input type="checkbox" checked={entry.bankSource.verified}
            onChange={(event) => entry.bankSource && onChange({ bankSource: { ...entry.bankSource, verified: event.target.checked } })} />
          <span>I’ve checked all these payments</span>
        </label>
      )}
    </section>
  )
}

export function OtherIncomeSection({ items, m, properties }: {
  items: OtherIncome[]; m: Mutators<OtherIncome>; properties: PropertyLet[]
}) {
  const rentOwners = rentReceiptOwners(properties)
  return (
    <div className="card">
      <h2>Other income</h2>
      <p className="hint">Taxable income that doesn’t fit elsewhere, such as casual earnings, taxable benefits or trust income (R185).</p>
      {items.filter((o) => o.receipts?.length).map((o) => (
        <OtherBankReceipts key={o.id} entry={o} rentOwners={rentOwners}
          onChange={(patch) => m.update(o.id, patch)} onRemove={() => m.remove(o.id)} />
      ))}
      {items.filter((o) => !o.receipts?.length).map((o) => (
        <div className="entry-row" key={o.id}>
          <TextField label="Description" value={o.description} onChange={(v) => m.update(o.id, { description: v })} />
          <NumField label="Amount (£)" value={o.amount} onChange={(v) => m.update(o.id, { amount: v })} />
          <RemoveButton onClick={() => m.remove(o.id)} />
          {o.bankSource && (
            <div className="bank-income-evidence">
              <p className="hint">Recorded receipts: £{money(o.bankSource.recordedAmount)}. Initially excluded from tax (Amount £0).
                Confirm their purpose, then enter only taxable other income in Amount above. Do not include transfers, salary, rent, refunds or already-counted receipts.</p>
              <BankEvidence source={o.bankSource} onVerify={(bankSource) => m.update(o.id, { bankSource })} />
            </div>
          )}
        </div>
      ))}
      <button type="button" className="add-btn" onClick={() => m.add({ id: uid(), description: '', amount: 0 })}>
        + Add other income
      </button>
    </div>
  )
}

function BankReliefReview({ candidate, reliefs, onConfirm }: {
  candidate: BankReliefCandidate; reliefs: Reliefs
  onConfirm: (sourceId: string, amount: number) => void
}) {
  const [amount, setAmount] = useState(String(candidate.claimedAmount || candidate.source.recordedAmount))
  const [eligible, setEligible] = useState(false)
  const [error, setError] = useState('')
  function apply(value: number) {
    try {
      confirmBankRelief({ reliefs, bankReliefCandidates: [candidate] }, candidate.source.id, value)
      onConfirm(candidate.source.id, value)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return (
    <section className="property-expense needs-review">
      <h3>{candidate.kind === 'giftAid' ? 'Auto-populated charitable donations — Gift Aid to confirm' : 'Personal pension contribution candidate'} — £{money(candidate.source.recordedAmount)}</h3>
      <details><summary>View payments from {candidate.source.fileName}</summary><p className="hint">{candidate.source.evidence}</p></details>
      <p className="hint">Currently claimed: £{money(candidate.claimedAmount)}. Bank payments alone do not prove eligibility.</p>
      <label className="field checkbox"><input type="checkbox" checked={eligible} onChange={(event) => setEligible(event.target.checked)} />
        <span>{candidate.kind === 'giftAid'
          ? 'I confirm these donations qualify for Gift Aid, have a valid declaration and are not already claimed.'
          : 'I confirm these are my net personal relief-at-source contributions, not employer/payroll deductions or already claimed amounts.'}</span>
      </label>
      <label className="field small"><span>Qualifying net amount (£)</span><input type="number" min="0" max={candidate.source.recordedAmount}
        step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <button type="button" className="ghost-btn" disabled={!eligible || !amount.trim()} onClick={() => apply(Number(amount))}>Apply qualifying relief</button>
      <button type="button" className="ghost-btn" onClick={() => apply(0)}>Exclude / remove this claim</button>
      {error && <p role="alert" className="hint error">{error}</p>}
    </section>
  )
}

export function ReliefsSection({ reliefs, onChange, bankCandidates, onConfirmBank }: {
  reliefs: Reliefs; onChange: (patch: Partial<Reliefs>) => void
  bankCandidates?: BankReliefCandidate[]
  onConfirmBank: (sourceId: string, amount: number) => void
}) {
  return (
    <div className="card">
      <h2>Pension contributions &amp; Gift Aid</h2>
      <p className="hint">
        Enter the <em>net</em> amount you actually paid for relief-at-source pension contributions and Gift Aid
        donations — the workbook grosses these up at 20% automatically, matching what extends your rate bands.
      </p>
      <div className="entry-row">
        <NumField
          label="Pension contributions paid, net (£)"
          value={reliefs.personalPensionContributionsNet}
          onChange={(v) => onChange({ personalPensionContributionsNet: v })}
        />
        <div className="derived">
          gross: £{money(reliefs.personalPensionContributionsNet / 0.8)}
        </div>
        {bankCandidates?.filter((candidate) => candidate.kind === 'pensionContribution').map((candidate) => <BankReliefReview key={`${candidate.source.id}:${candidate.claimedAmount}`}
          candidate={candidate} reliefs={reliefs} onConfirm={onConfirmBank} />)}
      </div>
      <div className="entry-row">
        <NumField
          label="Gift Aid donations, net (£)"
          value={reliefs.giftAidNet}
          onChange={(v) => onChange({ giftAidNet: v })}
        />
        <div className="derived">
          gross: £{money(reliefs.giftAidNet / 0.8)}
        </div>
        {bankCandidates?.filter((candidate) => candidate.kind === 'giftAid').map((candidate) => <BankReliefReview key={`${candidate.source.id}:${candidate.claimedAmount}`}
          candidate={candidate} reliefs={reliefs} onConfirm={onConfirmBank} />)}
      </div>
    </div>
  )
}
