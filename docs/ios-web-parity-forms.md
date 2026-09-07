# Field-form Web / iOS parity working audit

Source of truth: portal `/installhub` under `sustainability-wise-api/apps/ecoaudit/src/modules/installhub`, not the standalone legacy InstallHub app. Audit date: 2026-09-05. Portal/API source commit `5bd40a73cbeb7426ac7f02fcd2076e064963266b`; mobile starting commit `7de3e11c7e72135693fbe7383d68b66d33ec3ce5`.

## Architecture and contract

Portal FormsPage/FormEditorPage -> module typed API/tree writer -> `POST /v1/installhub/sync/push` -> `src/routes/installhub/sync.ts`, `formContract.ts`, `ih_form_submissions`. Portal reload uses installation-tree reads. iOS FormTypePickerScreen/FormEditorScreen/FormsListScreen -> formsRepo -> local immutable store generations -> opt-in backupMedia/syncService -> the same full-snapshot API; remoteInstallationsRepository maps the pull tree back to local records. Transport arrays remain complete snapshots, and removing a child has deletion semantics.

Form submission envelope mapping is exact: `form_type` -> `formType`, `schema_version` -> `schemaVersion`, `installation_id/zone_id/board_id/meter_id/site_asset_id` -> the equivalent camelCase IDs, `supersedes_id` -> `supersedesId`, `completed_at` -> `completedAt`, plus `id`, `status`, `answers`, `attachments`, timestamps and `historicalMeterRemoved`. Answers use identical dotted keys inside `answers`. The API requires string answers, known schema-v2 keys, supported form type/version, and `Draft` or `Completed`; optional business capture is not required. Schema-v1 answers retain legacy compatibility.

Attachment mapping: `id`, `slot`, `uri`, `caption`, `mime_type` -> `mimeType`, and `captured_at` -> `capturedAt`. Local files remain on-device; only confirmed remote URLs enter the snapshot. Upload uses `/v1/installhub/sync/check-photo`, `/sync/create-upload-session`, signed byte PUT, `/sync/confirm-upload`, then complete push. Metadata passes stage completed forms as Draft. PDFs use local HTML/Expo print with reduced-quality retries, or the authenticated asynchronous form PDF endpoint and shared export-job status/download. Server PDF selection verifies the pinned record version and imported-copy provenance.

## Batch findings and verification

| Stage / page | Item | Finding / change | Status |
| --- | --- | --- | --- |
| Forms / all families | Optional fields | Removed 281 stale capture/evidence requirements; preserved explicit visible safety and comms-replacement completion rules from portal source. Backend route guide is broader than the current portal safety rule; source behavior wins. | FIXED |
| Forms / picker | WW switchboard | Portal supports no board, while iOS blocked create/complete. Board context is now optional; selected IDs still receive installation ownership validation; absent/invalid optional completion links are normalized as in the portal. | FIXED |
| Forms / picker | WW defaults | Defaults to A3RM and its canonical meter name; linked meter prefill overrides these. | FIXED |
| Forms / editor | Existing site / asset tag | Restored `existing.device_number`, including barcode/manual entry, separate from serial. | FIXED |
| Forms / catalog | Switchboard choices | Uses the portal's seven choices and retains saved historical custom values. | FIXED |
| Forms / catalog | Legacy sensor/current fields | Legacy forms offer modern sensor values, retain old values per model, and show current/polarity for both accepted generations. | FIXED |
| Forms / editor | Conditional photos | Hidden evidence removal now comes from catalog visibility; switching a channel to Spare clears its hidden attachments as well as answers. Original amendment-owned evidence remains protected by existing storage ownership rules. | FIXED |
| Forms / API | Unsupported prefill keys | Earlier picker supplied both `auditor.*` and `existing.*`; ACE received unsupported site customer/address fields. API rejects these. New drafts, saves, amendments and completion project the supported schema-v2 answer namespace. Wire projection also repairs old schema-v2 snapshots without mutating the original local record. Schema-v1 values remain unfiltered. | FIXED |
| Forms / API | Exact exclusions | `ace-switchboard` excludes `site.customer_name`/`site.address`; WW excludes `existing.*`; Comms excludes `auditor.*` and `device.*`; water/logger forms exclude unrelated board/device prefixes. Photo strings cannot be sent as answer values. Supported capture and attachment metadata remain unchanged. | FIXED |
| Forms / editor | Location | Shown only for forms with coordinate fields; permission denial and acquisition failure both retain manual entry. | FIXED |
| Forms / editor + list | Autosave / draft / immutable completion / amendment / delete | Traced existing autosave flush, actor authorization, completed immutability, amendment copy and storage cleanup. Device interruption/relaunch still needs real-device verification. | RETEST |
| Forms / reports | Local/API PDF, captions, multiple attachments | Pure report/mapping coverage passes; native camera, library, PDF share and upload flow need attached-device verification. | RETEST |
| Forms / all families | Bidirectional data | Source mapping audited and transport/namespace tests pass. No authenticated Web->device->Web test was performed in this subtask. | RETEST |
| Forms / persistence | Offline vs cloud-first | Documented platform behavior: iOS persists locally and opts in to backup; portal writes server trees. Business field and lifecycle parity is still required. | INTENTIONAL-DIFFERENCE |

Focused verification: `node --import tsx --test tests/forms.test.ts tests/formCompletion.test.ts tests/formPickerContext.test.ts tests/formMeterPrefill.test.ts tests/formPayloadBoundary.test.ts` passed 49/49; `npm run typecheck` exit 0. Full suite before final namespace transport additions passed 419/420, with the pre-existing `pushNotificationRegistration.test.ts:355` hardcoded build-number expectation (`14` vs configured `15`) failing; root integration owns repair and final combined suite. Catalog signatures below independently derive from the portal source, not the previous mobile catalog. Tests cover every field's key/label/type/required/options/conditions/scanner flags, sparse/full capture, model-specific legacy choices, hidden media branches, replacement validation, immutable transport preservation and local completion projection.

No field/page is marked PASS from source comparison alone. FIXED records a concrete change with focused automated evidence; RETEST identifies remaining runtime, persistence, native-media and live bidirectional gates. Root task owns device deployment and the final integration status.

## Per-field inventory

All fields below exist on both clients after this batch. Stage is Field forms; page is the form family; section and label are explicit. API column is the exact answer key or attachment slot. Required means capture requirement (all optional); visible safe-to-proceed still requires Yes to complete WW/Comms and legacy electrical forms, while Comms replacement requires new type/serial/sensor. Option and conditional expressions are exact portal metadata. Every row is RETEST pending real-device and live round-trip verification; signatures and branch unit tests already pass.

