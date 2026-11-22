import type { PropertyLet, TaxReturnData } from '../types'

export type ListKey = 'employments' | 'properties' | 'savings' | 'dividends' | 'pensions' | 'other'

export interface UndoEntry {
  id: number
  label: string
  restore: (current: TaxReturnData) => TaxReturnData
}

export const MAX_UNDO = 20

const LIST_LABELS: Record<ListKey, string> = {
  employments: 'employment', properties: 'property', savings: 'interest entry',
  dividends: 'dividend', pensions: 'pension', other: 'other income entry',
}

export function removalLabel(key: ListKey, item: object): string {
  const fields = item as Record<string, unknown>
  const name = [fields.employer, fields.name, fields.source, fields.description].find((value) => typeof value === 'string' && value.trim())
  return `Removed ${LIST_LABELS[key]}${name ? ` “${name}”` : ''}`
}

/** Puts a removed card back where it was, keeping any edits made since; does nothing if it is already there. */
export function reinsertListItem<K extends ListKey>(key: K, item: TaxReturnData[K][number], index: number) {
  return (current: TaxReturnData): TaxReturnData => {
    const list = current[key] as { id: string }[]
    if (list.some((entry) => entry.id === (item as { id: string }).id)) return current
    const next = [...list]
    next.splice(Math.min(index, next.length), 0, item as { id: string })
    return { ...current, [key]: next } as TaxReturnData
  }
}

/** Restores one property to an earlier version, e.g. after its matched rent receipts were removed. */
export function restoreProperty(previous: PropertyLet) {
  return (current: TaxReturnData): TaxReturnData => ({
    ...current,
    properties: current.properties.some((item) => item.id === previous.id)
      ? current.properties.map((item) => item.id === previous.id ? previous : item)
      : [...current.properties, previous],
  })
}

export function restoreField<F extends 'privatePensionRecipients' | 'charitableDonationRecipients'>(field: F, previous: TaxReturnData[F]) {
  return (current: TaxReturnData): TaxReturnData => ({ ...current, [field]: previous })
}

/** For actions that replace the whole return (Clear, Load example, Import). */
export function restoreSnapshot(snapshot: TaxReturnData) {
  return (): TaxReturnData => snapshot
}

export function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...stack, entry].slice(-MAX_UNDO)
}
