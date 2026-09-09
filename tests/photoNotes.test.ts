import assert from 'node:assert/strict';
import test from 'node:test';
import { removeIndexedPhotoNote, setPhotoNote } from '../src/domain/photoNotes';

test('photo notes preserve in-progress spacing and remain removable', () => {
  assert.deepEqual(setPhotoNote({ photo: 'Old' }, 'photo', '  New note  '), { photo: '  New note  ' });
  assert.deepEqual(setPhotoNote({ photo: 'Old' }, 'photo', ' '), {});
});

test('array photo removal keeps notes aligned to the remaining photos', () => {
  assert.deepEqual(removeIndexedPhotoNote({
    'extraPhotos[0]': 'One',
    'extraPhotos[1]': 'Two',
    'extraPhotos[2]': 'Three',
    locationPhoto: 'Location',
  }, 'extraPhotos', 1), {
    'extraPhotos[0]': 'One',
    'extraPhotos[1]': 'Three',
    locationPhoto: 'Location',
  });
});
