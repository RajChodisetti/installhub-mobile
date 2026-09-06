import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { sha256 } from 'js-sha256';
import { resolveOwnedMediaUri, mediaReferenceIdentity, storedMediaIsReferenced } from '../src/services/ownedMediaPaths';
import { evidenceDirectoryIsReferenced } from '../src/services/formStorageOwnership';

const oldRoot = 'file:///var/mobile/Containers/Data/Application/2AC64DC4-7E3C-46BD-A5C5-90D6C6253337/Documents';
const currentRoot = 'file:///var/mobile/Containers/Data/Application/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE/Documents';
const relative = 'form-media/form_mtoojprm_4h7kf6/photo_mtopfg2c_jlz88i.jpg';
const oldPhoto = `${oldRoot}/${relative}`;
const currentPhoto = `${currentRoot}/${relative}`;
const originalBytes = Buffer.from('Unchanged synthetic original JPEG bytes');
const form = () => ({ id: 'form_mtoojprm_4h7kf6', installation_id: 'job', form_type: 'captis-installation',
  attachments: [{ id: 'photo_mtopfg2c_jlz88i', uri: oldPhoto, slot: 'meter.face_photo', mime_type: 'image/jpeg', caption: 'Original caption' }],
  values: { serial: 'QA' }, status: 'Draft', version: 1 });

/** Execute production modules, replacing only native file/picker/print and
 * network/store boundaries. The file map deliberately contains no old root. */
function harness() {
  const files = new Map<string, Buffer>([
    [currentPhoto, originalBytes], ['file:///logo.png', Buffer.from('logo')],
  ]);
  const reads: string[] = [], deleted: string[] = [], resized: string[] = [];
  const printed: string[] = [], shared: string[] = [], embedded: unknown[] = [];
  let store: any = { cloudSync: { thumbnail_queue: [] } };
  class Directory {
    uri: string;
    constructor(...parts: any[]) { this.uri = parts.map((p) => typeof p === 'string' ? p : p.uri).map((p: string, i: number) => i ? p.replace(/^\//, '') : p.replace(/\/$/, '')).join('/'); }
    get exists() { return [...files.keys()].some((uri) => uri === this.uri || uri.startsWith(`${this.uri}/`)); }
    create() {}
    delete() { deleted.push(this.uri); for (const uri of files.keys()) if (uri === this.uri || uri.startsWith(`${this.uri}/`)) files.delete(uri); }
  }
  class File extends Directory {
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    async base64() { reads.push(this.uri); const value = files.get(this.uri); if (!value) throw new Error(`Missing fixture ${this.uri}`); return value.toString('base64'); }
    copy(target: File) { files.set(target.uri, Buffer.from(files.get(this.uri)!)); }
    write(bytes: Uint8Array) { files.set(this.uri, Buffer.from(bytes)); }
  }
  const native = { File, Directory, Paths: { document: { uri: `${currentRoot}/` }, cache: { uri: 'file:///cache' } } };
  const modules = new Map<string, any>();
  const common: Record<string, any> = {
    'expo-file-system': native,
    'expo-image-picker': {},
    'react-native': { Platform: { OS: 'ios' } },
    'expo-asset': { Asset: { loadAsync: async () => [{ localUri: 'file:///logo.png' }] } },
    'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async (uri: string) => {
      resized.push(uri); assert.ok(files.has(uri)); files.set('file:///cache/processed.jpg', Buffer.from('resized'));
      return { uri: 'file:///cache/processed.jpg' };
    } },
    'expo-print': { printToFileAsync: async ({ html }: { html: string }) => {
      printed.push(html); files.set('file:///cache/temporary.pdf', Buffer.alloc(6000));
      return { uri: 'file:///cache/temporary.pdf', numberOfPages: 1 };
    } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri: string) => { shared.push(uri); } },
    './formReportHtml': { buildFormReportHtml: (_: unknown, images: unknown) => { embedded.push(images); return '<html>Report</html>'; } },
    './clientReportHtml': { buildClientReportHtml: (_: unknown, __: unknown, images: unknown) => { embedded.push(images); return '<html>Client report</html>'; } },
    './reportFilenames': { formPdfFilename: () => 'form.pdf' },
    './reportPage': { A4_PRINT_WIDTH: 600, A4_PRINT_HEIGHT: 800 },
    '../domain/clientReport': { clientReportModel: (data: any) => ({ includedPhotos: data.photos }) },
  };
  const load = (path: string, extra: Record<string, any> = {}, expose = ''): any => {
    const file = new URL(`../src/${path}.ts`, import.meta.url);
    const localRequire = createRequire(file);
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(file, 'utf8') + expose, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Error, Uint8Array, atob, setTimeout, clearTimeout,
      require: (name: string) => {
        if (name in extra) return extra[name];
        if (name in common) return common[name];
        if (name.endsWith('/seed')) return { getStore: () => store, initStore: async () => store };
        if (name.endsWith('/ownedMediaPaths')) {
          if (!modules.has('paths')) modules.set('paths', load('services/ownedMediaPaths'));
          return modules.get('paths');
        }
        if (name.endsWith('.png')) return 'fixture-logo';
        return localRequire(name);
      },
    });
    return exports;
  };
  return { files, reads, deleted, resized, printed, shared, embedded, load, setStore: (value: unknown) => { store = value; } };
}

