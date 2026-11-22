export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim().replace(/\s*(CR|DR)$/i, (_, direction: string) => direction.toUpperCase() === 'DR' ? '-' : '')
  if (!text) return null
  const negative = /^\s*\(.*\)\s*$/.test(text) || /^\s*-/.test(text)
  const digits = text.replace(/[£,\s()]/g, '').replace(/^[+-]/, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(digits)) return null
  const amount = Number(digits)
  return Number.isFinite(amount) ? (negative ? -amount : amount) : null
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(1899, 11, 30 + Math.floor(value))
  }
  const text = String(value ?? '').trim()
  if (!text) return null
  const uk = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (uk) {
    const year = Number(uk[3].length === 2 ? `20${uk[3]}` : uk[3])
    const date = new Date(year, Number(uk[2]) - 1, Number(uk[1]))
    return date.getFullYear() === year && date.getMonth() === Number(uk[2]) - 1 && date.getDate() === Number(uk[1]) ? date : null
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return date.getFullYear() === Number(iso[1]) && date.getMonth() === Number(iso[2]) - 1 && date.getDate() === Number(iso[3]) ? date : null
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isInTaxYear(date: Date, taxYearId: string): boolean {
  const startYear = Number(taxYearId.slice(0, 4))
  if (!Number.isFinite(startYear)) return true
  const start = new Date(startYear, 3, 6)
  const end = new Date(startYear + 1, 3, 6)
  return date >= start && date < end
}
