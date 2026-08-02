import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from 'js-sha256';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import {
  assertRemoteInstallationIdentity,
  remoteAttachmentCopyId,
  validateCanonicalRemoteTreeIds,
} from '../src/services/remoteInstallationValidation';

function canonicalTree(): RemoteInstallationTree {
  return {
    treeSchemaVersion: 2,
    treeRevision: 7,
    recordVersionNumber: 0,
    installation: {
      id: 'installation-1', externalKey: 'server:installation-1', siteCode: 'SITE',
      timezone: 'Australia/Sydney', clientName: 'Client', siteName: 'Site',
      siteAddress: '1 Test Street', inspectorName: 'Inspector', auditDate: '2026-08-01',
      treeSchemaVersion: 2, treeRevision: 7, recordVersionNumber: 0, status: 'Draft',
    },
    gridSupplies: [{
      id: 'grid-1', installationId: 'installation-1', name: 'Grid', isDefault: true,
    }],
    zones: [{
      id: 'zone-1', installationId: 'installation-1', zoneName: 'Plant',
      zoneDescription: '', photos: [],
    }],
    electricalAssets: [{
      id: 'board-1', installationId: 'installation-1', zoneId: 'zone-1',
      assetName: 'Main board', typeCode: 'MSB',
      displayCode: {
        value: 'SITE-MSB-001', generatedValue: 'SITE-MSB-001',
        isOverridden: false, ruleVersion: 1,
      },
      electricalSource: { kind: 'GRID', gridSupplyId: 'grid-1' },
      extraPhotos: [], meterPresent: true,
    }],
    siteAssets: [{
      id: 'asset-1', installationId: 'installation-1', zoneId: 'zone-1',
      assetName: 'HVAC', typeCode: 'HVAC',
      displayCode: {
        value: 'SITE-HVAC-001', generatedValue: 'SITE-HVAC-001',
        isOverridden: false, ruleVersion: 1,
      },
      electricalSource: { kind: 'GRID', gridSupplyId: 'grid-1' },
      meteringState: { kind: 'METERED', measurementAssignmentIds: ['assignment-1'] },
      extraPhotos: [], meterPresent: true,
    }],
    meterDevices: [{
      id: 'meter-1', installationId: 'installation-1', installedOnBoardId: 'board-1',
      deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM',
      serialNumber: 'SERIAL-1',
      displayName: {
        value: 'SITE-METER-001', generatedValue: 'SITE-METER-001',
        isOverridden: false, ruleVersion: 1,
      },
      channels: [
        { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT' },
        { id: 'channel-2', ordinal: 2, purpose: 'SPARE' },
        { id: 'channel-3', ordinal: 3, purpose: 'SPARE' },
      ],
    }],
    measurementAssignments: [{
      id: 'assignment-1', installationId: 'installation-1',
      meterId: 'meter-1', channelIds: ['channel-1'],
      target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
      phaseMode: 'SINGLE_PHASE', direction: 'CONSUMPTION', status: 'CONFIRMED',
    }],
    formSubmissions: [{
      id: 'form-1', installationId: 'installation-1', formType: 'a3rm-installation',
      schemaVersion: 2, zoneId: 'zone-1', boardId: 'board-1', meterId: 'meter-1',
      siteAssetId: 'asset-1', status: 'Draft', answers: {}, attachments: [{
        id: 'attachment-1', slot: 'evidence',
        uri: 'https://api.example.test/v1/files/attachment-1.jpg',
        mimeType: 'image/jpeg', capturedAt: '2026-08-01T00:00:00.000Z',
      }],
      historicalMeterRemoved: false,
    }],
    serverDerived: { virtualMeterDefinitions: [] },
  };
}

test('canonical v2 import validation accepts a fully referenced direct-Grid tree', () => {
  assert.doesNotThrow(() => validateCanonicalRemoteTreeIds(canonicalTree()));
  assert.doesNotThrow(() => assertRemoteInstallationIdentity(canonicalTree(), 'installation-1'));
  assert.throws(
    () => assertRemoteInstallationIdentity(canonicalTree(), 'installation-2'),
    /different installation identity/,
  );
});

test('canonical v2 import preserves a non-empty authoritative historical site code', () => {
  const historical = canonicalTree();
  historical.installation.siteCode = 'Legacy Site Code / 2024';
  assert.doesNotThrow(() => validateCanonicalRemoteTreeIds(historical));

  historical.installation.siteCode = '   ';
  assert.throws(
    () => validateCanonicalRemoteTreeIds(historical),
    /installation site code is missing or invalid/,
  );
});

test('canonical v2 import accepts server compatibility display strings only with exact metadata', () => {
  const compatibilityTree = canonicalTree();
  for (const entity of [
    compatibilityTree.electricalAssets[0]!,
    compatibilityTree.siteAssets[0]!,
  ]) {
    entity.displayCodeMeta = entity.displayCode;
    entity.displayCode = (entity.displayCodeMeta as { value: string }).value;
  }
  assert.doesNotThrow(() => validateCanonicalRemoteTreeIds(compatibilityTree));

  delete compatibilityTree.electricalAssets[0]!.displayCodeMeta;
  assert.throws(
    () => validateCanonicalRemoteTreeIds(compatibilityTree),
    /board board-1 display code is missing/,
  );
});

test('canonical v2 import validation rejects empty and duplicate stable IDs', () => {
  const empty = canonicalTree();
  const emptyChannels = empty.meterDevices![0]!.channels as Array<Record<string, unknown>>;
  emptyChannels[0]!.id = '';
  assert.throws(() => validateCanonicalRemoteTreeIds(empty), /has no stable ID/);

  const duplicate = canonicalTree();
  duplicate.siteAssets.push({ ...duplicate.siteAssets[0]! });
  assert.throws(() => validateCanonicalRemoteTreeIds(duplicate), /duplicate site asset ID/);
});

test('canonical v2 import validation rejects incomplete identity, versions, and default Grid metadata', () => {
  const mismatchedSchema = canonicalTree();
  delete mismatchedSchema.treeSchemaVersion;
  assert.throws(() => validateCanonicalRemoteTreeIds(mismatchedSchema), /schema versions must both be 2/);

  const coercedSchema = canonicalTree();
  (coercedSchema as unknown as Record<string, unknown>).treeSchemaVersion = '2';
  assert.throws(() => validateCanonicalRemoteTreeIds(coercedSchema), /must be numeric 2/);

  const bothCoerced = canonicalTree();
  (bothCoerced as unknown as Record<string, unknown>).treeSchemaVersion = '2';
  bothCoerced.installation.treeSchemaVersion = '2';
  assert.throws(() => validateCanonicalRemoteTreeIds(bothCoerced), /must be numeric 2/);

  const futureSchema = canonicalTree();
  futureSchema.treeSchemaVersion = 3;
  futureSchema.installation.treeSchemaVersion = 3;
  assert.throws(() => validateCanonicalRemoteTreeIds(futureSchema), /schema version 3 is unsupported/);

  const coercedLegacySchema = canonicalTree();
  (coercedLegacySchema as unknown as Record<string, unknown>).treeSchemaVersion = '1';
  coercedLegacySchema.installation.treeSchemaVersion = '1';
  assert.throws(() => validateCanonicalRemoteTreeIds(coercedLegacySchema), /numeric integers/);

  const mismatchedDeclaredSchema = canonicalTree();
  mismatchedDeclaredSchema.treeSchemaVersion = 1;
  mismatchedDeclaredSchema.installation.treeSchemaVersion = 2;
  assert.throws(() => validateCanonicalRemoteTreeIds(mismatchedDeclaredSchema), /do not match/);

  const explicitLegacySchema = canonicalTree();
  explicitLegacySchema.treeSchemaVersion = 1;
  explicitLegacySchema.installation.treeSchemaVersion = 1;
  assert.doesNotThrow(() => validateCanonicalRemoteTreeIds(explicitLegacySchema));

  const missingIdentity = canonicalTree();
  delete missingIdentity.installation.externalKey;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingIdentity), /external key/);

  const missingVersion = canonicalTree();
  delete missingVersion.installation.recordVersionNumber;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingVersion), /record version number/);

  const noDefault = canonicalTree();
  noDefault.gridSupplies![0]!.isDefault = false;
  assert.throws(() => validateCanonicalRemoteTreeIds(noDefault), /exactly one default Grid supply/);

  const twoDefaults = canonicalTree();
  twoDefaults.gridSupplies!.push({
    id: 'grid-2', installationId: 'installation-1', name: 'Second', isDefault: true,
  });
  assert.throws(() => validateCanonicalRemoteTreeIds(twoDefaults), /exactly one default Grid supply/);
});

