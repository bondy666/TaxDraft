export interface PdfWord {
  str: string
  transform: number[]
}

export function extractP60(words: PdfWord[]) {
  const text = words.map((word) => word.str).join(' ')
  if (!/\bP60\b/i.test(text)) return null
  const payHeader = words.find((word) => word.str.trim() === 'Pay')
  const taxHeader = words.find((word) => /^Tax deducted$/i.test(word.str.trim()))
  const row = words.find((word) => /^In this(?: employment)?$/i.test(word.str.trim()))
  const year = text.match(/Tax year to 5 April\s+(\d{4})/i)?.[1]
  if (!payHeader || !taxHeader || !row || !year) return null
  const payX = payHeader.transform[4]
  const taxX = taxHeader.transform[4]
  const rowY = row.transform[5]
  const numbers = words.filter((word) =>
    Math.abs(word.transform[5] - rowY) <= 9 && /^\d[\d,]*(?:\.\d{2})?$/.test(word.str.trim()),
  )
  function amount(left: number, right: number): number | undefined {
    const values = numbers.filter((word) => word.transform[4] >= left && word.transform[4] < right)
      .sort((a, b) => a.transform[4] - b.transform[4])
    if (values.length === 1 && /\.\d{2}$/.test(values[0].str)) return Number(values[0].str.replace(/,/g, ''))
    if (values.length === 2 && /^\d{2}$/.test(values[1].str) && !values[0].str.includes('.')) {
      return Number(`${values[0].str.replace(/,/g, '')}.${values[1].str}`)
    }
    return undefined
  }
  const pay = amount(payX, taxX)
  const tax = amount(taxX, taxX + (taxX - payX))
  if (pay === undefined || tax === undefined) return null
  const endYear = Number(year)
  const employerLabel = words.find((word) => /Your employer's full name and address/i.test(word.str))
  const employerWords = employerLabel ? words.filter((word) =>
    word.str.trim() && word.transform[4] >= employerLabel.transform[4] &&
    word.transform[5] < employerLabel.transform[5] - 2 &&
    word.transform[5] >= employerLabel.transform[5] - 25,
  ).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]) : []
  const employer = employerWords.filter((word) => Math.abs(word.transform[5] - employerWords[0].transform[5]) <= 2)
    .map((word) => word.str.trim()).join(' ')
  const refund = words.some((word) => /^R$/i.test(word.str.trim()) &&
    word.transform[4] >= taxX && Math.abs(word.transform[5] - rowY) <= 9)
  return { pay, tax: refund ? -tax : tax, taxYearId: `${endYear - 1}-${String(endYear).slice(-2)}`,
    ...(employer ? { employer } : {}) }
}
