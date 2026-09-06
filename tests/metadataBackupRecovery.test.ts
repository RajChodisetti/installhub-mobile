import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from 'js-sha256';
import type { AppDataStore, DisplayCode, PendingMetadataBackupAttempt } from '../src/types';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import { buildInstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import { projectCanonicalCompatibility } from '../src/domain/installationV2';
import { applyMetadataBackupRecovery, type MetadataBackupRecoveryCommitFence } from '../src/services/metadataBackupRecovery';
import { registerAssignedWorkNavigationSnapshot } from '../src/services/assignedWorkNavigationFence';
import { acquireInstallationRecovery } from '../src/services/installationRecoveryFence';
import { applyPreparedMetadataBackupAttempt, applyAcceptedMetadataBackupAttempt, applyFinishedMetadataBackupAttempt } from '../src/repositories/metadataBackupRepository';

type Row = Record<string, unknown>;
const id = 'installation'; const actor = 'actor'; const stamp = '2026-09-01T00:00:00.000Z';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => sha256(JSON.stringify(value));
const code = (value: string): DisplayCode => ({ value, generatedValue: value, isOverridden: false, provisional: true, ruleVersion: 1 });
function fixture(): AppDataStore {
  const store: AppDataStore = {
    schemaVersion: 3, user: { id: actor, email: 'qa@example.test', full_name: 'QA', role: 'admin' },
    installations: [{ id, local_owner_user_id: actor, assigned_work_state: 'none',
      client_name: 'QA Client', site_name: 'QA Site', site_address: 'QA Address', inspector_name: 'QA',
      audit_date: '2026-09-01', status: 'Draft', tree_schema_version: 2, tree_revision: 19,
      external_key: 'local:installation', site_code: 'QA', timezone: 'Australia/Sydney', cloud_backup_enabled: true,
      server_tree_revision: 10, last_synced_local_tree_revision: 19, last_synced_server_tree_revision: 10,
      created_at: stamp, updated_at: stamp, job_comments: 'Original notes', maas: false }],
    gridSupplies: [{ id: 'grid', installationId: id, name: 'Grid', isDefault: true }],
    zones: [{ id: 'zone', audit_id: id, zone_code: 'ZONE', zone_name: 'Zone', zone_description: '', photos: [], created_at: stamp, updated_at: stamp }],
    electricalAssets: [{ id: 'board', audit_id: id, zone_id: 'zone', asset_name: 'QA Board', asset_type: 'MSB', type_code: 'MSB',
      display_code: 'QA-MSB-900', display_code_meta: code('QA-MSB-900'), electrical_source: { kind: 'GRID', gridSupplyId: 'grid' },
      meter_present: true, meters: [], created_at: stamp, updated_at: stamp }],
    siteAssets: [{ id: 'asset', audit_id: id, zone_id: 'zone', asset_name: 'QA Load', asset_type: 'HVAC', type_code: 'HVAC',
      display_code: 'QA-HVAC-900', display_code_meta: code('QA-HVAC-900'), electrical_source: { kind: 'BOARD', boardId: 'board' },
      metering_state: { kind: 'UNMETERED' }, meter_present: false, created_at: stamp, updated_at: stamp }],
    meterDevices: [{ id: 'meter', installationId: id, installedOnBoardId: 'board', deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM',
      customName: 'QA Meter', serialNumber: 'QA-OLD', displayName: code('QA-A3RM-900'),
      channels: [{ id: 'meter:1', ordinal: 1, purpose: 'SUB_CIRCUIT', capabilities: {} }],
      wwPhotos: { deviceInstalled: 'file:///Documents/installhub-media/qa.jpg' } }],
    measurementAssignments: [],
    formSubmissions: [{ id: 'form', installation_id: id, form_type: 'captis-logger', schema_version: 2, status: 'Draft',
      answers: { 'notes.text': 'Original answer' }, attachments: [], created_at: stamp, updated_at: stamp }],
    cloudSync: { synced_at_by_installation: { [id]: stamp }, force_dirty_installation_ids: [id],
      upload_queue: [{ id: 'upload', installation_id: id, entity_type: 'meter_device', entity_id: 'meter', field_name: 'wwPhotos.deviceInstalled',
        local_uri: 'file:///Documents/installhub-media/qa.jpg', remote_url: 'https://qa.example.test/qa.jpg', mime_type: 'image/jpeg', status: 'cleared', attempts: 1,
        updated_at: stamp }], thumbnail_queue: [] },
  };
  projectCanonicalCompatibility(store, id);
  return store;
}
function canonical(payload: Record<string, unknown>, revision: number): RemoteInstallationTree {
  const tree = clone(payload) as unknown as RemoteInstallationTree;
  tree.treeRevision = revision; tree.recordVersionNumber = 9;
  tree.installation.externalKey = 'ih_qa_installation'; tree.installation.treeRevision = revision;
  tree.installation.recordVersionNumber = 9; tree.installation.createdByUserId = actor;
  for (const [collection, field, prefix] of [
    [tree.electricalAssets, 'displayCode', 'MSB'], [tree.siteAssets, 'displayCode', 'HVAC'], [tree.meterDevices!, 'displayName', 'A3RM'],
  ] as const) for (const row of collection) row[field] = { ...code(`QA-${prefix}-001`), provisional: false };
  tree.serverDerived = { virtualMeterDefinitions: [] };
  return tree;
}
function scenario() {
  const store = fixture();
  const sent = clone(buildInstallationBackupTree(store, store.installations[0]!));
  const payload = clone(buildBackupPayload(sent, store.cloudSync.upload_queue, 'metadata'));
  const prior = canonical(payload, 10); const remote = canonical(payload, 11);
  const attempt = {
    version: 1, id: '', installation_id: id, actor_user_id: actor, payload, payload_sha256: hash(payload),
    sent_tree: sent, sent_tree_sha256: hash(sent), base_tree_revision: 10,
    base_remote_tree: prior, base_remote_tree_sha256: hash(prior), local_tree_revision: 19,
    tree_watermark: sent.watermark, installation_status: 'Draft', prepared_at: stamp,
    accepted_tree_revision: 11, accepted_record_version_number: 9,
  } as PendingMetadataBackupAttempt;
  seal(attempt);
  store.cloudSync.pending_metadata_attempts = { [id]: attempt };
  return { store, attempt, remote };
}
function seal(attempt: PendingMetadataBackupAttempt) {
  attempt.payload_sha256 = hash(attempt.payload); attempt.sent_tree_sha256 = hash(attempt.sent_tree);
  attempt.base_remote_tree_sha256 = attempt.base_remote_tree ? hash(attempt.base_remote_tree) : undefined;
  attempt.id = `metadata-backup:${sha256(`${actor}\n${attempt.payload_sha256}\n${attempt.sent_tree_sha256}\n${attempt.base_remote_tree_sha256 ?? ''}`)}`;
}
function fence(store: AppDataStore): MetadataBackupRecoveryCommitFence {
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  return { actorUserId: actor, expectedLocalTreeRevision: tree.installation.tree_revision ?? 0,
    expectedTreeWatermark: tree.watermark, expectedTreeSnapshotSha256: hash(tree), assertCurrent() {} };
}
function apply(store: AppDataStore, attempt: PendingMetadataBackupAttempt, remote: RemoteInstallationTree) {
  applyMetadataBackupRecovery(store, attempt, remote, fence(store), 11);
}
function later(store: AppDataStore) { store.installations[0]!.tree_revision = 121; }

function newCommsScenario() {
  const result = scenario(); const { store, attempt } = result;
  store.meterDevices[0]!.channels = [1, 2, 3].map((ordinal) => ({ id: `meter:${ordinal}`, ordinal, purpose: 'SPARE' as const, capabilities: {} }));
  store.formSubmissions.push({ id: 'comms', installation_id: id, board_id: 'board', zone_id: 'zone', meter_id: 'meter',
    form_type: 'comms-fault', schema_version: 2, status: 'Draft', attachments: [], created_at: stamp, updated_at: stamp,
    answers: { 'works.replace_device': 'yes', 'works.new_device_type': 'A6M', 'works.new_device_id': 'QA-NEW',
      'prestart.safe_to_proceed': 'no', 'existing.device_type': 'A3RM', 'existing.device_id': 'QA-OLD' } });
  projectCanonicalCompatibility(store, id);
  attempt.sent_tree = clone(buildInstallationBackupTree(store, store.installations[0]!));
  attempt.payload = clone(buildBackupPayload(attempt.sent_tree, store.cloudSync.upload_queue, 'metadata'));
  attempt.base_remote_tree!.meterDevices = [];
  result.remote = canonical(attempt.payload, 11); seal(attempt);
  return result;
}

test('new original supported meter plus Comms Draft acknowledges exact metadata without requiring a WW form', () => {
  const { store, attempt, remote } = newCommsScenario();
  apply(store, attempt, remote);
  assert.equal(store.meterDevices[0]!.deviceModel, 'A3RM');
  assert.equal(store.meterDevices[0]!.serialNumber, 'QA-OLD');
  assert.equal(store.formSubmissions.find((form) => form.id === 'comms')!.status, 'Draft');
  assert.equal(store.installations[0]!.server_tree_revision, 11);
  assert.equal(store.installations[0]!.last_synced_local_tree_revision, 19);
});

test('new-meter optional blank identity captures stay optional; requested replacement never becomes expected metadata', () => {
  const { store, attempt, remote } = newCommsScenario();
  for (const form of [attempt.payload.formSubmissions as Row[], remote.formSubmissions]) {
    const answers = form.find((item) => item.id === 'comms')!.answers as Record<string, string>;
    delete answers['existing.device_type']; answers['existing.device_id'] = '  ';
  }
  seal(attempt); apply(store, attempt, remote);
  assert.equal(store.meterDevices[0]!.deviceModel, 'A3RM');
  const changed = newCommsScenario(); changed.remote.meterDevices![0]!.deviceModel = 'A6M';
  assert.throws(() => apply(changed.store, changed.attempt, changed.remote), /could not verify/);
});

test('new-meter exception rejects prior form history, retargeted Comms or contradictory original identity', () => {
  for (const mode of ['history', 'retarget', 'identity', 'board', 'model'] as const) {
    const { store, attempt, remote } = newCommsScenario();
    if (mode === 'history') attempt.base_remote_tree!.formSubmissions[0]!.meterId = 'meter';
    if (mode === 'retarget') attempt.base_remote_tree!.formSubmissions[0]!.id = 'comms';
    if (mode === 'identity') ((attempt.payload.formSubmissions as Row[]).find((form) => form.id === 'comms')!.answers as Row)['existing.device_id'] = 'WRONG';
    if (mode === 'board') (attempt.payload.formSubmissions as Row[]).find((form) => form.id === 'comms')!.boardId = 'wrong';
    if (mode === 'model') (attempt.payload.meterDevices as Row[])[0]!.deviceModel = 'OTHER';
    seal(attempt); const before = structuredClone(store);
    assert.throws(() => apply(store, attempt, remote), /could not verify/);
    assert.deepEqual(store, before);
  }
});

test('exact original tree acknowledges metadata while its installation screen remains retained', () => {
  const { store, attempt, remote } = scenario();
  const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: [{ params: { installationId: id } }] }));
  try {
    apply(store, attempt, remote);
    const installation = store.installations[0]!;
    assert.equal(installation.server_tree_revision, 11);
    assert.equal(installation.external_key, 'ih_qa_installation');
    assert.equal(store.electricalAssets[0]!.display_code, 'QA-MSB-001');
    assert.equal(store.meterDevices[0]!.displayName.provisional, false);
    assert.equal(installation.last_synced_local_tree_revision, 19);
    assert.equal(installation.last_synced_server_tree_revision, 10);
    assert.equal(store.cloudSync.synced_at_by_installation[id], stamp);
    assert.deepEqual(store.cloudSync.pending_metadata_attempts![id], attempt);
    assert.deepEqual(store.cloudSync.force_dirty_installation_ids, [id]);
  } finally { unregister(); }
});

