import type { PropertyLet } from '../types'

export function removeBankExpenses(items: PropertyLet[]): PropertyLet[] {
  return items.map((item) => {
    const bankNotes = (item.documentNote ?? '').split('\n').filter((note) =>
      /explicitly labelled rent receipts|bank evidence in/.test(note) && !note.includes('Supplier/amount rows'))
    const bankRows = (item.expenseEvidence ?? []).filter((expense) => {
      const separator = expense.source.lastIndexOf(' / ')
      if (separator < 0) return false
      const file = expense.source.slice(0, separator)
      const sheet = expense.source.slice(separator + 3)
      return bankNotes.some((note) => note.startsWith(`${file}: ${sheet}:`))
    })
    if (!bankRows.length) {
      if (!item.expenseEvidence && bankNotes.some((note) => /[1-9]\d* possible running costs|[1-9]\d* explicit interest payments/.test(note)) &&
        !item.documentNote?.includes('Legacy bank totals need manual reconciliation')) {
        return {
          ...item, documentVerified: false, allowableExpenses: 0,
          expenseReconciliation: (item.expenseReconciliation ?? 0) + item.allowableExpenses,
          documentNote: `${item.documentNote ?? ''}\nLegacy bank totals need manual reconciliation: this older entry has no expense-row breakdown. Its unsupported running-expense total is excluded; verify and restore only costs evidenced in property documents. Check interest separately.`,
        }
      }
      return item
    }
    const runningCosts = bankRows.reduce((sum, expense) => sum + expense.allowableAmount, 0)
    const interest = bankRows.filter((expense) => expense.treatment === 'interest')
      .reduce((sum, expense) => sum + expense.amount, 0)
    const canReconcile = item.allowableExpenses >= runningCosts && item.mortgageInterest >= interest
    const removedIds = new Set(bankRows.map((expense) => expense.id))
    return {
      ...item,
      allowableExpenses: canReconcile ? Math.round((item.allowableExpenses - runningCosts) * 100) / 100 : item.allowableExpenses,
      mortgageInterest: canReconcile ? Math.round((item.mortgageInterest - interest) * 100) / 100 : item.mortgageInterest,
      expenseEvidence: item.expenseEvidence?.filter((expense) => !removedIds.has(expense.id)),
      documentVerified: false,
      documentNote: `${item.documentNote ?? ''}\n${canReconcile
        ? 'Previously imported bank expense rows removed from expense/interest totals; rental spreadsheet rows, rent and mortgage reference totals retained.'
        : 'Bank expense rows removed from review, but manually changed totals could not be reconciled safely. Check allowable expenses and interest manually; bank expenses must not be counted.'}`,
    }
  })
}
