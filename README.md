# TaxDraft — Self Assessment Workbook

A local-first calculator for UK Self Assessment. You enter figures from your own documents,
it runs the same computation logic HMRC/your accountant uses, and flags reliefs and allowances
worth double-checking. Nothing leaves your machine — there's no server or account.

## Running it

```bash
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`). Runs entirely in your browser;
your data is saved to that browser's local storage only (see **Data & privacy** below).

## Exporting a spreadsheet

Use **Export spreadsheet** in the header on any tab to download
`taxdraft-TAX-YEAR.xlsx` for the selected tax year. The workbook includes personal
details and source evidence, every income entry, property totals and itemised expenses,
bank references, pension/Gift Aid totals and candidate evidence, recipient settings,
the full computation and tax bands, tax-year rates, and outstanding checks.
Numeric amounts remain numeric; rates and ownership shares are fractions (0.5 = 50%).
Recorded, included and claimed figures remain separate so excluded amounts are not
mistaken for tax deductions.

Use **Import spreadsheet** in the header to restore the return from a workbook exported
by this app. Import replaces the current return after confirmation and supports personal
details, income, property evidence, relief totals, bank relief candidates and recipient
settings. Computations are recalculated by the app; document-analysis selections and
original files are not imported. Review the imported figures before relying on them.

If documents are selected, the export also includes current pending suggestions, likely
charity selections and payment evidence, readable statement transactions, file names and
analysis warnings. Let analysis finish first for a complete snapshot. After a page reload,
reselect documents to include that temporary analysis; saved income/evidence still exports.
Original PDFs/spreadsheets/images are not embedded. Long evidence text is split into
continued columns without truncation. The export runs locally and does not change the
return. This file contains personal financial information: store and share it securely.
It is a working paper, not an HMRC submission. Import is intended for this app's own
spreadsheet exports, not general-purpose Excel workbooks or complete document backups.

## How to check it against your own numbers

Click **Load example (2024/25)** in the header. This pre-fills the workbook with the figures
from your accountant's 2024/25 computation and lettings statements, so you can flip to the
**Computation** tab and compare line by line.

Doing this while building the engine turned up one useful thing: the accountant's summary shows
your property income as £8,988, but working it out fresh from the two lettings statements
(splitting 50/50 as joint owners) gives £8,990 — a £2 difference, most likely from a rounding
step somewhere upstream. Immaterial, but it's the kind of thing worth asking your accountant
about only because the app derives it independently rather than trusting the summary figure.

Every other figure — the Personal Allowance taper (abated to £3,779), the extended basic rate
band (£56,867), the tax on non-savings income (£11,373.40 + £30,388.80) — matches exactly.

## What it does

- **Undo** — removing a card (employment, property, interest, dividend, pension, other income),
  removing matched rent receipts or saved recipient names, Clear, Load example and Import can all
  be undone from the bar at the bottom of the screen or with Ctrl+Z (outside text fields). Removed
  cards return to their original position, keeping other edits made since. The last 20 changes
  are kept until the page is reloaded.
- **Search** — the box in the header (Ctrl+K or `/`) searches everything in the app: personal
  details, income entries, property expenses and rent receipts, relief candidates, saved
  recipient names, selected documents, extracted suggestions, bank transactions, likely
  charities, warnings, review items, relief checks and computation totals. Amounts match with
  or without commas. Choosing a result opens its tab and, where the browser supports it,
  scrolls to the matching text.
