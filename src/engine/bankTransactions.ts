export interface BankTransaction {
  date: Date | null
  description: string
  amount: number
}

export interface SourcedBankTransaction extends BankTransaction {
  id: string
  source: string
  sourceKey?: string
}

export interface RentalIncomeCandidate {
  id: string
  sourceKeys: string[]
  source: string
  description: string
  basis: 'rentLabel' | 'flatDescription' | 'unclassifiedIncome'
  confidence: 'identified' | 'possible'
  total: number
  payments: SourcedBankTransaction[]
  /** Longest run of the same amount received in consecutive calendar months, when 2 or more. */
  regular?: { amount: number; months: number }
}

export interface CharityCandidate {
  id: string
  recipient: string
  reason: string
  confidence: 'identified' | 'likely' | 'monthlyReview'
  total: number
  payments: SourcedBankTransaction[]
}

const charityRecipients = [
  'Cancer Research UK', 'British Heart Foundation', 'British Red Cross', 'Macmillan',
  'Marie Curie', 'NSPCC', 'RSPCA', 'RNLI', 'Oxfam', 'Save the Children',
  'WaterAid', 'UNICEF', 'CAF Charity', 'Charities Aid Foundation', 'Shelter',
  'The Trussell Trust', 'Age UK', 'The Salvation Army', 'Mind', 'Crisis',
  'Barnardo\'s', 'The Children\'s Society', 'Scope', 'Mencap', 'Alzheimer\'s Society',
  'Diabetes UK', 'Asthma + Lung UK', 'Action for Children', 'Samaritans',
  'Guide Dogs', 'Dogs Trust', 'Cats Protection', 'WWF', 'Greenpeace',
  'Christian Aid', 'ActionAid', 'World Vision', 'Centrepoint', 'Refuge',
  'Royal British Legion', 'St John Ambulance', 'RSPB', 'Woodland Trust',
  'The Donkey Sanctuary',
]

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'

/** Groups bank descriptions from the same payer, ignoring per-payment dates, long reference numbers and payment-type prefixes. */
export function payerKey(description: string): string {
  // Only the "ref" label is dropped: banks often put the property and payer after it ("REF.FLAT21 DRAYTON FROM ...").
  const key = description.toLowerCase()
    .replace(/\b(?:ref(?:erence)?|rf)\b/g, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s?${MONTH}(?:\\s?\\d{2,4})?\\b`, 'g'), ' ')
    .replace(new RegExp(`\\b${MONTH}\\s?\\d{2,4}\\b`, 'g'), ' ')
    .replace(/\b[a-z]*\d{5,}[a-z0-9]*\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^(?:(?:faster payments?|fp|fpi|bgc|bank giro credit|bank credit|bacs|credit|cr|payment from|from|standing order|so)\s+)+/, '')
    .trim()
  return key || description.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Longest run of the same amount in consecutive calendar months (2 or more), e.g. rent or a regular client. */
export function regularMonthlyAmount(payments: { date: Date | null; amount: number }[]): RentalIncomeCandidate['regular'] {
  const monthsByAmount = new Map<number, Set<number>>()
  for (const payment of payments) {
    if (!payment.date) continue
    const pence = Math.round(payment.amount * 100)
    const months = monthsByAmount.get(pence) ?? new Set<number>()
    months.add(payment.date.getFullYear() * 12 + payment.date.getMonth())
    monthsByAmount.set(pence, months)
  }
  let best: RentalIncomeCandidate['regular']
  for (const [pence, months] of monthsByAmount) {
    const sorted = [...months].sort((a, b) => a - b)
    let run = 1
    for (let index = 1; index <= sorted.length; index += 1) {
      if (index < sorted.length && sorted[index] === sorted[index - 1] + 1) {
        run += 1
        continue
      }
      if (run >= 2 && (!best || run > best.months)) best = { amount: pence / 100, months: run }
      run = 1
    }
  }
  return best
}

export function findRentalIncomeCandidates(transactions: SourcedBankTransaction[]): RentalIncomeCandidate[] {
  const groups = new Map<string, RentalIncomeCandidate>()
  for (const transaction of transactions) {
    if (!transaction.date || !Number.isFinite(transaction.amount) || transaction.amount <= 0) continue
    const excluded = /\b(?:refund|deposit|mortgage|transfer|salary|wages|payroll|cashback|reimbursement)\b/i
      .test(transaction.description)
    const explicitRent = /\brent(?:al)?\b/i.test(transaction.description) &&
      !excluded
    const possibleFlat = !explicitRent && !excluded &&
      /\bflat(?=\b|\d)/i.test(transaction.description)
    const unclassifiedIncome = !explicitRent && !possibleFlat &&
      classifyBankTransaction(transaction) === 'otherIncome'
    if (!explicitRent && !possibleFlat && !unclassifiedIncome) continue
    const basis = explicitRent ? 'rentLabel' : possibleFlat ? 'flatDescription' : 'unclassifiedIncome'
    const sourceKey = transaction.sourceKey ?? transaction.source
    const id = payerKey(transaction.description)
    const candidate = groups.get(id) ?? {
      id, sourceKeys: [sourceKey], source: transaction.source, description: transaction.description,
      basis,
      confidence: explicitRent ? 'identified' : 'possible', total: 0, payments: [],
    }
    if (candidate.payments.some((payment) => payment.id === transaction.id)) continue
    if (!candidate.sourceKeys.includes(sourceKey)) candidate.sourceKeys.push(sourceKey)
    if (!candidate.source.split(' · ').includes(transaction.source)) {
      candidate.source = `${candidate.source} · ${transaction.source}`
    }
    candidate.payments.push(transaction)
    candidate.total = Math.round((candidate.total + transaction.amount) * 100) / 100
    if (explicitRent) {
      candidate.basis = 'rentLabel'
      candidate.confidence = 'identified'
    }
    groups.set(id, candidate)
  }
  return [...groups.values()].map((candidate) => {
    const payments = candidate.payments.sort((a, b) => a.date!.getTime() - b.date!.getTime())
    const regular = regularMonthlyAmount(payments)
    return { ...candidate, payments, ...(regular ? { regular } : {}) }
  }).sort((a, b) => a.description.localeCompare(b.description))
}

function displayRecipient(value: string): string {
  const words = value.trim().split(/\s+/)
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return value
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`).join(' ')
}

