import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  authenticatedDownloadToFile,
  type AtomicDownloadFile,
  type AuthenticatedFetch,
  type DownloadResponseLike,
} from '../src/services/authenticatedDownloadCore';

class FakeFile implements AtomicDownloadFile {
  exists = false;
  size = 0;
  bytes: number[] = [];

  constructor(readonly uri: string, readonly name: string) {}

  create() { this.exists = true; this.size = 0; this.bytes = []; }
  delete() { this.exists = false; this.size = 0; this.bytes = []; }
  info() { return { size: this.size }; }
  writableStream() {
    return new WritableStream<Uint8Array<ArrayBufferLike>>({
      write: (chunk) => { this.size += chunk.byteLength; this.bytes.push(...chunk); },
    });
  }
  async move(destination: AtomicDownloadFile) {
    const target = destination as FakeFile;
    if (target.exists) throw new Error('destination already exists');
    target.exists = true;
    target.size = this.size;
    target.bytes = [...this.bytes];
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

function bytesBody(bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); },
  });
}

function downloadFixture(patch: Partial<DownloadResponseLike> = {}, partial = new FakeFile('file:///.download.partial', '.download.partial')) {
  const destination = new FakeFile('file:///download.pdf', 'download.pdf');
  return {
    destination, partial,
    run: () => authenticatedDownloadToFile({
      url: 'https://api.example.test/download', token: 'synthetic-token', destination,
      createPartialFile: () => partial,
      fetcher: async () => ({ ...response(bytesBody()), ...patch }), expectedContentType: 'application/pdf',
    }),
  };
}

for (const encoding of [undefined, 'identity']) test(`a truncated ${encoding ?? 'unencoded'} response still fails its declared length`, async () => {
  const fixture = downloadFixture({ headers: headers({
    'content-type': 'application/pdf', 'content-length': '8', ...(encoding ? { 'content-encoding': encoding } : {}),
  }) });
  await assert.rejects(fixture.run(), /content length did not match/);
  assert.equal(fixture.partial.exists, false);
  assert.equal(fixture.destination.exists, false);
});

for (const length of ['', '0', '-1', '3.0', '3e0', '0x3', 'NaN', '9007199254740992', '3, 3']) test(`encoded downloads reject invalid Content-Length ${JSON.stringify(length)}`, async () => {
  const fixture = downloadFixture({ headers: headers({
    'content-type': 'application/pdf', 'content-encoding': 'gzip', 'content-length': length,
  }) });
  await assert.rejects(fixture.run(), /invalid content length/);
  assert.equal(fixture.partial.exists, false);
  assert.equal(fixture.destination.exists, false);
});

for (const encoding of ['', 'unknown', 'gzip, unknown', 'gzip, br']) test(`unsupported content encoding ${JSON.stringify(encoding)} never publishes encoded bytes`, async () => {
  const fixture = downloadFixture({ headers: headers({
    'content-type': 'application/pdf', 'content-encoding': encoding, 'content-length': '3',
  }) });
  await assert.rejects(fixture.run(), /unsupported content encoding/);
  assert.equal(fixture.partial.exists, false);
  assert.equal(fixture.destination.exists, false);
});

test('chunked response without Content-Length preserves every byte', async () => {
  const fixture = downloadFixture({ headers: headers({ 'content-type': 'application/pdf' }) });
  await fixture.run();
  assert.deepEqual(fixture.destination.bytes, [1, 2, 3]);
});

test('compressed response with a silently short file write fails the independent decoded-byte count', async () => {
  const partial = new FakeFile('file:///.short.partial', '.short.partial');
  partial.info = () => ({ size: partial.size - 1 });
  const fixture = downloadFixture({ headers: headers({
    'content-type': 'application/pdf', 'content-encoding': 'gzip', 'content-length': '2',
  }) }, partial);
  await assert.rejects(fixture.run(), /file size did not match the streamed bytes/);
  assert.equal(partial.exists, false);
  assert.equal(fixture.destination.exists, false);
});

test('a writer close error removes the partial even after all bytes arrived', async () => {
  const partial = new FakeFile('file:///.close.partial', '.close.partial');
  partial.writableStream = () => new WritableStream({
    write: (chunk: Uint8Array) => { partial.size += chunk.byteLength; },
    close: () => { throw new Error('disk close failed'); },
  });
  const fixture = downloadFixture({}, partial);
  await assert.rejects(fixture.run(), /disk close failed/);
  assert.equal(partial.exists, false);
  assert.equal(fixture.destination.exists, false);
});

for (const patch of [
  { status: 206 },
  { headers: headers({ 'content-type': 'application/pdf', 'content-range': 'bytes 0-2/8' }) },
  { ok: false, status: 403 },
  { body: null },
  { headers: headers({ 'content-type': 'text/html' }) },
  { headers: headers({}) },
  { body: bytesBody(new Uint8Array()), headers: headers({ 'content-type': 'application/pdf', 'content-encoding': 'gzip' }) },
] as Partial<DownloadResponseLike>[]) test(`invalid or partial downloads stay unpublished (${JSON.stringify({ ...patch, headers: patch.headers?.get('content-type'), body: patch.body === null ? null : undefined })})`, async () => {
  const fixture = downloadFixture(patch);
  await assert.rejects(fixture.run());
  assert.equal(fixture.partial.exists, false);
  assert.equal(fixture.destination.exists, false);
});

