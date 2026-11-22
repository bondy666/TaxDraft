export type EvidenceTier = 'recognised' | 'probable' | 'confirm'

export const EVIDENCE_TIERS: { id: EvidenceTier; label: string; description: string }[] = [
  {
    id: 'recognised',
    label: 'Recognised',
    description: 'Read from clearly labelled text in a known layout. Still compare the figure with the original.',
  },
  {
    id: 'probable',
    label: 'Probable',
    description: 'A label and amount were found, but the layout or tax treatment is not certain.',
  },
  {
    id: 'confirm',
    label: 'Requires confirmation',
    description: 'Read by OCR, or the figure or its tax treatment is uncertain. Check the original before importing.',
  },
]

export function evidenceTier(suggestion: { confidence: 'high' | 'medium' | 'low'; ocr?: boolean }): EvidenceTier {
  // OCR can misread digits, so it never counts as recognised, whatever the label match.
  if (suggestion.ocr) return 'confirm'
  if (suggestion.confidence === 'high') return 'recognised'
  if (suggestion.confidence === 'medium') return 'probable'
  return 'confirm'
}

function amountForms(amount: number): string[] {
  const forms = new Set([
    amount.toFixed(2),
    amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ])
  if (Number.isInteger(amount)) {
    forms.add(String(amount))
    forms.add(amount.toLocaleString('en-GB'))
  }
  return [...forms]
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Returns the source text surrounding the first of the given amounts, for side-by-side checking. */
export function findSourceExcerpt(text: string, amounts: (number | undefined)[], radius = 70): string | undefined {
  for (const amount of amounts) {
    if (amount === undefined || !Number.isFinite(amount) || amount === 0) continue
    for (const form of amountForms(Math.abs(amount))) {
      const match = new RegExp(`(?<![\\d.,])${escapeRegExp(form)}(?![\\d]|[.,]\\d)`).exec(text)
      if (!match) continue
      const start = Math.max(0, match.index - radius)
      const end = Math.min(text.length, match.index + form.length + radius)
      const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim()
      return `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`
    }
  }
  return undefined
}