test('later business edits, added/deleted children, answers, originals and queue survive metadata recovery', () => {
  const { store, attempt, remote } = scenario(); later(store);
  store.installations[0]!.job_comments = 'New captured notes'; store.installations[0]!.maas = true;
  store.installations[0]!.server_derived = { treeRevision: 10, virtualMeterDefinitions: [] };
  store.siteAssets = [];
  store.electricalAssets.push({ ...clone(store.electricalAssets[0]!), id: 'new-board', asset_name: 'New board',
    display_code: 'QA-DB-900', display_code_meta: code('QA-DB-900'), meters: [], meter_present: false });
  store.formSubmissions[0]!.answers['notes.text'] = 'New answer with  exact spacing';
  store.formSubmissions[0]!.attachments.push({ id: 'attachment', slot: 'photos.logger', uri: 'file:///Documents/form-media/form/new.jpg', mime_type: 'image/jpeg', caption: 'New caption', captured_at: stamp });
  store.formSubmissions.push({ ...clone(store.formSubmissions[0]!), id: 'new-form', attachments: [] });
  const forms = clone(store.formSubmissions); const queue = clone(store.cloudSync.upload_queue);
  const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: [] }));
  try { apply(store, attempt, remote); } finally { unregister(); }
  assert.equal(store.installations[0]!.tree_revision, 121);
  assert.equal(store.installations[0]!.job_comments, 'New captured notes'); assert.equal(store.installations[0]!.maas, true);
  assert.equal(store.installations[0]!.assigned_work_server_metadata_base?.job_comments, 'Original notes');
  assert.equal(store.installations[0]!.assigned_work_server_metadata_base?.maas, false);
  assert.equal(store.installations[0]!.server_derived, undefined);
  assert.equal(store.siteAssets.length, 0); assert.equal(store.electricalAssets[1]!.display_code, 'QA-DB-900');
  assert.deepEqual(store.formSubmissions, forms); assert.deepEqual(store.cloudSync.upload_queue, queue);
  assert.equal(store.meterDevices[0]!.wwPhotos?.deviceInstalled, queue[0]!.local_uri);
  assert.equal(store.electricalAssets[0]!.meters[0]!.ww_photos?.device_installed, queue[0]!.local_uri);
  assert.equal(store.installations[0]!.last_synced_server_tree_revision, 10);
});

