import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedDownloadRequest } from '../src/services/downloadSecurity';

const API_URL = 'https://api.example.test/api-prefix';

test('exact API-origin HTTPS downloads receive bearer authorization', () => {
  assert.deepEqual(
    trustedDownloadRequest('/v1/files/photo.jpg', API_URL),
    {
      url: 'https://api.example.test/v1/files/photo.jpg',
      authorization: 'api-bearer',
    },
  );
  assert.equal(
    trustedDownloadRequest('https://api.example.test/v1/files/photo.jpg', API_URL).authorization,
    'api-bearer',
  );
});

test('cross-origin URLs never receive InstallHub bearer authorization', () => {
  const signature = 'a'.repeat(64);
  const request = trustedDownloadRequest(
    `https://media.example.test/v1/thumbnails/photo.jpg?expires=2000000000&signature=${signature}`,
    API_URL,
  );
  assert.equal(request.authorization, 'none');
  assert.throws(
    () => trustedDownloadRequest('https://media.example.test/file.jpg', API_URL),
    /not an explicitly signed HTTPS URL/,
  );
});

test('HTTP and credential-bearing download URLs are rejected', () => {
  assert.throws(
    () => trustedDownloadRequest('http://api.example.test/v1/files/photo.jpg', API_URL),
    /must use credential-free HTTPS/,
  );
  assert.throws(
    () => trustedDownloadRequest('https://user:secret@api.example.test/file.jpg', API_URL),
    /must use credential-free HTTPS/,
  );
});