function monthlyPaymentsUnderLimit(payments: SourcedBankTransaction[]): SourcedBankTransaction[] {
  const eligible = payments.filter((payment) => Math.abs(payment.amount) < 100)
    .sort((a, b) => a.date!.getTime() - b.date!.getTime())
  const byMonth = new Map<number, SourcedBankTransaction[]>()
  for (const payment of eligible) {
    const month = payment.date!.getFullYear() * 12 + payment.date!.getMonth()
    byMonth.set(month, [...(byMonth.get(month) ?? []), payment])
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b)
  let longest: SourcedBankTransaction[] = []
  for (const start of months) {
    const series: SourcedBankTransaction[] = []
    let month = start
    while (byMonth.get(month)?.length === 1) {
      const current = byMonth.get(month)![0]
      const previous = series[series.length - 1]
      if (previous) {
        const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
        const gap = (day(current.date!) - day(previous.date!)) / 86400000
        if (gap < 20 || gap > 40) break
      }
      series.push(current)
      month += 1
    }
    if (series.length > longest.length) longest = series
  }
  return longest.length >= 3 ? longest : []
}

export function findCharityCandidates(transactions: SourcedBankTransaction[], pensionRecipients: string[] = [], donationRecipients: string[] = []): CharityCandidate[] {
  const groups = new Map<string, { recipient: string; payments: SourcedBankTransaction[] }>()
  const seen = new Set<string>()
  for (const transaction of transactions) {
    if (seen.has(transaction.id)) continue
    seen.add(transaction.id)
    if (!transaction.date || !Number.isFinite(transaction.amount) || transaction.amount >= 0) continue
    const kind = classifyBankTransaction(transaction, pensionRecipients, donationRecipients)
    if (kind === 'pensionContribution') continue
    if (kind !== 'giftAid' && /\b(bills?|mortgage|rent|rental|loan|repayment|insurance|assurance|utilities|electric(?:ity)?|gas|water|energy|council|tax|telephone|phone|mobile|broadband|internet|tv|licence|license|subscription|netflix|spotify|amazon|apple|sky|virgin|bt|ee|vodafone|o2|three|octopus|eon|edf|british gas|thames|severn trent|natwest|halifax|santander|barclays|lloyds|hsbc|transfer|savings|credit card|card payment|pension|sipp|shop|store|purchase|goods|tickets?|raffle|lottery|membership|refund|reversal|supermarket|tesco|asda|sainsbury|aldi|lidl|petrol|fuel|parking|gym|fitness|service charge|ground rent|repair|maintenance)\b/i.test(transaction.description)) continue
    const recipient = transaction.description
      .replace(/^(?:(?:direct debit|standing order|payment to|dd|d\/d|so|s\/o)\s+)+/i, '')
      .replace(/\s+(?:ref(?:erence)?\b.*|[\w-]*\d[\w-]*(?:\s+.*)?)$/i, '')
      .replace(/[^a-z0-9]+/gi, ' ').trim()
    if (recipient.length < 3) continue
    const key = recipient.toLowerCase()
    const group = groups.get(key) ?? { recipient, payments: [] }
    // The same payment read from overlapping files (e.g. a statement and a workbook copy) is counted once.
    const day = transaction.date.toDateString()
    if (group.payments.some((payment) => payment.date!.toDateString() === day && payment.amount === transaction.amount)) continue
    group.payments.push(transaction)
    groups.set(key, group)
  }
  const candidates: CharityCandidate[] = []
  for (const [id, group] of groups) {
    const payments = group.payments.sort((a, b) => a.date!.getTime() - b.date!.getTime())
    const recognised = payments.some((payment) => classifyBankTransaction(payment, pensionRecipients, donationRecipients) === 'giftAid')
    const monthlyReviewPayments = recognised ? [] : monthlyPaymentsUnderLimit(payments)
    if (!recognised && !monthlyReviewPayments.length) continue
    const candidatePayments = recognised ? payments : monthlyReviewPayments
    const canonicalName = [...charityRecipients, ...donationRecipients].find((name) =>
      matchesBankRecipient(group.recipient, [name]),
    )
    const likely = !recognised && looksLikeRegularDonation(group.recipient, candidatePayments)
    candidates.push({
      id, recipient: canonicalName ?? displayRecipient(group.recipient), payments: candidatePayments,
      confidence: recognised ? 'identified' : likely ? 'likely' : 'monthlyReview',
      total: Math.round(candidatePayments.reduce((sum, payment) => sum - payment.amount, 0) * 100) / 100,
      reason: recognised
        ? 'A recognised charity, or labelled as a donation. Check you can claim Gift Aid.'
        : likely
          ? `The same £${Math.abs(candidatePayments[0].amount).toFixed(2)} every month for ${candidatePayments.length} months, like a charity direct debit. Check it is a registered charity.`
          : 'Regular payments under £100. This may not be a charity; tick it only if it is.',
    })
  }
  return candidates.sort((a, b) => a.recipient.localeCompare(b.recipient))
}