### Installation Form (WW) (`ww-installation`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Site details | Date and time | text | answers.site.date_time | Optional | RETEST |
| Site details | Customer / site name | text | answers.site.customer_name | Optional | RETEST |
| Site details | Address | multiline | answers.site.address | Optional | RETEST |
| Site details | Latitude | number | answers.site.latitude | Optional | RETEST |
| Site details | Longitude | number | answers.site.longitude | Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Installer details | Electrical licence number | text | answers.installer.electrical_license | Optional | RETEST |
| Pre-start information | Initial site inspection / checklist completed? | yesno | answers.prestart.site_inspection | Optional | RETEST |
| Pre-start information | Is a site induction required? | yesno | answers.prestart.site_induction | Optional | RETEST |
| Pre-start information | Do you have safe access? | yesno | answers.prestart.safe_access | Optional | RETEST |
| Pre-start information | Do you have the correct PPE? | yesno | answers.prestart.correct_ppe | Optional | RETEST |
| Pre-start information | Are you aware of all LIVE points? | yesno | answers.prestart.live_points | Optional | RETEST |
| Pre-start information | Can the power source be safely isolated? | yesno | answers.prestart.can_isolate | Optional | RETEST |
| Pre-start information | Additional hazards identified? | yesno | answers.prestart.additional_hazards | Optional | RETEST |
| Pre-start information | Additional hazard comments | multiline | answers.prestart.hazard_comments | Field: prestart.additional_hazards = yes; Optional | RETEST |
| Pre-start information | Can you safely proceed? | yesno | answers.prestart.safe_to_proceed | Optional | RETEST |
| 4G Auditor installation details | Switchboard name | text | answers.auditor.switchboard_name | Optional | RETEST |
| 4G Auditor installation details | Switchboard location | text | answers.auditor.switchboard_location | Optional | RETEST |
| 4G Auditor installation details | Address map locator (latitude / longitude) | text | answers.auditor.address_map_locator | Optional | RETEST |
| 4G Auditor installation details | Type of switchboard | select | answers.auditor.switchboard_type | Options: Main Switchboard, Sub / Distribution Board, HVAC DB, Lighting DB, Solar/PV DB, MCC, Other; Optional | RETEST |
| 4G Auditor installation details | Site NMI | text | answers.auditor.site_nmi | Optional | RETEST |
| 4G Auditor installation details | Auditor location photos | photo | attachments[].slot = auditor.location_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| 4G Auditor installation details | CT / Rogowski coil location photos | photo | attachments[].slot = auditor.sensor_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| 4G Auditor installation details | Circuit breaker location photos | photo | attachments[].slot = auditor.cb_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| 4G Auditor installation details | Meter / Device Type | select | answers.device.type | Options: A3RM, A6M; Optional | RETEST |
| 4G Auditor installation details | Device name | text | answers.device.name | Optional | RETEST |
| 4G Auditor installation details | Site / asset tag (optional — not the Device ID / serial) | text | answers.device.number | Scan: barcode; Optional | RETEST |
| 4G Auditor installation details | Device ID / serial | text | answers.device.id | Scan: barcode; Optional | RETEST |
| Channel 1 | Channel purpose | select | answers.channel.1.purpose | Section: device.type = A3RM, A6M; Options: Main board supply, Sub-circuit / asset, Spare / unused; Optional | RETEST |
| Channel 1 | Load | select | answers.channel.1.load | Section: device.type = A3RM, A6M; Field: channel.1.purpose = Main board supply, Sub-circuit / asset; Options depend on channel.1.purpose: {"Main board supply": ["Mains Supply"], "Sub-circuit / asset": ["HVAC", "Lighting", "Solar PV", "Forklift Charger", "Hot Water", "General Power", "Other"]}; Optional | RETEST |
| Channel 1 | Custom load type | text | answers.channel.1.custom_load_type | Section: device.type = A3RM, A6M; Field: channel.1.load = Other; Optional | RETEST |
| Channel 1 | CT / Rogowski coil rating | select | answers.channel.1.rating | Section: device.type = A3RM, A6M; Field: channel.1.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Options depend on device.type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| Channel 1 | Load description | text | answers.channel.1.description | Section: device.type = A3RM, A6M; Field: channel.1.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Channel 1 | Load / nameplate photos | photo | attachments[].slot = channel.1.nameplate_photos | Section: device.type = A3RM, A6M; Field: channel.1.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 2 | Channel purpose | select | answers.channel.2.purpose | Section: device.type = A3RM, A6M; Options: Main board supply, Sub-circuit / asset, Spare / unused; Optional | RETEST |
| Channel 2 | Load | select | answers.channel.2.load | Section: device.type = A3RM, A6M; Field: channel.2.purpose = Main board supply, Sub-circuit / asset; Options depend on channel.2.purpose: {"Main board supply": ["Mains Supply"], "Sub-circuit / asset": ["HVAC", "Lighting", "Solar PV", "Forklift Charger", "Hot Water", "General Power", "Other"]}; Optional | RETEST |
| Channel 2 | Custom load type | text | answers.channel.2.custom_load_type | Section: device.type = A3RM, A6M; Field: channel.2.load = Other; Optional | RETEST |
| Channel 2 | CT / Rogowski coil rating | select | answers.channel.2.rating | Section: device.type = A3RM, A6M; Field: channel.2.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Options depend on device.type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| Channel 2 | Load description | text | answers.channel.2.description | Section: device.type = A3RM, A6M; Field: channel.2.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Channel 2 | Load / nameplate photos | photo | attachments[].slot = channel.2.nameplate_photos | Section: device.type = A3RM, A6M; Field: channel.2.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 3 | Channel purpose | select | answers.channel.3.purpose | Section: device.type = A3RM, A6M; Options: Main board supply, Sub-circuit / asset, Spare / unused; Optional | RETEST |
| Channel 3 | Load | select | answers.channel.3.load | Section: device.type = A3RM, A6M; Field: channel.3.purpose = Main board supply, Sub-circuit / asset; Options depend on channel.3.purpose: {"Main board supply": ["Mains Supply"], "Sub-circuit / asset": ["HVAC", "Lighting", "Solar PV", "Forklift Charger", "Hot Water", "General Power", "Other"]}; Optional | RETEST |
| Channel 3 | Custom load type | text | answers.channel.3.custom_load_type | Section: device.type = A3RM, A6M; Field: channel.3.load = Other; Optional | RETEST |
| Channel 3 | CT / Rogowski coil rating | select | answers.channel.3.rating | Section: device.type = A3RM, A6M; Field: channel.3.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Options depend on device.type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| Channel 3 | Load description | text | answers.channel.3.description | Section: device.type = A3RM, A6M; Field: channel.3.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Channel 3 | Load / nameplate photos | photo | attachments[].slot = channel.3.nameplate_photos | Section: device.type = A3RM, A6M; Field: channel.3.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 4 | Channel purpose | select | answers.channel.4.purpose | Section: device.type = A6M; Options: Main board supply, Sub-circuit / asset, Spare / unused; Optional | RETEST |
| Channel 4 | Load | select | answers.channel.4.load | Section: device.type = A6M; Field: channel.4.purpose = Main board supply, Sub-circuit / asset; Options depend on channel.4.purpose: {"Main board supply": ["Mains Supply"], "Sub-circuit / asset": ["HVAC", "Lighting", "Solar PV", "Forklift Charger", "Hot Water", "General Power", "Other"]}; Optional | RETEST |
| Channel 4 | Custom load type | text | answers.channel.4.custom_load_type | Section: device.type = A6M; Field: channel.4.load = Other; Optional | RETEST |
| Channel 4 | CT / Rogowski coil rating | select | answers.channel.4.rating | Section: device.type = A6M; Field: channel.4.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Options depend on device.type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| Channel 4 | Load description | text | answers.channel.4.description | Section: device.type = A6M; Field: channel.4.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Channel 4 | Load / nameplate photos | photo | attachments[].slot = channel.4.nameplate_photos | Section: device.type = A6M; Field: channel.4.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 5 | Channel purpose | select | answers.channel.5.purpose | Section: device.type = A6M; Options: Main board supply, Sub-circuit / asset, Spare / unused; Optional | RETEST |
| Channel 5 | Load | select | answers.channel.5.load | Section: device.type = A6M; Field: channel.5.purpose = Main board supply, Sub-circuit / asset; Options depend on channel.5.purpose: {"Main board supply": ["Mains Supply"], "Sub-circuit / asset": ["HVAC", "Lighting", "Solar PV", "Forklift Charger", "Hot Water", "General Power", "Other"]}; Optional | RETEST |
| Channel 5 | Custom load type | text | answers.channel.5.custom_load_type | Section: device.type = A6M; Field: channel.5.load = Other; Optional | RETEST |
| Channel 5 | CT / Rogowski coil rating | select | answers.channel.5.rating | Section: device.type = A6M; Field: channel.5.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Options depend on device.type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| Channel 5 | Load description | text | answers.channel.5.description | Section: device.type = A6M; Field: channel.5.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Channel 5 | Load / nameplate photos | photo | attachments[].slot = channel.5.nameplate_photos | Section: device.type = A6M; Field: channel.5.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 6 | Channel purpose | select | answers.channel.6.purpose | Section: device.type = A6M; Options: Main board supply, Sub-circuit / asset, Spare / unused; Optional | RETEST |
| Channel 6 | Load | select | answers.channel.6.load | Section: device.type = A6M; Field: channel.6.purpose = Main board supply, Sub-circuit / asset; Options depend on channel.6.purpose: {"Main board supply": ["Mains Supply"], "Sub-circuit / asset": ["HVAC", "Lighting", "Solar PV", "Forklift Charger", "Hot Water", "General Power", "Other"]}; Optional | RETEST |
| Channel 6 | Custom load type | text | answers.channel.6.custom_load_type | Section: device.type = A6M; Field: channel.6.load = Other; Optional | RETEST |
| Channel 6 | CT / Rogowski coil rating | select | answers.channel.6.rating | Section: device.type = A6M; Field: channel.6.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Options depend on device.type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| Channel 6 | Load description | text | answers.channel.6.description | Section: device.type = A6M; Field: channel.6.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Channel 6 | Load / nameplate photos | photo | attachments[].slot = channel.6.nameplate_photos | Section: device.type = A6M; Field: channel.6.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed Auditor location photos | photo | attachments[].slot = auditor.installed_location | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Auditor serial-number photos | photo | attachments[].slot = auditor.serial_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed CT / Rogowski coil location photos | photo | attachments[].slot = auditor.sensor_installed | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed circuit-breaker location photos | photo | attachments[].slot = auditor.cb_installed | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Is the Auditor energised? | yesno | answers.commissioning.energised | Optional | RETEST |
| Commissioning | Are all three LEDs visible? | yesno | answers.commissioning.leds_visible | Optional | RETEST |
| Commissioning | Is the Auditor online in the WW Onboarding App? | yesno | answers.commissioning.online | Optional | RETEST |
| Commissioning | 4G signal strength | select | answers.commissioning.signal_strength | Options: Low, Medium, High; Optional | RETEST |
| Commissioning | Antenna type | select | answers.commissioning.antenna_type | Options: Internal, External, CSM550 - External High Gain, Other; Optional | RETEST |
| Commissioning | Start page completed? | yesno | answers.commissioning.start_complete | Optional | RETEST |
| Commissioning | Start page screenshot | photo | attachments[].slot = commissioning.start_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Channels page completed? | yesno | answers.commissioning.channels_complete | Optional | RETEST |
| Commissioning | Channels page screenshot | photo | attachments[].slot = commissioning.channels_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Phase A voltage - multi meter | number | answers.commissioning.phase_a_voltage | Optional | RETEST |
| Commissioning | Phase B voltage - multi meter | number | answers.commissioning.phase_b_voltage | Optional | RETEST |
| Commissioning | Phase C voltage - multi meter | number | answers.commissioning.phase_c_voltage | Optional | RETEST |
| Commissioning | Channel 1 polarity correct? | yesno | answers.commissioning.channel_1_polarity | Field: channel.1.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 1 current - AC clamp tester | number | answers.commissioning.channel_1_current | Field: channel.1.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 2 polarity correct? | yesno | answers.commissioning.channel_2_polarity | Field: channel.2.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 2 current - AC clamp tester | number | answers.commissioning.channel_2_current | Field: channel.2.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 3 polarity correct? | yesno | answers.commissioning.channel_3_polarity | Field: channel.3.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 3 current - AC clamp tester | number | answers.commissioning.channel_3_current | Field: channel.3.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 4 polarity correct? | yesno | answers.commissioning.channel_4_polarity | Field: channel.4.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 4 current - AC clamp tester | number | answers.commissioning.channel_4_current | Field: channel.4.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 5 polarity correct? | yesno | answers.commissioning.channel_5_polarity | Field: channel.5.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 5 current - AC clamp tester | number | answers.commissioning.channel_5_current | Field: channel.5.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 6 polarity correct? | yesno | answers.commissioning.channel_6_polarity | Field: channel.6.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Channel 6 current - AC clamp tester | number | answers.commissioning.channel_6_current | Field: channel.6.load = Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other; Optional | RETEST |
| Commissioning | Energy page screenshot | photo | attachments[].slot = commissioning.energy_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Completed installation photos (include the antenna) | photo | attachments[].slot = commissioning.completed_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Final comments | multiline | answers.commissioning.final_comments | Optional | RETEST |