- **Personal** — marital status, children/Child Benefit, student loan, Scottish taxpayer flag.
- **Income** — employment (P60/P11D), land & property (with the finance-cost restriction handled
  correctly as a 20% tax reducer rather than a deduction), interest, dividends, pensions, other
  income, and pension contributions/Gift Aid (enter the net amount you paid; it grosses these up
  automatically since that's what extends your rate bands).
- **Documents** — choose a folder using the standard read-only folder input, or select files.
  Subfolders are included. An alternative Chrome/Edge File System Access picker is available
  if needed; rejected selections are reported. For OneDrive, choose the locally synced folder
  with readable files. Document selection, analysis and unchecked suggestions survive tab
  switches. Selecting another tax year reanalyses the selected files. Reloading the page requires
  selecting files again; imported Income figures and completed allocations remain saved.
  The browser locally reads
  text-based PDFs, CSV/XLSX statements, and images/scanned PDFs via OCR. It proposes figures it
  can recognize from P60s, P11Ds, rental statements, interest/dividend/pension documents, and
  clearly labelled bank transactions. Suggestions are editable and unchecked until you confirm
  them, except recognised P60 and property figures as described below. OCR downloads its engine and English-language assets from a CDN when needed;
  document contents remain in your browser and are not uploaded.
  Suggestions are grouped as **Recognised** (clearly labelled, known layout), **Probable** (label
  and amount found, treatment uncertain) or **Requires confirmation** (uncertain, or read by OCR).
  OCR-derived figures are always flagged and never count as recognised. Each suggestion shows the
  source text around the amount where it can be located, and **Open original** opens the
  selected file locally in a new tab for side-by-side checking.
  Weekly payslips with "Gross Pay this week", "Tax this week", "NI this week",
  "NEST Pension", and "Gross/Tax/NI to date" labels produce review entries.
  Adjacent decimal amounts are extracted; column layouts that cannot be mapped safely require
  checking against the original. P60 is the main source for annual employment pay and tax.
  Payslip figures are supporting evidence only and cannot be imported into the computation,
  preventing weekly or cumulative totals from duplicating the P60. NI and payroll pension deductions are reference figures only;
  NEST deductions are not automatically claimed as relief-at-source pension contributions.
  Personal form answers can be proposed from explicit labelled document evidence (name, marital
  status, Scottish taxpayer, registered blind, children, Child Benefit and student loan details).
  Each proposal shows its source; conflicting selected answers block import. Import replaces the
  corresponding field only after review. Manual edits clear that field's source attribution.
  Absence of evidence is never inferred as "no"; addresses, names, payroll deductions or generic
  tax guidance do not establish personal circumstances. Current extraction supports labelled
  lines, not every document layout. Fields without reliable evidence remain manual checks.
  P60 is still the main employment source; eligible pension, other taxable income and relief
  summary figures are reviewable proposals, not a substitute for checking their tax treatment.
  Recognised PDF P60 pay/tax columns now populate Income automatically, marked for verification.
  Only "In this employment" is imported, not previous-employment or cumulative totals. The tax year
  must match; mismatches are reported. Identical P60 file contents are not imported twice.
  Unsupported P60 layouts remain manual rather than guessing at pay and tax.
  An existing entry for the same employer blocks a different P60 from auto-importing;
  reconcile that entry manually to avoid double counting.
  Properties are identified from your documents, so they need not be entered by hand: a flat or
  unit number before a name ("Flat 4, Pearl Chambers"), a "Re:"/"Property:"/"Ref" label before a
  building or street name ("REF.4 PEARL CHAMBERS"), or a file name ("Expenses_DraytonPark.docx").
  Addressee lines such as your home address are ignored. A partial name repeated in rent references
  ("FLAT21 71E DRAYTON") merges into the full name found elsewhere ("Drayton Park"). Identified
  properties are created with a 100% ownership share for you to check, and rent receipts that name
  a property have it pre-selected for matching. Workbooks are read first, so their property names
  take priority. Mortgage payments name only the lender, so they cannot create properties; Review
  flags when there are more lenders than properties.
  Word documents (.docx) of receipts and invoices are read too: the text, plus every embedded
  picture via OCR, in document order. Each invoice becomes one expense row (date, description,
  total) under the property it names, or under "Unallocated expenses: <file>" for you to assign.
  Totals are preferred over subtotals and VAT lines; costs dated outside the tax year are ignored.
  Every row starts excluded until you confirm the allowable amount. Word files are analysed after
  workbooks so their properties exist to match against; a property named in the file name (e.g.
  `Expenses_DraytonPark.docx`) is used when the text names none. When one amount equals the sum of
  the others on an invoice, only the total is proposed. A date on the amount's own line always takes
  priority. A Word table whose header has Date and Amount columns (e.g. a pasted expense ledger) is
  read row by row as the authoritative list (ISO dates such as 2025-07-01 are understood); the same
  cost found elsewhere in the document, including a total split across ledger rows, is not added
  again. Tables used only for layout are read as before. Files embedded inside a Word document (shown as `<<file.xlsx>>`) cannot be read; they are
  listed so you can save them into the folder separately. Re-reading a Word document replaces its
  unreviewed rows (wherever they were assigned, matched by file name so edited documents count),
  and a re-read row matching one you reviewed updates it (e.g. fills a missing date) rather than
  being added twice. Every expense row has a **Delete row** button, and each property can delete all
  rows from one source file (useful after renaming or replacing a document); both can be undone.
  Rows with the same amount and date (or one undated) are highlighted as possible duplicates.
  Each expense row's source is a link while its file is selected in Documents: a picture inside a
  Word document opens that picture; Word text or a ledger table opens a readable view of the
  document with the amount highlighted and scrolled to; a spreadsheet row opens the sheet with
  that row highlighted; PDFs and images open directly. Everything opens locally in a new tab.
  Unallocated entries can be assigned to an
  existing property or to a new one created from the dropdown (**+ New property…**, name suggested
  from the file name). Older .doc files are not supported.
  Property spreadsheets (XLSX/XLSM and CSV) are also analysed. Every worksheet is read,
  including separate property cost sheets. Dated bank receipts and supplier-ledger costs are
  filtered to the selected tax year; ledger total rows are not added again. Supplier/amount
  ledgers are treated as costs, never rent receipts. Explicit rent receipts, possible running
  costs and explicitly labelled mortgage/finance interest automatically appear in **Income →
  Land and property**, marked for verification. Bank evidence also appears there with a
  "Which property" allocation prompt. Named lender payments (NatWest, Halifax, Virgin Money)
  and mortgage-labelled incoming/outgoing transfers are reference totals only: confirm they
  are mortgages, select the property, and obtain the interest component separately.
  Flat-labelled receipts require explicit confirmation as rent before they affect rental income.
  Potential rental receipts are grouped by payer, ignoring dates, long reference numbers and
  payment-type prefixes; property and payer details after "REF" are kept, so different tenants
  stay separate. Payers paying the same amount in consecutive months are highlighted and
  listed first; one-off payments are collapsed but can still be reconciled if they are rent.
  Receipts matched to the wrong property can be removed in Income (individually or all at once);
  amounts they added are reversed and the receipts can be matched again.
  Dated signed-amount CSV exports and readable PDF statement transactions are also supported.
  Unknown invoices, capital/private costs and mortgage repayments require manual checking.
  Every valid dated cost explicitly listed in a rental-property expense worksheet is retained
  as an individual expense review row in Income, not every outgoing in a bank statement,
  with its description, amount, document/sheet and row number. Petrol/fuel/travel and other
  uncertain costs are highlighted, not silently discarded, and initially excluded from the
  allowable total. Confirm an allowable business amount (including a partial amount) or exclude
  the cost; itemised property expense totals are calculated solely from included document rows.
  Unexplained differences in previous saved totals are retained separately for reconciliation,
  excluded from tax, and cannot be added back by editing the itemised aggregate total.
  Expense review uses a table with date, description/source, recorded and included amounts,
  treatment status and per-row actions. Listed totals and any manual/summary balance are shown
  separately (unexplained balances are excluded). Allocation displays both expense lists and the combined total before the
  non-duplication confirmation; missing itemised evidence is explicitly highlighted.
  Each property or unallocated entry has its own named, bordered section with labelled totals,
  verification, expense breakdown and (for unallocated evidence only) allocation controls.
  Petrol requires rental-business journey evidence and must not duplicate a mileage claim for
  the same trips. Interest remains separate; mortgage repayments cannot be claimed as running
  expenses. Invalid/undated rows still produce warnings and require manual reconciliation.
  Bank exports supply rent receipts and separate mortgage reference totals only. No bank outgoing
  is imported as a property running expense or finance-interest deduction, even if labelled
  service charge, repair or interest. Property expenses come from the rental expense worksheets.
  On reload, previously saved bank expense rows with identifiable provenance are removed from
  expense/interest totals while preserving worksheet costs and manual adjustments. Older totals
  without a row breakdown, or contradictory manual totals, are explicitly flagged for reconciliation.
  Reselecting unchanged files enriches older imported entries with expense detail without
  duplicating entries or resetting their totals; reviewed amounts and allocations remain saved.
  A payment to a lender does not establish its interest component. Labelled annual summaries
  support gross rental income, allowable expenses **excluding finance costs**, mortgage interest
  and ownership share; ambiguous columns or a different stated tax year are rejected.
  Ownership and property allocation cannot be established from a bank description alone.
  Allocate unassigned bank entries, fill missing fields, check ownership and verify costs in
  Income. Allocation combines complementary fields and distinct, fully documented expense
  lists. If expense totals have incomplete evidence or potential overlap, a separate checkbox
  requires you to confirm they are non-duplicated before adding both totals. Shared document
  sources/row IDs are always blocked. Income/interest overlaps still require manual reconciliation.
  Allocation controls appear only on unallocated evidence. Named property worksheet entries
  are already assigned and never prompt you to merge one property's expenses into another;
  combining different named properties is blocked even with expense confirmation.
  Same-name entries are consolidated into one property card on import and reload, with
  rental income, expenses and their breakdown together. Duplicate source/expense rows are
  retained once; fully itemised distinct costs combine. Conflicting summary totals or ownership
  are flagged for reconciliation, never blindly added; the larger conflicting total is retained.
  Bank interest and dividends now populate their Income sections automatically, with the
  matching dated payments and a verification checkbox. Unclassified incoming payments appear
  in Other income with a recorded receipt total but taxable Amount initially zero. Confirm
  their purpose and enter only the taxable amount; labelled salary, rent, transfers, mortgage
  receipts, refunds and cashback are excluded from this candidate list.
  Bank pension payments and donations automatically appear as candidates in Pension
  contributions & Gift Aid, initially with zero relief claimed. Confirm relief-at-source
  or Gift Aid eligibility and apply a qualifying net amount there; bank labels alone do not
  prove eligibility. Reapplying a claim adjusts only its difference, not the whole amount again.
  In Documents, the private-pension recipient prompt lets you add provider/payment names as
  shown in bank descriptions. Saved recipient names match complete phrases, ignoring case and
  punctuation, on outgoing payments only. Adding/removing a name reanalyses selected files.
  Matching payments populate candidates even when the description does not say pension/SIPP.
  Updated candidates retain existing claims for review rather than claiming additional relief
  automatically. Removing a recipient does not delete previous candidates or claims.
  Charitable donations are recognised from donation/Gift Aid labels and a built-in set of
  charity names (including Cancer Research UK, Macmillan, RNLI and others). In Documents,
  add any missed charity's bank recipient name under **Charitable donations & Gift Aid**.
  Matching ignores case/punctuation and uses complete phrases on outgoing payments only;
  labelled purchases, shop payments, tickets, lottery entries and memberships are excluded.
  Adding/removing charity names reanalyses selected files; names are saved with the return.
  Donation payments and their net amount populate the Gift Aid review beside the Gift Aid
  total in Income automatically, not the pension review. Relief remains zero until you
  confirm a valid declaration and the qualifying amount. Removing names does not erase claims.
  **Likely charities** in Documents lists recognised donations plus unexplained recurring
  recipients paid in at least three consecutive months, 20–40 days apart, excluding obvious
  bills, mortgage/loan payments, pensions, transfers, shopping and subscriptions. Evidence
  can span selected files; dates, original descriptions, sources, counts and totals are shown.
  The same round amount (a multiple of 50p, under £100) paid every month to a payee that does not
  look commercial (no Ltd/PLC, fee, account, finance etc.) is marked **Likely donation** and
  starts selected, even without a saved charity name. Its payments are also included in the
  auto-populated Gift Aid review in Income (claimed relief still starts at zero). Other regular payees remain unticked leads.
  The same payment read from two files is counted once. This app's own exported workbooks are
  skipped when analysing a folder, because they contain copies of your bank transactions.
  Recognised and likely recipients start selected for evaluation: untick non-charities or use Unselect all, then
  **Evaluate selected charity recipients** to add only selected names to donation matching.
  Selection choices survive tab switches and recipient reanalysis but reset for new files/year.
  Frequency is only a review heuristic, not proof of a charity; evaluation does not claim relief.
  Already imported donations/claims are not removed by unticking; review/exclude them in Income.
  Identical file/sheet/group imports do not duplicate entries and preserve manual edits.
  Overlapping exports from different files still require checking; do not claim the same
  receipt or donation from multiple statements or certificates.
  Each bank reference has a separate move control to correct lender allocation without moving
  expenses or changing tax amounts. Already-confirmed rental receipts require income reconciliation
  before moving. Multiple lenders can belong to one property; allocation is not inferred.
  Identical file/sheet/property sources are not imported twice, including after allocation.
  New sources append unverified entries; they do not overwrite manual figures.
- **Computation** — the full working, laid out like a professional computation, down to the
  balance due or refund.
- **Reliefs** — a generated list of things worth checking based on what you've entered (the
  £100k–£125,140 taper band, Marriage Allowance, ISA headroom, Child Benefit charge, jointly-owned
  property apportionment, pension annual allowance taper, etc.), plus a standing checklist of the
  kind of things accountants always ask about (disposals, foreign income, trust income).

