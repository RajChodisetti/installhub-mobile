import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHistoricalInstallationPackServerTarget } from '../src/services/installationPackHistory';
import { installationReportJobMatchesSelection } from '../src/services/reportVersioning';
import type { InstallationPackServerTarget } from '../src/services/installationPackTarget';

const target: InstallationPackServerTarget = {
  installationId: 'server-installation', formSubmissionIds: ['historical-a', 'current-b'],
  usesOriginalImportedRecord: true, reason: 'original-import-provenance', recordVersionNumber: 4,
};
function version(number: number, ids = target.formSubmissionIds) {
  return {
    entityId: target.installationId, versionNumber: number, payloadHash: `hash-${number}`,
    snapshot: {
      snapshotSchema: 'InstallationCanonicalSnapshotV2', payloadHash: `hash-${number}`,
      readiness: { eligibility: { authoritativeReport: true } },
      installationTree: {
        installation: { id: target.installationId, recordVersionNumber: number },
        formSubmissions: ids.map((id) => ({ id, status: 'Completed' })),
      },
    },
  };
}

test('pack keeps the preferred eligible pin before newer retained versions and preserves server identities', async () => {
  const calls: Array<[string, number]> = [];
  const result = await resolveHistoricalInstallationPackServerTarget(target, {
    list: async (id) => { assert.equal(id, target.installationId); return { versions: [{ versionNumber: 9 }] }; },
    get: async (id, number) => { calls.push([id, number]); return version(number); },
  });
  assert.deepEqual(calls, [[target.installationId, 4]]);
  assert.deepEqual(result, { ...target, recordVersionPayloadHash: 'hash-4' });
});

test('pack searches remaining versions newest first and requires every selected form in one version', async () => {
  const calls: number[] = [];
  const result = await resolveHistoricalInstallationPackServerTarget(target, {
    list: async () => ({ versions: [2, 4, 6, 3, 6, 0].map((versionNumber) => ({ versionNumber })) }),
    get: async (_id, number) => {
      calls.push(number);
      if (number === 6) throw new Error('Archived version unavailable');
      return version(number, number === 4 ? ['historical-a'] : number === 3 ? ['current-b'] : target.formSubmissionIds);
    },
  });
  assert.deepEqual(calls, [4, 6, 3, 2]);
  assert.equal(result.recordVersionNumber, 2);
  assert.equal(result.recordVersionPayloadHash, 'hash-2');
  assert.deepEqual(result.formSubmissionIds, target.formSubmissionIds);
});

test('pack never combines partial evidence from separate versions', async () => {
  await assert.rejects(resolveHistoricalInstallationPackServerTarget(target, {
    list: async () => ({ versions: [{ versionNumber: 3 }] }),
    get: async (_id, number) => version(number, number === 4 ? ['historical-a'] : ['current-b']),
  }), /every selected completed form/);
});

test('pack rejects foreign identity, ineligible schema, tampering, wrong pin and noncompleted forms', async () => {
  const changes = [
    (v: ReturnType<typeof version>) => { v.entityId = 'foreign'; },
    (v: ReturnType<typeof version>) => { v.snapshot.installationTree.installation.id = 'foreign'; },
    (v: ReturnType<typeof version>) => { v.versionNumber = 7; },
    (v: ReturnType<typeof version>) => { v.snapshot.installationTree.installation.recordVersionNumber = 7; },
    (v: ReturnType<typeof version>) => { v.snapshot.snapshotSchema = 'LegacySnapshot'; },
    (v: ReturnType<typeof version>) => { v.snapshot.readiness.eligibility.authoritativeReport = false; },
    (v: ReturnType<typeof version>) => { v.snapshot.payloadHash = 'different'; },
    (v: ReturnType<typeof version>) => { v.payloadHash = ''; v.snapshot.payloadHash = ''; },
    (v: ReturnType<typeof version>) => { v.snapshot.installationTree.formSubmissions[0].status = 'Draft'; },
  ];
  for (const change of changes) {
    const candidate = version(4); change(candidate);
    await assert.rejects(resolveHistoricalInstallationPackServerTarget(target, {
      list: async () => ({ versions: [] }), get: async () => candidate,
    }), /No retained pinned record version/);
  }
});

test('Draft diagnostic packs do not use a retained authoritative pin or perform history reads', async () => {
  const { recordVersionNumber: _pin, ...identity } = target;
  const diagnostic: InstallationPackServerTarget = { ...identity, liveMode: true };
  const unexpected = async () => { throw new Error('History must not be read for live diagnostic'); };
  assert.equal(await resolveHistoricalInstallationPackServerTarget(diagnostic, { list: unexpected, get: unexpected }), diagnostic);
});

test('retained pack source hash rejects a job with a different hash despite matching version and grouping', async () => {
  const resolved = await resolveHistoricalInstallationPackServerTarget(target, {
    list: async () => ({ versions: [] }), get: async () => version(4),
  });
  const job = { recordVersionNumber: 4, recordVersionPayloadHash: 'hash-4', reportSource: 'canonical-version', detailMode: 'by-zone', reportVariantKey: 'variant' };
  assert.equal(installationReportJobMatchesSelection(job, resolved, 'by-zone', resolved.recordVersionPayloadHash), true);
  assert.equal(installationReportJobMatchesSelection({ ...job, recordVersionPayloadHash: 'wrong-hash' }, resolved, 'by-zone', resolved.recordVersionPayloadHash), false);
});

test('history listing failures propagate rather than falling back to an unproved current pin', async () => {
  await assert.rejects(resolveHistoricalInstallationPackServerTarget(target, {
    list: async () => { throw new Error('Offline'); }, get: async () => version(4),
  }), /Offline/);
});