### A3RM Installation (`a3rm-installation`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Site details | Date and time | text | answers.site.date_time | Optional | RETEST |
| Site details | Customer / site name | text | answers.site.customer_name | Optional | RETEST |
| Site details | Address | multiline | answers.site.address | Optional | RETEST |
| Site details | Latitude | number | answers.site.latitude | Optional | RETEST |
| Site details | Longitude | number | answers.site.longitude | Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Installer details | Electrical licence number | text | answers.installer.electrical_license | Optional | RETEST |
| Pre-start information | Initial site inspection / checklist completed? | yesno | answers.prestart.site_inspection | Optional | RETEST |
| Pre-start information | Is a site induction required? | yesno | answers.prestart.site_induction | Optional | RETEST |
| Pre-start information | Do you have safe access? | yesno | answers.prestart.safe_access | Optional | RETEST |
| Pre-start information | Do you have the correct PPE? | yesno | answers.prestart.correct_ppe | Optional | RETEST |
| Pre-start information | Are you aware of all LIVE points? | yesno | answers.prestart.live_points | Optional | RETEST |
| Pre-start information | Can the power source be safely isolated? | yesno | answers.prestart.can_isolate | Optional | RETEST |
| Pre-start information | Additional hazards identified? | yesno | answers.prestart.additional_hazards | Optional | RETEST |
| Pre-start information | Additional hazard comments | multiline | answers.prestart.hazard_comments | Field: prestart.additional_hazards = yes; Optional | RETEST |
| Pre-start information | Can you safely proceed? | yesno | answers.prestart.safe_to_proceed | Optional | RETEST |
| A3RM installation details | Switchboard name | text | answers.auditor.switchboard_name | Optional | RETEST |
| A3RM installation details | Switchboard location | text | answers.auditor.switchboard_location | Optional | RETEST |
| A3RM installation details | Type of switchboard | select | answers.auditor.switchboard_type | Options: Main Switchboard, Sub / Distribution Board, HVAC DB, Lighting DB, Solar/PV DB, MCC, Other; Optional | RETEST |
| A3RM installation details | Site NMI | text | answers.auditor.site_nmi | Optional | RETEST |
| A3RM installation details | Auditor location photos | photo | attachments[].slot = auditor.location_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| A3RM installation details | Rogowski coil location photos | photo | attachments[].slot = auditor.sensor_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| A3RM installation details | Circuit breaker location photos | photo | attachments[].slot = auditor.cb_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| A3RM installation details | A3RM 4G Auditor serial number | text | answers.auditor.serial_number | Optional | RETEST |
| Channel 1 | Rogowski coil size | select | answers.channel.1.rating | Options: 3000A – 9cm, 3000A – 20cm, 3000A – 29cm; Optional | RETEST |
| Channel 1 | Load | select | answers.channel.1.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 1 | Load description | text | answers.channel.1.description | Optional | RETEST |
| Channel 1 | Load / nameplate photos | photo | attachments[].slot = channel.1.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 2 | Rogowski coil size | select | answers.channel.2.rating | Options: 3000A – 9cm, 3000A – 20cm, 3000A – 29cm; Optional | RETEST |
| Channel 2 | Load | select | answers.channel.2.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 2 | Load description | text | answers.channel.2.description | Optional | RETEST |
| Channel 2 | Load / nameplate photos | photo | attachments[].slot = channel.2.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 3 | Rogowski coil size | select | answers.channel.3.rating | Options: 3000A – 9cm, 3000A – 20cm, 3000A – 29cm; Optional | RETEST |
| Channel 3 | Load | select | answers.channel.3.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 3 | Load description | text | answers.channel.3.description | Optional | RETEST |
| Channel 3 | Load / nameplate photos | photo | attachments[].slot = channel.3.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed Auditor location photos | photo | attachments[].slot = auditor.installed_location | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Auditor serial-number photos | photo | attachments[].slot = auditor.serial_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed Rogowski coil location photos | photo | attachments[].slot = auditor.sensor_installed | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed circuit-breaker location photos | photo | attachments[].slot = auditor.cb_installed | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Is the Auditor energised? | yesno | answers.commissioning.energised | Optional | RETEST |
| Commissioning | Are all three LEDs visible? | yesno | answers.commissioning.leds_visible | Optional | RETEST |
| Commissioning | Is the Auditor online in the WW Onboarding App? | yesno | answers.commissioning.online | Optional | RETEST |
| Commissioning | 4G signal strength | select | answers.commissioning.signal_strength | Options: Low, Medium, High; Optional | RETEST |
| Commissioning | Antenna type | select | answers.commissioning.antenna_type | Options: Internal, External, CSM550 - External High Gain, Other; Optional | RETEST |
| Commissioning | Start page completed? | yesno | answers.commissioning.start_complete | Optional | RETEST |
| Commissioning | Start page screenshot | photo | attachments[].slot = commissioning.start_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Channels page completed? | yesno | answers.commissioning.channels_complete | Optional | RETEST |
| Commissioning | Channels page screenshot | photo | attachments[].slot = commissioning.channels_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Phase A voltage - multi meter | number | answers.commissioning.phase_a_voltage | Optional | RETEST |
| Commissioning | Phase B voltage - multi meter | number | answers.commissioning.phase_b_voltage | Optional | RETEST |
| Commissioning | Phase C voltage - multi meter | number | answers.commissioning.phase_c_voltage | Optional | RETEST |
| Commissioning | Channel 1 polarity correct? | yesno | answers.commissioning.channel_1_polarity | Field: channel.1.rating = 3000A – 9cm, 3000A – 20cm, 3000A – 29cm, 10cm-200A, 10cm-333mV, 20cm-3000A, 30cm-3000A, 45cm-3000A, 3000A - 9cm, 3000A - 20cm, 3000A - 29cm; Optional | RETEST |
| Commissioning | Channel 1 current - AC clamp tester | number | answers.commissioning.channel_1_current | Field: channel.1.rating = 3000A – 9cm, 3000A – 20cm, 3000A – 29cm, 10cm-200A, 10cm-333mV, 20cm-3000A, 30cm-3000A, 45cm-3000A, 3000A - 9cm, 3000A - 20cm, 3000A - 29cm; Optional | RETEST |
| Commissioning | Channel 2 polarity correct? | yesno | answers.commissioning.channel_2_polarity | Field: channel.2.rating = 3000A – 9cm, 3000A – 20cm, 3000A – 29cm, 10cm-200A, 10cm-333mV, 20cm-3000A, 30cm-3000A, 45cm-3000A, 3000A - 9cm, 3000A - 20cm, 3000A - 29cm; Optional | RETEST |
| Commissioning | Channel 2 current - AC clamp tester | number | answers.commissioning.channel_2_current | Field: channel.2.rating = 3000A – 9cm, 3000A – 20cm, 3000A – 29cm, 10cm-200A, 10cm-333mV, 20cm-3000A, 30cm-3000A, 45cm-3000A, 3000A - 9cm, 3000A - 20cm, 3000A - 29cm; Optional | RETEST |
| Commissioning | Channel 3 polarity correct? | yesno | answers.commissioning.channel_3_polarity | Field: channel.3.rating = 3000A – 9cm, 3000A – 20cm, 3000A – 29cm, 10cm-200A, 10cm-333mV, 20cm-3000A, 30cm-3000A, 45cm-3000A, 3000A - 9cm, 3000A - 20cm, 3000A - 29cm; Optional | RETEST |
| Commissioning | Channel 3 current - AC clamp tester | number | answers.commissioning.channel_3_current | Field: channel.3.rating = 3000A – 9cm, 3000A – 20cm, 3000A – 29cm, 10cm-200A, 10cm-333mV, 20cm-3000A, 30cm-3000A, 45cm-3000A, 3000A - 9cm, 3000A - 20cm, 3000A - 29cm; Optional | RETEST |
| Commissioning | Energy page screenshot | photo | attachments[].slot = commissioning.energy_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Completed installation photos (include the antenna) | photo | attachments[].slot = commissioning.completed_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Final comments | multiline | answers.commissioning.final_comments | Optional | RETEST |

