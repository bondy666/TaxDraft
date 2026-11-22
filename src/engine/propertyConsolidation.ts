import type { PropertyLet, PropertyExpenseEvidence } from '../types'
import { reconcilePropertyExpenses } from './propertyExpenses.ts'

function expenseKey(expense: PropertyExpenseEvidence): string {
  return `${expense.date}|${expense.description.trim().toLowerCase()}|${expense.amount}|${expense.row}|${expense.source}`
}

export function consolidateProperties(items: PropertyLet[]): PropertyLet[] {
  const result: PropertyLet[] = []
  for (const item of items) {
    const name = item.name.trim().toLowerCase()
    const index = name ? result.findIndex((entry) => entry.name.trim().toLowerCase() === name) : -1
    if (index < 0) { result.push(item); continue }
    const target = result[index]
    const evidence = [...target.expenseEvidence ?? []]
    let overlap = false
    let conflict = false
    for (const expense of item.expenseEvidence ?? []) {
      const existing = evidence.find((entry) => entry.id === expense.id || expenseKey(entry) === expenseKey(expense))
      if (existing) {
        overlap = true
        if (existing.allowableAmount !== expense.allowableAmount) conflict = true
      } else evidence.push(expense)
    }
    const total = (entry: PropertyLet) => Math.round((entry.expenseEvidence ?? []).reduce((sum, expense) => sum + expense.allowableAmount, 0) * 100)
    const documented = (entry: PropertyLet) => !!entry.expenseEvidence?.length && total(entry) === Math.round(entry.allowableExpenses * 100)
    const sharedSource = target.documentSources?.some((source) => item.documentSources?.includes(source))
    let allowableExpenses = Math.max(target.allowableExpenses, item.allowableExpenses)
    if (documented(target) && documented(item) && !conflict) {
      allowableExpenses = Math.round(evidence.reduce((sum, expense) => sum + expense.allowableAmount, 0) * 100) / 100
    } else if (target.allowableExpenses > 0 && item.allowableExpenses > 0 &&
      (target.allowableExpenses !== item.allowableExpenses || (!sharedSource && !overlap))) conflict = true
    for (const field of ['rentalIncome', 'mortgageInterest'] as const) {
      if (target[field] > 0 && item[field] > 0 && target[field] !== item[field]) conflict = true
    }
    if (target.ownershipShare !== item.ownershipShare) conflict = true
    const bankEvidence = [...target.bankEvidence ?? []]
    for (const bank of item.bankEvidence ?? []) {
      if (!bankEvidence.some((entry) => JSON.stringify(entry) === JSON.stringify(bank))) bankEvidence.push(bank)
    }
    result[index] = {
      ...target, allowableExpenses,
      rentalIncome: Math.max(target.rentalIncome, item.rentalIncome),
      mortgageInterest: Math.max(target.mortgageInterest, item.mortgageInterest),
      expenseEvidence: target.expenseEvidence || item.expenseEvidence ? evidence : undefined,
      expenseReconciliation: (target.expenseReconciliation ?? 0) + (item.expenseReconciliation ?? 0),
      bankEvidence,
      documentSources: [...new Set([...target.documentSources ?? [], ...item.documentSources ?? []])],
      documentVerified: false,
      documentNote: [...new Set([target.documentNote, item.documentNote,
        conflict ? 'RECONCILE: same-name property entries had conflicting amounts or ownership. Conflicting totals were not added together; the larger total was retained and the original source notes preserved. Check this card against the documents before relying on the calculation.' : undefined,
      ].filter((note): note is string => !!note))].join('\n'),
    }
  }
  return result.map(reconcilePropertyExpenses)
}
