# Field App commercial and support workflows

The portal Field App is the functional comparison source for these native routes.

The durable [support field/action/API matrix](ios-web-parity-support-matrix.md) replaces the temporary initial inventory's missing-feature statements with current source dispositions. See the [master audit](ios-web-parity-audit.md) for exact native checkpoints; the reported 731-test native checkpoint and 12 focused checks after the final finance wording correction do not mark every support workflow physically verified. Build ten and combined portal revalidation are in progress.

## Native commercial routes

- FinancialSummary (`installationId`): server summary and all pricing/cost/margin/labour metrics, pricing mode/amount/notes, add cost lines, read-only hours/invoiced flags, manual-line deletion, CSV share, and quick draft invoice.
- Invoices (`installationId`): selected billable uninvoiced cost lines, invoice notes, ex-GST/10% GST/total preview, create draft, and invoice list.
- InvoiceDetail (`installationId`, `invoiceId`): server invoice number/status, bill-to, issue/due dates, quantity/unit/line totals, subtotal/GST/total, notes, issue draft, void, and PDF share.

Only administrators can read or change the dedicated installation finance/invoice APIs. Navigation must use the current backed-up installation ID. Imported cpN source IDs must never be substituted for financial writes. The shared API remains authoritative for money, eligibility, invoice statuses (including paid), and commercial history. No commercial balances or invoices are stored in the local installation snapshot.

Client requests stay in `src/api/apiClient.ts`, reuse isolated installhub auth and refresh, and commercial mutations bind the originating authenticated session authority. Commercial files stream through the existing authenticated download implementation, reject redirects/wrong content types, share via the native sheet, and remove temporary cache files afterwards. The UI does not send invoices by email or implement payments because those actions are not in the dedicated portal Field App workflow.

## Finance ledger contract repair — FIXED source; RETEST native/deployed

The later physical-test preflight exposed the same rejected controls in both clients: expense-hours authoring and a manual invoiced toggle. The canonical portal `finance/CostLinesPanel.tsx` and native `FinancialSummaryScreen` now omit those controls and `hours`/`invoiced` cost-creation properties, while retaining valid category/description/cost/sell/billable creation, deletion, pricing and read-only server values. The API restrictions are unchanged.

Labour hours are managed through separately audited financial settings. The shared summary uses audited cost/billable overrides or zero; the Field adapter exposes cost hours as `labour.hours` and null expense hours. App-active time is internal evidence and must not feed financial hours, labour calculations or invoice DTOs. The old API rejection text mentioning active-work tracking does not override that contract. Draft reservations, issue and void determine expense invoice state. See [finance ledger contracts](ios-web-parity-finance-ledgers.md) and the API repository's `docs/ai/INSTALLHUB_FINANCE_CAPTURE_UI.md`.

The correction passed 32 focused native commercial checks and typecheck. The isolated portal passed 409 tests and typecheck; all five production-component checks passed again after the wording correction, with targeted lint clean. Root integrated the corrected portal patch and is running combined validation. Exact-synthetic pricing/cost/draft/issue/PDF/void and deployed portal behavior remain `RETEST`; source checks do not establish those outcomes.

## Support parity

Inventory searches query the server rather than only the first 500 loaded rows, report the exact total/truncation, and expose company/user-held subtotals. An inspector with independent inventory-maintainer access does not request the admin-only user directory. Admin directory failure does not hide available inventory.

Installation access supports an authorized inspector's read-only assignment view and an administrator's assignment selector. Cloud history handles canonical snapshot envelopes (`snapshot.installationTree`, `snapshot.readiness`) and legacy raw trees. The unified user directory shows the same cross-product identity/membership/sync information as the portal. Administrators may grant/revoke inventory-maintainer access separately from role, including on active source-managed Field accounts; profile/password/source ownership rules remain unchanged.

## Regression coverage

