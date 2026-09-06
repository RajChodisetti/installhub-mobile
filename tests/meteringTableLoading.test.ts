import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const screen = ts.createSourceFile('MeteringTableScreen.tsx', readFileSync(new URL('../src/screens/MeteringTableScreen.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.Node | undefined;
function find(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(screen) === 'useEffect' && node.arguments[0]?.getText(screen).includes('canonicalInstallationRepo.allAssetMetering')) effect = node.arguments[0];
  ts.forEachChild(node, find);
}
find(screen);
assert.ok(effect);
const code = ts.transpileModule(`const load = ${effect.getText(screen)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function harness() {
  const state: Record<string, unknown> = {};
  const scope: Record<string, unknown> = {
    item: { id: 'i' }, installationId: 'i',
    canonicalInstallationRepo: { allAssetMetering: async () => [{ id: 'asset' }], meteringInventory: async () => ({ meters: 1 }), validationIssues: async () => [{ code: 'OPTIONAL' }] },
  };
  for (const name of ['TableLoading', 'TableError', 'Snapshot']) scope[`set${name}`] = (value: unknown) => { state[name] = value; };
  return { state, scope, start: () => new Function(...Object.keys(scope), `${code} return load;`)(...Object.values(scope))() as (() => void) | undefined };
}

test('derived table failure stops loading and reports an actionable error without replacing retained rows', async () => {
  const h = harness(); h.start(); await settle();
  const prior = h.state.Snapshot;
  h.scope.canonicalInstallationRepo = { allAssetMetering: async () => { throw new Error('Storage unavailable'); }, meteringInventory: async () => ({}), validationIssues: async () => [] };
  h.start(); await settle();
  assert.equal(h.state.TableLoading, false);
  assert.equal(h.state.TableError, 'Storage unavailable');
  assert.equal(h.state.Snapshot, prior);
});

test('retry replaces the full derived snapshot only after all reads succeed', async () => {
  const h = harness();
  h.scope.canonicalInstallationRepo = { allAssetMetering: async () => [], meteringInventory: async () => ({}), validationIssues: async () => { throw new Error('Diagnostics failed'); } };
  h.start(); await settle(); assert.equal(h.state.Snapshot, undefined);
  h.scope.canonicalInstallationRepo = { allAssetMetering: async () => [{ id: 'restored' }], meteringInventory: async () => ({ meters: 2 }), validationIssues: async () => [] };
  h.start(); await settle();
  assert.equal(h.state.TableError, null);
  assert.deepEqual(h.state.Snapshot, { installationId: 'i', rows: [{ id: 'restored' }], inventory: { meters: 2 }, diagnostics: [] });
});

test('stale or unmounted derivations cannot publish rows, errors or loading state', async () => {
  for (const reject of [false, true]) {
    const h = harness(); const pending = deferred<unknown[]>();
    h.scope.canonicalInstallationRepo = { allAssetMetering: () => pending.promise, meteringInventory: async () => ({}), validationIssues: async () => [] };
    h.start()?.(); h.state.TableLoading = 'new request'; h.state.TableError = 'new error';
    if (reject) pending.reject(new Error('Old failure')); else pending.resolve([{ id: 'old' }]);
    await settle();
    assert.equal(h.state.Snapshot, undefined);
    assert.equal(h.state.TableLoading, 'new request');
    assert.equal(h.state.TableError, 'new error');
  }
});

test('missing and foreign installation records never dispatch derived reads', () => {
  for (const item of [null, { id: 'other' }]) { const h = harness(); h.scope.item = item; h.start(); assert.deepEqual(h.state, {}); }
});
