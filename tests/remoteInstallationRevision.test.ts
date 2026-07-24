import assert from 'node:assert/strict';
import test from 'node:test';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import { remoteInstallationTreeRevision } from '../src/services/remoteInstallationRevision';

const tree: RemoteInstallationTree = {
  installation: {
    id: 'installation-1',
    siteName: 'Example',
    updatedAt: '2026-07-23T00:00:00.000Z',
  },
  zones: [
    { id: 'zone-b', zoneName: 'Second' },
    { id: 'zone-a', zoneName: 'First' },
  ],
  electricalAssets: [],
  siteAssets: [],
  formSubmissions: [{
    id: 'form-1',
    answers: { 'device.type': 'A3RM' },
    attachments: [],
  }],
};

test('remote tree revision ignores top-level database result order', () => {
  assert.equal(
    remoteInstallationTreeRevision(tree),
    remoteInstallationTreeRevision({
      ...tree,
      zones: [...tree.zones].reverse(),
    }),
  );
});

test('remote tree revision changes with report-relevant source content', () => {
  assert.notEqual(
    remoteInstallationTreeRevision(tree),
    remoteInstallationTreeRevision({
      ...tree,
      formSubmissions: [{
        ...tree.formSubmissions[0]!,
        answers: { 'device.type': 'A6M' },
      }],
    }),
  );
});