test('old and private iOS container roots rebase only exact managed relative paths', () => {
  assert.equal(resolveOwnedMediaUri(oldPhoto, `${currentRoot}/`), currentPhoto);
  assert.equal(resolveOwnedMediaUri(oldPhoto.replace('file:///var/', 'file:///private/var/'), currentRoot), currentPhoto);
  assert.equal(resolveOwnedMediaUri(currentPhoto, currentRoot), currentPhoto);
  assert.equal(resolveOwnedMediaUri(`${oldRoot}/installhub-media/photo_123.jpg`, currentRoot), `${currentRoot}/installhub-media/photo_123.jpg`);
});

test('foreign, arbitrary, traversal, encoded, cache and directory paths are never rebased', () => {
  const rejected = [
    oldPhoto.replace('file:', 'https:'), oldPhoto.replace('file:///', 'file://localhost/'),
    oldPhoto.replace('Application/', 'Application/foreign/'), oldPhoto.replace('2AC64DC4', 'notauuid'),
    oldPhoto.replace('/Documents/', '/Library/Caches/'), 'file:///documents/' + relative,
    'file:///var/other/Documents/' + relative, oldRoot + '/form-media/../photo.jpg',
    oldRoot + '/form-media/form/../../photo.jpg', oldRoot + '/form-media/form/%2e%2e/photo.jpg',
    oldRoot + '/form-media/form/photo%2fother.jpg', oldRoot + '/form-media/form/photo.jpg?x=1',
    oldRoot + '/form-media/form/photo.jpg#x', oldRoot + '/form-media/form\\other/photo.jpg',
    oldRoot + '/form-media/form/photo.jpg/',
    oldRoot + '/form-media//photo.jpg', oldRoot + '/form-media/form',
    oldRoot + '/installhub-media/form/photo.jpg', oldRoot + '/foreign/photo.jpg',
  ];
  for (const uri of rejected) assert.equal(resolveOwnedMediaUri(uri, currentRoot), uri, uri);
  assert.equal(resolveOwnedMediaUri(oldPhoto, 'file:///foreign/Documents'), oldPhoto);
  assert.equal(resolveOwnedMediaUri(oldPhoto, currentRoot + '/foreign'), oldPhoto);
});

test('reference ownership spans old/current roots without mutating immutable originals', () => {
  const archive = { tree: form(), queue: [{ local_uri: oldPhoto, checksum: 'retain' }], unknown: { original: 'retained' } };
  const before = JSON.stringify(archive);
  assert.equal(mediaReferenceIdentity(oldPhoto), mediaReferenceIdentity(currentPhoto));
  assert.equal(storedMediaIsReferenced(currentPhoto, { archives: [archive] }), true);
  assert.equal(storedMediaIsReferenced(currentPhoto.replace('photo_', 'other_'), archive), false);
  assert.equal(evidenceDirectoryIsReferenced(`${currentRoot}/form-media/form_mtoojprm_4h7kf6`, [oldPhoto]), true);
  assert.equal(evidenceDirectoryIsReferenced(`${currentRoot}/form-media/form_other`, [oldPhoto]), false);
  assert.equal(JSON.stringify(archive), before);
});

test('production original-quality PDF reads same retained bytes through new container, leaves attachment unchanged', async () => {
  const h = harness(); const report = h.load('services/formReport'); const submission = form(); const before = JSON.stringify(submission);
  const uri = await report.createFormPdf(submission, 0, { stampPageNumbers: false });
  assert.equal(uri, 'file:///cache/form-reports/form.pdf');
  assert.ok(h.reads.includes(currentPhoto)); assert.ok(!h.reads.includes(oldPhoto));
  assert.deepEqual(h.resized, []); assert.equal(h.printed.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.embedded[0])), { 'meter.face_photo': [{ uri: `data:image/jpeg;base64,${originalBytes.toString('base64')}`, caption: 'Original caption' }] });
  assert.equal(JSON.stringify(submission), before);
  assert.deepEqual(h.files.get(currentPhoto), originalBytes); assert.ok(!h.deleted.includes(currentPhoto));
});

