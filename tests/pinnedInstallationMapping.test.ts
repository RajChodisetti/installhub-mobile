import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { InstallationMappingResponse } from '../src/api/apiClient';
import type { InstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { assertPinnedInstallationMapping, assertPinnedMappingLocalTarget, pinnedMappingCanonicalJson } from '../src/services/pinnedInstallationMapping';

function mapping() {
  const payload = {
    schema: 'installation-mapping/v1', installation: { id: 'i', recordVersionNumber: 3 },
    physicalLocations: [], electricalNodes: [], supplyEdges: [], unresolvedRelationships: [], meters: [], channels: [], measurementAssignments: [], assetCoverage: [], virtualMeters: [],
    readiness: { installationId: 'i', recordVersionNumber: 3, treeRevision: 9, readyToComplete: true, eligibility: { mappingExport: true, draftDiagnosticReport: false, authoritativeReport: true, dataDomeDelivery: false }, issues: [] },
  };
  return { ...payload, contentHash: createHash('sha256').update(pinnedMappingCanonicalJson(payload)).digest('hex') } as InstallationMappingResponse;
}
const tree = () => ({ installation: { id: 'i', status: 'Completed', record_version_number: 3, server_tree_revision: 9 }, watermark: 'saved' }) as InstallationBackupTree;
const metadata = { forceDirty: false, syncedWatermark: 'saved' };

test('pinned mapping verifies exact server hash, version and installation without rewriting the artifact', () => {
  const result = mapping(); const original = JSON.stringify(result);
  assert.doesNotThrow(() => assertPinnedInstallationMapping(result, 'i', 3));
  assert.equal(JSON.stringify(result), original);
  assert.throws(() => assertPinnedInstallationMapping(result, 'other', 3), /requested/);
  assert.throws(() => assertPinnedInstallationMapping(result, 'i', 2), /requested/);
  result.meters.push({ id: 'unexpected' });
  assert.throws(() => assertPinnedInstallationMapping(result, 'i', 3), /hash/);
});

test('local advisory, ineligible, conflicting readiness pins and missing hashes never export', () => {
  for (const change of [
    (value: InstallationMappingResponse) => { value.authority = 'LOCAL_ADVISORY'; },
    (value: InstallationMappingResponse) => { value.readiness.eligibility.mappingExport = false; },
    (value: InstallationMappingResponse) => { value.readiness.recordVersionNumber = 2; },
    (value: InstallationMappingResponse) => { value.contentHash = ''; },
  ]) { const result = mapping(); change(result); assert.throws(() => assertPinnedInstallationMapping(result, 'i', 3)); }
});

test('server canonical sorting uses code-unit order for nested custom capability keys and preserves array order', () => {
  assert.equal(pinnedMappingCanonicalJson({ z: [2, 1], a: { lower: null, Upper: true, 'é': 3 } }), '{"a":{"Upper":true,"lower":null,"é":3},"z":[2,1]}');
});

test('only the unchanged completed backed-up local canonical target can request its pin', () => {
  assert.doesNotThrow(() => assertPinnedMappingLocalTarget(tree(), metadata, 3));
  for (const change of [
    { status: 'Draft' }, { record_version_number: 2 }, { server_tree_revision: undefined },
    { is_imported_copy: true }, { backup_conflict: { kind: 'CONFLICT' } }, { pending_completion: {} },
  ]) { const value = tree(); Object.assign(value.installation, change); assert.throws(() => assertPinnedMappingLocalTarget(value, metadata, 3)); }
  assert.throws(() => assertPinnedMappingLocalTarget(tree(), { ...metadata, forceDirty: true }, 3));
  assert.throws(() => assertPinnedMappingLocalTarget(tree(), { ...metadata, syncedWatermark: 'older' }, 3));
  assert.throws(() => assertPinnedMappingLocalTarget(tree(), metadata, 0));
});
