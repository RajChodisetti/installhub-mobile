import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { InstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { electricalDiagramFixture } from './fixtures/electricalDiagramFixture';

function reportHarness() {
  const sourceFile = new URL('../src/services/installationReport.ts', import.meta.url);
  const localRequire = createRequire(sourceFile);
  const resized: string[] = [];
  class File {
    uri: string;
    exists = true;
    size = 10_000;
    constructor(uri: string) { this.uri = uri; }
    get extension() { return /\.[a-z0-9]+$/i.exec(this.uri)?.[0] ?? ''; }
    get type() {
      if (this.extension === '.png') return 'image/png';
      if (this.extension === '.webp') return 'image/webp';
      if (this.extension === '.heic') return 'image/heic';
      return 'image/jpeg';
    }
    async base64() { return 'YWJj'; }
    delete() {}
  }
  class ReportError extends Error {}
  const mocks: Record<string, unknown> = {
    'expo-asset': { Asset: {} },
    'expo-file-system': { File, Directory: class {}, Paths: {} },
    'expo-image-manipulator': {
      SaveFormat: { JPEG: 'jpeg' },
      manipulateAsync: async (uri: string) => {
        resized.push(uri);
        return { uri: 'file:///converted.jpg' };
      },
    },
    'expo-print': {},
    'expo-sharing': {},
    'pdf-lib': { PDFDocument: {} },
    './formReport': {
      FORM_PDF_TIERS: [
        { width: 1600, quality: 0.82 },
        { width: 1200, quality: 0.68 },
      ],
      FormPdfGenerationError: ReportError,
      MissingLocalFormEvidenceError: ReportError,
      RemoteFormEvidenceError: ReportError,
      createFormPdf: async () => '',
    },
    './ownedMediaPaths': { resolveOwnedMediaUri: (uri: string) => uri },
    './formReportTheme': { FORM_REPORT_THEME: {} },
    './reportPage': { A4_PRINT_HEIGHT: 842, A4_PRINT_WIDTH: 595, stampPdfPageFooters: async () => {} },
  };
  const source = `${readFileSync(sourceFile, 'utf8')}\nexport { embedInstallationEvidence as __embedInstallationEvidence };`;
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: (name: string) => name in mocks ? mocks[name] : localRequire(name),
    Intl,
    Date,
    Error,
    requireAsset: () => 'logo',
  });
  return { report: exports, resized };
}

function reportTree(): InstallationBackupTree {
  const diagram = electricalDiagramFixture();
  diagram.zones[0]!.photos = ['file:///zone.png'];
  diagram.zones[0]!.photo_notes = { 'photos[0]': 'Whole switchroom' };
  diagram.zones[0]!.photoMetadata = { 'photos[0]': { largeInPdf: true } };
  return {
    treeSchemaVersion: 2,
    installation: diagram.installation,
    gridSupplies: diagram.gridSupplies,
    zones: diagram.zones,
    electricalAssets: diagram.boards,
    siteAssets: diagram.siteAssets,
    meterDevices: diagram.meterDevices,
    measurementAssignments: diagram.measurementAssignments,
    formSubmissions: [{
      id: 'form',
      installation_id: diagram.installation.id,
      form_type: 'honeywell-q400',
      schema_version: 2,
      status: 'Completed',
      answers: {},
      attachments: [{
        id: 'form-photo',
        slot: 'water.lcd_photo',
        uri: 'file:///form.jpg',
        mime_type: 'image/jpeg',
        largeInPdf: false,
        captured_at: '2026-09-09T00:00:00.000Z',
      }],
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
    }],
    watermark: '2026-09-09T00:00:00.000Z',
  };
}

test('installation report weight counts entity and form evidence and requires API for remote entities', () => {
  const { report } = reportHarness();
  const local = reportTree();
  const localWeight = report.installationReportWeight(local);
  assert.equal(localWeight.attachmentCount, 2);
  assert.equal(localWeight.remoteAttachmentCount, 0);
  assert.equal(localWeight.path, 'DEVICE');

  const remote = structuredClone(local);
  remote.zones[0]!.photos[0] = 'https://api.example.test/evidence/zone.png';
  const remoteWeight = report.installationReportWeight(remote);
  assert.equal(remoteWeight.attachmentCount, 2);
  assert.equal(remoteWeight.remoteAttachmentCount, 1);
  assert.equal(remoteWeight.path, 'API_REQUIRED');
  assert.match(remoteWeight.reasons.join(' '), /1 selected evidence image is stored in Cloud Backup/);
});

test('formal installation summary includes entity captions, large sizing and one whole map', () => {
  const { report } = reportHarness();
  const tree = reportTree();
  const photos = report.installationEntityEvidencePhotos(tree);
  const html = report.buildInstallationSummaryHtml({
    tree,
    completedForms: tree.formSubmissions,
    detailMode: 'by-electrical-hierarchy',
    brandLogoDataUri: 'data:image/png;base64,YWJj',
    evidencePhotos: photos,
    evidenceImages: { [photos[0].key]: 'data:image/png;base64,YWJj' },
  });

  assert.match(html, /Photographic evidence/);
  assert.match(html, /Whole switchroom/);
  assert.match(html, /class="evidence-large"/);
  assert.match(html, /max-height: 370px/);
  assert.equal((html.match(/class="map-frame/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Electrical map detail/);
});

test('original PNG and WebP evidence keeps its MIME while unsupported originals transcode', async () => {
  const { report, resized } = reportHarness();
  const photos = [
    { key: 'png', label: 'PNG', uri: 'file:///photo.png', largeInPdf: false },
    { key: 'webp', label: 'WebP', uri: 'file:///photo.webp', largeInPdf: false },
    { key: 'heic', label: 'HEIC', uri: 'file:///photo.heic', largeInPdf: false },
  ];
  const images = await report.__embedInstallationEvidence(photos, 0);

  assert.equal(images.png, 'data:image/png;base64,YWJj');
  assert.equal(images.webp, 'data:image/webp;base64,YWJj');
  assert.equal(images.heic, 'data:image/jpeg;base64,YWJj');
  assert.deepEqual(resized, ['file:///photo.heic']);
});
