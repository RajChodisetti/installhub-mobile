import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createSingleFlightProgressRunner } from '../src/services/singleFlightProgress';
import { captureForegroundRejectedMetadataRetry } from '../src/services/foregroundRejectedMetadataRetry';
import type { AppDataStore } from '../src/types';

const source = readFileSync(new URL('../src/services/SyncStatusContext.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
} }).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
const same = (a: unknown[] | undefined, b: unknown[]) => Boolean(a && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));

/** Production provider and process single-flight runner execute unchanged.
 * Effects are not mounted (no real timer/native app); explicit automatic/manual
 * callbacks, hook refs, auth generations and controlled I/O remain observable. */
function harness() {
  let user: { id: string } | null = { id: 'actor' }; let generation = 1; let cursor = 0; const slots: any[] = [];
  const events: string[] = []; const runs: any[] = []; const descriptors: any[] = [];
  const store = { installations: [{ id: 'job', local_owner_user_id: 'actor', assigned_work_state: 'none', cloud_backup_enabled: true }],
    cloudSync: { rejected_metadata_attempts: { rejected: { id: 'rejected', installation_id: 'job', actor_user_id: 'actor', preserved: 'original' } } },
  } as unknown as AppDataStore;
  let captureError: Error | undefined;
  let runGate: Promise<void> | undefined; let resetGate: Promise<void> | undefined; let cloudGate: Promise<void> | undefined;
  const assigned = () => ({ actor: user?.id, generation });
  const check = (authority: any, actor: string) => {
    if (authority.generation !== generation || authority.actor !== actor || user?.id !== actor) throw new Error('Account or session replaced');
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    useContext: () => { throw new Error('Unexpected nested context call'); },
    useEffect: () => {},
    useRef: (initial: any) => { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useCallback: (fn: unknown, deps: unknown[]) => { const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn; },
  };
  const runCloudBackup = createSingleFlightProgressRunner<any, any, any>(async (emit, authority) => {
    check(authority.assignedWorkAuthority, authority.actorUserId);
    runs.push(authority); events.push(authority.rejectedMetadataRetry ? 'manual-run' : 'automatic-run');
    if (runGate) await runGate;
    check(authority.assignedWorkAuthority, authority.actorUserId);
    await authority.beforeNewBackups?.();
    const result = { phase: 'done', uploaded: 0, total: 0, failedCount: 0 };
    emit(result); return result;
  }, (a, b) => a.identity === b.identity);
  const modules: Record<string, any> = {
    react, 'react-native': { AppState: {} },
    'expo-notifications': {},
    'expo-secure-store': { setItemAsync: async () => { events.push('timestamp'); } },
    '../context/AppProviders': { useAuth: () => ({ user }) },
    '../data/seed': { getStore: () => { events.push('read-store'); return store; }, subscribeStore: () => {} },
    '../api/apiClient': {
      NetworkError: class extends Error {}, cloudConnectionErrorMessage: (error: Error) => error.message,
      captureCloudSessionAuthority: async () => { const authority = assigned(); events.push('capture-cloud');
        if (cloudGate) await cloudGate; return authority; },
      assertCurrentCloudSessionAuthority: check,
    },
    './syncService': { runCloudBackup },
    '../repositories': {
      resetFailedUploadsForRetry: async (actor: string) => { assert.equal(actor, user?.id); events.push('reset-failed'); if (resetGate) await resetGate; },
      syncAssignedInstallations: async (actor: string, authority: any) => { check(authority, actor); events.push('assigned-refresh'); },
    },
    './thumbnailCache': {}, './authenticatedCloudAction': {},
    './activeTimeSync': { syncActiveTimeSessions: async () => {} },
    './assignedWorkMutationGuard': {
      captureAssignedWorkMutationAuthority: assigned, assertCurrentAssignedWorkAuthority: check,
      actorForCurrentAssignedWorkAuthority: (authority: any) => { try { check(authority, authority.actor); return authority.actor; } catch { return null; } },
    },
    './syncStatusStorage': { lastSyncedAtSecureStoreKey: (id: string) => id, lastConfirmedBackupAtSecureStoreKey: (id: string) => id },
    './backupOutcome': { shouldRecordConfirmedBackup: () => false },
    './foregroundRejectedMetadataRetry': {
      captureForegroundRejectedMetadataRetry: (value: AppDataStore, actor: string) => {
        events.push('capture-descriptor'); if (captureError) throw captureError; const result = captureForegroundRejectedMetadataRetry(value, actor); descriptors.push(result); return result;
      },
    },
    './schedulerNotificationRefresh': {
      listenForInstallHubSchedulerNotifications: () => () => {},
    },
  };
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; }, exports);
  const render = () => { cursor = 0; return exports.SyncStatusProvider({ children: null }).props.value; };
  return { render, store, events, runs, descriptors,
    captureError: (error: Error) => { captureError = error; },
    runGate: (value?: Promise<void>) => { runGate = value; }, resetGate: (value?: Promise<void>) => { resetGate = value; },
    cloudGate: (value?: Promise<void>) => { cloudGate = value; },
    replaceSession: (actor: string | null = user?.id ?? 'actor') => { generation++; user = actor ? { id: actor } : null; return render(); },
  };
}

