import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runLeasedCloudActionStep } from '../src/services/cloudActionLease';

const code = ts.transpileModule(readFileSync(new URL('../src/services/commercialFiles.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(changeAt?: 'availability' | 'token' | 'download' | 'share-error') {
  let current = true; const events: string[] = []; const authority = {};
  const lease = { actorUserId: 'actor', cloudAuthority: authority, processAuthority: {}, assertCurrent: () => {
    if (!current) throw new Error('Screen or actor changed');
  } };
  class Directory { create() { events.push('directory'); } }
  class File { uri = 'file:///private-cache/export'; exists = false; delete() { events.push('delete'); this.exists = false; } }
  const modules: Record<string, any> = {
    'expo-file-system': { Directory, File, Paths: { cache: 'cache' } },
    'expo-sharing': {
      isAvailableAsync: async () => { events.push('availability'); if (changeAt === 'availability') current = false; return true; },
      shareAsync: async (_: string, options: any) => { events.push('share'); assert.equal(options.mimeType, 'application/pdf'); if (changeAt === 'share-error') throw new Error('Native share unavailable'); },
    },
    '../api/apiClient': { runWithCloudAccessToken: async (action: (token: string) => unknown, actualAuthority: unknown) => {
      assert.equal(actualAuthority, authority); events.push('token'); if (changeAt === 'token') current = false;
      return action('synthetic-token');
    } },
    '../constants/syncConfig': { SYNC_API_URL: 'https://qa.example.test' },
    './cloudActionLease': { runLeasedCloudActionStep },
    './authenticatedFileDownload': { authenticatedFileDownload: async ({ url, destination, token, expectedContentType }: any) => {
      assert.equal(url, 'https://qa.example.test/v1/installhub/installations/job/invoices/invoice/pdf');
      assert.equal(token, 'synthetic-token'); assert.equal(expectedContentType, 'application/pdf');
      events.push('download'); destination.exists = true; if (changeAt === 'download') current = false; return destination;
    } },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(name in modules, `Unexpected dependency or recaptured lease: ${name}`); return modules[name]; }, exports);
  return { events, run: () => exports.shareInvoicePdf('job', 'invoice', 'QA-001', lease), expire: () => { current = false; } };
}

test('invoice file download uses the original caller authority and cleans its exact temporary export after share', async () => {
  const h = harness(); await h.run(); assert.deepEqual(h.events, ['availability', 'directory', 'token', 'download', 'share', 'delete']);
});

test('a retained commercial file callback cannot dispatch after its screen or actor expired', async () => {
  const h = harness(); h.expire(); await assert.rejects(h.run(), /changed/); assert.deepEqual(h.events, []);
});

test('blur while checking native sharing prevents directory creation and download', async () => {
  const h = harness('availability'); await assert.rejects(h.run(), /changed/); assert.deepEqual(h.events, ['availability']);
});

test('blur while acquiring the token prevents authenticated download', async () => {
  const h = harness('token'); await assert.rejects(h.run(), /changed/); assert.deepEqual(h.events, ['availability', 'directory', 'token']);
});

test('a completed download after blur is cleaned and never opens the native share sheet', async () => {
  const h = harness('download'); await assert.rejects(h.run(), /changed/);
  assert.deepEqual(h.events, ['availability', 'directory', 'token', 'download', 'delete']);
});

test('native share failure cleans its export without deleting original commercial data', async () => {
  const h = harness('share-error'); await assert.rejects(h.run(), /Native share/); assert.equal(h.events.at(-1), 'delete');
});