### A6M Installation (`a6m-installation`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Site details | Date and time | text | answers.site.date_time | Optional | RETEST |
| Site details | Customer / site name | text | answers.site.customer_name | Optional | RETEST |
| Site details | Address | multiline | answers.site.address | Optional | RETEST |
| Site details | Latitude | number | answers.site.latitude | Optional | RETEST |
| Site details | Longitude | number | answers.site.longitude | Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Installer details | Electrical licence number | text | answers.installer.electrical_license | Optional | RETEST |
| Pre-start information | Initial site inspection / checklist completed? | yesno | answers.prestart.site_inspection | Optional | RETEST |
| Pre-start information | Is a site induction required? | yesno | answers.prestart.site_induction | Optional | RETEST |
| Pre-start information | Do you have safe access? | yesno | answers.prestart.safe_access | Optional | RETEST |
| Pre-start information | Do you have the correct PPE? | yesno | answers.prestart.correct_ppe | Optional | RETEST |
| Pre-start information | Are you aware of all LIVE points? | yesno | answers.prestart.live_points | Optional | RETEST |
| Pre-start information | Can the power source be safely isolated? | yesno | answers.prestart.can_isolate | Optional | RETEST |
| Pre-start information | Additional hazards identified? | yesno | answers.prestart.additional_hazards | Optional | RETEST |
| Pre-start information | Additional hazard comments | multiline | answers.prestart.hazard_comments | Field: prestart.additional_hazards = yes; Optional | RETEST |
| Pre-start information | Can you safely proceed? | yesno | answers.prestart.safe_to_proceed | Optional | RETEST |
| A6M installation details | Switchboard name | text | answers.auditor.switchboard_name | Optional | RETEST |
| A6M installation details | Switchboard location | text | answers.auditor.switchboard_location | Optional | RETEST |
| A6M installation details | Type of switchboard | select | answers.auditor.switchboard_type | Options: Main Switchboard, Sub / Distribution Board, HVAC DB, Lighting DB, Solar/PV DB, MCC, Other; Optional | RETEST |
| A6M installation details | Site NMI | text | answers.auditor.site_nmi | Optional | RETEST |
| A6M installation details | Auditor location photos | photo | attachments[].slot = auditor.location_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| A6M installation details | CT location photos | photo | attachments[].slot = auditor.sensor_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| A6M installation details | Circuit breaker location photos | photo | attachments[].slot = auditor.cb_before | Multiple; camera/library, caption/remove; Optional | RETEST |
| A6M installation details | A6M 4G Auditor serial number | text | answers.auditor.serial_number | Optional | RETEST |
| Channel 1 | CT rating | select | answers.channel.1.rating | Options: 60A, 120A, 200A, 400A, 600A; Optional | RETEST |
| Channel 1 | Load | select | answers.channel.1.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 1 | Load description | text | answers.channel.1.description | Optional | RETEST |
| Channel 1 | Load / nameplate photos | photo | attachments[].slot = channel.1.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 2 | CT rating | select | answers.channel.2.rating | Options: 60A, 120A, 200A, 400A, 600A; Optional | RETEST |
| Channel 2 | Load | select | answers.channel.2.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 2 | Load description | text | answers.channel.2.description | Optional | RETEST |
| Channel 2 | Load / nameplate photos | photo | attachments[].slot = channel.2.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 3 | CT rating | select | answers.channel.3.rating | Options: 60A, 120A, 200A, 400A, 600A; Optional | RETEST |
| Channel 3 | Load | select | answers.channel.3.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 3 | Load description | text | answers.channel.3.description | Optional | RETEST |
| Channel 3 | Load / nameplate photos | photo | attachments[].slot = channel.3.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 4 | CT rating | select | answers.channel.4.rating | Options: 60A, 120A, 200A, 400A, 600A; Optional | RETEST |
| Channel 4 | Load | select | answers.channel.4.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 4 | Load description | text | answers.channel.4.description | Optional | RETEST |
| Channel 4 | Load / nameplate photos | photo | attachments[].slot = channel.4.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 5 | CT rating | select | answers.channel.5.rating | Options: 60A, 120A, 200A, 400A, 600A; Optional | RETEST |
| Channel 5 | Load | select | answers.channel.5.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 5 | Load description | text | answers.channel.5.description | Optional | RETEST |
| Channel 5 | Load / nameplate photos | photo | attachments[].slot = channel.5.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Channel 6 | CT rating | select | answers.channel.6.rating | Options: 60A, 120A, 200A, 400A, 600A; Optional | RETEST |
| Channel 6 | Load | select | answers.channel.6.load | Options: Mains Supply, HVAC, Lighting, Solar PV, Forklift Charger, Hot Water, General Power, Other, Not Used; Optional | RETEST |
| Channel 6 | Load description | text | answers.channel.6.description | Optional | RETEST |
| Channel 6 | Load / nameplate photos | photo | attachments[].slot = channel.6.nameplate_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed Auditor location photos | photo | attachments[].slot = auditor.installed_location | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Auditor serial-number photos | photo | attachments[].slot = auditor.serial_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed CT location photos | photo | attachments[].slot = auditor.sensor_installed | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installed evidence | Installed circuit-breaker location photos | photo | attachments[].slot = auditor.cb_installed | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Is the Auditor energised? | yesno | answers.commissioning.energised | Optional | RETEST |
| Commissioning | Are all three LEDs visible? | yesno | answers.commissioning.leds_visible | Optional | RETEST |
| Commissioning | Is the Auditor online in the WW Onboarding App? | yesno | answers.commissioning.online | Optional | RETEST |
| Commissioning | 4G signal strength | select | answers.commissioning.signal_strength | Options: Low, Medium, High; Optional | RETEST |
| Commissioning | Antenna type | select | answers.commissioning.antenna_type | Options: Internal, External, CSM550 - External High Gain, Other; Optional | RETEST |
| Commissioning | Start page completed? | yesno | answers.commissioning.start_complete | Optional | RETEST |
| Commissioning | Start page screenshot | photo | attachments[].slot = commissioning.start_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Channels page completed? | yesno | answers.commissioning.channels_complete | Optional | RETEST |
| Commissioning | Channels page screenshot | photo | attachments[].slot = commissioning.channels_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Phase A voltage - multi meter | number | answers.commissioning.phase_a_voltage | Optional | RETEST |
| Commissioning | Phase B voltage - multi meter | number | answers.commissioning.phase_b_voltage | Optional | RETEST |
| Commissioning | Phase C voltage - multi meter | number | answers.commissioning.phase_c_voltage | Optional | RETEST |
| Commissioning | Channel 1 polarity correct? | yesno | answers.commissioning.channel_1_polarity | Field: channel.1.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 1 current - AC clamp tester | number | answers.commissioning.channel_1_current | Field: channel.1.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 2 polarity correct? | yesno | answers.commissioning.channel_2_polarity | Field: channel.2.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 2 current - AC clamp tester | number | answers.commissioning.channel_2_current | Field: channel.2.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 3 polarity correct? | yesno | answers.commissioning.channel_3_polarity | Field: channel.3.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 3 current - AC clamp tester | number | answers.commissioning.channel_3_current | Field: channel.3.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 4 polarity correct? | yesno | answers.commissioning.channel_4_polarity | Field: channel.4.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 4 current - AC clamp tester | number | answers.commissioning.channel_4_current | Field: channel.4.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 5 polarity correct? | yesno | answers.commissioning.channel_5_polarity | Field: channel.5.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 5 current - AC clamp tester | number | answers.commissioning.channel_5_current | Field: channel.5.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 6 polarity correct? | yesno | answers.commissioning.channel_6_polarity | Field: channel.6.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Channel 6 current - AC clamp tester | number | answers.commissioning.channel_6_current | Field: channel.6.rating = 60A, 120A, 200A, 400A, 600A, CT-60A, CT-120A, CT-250A, CT-400A, CT-600A; Optional | RETEST |
| Commissioning | Energy page screenshot | photo | attachments[].slot = commissioning.energy_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Completed installation photos (include the antenna) | photo | attachments[].slot = commissioning.completed_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning | Final comments | multiline | answers.commissioning.final_comments | Optional | RETEST |

