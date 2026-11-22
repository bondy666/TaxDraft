import { useState, useCallback, useRef, type SetStateAction } from 'react'
import type { TaxReturnData } from '../types'
import type { DocumentSuggestion } from '../engine/documentImport'
import { importBankSuggestion, confirmBankRelief as confirmBankReliefAmount } from '../engine/bankImport'
import {
  importProperty, moveBankReference as moveBankReferenceEntries, allocateProperty as allocatePropertyEntries,
  allocateToNewProperty as allocateToNewPropertyEntries, refreshWordDocumentRows, removePropertyExpenses as removePropertyExpenseRows,
  reconcileRentalIncomeCandidate as reconcileRentalIncomeCandidateEntries,
  removeRentalIncomeEvidence,
  type RentalIncomeResolution,
} from '../engine/propertyImport'
import type { RentalIncomeCandidate } from '../engine/bankTransactions'
import { DEFAULT_TAX_YEAR } from '../data/taxYears'
import { syncInterestOnlyMortgage } from '../engine/propertyExpenses'
import { syncOtherIncome } from '../engine/otherIncome'
import {
  pushUndo, reinsertListItem, removalLabel, restoreField, restoreProperty, restoreSnapshot,
  type ListKey, type UndoEntry,
} from '../engine/undo'

const uid = () => Math.random().toString(36).slice(2, 8)

export function emptyReturn(taxYearId = DEFAULT_TAX_YEAR): TaxReturnData {
  return {
    taxYearId,
    personal: {
      name: '',
      maritalStatus: 'single',
      isScottishTaxpayer: false,
      isBlind: false,
      numberOfChildren: 0,
      claimsChildBenefit: false,
      childBenefitAnnualAmount: 0,
      hasStudentLoan: false,
      studentLoanPlan: 'none',
    },
    employments: [],
    properties: [],
    savings: [],
    dividends: [],
    pensions: [],
    other: [],
    reliefs: { personalPensionContributionsNet: 0, giftAidNet: 0 },
  }
}

/** Pre-filled with the real 2024/25 figures from the accountant's computation, so you can
 *  check this workbook reproduces the same bottom line before trusting it with a live year. */
