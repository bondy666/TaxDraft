/**
 * Identifies rental properties named in documents, so they need not be entered by hand. Only strong, property-specific
 * mentions count: a flat/unit number before a name, a "Re:"/"Property:"/"Ref" label before a building or street name,
 * or a file name. Addressee lines (e.g. the owner's home address) carry none of these and are ignored.
 */

const STREET_TYPES = 'park|chambers|house|court|road|street|st|place|gardens|mews|lane|avenue|close|square|terrace|way|parade|' +
  'drive|row|hill|view|lodge|hall|mansions|apartments|tower|wharf|quay|crescent|grove|walk|yard|buildings|works|mill|green'
const STREET_TYPE = new RegExp(`^(?:${STREET_TYPES})$`, 'i')
const STOP = /^(?:from|to|ref|reference|rent|rental|and|car|space|leeds|london|manchester|birmingham|ltd|limited|plc|for|of|the|period|invoice|new|post|box|key|deposit|payment|sc)$/i
const MIN_WEAK_MENTIONS = 3

export interface PropertyMention {
  name: string
  /** A name ending in a street or building type ("Pearl Chambers"); weak names ("Drayton") need repetition or a typed match. */
  typed: boolean
}

const titleCase = (value: string) => value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

/** Reads up to three name words, stopping at numbers, punctuation or generic words, and ending at a street type. */
function readName(words: string[]): PropertyMention | null {
  const name: string[] = []
  for (const word of words) {
    if (!/^[a-z'’]+$/i.test(word) || (STOP.test(word) && !(name.length && STREET_TYPE.test(word)))) break
    name.push(word)
    if (STREET_TYPE.test(word) && name.length > 1) return { name: titleCase(name.join(' ')), typed: true }
    if (name.length === 3) break
  }
  if (!name.length || STREET_TYPE.test(name[0])) return null
  return { name: titleCase(name.slice(0, 2).join(' ')), typed: false }
}

function wordsAfter(text: string, index: number): string[] {
  return text.slice(index).split(/[\s,()]+/).filter(Boolean)
    .map((word) => word.replace(/[.:;]+$/, ''))
}

export function findPropertyMentions(text: string): PropertyMention[] {
  const mentions: PropertyMention[] = []
  for (const line of text.split('\n')) {
    // "Flat 4, Pearl Chambers", "FLAT21 71E DRAYTON", "Apartment 4 Pearl Chambers"
    for (const match of line.matchAll(/\b(?:flat|flt|apartment|apt|unit)\s*\d+[a-z]?\b[,\s]*(?:\d+[a-z]?\b[,\s]*)?/gi)) {
      const mention = readName(wordsAfter(line, (match.index ?? 0) + match[0].length))
      if (mention) mentions.push(mention)
    }
    // "Re: 04, Pearl Chambers", "PROPERTY: Pearl Chambers", "REF.4 PEARL CHAMBERS", "in respect of 04, Pearl Chambers"
    for (const match of line.matchAll(/\b(?:re|property|ref|in respect of)\b\s*[:.]?\s*(?:\d+[a-z]?\b[,\s]*)?/gi)) {
      const mention = readName(wordsAfter(line, (match.index ?? 0) + match[0].length))
      if (mention?.typed) mentions.push(mention)
    }
  }
  return mentions
}

/** "Expenses_DraytonPark.docx" → "Drayton Park" when the name ends in a street or building type. */
export function propertyNameFromFileName(fileName: string): string | undefined {
  const words = fileName.replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/)
    .filter((word) => word && !/^(?:expenses?|costs?|receipts?|invoices?|bills?|\d+)$/i.test(word))
  for (let start = 0; start < words.length; start += 1) {
    const mention = readName(words.slice(start))
    if (mention?.typed) return mention.name
  }
  return undefined
}

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** True when two names refer to the same property, allowing a partial name ("Drayton" / "Drayton Park"). */
export function sameProperty(a: string, b: string): boolean {
  const left = a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const right = b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (compact(a) === compact(b)) return true
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  return shorter.length > 0 && shorter.every((word, index) => longer[index] === word)
}

/**
 * Turns mentions into property names: typed names always count; a weak name counts only if repeated, and is replaced by
 * a typed name it is part of. Names matching an existing property use the existing name.
 */
export function resolvePropertyNames(mentions: PropertyMention[], existing: string[] = []): string[] {
  const typed = mentions.filter((mention) => mention.typed).map((mention) => mention.name)
  const weakCounts = new Map<string, number>()
  for (const mention of mentions.filter((item) => !item.typed)) weakCounts.set(mention.name, (weakCounts.get(mention.name) ?? 0) + 1)
  const candidates = [
    ...typed,
    ...[...weakCounts].filter(([, count]) => count >= MIN_WEAK_MENTIONS).map(([name]) => name),
  ]
  const result: string[] = []
  for (const name of candidates) {
    const known = existing.find((item) => sameProperty(item, name))
    const chosen = known ?? typed.find((item) => item !== name && sameProperty(item, name) && item.length > name.length) ?? name
    const duplicate = result.findIndex((item) => sameProperty(item, chosen))
    if (duplicate < 0) result.push(chosen)
    else if (!existing.includes(result[duplicate]) && chosen.length > result[duplicate].length) result[duplicate] = chosen
  }
  return result
}
