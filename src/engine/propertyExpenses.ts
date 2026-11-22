import type { PropertyLet } from '../types'

export function evidencedPropertyExpenses(item: PropertyLet): number {
  if (!item.expenseEvidence) return item.allowableExpenses
  return Math.round(item.expenseEvidence.reduce((sum, expense) =>
    sum + (expense.treatment === 'interest' || expense.treatment === 'repayment' ? 0 : expense.allowableAmount), 0) * 100) / 100
}

export interface MortgagePayments {
  total: number
  source: 'ledger' | 'bank' | 'none'
  count: number
}

/** Mortgage payments recorded for a property. Ledger rows take precedence over bank references
 *  because both usually record the same payments, and counting both would double the interest. */
export function mortgagePayments(item: PropertyLet): MortgagePayments {
  const rows = (item.expenseEvidence ?? []).filter((expense) => expense.treatment === 'interest' || expense.treatment === 'repayment')
  if (rows.length) {
    return { total: Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100, source: 'ledger', count: rows.length }
  }
  const references = (item.bankEvidence ?? []).filter((evidence) => evidence.kind === 'mortgage' && evidence.outgoing > 0)
  if (references.length) {
    return { total: Math.round(references.reduce((sum, evidence) => sum + evidence.outgoing, 0) * 100) / 100, source: 'bank', count: references.length }
  }
  return { total: 0, source: 'none', count: 0 }
}

/** Interest shown by explicitly interest-labelled rows; the figure to fall back to when interest-only is unticked. */
export function labelledInterest(item: PropertyLet): number {
  return Math.round((item.expenseEvidence ?? []).filter((expense) => expense.treatment === 'interest')
    .reduce((sum, expense) => sum + expense.amount, 0) * 100) / 100
}

/** On an interest-only mortgage every payment is interest, so the annual interest equals the payments made. */
export function syncInterestOnlyMortgage(item: PropertyLet): PropertyLet {
  if (!item.interestOnlyMortgage) return item
  const payments = mortgagePayments(item)
  if (payments.source === 'none' || payments.total === item.mortgageInterest) return item
  return { ...item, mortgageInterest: payments.total }
}

export function reconcilePropertyExpenses(item: PropertyLet): PropertyLet {
  if (!item.expenseEvidence) return item
  const evidenced = evidencedPropertyExpenses(item)
  const difference = Math.round((item.allowableExpenses - evidenced) * 100) / 100
  if (!difference) return item
  return {
    ...item, allowableExpenses: evidenced, documentVerified: false,
    expenseReconciliation: Math.round(((item.expenseReconciliation ?? 0) + difference) * 100) / 100,
  }
}