test('canonical v2 import validation never coerces stable IDs', () => {
  const numericInstallationId = canonicalTree();
  numericInstallationId.installation.id = 123;
  assert.throws(() => validateCanonicalRemoteTreeIds(numericInstallationId), /installation ID/);
  assert.throws(
    () => assertRemoteInstallationIdentity(numericInstallationId, '123'),
    /non-empty string ID/,
  );

  const numericEntityId = canonicalTree();
  numericEntityId.zones[0]!.id = 123;
  assert.throws(() => validateCanonicalRemoteTreeIds(numericEntityId), /non-empty string/);

  const numericOptionalRef = canonicalTree();
  numericOptionalRef.formSubmissions[0]!.zoneId = 123;
  assert.throws(() => validateCanonicalRemoteTreeIds(numericOptionalRef), /non-empty string ID/);

  const numericRequiredRef = canonicalTree();
  numericRequiredRef.meterDevices![0]!.installedOnBoardId = 123;
  assert.throws(() => validateCanonicalRemoteTreeIds(numericRequiredRef), /installed board ID/);

  const numericTargetRef = canonicalTree();
  numericTargetRef.measurementAssignments![0]!.target = {
    kind: 'SITE_ASSET', siteAssetId: 123,
  };
  assert.throws(() => validateCanonicalRemoteTreeIds(numericTargetRef), /target asset ID/);

  const numericAttachmentId = canonicalTree();
  (numericAttachmentId.formSubmissions[0]!.attachments as Record<string, unknown>[])[0]!.id = 123;
  assert.throws(() => validateCanonicalRemoteTreeIds(numericAttachmentId), /attachment.*stable ID/);

  const coercedOrdinal = canonicalTree();
  (coercedOrdinal.meterDevices![0]!.channels as Record<string, unknown>[])[0]!.ordinal = '1';
  assert.throws(() => validateCanonicalRemoteTreeIds(coercedOrdinal), /invalid or duplicate ordinal/);
});