test('later directory/address and display override choices remain local while baseline uses remote canonical metadata', () => {
  const { store, attempt, remote } = scenario(); later(store);
  store.installations[0]!.client_name = 'Later Client'; store.installations[0]!.site_address = 'Later Address';
  store.electricalAssets[0]!.display_code_meta = { ...code('CUSTOM'), isOverridden: true, overrideReason: 'Later override' };
  store.electricalAssets[0]!.display_code = 'CUSTOM';
  Object.assign(remote.installation, { clientName: 'Canonical Client', clientId: 'client-1', clientSiteId: 'site-1', siteAddress: 'Canonical Address' });
  const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: [] }));
  try { apply(store, attempt, remote); } finally { unregister(); }
  assert.equal(store.installations[0]!.client_name, 'Later Client'); assert.equal(store.installations[0]!.site_address, 'Later Address');
  assert.equal(store.installations[0]!.client_id, undefined);
  assert.equal(store.installations[0]!.assigned_work_server_metadata_base?.client_id, 'client-1');
  assert.equal(store.installations[0]!.assigned_work_server_metadata_base?.site_address, 'Canonical Address');
  assert.equal(store.electricalAssets[0]!.display_code, 'CUSTOM');
});

test('metadata may retain an exact previously completed form proven by its canonical preimage', () => {
  const { store, attempt, remote } = scenario();
  Object.assign(attempt.base_remote_tree!.formSubmissions[0]!, { status: 'Completed', completedAt: stamp });
  Object.assign(remote.formSubmissions[0]!, { status: 'Completed', completedAt: stamp }); seal(attempt);
  apply(store, attempt, remote);
  assert.equal(store.formSubmissions[0]!.status, 'Draft');
  assert.equal(store.installations[0]!.server_tree_revision, 11);
});

