import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePhotoMetadataMap,
  optionalPhotoMetadataMap,
  photoIsLargeInPdf,
  removeIndexedPhotoMetadata,
  removePhotoMetadata,
  setPhotoLargeInPdf,
} from '../src/domain/photoMetadata';

test('photo PDF sizing preserves an explicit false choice', () => {
  const compact = setPhotoLargeInPdf(undefined, 'photos[0]', false);
  assert.deepEqual(compact, { 'photos[0]': { largeInPdf: false } });
  assert.equal(photoIsLargeInPdf(compact, 'photos[0]'), false);

  const large = setPhotoLargeInPdf(compact, 'photos[0]', true);
  assert.deepEqual(large, { 'photos[0]': { largeInPdf: true } });
  assert.equal(photoIsLargeInPdf(large, 'photos[0]'), true);
  assert.deepEqual(removePhotoMetadata(large, 'photos[0]'), {});
});

test('indexed metadata follows surviving photos after deletion', () => {
  const result = removeIndexedPhotoMetadata({
    'photos[0]': { largeInPdf: false },
    'photos[1]': { largeInPdf: true },
    'photos[2]': { largeInPdf: false },
    photo: { largeInPdf: true },
  }, 'photos', 1);

  assert.deepEqual(result, {
    'photos[0]': { largeInPdf: false },
    'photos[1]': { largeInPdf: false },
    photo: { largeInPdf: true },
  });
});

test('wire metadata normalization retains booleans and distinguishes omission', () => {
  assert.equal(optionalPhotoMetadataMap(undefined), undefined);
  assert.deepEqual(optionalPhotoMetadataMap({}), {});
  assert.deepEqual(normalizePhotoMetadataMap({
    photo: { largeInPdf: false },
    'extraPhotos[0]': { largeInPdf: true },
    invalid: { largeInPdf: 'yes' },
    unsafe: null,
  }), {
    photo: { largeInPdf: false },
    'extraPhotos[0]': { largeInPdf: true },
  });
});