function treeWithVirtualMeter(): RemoteInstallationTree {
  const tree = canonicalTree();
  const channels = tree.meterDevices![0]!.channels as Record<string, unknown>[];
  channels[1]!.purpose = 'MAIN_SUPPLY';
  tree.measurementAssignments!.push({
    id: 'assignment-total', installationId: 'installation-1', meterId: 'meter-1',
    channelIds: ['channel-2'], phaseMode: 'SINGLE_PHASE', direction: 'CONSUMPTION',
    status: 'CONFIRMED', target: { kind: 'GRID_BOUNDARY', gridSupplyId: 'grid-1' },
  });
  const subtract = ['assignment-1'];
  tree.serverDerived = { virtualMeterDefinitions: [{
    id: `virtual_${sha256(['grid-1', 'assignment-total', ...subtract].join('\u0000')).slice(0, 24)}`,
    parentNodeId: 'grid-1', totalMeasurementAssignmentId: 'assignment-total',
    subtractAssignmentIds: subtract, formulaVersion: 1,
    allocation: 'UNALLOCATED_RESIDUAL',
  }] };
  return tree;
}

test('canonical v2 import fully validates server-derived virtual meter definitions', () => {
  assert.doesNotThrow(() => validateCanonicalRemoteTreeIds(treeWithVirtualMeter()));
  const probes: Array<[string, (definition: Record<string, unknown>) => void, RegExp]> = [
    ['numeric ID', (value) => { value.id = 7; }, /non-empty string/],
    ['numeric parent ID', (value) => { value.parentNodeId = 7; }, /parent node ID/],
    ['numeric total ID', (value) => { value.totalMeasurementAssignmentId = 7; }, /total assignment ID/],
    ['missing parent', (value) => { value.parentNodeId = 'missing'; }, /missing parent node/],
    ['missing total', (value) => { value.totalMeasurementAssignmentId = 'missing'; }, /invalid total assignment/],
    ['non-array subtract list', (value) => { value.subtractAssignmentIds = 'assignment-1'; }, /collection is missing/],
    ['numeric subtract ID', (value) => { value.subtractAssignmentIds = [7]; }, /only non-empty strings/],
    ['missing subtract', (value) => { value.subtractAssignmentIds = ['missing']; }, /invalid subtract assignment/],
    ['duplicate subtract', (value) => { value.subtractAssignmentIds = ['assignment-1', 'assignment-1']; }, /duplicate or self-subtract/],
    ['self subtract', (value) => { value.subtractAssignmentIds = ['assignment-total']; }, /duplicate or self-subtract/],
    ['coerced formula', (value) => { value.formulaVersion = '1'; }, /formula version/],
    ['unknown allocation', (value) => { value.allocation = 'OTHER'; }, /allocation/],
    ['wrong deterministic ID', (value) => { value.id = 'virtual_wrong'; }, /non-canonical ID/],
  ];
  for (const [label, mutate, expected] of probes) {
    const tree = treeWithVirtualMeter();
    const definition = tree.serverDerived!.virtualMeterDefinitions[0] as unknown as Record<string, unknown>;
    mutate(definition);
    assert.throws(() => validateCanonicalRemoteTreeIds(tree), expected, label);
  }

  const duplicateDefinition = treeWithVirtualMeter();
  duplicateDefinition.serverDerived!.virtualMeterDefinitions.push(
    structuredClone(duplicateDefinition.serverDerived!.virtualMeterDefinitions[0]!),
  );
  assert.throws(() => validateCanonicalRemoteTreeIds(duplicateDefinition), /duplicate virtual meter definition ID/);

  const duplicateParent = treeWithVirtualMeter();
  duplicateParent.serverDerived!.virtualMeterDefinitions.push({
    ...structuredClone(duplicateParent.serverDerived!.virtualMeterDefinitions[0]!),
    id: 'virtual_unique-but-noncanonical',
  });
  assert.throws(() => validateCanonicalRemoteTreeIds(duplicateParent), /duplicate virtual meters/);

  const nonObjectDefinition = treeWithVirtualMeter();
  (nonObjectDefinition.serverDerived!.virtualMeterDefinitions as unknown[])[0] = null;
  assert.throws(() => validateCanonicalRemoteTreeIds(nonObjectDefinition), /must be an object/);

  const wrongChild = treeWithVirtualMeter();
  wrongChild.siteAssets[0]!.electricalSource = { kind: 'BOARD', boardId: 'board-1' };
  assert.throws(() => validateCanonicalRemoteTreeIds(wrongChild), /invalid subtract assignment/);

  const wrongTotalPurpose = treeWithVirtualMeter();
  (wrongTotalPurpose.meterDevices![0]!.channels as Record<string, unknown>[])[1]!.purpose = 'SPARE';
  assert.throws(() => validateCanonicalRemoteTreeIds(wrongTotalPurpose), /must use MAIN_SUPPLY/);

  const unconfirmedTotal = treeWithVirtualMeter();
  const total = unconfirmedTotal.measurementAssignments![1]!;
  total.status = 'TBC';
  total.target = { kind: 'TBC' };
  assert.throws(() => validateCanonicalRemoteTreeIds(unconfirmedTotal), /invalid total assignment/);

  const omittedMeasuredChild = treeWithVirtualMeter();
  const omittedRow = omittedMeasuredChild.serverDerived!
    .virtualMeterDefinitions[0] as unknown as Record<string, unknown>;
  omittedRow.subtractAssignmentIds = [];
  omittedRow.id = `virtual_${sha256(
    ['grid-1', 'assignment-total'].join('\u0000'),
  ).slice(0, 24)}`;
  assert.throws(
    () => validateCanonicalRemoteTreeIds(omittedMeasuredChild),
    /does not exactly match the canonical measured-child topology/,
  );

  const missingDefinitionTree = treeWithVirtualMeter();
  missingDefinitionTree.serverDerived!.virtualMeterDefinitions = [];
  assert.throws(
    () => validateCanonicalRemoteTreeIds(missingDefinitionTree),
    /definitions do not exactly match the canonical topology/,
  );
});