test('automatic calls deduplicate with no descriptor, while manual press waits and starts its own scoped flight', async () => {
  const h = harness(); const gate = deferred(); h.runGate(gate.promise); const context = h.render();
  const automatic = context.triggerSync(); assert.equal(context.triggerSync(), automatic);
  await settle(); assert.equal(h.runs.length, 1); assert.equal(h.runs[0].rejectedMetadataRetry, undefined);
  const manual = context.retrySync();
  assert.equal(h.descriptors.length, 1, 'The press captures scope synchronously before waiting');
  assert.equal(h.events.includes('reset-failed'), false);
  assert.notEqual(manual, automatic); await settle(); assert.equal(h.runs.length, 1);
  gate.resolve(); await automatic; await manual;
  assert.equal(h.runs.length, 2); assert.equal(h.runs[1].rejectedMetadataRetry, h.descriptors[0]);
  assert.notEqual(h.runs[0].identity, h.runs[1].identity);
  assert.ok(h.events.indexOf('capture-descriptor') < h.events.indexOf('reset-failed'));
  assert.deepEqual(h.events.filter((event) => event.endsWith('-run')), ['automatic-run', 'manual-run']);
  await context.triggerSync(); assert.equal(h.runs[2].rejectedMetadataRetry, undefined);
});

test('a server-change signal coalesces one trailing full sync behind an active flight', async () => {
  const h = harness(); const gate = deferred(); h.runGate(gate.promise); const context = h.render();
  const active = context.triggerSync(); await settle(); assert.equal(h.runs.length, 1);
  const firstSignal = context.triggerSyncAfterServerChange();
  const secondSignal = context.triggerSyncAfterServerChange();
  assert.equal(secondSignal, firstSignal);
  assert.notEqual(firstSignal, active);
  gate.resolve(); await active; await firstSignal;
  assert.equal(h.runs.length, 2);
  assert.deepEqual(h.events.filter((event) => event.endsWith('-run')), [
    'automatic-run',
    'automatic-run',
  ]);
});

test('a server-change signal starts the normal full sync immediately when idle', async () => {
  const h = harness(); const result = await h.render().triggerSyncAfterServerChange();
  assert.equal(result.phase, 'done');
  assert.equal(h.runs.length, 1);
  assert.deepEqual(h.events.filter((event) => (
    event === 'assigned-refresh' || event.endsWith('-run')
  )), ['automatic-run', 'assigned-refresh']);
});

test('a trailing server-change sync cannot be swallowed by a manual flight queued later', async () => {
  const h = harness(); const gate = deferred(); h.runGate(gate.promise); const context = h.render();
  const active = context.triggerSync(); await settle();
  const serverChange = context.triggerSyncAfterServerChange();
  const manual = context.retrySync();
  gate.resolve(); await Promise.all([active, manual, serverChange]);
  assert.equal(h.runs.length, 3);
  assert.deepEqual(h.events.filter((event) => event.endsWith('-run')), [
    'automatic-run',
    'manual-run',
    'automatic-run',
  ]);
});

test('a queued server-change sync is actor-fenced across session replacement', async () => {
  const h = harness(); const gate = deferred(); h.runGate(gate.promise); const context = h.render();
  const active = context.triggerSync(); await settle();
  const serverChange = context.triggerSyncAfterServerChange();
  h.replaceSession('other'); gate.resolve();
  await active; const result = await serverChange;
  assert.equal(result.phase, 'idle');
  assert.equal(h.runs.length, 1);
});