### Comms Fault (`comms-fault`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Customer details | Date and time | text | answers.site.date_time | Optional | RETEST |
| Customer details | Customer / site name | text | answers.site.customer_name | Optional | RETEST |
| Customer details | Address | multiline | answers.site.address | Optional | RETEST |
| Customer details | Latitude | number | answers.site.latitude | Optional | RETEST |
| Customer details | Longitude | number | answers.site.longitude | Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Installer details | Electrical licence number | text | answers.installer.electrical_license | Optional | RETEST |
| Pre-start information | Initial site inspection / checklist completed? | yesno | answers.prestart.site_inspection | Optional | RETEST |
| Pre-start information | Is a site induction required? | yesno | answers.prestart.site_induction | Optional | RETEST |
| Pre-start information | Do you have safe access? | yesno | answers.prestart.safe_access | Optional | RETEST |
| Pre-start information | Do you have the correct PPE? | yesno | answers.prestart.correct_ppe | Optional | RETEST |
| Pre-start information | Are you aware of all LIVE points? | yesno | answers.prestart.live_points | Optional | RETEST |
| Pre-start information | Can the power source be safely isolated? | yesno | answers.prestart.can_isolate | Optional | RETEST |
| Pre-start information | Additional hazards identified? | yesno | answers.prestart.additional_hazards | Optional | RETEST |
| Pre-start information | Additional hazard comments | multiline | answers.prestart.hazard_comments | Field: prestart.additional_hazards = yes; Optional | RETEST |
| Pre-start information | Can you safely proceed? | yesno | answers.prestart.safe_to_proceed | Optional | RETEST |
| Existing installation | Switchboard location | text | answers.existing.switchboard_location | Optional | RETEST |
| Existing installation | Type of switchboard | select | answers.existing.switchboard_type | Options: Main Switchboard, Sub / Distribution Board, HVAC DB, Lighting DB, Solar/PV DB, MCC, Other; Optional | RETEST |
| Existing installation | Site NMI | text | answers.existing.site_nmi | Optional | RETEST |
| Existing installation | Whole switchboard photos | photo | attachments[].slot = existing.switchboard_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Existing installation | Existing Meter / Device Type | select | answers.existing.device_type | Options: A3RM, A6M; Optional | RETEST |
| Existing installation | Existing site / asset tag (optional — not the Device ID / serial) | text | answers.existing.device_number | Scan: barcode; Optional | RETEST |
| Existing installation | Existing Device ID / serial | text | answers.existing.device_id | Scan: barcode; Optional | RETEST |
| Existing installation | Existing CT / Rogowski coil rating | select | answers.existing.sensor_rating | Field: existing.device_type = A3RM, A6M; Options depend on existing.device_type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| Existing installation | Is the Auditor energised? | yesno | answers.existing.energised | Optional | RETEST |
| Existing installation | Are LEDs visible? | yesno | answers.existing.leds_visible | Optional | RETEST |
| Existing installation | Is the Auditor online in the WW app? | yesno | answers.existing.online | Optional | RETEST |
| Existing installation | Existing signal strength | select | answers.existing.signal | Options: Low, Medium, High; Optional | RETEST |
| Existing installation | Existing antenna type | select | answers.existing.antenna | Options: Internal, External, CSM550 - External High Gain, Other; Optional | RETEST |
| On-site works | Device rebooted? | yesno | answers.works.rebooted | Optional | RETEST |
| On-site works | Relevant LEDs visible after reboot? | yesno | answers.works.leds_visible | Optional | RETEST |
| On-site works | Does the device need replacement? | yesno | answers.works.replace_device | Optional | RETEST |
| On-site works | New Meter / Device Type | select | answers.works.new_device_type | Field: works.replace_device = yes; Options: A3RM, A6M; Optional | RETEST |
| On-site works | New site / asset tag (optional — not the Device ID / serial) | text | answers.works.new_device_number | Field: works.replace_device = yes; Scan: barcode; Optional | RETEST |
| On-site works | New Device ID / serial | text | answers.works.new_device_id | Field: works.replace_device = yes; Scan: barcode; Optional | RETEST |
| On-site works | New CT / Rogowski coil rating | select | answers.works.new_sensor_rating | Field: works.new_device_type = A3RM, A6M; Options depend on works.new_device_type: {"A3RM": ["3000A – 9cm", "3000A – 20cm", "3000A – 29cm"], "A6M": ["60A", "120A", "200A", "400A", "600A"]}; Optional | RETEST |
| On-site works | Is the new device online? | yesno | answers.works.new_online | Field: works.replace_device = yes; Optional | RETEST |
| On-site works | New device signal strength | select | answers.works.new_signal | Field: works.replace_device = yes; Options: Low, Medium, High; Optional | RETEST |
| On-site works | Install an external antenna? | yesno | answers.works.external_antenna | Optional | RETEST |
| On-site works | Signal after external antenna | select | answers.works.external_signal | Field: works.external_antenna = yes; Options: Low, Medium, High; Optional | RETEST |
| On-site works | Extend the external antenna? | yesno | answers.works.extend_antenna | Optional | RETEST |
| On-site works | Signal after antenna extension | select | answers.works.extended_signal | Field: works.extend_antenna = yes; Options: Low, Medium, High; Optional | RETEST |
| Commissioning details | WW Onboarding App completed for the new device? | yesno | answers.commissioning.onboarding_complete | Field: works.replace_device = yes; Optional | RETEST |
| Commissioning details | New device details match the old device? | yesno | answers.commissioning.details_same | Field: works.replace_device = yes; Optional | RETEST |
| Commissioning details | Start page screenshot | photo | attachments[].slot = commissioning.start_screenshot | Field: works.replace_device = yes; Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning details | Energy page screenshot | photo | attachments[].slot = commissioning.energy_screenshot | Field: works.replace_device = yes; Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning details | Final completed-work photos (include the antenna) | photo | attachments[].slot = commissioning.completed_photos | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning details | Final comments | multiline | answers.commissioning.final_comments | Optional | RETEST |

