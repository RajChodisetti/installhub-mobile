import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORE_MANIFEST_KEY,
  STORE_RECOVERY_KEY,
  commitStoreDocument,
  createStoreManifest,
  joinAndVerifyStoreDocument,
  parseStoreManifest,
  recoveryHasExpired,
  recoveryEnvelopeMatches,
  recoveryShouldCleanupAfterReload,
  removeRecoveryEnvelopeIfCurrent,
  replacedRecoveryKey,
  runStorePersistenceLifecycle,
  storeChunkKeys,
  type StoreRecoveryEnvelope,
  type StoreCommitBoundary,
  type StorePersistenceAdapter,
  commitStoreDocumentWithinLifecycle,
} from '../src/data/storePersistence';

const recovery = (keyName: string): StoreRecoveryEnvelope => ({
  version: 1,
  algorithm: 'AES-256-GCM',
  keyName,
  sourceKey: 'installhub.mobile.store.v2',
  sourceSchemaVersion: 2,
  combinedBase64: 'authenticated-ciphertext',
  checksum: 'checksum',
  createdAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-08-08T00:00:00.000Z',
});

test('v3 generation manifests split and verify a store without a giant AsyncStorage item', () => {
  const document = JSON.stringify({ schemaVersion: 3, value: 'abcdefghij' });
  const result = createStoreManifest({
    document,
    generation: 'generation-1',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T00:00:00.000Z',
    chunkCharacters: 5,
  });
  const parsed = parseStoreManifest(JSON.stringify(result.manifest));
  assert.ok(parsed.chunkCount > 1);
  assert.equal(joinAndVerifyStoreDocument(parsed, result.entries), document);
  assert.deepEqual(storeChunkKeys(parsed), result.entries.map(([key]) => key));
});

test('v3 generation verification rejects missing or changed chunks', () => {
  const document = JSON.stringify({ schemaVersion: 3, important: 'field data' });
  const result = createStoreManifest({
    document,
    generation: 'generation-2',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T00:00:00.000Z',
    chunkCharacters: 8,
  });
  assert.throws(
    () => joinAndVerifyStoreDocument(result.manifest, result.entries.slice(1)),
    /missing/i,
  );
  const changed = result.entries.map((row, index) =>
    index === 0 ? [row[0], `${row[1]}changed`] as [string, string] : row);
  assert.throws(
    () => joinAndVerifyStoreDocument(result.manifest, changed),
    /checksum|validation/i,
  );
});

test('replacing a recovery envelope retires only the superseded SecureStore key', () => {
  assert.equal(replacedRecoveryKey(recovery('old-key'), recovery('new-key')), 'old-key');
  assert.equal(replacedRecoveryKey(recovery('same-key'), recovery('same-key')), null);
  assert.equal(replacedRecoveryKey(null, recovery('new-key')), null);
  assert.equal(
    recoveryHasExpired(recovery('key'), Date.parse('2026-08-07T23:59:59.999Z')),
    false,
  );
  assert.equal(
    recoveryHasExpired(recovery('key'), Date.parse('2026-08-08T00:00:00.000Z')),
    true,
  );
});

class MemoryStorage implements StorePersistenceAdapter {
  readonly rows = new Map<string, string>();
  failMultiSetAfter?: number;

