import assert from 'node:assert/strict';
import test from 'node:test';
import { scannerPermissionDecision } from '../src/components/barcodeScannerPolicy';

test('camera denial keeps manual scanner entry available', () => {
  assert.deepEqual(scannerPermissionDecision(false), {
    openScanner: false,
    manualEntryEnabled: true,
    fallbackMessage: 'Camera permission needed to scan. You can still type the code.',
  });
  assert.deepEqual(scannerPermissionDecision(true), {
    openScanner: true,
    manualEntryEnabled: true,
  });
});
