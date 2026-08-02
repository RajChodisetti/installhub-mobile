import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasRecognizedImageSignature,
  interruptedThumbnailRecovery,
  thumbnailAttemptFilename,
} from '../src/services/thumbnailRecovery';

test('a direct-write crash window discards the interrupted attempt and retries uniquely', () => {
  const firstAttempt = thumbnailAttemptFilename(
    'https://api.example.test/v1/thumbnails/photo.jpg',
    'thumb-job',
    1,
  );
  const committedUri = `file:///cache/${firstAttempt}`;
  const retry = interruptedThumbnailRecovery({
    status: 'downloading',
    local_uri: committedUri,
  });
  assert.deepEqual(retry, { status: 'pending', local_uri: undefined });
  assert.equal(interruptedThumbnailRecovery({
    status: 'ready',
    local_uri: committedUri,
  }), null);
  assert.notEqual(
    thumbnailAttemptFilename(
      'https://api.example.test/v1/thumbnails/photo.jpg',
      'thumb-job',
      2,
    ),
    firstAttempt,
  );
});

test('thumbnail recovery accepts image signatures and rejects an HTML partial', () => {
  assert.equal(hasRecognizedImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(hasRecognizedImageSignature(new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])), true);
  assert.equal(
    hasRecognizedImageSignature(new TextEncoder().encode('<!doctype html>')),
    false,
  );
});