test('pending Comms metadata keeps the exact prior operational meter without reverting local replacement capture', () => {
  const { store, attempt, remote } = scenario();
  const form = attempt.payload.formSubmissions as Record<string, unknown>[];
  Object.assign(form[0]!, { formType: 'comms-fault', meterId: 'meter', answers: { 'works.replace_device': 'yes' } });
  Object.assign(remote.formSubmissions[0]!, clone(form[0]!));
  const sentMeter = (attempt.payload.meterDevices as Record<string, unknown>[])[0]!;
  sentMeter.serialNumber = 'QA-REPLACEMENT'; sentMeter.deviceModel = 'A6M';
  store.meterDevices[0]!.serialNumber = 'QA-REPLACEMENT'; store.meterDevices[0]!.deviceModel = 'A6M';
  attempt.sent_tree.meterDevices[0]!.serialNumber = 'QA-REPLACEMENT'; attempt.sent_tree.meterDevices[0]!.deviceModel = 'A6M';
  // Mirror the completed form's local operational side effect in its frozen tree.
  projectCanonicalCompatibility(store, id);
  attempt.sent_tree = clone(buildInstallationBackupTree(store, store.installations[0]!)); seal(attempt);
  apply(store, attempt, remote);
  assert.equal(store.meterDevices[0]!.serialNumber, 'QA-REPLACEMENT'); assert.equal(store.meterDevices[0]!.deviceModel, 'A6M');
  assert.equal(store.installations[0]!.server_tree_revision, 11);
});

