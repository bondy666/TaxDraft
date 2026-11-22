import * as XLSX from '@e965/xlsx'
import { TAX_YEARS } from '../data/taxYears.ts'
import type {
  BankReliefCandidate, BankSource, DividendIncome, EmploymentIncome, OtherIncome, PersonalDetails,
  PensionIncome, PropertyExpenseEvidence, PropertyLet, PropertyRentalIncomeEvidence, SavingsInterest,
  TaxReturnData,
} from '../types'

type SheetRow = Record<string, unknown>

function label(key: string): string {
  return key.replace(/\./g, ' / ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/(^| \/ )([a-z])/g, (_, prefix: string, character: string) => prefix + character.toUpperCase())
}

function rows(workbook: XLSX.WorkBook, name: string): SheetRow[] {
  const sheet = workbook.Sheets[name]
  if (!sheet) throw new Error(`The workbook is missing the "${name}" worksheet.`)
  return XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: '', raw: true })
}

function value(row: SheetRow, path: string): unknown {
  const header = label(path)
  const continued = Object.entries(row)
    .map(([key, cell]) => {
      const match = key.match(new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(continued (\\d+)\\)$`))
      return match ? { index: Number(match[1]), cell } : undefined
    })
    .filter((part): part is { index: number; cell: unknown } => !!part)
    .sort((left, right) => left.index - right.index)
  const first = row[header]
  if (!continued.length) return first
  return [first, ...continued.map((part) => part.cell)].map((part) => part == null ? '' : String(part)).join('')
}

function text(row: SheetRow, path: string, required = false): string {
  const cell = value(row, path)
  if (cell === undefined || cell === null || cell === '') {
    if (required) throw new Error(`A value is required for "${label(path)}".`)
    return ''
  }
  if (typeof cell !== 'string' && typeof cell !== 'number' && typeof cell !== 'boolean') {
    throw new Error(`"${label(path)}" must be plain text.`)
  }
  return String(cell)
}

function number(row: SheetRow, path: string, fallback = 0, minimum?: number, maximum?: number): number {
  const cell = value(row, path)
  if (cell === undefined || cell === null || cell === '') return fallback
  const parsed = typeof cell === 'number' ? cell : typeof cell === 'string' ? Number(cell.trim()) : NaN
  if (!Number.isFinite(parsed) || (minimum !== undefined && parsed < minimum) ||
    (maximum !== undefined && parsed > maximum)) {
    throw new Error(`"${label(path)}" must be a valid number${minimum !== undefined ? ` from ${minimum}` : ''}${maximum !== undefined ? ` to ${maximum}` : ''}.`)
  }
  return parsed
}

function boolean(row: SheetRow, path: string): boolean {
  const cell = value(row, path)
  if (cell === true || cell === 1 || cell === '1' || (typeof cell === 'string' && cell.toLowerCase() === 'true')) return true
  if (cell === false || cell === 0 || cell === '' || cell === undefined || cell === null ||
    cell === '0' || (typeof cell === 'string' && cell.toLowerCase() === 'false')) return false
  throw new Error(`"${label(path)}" must be TRUE or FALSE.`)
}

function id(row: SheetRow): string {
  const imported = text(row, 'id')
  if (imported) return imported
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 12)
}

function list<T>(workbook: XLSX.WorkBook, name: string, map: (row: SheetRow) => T): T[] {
  return rows(workbook, name).filter((row) => Object.values(row).some((cell) => cell !== '')).map(map)
}

function stringArray(row: SheetRow, path: string): string[] | undefined {
  const raw = text(row, path)
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`"${label(path)}" must contain a valid JSON array from the exported workbook.`)
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`"${label(path)}" must contain a valid JSON array of text.`)
  }
  return parsed
}

function bankSource(row: SheetRow, prefix = 'bankSource'): BankSource {
  const source: BankSource = {
    id: text(row, `${prefix}.id`, true),
    taxYearId: text(row, `${prefix}.taxYearId`, true),
    fileName: text(row, `${prefix}.fileName`, true),
    recordedAmount: number(row, `${prefix}.recordedAmount`, 0, 0),
    evidence: text(row, `${prefix}.evidence`),
    verified: boolean(row, `${prefix}.verified`),
  }
  const groupKey = text(row, `${prefix}.groupKey`)
  if (groupKey) source.groupKey = groupKey
  return source
}

function propertyIndex(properties: PropertyLet[], row: SheetRow): number {
  const propertyId = text(row, 'propertyId')
  const index = properties.findIndex((property) => property.id === propertyId)
  if (index >= 0) return index
  const name = text(row, 'property')
  const matches = properties.map((property, position) => property.name === name ? position : -1).filter((position) => position >= 0)
  if (matches.length === 1) return matches[0]
  throw new Error(`Property evidence for "${name || propertyId || 'unknown property'}" could not be matched to a property entry.`)
}

function taxYearId(workbook: XLSX.WorkBook): string {
  const entry = rows(workbook, 'Tax year rates').find((row) => text(row, 'item').toLowerCase() === 'id')
  const id = entry ? text(entry, 'value') : ''
  if (!id || !TAX_YEARS[id]) throw new Error('The workbook does not contain a supported tax year.')
  return id
}

function importedPersonal(workbook: XLSX.WorkBook): { personal: PersonalDetails; sources: TaxReturnData['personalSources'] } {
  const personal: PersonalDetails = {
    name: '',
    maritalStatus: 'single',
    isScottishTaxpayer: false,
    isBlind: false,
    numberOfChildren: 0,
    claimsChildBenefit: false,
    childBenefitAnnualAmount: 0,
    hasStudentLoan: false,
    studentLoanPlan: 'none',
  }
  const sources: NonNullable<TaxReturnData['personalSources']> = {}
  const fields: Record<string, keyof PersonalDetails> = {
    name: 'name', maritalStatus: 'maritalStatus', isScottishTaxpayer: 'isScottishTaxpayer', isBlind: 'isBlind',
    numberOfChildren: 'numberOfChildren', claimsChildBenefit: 'claimsChildBenefit',
    childBenefitAnnualAmount: 'childBenefitAnnualAmount', hasStudentLoan: 'hasStudentLoan', studentLoanPlan: 'studentLoanPlan',
  }
  const found = new Set<string>()
  for (const row of rows(workbook, 'Personal')) {
    const field = text(row, 'field')
    const key = Object.keys(fields).find((candidate) => candidate.toLowerCase() === field.replace(/\s/g, '').toLowerCase())
    if (!key) continue
    const target = fields[key]
    found.add(key)
    if (target === 'name') personal.name = text(row, 'value')
    else if (target === 'maritalStatus') {
      const status = text(row, 'value')
      if (!['single', 'married', 'civilPartnership', 'divorced', 'widowed'].includes(status)) {
        throw new Error(`"${label('maritalStatus')}" is not a supported value.`)
      }
      personal.maritalStatus = status as PersonalDetails['maritalStatus']
    } else if (target === 'studentLoanPlan') {
      const plan = text(row, 'value')
      if (!['plan1', 'plan2', 'plan4', 'postgrad', 'none'].includes(plan)) {
        throw new Error(`"${label('studentLoanPlan')}" is not a supported value.`)
      }
      personal.studentLoanPlan = plan as PersonalDetails['studentLoanPlan']
    } else if (target === 'isScottishTaxpayer' || target === 'isBlind' ||
      target === 'claimsChildBenefit' || target === 'hasStudentLoan') {
      personal[target] = boolean({ Value: value(row, 'value') }, 'value')
    } else {
      personal[target] = number({ Value: value(row, 'value') }, 'value', 0, 0)
    }
    const evidence = text(row, 'evidence')
    if (evidence) sources[target] = evidence
  }
  const missing = Object.keys(fields).filter((field) => !found.has(field))
  if (missing.length) throw new Error(`The Personal worksheet is missing: ${missing.map((field) => label(field)).join(', ')}.`)
  return { personal, sources }
}

export function importTaxWorkbook(workbook: XLSX.WorkBook): TaxReturnData {
  for (const name of ['Read me', 'Personal', 'Employment', 'Properties', 'Savings interest', 'Dividends',
    'Pension income', 'Other income', 'Pension and Gift Aid', 'Tax year rates', 'Property expenses',
    'Property bank references', 'Rental income evidence', 'Bank relief review', 'Recipient settings']) {
    if (!workbook.Sheets[name]) throw new Error(`The workbook is missing the "${name}" worksheet.`)
  }
  const yearId = taxYearId(workbook)
  const { personal, sources } = importedPersonal(workbook)
  const employments: EmploymentIncome[] = list(workbook, 'Employment', (row) => {
    const p60SourceId = text(row, 'p60Source.id')
    const p60SourceFileName = text(row, 'p60Source.fileName')
    return {
      id: id(row),
      employer: text(row, 'employer'),
      p60Pay: number(row, 'p60Pay', 0, 0),
      benefitsInKind: number(row, 'benefitsInKind', 0, 0),
      taxDeducted: number(row, 'taxDeducted', 0, 0),
      ...(p60SourceId ? { p60Source: {
        id: p60SourceId, fileName: p60SourceFileName, verified: boolean(row, 'p60Source.verified'),
      } } : {}),
    }
  })

  let properties: PropertyLet[] = list(workbook, 'Properties', (row) => {
    const documentSources = stringArray(row, 'documentSources')
    return {
      id: id(row),
      name: text(row, 'name', true),
      ownershipShare: number(row, 'ownershipShare', 1, 0, 1),
      rentalIncome: number(row, 'rentalIncome', 0, 0),
      allowableExpenses: number(row, 'allowableExpenses', 0, 0),
      mortgageInterest: number(row, 'mortgageInterest', 0, 0),
      ...(boolean(row, 'interestOnlyMortgage') ? { interestOnlyMortgage: true } : {}),
      ...(documentSources ? { documentSources } : {}),
      ...(text(row, 'documentNote') ? { documentNote: text(row, 'documentNote') } : {}),
      ...(value(row, 'documentVerified') !== undefined && value(row, 'documentVerified') !== ''
        ? { documentVerified: boolean(row, 'documentVerified') } : {}),
      ...(value(row, 'expenseReconciliation') !== undefined && value(row, 'expenseReconciliation') !== ''
        ? { expenseReconciliation: number(row, 'expenseReconciliation', 0, 0) } : {}),
    }
  })

  for (const sheet of ['Property expenses', 'Property bank references', 'Rental income evidence']) {
    const evidenceRows = rows(workbook, sheet)
    for (const row of evidenceRows) {
      const index = propertyIndex(properties, row)
      if (sheet === 'Property expenses') {
        const treatment = text(row, 'treatment')
        if (!['runningCost', 'review', 'interest', 'repayment'].includes(treatment)) throw new Error('A property expense has an unsupported treatment.')
        const evidence: PropertyExpenseEvidence = {
          id: id(row), source: text(row, 'source'), row: number(row, 'row', 0, 0),
          date: text(row, 'date'), description: text(row, 'description'), amount: number(row, 'amount', 0, 0),
          allowableAmount: number(row, 'allowableAmount', 0, 0), treatment: treatment as PropertyExpenseEvidence['treatment'],
          reason: text(row, 'reason'),
        }
        properties[index] = { ...properties[index], expenseEvidence: [...properties[index].expenseEvidence ?? [], evidence] }
      } else if (sheet === 'Property bank references') {
        const kind = text(row, 'kind')
        if (kind !== 'mortgage' && kind !== 'possibleRent') throw new Error('A property bank reference has an unsupported kind.')
        const evidence: NonNullable<PropertyLet['bankEvidence']>[number] = {
          label: text(row, 'label'), kind, incoming: number(row, 'incoming', 0, 0), outgoing: number(row, 'outgoing', 0, 0),
          ...(value(row, 'includedInRent') !== undefined && value(row, 'includedInRent') !== ''
            ? { includedInRent: boolean(row, 'includedInRent') } : {}),
        }
        properties[index] = { ...properties[index], bankEvidence: [...properties[index].bankEvidence ?? [], evidence] }
      } else {
        const treatment = text(row, 'treatment')
        const basis = text(row, 'basis')
        if (treatment !== 'added' && treatment !== 'alreadyIncluded') throw new Error('A rental-income item has an unsupported treatment.')
        if (basis && !['rentLabel', 'flatDescription', 'unclassifiedIncome'].includes(basis)) {
          throw new Error('A rental-income item has an unsupported evidence basis.')
        }
        const evidence: PropertyRentalIncomeEvidence = {
          id: id(row), source: text(row, 'source'), description: text(row, 'description'), date: text(row, 'date'),
          amount: number(row, 'amount', 0, 0), treatment,
          ...(basis ? { basis: basis as PropertyRentalIncomeEvidence['basis'] } : {}),
        }
        properties[index] = { ...properties[index], rentalIncomeEvidence: [...properties[index].rentalIncomeEvidence ?? [], evidence] }
      }
    }
  }

  const savings: SavingsInterest[] = list(workbook, 'Savings interest', (row) => ({
    id: id(row), source: text(row, 'source'), amount: number(row, 'amount', 0, 0),
    ...(text(row, 'bankSource.id') ? { bankSource: bankSource(row) } : {}),
  }))
  const dividends: DividendIncome[] = list(workbook, 'Dividends', (row) => ({
    id: id(row), source: text(row, 'source'), amount: number(row, 'amount', 0, 0),
    ...(text(row, 'bankSource.id') ? { bankSource: bankSource(row) } : {}),
  }))
  const pensions: PensionIncome[] = list(workbook, 'Pension income', (row) => ({
    id: id(row), source: text(row, 'source'), amount: number(row, 'amount', 0, 0),
    taxDeducted: number(row, 'taxDeducted', 0, 0),
  }))
  const other: OtherIncome[] = list(workbook, 'Other income', (row) => ({
    id: id(row), description: text(row, 'description'), amount: number(row, 'amount', 0, 0),
    ...(text(row, 'bankSource.id') ? { bankSource: bankSource(row) } : {}),
  }))

  const reliefRows = list(workbook, 'Pension and Gift Aid', (row) => ({
    relief: text(row, 'relief'), netClaimed: number(row, 'netClaimed', 0, 0),
  }))
  const pensionRelief = reliefRows.find((row) => row.relief === 'Personal relief-at-source pension contributions')
  const giftAidRelief = reliefRows.find((row) => row.relief === 'Gift Aid donations')
  if (!pensionRelief || !giftAidRelief) throw new Error('The Pension and Gift Aid worksheet is missing a return total.')

  const bankReliefCandidates: BankReliefCandidate[] = list(workbook, 'Bank relief review', (row) => {
    const kind = text(row, 'kind')
    if (kind !== 'pensionContribution' && kind !== 'giftAid') throw new Error('A bank relief candidate has an unsupported kind.')
    return { kind, claimedAmount: number(row, 'claimedAmount', 0, 0), source: bankSource(row, 'source') }
  })
  const privatePensionRecipients: string[] = []
  const charitableDonationRecipients: string[] = []
  for (const row of list(workbook, 'Recipient settings', (entry) => entry)) {
    const kind = text(row, 'kind')
    const recipient = text(row, 'recipient', true)
    if (kind === 'Private pension') privatePensionRecipients.push(recipient)
    else if (kind === 'Charitable donation') charitableDonationRecipients.push(recipient)
    else throw new Error(`Unsupported recipient setting "${kind}".`)
  }

  return {
    taxYearId: yearId,
    personal,
    personalSources: sources,
    employments,
    properties,
    savings,
    dividends,
    pensions,
    other,
    reliefs: { personalPensionContributionsNet: pensionRelief.netClaimed, giftAidNet: giftAidRelief.netClaimed },
    bankReliefCandidates,
    privatePensionRecipients,
    charitableDonationRecipients,
  }
}

export async function readTaxSpreadsheet(file: File): Promise<TaxReturnData> {
  const bytes = await file.arrayBuffer()
  return importTaxWorkbook(XLSX.read(bytes, { type: 'array' }))
}