test('canonical v2 form lineage and historical-meter markers fail closed', () => {
  const missingMarker = canonicalTree();
  delete missingMarker.formSubmissions[0]!.historicalMeterRemoved;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingMarker), /historical-meter marker/);

  const wrongMarkerType = canonicalTree();
  wrongMarkerType.formSubmissions[0]!.historicalMeterRemoved = 'false';
  assert.throws(() => validateCanonicalRemoteTreeIds(wrongMarkerType), /must be boolean/);

  const invalidMarker = canonicalTree();
  invalidMarker.formSubmissions[0]!.historicalMeterRemoved = true;
  assert.throws(() => validateCanonicalRemoteTreeIds(invalidMarker), /invalid historical-meter semantics/);

  const self = canonicalTree();
  self.formSubmissions[0]!.supersedesId = 'form-1';
  assert.throws(() => validateCanonicalRemoteTreeIds(self), /cannot supersede itself/);

  const cycle = canonicalTree();
  cycle.formSubmissions.push({
    ...structuredClone(cycle.formSubmissions[0]!), id: 'form-2', supersedesId: 'form-1',
    attachments: [],
  });
  cycle.formSubmissions[0]!.supersedesId = 'form-2';
  assert.throws(() => validateCanonicalRemoteTreeIds(cycle), /supersession contains a cycle/);
});