for (const [name, mutate] of [
  ['business field', (s: ReturnType<typeof scenario>) => { s.remote.installation.jobComments = 'Unexplained server edit'; }],
  ['form answer', (s: ReturnType<typeof scenario>) => { s.remote.formSubmissions[0]!.answers = { 'notes.text': 'Different' }; }],
  ['extra entity', (s: ReturnType<typeof scenario>) => { s.remote.zones.push({ ...s.remote.zones[0]!, id: 'unknown-zone' }); }],
  ['foreign entity', (s: ReturnType<typeof scenario>) => { s.remote.electricalAssets[0]!.installationId = 'foreign'; }],
  ['duplicate channel', (s: ReturnType<typeof scenario>) => { const meter = s.remote.meterDevices![0]!; (meter.channels as unknown[]).push(clone((meter.channels as unknown[])[0])); }],
  ['meter serial', (s: ReturnType<typeof scenario>) => { s.remote.meterDevices![0]!.serialNumber = 'Wrong meter'; }],
  ['typed capability value', (s: ReturnType<typeof scenario>) => {
    const channel = (s.remote.meterDevices![0]!.channels as Record<string, unknown>[])[0]!;
    channel.capabilities = { description: 'Different typed capture' };
  }],
  ['unproved completed form', (s: ReturnType<typeof scenario>) => { s.remote.formSubmissions[0]!.status = 'Completed'; s.remote.formSubmissions[0]!.completedAt = stamp; }],
  ['new lifecycle', (s: ReturnType<typeof scenario>) => { s.remote.installation.status = 'Completed'; }],
  ['new assignment', (s: ReturnType<typeof scenario>) => { s.remote.installation.assignedInspectorUserId = 'other-actor'; }],
  ['wrong revision', (s: ReturnType<typeof scenario>) => { s.remote.treeRevision = 12; }],
  ['corrupt preimage', (s: ReturnType<typeof scenario>) => { s.attempt.base_remote_tree!.meterDevices![0]!.serialNumber = 'Corrupt'; }],
  ['corrupt wire payload', (s: ReturnType<typeof scenario>) => { (s.attempt.payload.installation as Record<string, unknown>).maas = true; }],
  ['missing receipt', (s: ReturnType<typeof scenario>) => { delete s.store.cloudSync.pending_metadata_attempts; }],
] as const) test(`rejects ${name} atomically despite a nominally matching metadata response`, () => {
  const s = scenario(); mutate(s); const before = JSON.stringify(s.store);
  assert.throws(() => apply(s.store, s.attempt, s.remote), /Metadata backup recovery/);
  assert.equal(JSON.stringify(s.store), before);
});

