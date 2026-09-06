import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadInventoryView } from '../src/domain/supportCloudReads';

const code = ts.transpileModule(readFileSync(new URL('../src/hooks/useInventoryData.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const same = (a: unknown[] | undefined, b: unknown[]) => Boolean(a && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
type Authority = { actor: string; generation: number };
type Read = { method: 'access' | 'inventory' | 'directory'; authority: Authority; scope?: string; query?: string };

/** The production hook AND inventory view loader run here. Only hook scheduling,
 * auth capture and external I/O are controlled; real access/directory rules,
 * view tokens, reload and action fences determine every result. */
function harness() {
  const slots: any[] = []; let cursor = 0; let dirty = false; let focused = true;
  let user = { id: 'admin-a', role: 'admin' }; let generation = 1; let scope: 'mine' | 'company' = 'company'; let search = 'alpha';
  let result: any; let captureWait: Promise<void> | undefined;
  const reads: Read[] = []; const captures: any[] = [];
  let access = async (authority: Authority): Promise<any> => ({ userId: authority.actor, isMaintainer: true });
  let inventory = async (_scope: string, query: string | undefined, authority: Authority): Promise<any> => ({
    data: [{ id: `${authority.actor}:${query || 'all'}`, serial: query || 'all' }], total: query ? 2 : 9, truncated: false,
  });
  let directory = async (authority: Authority): Promise<any> => ({ data: [
    { id: `${authority.actor}:active`, isActive: true }, { id: `${authority.actor}:inactive`, isActive: false },
  ] });
  const react = {
    useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; dirty = true; }]; },
    useRef: (initial: any) => { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback: (fn: unknown, deps: unknown[]) => { const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn; },
  };
  const modules: Record<string, any> = {
    react,
    '@react-navigation/native': { useFocusEffect: (fn: () => () => void) => { const index = cursor++; const prior = slots[index];
      if (!prior || prior.fn !== fn) slots[index] = { effect: true, fn, cleanup: prior?.cleanup, pending: true }; } },
    '../context/AppProviders': { useAuth: () => ({ user }) },
    '../domain/supportCloudReads': { loadInventoryView },
    '../api/apiClient': {
      cloudConnectionErrorMessage: (error: Error) => error.message,
      apiClient: {
        getInventoryAccess: (authority: Authority) => { reads.push({ method: 'access', authority }); return access(authority); },
        listInventoryMeters: (nextScope: string, query: string | undefined, authority: Authority) => {
          reads.push({ method: 'inventory', authority, scope: nextScope, query }); return inventory(nextScope, query, authority);
        },
        listUsers: (authority: Authority) => { reads.push({ method: 'directory', authority }); return directory(authority); },
      },
    },
    '../services/authenticatedCloudAction': { captureAuthenticatedCloudActionLease: async () => {
      const principal = user; const capturedGeneration = generation; const authority = { actor: user.id, generation };
      const lease = { actorUserId: principal.id, cloudAuthority: authority, processAuthority: {}, assertCurrent: () => {
        if (principal !== user || capturedGeneration !== generation) throw new Error('Account/session changed');
      } };
      captures.push(lease); if (captureWait) await captureWait; lease.assertCurrent(); return lease;
    } },
  };
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; }, exports);
  const render = () => {
    for (let iteration = 0; iteration < 20; iteration++) {
      dirty = false; cursor = 0; result = exports.useInventoryData(scope, search);
      if (focused) for (const effect of slots.filter((slot) => slot?.effect && slot.pending)) {
        effect.cleanup?.(); effect.cleanup = effect.fn(); effect.pending = false;
      }
      if (!dirty) return result;
    }
    throw new Error('Inventory hook did not settle');
  };
  const blur = () => { focused = false; for (const effect of slots.filter((slot) => slot?.effect)) {
    effect.cleanup?.(); effect.cleanup = undefined; effect.pending = true;
  } return render(); };
  return {
    render, current: () => result, reads, captures, blur,
    flush: async () => { await settle(); return render(); },
    focus: () => { focused = true; return render(); },
    query: (next: string, nextScope: 'mine' | 'company' = scope) => { search = next; scope = nextScope; return render(); },
    actor: (id: string, role = 'admin') => { generation++; user = { id, role }; return render(); },
    relogin: () => { generation++; user = { ...user }; return render(); },
    expireLease: () => { generation++; return render(); },
    captureWait: (wait?: Promise<void>) => { captureWait = wait; },
    access: (handler: typeof access) => { access = handler; }, inventory: (handler: typeof inventory) => { inventory = handler; },
    directory: (handler: typeof directory) => { directory = handler; },
  };
}