test('production reduced-quality PDF uses resolved source but deletes only temporary derivative', async () => {
  const h = harness(); await h.load('services/formReport').createFormPdf(form(), 1, { stampPageNumbers: false });
  assert.deepEqual(h.resized, [currentPhoto]);
  assert.ok(h.deleted.includes('file:///cache/processed.jpg')); assert.ok(!h.deleted.includes(currentPhoto));
  assert.deepEqual(h.files.get(currentPhoto), originalBytes);
});

test('genuinely absent local evidence stays unchanged and cannot become a PDF capacity/downsampling error', async () => {
  const h = harness(); h.files.delete(currentPhoto); const report = h.load('services/formReport'); const submission = form(); const before = JSON.stringify(submission);
  h.files.set(`${currentRoot}/form-media/unrelated-form/photo_mtopfg2c_jlz88i.jpg`, Buffer.from('Different file with same basename'));
  await assert.rejects(report.createFormPdf(submission), (error: any) => {
    assert.equal(error.name, 'MissingLocalFormEvidenceError');
    assert.equal(report.isRetryableFormPdfError(error), false);
    assert.equal(error instanceof report.FormPdfGenerationError, false);
    assert.match(error.message, /meter.face_photo/); return true;
  });
  assert.equal(h.printed.length, 0); assert.equal(h.resized.length, 0); assert.equal(JSON.stringify(submission), before);
});

test('remote original evidence keeps existing server-report requirement', async () => {
  const h = harness(); const report = h.load('services/formReport'); const submission = form(); submission.attachments[0]!.uri = 'https://example.test/original.jpg';
  await assert.rejects(report.createFormPdf(submission), (error: any) => error instanceof report.RemoteFormEvidenceError);
  assert.equal(h.printed.length, 0);
});

test('production client report resizes resolved original and preserves source identity', async () => {
  const h = harness(); const photo = { key: 'photo', uri: oldPhoto, label: 'Original meter' }; const before = JSON.stringify(photo);
  await h.load('services/clientReport').shareClientReportPdf({ installation: { site_name: 'QA' }, photos: [photo] }, {});
  assert.deepEqual(h.resized, [currentPhoto]); assert.equal(h.shared.length, 1);
  assert.equal(JSON.stringify(photo), before); assert.deepEqual(h.files.get(currentPhoto), originalBytes);
});

test('production UI resolver reads managed photo and preserves remote preview queue behavior', () => {
  const h = harness(); const queue = [{ remote_uri: 'https://example.test/photo.jpg', status: 'ready', local_uri: 'file:///cache/preview.jpg' }];
  h.setStore({ cloudSync: { thumbnail_queue: queue } }); const before = JSON.stringify(queue);
  const repo = h.load('repositories/cloudSyncRepository');
  assert.equal(repo.cachedThumbnailUri(oldPhoto), currentPhoto);
  assert.equal(repo.cachedThumbnailUri('https://example.test/photo.jpg'), 'file:///cache/preview.jpg');
  assert.equal(repo.cachedThumbnailUri('https://example.test/other.jpg'), undefined);
  assert.equal(JSON.stringify(queue), before);
});

function uploadHarness(missing = false) {
  const h = harness(); if (missing) h.files.delete(currentPhoto);
  const calls: Array<{ name: string; value: any }> = [];
  const row = { id: 'upload-original', installation_id: 'job', local_uri: oldPhoto, entity_type: 'form_submission', entity_id: 'original-form',
    field_name: 'attachments[0].uri', mime_type: 'image/jpeg', attempts: 0, status: 'pending', session_id: undefined };
  const repo = {
    assertInstallationAllowsNewBackupDispatch: () => {},
    getInstallationBackupTree: async () => ({ baseTreeRevision: 4, watermark: 'original-watermark', installation: { tree_revision: 9 } }),
    updateUploadQueueItem: async (id: string, patch: object, guard: () => void) => { guard(); calls.push({ name: 'queue', value: { id, patch } }); Object.assign(row, patch); },
    recordInstallationServerTreeRevision: async (...args: unknown[]) => { calls.push({ name: 'revision', value: args }); },
  };
  const service = h.load('services/syncService', {
    '../repositories/cloudSyncRepository': repo,
    '../api/apiClient': { assertCurrentCloudSessionAuthority: () => {}, apiClient: {
      checkPhoto: async (value: unknown) => { calls.push({ name: 'check', value }); return { exists: false }; },
      createUploadSession: async (value: unknown) => { calls.push({ name: 'session', value }); return { sessionId: 'session', uploadUrl: 'https://example.test/upload' }; },
      uploadPhoto: async (_: string, value: ArrayBuffer) => { calls.push({ name: 'upload', value: Buffer.from(value) }); },
      confirmUpload: async (...value: unknown[]) => { calls.push({ name: 'confirm', value }); return { treeRevision: 5, remoteUrl: 'https://example.test/evidence.jpg' }; },
    } },
    './assignedWorkMutationGuard': { assertCurrentAssignedWorkAuthority: () => {} },
    '../repositories': {},
    './displayCodeReconciliation': {},
    './operationalDiagnostics': {},
    './serverResultCommitFence': {},
  }, '\nexport { processUpload };');
  return { ...h, calls, row, run: () => service.processUpload(row, { actorUserId: 'actor', cloudAuthority: {}, assignedWorkAuthority: {} }) };
}

