export interface PayslipTotals {
  grossPay?: number
  taxPaid?: number
  niPaid?: number
  pensionPaid?: number
}

export interface PayslipFigures {
  weekly: PayslipTotals
  yearToDate: PayslipTotals
}

const labels: { pattern: string; basis: keyof PayslipFigures; field: keyof PayslipTotals }[] = [
  { pattern: 'gross\\s+pay\\s+this\\s+week', basis: 'weekly', field: 'grossPay' },
  { pattern: 'tax\\s+this\\s+week', basis: 'weekly', field: 'taxPaid' },
  { pattern: 'ni\\s+this\\s+week', basis: 'weekly', field: 'niPaid' },
  { pattern: 'nest\\s+pension', basis: 'weekly', field: 'pensionPaid' },
  { pattern: 'gross\\s+to\\s+date', basis: 'yearToDate', field: 'grossPay' },
  { pattern: 'tax\\s+to\\s+date', basis: 'yearToDate', field: 'taxPaid' },
  { pattern: 'ni\\s+to\\s+date', basis: 'yearToDate', field: 'niPaid' },
]

export function parseWeeklyPayslip(text: string): PayslipFigures | null {
  const expression = new RegExp(labels.map((label) => `(${label.pattern})`).join('|'), 'gi')
  const matches = [...text.matchAll(expression)]
  if (!matches.some((match) => /gross\s+pay\s+this\s+week|tax\s+this\s+week/i.test(match[0]))) return null
  const result: PayslipFigures = { weekly: {}, yearToDate: {} }
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const label = labels[match.slice(1).findIndex((group) => group !== undefined)]
    const end = matches[index + 1]?.index ?? text.length
    const following = text.slice((match.index ?? 0) + match[0].length, end)
    // Only accept an adjacent amount, never search past another heading or a date.
    const amount = following.match(/^\s*[:£]?\s*(-?\d[\d,]*\.\d{2})(?!\d)/)
    if (amount && !/^\s+£?\s*-?\d/.test(following.slice(amount[0].length))) {
      const value = Number(amount[1].replace(/,/g, ''))
      const existing = result[label.basis][label.field]
      if (existing !== undefined && existing !== value) {
        delete result[label.basis][label.field]
        return result
      }
      result[label.basis][label.field] = value
    }
  }
  return result
}
