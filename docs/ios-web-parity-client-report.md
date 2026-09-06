# Photo gallery and client report parity

Source: `sustainability-wise-api/apps/ecoaudit/src/modules/installhub/pages/DataPage.tsx` and `lib/model.ts` at `5bd40a73cbeb7426ac7f02fcd2076e064963266b`. The portal client report is a browser summary with locally persisted evidence selection and browser print; it is separate from the formal versioned report pack.

| Stage | Page / section | Portal behavior | iOS change / finding | Status |
| --- | --- | --- | --- | --- |
| Reports | Photos / inventory | Zone, board, meter, site asset and form evidence | Shared collector retains all five sources, canonical meter photos and embedded legacy fallback; no duplicate device photos | FIXED |
| Reports | Photos / missing evidence | A board with meter evidence is not missing evidence | Corrected previous board-only missing-evidence count | FIXED |
| Reports | Photos / selection | Include each photo in client report; persisted per installation | Accessible switch, included count, local durable selections shared with report screen | FIXED |
| Reports | Photos / replaced photo | Browser uses positional key only | iOS binds saved exclusion to key and exact URI so a newly replaced photo is included by default; avoids silently hiding new evidence | FIXED |
| Reports | Photos / navigation | Open client report | Added direct action; empty/loading/error states retained | FIXED |
| Reports | Client report / header | Site/client/address, installer/date/status and zone/board/meter counts | Replaced demo summary with live persisted installation values | FIXED |
| Reports | Client report / electrical overview | Board/device counts and each zone's board/asset counts | Added equivalent per-zone sections | FIXED |
| Reports | Client report / assets | Name/type/metering, metered count; first 250 with explicit overflow note | Added equivalent list/count/overflow note, with Metered/Unmetered/To be confirmed states | FIXED |
| Reports | Client report / commissioning | Completed-form count, unique titles, outstanding board/asset TBC count | Added equivalent calculated summary; this summary is not the exhaustive readiness diagnostic view | FIXED |
| Reports | Client report / evidence | Selected images/captions and included/total | Added same shared selection model and photos | FIXED |
| Reports | Client report / output | Browser print/save PDF | Added native PDF export/share. Images are embedded as base64 JPEGs per Expo iOS print constraints. HTML escapes captured text and fails on missing selected images | FIXED |
| Reports | Client report / formal report link | Open versioned report workflow | Added Generate formal report pack navigation | FIXED |
| Reports | Selection storage | Browser localStorage; no server field | iOS local AsyncStorage repository, session fallback, serialized writes, no API/schema changes. Selections do not synchronize across platforms | INTENTIONAL-DIFFERENCE |
| Reports | Preview PDF / remote photos | Browser uses authenticated image previews | iOS uses existing authenticated thumbnail cache. Unavailable cached previews produce a specific download/deselect/retry message; no empty-image success | RETEST |
| Reports | Device / share / persistence | Actual interaction required | Native switch persistence after app restart, camera-created photo display, PDF layout and share sheet require root's attached-device loop | RETEST |

Architecture: both screens use `src/domain/clientReport.ts`; `src/hooks/useClientReportPhotoSelection.ts` reads/subscribes through `src/repositories/clientReportPreferencesRepository.ts`. The storage key is `installhub.client-report-photos.v1:<encoded installation id>`. Local choices never alter captured evidence or installation/tree revisions. `src/services/clientReportHtml.ts` builds escaped preview HTML, and `src/services/clientReport.ts` embeds existing local/cached previews before Expo PDF generation and sharing. Images are processed sequentially and source files are not deleted. A bounded 80 MiB encoded-image limit fails with an actionable smaller-selection message.

Verification: pure model/HTML tests cover all photo families, legacy/canonical dedup, board evidence coverage, report counts, selection persistence serialization, replaced-image inclusion, missing-image failure and HTML injection escaping. `node --import tsx --test tests/clientReport.test.ts` passed 4/4. `npm run typecheck` exit 0. `git diff --check` exit 0. The stale workspace test forbidding report selection was replaced by actual behavior tests. No device, server or live bidirectional claim is made by this subtask; root owns final integration and device evidence.
