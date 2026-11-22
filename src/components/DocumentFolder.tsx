import { useEffect, useMemo, useRef, useState } from 'react'
import type { EmploymentIncome, TaxReturnData } from '../types'
import type { PropertyLet } from '../types'
import { buildDocumentChecklist } from '../engine/documentChecklist'
import { DocumentChecklistPanel } from './DocumentChecklist'
import {
  analyzeDocument,
  isSupportedDocument,
  type DocumentSuggestion,
} from '../engine/documentImport'
import {
  findCharityCandidates,
  findRentalIncomeCandidates,
  matchesBankRecipient,
  type CharityCandidate,
  type RentalIncomeCandidate,
  type SourcedBankTransaction,
} from '../engine/bankTransactions'
import type { DocumentExportSnapshot } from '../engine/spreadsheetExport'
import { EVIDENCE_TIERS, evidenceTier } from '../engine/evidenceConfidence'
import { findPropertyMentions, resolvePropertyNames, sameProperty, type PropertyMention } from '../engine/propertyDiscovery'
import { setSourceFiles } from '../state/sourceFiles'
import {
  reconcileRentalIncomeCandidate as previewRentalReconciliation,
  type RentalIncomeResolution,
} from '../engine/propertyImport'

interface FileHandleLike {
  kind: 'file'
  getFile(): Promise<File>
}

interface DirectoryHandleLike {
  kind: 'directory'
  name: string
  entries(): AsyncIterableIterator<[string, FileHandleLike | DirectoryHandleLike]>
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: (options: { mode: 'read' }) => Promise<DirectoryHandleLike>
}

async function collectFiles(directory: DirectoryHandleLike): Promise<File[]> {
  const files: File[] = []
  for await (const [, entry] of directory.entries()) {
    if (entry.kind === 'file') files.push(await entry.getFile())
    else files.push(...await collectFiles(entry))
  }
  return files
}