test('canonical v2 import validation rejects missing type and display metadata', () => {
  const missingType = canonicalTree();
  delete missingType.electricalAssets[0]!.typeCode;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingType), /board board-1 type code/);

  const missingDisplay = canonicalTree();
  delete missingDisplay.siteAssets[0]!.displayCode;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingDisplay), /display code is missing/);

  const incompleteDisplay = canonicalTree();
  delete (incompleteDisplay.meterDevices![0]!.displayName as Record<string, unknown>).generatedValue;
  assert.throws(() => validateCanonicalRemoteTreeIds(incompleteDisplay), /generated value/);
});

test('canonical v2 import validation rejects incomplete form answers and attachment metadata', () => {
  const missingSchema = canonicalTree();
  delete missingSchema.formSubmissions[0]!.schemaVersion;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingSchema), /schema version/);

  const missingAnswers = canonicalTree();
  delete missingAnswers.formSubmissions[0]!.answers;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingAnswers), /answers is missing/);

  const missingMime = canonicalTree();
  delete (missingMime.formSubmissions[0]!.attachments as Record<string, unknown>[])[0]!.mimeType;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingMime), /MIME type/);

  const missingTimestamp = canonicalTree();
  delete (missingTimestamp.formSubmissions[0]!.attachments as Record<string, unknown>[])[0]!.capturedAt;
  assert.throws(() => validateCanonicalRemoteTreeIds(missingTimestamp), /capture timestamp/);
});

test('canonical v2 import validation rejects dangling sources and assignments', () => {
  const source = canonicalTree();
  source.siteAssets[0]!.electricalSource = { kind: 'BOARD', boardId: 'missing' };
  assert.throws(() => validateCanonicalRemoteTreeIds(source), /missing source board/);

  const assignment = canonicalTree();
  assignment.measurementAssignments![0]!.channelIds = ['missing'];
  assert.throws(() => validateCanonicalRemoteTreeIds(assignment), /missing meter channel/);

  const selfSourcedBoard = canonicalTree();
  selfSourcedBoard.electricalAssets[0]!.electricalSource = {
    kind: 'BOARD', boardId: 'board-1',
  };
  assert.throws(() => validateCanonicalRemoteTreeIds(selfSourcedBoard), /cannot source itself/);

  const cyclicBoards = canonicalTree();
  cyclicBoards.electricalAssets.push({
    ...structuredClone(cyclicBoards.electricalAssets[0]!),
    id: 'board-2',
    assetName: 'Second board',
    displayCode: {
      value: 'SITE-DB-002', generatedValue: 'SITE-DB-002',
      isOverridden: false, ruleVersion: 1,
    },
    electricalSource: { kind: 'BOARD', boardId: 'board-1' },
  });
  cyclicBoards.electricalAssets[0]!.electricalSource = {
    kind: 'BOARD', boardId: 'board-2',
  };
  assert.throws(() => validateCanonicalRemoteTreeIds(cyclicBoards), /sources contain a cycle/);
});