### ACE Switchboard (`ace-switchboard`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Switchboard details | Date | text | answers.site.date_time | Optional | RETEST |
| Switchboard details | Job name | text | answers.job.name | Optional | RETEST |
| Switchboard details | Job number | text | answers.job.number | Scan: barcode; Optional | RETEST |
| Switchboard details | Switchboard QR / document link | text | answers.job.qr_link | Scan: qr; Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Installer details | Electrical licence number | text | answers.installer.electrical_license | Optional | RETEST |
| Installer details | REC number | text | answers.installer.rec_number | Optional | RETEST |
| Installation information | Have the CTs been installed? | yesno | answers.install.ct_installed | Optional | RETEST |
| Installation information | Are CTs installed with P1 facing the grid? | yesno | answers.install.ct_orientation | Optional | RETEST |
| Installation information | CT ratio | text | answers.install.ct_ratio | Optional | RETEST |
| Installation information | Phase A CT serial number | text | answers.install.ct_serial_a | Scan: barcode; Optional | RETEST |
| Installation information | Phase B CT serial number | text | answers.install.ct_serial_b | Scan: barcode; Optional | RETEST |
| Installation information | Phase C CT serial number | text | answers.install.ct_serial_c | Scan: barcode; Optional | RETEST |
| Installation information | CT chamber photos | photo | attachments[].slot = install.ct_chamber_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installation information | Has a test block been installed? | yesno | answers.install.test_block | Optional | RETEST |
| Installation information | Does the star point need removal? | yesno | answers.install.remove_star_point | Optional | RETEST |
| Installation information | Has the star point been removed? | yesno | answers.install.star_point_removed | Optional | RETEST |
| Installation information | Fuses installed in CT chamber? | yesno | answers.install.ct_fuses | Optional | RETEST |
| Installation information | CT chamber fuse rating | text | answers.install.ct_fuse_rating | Optional | RETEST |
| Installation information | Secondary fuses installed on meter panel? | yesno | answers.install.secondary_fuses | Optional | RETEST |
| Installation information | Meter panel fuse rating | text | answers.install.secondary_fuse_rating | Optional | RETEST |
| Installation information | Meter panel photos | photo | attachments[].slot = install.meter_panel_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installation information | Has the loom cable been installed? | yesno | answers.install.loom_installed | Optional | RETEST |
| Installation information | Loom cable type | text | answers.install.loom_type | Optional | RETEST |
| Installation information | Loom cable size | text | answers.install.loom_size | Optional | RETEST |
| Installation information | CT chamber and meter panel wiring complete? | yesno | answers.install.wiring_complete | Optional | RETEST |
| Installation information | Completed CT chamber wiring photos | photo | attachments[].slot = install.ct_wiring_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Installation information | Completed meter panel wiring photos | photo | attachments[].slot = install.panel_wiring_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Pre-commissioning | Test meter connected? | yesno | answers.precommission.test_meter | Optional | RETEST |
| Pre-commissioning | Point-to-point testing completed? | yesno | answers.precommission.point_to_point | Optional | RETEST |
| Pre-commissioning | 100A load box connected? | yesno | answers.precommission.load_box | Optional | RETEST |
| Pre-commissioning | Safe to energise for testing? | yesno | answers.precommission.safe_energise | Optional | RETEST |
| Pre-commissioning | Correct PPE worn? | yesno | answers.precommission.correct_ppe | Optional | RETEST |
| Pre-commissioning | Installation energised and live points understood? | yesno | answers.precommission.energised | Optional | RETEST |
| Pre-commissioning | Correct CT ratio set in test meter? | yesno | answers.precommission.ct_ratio_set | Optional | RETEST |
| Commissioning / testing | Phase A voltage | number | answers.testing.phase_a_voltage | Optional | RETEST |
| Commissioning / testing | Phase A primary current | number | answers.testing.phase_a_primary_current | Optional | RETEST |
| Commissioning / testing | Phase A secondary current | number | answers.testing.phase_a_secondary_current | Optional | RETEST |
| Commissioning / testing | Phase B voltage | number | answers.testing.phase_b_voltage | Optional | RETEST |
| Commissioning / testing | Phase B primary current | number | answers.testing.phase_b_primary_current | Optional | RETEST |
| Commissioning / testing | Phase B secondary current | number | answers.testing.phase_b_secondary_current | Optional | RETEST |
| Commissioning / testing | Phase C voltage | number | answers.testing.phase_c_voltage | Optional | RETEST |
| Commissioning / testing | Phase C primary current | number | answers.testing.phase_c_primary_current | Optional | RETEST |
| Commissioning / testing | Phase C secondary current | number | answers.testing.phase_c_secondary_current | Optional | RETEST |
| Commissioning / testing | EziView status-screen photos | photo | attachments[].slot = testing.status_screen | Multiple; camera/library, caption/remove; Optional | RETEST |
| Commissioning / testing | EziView phasor-diagram photos | photo | attachments[].slot = testing.phasor_diagram | Multiple; camera/library, caption/remove; Optional | RETEST |
| Final checks | Installation de-energised? | yesno | answers.final.deenergised | Optional | RETEST |
| Final checks | Load box removed? | yesno | answers.final.load_box_removed | Optional | RETEST |
| Final checks | Test meter removed? | yesno | answers.final.test_meter_removed | Optional | RETEST |
| Final checks | Single-screw connectors installed? | yesno | answers.final.connectors_installed | Optional | RETEST |
| Final checks | All connections checked? | yesno | answers.final.connections_checked | Optional | RETEST |
| Final checks | Installation, testing and commissioning completed? | yesno | answers.final.completed | Optional | RETEST |
| Final checks | Completed installation photos | photo | attachments[].slot = final.completed_photo | Multiple; camera/library, caption/remove; Optional | RETEST |