test('same-revision same-timestamp mutation after commit capture cannot be overwritten', () => {
  const { store, attempt, remote } = scenario(); const captured = fence(store);
  store.formSubmissions[0]!.answers['notes.text'] = 'Unversioned racing edit';
  const before = JSON.stringify(store);
  assert.throws(() => applyMetadataBackupRecovery(store, attempt, remote, captured, 11), /current local snapshot/);
  assert.equal(JSON.stringify(store), before);
});

for (const mode of ['retained editor', 'persisted draft', 'recovery lock', 'foreign actor', 'pending completion', 'inactive checkout', 'session change'] as const) {
  test(`defers ${mode} without touching preserved work`, () => {
    const { store, attempt, remote } = scenario(); later(store);
    const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: mode === 'retained editor' ? [{ params: { installationId: id } }] : [] }));
    const lock = mode === 'recovery lock' ? acquireInstallationRecovery(id) : null;
    if (mode === 'persisted draft') store.siteAssetEditorDrafts = [{ installationId: id } as never];
    if (mode === 'foreign actor') store.installations[0]!.local_owner_user_id = 'other';
    if (mode === 'pending completion') store.installations[0]!.pending_completion = {} as never;
    if (mode === 'inactive checkout') store.installations[0]!.assigned_work_state = 'inactive';
    const captured = fence(store); if (mode === 'session change') captured.assertCurrent = () => { throw new Error('Session changed'); };
    const before = JSON.stringify(store);
    try {
      assert.throws(() => applyMetadataBackupRecovery(store, attempt, remote, captured, 11));
      assert.equal(JSON.stringify(store), before);
    } finally { lock?.release(); unregister(); }
  });
}

test('late invalid generated code cannot partially publish identity or other code changes', () => {
  const { store, attempt, remote } = scenario(); const before = JSON.stringify(store);
  remote.meterDevices![0]!.displayName = { value: 'BAD' };
  assert.throws(() => apply(store, attempt, remote), /displayName/);
  assert.equal(JSON.stringify(store), before);
});

test('first create requires no invented prior revision and binds the newly created owner', () => {
  const { store, attempt, remote } = scenario();
  delete store.installations[0]!.server_tree_revision;
  delete attempt.sent_tree.installation.server_tree_revision;
  delete attempt.sent_tree.baseTreeRevision; delete attempt.payload.baseTreeRevision;
  delete attempt.base_tree_revision; delete attempt.base_remote_tree; delete attempt.base_remote_tree_sha256;
  seal(attempt);
  apply(store, attempt, remote);
  assert.equal(store.installations[0]!.server_tree_revision, 11);
  assert.equal(store.installations[0]!.local_owner_user_id, actor);
});

