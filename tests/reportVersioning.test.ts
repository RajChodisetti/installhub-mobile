import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formReportVersionQuery,
  installationReportVersionFields,
  reportJobMatchesSelection,
  reportVersionCacheToken,
  selectReportVersion,
} from '../src/services/reportVersioning';

test('report requests explicitly choose a pinned version or diagnostic live mode', () => {
  assert.deepEqual(selectReportVersion(6, true), { recordVersionNumber: 6 });
  assert.deepEqual(selectReportVersion(undefined), { liveMode: true });
  assert.throws(
    () => selectReportVersion(undefined, true),
    /requires a pinned record version/,
  );
  assert.equal(reportVersionCacheToken({ recordVersionNumber: 6 }), 'record-version:6');
  assert.equal(reportVersionCacheToken({ liveMode: true }), 'live-mode');
  assert.equal(formReportVersionQuery({ recordVersionNumber: 6 }), 'recordVersionNumber=6');
  assert.equal(formReportVersionQuery({ liveMode: true }), 'liveMode=true');
  assert.deepEqual(
    installationReportVersionFields({ recordVersionNumber: 6 }),
    { recordVersionNumber: 6 },
  );
  assert.deepEqual(installationReportVersionFields({ liveMode: true }), { liveMode: true });
});

test('remembered and completed jobs must echo the exact version and payload hash', () => {
  const selection = { recordVersionNumber: 6 } as const;
  const job = {
    recordVersionNumber: 6,
    recordVersionPayloadHash: 'sha256:version-six',
    reportSource: 'canonical-version',
  };
  assert.equal(reportJobMatchesSelection(job, selection), true);
  assert.equal(
    reportJobMatchesSelection(job, selection, 'sha256:version-six'),
    true,
  );
  assert.equal(
    reportJobMatchesSelection({ ...job, recordVersionNumber: 7 }, selection),
    false,
  );
  assert.equal(
    reportJobMatchesSelection(job, selection, 'sha256:different'),
    false,
  );
  assert.equal(
    reportJobMatchesSelection({ ...job, recordVersionPayloadHash: null }, selection),
    false,
  );
  assert.equal(
    reportJobMatchesSelection({ ...job, reportSource: 'diagnostic-live' }, selection),
    false,
  );
  assert.equal(
    reportJobMatchesSelection(
      {
        recordVersionNumber: null,
        recordVersionPayloadHash: null,
        reportSource: 'diagnostic-live',
      },
      { liveMode: true },
    ),
    true,
  );
  assert.equal(
    reportJobMatchesSelection(
      {
        recordVersionNumber: null,
        recordVersionPayloadHash: null,
        reportSource: 'canonical-version',
      },
      { liveMode: true },
    ),
    false,
  );
});