  async getItem(key: string) { return this.rows.get(key) ?? null; }
  async setItem(key: string, value: string) { this.rows.set(key, value); }
  async multiSet(entries: ReadonlyArray<readonly [string, string]>) {
    for (let index = 0; index < entries.length; index += 1) {
      const [key, value] = entries[index]!;
      this.rows.set(key, value);
      if (this.failMultiSetAfter === index + 1) throw new Error('injected multiSet interruption');
    }
  }
  async multiGet(keys: readonly string[]) {
    return keys.map((key) => [key, this.rows.get(key) ?? null] as [string, string | null]);
  }
  async multiRemove(keys: readonly string[]) { keys.forEach((key) => this.rows.delete(key)); }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function seedGeneration(storage: MemoryStorage, generation: string, document: string) {
  const created = createStoreManifest({
    document,
    generation,
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T00:00:00.000Z',
    chunkCharacters: 8,
  });
  created.entries.forEach(([key, value]) => storage.rows.set(key, value));
  storage.rows.set(STORE_MANIFEST_KEY, JSON.stringify(created.manifest));
}

function readActive(storage: MemoryStorage): string {
  const manifest = parseStoreManifest(storage.rows.get(STORE_MANIFEST_KEY)!);
  return joinAndVerifyStoreDocument(
    manifest,
    storeChunkKeys(manifest).map((key) => [key, storage.rows.get(key) ?? null]),
  );
}

test('two-phase generation commit leaves the old or new document readable at every crash boundary', async () => {
  const oldDocument = JSON.stringify({ schemaVersion: 3, generation: 'old', payload: 'durable' });
  const newDocument = JSON.stringify({ schemaVersion: 3, generation: 'new', payload: 'replacement' });
  const boundaries: StoreCommitBoundary[] = [
    'CHUNKS_WRITTEN',
    'CHUNKS_VERIFIED',
    'RECOVERY_WRITTEN',
    'MANIFEST_FLIPPED',
    'MANIFEST_VERIFIED',
  ];
  for (const boundary of boundaries) {
    const storage = new MemoryStorage();
    seedGeneration(storage, 'old-generation', oldDocument);
    await assert.rejects(
      commitStoreDocument({
        storage,
        document: newDocument,
        generation: `new-${boundary}`,
        storeSchemaVersion: 3,
        writtenAt: '2026-08-01T01:00:00.000Z',
        recoveryEnvelope: recovery('new-recovery-key'),
        cleanupRecoveryAfterReload: true,
        onBoundary: (reached) => {
          if (reached === boundary) throw new Error(`app killed at ${boundary}`);
        },
      }),
    );
    assert.equal(
      readActive(storage),
      boundary === 'MANIFEST_FLIPPED' || boundary === 'MANIFEST_VERIFIED'
        ? newDocument
        : oldDocument,
    );
  }
});

test('partial chunk multiSet cannot replace the prior valid manifest', async () => {
  const storage = new MemoryStorage();
  const oldDocument = JSON.stringify({ schemaVersion: 3, generation: 'old' });
  seedGeneration(storage, 'old-generation', oldDocument);
  storage.failMultiSetAfter = 1;
  await assert.rejects(commitStoreDocument({
    storage,
    document: JSON.stringify({ schemaVersion: 3, generation: 'new', value: 'x'.repeat(500_000) }),
    generation: 'new-generation',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T01:00:00.000Z',
  }));
  assert.equal(readActive(storage), oldDocument);
});

test('migration recovery cleanup accepts only the exact migration generation reload', async () => {
  const storage = new MemoryStorage();
  const document = JSON.stringify({ schemaVersion: 3, generation: 'new' });
  seedGeneration(storage, 'old-generation', JSON.stringify({ schemaVersion: 3, generation: 'old' }));
  storage.rows.set(STORE_RECOVERY_KEY, JSON.stringify(recovery('old-key')));
  const committed = await commitStoreDocument({
    storage,
    document,
    generation: 'migration-generation',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T01:00:00.000Z',
    recoveryEnvelope: recovery('new-key'),
    cleanupRecoveryAfterReload: true,
  });
  assert.deepEqual(committed.recoveryEnvelope?.supersededKeyNames, ['old-key']);
  assert.equal(committed.recoveryEnvelope?.supersededKeyNames?.includes('unrelated-key'), false);
  assert.equal(
    recoveryShouldCleanupAfterReload(committed.recoveryEnvelope!, committed.manifest),
    true,
  );
  assert.equal(
    recoveryShouldCleanupAfterReload(committed.recoveryEnvelope!, {
      ...committed.manifest,
      generation: 'different-generation',
    }),
    false,
  );
});

test('overlapping commits are invocation-ordered and cannot expose or clean another writer generation', async () => {
  const storage = new MemoryStorage();
  const firstReachedChunks = deferred();
  const releaseFirst = deferred();
  const boundaries: string[] = [];
  const firstDocument = JSON.stringify({ schemaVersion: 3, writer: 'first' });
  const secondDocument = JSON.stringify({ schemaVersion: 3, writer: 'second' });

  const first = commitStoreDocument({
    storage,
    document: firstDocument,
    generation: 'concurrent-first',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T01:00:00.000Z',
    onBoundary: async (boundary) => {
      boundaries.push(`first:${boundary}`);
      if (boundary === 'CHUNKS_WRITTEN') {
        firstReachedChunks.resolve();
        await releaseFirst.promise;
      }
    },
  });
  await firstReachedChunks.promise;
  const second = commitStoreDocument({
    storage,
    document: secondDocument,
    generation: 'concurrent-second',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T01:00:01.000Z',
    onBoundary: (boundary) => { boundaries.push(`second:${boundary}`); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    [...storage.rows.keys()].some((key) => key.includes('concurrent-second')),
    false,
    'the second writer must not stage chunks while the first writer owns the manifest protocol',
  );

  releaseFirst.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(readActive(storage), secondDocument);
  assert.equal(
    boundaries.findIndex((item) => item.startsWith('second:')) >
      boundaries.findLastIndex((item) => item.startsWith('first:')),
    true,
  );
  assert.equal(
    storeChunkKeys(firstResult.manifest).some((key) => storage.rows.has(key)),
    false,
  );
  assert.equal(
    storeChunkKeys(secondResult.manifest).every((key) => storage.rows.has(key)),
    true,
  );
});

test('a failed queued commit releases the next manifest writer without reordering it', async () => {
  const storage = new MemoryStorage();
  const first = commitStoreDocument({
    storage,
    document: JSON.stringify({ schemaVersion: 3, writer: 'failed' }),
    generation: 'queued-failure',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T01:00:00.000Z',
    onBoundary: (boundary) => {
      if (boundary === 'CHUNKS_VERIFIED') throw new Error('injected queued failure');
    },
  });
  const finalDocument = JSON.stringify({ schemaVersion: 3, writer: 'recovery' });
  const second = commitStoreDocument({
    storage,
    document: finalDocument,
    generation: 'queued-recovery',
    storeSchemaVersion: 3,
    writtenAt: '2026-08-01T01:00:01.000Z',
  });
  await assert.rejects(first, /injected queued failure/);
  await second;
  assert.equal(readActive(storage), finalDocument);
});

test('concurrent init, update, reset, and recovery lifecycles are fully exclusive and invocation ordered', async () => {
  const storage = new MemoryStorage();
  const initReachedChunks = deferred();
  const releaseInit = deferred();
  const events: string[] = [];
  const lifecycle = (
    name: 'init' | 'update' | 'reset' | 'recover',
    document: string,
    block = false,
  ) => runStorePersistenceLifecycle(storage, async () => {
    events.push(`${name}:start`);
    const committed = await commitStoreDocumentWithinLifecycle({
      storage,
      document,
      generation: `lifecycle-${name}`,
      storeSchemaVersion: 3,
      writtenAt: '2026-08-01T02:00:00.000Z',
      onBoundary: async (boundary) => {
        if (block && boundary === 'CHUNKS_WRITTEN') {
          initReachedChunks.resolve();
          await releaseInit.promise;
        }
      },
    });
    events.push(`${name}:end`);
    return committed;
  });

  const init = lifecycle('init', JSON.stringify({ schemaVersion: 3, value: 'init' }), true);
  await initReachedChunks.promise;
  const update = lifecycle('update', JSON.stringify({ schemaVersion: 3, value: 'updated' }));
  const reset = lifecycle('reset', JSON.stringify({ schemaVersion: 3, value: 'reset' }));
  const recover = lifecycle('recover', JSON.stringify({ schemaVersion: 3, value: 'recovered' }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['init:start']);
  releaseInit.resolve();
  await Promise.all([init, update, reset, recover]);
  assert.deepEqual(events, [
    'init:start', 'init:end', 'update:start', 'update:end',
    'reset:start', 'reset:end', 'recover:start', 'recover:end',
  ]);
  assert.equal(readActive(storage), JSON.stringify({ schemaVersion: 3, value: 'recovered' }));
});

test('an older recovery cleanup token cannot match or remove a newer envelope', async () => {
  const storage = new MemoryStorage();
  const oldEnvelope = recovery('old-key');
  const newerEnvelope = { ...recovery('new-key'), checksum: 'new-checksum' };
  storage.rows.set(STORE_RECOVERY_KEY, JSON.stringify(newerEnvelope));
  const deletedKeys: string[] = [];
  assert.equal(recoveryEnvelopeMatches(newerEnvelope, oldEnvelope), false);
  assert.equal(recoveryEnvelopeMatches(newerEnvelope, newerEnvelope), true);
  assert.equal(
    recoveryEnvelopeMatches({ ...newerEnvelope, checksum: oldEnvelope.checksum }, newerEnvelope),
    false,
  );
  assert.equal(await removeRecoveryEnvelopeIfCurrent({
    storage,
    expected: oldEnvelope,
    deleteKey: async (keyName) => { deletedKeys.push(keyName); },
  }), false);
  assert.equal(deletedKeys.length, 0);
  assert.deepEqual(
    JSON.parse(storage.rows.get(STORE_RECOVERY_KEY)!),
    newerEnvelope,
  );
  assert.equal(await removeRecoveryEnvelopeIfCurrent({
    storage,
    expected: newerEnvelope,
    deleteKey: async (keyName) => { deletedKeys.push(keyName); },
  }), true);
  assert.deepEqual(deletedKeys, ['new-key']);
  assert.equal(storage.rows.has(STORE_RECOVERY_KEY), false);
});
