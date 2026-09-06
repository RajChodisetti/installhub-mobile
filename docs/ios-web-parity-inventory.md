# Inventory request scope and scanner fallback

Functional reference: portal Field App `InventoryPage.tsx` and the dedicated
`/v1/installhub/inventory` APIs. This follow-up remains **RETEST on the iPad**.

## Findings and corrections

| Finding | Correction | Evidence |
| --- | --- | --- |
| P1: Inventory reads depended on role but not account identity. Retained scanner/editor confirmations could use whichever account the API client captured later. | `useInventoryData` binds access, inventory, summary and optional directory reads to one actor/session, query, scope and focused view. Inventory create/claim/update/delete calls receive that same explicit cloud authority. Retained actions cannot adopt a later account or view. | 18 production-hook tests, with the real `loadInventoryView` and controlled HTTP/auth I/O. |
| P2: A failed search left prior rows/counts rendered as the new result. | Loading a query clears its result; failure renders an actionable error and Retry inventory. Missing data is not presented as zero stock. | Query/scope failures and late reads are included in the hook checks. |
| P1: Typing a serial after a canceled/unavailable scanner could not be confirmed in scan mode. Switching to manual mode erased it. | Scan mode exposes the portal's Review Device ID step. The mode switch preserves typed input. A claim still requires explicit confirmation and sends the normalized serial through the existing API. | Both production-screen regressions fail against the preserved old source and pass after the fix. |
| Existing custody/edit behavior | Company registration, expected-revision updates, installed-custody read-only behavior, confirmed deletion and sequential scanner intake remain. | Actual screen update/delete callbacks check meter ID/revision and pass the initiating cloud authority. |

Optional administrator directory failure still leaves successfully loaded inventory
available. Inspector maintainers do not request that directory. These fixes do not
create stock when claiming an unknown serial or change server custody rules.

## Validation boundary

`inventoryReadScope.test.ts`, `inventoryScreenActions.test.ts` and
`support-parity.test.ts`: **30/30 passed**, no skips. Typecheck passed after the
initial integration; the final combined native batch has a separate result in the
[master audit](ios-web-parity-audit.md). Before/after logs are
`tmp/field-parity-inventory-before.log` and `tmp/field-parity-inventory-after.log`.
The former records the two expected failures against the original screen.

Physical claim/custody/scanner actions still need a signed-in QA account and
authorized synthetic stock. Current My inventory load/search evidence predates this
batch and does not certify the changed paths. No live inventory mutation was made
for these tests.