const COMMERCIAL_PAYEE = /\b(?:ltd|limited|plc|llp|inc|fees?|charges?|account|finance|financial|leasing|lease|motors?|cars?|bank|club|services?)\b/i

/** A fixed, round monthly amount to a non-commercial payee is the typical pattern of a charity direct debit. */
function looksLikeRegularDonation(recipient: string, payments: SourcedBankTransaction[]): boolean {
  const pence = Math.round(Math.abs(payments[0].amount) * 100)
  return !COMMERCIAL_PAYEE.test(recipient) &&
    payments.every((payment) => Math.round(Math.abs(payment.amount) * 100) === pence) &&
    pence % 50 === 0
}

export function matchesBankRecipient(description: string, recipients: string[]): boolean {
  // Banks drop apostrophes and leading "The" ("THE CHILDREN'S SOCIETY" → "CHILDRENS SOCIETY").
  const normalize = (value: string) => value.toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const text = ` ${normalize(description)} `
  return recipients.some((recipient) => {
    const name = normalize(recipient).replace(/^the /, '')
    return name.length >= 3 && text.includes(` ${name} `)
  })
}

export const matchesPensionRecipient = matchesBankRecipient

export function classifyBankTransaction(transaction: BankTransaction, pensionRecipients: string[] = [], donationRecipients: string[] = []) {
  const description = transaction.description.toLowerCase()
  if (transaction.amount > 0) {
    if (/\binterest\b/.test(description) && !/\brefund\b/.test(description)) return 'interest'
    if (/\bdividends?\b/.test(description)) return 'dividend'
    if (/\brent(?:al)?\b|\bflat(?=\b|\d)|\bmortgage\b|\bsalary\b|\bwages\b|\bpayroll\b|\btransfer\b|\brefund\b|\bcashback\b|\breimbursement\b/.test(description)) return null
    return 'otherIncome'
  }
  if (transaction.amount < 0) {
    if (/\brefund\b|\breversal\b/.test(description)) return null
    if (matchesPensionRecipient(transaction.description, pensionRecipients)) return 'pensionContribution'
    if (/\bpension\b|\bsipp\b|\bnest\b/.test(description) && !/\bemployer\b/.test(description)) return 'pensionContribution'
    if (/\bshop\b|\bstore\b|\bpurchase\b|\bgoods\b|\btickets?\b|\braffle\b|\blottery\b|\bmembership\b/.test(description)) return null
    if (/\bcharit(?:y|ies|able)\b|\bdonations?\b|\bgift[\s-]*aid\b/.test(description) ||
      matchesBankRecipient(transaction.description, [...charityRecipients, ...donationRecipients])) return 'giftAid'
  }
  return null
}