export function DocumentFolder({
  taxYearId,
  onImport,
  properties,
  onReconcileRentalIncome,
  employments,
  pensionRecipients,
  onPensionRecipientsChange,
  donationRecipients,
  onDonationRecipientsChange,
  onExportSnapshot,
  returnData,
  companyMode,
  onOpenIncome,
}: {
  taxYearId: string
  onImport: (suggestions: DocumentSuggestion[]) => void
  properties: PropertyLet[]
  onReconcileRentalIncome: (propertyId: string, candidate: RentalIncomeCandidate,
    resolution: RentalIncomeResolution, replaceLegacyAggregate: boolean) => void
  employments: EmploymentIncome[]
  pensionRecipients?: string[]
  onPensionRecipientsChange: (recipients: string[]) => void
  donationRecipients?: string[]
  onDonationRecipientsChange: (recipients: string[]) => void
  onExportSnapshot: (snapshot: DocumentExportSnapshot) => void
  returnData: TaxReturnData
  companyMode: boolean
  onOpenIncome: () => void
}) {
  const employmentsRef = useRef(employments)
  employmentsRef.current = employments
  // Read at analysis time only: property names change as documents are imported, which must not restart analysis.
  const propertyNamesRef = useRef<string[]>([])
  propertyNamesRef.current = properties.filter((item) => !item.name.startsWith('Unallocated') && item.name.trim())
    .map((item) => item.name)
  const [files, setFiles] = useState<File[]>([])
  useEffect(() => setSourceFiles(files), [files])
  const [folderName, setFolderName] = useState('')
  const [suggestions, setSuggestions] = useState<DocumentSuggestion[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const [selectingFolder, setSelectingFolder] = useState(false)
  const [selectionStatus, setSelectionStatus] = useState('')
  const [recipientInput, setRecipientInput] = useState('')
  const [recipientError, setRecipientError] = useState('')
  const [donationRecipientInput, setDonationRecipientInput] = useState('')
  const [donationRecipientError, setDonationRecipientError] = useState('')
  const [bankTransactions, setBankTransactions] = useState<SourcedBankTransaction[]>([])
  const [rentalTargets, setRentalTargets] = useState<Record<string, string>>({})
  const [rentalConfirmations, setRentalConfirmations] = useState<Record<string, boolean>>({})
  const [legacyReplacements, setLegacyReplacements] = useState<Record<string, boolean>>({})
  const [showOneOffRentalCandidates, setShowOneOffRentalCandidates] = useState(false)
  const [rentalResolutions, setRentalResolutions] = useState<Record<string, RentalIncomeResolution | ''>>({})
  const [rentalErrors, setRentalErrors] = useState<Record<string, string>>({})
  const [rentalStatus, setRentalStatus] = useState('')
  const [charitySelections, setCharitySelections] = useState<Record<string, boolean>>({})
  const [charityEvaluationStatus, setCharityEvaluationStatus] = useState('')
  const charityCandidates = useMemo(() => findCharityCandidates(bankTransactions, pensionRecipients, donationRecipients),
    [bankTransactions, pensionRecipients, donationRecipients])
  const allRentalIncomeCandidates = useMemo(() => findRentalIncomeCandidates(bankTransactions), [bankTransactions])
  const recurringRentalIncomeIds = new Set(allRentalIncomeCandidates
    .filter((candidate) => candidate.payments.length >= 2).map((candidate) => candidate.id))
  // Receipts already reconciled as rent, or ticked as other taxable income, are no longer rent suggestions.
  const reconciledRentalPaymentIds = new Set([
    ...properties.flatMap((item) => (item.rentalIncomeEvidence ?? []).map((evidence) => evidence.id)),
    ...returnData.other.flatMap((item) => (item.receipts ?? []).filter((receipt) => receipt.taxable).map((receipt) => receipt.id)),
  ])
  const rentalIncomeCandidates = allRentalIncomeCandidates.map((candidate) => {
    const payments = candidate.payments.filter((payment) => !reconciledRentalPaymentIds.has(payment.id))
    return {
      ...candidate, payments, recurring: recurringRentalIncomeIds.has(candidate.id),
      total: Math.round(payments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100,
    }
  }).filter((candidate) => candidate.payments.length > 0)
  const recurringRentalIncomeCandidates = rentalIncomeCandidates.filter((candidate) => candidate.recurring)
    .sort((a, b) => (b.regular?.months ?? 0) - (a.regular?.months ?? 0))
  const oneOffRentalIncomeCandidates = rentalIncomeCandidates.filter((candidate) => !candidate.recurring)
  const isCharityCandidateSelected = (candidate: CharityCandidate) =>
    charitySelections[candidate.id] ?? (candidate.confidence !== 'monthlyReview')
  const legacyRentalAggregates = (candidate: RentalIncomeCandidate) => properties.filter((item) =>
    item.name.startsWith('Unallocated') && item.rentalIncome > 0 &&
    item.documentSources?.some((source) =>
      candidate.sourceKeys.some((sourceKey) => source.startsWith(`${sourceKey}:`))))
  /** Your choice, otherwise the property named in the receipts (e.g. "REF.4 PEARL CHAMBERS"). */
  const rentalTargetFor = (candidate: RentalIncomeCandidate) => {
    if (candidate.id in rentalTargets) return rentalTargets[candidate.id]
    const named = findPropertyMentions(candidate.description).map((mention) => mention.name)
    return properties.find((item) => !item.name.startsWith('Unallocated') &&
      named.some((name) => sameProperty(name, item.name)))?.id ?? ''
  }

  function reconcileRentalIncome(candidate: RentalIncomeCandidate) {
    const targetId = rentalTargetFor(candidate)
    const target = properties.find((item) => item.id === targetId)
    if (!target) {
      setRentalErrors((current) => ({ ...current, [candidate.id]: 'Choose an existing property first. Add one in Income if needed.' }))
      return
    }
    if (!rentalConfirmations[candidate.id]) {
      setRentalErrors((current) => ({ ...current, [candidate.id]: 'Confirm that these receipts belong to this property before reconciling them.' }))
      return
    }
    const legacy = legacyRentalAggregates(candidate)
    if (legacy.length && !legacyReplacements[candidate.id]) {
      setRentalErrors((current) => ({ ...current, [candidate.id]: 'Confirm replacement of the old unallocated total before reconciling individual receipts.' }))
      return
    }
    const resolution = target.rentalIncome > 0 ? rentalResolutions[candidate.id] || undefined : 'additional'
    if (!resolution) {
      setRentalErrors((current) => ({ ...current, [candidate.id]: 'Choose whether to add this amount or link it to the existing total without adding it again.' }))
      return
    }
    const selectedCandidate = { ...candidate, payments: candidate.payments }
    try {
      previewRentalReconciliation(properties, target.id, selectedCandidate, resolution, legacy.length > 0)
      onReconcileRentalIncome(target.id, selectedCandidate, resolution, legacy.length > 0)
      setRentalErrors((current) => {
        const next = { ...current }
        delete next[candidate.id]
        return next
      })
      setRentalStatus(`${candidate.description} from ${candidate.source} reconciled with ${target.name}. Check the property’s rental-income evidence in Income.`)
    } catch (cause) {
      setRentalErrors((current) => ({
        ...current,
        [candidate.id]: cause instanceof Error ? cause.message : String(cause),
      }))
    }
  }

  useEffect(() => {
    onExportSnapshot({
      taxYearId,
      files: files.map((file) => ({ name: file.name, relativePath: file.webkitRelativePath, size: file.size })),
      suggestions,
      charityCandidates: charityCandidates.map((candidate) => ({ ...candidate, selected: isCharityCandidateSelected(candidate) })),
      bankTransactions, warnings, progress, error,
    })
  }, [taxYearId, files, suggestions, charityCandidates, charitySelections, bankTransactions, warnings, progress, error, onExportSnapshot])

  useEffect(() => {
    setCharitySelections({})
    setCharityEvaluationStatus('')
    setRentalTargets({})
    setRentalConfirmations({})
    setLegacyReplacements({})
    setShowOneOffRentalCandidates(false)
    setRentalResolutions({})
    setRentalErrors({})
    setRentalStatus('')
  }, [files, taxYearId])

  useEffect(() => {
    let cancelled = false
    // Workbooks first (their sheet names are the most reliable property names), Word expense documents last so
    // properties identified elsewhere exist to match their costs against.
    const order = (file: File) => /\.(xlsx|xlsm)$/i.test(file.name) ? 0 : /\.docx$/i.test(file.name) ? 2 : 1
    const supported = files.filter(isSupportedDocument).sort((a, b) => order(a) - order(b))
    setSuggestions([])
    setWarnings([])
    setImportedCount(0)
    setBankTransactions([])
    if (!supported.length) {
      setProgress('')
      setWarnings(files.length
        ? ['None of the selected files are supported. Choose PDF, CSV, XLSX/XLSM, Word (.docx) or a common image format.']
        : [])
      return () => { cancelled = true }
    }

    async function analyzeFiles() {
      const nextWarnings: string[] = []
      const skippedCount = files.length - supported.length
      if (skippedCount > 0) {
        nextWarnings.push(`${skippedCount} unsupported file${skippedCount === 1 ? '' : 's'} skipped. Supported: PDF, CSV, XLSX/XLSM, Word (.docx) and common image formats.`)
      }

      const mentions: PropertyMention[] = []
      const created: string[] = []
      const knownNames = () => [...propertyNamesRef.current, ...created].filter((name, position, all) => all.indexOf(name) === position)
      // Creates empty named properties for names found in documents, so evidence can be matched to them automatically.
      const createProperties = (names: string[], source: string) => {
        const fresh = names.filter((name) => !knownNames().some((known) => sameProperty(known, name)))
        if (!fresh.length) return
        created.push(...fresh)
        onImport(fresh.map((name): DocumentSuggestion => ({
          id: `discovered:${name}`, fileName: source, kind: 'property', title: `Property identified: ${name}`,
          detail: `${name} is named in your documents (e.g. ${source}) and was created automatically. Check its ownership share.`,
          confidence: 'medium', selected: true, propertyName: name,
          propertySourceId: `discovered:${name.toLowerCase()}:${taxYearId}`, propertyTaxYearId: taxYearId,
        })))
        nextWarnings.push(`Properties identified from your documents: ${fresh.join(', ')}. Check each one’s ownership share in Income.`)
      }

      for (let index = 0; index < supported.length; index += 1) {
        if (cancelled) return
        const file = supported[index]
        setProgress(`Reading ${index + 1} of ${supported.length}: ${file.name}`)
        const analysis = await analyzeDocument(file, taxYearId, pensionRecipients, donationRecipients, knownNames())
        if (cancelled) return
        setBankTransactions((current) => [...current, ...(analysis.bankTransactions ?? [])])
        const automatic = analysis.suggestions.filter((suggestion) => {
          if (suggestion.propertySourceId || suggestion.bankSource) return true
          if (!suggestion.p60SourceId) return false
          const conflict = employmentsRef.current.find((employment) =>
            employment.p60Source?.id !== suggestion.p60SourceId &&
            employment.employer.trim().toLowerCase() === suggestion.employer?.trim().toLowerCase(),
          )
          if (conflict) {
            nextWarnings.push(`${file.name}: Income already has an entry for this employer. P60 autofill was blocked to avoid double counting or overwriting your changes; reconcile that entry with the P60 manually.`)
            return false
          }
          return true
        })
        if (automatic.length) onImport(automatic)
        created.push(...automatic.filter((suggestion) => suggestion.propertyName && !suggestion.propertyName.startsWith('Unallocated'))
          .map((suggestion) => suggestion.propertyName!))
        mentions.push(...analysis.propertyMentions ?? [])
        // Clearly named properties are created straight away so later documents can be matched to them.
        createProperties(resolvePropertyNames(mentions.filter((mention) => mention.typed), knownNames()), file.name)
        setSuggestions((current) => [...current, ...analysis.suggestions.filter((suggestion) => !suggestion.p60SourceId && !suggestion.propertySourceId && !suggestion.bankSource)])
        if (automatic.some((suggestion) => suggestion.bankSource)) nextWarnings.push(`${file.name}: bank payments to check have been added to Income (interest, unidentified money paid in, and any pension or charity payments).`)
        if (automatic.some((suggestion) => suggestion.p60SourceId)) nextWarnings.push(`${file.name}: P60 figures populated in Income (or already present). Verify them there before relying on the computation.`)
        if (!/\.docx$/i.test(file.name) && automatic.some((suggestion) => suggestion.propertySourceId)) nextWarnings.push(`${file.name}: Property figures and bank evidence populated in Income (or already present). Allocate bank receipts/mortgages to the appropriate property and verify costs there.`)
        nextWarnings.push(...analysis.warnings)
        setWarnings([...nextWarnings])
      }
      if (cancelled) return
      // Partial names (e.g. "DRAYTON" in rent references) only once every document has had a chance to give the full name.
      createProperties(resolvePropertyNames(mentions, knownNames()), 'your bank references')
      setWarnings([...nextWarnings])
      setProgress('Analysis complete. Check every suggestion against the original documents.')
    }

    void analyzeFiles()
    return () => { cancelled = true }
  }, [files, taxYearId, onImport, pensionRecipients, donationRecipients])

  async function pickFolder() {
    setError('')
    setSelectingFolder(true)
    setSelectionStatus('Waiting for the browser folder picker...')
    try {
      const pickerWindow = window as WindowWithDirectoryPicker
      if (!pickerWindow.showDirectoryPicker) throw new Error('This browser does not support the alternative picker. Use Choose folder or Choose files.')
      const directory = await pickerWindow.showDirectoryPicker({ mode: 'read' })
      setSelectionStatus(`Reading files from ${directory.name}...`)
      const selectedFiles = await collectFiles(directory)
      setFolderName(directory.name)
      setFiles(selectedFiles)
      setSelectionStatus(`Selected ${directory.name}: ${selectedFiles.length} files.`)
    } catch (e) {
      const errorName = e && typeof e === 'object' && 'name' in e ? String(e.name) : ''
      const message = e instanceof Error ? e.message : String(e)
      setSelectionStatus('')
      setError(errorName === 'AbortError'
        ? 'The browser cancelled or rejected the folder selection. Try Choose folder (standard input) or Choose files. Your previous selection has not changed.'
        : `Couldn\u2019t read that folder — ${message}`)
    } finally {
      setSelectingFolder(false)
    }
  }

  function updateSuggestion(id: string, patch: Partial<DocumentSuggestion>) {
    setSuggestions((current) => current.map((suggestion) =>
      suggestion.id === id ? { ...suggestion, ...patch } : suggestion,
    ))
  }

  function openOriginal(fileName: string) {
    const file = files.find((candidate) => candidate.name === fileName)
    if (!file) return
    const url = URL.createObjectURL(file)
    window.open(url, '_blank', 'noopener')
    // Keep the local URL alive long enough for the new tab to load the file.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function importSelected() {
    const selected = suggestions.filter((suggestion) => suggestion.selected && suggestion.kind !== 'payslipReference')
    if (!selected.length) return
    const personalValues = new Map<string, unknown>()
    for (const suggestion of selected) {
      for (const [field, value] of Object.entries(suggestion.personalPatch ?? {})) {
        if (personalValues.has(field) && personalValues.get(field) !== value) {
          setError(`Selected documents disagree on ${field}. Select only the answer you have verified before importing.`)
          return
        }
        personalValues.set(field, value)
      }
    }
    if ((personalValues.get('claimsChildBenefit') === false &&
      Number(personalValues.get('childBenefitAnnualAmount')) > 0) ||
      (personalValues.get('hasStudentLoan') === false &&
        personalValues.has('studentLoanPlan') && personalValues.get('studentLoanPlan') !== 'none')) {
      setError('Selected personal answers conflict: check Child Benefit or student loan evidence and select consistent answers.')
      return
    }
    setError('')
    onImport(selected)
    setImportedCount((count) => count + selected.length)
    setSuggestions((current) => current.filter((suggestion) => !suggestion.selected))
  }

  function renderRentalCandidate(candidate: (typeof rentalIncomeCandidates)[number]) {
    const legacy = legacyRentalAggregates(candidate)
    const legacyTotal = legacy.reduce((sum, item) => sum + item.rentalIncome, 0)
    const target = properties.find((item) => item.id === rentalTargetFor(candidate))
    const needsResolution = !!target && target.rentalIncome > 0
    const resolution = rentalResolutions[candidate.id]
    return (
      <div className={`suggestion-row${candidate.regular ? ' rental-regular' : ''}`} key={candidate.id}>
        <div>
          <strong>{candidate.description}</strong>
          {candidate.regular && (
            <span className="evidence-badges">
              <span className="evidence-badge evidence-badge-recognised">
                Same amount, consecutive months: £{candidate.regular.amount.toFixed(2)} × {candidate.regular.months}
              </span>
            </span>
          )}
          <p className="hint">
            {candidate.basis === 'rentLabel' ? 'Rent-labelled receipts'
              : candidate.basis === 'flatDescription' ? 'Property-labelled; possible rent'
                : 'Unclassified incoming payments; check whether this is another tenant'}
            {' '}· {candidate.source} · Suggested total: £{candidate.total.toFixed(2)}
          </p>
          <details>
            <summary>Review {candidate.payments.length} receipt{candidate.payments.length === 1 ? '' : 's'}</summary>
            <ul>{candidate.payments.map((payment) => (
              <li key={payment.id}>
                {payment.date?.toLocaleDateString('en-GB')} — {payment.description} — £{payment.amount.toFixed(2)}
              </li>
            ))}</ul>
          </details>
          {legacyTotal > 0 && (
            <p className="hint">
              This source previously created an unallocated total of £{legacyTotal.toFixed(2)}. Confirming
              replacement removes that aggregate; unmatched receipt groups remain pending.
            </p>
          )}
        </div>
        <div className="suggestion-values">
          <label>
            Match to property
            <select value={rentalTargetFor(candidate)} onChange={(event) => {
              setRentalTargets((current) => ({ ...current, [candidate.id]: event.target.value }))
              setRentalConfirmations((current) => ({ ...current, [candidate.id]: false }))
              setLegacyReplacements((current) => ({ ...current, [candidate.id]: false }))
              setRentalResolutions((current) => ({ ...current, [candidate.id]: '' }))
              setRentalErrors((current) => ({ ...current, [candidate.id]: '' }))
            }}>
              <option value="">Choose property</option>
              {properties.filter((item) => !item.name.startsWith('Unallocated'))
                .map((item) => <option key={item.id} value={item.id}>{item.name || 'Unnamed property'}</option>)}
            </select>
          </label>
          {target && (
            <>
              <p className="hint">Current rental-income total: £{target.rentalIncome.toFixed(2)}</p>
              {needsResolution && (
                <fieldset className="rental-income-resolution">
                  <legend>Reconcile £{candidate.total.toFixed(2)} from this source</legend>
                  <label className="field checkbox">
                    <input type="radio" name={`rental-resolution-${candidate.id}`} checked={resolution === 'additional'}
                      onChange={() => setRentalResolutions((current) => ({ ...current, [candidate.id]: 'additional' }))} />
                    <span>Add it; these receipts are not already in the current total</span>
                  </label>
                  <label className="field checkbox">
                    <input type="radio" name={`rental-resolution-${candidate.id}`} checked={resolution === 'alreadyIncluded'}
                      onChange={() => setRentalResolutions((current) => ({ ...current, [candidate.id]: 'alreadyIncluded' }))} />
                    <span>It is already included; link the evidence without adding it again</span>
                  </label>
                </fieldset>
              )}
              <label className="field checkbox">
                <input type="checkbox" checked={rentalConfirmations[candidate.id] ?? false}
                  onChange={(event) => setRentalConfirmations((current) => ({ ...current, [candidate.id]: event.target.checked }))} />
                <span>{candidate.basis === 'unclassifiedIncome'
                  ? 'I confirm these are rent for this property, not a deposit, refund, transfer or other income'
                  : 'I confirmed these receipts are rent for this property and checked for duplicate statements'}</span>
              </label>
              {!!legacy.length && (
                <label className="field checkbox">
                  <input type="checkbox" checked={legacyReplacements[candidate.id] ?? false}
                    onChange={(event) => setLegacyReplacements((current) => ({ ...current, [candidate.id]: event.target.checked }))} />
                  <span>Replace the previous £{legacyTotal.toFixed(2)} aggregate with these separate sources</span>
                </label>
              )}
              <button type="button" className="ghost-btn"
                disabled={!rentalConfirmations[candidate.id] || (needsResolution && !resolution) ||
                  (!!legacy.length && !legacyReplacements[candidate.id])}
                onClick={() => reconcileRentalIncome(candidate)}>
                Reconcile source with property
              </button>
            </>
          )}
          {!properties.some((item) => !item.name.startsWith('Unallocated')) && (
            <p className="hint">Add the property in Income before reconciling this suggestion.</p>
          )}
          {rentalErrors[candidate.id] && <p className="hint error" role="alert">{rentalErrors[candidate.id]}</p>}
        </div>
      </div>
    )
  }

  const checklist = buildDocumentChecklist(returnData, files.map((file) => file.name))
  const supportsFolderPicker = typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function'

  return (
    <div className="card document-card">
      <h2>Tax return records</h2>
      <section className="folder-start" aria-labelledby="folder-start-heading">
        <div className="folder-start-copy">
          <p className="step-label">START HERE <span>01</span></p>
          <h3 id="folder-start-heading">Choose your tax-year folder</h3>
          <p>Choose the folder with your tax documents and bank statements. We’ll read them and fill in what we can.</p>
          <p className="folder-privacy">Your files stay on this device. They are read in your browser and never uploaded.</p>
        </div>
        <div className="document-actions folder-actions">
          <label className="document-file-label folder-primary-btn">
            Choose folder
            <input
              aria-label="Choose document folder"
              type="file"
              multiple
              disabled={selectingFolder}
              ref={(input) => { input?.setAttribute('webkitdirectory', '') }}
              onChange={(event) => {
                const selectedFiles = Array.from(event.currentTarget.files ?? [])
                if (!selectedFiles.length) {
                  setError('No readable files were selected. Try Choose files or a locally available folder.')
                  return
                }
                const name = selectedFiles[0].webkitRelativePath.split('/')[0] || 'Selected folder'
                setError('')
                setFolderName(name)
                setFiles(selectedFiles)
                setSelectionStatus(`Selected ${name}: ${selectedFiles.length} files.`)
                event.currentTarget.value = ''
              }}
            />
          </label>
          {supportsFolderPicker && (
            <button type="button" className="ghost-btn" disabled={selectingFolder} onClick={pickFolder}>
              Alternative folder picker
            </button>
          )}
          <label className="add-btn document-file-label folder-files-btn">
            Choose files instead
            <input
              aria-label="Choose document files"
              type="file"
              multiple
              accept=".pdf,.csv,.xlsx,.xlsm,.docx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
              onChange={(event) => {
                setError('')
                setSelectionStatus('')
                setFolderName('')
                setFiles(Array.from(event.currentTarget.files ?? []))
                event.currentTarget.value = ''
              }}
            />
          </label>
        </div>
        <details className="folder-guidance">
          <summary>Tips for choosing files</summary>
          <p>Subfolders are included. For OneDrive, choose the synced folder and make sure the files are available
            offline. After reloading the page you’ll need to choose the files again; anything already added to your
            return is kept. Reading scanned documents downloads a text-recognition tool, but your files stay on this device.</p>
        </details>
        {selectionStatus && <p className="hint folder-status" role="status">{selectionStatus}</p>}
        {error && <p className="hint error folder-status" role="alert">{error}</p>}
        {files.length > 0 && (
          <p className="hint folder-status">
            {files.length} file{files.length === 1 ? '' : 's'} selected{folderName ? ` from ${folderName}` : ''}.
            {' '}Bank transactions outside {taxYearId} are ignored.
          </p>
        )}
        {progress && <p className="hint folder-status" role="status">{progress}</p>}
      </section>
      <DocumentChecklistPanel checklist={checklist} filesChosen={files.length > 0} onOpenIncome={onOpenIncome} />
      {!companyMode && (<>
      {(rentalIncomeCandidates.length > 0 || rentalStatus ||
        (!files.length && properties.some((item) => item.name.startsWith('Unallocated') && item.rentalIncome > 0))) && (
      <section className="suggestion-review" aria-label="Rental income suggestions">
        <p className="step-label">REVIEW</p>
        <h3>Could any of this be rent?</h3>
        <p className="hint">
          Money paid into your account that might be rent, grouped by who paid it. Regular payers come first.
          Match a payer to a property only if it really is rent.
        </p>
        {!recurringRentalIncomeCandidates.length && !!oneOffRentalIncomeCandidates.length && (
          <p className="charity-empty">No payer paid more than once in {taxYearId}.</p>
        )}
        {recurringRentalIncomeCandidates.map(renderRentalCandidate)}
        {!!oneOffRentalIncomeCandidates.length && (
          <details className="one-off-rental" open={showOneOffRentalCandidates}
            onToggle={(event) => setShowOneOffRentalCandidates(event.currentTarget.open)}>
            <summary>
              {oneOffRentalIncomeCandidates.length} one-off payment{oneOffRentalIncomeCandidates.length === 1 ? '' : 's'}
              {' '}— open only if one of these could be rent
            </summary>
            {showOneOffRentalCandidates && oneOffRentalIncomeCandidates.map(renderRentalCandidate)}
          </details>
        )}
        {!files.length && properties.some((item) => item.name.startsWith('Unallocated') && item.rentalIncome > 0) && (
          <p className="hint">
            Some rent from an earlier import hasn’t been matched to a property yet, so it isn’t counted. Choose the
            same bank files again to match it payer by payer.
          </p>
        )}
        {rentalStatus && <p className="hint" role="status">{rentalStatus}</p>}
      </section>
      )}
      {bankTransactions.length > 0 && (
      <section className="suggestion-review charity-review" aria-label="Charity suggestions">
        <div className="review-heading">
          <div>
            <p className="step-label">REVIEW</p>
            <h3>Charity donations</h3>
          </div>
          {charityCandidates.length > 0 && (
            <span className="candidate-count">{charityCandidates.length} possible recipient{charityCandidates.length === 1 ? '' : 's'}</span>
          )}
        </div>
        <p className="hint">
          Payments that look like charity donations. Tick the ones that are, then press <strong>Use selected</strong>.
          Gift Aid is only claimed after you confirm it in Income.
        </p>
        {!charityCandidates.length && (
          <p className="charity-empty">No likely charity payments found. If we missed one, add it below.</p>
        )}
        {!!charityCandidates.length && (
          <>
            <div className="candidate-actions">
              <button type="button" className="ghost-btn" onClick={() =>
                setCharitySelections(Object.fromEntries(charityCandidates.map((candidate) => [candidate.id, true])))}>Select all</button>
              <button type="button" className="ghost-btn" onClick={() =>
                setCharitySelections(Object.fromEntries(charityCandidates.map((candidate) => [candidate.id, false])))}>Clear selection</button>
            </div>
            <div className="expense-table-scroll"><table className="expense-table">
              <thead><tr><th>Use</th><th>Recipient</th><th>Payments</th><th>Total paid</th><th>Details</th></tr></thead>
              <tbody>{charityCandidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td><input type="checkbox" aria-label={`Use ${candidate.recipient}`}
                    checked={isCharityCandidateSelected(candidate)}
                    onChange={(event) => setCharitySelections((current) => ({ ...current, [candidate.id]: event.target.checked }))} /></td>
                  <td><strong>{candidate.recipient}</strong>
                    <span className="evidence-badges">
                      <span className={`evidence-badge evidence-badge-${candidate.confidence === 'identified' ? 'recognised'
                        : candidate.confidence === 'likely' ? 'probable' : 'confirm'}`}>
                        {candidate.confidence === 'identified' ? 'Recognised charity'
                          : candidate.confidence === 'likely' ? 'Likely donation' : 'Regular payee — check'}
                      </span>
                    </span>
                    <p className="hint">{candidate.reason}</p></td>
                  <td>{candidate.payments.length}</td><td>£{candidate.total.toFixed(2)}</td>
                  <td><details><summary>View payments</summary><ul>{candidate.payments.map((payment) => (
                    <li key={payment.id}>{payment.date?.toLocaleDateString('en-GB')} — {payment.description} — £{Math.abs(payment.amount).toFixed(2)} ({payment.source})</li>
                  ))}</ul></details></td>
                </tr>
              ))}</tbody>
            </table></div>
            <button type="button" className="add-btn" disabled={!!progress && !progress.startsWith('Analysis complete') ||
              !charityCandidates.some(isCharityCandidateSelected)} onClick={() => {
              const selected = charityCandidates.filter(isCharityCandidateSelected)
              const added = selected.map((candidate) => candidate.recipient).filter((recipient) =>
                !matchesBankRecipient(recipient, donationRecipients ?? []))
              if (added.length) onDonationRecipientsChange([...donationRecipients ?? [], ...added])
              setCharityEvaluationStatus(`${selected.length} recipient${selected.length === 1 ? '' : 's'} added. Their payments now appear under Gift Aid in Income, ready for you to confirm.`)
            }}>Use selected</button>
          </>
        )}
        {charityEvaluationStatus && <p className="hint" role="status">{charityEvaluationStatus}</p>}
      </section>
      )}
      <details className="recipient-settings">
        <summary>
          Missed a pension or charity payment?
          {(pensionRecipients?.length ?? 0) + (donationRecipients?.length ?? 0) > 0 &&
            ` (${(pensionRecipients?.length ?? 0) + (donationRecipients?.length ?? 0)} added)`}
        </summary>
        <p className="hint">Type the name exactly as it appears on your bank statement. We’ll look for it again in your
          chosen files and add matching payments to Income for you to confirm.</p>
        <section className="pension-recipient-settings" aria-label="Private pension payment recipients">
          <label className="field">
            <span>Pension provider you pay into yourself</span>
            <input value={recipientInput} onChange={(event) => { setRecipientInput(event.target.value); setRecipientError('') }} />
          </label>
          <button type="button" className="ghost-btn" onClick={() => {
            const recipient = recipientInput.trim()
            if (recipient.replace(/[^a-z0-9]/gi, '').length < 3) {
              setRecipientError('Enter at least three letters or numbers from the provider’s name.')
              return
            }
            if (pensionRecipients?.some((name) => name.toLowerCase() === recipient.toLowerCase())) {
              setRecipientError('This name has already been added.')
              return
            }
            onPensionRecipientsChange([...pensionRecipients ?? [], recipient])
            setRecipientInput('')
          }}>Add pension provider</button>
          {recipientError && <p className="hint error" role="alert">{recipientError}</p>}
          {!!pensionRecipients?.length && (
            <ul>{pensionRecipients.map((recipient) => (
              <li key={recipient}>{recipient} <button type="button" className="ghost-btn" onClick={() =>
                onPensionRecipientsChange(pensionRecipients.filter((name) => name !== recipient))}>Remove</button></li>
            ))}</ul>
          )}
        </section>
        <section aria-label="Charitable donation recipients">
          <label className="field">
            <span>Charity you gave to</span>
            <input value={donationRecipientInput} onChange={(event) => { setDonationRecipientInput(event.target.value); setDonationRecipientError('') }} />
          </label>
          <button type="button" className="ghost-btn" onClick={() => {
            const recipient = donationRecipientInput.trim()
            if (recipient.replace(/[^a-z0-9]/gi, '').length < 3) {
              setDonationRecipientError('Enter at least three letters or numbers from the charity’s name.')
              return
            }
            if (donationRecipients?.some((name) => name.toLowerCase() === recipient.toLowerCase())) {
              setDonationRecipientError('This name has already been added.')
              return
            }
            onDonationRecipientsChange([...donationRecipients ?? [], recipient])
            setDonationRecipientInput('')
          }}>Add charity</button>
          {donationRecipientError && <p className="hint error" role="alert">{donationRecipientError}</p>}
          {!!donationRecipients?.length && (
            <ul>{donationRecipients.map((recipient) => (
              <li key={recipient}>{recipient} <button type="button" className="ghost-btn" onClick={() =>
                onDonationRecipientsChange(donationRecipients.filter((name) => name !== recipient))}>Remove</button></li>
            ))}</ul>
          )}
        </section>
        <p className="hint">Removing a name stops future matching. Anything already added to Income stays there for you to review.</p>
      </details>      </>)}
      {warnings.length > 0 && (
        <ul className="document-warnings">
          {warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
        </ul>
      )}

      {!companyMode && suggestions.length > 0 && (
        <section className="suggestion-review" aria-label="Extracted tax suggestions">
          <h3>Check figures we read from your documents</h3>
          <p className="hint">
            Tick the figures that match your documents, then press <strong>Add selected to my return</strong>. Don’t add
            the same income twice, for example from both a bank statement and a certificate.
          </p>
          {EVIDENCE_TIERS.map((tier) => {
            const group = suggestions.filter((suggestion) => evidenceTier(suggestion) === tier.id)
            if (!group.length) return null
            return (
          <div className={`evidence-group evidence-${tier.id}`} key={tier.id}>
            <h4>{tier.label} <span className="evidence-count">{group.length}</span></h4>
            <p className="hint">{tier.description}</p>
          {group.map((suggestion) => (
            <div className="suggestion-row" key={suggestion.id}>
              <label className="suggestion-choice">
                <input
                  type="checkbox"
                  disabled={suggestion.kind === 'payslipReference'}
                  checked={suggestion.selected}
                  onChange={(event) => updateSuggestion(suggestion.id, { selected: event.target.checked })}
                />
                <span>
                  <strong>{suggestion.title}</strong>
                  <span className="evidence-badges">
                    <span className={`evidence-badge evidence-badge-${tier.id}`}>{tier.label}</span>
                    {suggestion.ocr && <span className="evidence-badge evidence-badge-ocr">OCR — check digits</span>}
                  </span>
                  <small>{suggestion.fileName} · {suggestion.confidence} confidence</small>
                  <small>{suggestion.detail}</small>
                  {suggestion.sourceExcerpt
                    ? <small className="source-excerpt">Found in source: “{suggestion.sourceExcerpt}”</small>
                    : <small className="source-excerpt missing">Amount not located verbatim in the source text; check the original.</small>}
                </span>
              </label>
              <button type="button" className="ghost-btn open-original-btn"
                disabled={!files.some((file) => file.name === suggestion.fileName)}
                onClick={() => openOriginal(suggestion.fileName)}>
                Open original
              </button>
              {suggestion.kind === 'personal' ? (
                <div className="suggestion-values">
                  {Object.entries(suggestion.personalPatch ?? {}).map(([field, value]) => (
                    <p className="hint" key={field}>{field}: {typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</p>
                  ))}
                </div>
              ) : suggestion.kind === 'payslipReference' && suggestion.payslip ? (
                <div className="suggestion-values">
                  <p className="hint">
                    This week — gross: {suggestion.payslip.weekly.grossPay ?? 'not identified'};
                    {' '}tax: {suggestion.payslip.weekly.taxPaid ?? 'not identified'};
                    {' '}NI: {suggestion.payslip.weekly.niPaid ?? 'not identified'};
                    {' '}NEST: {suggestion.payslip.weekly.pensionPaid ?? 'not identified'}.
                  </p>
                  <p className="hint">
                    Year to date — gross: {suggestion.payslip.yearToDate.grossPay ?? 'not identified'};
                    {' '}tax: {suggestion.payslip.yearToDate.taxPaid ?? 'not identified'};
                    {' '}NI: {suggestion.payslip.yearToDate.niPaid ?? 'not identified'}.
                    {' '}Missing or ambiguous figures require checking the original. P60 remains the main source.
                  </p>
                </div>
              ) : suggestion.kind === 'property' ? (
                <div className="suggestion-values">
                  <p className="hint">
                    {suggestion.rentalIncome === undefined && 'Rental income not identified. '}
                    {suggestion.allowableExpenses === undefined && 'Allowable expenses not identified. '}
                    {suggestion.mortgageInterest === undefined && 'Mortgage interest not identified. '}
                    {suggestion.ownershipShare === undefined && 'Ownership not identified: the 100% placeholder must be checked. '}
                    Combine receipts and costs for the same property before importing; missing amounts shown as zero require checking.
                  </p>
                  <label>Property<input value={suggestion.propertyName ?? ''} onChange={(event) => updateSuggestion(suggestion.id, { propertyName: event.target.value })} /></label>
                  <label>Your ownership share (0–1)<input type="number" min="0" max="1" step="0.5" value={suggestion.ownershipShare ?? 1} onChange={(event) => updateSuggestion(suggestion.id, { ownershipShare: Number(event.target.value) })} /></label>
                  <label>Rental income (£)<input type="number" min="0" step="0.01" value={suggestion.rentalIncome ?? 0} onChange={(event) => updateSuggestion(suggestion.id, { rentalIncome: Number(event.target.value) })} /></label>
                  <label>Allowable expenses, excluding interest (£)<input type="number" min="0" step="0.01" value={suggestion.allowableExpenses ?? 0} onChange={(event) => updateSuggestion(suggestion.id, { allowableExpenses: Number(event.target.value) })} /></label>
                  <label>Annual interest found in this document (£)<input type="number" min="0" step="0.01" value={suggestion.mortgageInterest ?? 0} onChange={(event) => updateSuggestion(suggestion.id, { mortgageInterest: Number(event.target.value) })} /></label>
                </div>
              ) : suggestion.kind === 'employment' ? (
                <div className="suggestion-values">
                  <label>Employer<input value={suggestion.employer ?? ''} onChange={(event) => updateSuggestion(suggestion.id, { employer: event.target.value })} /></label>
                  {suggestion.amount !== undefined && (
                    <label>P60 pay (£)<input type="number" min="0" step="0.01" value={suggestion.amount} onChange={(event) => updateSuggestion(suggestion.id, { amount: Number(event.target.value) })} /></label>
                  )}
                  {suggestion.taxDeducted !== undefined && (
                    <label>Tax deducted (£)<input type="number" step="0.01" value={suggestion.taxDeducted} onChange={(event) => updateSuggestion(suggestion.id, { taxDeducted: Number(event.target.value) })} /></label>
                  )}
                  {suggestion.benefitsInKind !== undefined && (
                    <label>Benefits (£)<input type="number" min="0" step="0.01" value={suggestion.benefitsInKind} onChange={(event) => updateSuggestion(suggestion.id, { benefitsInKind: Number(event.target.value) })} /></label>
                  )}
                </div>
              ) : suggestion.amount !== undefined ? (
                <div className="suggestion-values">
                <label className="suggestion-amount">
                  {suggestion.kind === 'giftAid' ? 'Net donation (£)' : suggestion.kind === 'pensionContribution' ? 'Net contribution (£)' : 'Amount (£)'}
                  <input type="number" min="0" step="0.01" value={suggestion.amount} onChange={(event) => updateSuggestion(suggestion.id, { amount: Number(event.target.value) })} />
                </label>
                {suggestion.kind === 'pensionIncome' && suggestion.taxDeducted !== undefined && (
                  <label>Tax deducted (£)<input type="number" step="0.01" value={suggestion.taxDeducted} onChange={(event) => updateSuggestion(suggestion.id, { taxDeducted: Number(event.target.value) })} /></label>
                )}
                </div>
              ) : null}
            </div>
          ))}
          </div>
            )
          })}
          <button type="button" className="add-btn" onClick={importSelected}>
            Add selected to my return
          </button>
        </section>
      )}
      {importedCount > 0 && (
        <p className="hint" role="status">{importedCount} suggestion{importedCount === 1 ? '' : 's'} imported into your return.</p>
      )}
    </div>
  )
}