test('canonical v2 import validation rejects missing or invalid assignment semantics', () => {
  const missingDirection = canonicalTree();
  delete missingDirection.measurementAssignments![0]!.direction;
  assert.throws(
    () => validateCanonicalRemoteTreeIds(missingDirection),
    /assignment assignment-1 direction/,
  );

  const invalidDirection = canonicalTree();
  invalidDirection.measurementAssignments![0]!.direction = 'IMPORT';
  assert.throws(
    () => validateCanonicalRemoteTreeIds(invalidDirection),
    /assignment assignment-1 direction/,
  );

  const missingPhase = canonicalTree();
  delete missingPhase.measurementAssignments![0]!.phaseMode;
  assert.throws(
    () => validateCanonicalRemoteTreeIds(missingPhase),
    /assignment assignment-1 phase mode/,
  );

  const invalidPhase = canonicalTree();
  invalidPhase.measurementAssignments![0]!.phaseMode = 'TWO_PHASE';
  assert.throws(
    () => validateCanonicalRemoteTreeIds(invalidPhase),
    /assignment assignment-1 phase mode/,
  );

  const invalidStatus = canonicalTree();
  invalidStatus.measurementAssignments![0]!.status = 'ACTIVE';
  assert.throws(
    () => validateCanonicalRemoteTreeIds(invalidStatus),
    /assignment assignment-1 status/,
  );
});

test('canonical v2 import validation rejects missing or unknown source and target kinds', () => {
  const missingSource = canonicalTree();
  delete missingSource.electricalAssets[0]!.electricalSource;
  assert.throws(
    () => validateCanonicalRemoteTreeIds(missingSource),
    /board board-1 electrical source is missing/,
  );

  const unknownSource = canonicalTree();
  unknownSource.siteAssets[0]!.electricalSource = { kind: 'UTILITY', gridSupplyId: 'grid-1' };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(unknownSource),
    /site asset asset-1 electrical source kind/,
  );

  const missingTarget = canonicalTree();
  delete missingTarget.measurementAssignments![0]!.target;
  assert.throws(
    () => validateCanonicalRemoteTreeIds(missingTarget),
    /assignment assignment-1 target is missing/,
  );

  const unknownTarget = canonicalTree();
  unknownTarget.measurementAssignments![0]!.target = { kind: 'DEVICE', deviceId: 'meter-1' };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(unknownTarget),
    /assignment assignment-1 target kind/,
  );
});

test('canonical v2 tagged unions reject mutually exclusive compatibility fields', () => {
  const contradictoryBoardSource = canonicalTree();
  contradictoryBoardSource.electricalAssets[0]!.electricalSource = {
    kind: 'GRID', gridSupplyId: 'grid-1', boardId: 'board-1',
  };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(contradictoryBoardSource),
    /GRID source cannot include a board ID/,
  );

  const contradictoryTbcSource = canonicalTree();
  contradictoryTbcSource.siteAssets[0]!.electricalSource = {
    kind: 'TBC', gridSupplyId: 'grid-1',
  };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(contradictoryTbcSource),
    /TBC source cannot include a board or Grid ID/,
  );

  const contradictoryTarget = canonicalTree();
  contradictoryTarget.measurementAssignments![0]!.target = {
    kind: 'SITE_ASSET', siteAssetId: 'asset-1', boardId: 'board-1',
  };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(contradictoryTarget),
    /SITE_ASSET target cannot include a board or Grid ID/,
  );

  const contradictoryTbcTarget = canonicalTree();
  contradictoryTbcTarget.measurementAssignments![0]!.status = 'TBC';
  contradictoryTbcTarget.measurementAssignments![0]!.target = {
    kind: 'TBC', siteAssetId: 'asset-1',
  };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(contradictoryTbcTarget),
    /TBC target cannot include a target ID/,
  );

  const malformedUnmetered = canonicalTree();
  malformedUnmetered.siteAssets[0]!.meteringState = {
    kind: 'UNMETERED', measurementAssignmentIds: 'assignment-1',
  };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(malformedUnmetered),
    /UNMETERED site asset asset-1 cannot list measurement assignments/,
  );
});