for (const actor of ['actor', 'other']) {
  test(`manual retry waiting behind automatic cannot cross replacement session for ${actor}`, async () => {
    const h = harness(); const gate = deferred(); h.runGate(gate.promise); const context = h.render();
    const automatic = context.triggerSync(); await settle(); const manual = context.retrySync();
    h.replaceSession(actor); gate.resolve(); await automatic; const result = await manual;
    assert.equal(result.phase, 'error'); assert.match(result.lastError, /session replaced/);
    assert.equal(h.runs.length, 1); assert.equal(h.events.includes('reset-failed'), false);
  });
}

test('session replacement during failed-upload reset prevents the manual backup dispatch', async () => {
  const h = harness(); const gate = deferred(); h.resetGate(gate.promise);
  const pending = h.render().retrySync(); await settle(); assert.ok(h.events.includes('reset-failed'));
  h.replaceSession(); gate.resolve(); const result = await pending;
  assert.equal(result.phase, 'error'); assert.equal(h.runs.length, 0);
});

test('session replacement during cloud authority capture prevents even failed-upload reset', async () => {
  const h = harness(); const gate = deferred(); h.cloudGate(gate.promise);
  const pending = h.render().retrySync(); assert.equal(h.descriptors.length, 1);
  h.replaceSession(); gate.resolve(); const result = await pending;
  assert.equal(result.phase, 'error'); assert.equal(h.runs.length, 0); assert.equal(h.events.includes('reset-failed'), false);
});

test('waiting manual scope never expands to newly opted-in records or mutated rejection history', async () => {
  const h = harness(); const gate = deferred(); h.runGate(gate.promise); const context = h.render();
  const automatic = context.triggerSync(); await settle(); const manual = context.retrySync();
  const captured = h.descriptors[0]; const initialHash = captured.attempts[0].rejectedRecordSha256;
  h.store.cloudSync.rejected_metadata_attempts!.rejected!.rejection_message = 'changed after the press';
  h.store.installations.push({ ...h.store.installations[0]!, id: 'later' });
  h.store.cloudSync.rejected_metadata_attempts!.later = { ...h.store.cloudSync.rejected_metadata_attempts!.rejected!, id: 'later', installation_id: 'later' };
  gate.resolve(); await automatic; await manual;
  assert.equal(h.runs[1].rejectedMetadataRetry.attempts.length, 1);
  assert.equal(h.runs[1].rejectedMetadataRetry.attempts[0].rejectedRecordSha256, initialHash);
});

test('Settings invokes the same manual retry handler with zero or nonzero failed uploads', () => {
  const settings = readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('SettingsScreen.tsx', settings, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(parsed) === 'title' && attribute.initializer?.getText(parsed).includes('Back up opted-in installations'))) {
      const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(parsed) === 'onPress') as ts.JsxAttribute;
      callback = (attribute.initializer as ts.JsxExpression).expression as ts.ArrowFunction;
    }
    ts.forEachChild(node, visit);
  }; visit(parsed); assert.ok(callback);
  for (const failed of [0, 2]) {
    let retries = 0; let automatics = 0;
    const handler = new Function('retrySync', 'triggerSync', 'backupStats', `return (${callback.getText(parsed)});`)(
      () => { retries++; return Promise.resolve(); }, () => { automatics++; return Promise.resolve(); }, { failed });
    handler(); assert.equal(retries, 1); assert.equal(automatics, 0);
  }
});


test('early click-time descriptor failure resolves to visible backup error instead of an unhandled rejection', async () => {
  const h = harness(); const context = h.render(); h.captureError(new Error('Stored rejection could not be read'));
  const result = await context.retrySync();
  assert.equal(result.phase, 'error'); assert.match(result.lastError, /could not be read/);
  assert.equal(h.render().progress.lastError, result.lastError);
  assert.equal(h.runs.length, 0); assert.equal(h.events.includes('reset-failed'), false);
});

test('a stale click callback resolves its authority failure without publishing into the next account', async () => {
  const h = harness(); const old = h.render(); h.replaceSession('other');
  const result = await old.retrySync();
  assert.equal(result.phase, 'error'); assert.equal(h.render().progress.phase, 'idle');
  assert.equal(h.descriptors.length, 0); assert.equal(h.runs.length, 0);
});


test('retained signed-out retry callback cannot publish its early error after a new login', async () => {
  const h = harness(); const signedOut = h.replaceSession(null); h.replaceSession('actor');
  const result = await signedOut.retrySync();
  assert.equal(result.phase, 'error'); assert.match(result.lastError, /Sign in again/);
  assert.equal(h.render().progress.phase, 'idle'); assert.equal(h.descriptors.length, 0); assert.equal(h.runs.length, 0);
});