## What it deliberately doesn't do (yet)

- **Document extraction is best-effort, not comprehensive.** Layouts vary, scans can be misread,
  and the parser will miss figures it cannot recognize. OCR is limited to the first 20 pages of
  a scanned PDF. Always compare suggestions to the original document. Bank transaction
  descriptions can suggest pension payments or donations, but a transaction alone cannot prove
  pension tax treatment or Gift Aid eligibility; confirm before importing.
- **No Scottish rates.** Non-savings income uses UK-wide bands only; a Scottish-taxpayer flag
  in the Reliefs tab reminds you if this applies to you.
- **No Marriage Allowance auto-calculation** — it needs your spouse's income, which isn't
  captured here. Flagged instead as a manual check.
- **No CGT, self-employment, or trust computation** — flagged as reminders in the Reliefs tab,
  not calculated.
- **Not filing-ready.** This produces a working figure to sanity-check what you're being told,
  not a submission. Rates are updated for 2024/25 through 2026/27 based on published HMRC/Budget
  figures at the time of writing — always cross-check current-year rates at gov.uk before relying
  on this, and run anything material past a qualified accountant or tax adviser before acting on it.

## Data & privacy

Your entries autosave to `localStorage` in whatever browser you run this in — that's it. There's
no backend, no account, no analytics. Document contents are read locally for analysis and are not
uploaded or saved by the app; OCR may fetch its engine and language assets from a CDN. Only figures
you choose to import are saved with the rest of the return. Clearing your browser data or using a
different browser/machine means starting again (or
re-entering from the Documents checklist). If you want
this to sync across devices, the natural next step is swapping `localStorage` for Azure Blob
Storage or a small database — happy to build that layer when you're ready for it.

## Project layout

```
src/
  types.ts               — shared data shapes
  data/taxYears.ts        — rates & thresholds per tax year
  engine/calculateTax.ts  — the actual computation
  engine/documentImport.ts — local document extraction and review suggestions
  engine/reliefsCheck.ts  — the "things to check" generator
  state/useTaxReturn.ts   — in-memory state + the example data
  components/             — one file per section, plus the ledger-style output
```
