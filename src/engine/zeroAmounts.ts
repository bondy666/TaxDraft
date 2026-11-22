import type { TaxReturnData } from '../types'
import type { ReviewItem } from './reviewChecklist'

const money = (amount: number) => `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Zero amounts that look like a mistake: a cost, receipt or certificate that should have a value but doesn't. Zeros
 * that are expected (other income nothing has been ticked for yet, an excluded cost) are not listed. These rows are
 * left out of the exported spreadsheet, so they are highlighted here instead of disappearing silently.
 */
export function unexpectedZeroAmounts(data: TaxReturnData): ReviewItem[] {
  const items: ReviewItem[] = []
  const add = (id: string, severity: ReviewItem['severity'], title: string, detail: string) =>
    items.push({ id: `zero-${id}`, severity, title, detail, tab: 'Income' })

  data.employments.forEach((employment) => {
    if (employment.p60Pay !== 0) return
    const name = employment.employer || 'An employment'
    add(`employment-${employment.id}`, employment.p60Source || employment.taxDeducted ? 'action' : 'check',
      `No pay entered for ${name}`,
      employment.taxDeducted
        ? `Tax of ${money(employment.taxDeducted)} is entered but pay is £0. Enter the pay from the P60.`
        : 'Pay is £0. Enter the pay from the P60, or remove the entry if you didn’t work there this year.')
  })

  data.properties.forEach((property) => {
    const name = property.name || 'a property'
    const unallocated = property.name.startsWith('Unallocated')
    const zeroCosts = (property.expenseEvidence ?? []).filter((expense) => expense.amount === 0)
    if (zeroCosts.length) {
      add(`expenses-${property.id}`, 'action', `${zeroCosts.length} cost${zeroCosts.length === 1 ? '' : 's'} with no amount — ${name}`,
        `${zeroCosts.map((expense) => `“${expense.description}”${expense.date ? ` (${expense.date})` : ''}`).join(', ')}. ` +
        'Check the original document; the amount may not have been read. Delete the row if it isn’t a cost.')
    }
    const emptyReferences = (property.bankEvidence ?? []).filter((evidence) => !evidence.incoming && !evidence.outgoing)
    if (emptyReferences.length) {
      add(`bank-${property.id}`, 'check', `Bank reference with no money in or out — ${name}`,
        `${emptyReferences.map((evidence) => evidence.label).join(', ')}. Check the bank statement, or remove the reference.`)
    }
    const zeroReceipts = (property.rentalIncomeEvidence ?? []).filter((evidence) => evidence.amount === 0)
    if (zeroReceipts.length) {
      add(`receipts-${property.id}`, 'action', `Rent receipt of £0 — ${name}`,
        `${zeroReceipts.map((evidence) => `“${evidence.description}” (${evidence.date})`).join(', ')}. Check the bank statement.`)
    }
    const hasCosts = property.allowableExpenses > 0 || property.mortgageInterest > 0 || !!property.expenseEvidence?.length
    if (!unallocated && property.rentalIncome === 0 && hasCosts) {
      add(`rent-${property.id}`, 'check', `No rent recorded for ${name}`,
        'Costs are entered but rent is £0. If it was let, match its rent in Documents or enter it in Income. ' +
        'If it was empty all year, you can ignore this.')
    }
  })

  const simple = [
    ...data.savings.map((item) => ({ item, kind: 'interest', label: item.source || 'Interest' })),
    ...data.dividends.map((item) => ({ item, kind: 'dividend', label: item.source || 'Dividend' })),
  ]
  for (const { item, kind, label } of simple) {
    if (item.amount !== 0) continue
    add(`${kind}-${item.id}`, 'check', `${kind === 'interest' ? 'Interest' : 'Dividend'} of £0 — ${label}`,
      item.bankSource?.recordedAmount
        ? `Your bank statement shows ${money(item.bankSource.recordedAmount)} but £0 is entered. Check which is right.`
        : 'No amount is entered. Enter it, or remove the entry if there wasn’t any.')
  }

  data.pensions.forEach((pension) => {
    if (pension.amount === 0) {
      add(`pension-${pension.id}`, pension.taxDeducted ? 'action' : 'check', `Pension of £0 — ${pension.source || 'Pension'}`,
        'No amount is entered. Enter the yearly amount, or remove the entry.')
    }
  })

  data.other.forEach((entry) => {
    // Bank receipts start at £0 until payers are ticked as taxable; that is expected.
    if (entry.amount === 0 && !entry.bankSource && !entry.receipts?.length) {
      add(`other-${entry.id}`, 'check', `Other income of £0 — ${entry.description || 'Other income'}`,
        'No amount is entered. Enter it, or remove the entry.')
    }
  })

  for (const invoice of data.business?.invoices ?? []) {
    if (invoice.amount === 0 && invoice.sourceHash) {
      items.push({ id: `business-zero-${invoice.id}`, severity: 'action', tab: 'Income',
        title: `No total read from ${invoice.source}`, detail: 'Enter the amount from the invoice, or remove it.' })
    }
  }
  return items
}