test('canonical v2 import validation rejects empty and duplicate channel sets', () => {
  const emptyMeterChannels = canonicalTree();
  emptyMeterChannels.meterDevices![0]!.channels = [];
  assert.throws(
    () => validateCanonicalRemoteTreeIds(emptyMeterChannels),
    /meter meter-1 has no channels/,
  );

  const duplicateMeterChannel = canonicalTree();
  const channels = duplicateMeterChannel.meterDevices![0]!.channels as Record<string, unknown>[];
  channels[1]!.id = 'channel-1';
  assert.throws(
    () => validateCanonicalRemoteTreeIds(duplicateMeterChannel),
    /duplicate channel on meter meter-1 ID/,
  );

  const emptyAssignmentChannels = canonicalTree();
  emptyAssignmentChannels.measurementAssignments![0]!.channelIds = [];
  assert.throws(
    () => validateCanonicalRemoteTreeIds(emptyAssignmentChannels),
    /assignment assignment-1 channels must contain/,
  );

  const duplicateAssignmentChannels = canonicalTree();
  duplicateAssignmentChannels.measurementAssignments![0]!.channelIds = ['channel-1', 'channel-1'];
  assert.throws(
    () => validateCanonicalRemoteTreeIds(duplicateAssignmentChannels),
    /duplicate channel or assignment IDs/,
  );
});

test('canonical v2 asset metering state exactly matches assignment targets', () => {
  const wrongTarget = canonicalTree();
  wrongTarget.measurementAssignments![0]!.target = { kind: 'BOARD', boardId: 'board-1' };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(wrongTarget),
    /does not exactly match assignment targets/,
  );

  const falseUnmetered = canonicalTree();
  falseUnmetered.siteAssets[0]!.meteringState = { kind: 'UNMETERED' };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(falseUnmetered),
    /does not exactly match assignment targets/,
  );

  const duplicateListedAssignment = canonicalTree();
  duplicateListedAssignment.siteAssets[0]!.meteringState = {
    kind: 'METERED',
    measurementAssignmentIds: ['assignment-1', 'assignment-1'],
  };
  assert.throws(
    () => validateCanonicalRemoteTreeIds(duplicateListedAssignment),
    /duplicate channel or assignment IDs/,
  );
});

test('only immutable completed history may retain a soft-deleted meter context', () => {
  const historical = canonicalTree();
  historical.meterDevices = [];
  historical.measurementAssignments = [];
  historical.siteAssets[0]!.meteringState = { kind: 'TBC' };
  historical.formSubmissions[0]!.status = 'Completed';
  historical.formSubmissions[0]!.completedAt = '2026-08-01T01:00:00.000Z';
  historical.formSubmissions[0]!.formType = 'ww-installation';
  historical.formSubmissions[0]!.historicalMeterRemoved = true;
  assert.doesNotThrow(() => validateCanonicalRemoteTreeIds(historical));

  const draft = structuredClone(historical);
  draft.formSubmissions[0]!.status = 'Draft';
  draft.formSubmissions[0]!.completedAt = null;
  assert.throws(() => validateCanonicalRemoteTreeIds(draft), /invalid historical-meter semantics/);

  const invalidCompletion = structuredClone(historical);
  invalidCompletion.formSubmissions[0]!.completedAt = 'not-a-timestamp';
  assert.throws(
    () => validateCanonicalRemoteTreeIds(invalidCompletion),
    /valid completion timestamp/,
  );
});

test('copied attachment identity is deterministic and index-stable', () => {
  const first = remoteAttachmentCopyId('local', 'form', 'remote-attachment', 0);
  assert.equal(first, remoteAttachmentCopyId('local', 'form', 'remote-attachment', 0));
  assert.notEqual(first, remoteAttachmentCopyId('local', 'form', 'remote-attachment', 1));
  assert.match(first, /^attachment_[0-9a-f]{24}$/);
});