test('access, filtered rows, unfiltered counts and directory use one bound authority', async () => {
  const h = harness(); h.render(); const state = await h.flush();
  assert.equal(state.data.inventory.total, 2); assert.equal(state.data.summary.total, 9);
  assert.deepEqual(state.data.users.map((user: any) => user.id), ['admin-a:active']);
  assert.equal(h.captures.length, 1); assert.equal(h.reads.length, 4);
  assert.ok(h.reads.every((read) => read.authority === h.captures[0].cloudAuthority));
  assert.deepEqual(h.reads.filter((read) => read.method === 'inventory').map((read) => [read.scope, read.query]), [['company', 'alpha'], ['company', undefined]]);
});

test('same-role actor replacement hides the previous rows/counts/directory even when the new listing fails', async () => {
  const h = harness(); h.render(); await h.flush(); const previous = h.current();
  h.inventory(async () => { throw new Error('New account listing unavailable'); });
  assert.equal(h.actor('admin-b').data, undefined);
  const state = await h.flush(); assert.equal(state.data, undefined); assert.equal(state.loading, false);
  assert.equal(state.error, 'New account listing unavailable');
  let mutations = 0; await previous.run(async () => { mutations++; }); assert.equal(mutations, 0);
});

test('query/scope changes hide old matches and counts immediately and keep them hidden after failure', async () => {
  for (const nextScope of ['mine', 'company'] as const) {
    const h = harness(); h.render(); await h.flush(); const previous = h.current();
    h.inventory(async () => { throw new Error('Query unavailable'); });
    assert.equal(h.query('new query', nextScope).data, undefined);
    const state = await h.flush(); assert.equal(state.data, undefined); assert.equal(state.error, 'Query unavailable');
    const before = h.reads.length; await previous.load(); assert.equal(h.reads.length, before);
    let mutations = 0; await previous.run(async () => { mutations++; }); assert.equal(mutations, 0);
  }
});

test('foreign access userId fails before any meter or directory request', async () => {
  const h = harness(); h.access(async () => ({ userId: 'foreign', isMaintainer: true })); h.render();
  const state = await h.flush(); assert.match(state.error, /another account/); assert.equal(state.data, undefined);
  assert.deepEqual(h.reads.map((read) => read.method), ['access']);
});

test('late old access response cannot launch listings after the view changes', async () => {
  const h = harness(); const pending = deferred<any>(); let first = true;
  h.access(async (authority) => { if (first) { first = false; return pending.promise; } return { userId: authority.actor, isMaintainer: true }; });
  h.render(); await settle(); h.query('new'); await h.flush();
  const before = h.reads.length; pending.resolve({ userId: 'admin-a', isMaintainer: true });
  const state = await h.flush(); assert.equal(h.reads.length, before);
  assert.equal(state.data.inventory.data[0].id, 'admin-a:new');
});

for (const fail of [false, true]) {
  test(`blur blocks late inventory ${fail ? 'failure' : 'result'} and retained scanner/editor callbacks`, async () => {
    const h = harness(); h.render(); await h.flush(); const held = h.current(); const pending = deferred<any>();
    h.inventory(async () => pending.promise); const loading = held.load(); await settle(); h.blur();
    let mutations = 0; await held.run(async () => { mutations++; }); assert.equal(mutations, 0);
    if (fail) pending.reject(new Error('Old read failed')); else pending.resolve({ data: [{ id: 'old' }], total: 88, truncated: false });
    await loading; const hidden = h.render(); assert.equal(hidden.data, undefined); assert.equal(hidden.error, undefined);
    h.inventory(async (_scope, query) => ({ data: [{ id: query }], total: 3, truncated: false }));
    h.focus(); const current = await h.flush(); assert.equal(current.data.inventory.total, 3); assert.equal(current.error, undefined);
    await held.run(async () => { mutations++; }); assert.equal(mutations, 0);
  });
}

