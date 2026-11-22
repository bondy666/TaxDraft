# Azure Deployment Plan

Status: Deployed

## Project and goal

Publish the current React/Vite build to the existing TaxDraft production site.
The application has no backend; tax-return data is stored in each visitor's browser.

## Existing target

- Subscription: MCPP Subscription (`d5f1d7cc-0f74-42a0-97c6-b0255ea2a052`)
- Static Web App: `TaxDraft`, resource group `TaxDraft-rg`
- Region: West Europe; SKU: Free
- URL: https://red-mud-06e664e03.3.azurestaticapps.net/
- Repository integration: none

The target matches the URL supplied by the user. The user approved the production
update using the Static Web Apps CLI.

## Proposed deployment

- Build the existing app with `npm run build` and publish `dist` to the existing
  production environment.
- No new resources, infrastructure, configuration, access, DNS or SKU changes are planned.
- The previous deployment used the Azure Static Web Apps CLI with a deployment token.
  The token must not be printed or persisted.
- After publishing, check the production homepage and its current JavaScript and CSS assets,
  and verify that the Review tab is present.

## Provisioning limits and cost

No new resources are planned, so resource provisioning quotas do not apply. No additional
resource cost is expected from retaining the existing Free SKU.

## Execution checklist

- [x] Identify the existing application and production hostname.
- [x] Confirm the current source builds (`npm run build`, 2026-11-21).
- [x] Confirm the target subscription, deployment method and plan with the user.
- [x] Prepare deployment prerequisites: SWA CLI available through npx.
- [ ] Invoke azure-validate and record its validation proof.
- [ ] Invoke azure-deploy to publish and verify.

## Validation checks

- [ ] AZCLI core validation: CLI, authentication, Bicep build, validate and what-if.
- [ ] Docker build, if containerized (not applicable).
- [ ] Azure Policy validation.
- [ ] Verify the app build and Node.js runtime.
- [ ] Verify infrastructure role assignments, if applicable.

## 7. Validation Proof

- `npm run build`: passed on 2026-11-21 (Vite reports large-chunk warnings).
- `node --test 'src\engine\*.test.mjs'`: 55 tests passed on 2026-11-21.
- Azure CLI confirmed the target hostname, region and Free SKU.
- PowerShell 7.7.0 installed temporarily in session storage to run the validation workflow.
- The AZCLI validation script ran on 2026-11-21: Azure CLI and authentication passed;
  Bicep compilation, validation and what-if failed because `infra/main.bicep` is absent.
  This existing code-only deployment has no infrastructure template. No infrastructure
  changes were approved.

Bicep validation does not apply to this code-only update. No infrastructure was changed.

## Deployment result

- 2026-11-21: `dist` published with the Static Web Apps CLI to the production environment.
- Verified that the live site serves `/assets/index-BV0fgGYS.js`, which contains the Review tab.
- 2026-11-21: Redeployed with document-confidence features (evidence tiers, OCR flags, source
  excerpts, Open original). Verified live bundles `index-B4dkfKtS.js` and `DocumentFolder-qbYetjEP.js`.
- 2026-11-21: Redeployed with payer grouping for rental receipts, consecutive-month highlighting,
  collapsible one-off payments and apostrophe-tolerant charity matching. Verified live bundles
  `index-DrYGkthh.js` and `DocumentFolder-DHZ30Ofh.js`.
- 2026-11-21: Redeployed with likely-donation detection, cross-file duplicate handling and
  skipping of the app's own exports. Verified live bundles `index-CStXI7Fn.js` and
  `DocumentFolder-CiifMU7r.js`.
- 2026-11-21: Redeployed fixing rental payer grouping (details after "REF" kept) and adding removal
  of matched rent receipts in Income. Verified live bundle `index-C7QICMLS.js`.
- 2026-11-21: Redeployed with app-wide search (header, Ctrl+K). Verified live bundle `index-CAqCOoCm.js`.
- 2026-11-21: Redeployed with Word (.docx) expense documents (text + OCR of pictures). Verified live
  bundle `index-SaKnFSI5.js`.
- 2026-11-21: Redeployed so likely monthly donations feed the Gift Aid candidate automatically.
  Verified live bundle `index-CDmSm5nI.js`.
- 2026-11-21: Redeployed with undo (bar and Ctrl+Z) for removals, Clear, Load example and Import.
  Verified live bundle `index-DHJq3cZM.js`.
- 2026-11-21: Redeployed with ownership share stepping in 0.5 increments. Verified live bundle
  `index-Jg5l1XDW.js`.
- 2026-11-21: Redeployed with "+ New property…" allocation, file-name property matching for Word
  documents and invoice total de-duplication. Verified live bundle `index-actALcpg.js`.
- 2026-11-21: Redeployed with automatic property identification from documents and the
  mortgage-lender cross-check. Verified live bundle `index-DF68wL1a.js`.
- 2026-11-21: Redeployed with own-line date priority, embedded-attachment handling and refresh of
  unreviewed Word rows. Verified live bundle `index-Cl2McvXR.js`.
- 2026-11-21: Redeployed with Word ledger-table reading, stable row ids and refresh by file name.
  Verified live bundle `index-CcyOM8c0.js`.
- 2026-11-21: Redeployed with per-row and per-file expense deletion (undoable) and duplicate
  highlighting. Verified live bundle `index-sUF2mIms.js`.
- 2026-11-21: Redeployed with clickable expense sources (picture, highlighted Word text/table,
  highlighted sheet row, or file). Verified live bundle `index-7BeEzzHz.js`.
- 2026-11-21: Redeployed with the app renamed to TaxDraft (tagline "Self Assessment Workbook").
  Verified live title and bundle `index-B2HCKi-O.js`.
- 2026-11-21: Redeployed with the interest-only mortgage checkbox that fills annual interest from
  recorded mortgage payments. Verified live bundle `index-CzwHe--k.js`.
- 2026-11-22: Redeployed with self-employment invoices and the limited-company corporation tax
  estimate. Verified live bundle `index-D0SGXTQu.js`.
- 2026-11-22: Redeployed with corporation tax as an opt-in company mode (personal tax by default)
  and the inferred document checklist. Verified live bundle `index-BFYKgBbI.js`.
- 2026-11-22: Redeployed with other income listed by payer (taxable tick box) and a simplified
  Documents tab. Verified live bundle `index-Qw-wS63m.js`.
- 2026-11-22: Redeployed with similar-payer matching for rent suggestions. Verified live bundle
  `index-XO4uaHso.js`.
- 2026-11-22: Redeployed so similar payers are offered across formats and old-total files. Verified
  live bundle `index-BeaWUn77.js`.
- 2026-11-22: Redeployed with similar-cost decisions in the expense breakdown. Verified live bundle
  `index-CzJH339E.js`.
