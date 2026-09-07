import assert from 'node:assert/strict';
import test from 'node:test';
import {
  electricalMapDownloadPath,
  electricalMapRecordVersionForDownload,
} from '../src/domain/electricalMapDownload';

test('electrical map API paths encode ids, format, and optional immutable version', () => {
  assert.equal(
    electricalMapDownloadPath('site/a b', 'png'),
    '/v1/installhub/installations/site%2Fa%20b/electrical-map?format=png',
  );
  assert.equal(
    electricalMapDownloadPath('installation-1', 'svg', 7),
    '/v1/installhub/installations/installation-1/electrical-map?format=svg&recordVersionNumber=7',
  );
});

test('electrical map download target uses live data only for Draft installations', () => {
  assert.equal(electricalMapRecordVersionForDownload('Draft'), undefined);
  assert.equal(electricalMapRecordVersionForDownload('Draft', 7), undefined);
  assert.equal(electricalMapRecordVersionForDownload('Completed', 7), 7);
});

test('completed electrical map download fails closed without a positive immutable version', () => {
  for (const version of [undefined, null, 0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => electricalMapRecordVersionForDownload('Completed', version),
      /requires a positive immutable record version/,
    );
  }
});

test('electrical map path rejects invalid pinned versions', () => {
  for (const version of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => electricalMapDownloadPath('installation-1', 'png', version),
      /pinned electrical-map version is invalid/,
    );
  }
});
