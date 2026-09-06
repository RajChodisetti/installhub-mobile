# Form actions and historical PDF follow-up

Source: portal FormsPage/FormEditorPage and `findRecordVersionContainingForms`/`authoritativeReportProvenanceFromVersion` in the module API, at `5bd40a73cbeb7426ac7f02fcd2076e064963266b`.

| Stage / page | Item | Finding / change | Status |
| --- | --- | --- | --- |
| Forms / list and editor | Create amendment | Expected access/reopen failures previously rejected an unhandled promise. Both actions now show the concrete error as the portal does. | FIXED |
| Forms / editor | Delete draft | Shows delete failures and reschedules canceled edits when access remains valid, so a failed delete does not silently discard the unsaved draft. | FIXED |
| Forms / list | Historical commissioning | Shows preserved historical-meter context and evidence count, matching the portal's explanation that the operational meter can be absent while original form evidence remains. | FIXED |
| Forms / PDF | Historical retained version | For `historical_meter_removed`, searches retained versions using the existing read-only version APIs. Selects a version only when the exact form is Completed and canonical snapshot schema, installation identity, authoritative eligibility and payload hash agree. | FIXED |
| Forms / PDF | Hash verification | Jobs for historical evidence must echo the hash selected from the retained canonical version, including reused jobs and new job creation. | FIXED |
| Forms / API | Endpoints | Uses existing `GET /v1/installhub/installations/:id/versions` and `GET .../versions/:number`; PDF start/poll/download endpoints unchanged. | RETEST |
| Forms / real device | Amendment error, delete failure, historical PDF | Requires root's device/live test loop; no runtime PASS claimed by source/unit tests. | RETEST |

Automated evidence: historical lookup tests cover preferred-then-descending fallback, one inaccessible version, missing form, foreign installation, mismatched hash, unsupported snapshot, and unpinned source. `node --import tsx --test tests/formReportTarget.test.ts` passed 6/6. Pure API cross-check separately accepted all 8 mobile form payload families in the current backend formContract validator, including image metadata/captions, while rejecting the previous unsupported ACE prefill.
