import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runLeasedCloudActionStep } from '../src/services/cloudActionLease';

const code = ts.transpileModule(readFileSync(new URL('../src/hooks/useCommercialData.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const same = (a: unknown[] | undefined, b: unknown[]) => Boolean(a && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));

/** Small hook runtime executes the actual production hook, including memoized
 * callbacks, render-time scope checks and focus cleanup. Network/auth are doubles. */
function harness() {
  const slots: any[] = []; let cursor = 0; let dirty = false; let focused = true;
  let scope = 'installation-a:invoice-a'; let user: any = { id: 'admin-a', role: 'admin' }; let authGeneration = 1;
  let loader: (lease?: any) => Promise<any> = async () => ({ id: 'invoice-a' });
  let captureWait: Promise<void> | undefined; let result: any;
  const reads: any[] = []; const captures: any[] = [];
  const react = {
    useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }]; },
    useRef: (initial: any) => { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useCallback: (fn: unknown, deps: unknown[]) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
  };
  const modules: Record<string, any> = {
    react,
    '@react-navigation/native': { useFocusEffect: (fn: () => () => void) => { const i = cursor++; const prior = slots[i];
      if (!prior || prior.fn !== fn) slots[i] = { focusEffect: true, fn, cleanup: prior?.cleanup, pending: true }; } },
    '../api/apiClient': { cloudConnectionErrorMessage: (error: Error) => error.message },
    '../context/AppProviders': { useAuth: () => ({ user }) },
    '../services/cloudActionLease': { runLeasedCloudActionStep },
    '../services/authenticatedCloudAction': { captureAuthenticatedCloudActionLease: async () => {
      const capturedUser = user; const generation = authGeneration; const authority = {};
      const lease = { actorUserId: capturedUser.id, cloudAuthority: authority, processAuthority: {}, assertCurrent: () => {
        if (user !== capturedUser || generation !== authGeneration) throw new Error('Account/session changed');
      } };
      captures.push(lease); if (captureWait) await captureWait; lease.assertCurrent(); return lease;
    } },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  let wrappedLoader = (lease?: any) => { reads.push(lease); return loader(lease); };
  const render = () => {
    for (let count = 0; count < 20; count++) {
      dirty = false; cursor = 0; result = exports.useCommercialData(wrappedLoader, scope);
      if (focused) for (const effect of slots.filter((s) => s?.focusEffect && s.pending)) {
        effect.cleanup?.(); effect.cleanup = effect.fn(); effect.pending = false;
      }
      if (!dirty) return result;
    }
    throw new Error('Hook render did not settle');
  };
  const blur = () => { focused = false; for (const effect of slots.filter((s) => s?.focusEffect)) {
    effect.cleanup?.(); effect.cleanup = undefined; effect.pending = true;
  } };
  return {
    render, current: () => result, reads, captures,
    flush: async () => { await settle(); return render(); }, blur,
    focus: () => { focused = true; return render(); },
    route: (next: string, nextLoader: typeof loader) => { scope = next; loader = nextLoader;
      wrappedLoader = (lease?: any) => { reads.push(lease); return loader(lease); }; return render(); },
    actor: (id: string, role = 'admin') => { user = { id, role }; authGeneration += 1; return render(); },
    expireSameActor: () => { authGeneration += 1; },
    captureWait: (pending?: Promise<void>) => { captureWait = pending; },
    loader: (next: typeof loader) => { loader = next; },
  };
}

test('every initial read receives the captured authority and retains only its own same-scope refresh data', async () => {
  const h = harness(); h.render(); let state = await h.flush(); assert.equal(state.data.id, 'invoice-a');
  assert.equal(h.reads[0].cloudAuthority, h.captures[0].cloudAuthority);
  h.loader(async () => { throw new Error('Temporary read failure'); }); await state.load(); state = h.render();
  assert.equal(state.data.id, 'invoice-a'); assert.equal(state.error, 'Temporary read failure'); assert.equal(state.loading, false);
});

test('invoice/installation route changes immediately hide retained data even if the new read fails', async () => {
  const h = harness(); h.render(); await h.flush();
  let state = h.route('installation-b:invoice-b', async () => { throw new Error('B unavailable'); });
  assert.equal(state.data, undefined); state = await h.flush();
  assert.equal(state.data, undefined); assert.equal(state.error, 'B unavailable');
});

test('actor or role replacement immediately hides another account data and disables non-admin actions', async () => {
  const h = harness(); h.render(); await h.flush(); const old = h.current();
  const pending = deferred<any>(); h.loader(() => pending.promise);
  assert.equal(h.actor('admin-b').data, undefined);
  let actions = 0; assert.equal(await old.run(async () => { actions++; }), null); assert.equal(actions, 0);
  assert.equal(h.actor('inspector-c', 'inspector').isAdmin, false);
  assert.equal(await h.current().run(async () => { actions++; }), null); assert.equal(actions, 0);
  pending.resolve({ id: 'should-hide' }); assert.equal((await h.flush()).data, undefined);
});

test('read completing after route change or blur cannot publish stale data/errors/loading', async () => {
  for (const fail of [false, true]) {
    const h = harness(); const pending = deferred<any>(); h.loader(() => pending.promise); h.render(); await settle();
    h.blur(); h.route('b', async () => ({ id: 'b' })); h.focus(); await h.flush();
    if (fail) pending.reject(new Error('Old failure')); else pending.resolve({ id: 'old' });
    const state = await h.flush(); assert.equal(state.data.id, 'b'); assert.equal(state.error, undefined); assert.equal(state.loading, false);
  }
});

test('retained alert/run/error/refresh callbacks cannot revive after blur and refocus', async () => {
  const h = harness(); h.render(); await h.flush(); const old = h.current();
  h.blur(); h.focus(); await h.flush(); const readCount = h.reads.length;
  let actions = 0; assert.equal(await old.run(async () => { actions++; }), null);
  old.setError('stale confirmation'); await old.load();
  assert.equal(actions, 0); assert.equal(h.reads.length, readCount); assert.equal(h.render().error, undefined);
});

test('old record confirmation cannot dispatch against a new record or actor', async () => {
  const h = harness(); h.render(); await h.flush(); const old = h.current();
  h.route('b', async () => ({ id: 'b' })); await h.flush(); h.actor('admin-b'); await h.flush();
  let actions = 0; await old.run(async () => { actions++; }); assert.equal(actions, 0);
});

test('blur during lease capture prevents mutation dispatch', async () => {
  const h = harness(); h.render(); await h.flush(); const wait = deferred<void>(); h.captureWait(wait.promise);
  let actions = 0; const pending = h.current().run(async () => { actions++; }); h.blur(); wait.resolve();
  assert.equal(await pending, null); assert.equal(actions, 0);
});

test('a dispatched action finishing after blur cannot refresh, publish errors or navigate', async () => {
  for (const fail of [false, true]) {
    const h = harness(); h.render(); await h.flush(); const pending = deferred<any>(); let navigation = 0;
    const run = h.current().run(() => pending.promise, () => { navigation++; }); await settle();
    h.blur(); const readCount = h.reads.length;
    if (fail) pending.reject(new Error('Old action error')); else pending.resolve({ id: 'created' });
    assert.equal(await run, null); assert.equal(h.reads.length, readCount); assert.equal(navigation, 0);
    h.focus(); const state = await h.flush(); assert.equal(state.error, undefined); assert.equal(state.busy, false);
  }
});

test('old action cleanup cannot clear a newer scope action busy state', async () => {
  const h = harness(); h.render(); await h.flush(); const oldPending = deferred<any>();
  const oldRun = h.current().run(() => oldPending.promise); await settle();
  h.route('b', async () => ({ id: 'b' })); await h.flush(); const newPending = deferred<any>();
  const newRun = h.current().run(() => newPending.promise); await settle(); h.render();
  oldPending.resolve({}); await oldRun; assert.equal(h.render().busy, true);
  newPending.resolve({}); await newRun; assert.equal(h.render().busy, false);
});

test('current action refresh and success navigation retain the same exact authority; duplicate dispatch is suppressed', async () => {
  const h = harness(); h.render(); await h.flush(); const pending = deferred<any>(); let actionLease: any; let succeeded = 0;
  const state = h.current(); const run = state.run((lease: any) => { actionLease = lease; return pending.promise; }, () => { succeeded++; });
  let duplicate = 0; assert.equal(await state.run(async () => { duplicate++; }), null);
  await settle(); pending.resolve({ id: 'created' }); const value = await run;
  assert.equal(value.id, 'created'); assert.equal(succeeded, 1); assert.equal(duplicate, 0);
  assert.equal(h.reads.at(-1).cloudAuthority, actionLease.cloudAuthority); assert.equal(h.render().busy, false);
});

test('same-account credential replacement rejects pending work and hides its previous snapshot', async () => {
  const h = harness(); h.render(); await h.flush(); const pending = deferred<any>(); let success = 0;
  const run = h.current().run(() => pending.promise, () => { success++; }); await settle();
  h.expireSameActor(); pending.resolve({}); assert.equal(await run, null); assert.equal(success, 0);
  assert.equal(h.render().data, undefined);
});