for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const) {
  test(`real fetch ${encoding} CSV saves decoded UTF-8 bytes despite compressed Content-Length`, async () => {
    const plain = Buffer.from('Description,Amount\r\n"Synthetic café, test",$1.00\r\n'.repeat(80));
    const encoded = compress(plain);
    assert.notEqual(encoded.length, plain.length);
    const server = createServer((request, reply) => {
      assert.equal(request.headers.authorization, 'Bearer synthetic-token');
      reply.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Encoding': encoding, 'Content-Length': encoded.length });
      reply.end(encoded);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const destination = new FakeFile('file:///financial-summary.csv', 'financial-summary.csv');
    const partial = new FakeFile('file:///.csv.partial', '.csv.partial');
    try {
      await authenticatedDownloadToFile({
        url: `http://127.0.0.1:${address.port}/synthetic.csv`, token: 'synthetic-token', destination,
        createPartialFile: () => partial, expectedContentType: 'text/csv',
        fetcher: async (url, init) => {
          const result = await fetch(url, init);
          assert.equal(result.headers.get('content-length'), String(encoded.length));
          return result;
        },
      });
      assert.deepEqual(Buffer.from(destination.bytes), plain);
      assert.equal(partial.exists, false);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
}

test('real fetch rejects corrupted gzip and removes the partial', async () => {
  const encoded = gzipSync(Buffer.from('Synthetic CSV payload\n'.repeat(200)));
  encoded[encoded.length - 8] ^= 0xff; // Corrupt the gzip CRC while preserving complete HTTP framing.
  const server = createServer((_request, reply) => {
    reply.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Encoding': 'gzip', 'Content-Length': encoded.length });
    reply.end(encoded);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const destination = new FakeFile('file:///corrupt.csv', 'corrupt.csv');
  const partial = new FakeFile('file:///.corrupt.partial', '.corrupt.partial');
  try {
    await assert.rejects(authenticatedDownloadToFile({
      url: `http://127.0.0.1:${address.port}/synthetic.csv`, token: 'synthetic-token', destination,
      createPartialFile: () => partial, expectedContentType: 'text/csv', fetcher: fetch,
    }));
    assert.equal(destination.exists, false);
    assert.equal(partial.exists, false);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('real fetch rejects truncated compressed HTTP framing and removes the partial', async () => {
  const encoded = gzipSync(Buffer.from('Synthetic CSV payload\n'.repeat(200)));
  const server = createServer((_request, reply) => {
    reply.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Encoding': 'gzip', 'Content-Length': encoded.length, Connection: 'close' });
    reply.end(encoded.subarray(0, encoded.length - 4));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const destination = new FakeFile('file:///truncated.csv', 'truncated.csv');
  const partial = new FakeFile('file:///.truncated.partial', '.truncated.partial');
  try {
    await assert.rejects(authenticatedDownloadToFile({
      url: `http://127.0.0.1:${address.port}/synthetic.csv`, token: 'synthetic-token', destination,
      createPartialFile: () => partial, expectedContentType: 'text/csv', fetcher: fetch,
    }));
    assert.equal(destination.exists, false);
    assert.equal(partial.exists, false);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('production downloader runs with the installed Expo native stream globals', async () => {
  const require = createRequire(import.meta.url);
  const runtime: Record<string, any> = { exports: {}, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, queueMicrotask };
  runInNewContext(readFileSync(require.resolve('expo/virtual/streams.js'), 'utf8'), runtime);
  assert.equal(typeof runtime.TransformStream, 'function');
  const source = readFileSync(new URL('../src/services/authenticatedDownloadCore.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, runtime);
  const destination = new FakeFile('file:///expo.csv', 'expo.csv');
  const partial = new FakeFile('file:///.expo.partial', '.expo.partial');
  partial.writableStream = () => new runtime.WritableStream({
    write(chunk: Uint8Array) { partial.size += chunk.byteLength; partial.bytes.push(...chunk); },
  });
  const body = new runtime.ReadableStream({ start(controller: ReadableStreamDefaultController<Uint8Array>) {
    controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close();
  } });
  await runtime.exports.authenticatedDownloadToFile({
    url: 'https://api.example.test/synthetic.csv', token: 'synthetic-token', destination,
    createPartialFile: () => partial, expectedContentType: 'text/csv',
    fetcher: async () => ({ ...response(body), headers: headers({ 'content-type': 'text/csv', 'content-encoding': 'gzip', 'content-length': '30' }) }),
  });
  assert.deepEqual(destination.bytes, [1, 2, 3, 4]);
  assert.equal(partial.exists, false);
});