test('real prepare and accepted receipt bookkeeping permit first-create acknowledgement from the retained workspace', () => {
  const store = fixture(); delete store.installations[0]!.server_tree_revision;
  const sent = buildInstallationBackupTree(store, store.installations[0]!);
  const payload = buildBackupPayload(sent, store.cloudSync.upload_queue, 'metadata');
  const sentHash = hash(sent);
  const prepared = applyPreparedMetadataBackupAttempt(store, sent, payload, fence(store));
  applyAcceptedMetadataBackupAttempt(store, prepared, { installationId: id, treeRevision: 11, recordVersionNumber: 9 }, () => {});
  assert.equal(hash(buildInstallationBackupTree(store, store.installations[0]!)), sentHash,
    'Durable journal preparation/acknowledgement must not appear to be later local capture');
  const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: [{ params: { installationId: id } }] }));
  try { applyFinishedMetadataBackupAttempt(store, prepared, canonical(payload, 11), fence(store), 11); }
  finally { unregister(); }
  assert.equal(store.installations[0]!.server_tree_revision, 11);
  assert.equal(store.cloudSync.pending_metadata_attempts?.[id], undefined);
  assert.equal(store.cloudSync.synced_at_by_installation[id], stamp);
  assert.equal(store.installations[0]!.last_synced_server_tree_revision, 10);
  assert.ok(store.cloudSync.force_dirty_installation_ids.includes(id));
});

test('first-create Comms optional identity is captured exactly without existing-installation retention rules', () => {
  for (const alterServerMeter of [false, true]) {
    const { store, attempt } = newCommsScenario();
    const comms = store.formSubmissions.find((form) => form.id === 'comms')!;
    comms.answers['existing.device_id'] = 'Different observed optional identity';
    comms.answers['existing.device_type'] = 'A6M';
    delete store.installations[0]!.server_tree_revision;
    attempt.sent_tree = clone(buildInstallationBackupTree(store, store.installations[0]!));
    attempt.payload = clone(buildBackupPayload(attempt.sent_tree, store.cloudSync.upload_queue, 'metadata'));
    delete attempt.base_tree_revision; delete attempt.base_remote_tree; delete attempt.base_remote_tree_sha256;
    seal(attempt); const remote = canonical(attempt.payload, 11);
    if (alterServerMeter) {
      remote.meterDevices![0]!.serialNumber = 'Unexplained server identity';
      const before = JSON.stringify(store); assert.throws(() => apply(store, attempt, remote), /serialNumber/);
      assert.equal(JSON.stringify(store), before);
    } else {
      apply(store, attempt, remote);
      assert.equal(store.meterDevices[0]!.serialNumber, 'QA-OLD');
      assert.equal(store.formSubmissions.find((form) => form.id === 'comms')!.answers['existing.device_id'], 'Different observed optional identity');
    }
  }
});

test('first create rejects a foreign canonical owner even at the accepted revision', () => {
  const { store, attempt, remote } = scenario();
  delete store.installations[0]!.server_tree_revision; delete attempt.sent_tree.installation.server_tree_revision;
  delete attempt.sent_tree.baseTreeRevision; delete attempt.payload.baseTreeRevision;
  delete attempt.base_tree_revision; delete attempt.base_remote_tree; delete attempt.base_remote_tree_sha256; seal(attempt);
  remote.installation.createdByUserId = 'foreign'; const before = JSON.stringify(store);
  assert.throws(() => apply(store, attempt, remote), /new installation owner/);
  assert.equal(JSON.stringify(store), before);
});

