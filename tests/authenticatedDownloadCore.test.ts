import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authenticatedDownloadToFile,
  type AtomicDownloadFile,
  type AuthenticatedFetch,
  type DownloadResponseLike,
} from '../src/services/authenticatedDownloadCore';

class FakeFile implements AtomicDownloadFile {
  exists = false;
  size = 0;

  constructor(readonly uri: string, readonly name: string) {}

  create() { this.exists = true; this.size = 0; }
  delete() { this.exists = false; this.size = 0; }
  info() { return { size: this.size }; }
  writableStream() {
    return new WritableStream<Uint8Array<ArrayBufferLike>>({
      write: (chunk) => { this.size += chunk.byteLength; },
    });
  }
  async move(destination: AtomicDownloadFile) {
    const target = destination as FakeFile;
    if (target.exists) throw new Error('destination already exists');
    target.exists = true;
    target.size = this.size;
    this.exists = false;
    this.size = 0;
  }
}

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

function response(body: ReadableStream<Uint8Array<ArrayBuffer>>): DownloadResponseLike {
  return {
    ok: true,
    status: 200,
    redirected: false,
    headers: headers({ 'content-type': 'application/pdf', 'content-length': '3' }),
    body,
  };
}

test('authenticated redirects reject before any destination or partial file is created', async () => {
  const destination = new FakeFile('file:///report.pdf', 'report.pdf');
  let partial: FakeFile | undefined;
  const fetcher: AuthenticatedFetch = async (_url, init) => {
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.Authorization, 'Bearer secret-token');
    return {
      ...response(new ReadableStream<Uint8Array<ArrayBuffer>>()),
      redirected: true,
    };
  };
  await assert.rejects(authenticatedDownloadToFile({
    url: 'https://api.example.test/report',
    token: 'secret-token',
    destination,
    createPartialFile: () => (partial = new FakeFile('file:///.report.partial', '.report.partial')),
    fetcher,
    expectedContentType: 'application/pdf',
  }), /cannot follow redirects/);
  assert.equal(destination.exists, false);
  assert.equal(partial, undefined);
});

test('stream failures remove the isolated partial and never expose the destination', async () => {
  const destination = new FakeFile('file:///report.pdf', 'report.pdf');
  const partial = new FakeFile('file:///.report.partial', '.report.partial');
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.error(new Error('stream interrupted'));
    },
  });
  await assert.rejects(authenticatedDownloadToFile({
    url: 'https://api.example.test/report',
    token: 'token',
    destination,
    createPartialFile: () => partial,
    fetcher: async () => response(body),
    expectedContentType: 'application/pdf',
  }), /stream interrupted/);
  assert.equal(partial.exists, false);
  assert.equal(destination.exists, false);
});

test('a validated authenticated body is atomically moved after the full stream', async () => {
  const destination = new FakeFile('file:///report.pdf', 'report.pdf');
  const partial = new FakeFile('file:///.report.partial', '.report.partial');
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const result = await authenticatedDownloadToFile({
    url: 'https://api.example.test/report',
    token: 'token',
    destination,
    createPartialFile: () => partial,
    fetcher: async () => response(body),
    expectedContentType: 'application/pdf',
  });
  assert.equal(result, destination);
  assert.equal(partial.exists, false);
  assert.equal(destination.exists, true);
  assert.equal(destination.size, 3);
});

test('an existing destination is preserved without creating or streaming a partial', async () => {
  const destination = new FakeFile('file:///prior-report.pdf', 'prior-report.pdf');
  destination.exists = true;
  destination.size = 17;
  let fetched = false;
  let partialCreated = false;
  await assert.rejects(authenticatedDownloadToFile({
    url: 'https://api.example.test/report',
    token: 'token',
    destination,
    createPartialFile: () => {
      partialCreated = true;
      return new FakeFile('file:///.report.partial', '.report.partial');
    },
    fetcher: async () => {
      fetched = true;
      return response(new ReadableStream<Uint8Array<ArrayBuffer>>());
    },
    expectedContentType: 'application/pdf',
  }), /destination already exists/);
  assert.equal(fetched, false);
  assert.equal(partialCreated, false);
  assert.equal(destination.exists, true);
  assert.equal(destination.size, 17);
});

test('a late destination collision preserves the prior file and cleans the streamed partial', async () => {
  const destination = new FakeFile('file:///prior-report.pdf', 'prior-report.pdf');
  const partial = new FakeFile('file:///.report.partial', '.report.partial');
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  await assert.rejects(authenticatedDownloadToFile({
    url: 'https://api.example.test/report',
    token: 'token',
    destination,
    createPartialFile: () => partial,
    fetcher: async () => {
      destination.exists = true;
      destination.size = 17;
      return response(body);
    },
    expectedContentType: 'application/pdf',
  }), /destination already exists/);
  assert.equal(partial.exists, false);
  assert.equal(destination.exists, true);
  assert.equal(destination.size, 17);
});