`tests/support-parity.test.ts` covers inspector/maintainer permission separation, server search beyond initial inventory truncation, read-only access, canonical/legacy snapshot counts, source-projected user handling, invoice selection/status actions, numeric validation, and GST preview. `tests/commercialLedgerContract.test.ts` verifies real screen controls/handlers and filters retained legacy hours/invoice-state inputs; expense-hours editing is no longer a supported capture operation.

Physical iOS verification is still required for the new screen navigation, keyboard scrolling, refresh/error states, scan batch flow, and native CSV/PDF share sheets. Source/unit checks are not proof of deployed API or installed-device behavior.

## Final source recheck — 2026-09-05

Read-only comparison of the current master audit, this inventory and canonical implementation did not establish another unresolved commercial/support source defect. The commercial RETEST rows remain device/live API gates: admin authorization, keyboard/scrolling, exact returned values and mutation errors, invoice lifecycle, and native download/share. No financial transaction or customer email was performed during this recheck.

Current source contains all three commercial screens and typed API methods; server-authoritative summary/header/cost lines; eligible-line invoice selection and GST preview; draft/issued/paid/void status rendering with portal-equivalent issue/void/download actions; nonnegative cent validation and read-only audited hours/invoice flags; authenticated download/temporary-file cleanup; inventory server search and permission-separated directory loading; read-only inspector access; canonical/legacy version envelopes; and unified-user maintainer/source rules. These were checked at their actual screen/hook/domain boundaries, not inferred from the route names alone. The original independent recheck included the nine support cases in the historical 525/525 combined checkpoint; later checkpoints and the finance correction are recorded above. This documentation update did not rerun tests or claim a physical PASS.

The separate same-actor dirty/unknown-baseline recovery source gap now has an explicit preserve-and-adopt implementation. Home reviews the exact server version and requires confirmation; one local transaction retains a full actor-owned recovery envelope and adopts the canonical server tree. Settings supports read-only copy/evidence inspection and manifest export. Recovery copies never enter finance/invoice APIs or normal upload dispatch. See [the recovery behavior and remaining native gates](ios-web-parity-work-access.md). Integration, combined native build and a synthetic device conflict/relaunch roundtrip remain unperformed gates; the source fix is not a deployed or device PASS.

## Commercial request scope repair

A subsequent async review reproduced a source defect: retained financial/invoice data could remain
visible after route or actor changes, while handlers used the new route IDs. Retained native Alert
callbacks and in-flight actions could also reload, publish errors, or navigate after their screen
blurred. File sharing captured a second session rather than retaining the action's original scope.

`useCommercialData` now keys snapshots by actor, role and installation/invoice identity, validates
the captured credential lifetime before displaying retained data, and gives each focused view a
separate token. Reads receive its exact cloud authority. Old callbacks and late results cannot
dispatch another mutation, publish data/errors, reset a newer action's busy state, or navigate.
Successful navigation/form clearing occurs inside the guarded action callback. The three screens
validate response ownership; changing financial record/actor clears the previous pricing/cost-line
draft. Same-record failed refreshes can retain their own data with an error.

Commercial CSV/PDF sharing requires the caller's scoped lease and rechecks it after availability,
inside token acquisition, after downloading and before native sharing. An expired view cannot
adopt a replacement session or open a late share sheet; its temporary file is cleaned. An already
dispatched server mutation may complete after navigation, but it cannot trigger stale UI work.
This is a request-lifetime fix; it does not alter money, invoice transitions, server authorization,
download byte validation, or stored commercial records.

Verification: 20 new hook/file/screen tests passed, including route/actor replacement, blur/refocus,
retained confirmations, delayed reads/actions, duplicate dispatch and cleanup. Running the hook
regressions against the original source reproduced 10 failures out of 11. The final isolated suite
passed 592/592 with no skips, and strict typecheck passed. These tests execute the production
hook/service/loaders with controlled native, auth and network boundaries. Real invoice mutations,
native CSV/PDF sharing, and deployment are separate gates and were not performed for this repair.