test('production backup uploads retained bytes with original queue identity and original CAS context', async () => {
  const h = uploadHarness(); await h.run();
  assert.deepEqual(h.calls.find((c) => c.name === 'upload')!.value, originalBytes);
  const check = h.calls.find((c) => c.name === 'check')!.value;
  assert.equal(check.checksum, sha256(originalBytes)); assert.equal(check.entityId, 'original-form'); assert.equal(check.baseTreeRevision, 4);
  assert.equal(h.row.id, 'upload-original'); assert.equal(h.row.local_uri, oldPhoto); assert.equal(h.row.status, 'cleared');
  assert.equal(h.calls.find((c) => c.name === 'session')!.value.filename, 'photo_mtopfg2c_jlz88i.jpg');
  assert.deepEqual(h.files.get(currentPhoto), originalBytes); assert.deepEqual(h.deleted, []);
});

test('production backup still fails closed when exact managed file is absent', async () => {
  const h = uploadHarness(true); await assert.rejects(h.run(), /Local evidence file is missing/);
  assert.equal(h.row.status, 'failed'); assert.equal(h.row.local_uri, oldPhoto);
  assert.deepEqual(h.calls.map((call) => call.name), ['queue']);
});

for (const location of ['live-form', 'recovery', 'queue'] as const) test(`photo deletion preserves ${location} references across container roots`, () => {
  const h = harness();
  h.setStore(location === 'live-form' ? { formSubmissions: [form()] } : location === 'recovery'
    ? { assignedWorkRecoveryCheckouts: [{ formSubmissions: [form()] }] } : { cloudSync: { upload_queue: [{ local_uri: oldPhoto }] } });
  h.load('services/formMedia').deleteFormPhoto({ ...form().attachments[0], uri: currentPhoto });
  assert.deepEqual(h.files.get(currentPhoto), originalBytes); assert.deepEqual(h.deleted, []);
});

test('unreferenced old-root form photo deletion targets only the exact current file', () => {
  const h = harness(); h.load('services/formMedia').deleteFormPhoto(form().attachments[0]);
  assert.deepEqual(h.deleted, [currentPhoto]); assert.ok(!h.files.has(currentPhoto));
});

test('entity cleanup recognizes retained old/current aliases and never deletes foreign media', () => {
  const h = harness(); const oldEntity = `${oldRoot}/installhub-media/photo_1.jpg`; const currentEntity = `${currentRoot}/installhub-media/photo_1.jpg`;
  h.files.set(currentEntity, originalBytes); h.files.set('file:///foreign/photo_1.jpg', originalBytes);
  const media = h.load('services/localMedia');
  assert.equal(media.deleteRemovedLocalPhotos([oldEntity], [currentEntity]), 0);
  h.setStore({ assignedWorkRecoveryCheckouts: [{ zones: [{ photos: [oldEntity] }] }] });
  assert.equal(media.deleteLocalPhoto(currentEntity), false);
  h.setStore({}); assert.equal(media.deleteLocalPhoto('file:///foreign/photo_1.jpg'), false);
  assert.equal(media.deleteLocalPhoto(oldEntity), true); assert.deepEqual(h.deleted, [currentEntity]);
});

test('production directory cleanup preserves inherited old-root evidence but removes unreferenced directory', () => {
  const h = harness(); const service = h.load('services/formStorageCleanup');
  const preserved = service.deleteFormLocalFiles(form(), [oldPhoto]);
  assert.equal(preserved.preservedEvidenceDirectory, true); assert.equal(h.files.has(currentPhoto), true);
  const removed = service.deleteFormLocalFiles(form(), []);
  assert.equal(removed.removedEvidenceDirectory, true); assert.equal(h.files.has(currentPhoto), false);
});