test('omitted additive root capture retains its proven server value while explicit null remains a clear', () => {
  const { store, attempt, remote } = scenario();
  attempt.base_remote_tree!.installation.customJobNumber = 'SERVER-OPTIONAL';
  remote.installation.customJobNumber = 'SERVER-OPTIONAL'; seal(attempt);
  apply(store, attempt, remote);
  assert.equal(store.installations[0]!.assigned_work_server_metadata_base?.custom_job_number, 'SERVER-OPTIONAL');
  const next = scenario();
  next.attempt.base_remote_tree!.installation.customJobNumber = 'SERVER-OPTIONAL';
  (next.attempt.payload.installation as Record<string, unknown>).customJobNumber = null;
  next.remote.installation.customJobNumber = 'SERVER-OPTIONAL'; seal(next.attempt);
  assert.throws(() => apply(next.store, next.attempt, next.remote), /customJobNumber/);
});

test('retained immutable evidence accepts API photo identity aliases but preserves exact captions', () => {
  const { store, attempt, remote } = scenario();
  const photoId = 'fbb03bd1-453b-4cda-84bf-d3c2d31dca29';
  const attachment = { id: 'attachment', slot: 'photos.logger', uri: `https://qa.example.test/photos/${photoId}`, mimeType: 'image/jpeg', caption: 'exact  spacing', capturedAt: stamp };
  const saved = (attempt.payload.formSubmissions as Record<string, unknown>[])[0]!;
  saved.attachments = [attachment];
  Object.assign(attempt.base_remote_tree!.formSubmissions[0]!, { status: 'Completed', completedAt: stamp,
    attachments: [{ ...attachment, uri: `https://qa.example.test/media/${photoId.toUpperCase()}/original` }] });
  remote.formSubmissions[0] = clone(attempt.base_remote_tree!.formSubmissions[0]!); seal(attempt);
  apply(store, attempt, remote);
  const next = scenario();
  (next.attempt.payload.formSubmissions as Record<string, unknown>[])[0]!.attachments = [attachment];
  next.remote.formSubmissions[0]!.attachments = [{ ...attachment, caption: 'exact spacing' }]; seal(next.attempt);
  const before = JSON.stringify(next.store);
  assert.throws(() => apply(next.store, next.attempt, next.remote), /attachments/);
  assert.equal(JSON.stringify(next.store), before);
});

test('canonical evidence ordering does not change which meter originals were submitted', () => {
  const { store, attempt, remote } = scenario();
  const photos = { extra: ['https://qa.example.test/b.jpg', 'https://qa.example.test/a.jpg'] };
  (attempt.payload.meterDevices as Record<string, unknown>[])[0]!.wwPhotos = photos;
  remote.meterDevices![0]!.wwPhotos = { extra: [...photos.extra].reverse() }; seal(attempt);
  apply(store, attempt, remote);
  assert.equal(store.meterDevices[0]!.wwPhotos?.deviceInstalled, 'file:///Documents/installhub-media/qa.jpg');
});

test('pending Comms rejects meter identity that matches neither submitted nor exact preserved operational state', () => {
  const { store, attempt, remote } = scenario();
  const saved = (attempt.payload.formSubmissions as Record<string, unknown>[])[0]!;
  Object.assign(saved, { formType: 'comms-fault', meterId: 'meter', answers: { 'works.replace_device': 'yes' } });
  remote.formSubmissions[0] = clone(saved); remote.meterDevices![0]!.serialNumber = 'Unexplained third serial'; seal(attempt);
  const before = JSON.stringify(store);
  assert.throws(() => apply(store, attempt, remote), /serialNumber/); assert.equal(JSON.stringify(store), before);
});

test('a later opened editor is rechecked at the final synchronous publication boundary', () => {
  const { store, attempt, remote } = scenario(); later(store);
  let retained = false; let checks = 0;
  const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: retained ? [{ params: { installationId: id } }] : [] }));
  const captured = fence(store);
  captured.assertCurrent = () => { if (++checks === 3) retained = true; };
  const before = JSON.stringify(store);
  try {
    assert.throws(() => applyMetadataBackupRecovery(store, attempt, remote, captured, 11), /current editor state/);
    assert.equal(JSON.stringify(store), before);
  } finally { unregister(); }
});
