import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as mappingPolicy from '../src/services/pinnedInstallationMapping';

const code = ts.transpileModule(readFileSync(new URL('../src/services/installationMappingFiles.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness(scenario = 'success') {
  let actorCurrent = true; let screenCurrent = true; let changed = false;
  const events: string[] = []; const authority = {};
  const payload = { schema: 'installation-mapping/v1', installation: { id: 'i', recordVersionNumber: 3 }, readiness: { installationId: 'i', recordVersionNumber: 3, eligibility: { mappingExport: true } }, meters: [] };
  const mapping = { ...payload, contentHash: createHash('sha256').update(mappingPolicy.pinnedMappingCanonicalJson(payload)).digest('hex') };
  const lease = { cloudAuthority: authority, processAuthority: {}, assertCurrent() { if (!actorCurrent) throw Error('Account changed'); } };
  class Directory { create() { events.push('directory'); } }
  class File {
    exists = false; uri = 'file://mapping.json';
    write(value: string) { assert.deepEqual(JSON.parse(value), mapping); events.push('write'); this.exists = true; }
    delete() { events.push('delete'); this.exists = false; }
  }
  const modules: Record<string, unknown> = {
    'expo-file-system': { Directory, File, Paths: { cache: 'cache' } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async () => { events.push('share'); if (scenario === 'share-failure') throw Error('Share failed'); } },
    '../api/apiClient': { apiClient: { getInstallationMapping: async (id: string, version: number, suppliedAuthority: unknown) => {
      events.push('fetch'); assert.equal(id, 'i'); assert.equal(version, 3); assert.equal(suppliedAuthority, authority);
      if (scenario === 'api-failure') throw Error('Offline');
      if (scenario === 'changed') changed = true;
      if (scenario === 'account') actorCurrent = false;
      if (scenario === 'screen') screenCurrent = false;
      if (scenario === 'hash') mapping.contentHash = '0'.repeat(64);
      return mapping;
    } } },
    '../repositories/cloudSyncRepository': {
      getInstallationBackupTree: async () => ({ installation: { id: 'i', site_code: 'QA', status: 'Completed', record_version_number: 3, server_tree_revision: 9, localDetail: changed ? 'changed' : 'baseline' }, watermark: 'saved' }),
      getInstallationSyncMetadata: async () => ({ forceDirty: scenario === 'dirty', syncedWatermark: 'saved' }),
    },
    './authenticatedCloudAction': { captureAuthenticatedCloudActionLease: async () => lease },
    './cloudActionLease': { runLeasedCloudActionStep: async (current: typeof lease, action: () => unknown) => { current.assertCurrent(); const result = await action(); current.assertCurrent(); return result; } },
    './assignedWorkMutationGuard': { assertAssignedWorkMutationAllowed: () => {} },
    './pinnedInstallationMapping': mappingPolicy,
  };
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(modules[name], name); return modules[name]; }, exports);
  return { events, run: () => (exports.sharePinnedInstallationMapping as (id: string, version: number, guard: () => void) => Promise<void>)('i', 3, () => { if (!screenCurrent) throw Error('Screen changed'); }) };
}

test('download writes and shares the exact validated response, then removes its temporary file', async () => {
  const h = harness(); await h.run(); assert.deepEqual(h.events, ['fetch', 'directory', 'write', 'share', 'delete']);
});

test('API/hash, account, screen and local-revision changes prevent file creation and sharing', async () => {
  for (const scenario of ['api-failure', 'hash', 'account', 'screen', 'changed', 'dirty']) {
    const h = harness(scenario); await assert.rejects(h.run());
    assert.equal(h.events.includes('write'), false, scenario); assert.equal(h.events.includes('share'), false, scenario);
  }
});

test('native share rejection still cleans the verified temporary artifact', async () => {
  const h = harness('share-failure'); await assert.rejects(h.run(), /Share failed/); assert.equal(h.events.at(-1), 'delete');
});