test('late directory data from the old view cannot replace the new view or leak old users', async () => {
  const h = harness(); const pending = deferred<any>(); let first = true;
  h.directory(async (authority) => { if (first) { first = false; return pending.promise; } return { data: [{ id: authority.actor, isActive: true }] }; });
  h.render(); await settle(); h.actor('admin-b'); await h.flush();
  pending.resolve({ data: [{ id: 'old-private-user', isActive: true }] });
  const state = await h.flush(); assert.deepEqual(state.data.users.map((user: any) => user.id), ['admin-b']);
  assert.equal(state.data.inventory.data[0].id, 'admin-b:alpha');
});

test('maintainer inspector uses company inventory without requesting an admin directory', async () => {
  const h = harness(); h.actor('inspector', 'inspector'); const state = await h.flush();
  assert.equal(state.data.scope, 'company'); assert.equal(h.reads.some((read) => read.method === 'directory'), false);
  assert.deepEqual(state.data.users, []);
});

test('non-maintainer company view is read through mine scope under the same authority', async () => {
  const h = harness(); h.access(async (authority) => ({ userId: authority.actor, isMaintainer: false })); h.render();
  const state = await h.flush(); assert.equal(state.data.scope, 'mine');
  assert.ok(h.reads.filter((read) => read.method === 'inventory').every((read) => read.scope === 'mine'));
  assert.equal(h.reads.some((read) => read.method === 'directory'), false);
});

for (const change of ['query', 'actor', 'relogin', 'blur'] as const) {
  test(`a held scanner/editor action cannot commit or call success after ${change}`, async () => {
    const h = harness(); h.render(); await h.flush(); const wait = deferred<void>(); let dispatched = 0; let succeeded = 0;
    const run = h.current().run(async (lease: any) => { await wait.promise; lease.assertCurrent(); dispatched++; }, () => { succeeded++; });
    await settle();
    if (change === 'query') h.query('later');
    if (change === 'actor') h.actor('admin-b');
    if (change === 'relogin') h.relogin();
    if (change === 'blur') h.blur();
    wait.resolve(); await run; await h.flush();
    assert.equal(dispatched, 0); assert.equal(succeeded, 0);
  });
}

test('same-actor credential replacement invalidates captured actions and hides the previous snapshot', async () => {
  const h = harness(); h.render(); await h.flush(); const previous = h.current();
  h.expireLease(); assert.equal(h.current().data, undefined);
  let dispatches = 0; await previous.run(async () => { dispatches++; });
  assert.equal(dispatches, 0); assert.equal(h.render().data, undefined);
});

test('account replacement during lease capture prevents all endpoint calls', async () => {
  const h = harness(); const pending = deferred<void>(); h.captureWait(pending.promise); h.render();
  h.blur(); h.actor('admin-b'); pending.resolve(); await h.flush(); assert.equal(h.reads.length, 0);
});

test('current mutation suppresses duplicates, reloads rows/counts/directory with its same lease, then calls success', async () => {
  const h = harness(); h.render(); await h.flush(); const initial = h.current(); const pending = deferred<void>();
  let mutationLease: any; let success = 0; let duplicates = 0;
  const run = initial.run(async (lease: any, view: any) => {
    mutationLease = lease; assert.equal(view.access.userId, lease.actorUserId); await pending.promise; lease.assertCurrent(); return 'saved';
  }, (result: string) => { assert.equal(result, 'saved'); success++; });
  await initial.run(async () => { duplicates++; }); assert.equal(h.render().busy, true);
  h.inventory(async (_scope, query) => ({ data: [{ id: 'after-mutation' }], total: query ? 4 : 12, truncated: false }));
  pending.resolve(); await run; const state = h.render();
  assert.equal(success, 1); assert.equal(duplicates, 0); assert.equal(state.busy, false);
  assert.equal(state.data.inventory.total, 4); assert.equal(state.data.summary.total, 12);
  assert.equal(h.captures.length, 1, 'Mutation reload must retain its initial bound lease');
  assert.ok(h.reads.every((read) => read.authority === mutationLease.cloudAuthority));
});

test('failed same-view refresh hides previous matches/counts and exposes a retryable error', async () => {
  const h = harness(); h.render(); await h.flush(); const before = h.current();
  h.inventory(async () => { throw new Error('Refresh failed'); }); await before.load();
  assert.equal(h.render().data, undefined); assert.equal(h.current().error, 'Refresh failed');
  h.inventory(async () => ({ data: [{ id: 'recovered' }], total: 1, truncated: false })); await h.current().load();
  assert.equal(h.render().data.inventory.data[0].id, 'recovered'); assert.equal(h.current().error, undefined);
});