### Honeywell Q400 (`honeywell-q400`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Installation details | Date and time | text | answers.site.date_time | Optional | RETEST |
| Installation details | Customer / site name | text | answers.site.customer_name | Optional | RETEST |
| Installation details | Address | multiline | answers.site.address | Optional | RETEST |
| Installation details | Latitude | number | answers.site.latitude | Optional | RETEST |
| Installation details | Longitude | number | answers.site.longitude | Optional | RETEST |
| Installation details | Physical meter location | text | answers.water.physical_location | Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Water meter information | Water meter serial number | text | answers.water.serial_number | Scan: barcode; Optional | RETEST |
| Water meter information | Activated per SW work instructions? | yesno | answers.water.activated | Optional | RETEST |
| Water meter information | Registered to the network? | yesno | answers.water.network_registered | Optional | RETEST |
| Water meter information | LCD screen showing 4 0 2 | photo | attachments[].slot = water.lcd_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Water meter information | Completed water-meter installation | photo | attachments[].slot = water.completed_photo | Multiple; camera/library, caption/remove; Optional | RETEST |

### Captis Logger (`captis-logger`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Installation details | Date and time | text | answers.site.date_time | Optional | RETEST |
| Installation details | Customer / site name | text | answers.site.customer_name | Optional | RETEST |
| Installation details | Address | multiline | answers.site.address | Optional | RETEST |
| Installation details | Latitude | number | answers.site.latitude | Optional | RETEST |
| Installation details | Longitude | number | answers.site.longitude | Optional | RETEST |
| Installation details | Physical Captis Logger location | text | answers.captis.physical_location | Optional | RETEST |
| Installation details | Meter supply description | text | answers.captis.supply_description | Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Meter information | Meter type | text | answers.meter.type | Optional | RETEST |
| Meter information | Meter make | text | answers.meter.make | Optional | RETEST |
| Meter information | Meter model | text | answers.meter.model | Optional | RETEST |
| Meter information | Meter serial number | text | answers.meter.serial_number | Scan: barcode; Optional | RETEST |
| Meter information | Pulse / sensor type | text | answers.meter.sensor_type | Optional | RETEST |
| Meter information | Pulse / flow rate | text | answers.meter.flow_rate | Optional | RETEST |
| Meter information | Current meter read (offset value) | text | answers.meter.current_read | Optional | RETEST |
| Meter information | Meter face close-up | photo | attachments[].slot = meter.face_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| Captis Logger information | Captis Logger serial number | text | answers.logger.serial_number | Scan: barcode; Optional | RETEST |
| Captis Logger information | RSRP value / signal strength | number | answers.logger.rsrp | Optional | RETEST |
| Captis Logger information | External antenna installed? | yesno | answers.logger.external_antenna | Optional | RETEST |
| Captis Logger information | Cumulocity configured? | yesno | answers.logger.cumulocity_configured | Optional | RETEST |
| Captis Logger information | Cumulocity screenshot taken? | yesno | answers.logger.screenshot_taken | Optional | RETEST |
| Captis Logger information | Cumulocity screenshot | photo | attachments[].slot = logger.cumulocity_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |

### SUMS Logger (`sums-logger`)

| Section | Field / label | Type | API key / photo slot | Options / conditional behavior | Status |
| --- | --- | --- | --- | --- | --- |
| Installation details | Date and time | text | answers.site.date_time | Optional | RETEST |
| Installation details | Customer / site name | text | answers.site.customer_name | Optional | RETEST |
| Installation details | Address | multiline | answers.site.address | Optional | RETEST |
| Installation details | Latitude | number | answers.site.latitude | Optional | RETEST |
| Installation details | Longitude | number | answers.site.longitude | Optional | RETEST |
| Installation details | Physical SUMS Logger location | text | answers.captis.physical_location | Optional | RETEST |
| Installation details | Meter supply description | text | answers.captis.supply_description | Optional | RETEST |
| Installer details | Installer name | text | answers.installer.name | Optional | RETEST |
| Meter information | Meter type | text | answers.meter.type | Optional | RETEST |
| Meter information | Meter make | text | answers.meter.make | Optional | RETEST |
| Meter information | Meter model | text | answers.meter.model | Optional | RETEST |
| Meter information | Meter serial number | text | answers.meter.serial_number | Scan: barcode, qr; Optional | RETEST |
| Meter information | Pulse / sensor type | text | answers.meter.sensor_type | Optional | RETEST |
| Meter information | Pulse / flow rate | text | answers.meter.flow_rate | Optional | RETEST |
| Meter information | Current meter read (offset value) | text | answers.meter.current_read | Optional | RETEST |
| Meter information | Meter face close-up | photo | attachments[].slot = meter.face_photo | Multiple; camera/library, caption/remove; Optional | RETEST |
| SUMS Logger information | SUMS Logger serial number | text | answers.logger.serial_number | Scan: barcode, qr; Optional | RETEST |
| SUMS Logger information | RSRP value / signal strength | number | answers.logger.rsrp | Optional | RETEST |
| SUMS Logger information | External antenna installed? | yesno | answers.logger.external_antenna | Optional | RETEST |
| SUMS Logger information | Cumulocity configured? | yesno | answers.logger.cumulocity_configured | Optional | RETEST |
| SUMS Logger information | Cumulocity screenshot taken? | yesno | answers.logger.screenshot_taken | Optional | RETEST |
| SUMS Logger information | Cumulocity screenshot | photo | attachments[].slot = logger.cumulocity_screenshot | Multiple; camera/library, caption/remove; Optional | RETEST |