export function exampleReturn2024_25(): TaxReturnData {
  const r = emptyReturn('2024-25')
  r.personal.name = 'Example — from accountant\u2019s 2024/25 computation'
  r.personal.maritalStatus = 'married'
  r.employments = [
    { id: uid(), employer: 'Employer', p60Pay: 127630, taxDeducted: 43588, benefitsInKind: 0 },
  ]
  r.properties = [
    {
      id: uid(),
      name: 'Drayton Park',
      ownershipShare: 0.5,
      rentalIncome: 25200,
      allowableExpenses: 4581 + 3024 + 120 + 180 + 150 + 147 + 250 + 42,
      mortgageInterest: 17248,
    },
    {
      id: uid(),
      name: 'North Property, Flat 4 Pearl Chamber',
      ownershipShare: 0.5,
      rentalIncome: 5371,
      allowableExpenses: 1561 + 989 + 180 + 786 + 120 + 165 + 250 + 46,
      mortgageInterest: 9464,
    },
  ]
  r.savings = [{ id: uid(), source: 'Bank interest', amount: 132 }]
  // Basic rate band adjustments row shows these as already-gross figures (18,750 / 417),
  // so the net amounts actually paid are 80% of that.
  r.reliefs = {
    personalPensionContributionsNet: round2(18750 * 0.8),
    giftAidNet: round2(417 * 0.8),
  }
  return r
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function syncDerivedFigures(data: TaxReturnData): TaxReturnData {
  const properties = data.properties.map(syncInterestOnlyMortgage)
  const synced = properties.every((item, index) => item === data.properties[index]) ? data : { ...data, properties }
  return syncOtherIncome(synced)
}

export function useTaxReturn() {
  const [data, setRawData] = useState<TaxReturnData>(() => emptyReturn())
  // Every change passes through here, so derived figures stay right however the evidence was edited, moved or imported.
  const setData = useCallback((action: SetStateAction<TaxReturnData>) => {
    setRawData((current) => syncDerivedFigures(typeof action === 'function' ? action(current) : action))
  }, [])
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  // The latest return, so removals can record what they remove without side effects inside state updaters.
  const dataRef = useRef(data)
  dataRef.current = data
  const undoId = useRef(0)

  const remember = useCallback((label: string, restore: UndoEntry['restore']) => {
    undoId.current += 1
    const id = undoId.current
    setUndoStack((stack) => pushUndo(stack, { id, label, restore }))
  }, [])

  const undoStackRef = useRef(undoStack)
  undoStackRef.current = undoStack
  const undo = useCallback(() => {
    const entry = undoStackRef.current[undoStackRef.current.length - 1]
    if (!entry) return
    setUndoStack((stack) => stack.slice(0, -1))
    setData((current) => entry.restore(current))
  }, [])

  /** Replaces the whole return (import), keeping the previous one recoverable. */
  const replaceData = useCallback((next: TaxReturnData, label: string) => {
    remember(label, restoreSnapshot(dataRef.current))
    setData(next)
  }, [remember])

  const loadExample = useCallback(() => {
    remember('Replaced the return with the example', restoreSnapshot(dataRef.current))
    setData(exampleReturn2024_25())
  }, [remember])
  const reset = useCallback((taxYearId?: string) => {
    remember('Cleared the return', restoreSnapshot(dataRef.current))
    setData(emptyReturn(taxYearId))
  }, [remember])

  const setTaxYear = useCallback((taxYearId: string) => {
    setData((d) => ({ ...d, taxYearId }))
  }, [])

  const removeBusinessInvoice = useCallback((id: string) => {
    const invoices = dataRef.current.business?.invoices ?? []
    const index = invoices.findIndex((invoice) => invoice.id === id)
    if (index < 0) return
    const invoice = invoices[index]
    remember(`Removed business invoice “${invoice.source}”`, (current) => {
      if (!current.business || current.business.invoices.some((item) => item.id === id)) return current
      const restored = [...current.business.invoices]
      restored.splice(Math.min(index, restored.length), 0, invoice)
      return { ...current, business: { ...current.business, invoices: restored } }
    })
    setData((current) => current.business ? {
      ...current, business: { ...current.business, invoices: current.business.invoices.filter((item) => item.id !== id) },
    } : current)
  }, [remember])

  const updatePersonal = useCallback((patch: Partial<TaxReturnData['personal']>) => {
    setData((d) => {
      const personalSources = { ...d.personalSources }
      for (const field of Object.keys(patch) as (keyof TaxReturnData['personal'])[]) delete personalSources[field]
      return { ...d, personal: { ...d.personal, ...patch }, personalSources }
    })
  }, [])

  const updateReliefs = useCallback((patch: Partial<TaxReturnData['reliefs']>) => {
    setData((d) => ({ ...d, reliefs: { ...d.reliefs, ...patch } }))
  }, [])

  const importDocumentSuggestions = useCallback((suggestions: DocumentSuggestion[]) => {
    setData((current) => {
      let next: TaxReturnData = {
        ...current,
        employments: [...current.employments],
        properties: [...current.properties],
        savings: [...current.savings],
        dividends: [...current.dividends],
        pensions: [...current.pensions],
        other: [...current.other],
        reliefs: { ...current.reliefs },
        personal: { ...current.personal },
        personalSources: { ...current.personalSources },
      }
      const refreshed = refreshWordDocumentRows(next.properties, suggestions.filter((suggestion) => suggestion.selected))
      next.properties = refreshed.items

      for (const suggestion of refreshed.suggestions) {
        if (!suggestion.selected) continue
        if (suggestion.bankSource) {
          next = importBankSuggestion(next, suggestion, uid())
          continue
        }
        if (suggestion.kind === 'personal' && suggestion.personalPatch) {
          next.personal = { ...next.personal, ...suggestion.personalPatch }
          for (const field of Object.keys(suggestion.personalPatch) as (keyof TaxReturnData['personal'])[]) {
            if (next.personalSources) next.personalSources[field] = suggestion.fileName
          }
        } else if (suggestion.kind === 'employment') {
          if (suggestion.p60SourceId &&
            (suggestion.p60TaxYearId !== current.taxYearId ||
              next.employments.some((employment) => employment.p60Source?.id === suggestion.p60SourceId))) continue
          next.employments.push({
            id: uid(),
            employer: suggestion.employer || suggestion.fileName.replace(/\.[^.]+$/, ''),
            p60Pay: suggestion.amount ?? 0,
            taxDeducted: suggestion.taxDeducted ?? 0,
            benefitsInKind: suggestion.benefitsInKind ?? 0,
            ...(suggestion.p60SourceId ? { p60Source: {
              id: suggestion.p60SourceId, fileName: suggestion.fileName, verified: false,
            } } : {}),
          })
        } else if (suggestion.kind === 'property') {
          next.properties = importProperty(next.properties, suggestion, current.taxYearId, uid())
        } else if (suggestion.kind === 'interest') {
          next.savings.push({ id: uid(), source: suggestion.fileName, amount: suggestion.amount ?? 0 })
        } else if (suggestion.kind === 'dividend') {
          next.dividends.push({ id: uid(), source: suggestion.fileName, amount: suggestion.amount ?? 0 })
        } else if (suggestion.kind === 'pensionIncome') {
          next.pensions.push({
            id: uid(),
            source: suggestion.fileName,
            amount: suggestion.amount ?? 0,
            taxDeducted: suggestion.taxDeducted ?? 0,
          })
        } else if (suggestion.kind === 'otherIncome') {
          next.other.push({ id: uid(), description: suggestion.fileName, amount: suggestion.amount ?? 0 })
        } else if (suggestion.kind === 'pensionContribution') {
          next.reliefs.personalPensionContributionsNet += suggestion.amount ?? 0
        } else if (suggestion.kind === 'giftAid') {
          next.reliefs.giftAidNet += suggestion.amount ?? 0
        }
      }
      return next
    })
  }, [])

  const allocateProperty = useCallback((sourceId: string, targetId: string, receiptIsRent: boolean,
    confirmSeparateExpenses: boolean, rentalIncomeResolution?: RentalIncomeResolution) => {
    setData((current) => ({
      ...current, properties: allocatePropertyEntries(current.properties, sourceId, targetId, receiptIsRent,
        confirmSeparateExpenses, rentalIncomeResolution),
    }))
  }, [])

  const allocateToNewProperty = useCallback((sourceId: string, name: string, receiptIsRent: boolean,
    confirmSeparateExpenses: boolean) => {
    const id = uid()
    setData((current) => ({
      ...current, properties: allocateToNewPropertyEntries(current.properties, sourceId, name, id, receiptIsRent, confirmSeparateExpenses),
    }))
  }, [])

  const reconcileRentalIncome = useCallback((propertyId: string, candidate: RentalIncomeCandidate,
    resolution: RentalIncomeResolution, replaceLegacyAggregate: boolean) => {
    setData((current) => ({
      ...current,
      properties: reconcileRentalIncomeCandidateEntries(current.properties, propertyId, candidate,
        resolution, replaceLegacyAggregate),
    }))
  }, [])

  const moveBankReference = useCallback((sourceId: string, targetId: string, index: number) => {
    setData((current) => ({
      ...current, properties: moveBankReferenceEntries(current.properties, sourceId, targetId, index),
    }))
  }, [])

  const removeRentalIncome = useCallback((propertyId: string, evidenceIds: string[]) => {
    const previous = dataRef.current.properties.find((item) => item.id === propertyId)
    if (previous) {
      remember(`Removed ${evidenceIds.length} matched receipt${evidenceIds.length === 1 ? '' : 's'} from ${previous.name || 'property'}`,
        restoreProperty(previous))
    }
    setData((current) => ({
      ...current, properties: removeRentalIncomeEvidence(current.properties, propertyId, evidenceIds),
    }))
  }, [remember])

  const removePropertyExpenses = useCallback((propertyId: string, expenseIds: string[], label: string) => {
    const previous = dataRef.current.properties.find((item) => item.id === propertyId)
    if (previous) remember(label, restoreProperty(previous))
    setData((current) => ({
      ...current,
      properties: current.properties.map((item) => item.id === propertyId ? removePropertyExpenseRows(item, expenseIds) : item),
    }))
  }, [remember])

  const confirmBankRelief = useCallback((sourceId: string, amount: number) => {
    setData((current) => confirmBankReliefAmount(current, sourceId, amount))
  }, [])

  const setPrivatePensionRecipients = useCallback((recipients: string[]) => {
    const previous = dataRef.current.privatePensionRecipients
    const removed = (previous ?? []).filter((name) => !recipients.includes(name))
    if (removed.length) remember(`Removed pension recipient “${removed.join('”, “')}”`, restoreField('privatePensionRecipients', previous))
    setData((current) => ({ ...current, privatePensionRecipients: recipients }))
  }, [remember])

  const setCharitableDonationRecipients = useCallback((recipients: string[]) => {
    const previous = dataRef.current.charitableDonationRecipients
    const removed = (previous ?? []).filter((name) => !recipients.includes(name))
    if (removed.length) remember(`Removed charity recipient “${removed.join('”, “')}”`, restoreField('charitableDonationRecipients', previous))
    setData((current) => ({ ...current, charitableDonationRecipients: recipients }))
  }, [remember])

  function listMutators<K extends ListKey>(key: K) {
    const add = (item: TaxReturnData[K][number]) =>
      setData((d) => ({ ...d, [key]: [...(d[key] as any[]), item] } as TaxReturnData))
    const update = (id: string, patch: Partial<TaxReturnData[K][number]>) =>
      setData((d) => ({
        ...d,
        [key]: (d[key] as any[]).map((item) => (item.id === id ? { ...item, ...patch } : item)),
      } as TaxReturnData))
    const remove = (id: string) => {
      const list = dataRef.current[key] as TaxReturnData[K][number][]
      const index = list.findIndex((item) => (item as { id: string }).id === id)
      if (index >= 0) remember(removalLabel(key, list[index]), reinsertListItem(key, list[index], index))
      setData((d) => ({ ...d, [key]: (d[key] as any[]).filter((item) => item.id !== id) } as TaxReturnData))
    }
    return { add, update, remove }
  }

  return {
    data,
    setData,
    replaceData,
    undo,
    lastUndo: undoStack[undoStack.length - 1],
    undoCount: undoStack.length,
    loadExample,
    reset,
    setTaxYear,
    removeBusinessInvoice,
    updatePersonal,
    updateReliefs,
    importDocumentSuggestions,
    allocateProperty,
    allocateToNewProperty,
    reconcileRentalIncome,
    moveBankReference,
    removeRentalIncome,
    removePropertyExpenses,
    confirmBankRelief,
    setPrivatePensionRecipients,
    setCharitableDonationRecipients,
    employments: listMutators('employments'),
    properties: listMutators('properties'),
    savings: listMutators('savings'),
    dividends: listMutators('dividends'),
    pensions: listMutators('pensions'),
    other: listMutators('other'),
    uid,
  }
}
