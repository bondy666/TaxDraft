import { lazy, Suspense, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import './App.css'
import { useTaxReturn } from './state/useTaxReturn'
import { TAX_YEARS } from './data/taxYears'
import { calculateTax } from './engine/calculateTax'
import { checkReliefs } from './engine/reliefsCheck'
import { PersonalDetailsForm } from './components/PersonalDetailsForm'
import {
  EmploymentSection, PropertySection, SavingsSection, DividendSection, PensionSection, OtherIncomeSection, ReliefsSection,
} from './components/IncomeSections'
import { ComputationSummary } from './components/ComputationSummary'
import { ReliefsPanel } from './components/ReliefsPanel'
import { removeBankExpenses } from './engine/bankExpenseCleanup'
import { consolidateProperties } from './engine/propertyConsolidation'
import type { DocumentExportSnapshot } from './engine/spreadsheetExport'
import { buildReviewChecklist } from './engine/reviewChecklist'
import { ReviewChecklist } from './components/ReviewChecklist'
import { buildSearchIndex, type SearchTab } from './engine/searchIndex'
import { SearchBox } from './components/SearchBox'
import { UndoBar } from './components/UndoBar'
import { BusinessSection } from './components/BusinessSection'
import { CompanyComputation } from './components/CompanyComputation'
import { emptyBusiness, isCompanyMode } from './engine/business'

const STORAGE_KEY = 'taxdraft:draft'
// Drafts saved before the app was consistently named TaxDraft.
const LEGACY_STORAGE_KEY = 'self-assessment-workbook:draft'
const TABS = ['Documents', 'Personal', 'Income', 'Review', 'Computation', 'Reliefs'] as const
// Personal details and reliefs only matter for personal tax.
const COMPANY_TABS: readonly typeof TABS[number][] = ['Documents', 'Income', 'Review', 'Computation']
const DocumentFolder = lazy(() => import('./components/DocumentFolder').then((module) => ({ default: module.DocumentFolder })))

export default function App() {
  const tr = useTaxReturn()
  const [tab, setTab] = useState<typeof TABS[number]>('Documents')
  const [documentsOpened, setDocumentsOpened] = useState(true)
  const [loadedFromStorage, setLoadedFromStorage] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [documentExport, setDocumentExport] = useState<DocumentExportSnapshot>()
  const [documentSessionKey, setDocumentSessionKey] = useState(0)

  // Load a saved draft once, on first render.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    if (saved) {
      try {
        const restored = JSON.parse(saved)
        tr.setData({ ...restored, properties: consolidateProperties(removeBankExpenses(restored.properties)) })
      } catch {
        /* ignore a corrupt draft */
      }
    }
    setLoadedFromStorage(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave on every change, once the initial load has happened.
  useEffect(() => {
    if (loadedFromStorage) localStorage.setItem(STORAGE_KEY, JSON.stringify(tr.data))
  }, [tr.data, loadedFromStorage])

  const rates = TAX_YEARS[tr.data.taxYearId]
  const result = useMemo(() => calculateTax(tr.data, rates), [tr.data, rates])
  const flags = useMemo(() => checkReliefs(tr.data, rates, result), [tr.data, rates, result])
  const reviewItems = useMemo(
    () => buildReviewChecklist(tr.data, flags, documentExport),
    [tr.data, flags, documentExport],
  )
  const unresolvedReviewCount = reviewItems.filter((item) => item.severity !== 'info').length
  const companyMode = isCompanyMode(tr.data)
  const visibleTabs: readonly typeof TABS[number][] = companyMode ? COMPANY_TABS : TABS
  const activeTab = visibleTabs.includes(tab) ? tab : 'Income'
  const searchIndex = useMemo(() => {
    const entries = buildSearchIndex(tr.data, result, flags, reviewItems, documentExport)
    return companyMode
      ? entries.filter((entry) => entry.tab === 'Review' || entry.section === 'Self-employment and company')
      : entries
  }, [tr.data, result, flags, reviewItems, documentExport, companyMode])
  const updateBusiness = (update: (current: NonNullable<typeof tr.data.business>) => NonNullable<typeof tr.data.business>) =>
    tr.setData((current) => ({ ...current, business: update(current.business ?? emptyBusiness()) }))
  const businessSection = (
    <BusinessSection business={tr.data.business} taxYearId={tr.data.taxYearId}
      onRemove={tr.removeBusinessInvoice} onChange={updateBusiness} />
  )

  function openSearchResult(nextTab: SearchTab, text: string) {
    if (nextTab === 'Documents') setDocumentsOpened(true)
    setTab(nextTab)
    // Non-standard but widely supported: scrolls to and selects the text once the tab has rendered.
    window.setTimeout(() => {
      const finder = window as Window & { find?: (text: string, caseSensitive?: boolean, backwards?: boolean, wrap?: boolean) => boolean }
      window.getSelection()?.removeAllRanges()
      finder.find?.(text, false, false, true)
    }, 150)
  }

  async function exportSpreadsheet() {
    setExporting(true)
    setExportError('')
    setExportStatus('')
    try {
      const { downloadTaxSpreadsheet } = await import('./engine/spreadsheetExport')
      downloadTaxSpreadsheet(tr.data, result, rates, flags, documentExport)
      setExportStatus(`Spreadsheet download requested for ${tr.data.taxYearId}. It contains personal financial information; store it securely.`)
    } catch (cause) {
      setExportError(`Could not export spreadsheet: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setExporting(false)
    }
  }

  async function importSpreadsheet(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    setImporting(true)
    setImportError('')
    setImportStatus('')
    setExportError('')
    setExportStatus('')
    try {
      const { readTaxSpreadsheet } = await import('./engine/spreadsheetImport')
      const imported = await readTaxSpreadsheet(file)
      const year = TAX_YEARS[imported.taxYearId]
      if (!window.confirm(`Import ${file.name} for ${year.label}? This will replace the current return.`)) {
        setImportStatus('Import cancelled; the current return was not changed.')
        return
      }
      tr.replaceData({ ...imported, properties: consolidateProperties(removeBankExpenses(imported.properties)) },
        `Imported ${file.name}, replacing the previous return`)
      setDocumentExport(undefined)
      setDocumentSessionKey((key) => key + 1)
      setImportStatus(`Imported ${file.name} for ${year.label}. Review the Personal and Income tabs; calculations have been refreshed.`)
    } catch (cause) {
      setImportError(`Could not import spreadsheet: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <p className="app-kicker">UK · SELF ASSESSMENT WORKBOOK</p>
          <h1>TaxDraft</h1>
          <div className="app-subtitle">Evidence-led self-assessment, with calculations you can check line by line</div>
        </div>
        <div className="header-controls">
          <SearchBox entries={searchIndex} onOpen={openSearchResult} />
          <label className="tax-year-control">
            <span>Tax year</span>
            <select value={tr.data.taxYearId} onChange={(e) => tr.setTaxYear(e.target.value)}>
              {Object.values(TAX_YEARS).map((y) => (
                <option key={y.id} value={y.id}>{y.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="ghost-btn" onClick={tr.loadExample}>Load example (2024/25)</button>
          <label className="ghost-btn document-file-label">
            {importing ? 'Importing spreadsheet...' : 'Import spreadsheet'}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Import a TaxDraft spreadsheet" disabled={importing || !loadedFromStorage}
              onChange={importSpreadsheet} />
          </label>
          <button type="button" className="ghost-btn" disabled={exporting || !loadedFromStorage}
            onClick={exportSpreadsheet}>{exporting ? 'Exporting spreadsheet...' : 'Export spreadsheet'}</button>
          <button type="button" className="ghost-btn" onClick={() => tr.reset(tr.data.taxYearId)}>Clear</button>
        </div>
      </header>
      {importError && <p className="hint error" role="alert">{importError}</p>}
      {importStatus && <p className="hint" role="status">{importStatus}</p>}
      {exportError && <p className="hint error" role="alert">{exportError}</p>}
      {exportStatus && <p className="hint" role="status">{exportStatus}</p>}

      <nav className="tab-bar">
        {visibleTabs.map((t) => (
          <button
            key={t}
            className={`tab-btn ${activeTab === t ? 'active' : ''}`}
            onClick={() => {
              if (t === 'Documents') setDocumentsOpened(true)
              setTab(t)
            }}
            type="button"
          >
            {t}{t === 'Review' && unresolvedReviewCount > 0 && (
              <span className="tab-count" aria-label={`${unresolvedReviewCount} open review items`}>
                {unresolvedReviewCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {companyMode && (
        <div className="mode-banner" role="status">
          <span>You’re working out your <strong>company’s Corporation Tax</strong>. Your personal tax entries are kept, but hidden.</span>
          <button type="button" className="ghost-btn" onClick={() => updateBusiness((current) => ({ ...current, taxMode: 'personal' }))}>
            Switch to personal tax
          </button>
        </div>
      )}

      <main className="app-main">
        {activeTab === 'Personal' && (
          <PersonalDetailsForm personal={tr.data.personal} onChange={tr.updatePersonal} sources={tr.data.personalSources} />
        )}

        {activeTab === 'Income' && companyMode && businessSection}

        {activeTab === 'Income' && !companyMode && (
          <>
            <EmploymentSection items={tr.data.employments} m={tr.employments} />
            {businessSection}
            <PropertySection items={tr.data.properties} m={tr.properties} onAllocate={tr.allocateProperty} onMoveBank={tr.moveBankReference}
              onAllocateNew={tr.allocateToNewProperty} onRemoveExpenses={tr.removePropertyExpenses}
              onRemoveRentalIncome={tr.removeRentalIncome} />
            <SavingsSection items={tr.data.savings} m={tr.savings} />
            <DividendSection items={tr.data.dividends} m={tr.dividends} />
            <PensionSection items={tr.data.pensions} m={tr.pensions} />
            <OtherIncomeSection items={tr.data.other} m={tr.other} properties={tr.data.properties} />
            <ReliefsSection reliefs={tr.data.reliefs} onChange={tr.updateReliefs}
              bankCandidates={tr.data.bankReliefCandidates} onConfirmBank={tr.confirmBankRelief} />
          </>
        )}

        {documentsOpened && (
          <div hidden={activeTab !== 'Documents'}>
          <Suspense fallback={<div className="card">Loading document tools…</div>}>
            <DocumentFolder
              key={documentSessionKey}
              taxYearId={tr.data.taxYearId}
              onImport={tr.importDocumentSuggestions}
              properties={tr.data.properties}
              onReconcileRentalIncome={tr.reconcileRentalIncome}
              employments={tr.data.employments}
              pensionRecipients={tr.data.privatePensionRecipients}
              onPensionRecipientsChange={tr.setPrivatePensionRecipients}
              donationRecipients={tr.data.charitableDonationRecipients}
              onDonationRecipientsChange={tr.setCharitableDonationRecipients}
              onExportSnapshot={setDocumentExport}
              returnData={tr.data}
              companyMode={companyMode}
              onOpenIncome={() => setTab('Income')}
            />
          </Suspense>
          </div>
        )}

        {activeTab === 'Computation' && (companyMode
          ? <CompanyComputation business={tr.data.business} />
          : <ComputationSummary result={result} rates={rates} data={tr.data} />)}

        {activeTab === 'Review' && (
          <ReviewChecklist items={reviewItems} onNavigate={(nextTab) => setTab(nextTab)} />
        )}

        {activeTab === 'Reliefs' && <ReliefsPanel flags={flags} />}
      </main>

      <footer className="app-footer">
        Saved locally in this browser only. Not a substitute for advice from a qualified accountant or tax adviser —
        especially before you actually file.
      </footer>
      <UndoBar last={tr.lastUndo} count={tr.undoCount} onUndo={tr.undo} />
    </div>
  )
}
