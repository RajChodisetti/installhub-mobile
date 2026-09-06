import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { supportsCommsReplacement, deviceSearchIdentity } from '../src/domain/meterSearch';
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Execute actual hook/screen modules. Only React scheduling and platform/I/O are
// controlled; none of the production loading or rendering decisions are copied.
function runtime() {
  const slots: any[] = [];
  const effects: Array<() => void> = [];
  let cursor = 0;
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    Boolean(a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index])));
  const react = {
    useState(initial: any) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (value: any) => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useRef(initial: any) {
      const index = cursor++;
      slots[index] ??= { value: { current: initial } };
      return slots[index].value;
    },
    useMemo(create: () => any, deps: unknown[]) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() };
      return slots[index].value;
    },
    useCallback(callback: any, deps: unknown[]) { return react.useMemo(() => callback, deps); },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const prior = slots[index];
        slots[index] = { deps, cleanup: prior?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  return {
    react,
    render<T>(fn: () => T): T { cursor = 0; return fn(); },
    effects() { while (effects.length) effects.shift()!(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function loadModule(path: string, dependencies: Record<string, any>, react: any) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  const jsx = (type: any, props: any, key?: string) => ({ type, props, key });
  const require = (key: string) => {
    if (key === 'react') return react;
    if (key === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (key in dependencies) return dependencies[key];
    return new Proxy({}, { get: (_target, property) => String(property) });
  };
  new Function('require', 'exports', code)(require, exports);
  return exports;
}

function hookHarness() {
  const r = runtime();
  let id = 'installation-a'; let actor: string | null = 'owner'; let generation = 1;
  let installationRead: (id: string) => Promise<any> = async (id) => ({ id, local_owner_user_id: actor });
  let metersRead: () => Promise<any[]> = async () => [{ id: 'meter', installationId: id, installedOnBoardId: 'board' }];
  let subscriber: (() => void) | undefined;
  const module = loadModule('../src/hooks/index.ts', {
    '../repositories': {
      installationsRepo: { getById: (id: string) => installationRead(id) },
      zonesRepo: { listByInstallation: async (id: string) => [{ id: 'zone', audit_id: id }] },
      electricalAssetsRepo: { listByInstallation: async (id: string) => [{ id: 'board', zone_id: 'zone', audit_id: id }] },
      canonicalInstallationRepo: { meterDevices: () => metersRead() },
    },
    '../data/seed': { subscribeStore: (fn: () => void) => { subscriber = fn; return () => { subscriber = undefined; }; } },
    '../services/assignedWorkMutationGuard': {
      captureAssignedWorkMutationAuthority: () => ({ actorUserId: actor, generation }),
      actorForCurrentAssignedWorkAuthority: (a: any) => a.generation === generation && a.actorUserId === actor ? actor : null,
    },
  }, r.react);
  const render = () => r.render(() => module.useDeviceSearchRecords(id));
  return { ...r, render, notify: () => subscriber?.(),
    setRead: (read: typeof installationRead) => { installationRead = read; },
    setMeters: (read: typeof metersRead) => { metersRead = read; },
    setId: (next: string) => { id = next; },
    replaceActor: (next: string | null) => { actor = next; generation++; },
  };
}

test('device initial read errors are caught and retry distinguishes missing installation from empty devices', async () => {
  const h = hookHarness(); h.setRead(async () => { throw Error('Device storage unavailable'); });
  h.render(); h.effects(); await settle();
  assert.equal(h.render().loading, false); assert.equal(h.render().loaded, false);
  assert.equal(h.render().error, 'Device storage unavailable');
  h.setRead(async () => null); await h.render().refresh();
  assert.equal(h.render().loaded, true); assert.equal(h.render().installation, null); assert.equal(h.render().error, null);
  h.setRead(async (id) => ({ id, local_owner_user_id: 'owner' })); h.setMeters(async () => []);
  await h.render().refresh(); assert.equal(h.render().installation.id, 'installation-a'); assert.deepEqual(h.render().items, []);
});

test('device refresh errors retain only same-scope successful rows and effects consume failures', async () => {
  const h = hookHarness(); h.render(); h.effects(); await settle();
  const before = h.render().items; assert.equal(before.length, 1);
  h.setMeters(async () => { throw Error('Meter read failed'); });
  await assert.rejects(h.render().refresh(), /Meter read failed/);
  assert.deepEqual(h.render().items, before); assert.equal(h.render().error, 'Meter read failed');
  h.notify(); await settle(); assert.deepEqual(h.render().items, before);
});

test('device route and account changes immediately hide retained rows and reject late reads', async () => {
  for (const reason of ['route', 'actor', 'same-actor-relogin']) {
    const h = hookHarness(); h.render(); h.effects(); await settle();
    const old = deferred<any[]>(); h.setMeters(() => old.promise);
    const pending = h.render().refresh(); await settle();
    if (reason === 'route') h.setId('installation-b');
    else h.replaceActor(reason === 'actor' ? 'another-owner' : 'owner');
    assert.deepEqual(h.render().items, [], reason);
    h.setMeters(async () => [{ id: 'new-meter', installedOnBoardId: 'board' }]);
    h.effects(); await settle();
    old.resolve([{ id: 'old-meter', installedOnBoardId: 'board' }]); await pending;
    assert.equal(h.render().items[0].meter.id, 'new-meter', reason);
  }
});

test('newest device refresh wins and unmounted failures cannot publish', async () => {
  const h = hookHarness(); h.render(); h.effects(); await settle();
  const old = deferred<any[]>(); h.setMeters(() => old.promise);
  const pending = h.render().refresh().catch(() => undefined); await settle();
  h.setMeters(async () => [{ id: 'latest', installedOnBoardId: 'board' }]); await h.render().refresh();
  old.reject(Error('Old failure')); await pending;
  assert.equal(h.render().items[0].meter.id, 'latest'); assert.equal(h.render().error, null);
  const late = deferred<any[]>(); h.setMeters(() => late.promise);
  const stopped = h.render().refresh().catch(() => undefined); await settle(); const before = h.render(); h.unmount();
  late.reject(Error('Unmounted')); await stopped;
  assert.deepEqual(h.render().items, before.items); assert.equal(h.render().error, null);
});

test('device reads never expose a foreign-owned installation', async () => {
  const h = hookHarness(); h.setRead(async (id) => ({ id, local_owner_user_id: 'foreign-owner' }));
  h.render(); h.effects(); await settle();
  assert.equal(h.render().loading, false); assert.deepEqual(h.render().items, []);
  assert.match(h.render().error, /signed-in account/);
});

test('Comms replacement matches the portal supported family and model gate', () => {
  for (const deviceFamily of ['WATTWATCHERS', 'OTHER'] as const) {
    for (const deviceModel of ['A3RM', 'A6M', 'OTHER'] as const) {
      assert.equal(supportsCommsReplacement({ deviceFamily, deviceModel }), deviceFamily === 'WATTWATCHERS' && deviceModel !== 'OTHER');
    }
  }
});

// Execute the actual serialized creation body so stale screen/model/board input
// cannot bypass the UI's supported-device predicate.
function replacementHarness() {
  const source = ts.createSourceFile('repo.ts', readFileSync(new URL('../src/repositories/index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.filter(ts.isVariableStatement).flatMap((s) => [...s.declarationList.declarations]).find((d) => d.name.getText(source) === 'formsRepo')!;
  const create = (declaration.initializer as ts.ObjectLiteralExpression).properties.find((p) => p.name?.getText(source) === 'create') as ts.MethodDeclaration;
  const code = ts.transpileModule(`const invoke = async function(input: any) ${create.body!.getText(source)}; exports.invoke = invoke;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const store: any = { installations: [{ id: 'i', status: 'Draft' }], electricalAssets: [{ id: 'b', audit_id: 'i', zone_id: 'z' }], meterDevices: [{ id: 'm', installationId: 'i', installedOnBoardId: 'b', deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM' }], formSubmissions: [], revisions: 0 };
  const exports: any = {};
  new Function('exports', 'captureAssignedWorkMutationGuard', 'nowIso', 'createId', 'updateStore', 'supportsCommsReplacement', 'supportedFormAnswers', 'bumpTreeRevision', code)(exports,
    () => () => {}, () => '2026-09-05', () => 'new-form', async (write: (s: any) => void) => { const next = structuredClone(store); write(next); Object.assign(store, next); }, supportsCommsReplacement, (_type: string, answers: any) => answers, (s: any) => { s.revisions++; });
  const input = { form_type: 'comms-fault', schema_version: 2, installation_id: 'i', zone_id: 'z', board_id: 'b', meter_id: 'm', answers: { 'works.replace_device': 'yes' } };
  return { store, input, create: () => exports.invoke(input) };
}

test('replacement creation accepts exact supported context and rejects changed family/board/installation atomically', async () => {
  const good = replacementHarness(); const form = await good.create(); assert.equal(form.meter_id, 'm'); assert.equal(good.store.revisions, 1);
  for (const reason of ['family', 'model', 'board', 'zone', 'installation', 'missing']) {
    const h = replacementHarness();
    if (reason === 'family') h.store.meterDevices[0].deviceFamily = 'OTHER';
    if (reason === 'model') h.store.meterDevices[0].deviceModel = 'OTHER';
    if (reason === 'board') h.store.meterDevices[0].installedOnBoardId = 'elsewhere';
    if (reason === 'zone') h.input.zone_id = 'other-zone';
    if (reason === 'installation') h.store.meterDevices[0].installationId = 'other-installation';
    if (reason === 'missing') h.store.meterDevices = [];
    const before = JSON.stringify(h.store); await assert.rejects(h.create(), /supports A3RM|selected device/); assert.equal(JSON.stringify(h.store), before, reason);
  }
});

type UiNode = { type?: string; props?: Record<string, any> };
function uiNodes(value: any): UiNode[] {
  if (Array.isArray(value)) return value.flatMap(uiNodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...uiNodes(value.props?.children)];
}
function deviceScreenHarness() {
  const r = runtime();
  const installation = { id: 'i', status: 'Draft', local_owner_user_id: 'owner', site_name: 'QA Site', client_name: 'QA' };
  const record: any = { installation,
    zone: { id: 'z', audit_id: 'i', zone_name: 'QA Zone' },
    board: { id: 'b', audit_id: 'i', zone_id: 'z', asset_name: 'QA Board', asset_type: 'MSB' },
    meter: { id: 'm', installationId: 'i', installedOnBoardId: 'b', deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM', serialNumber: 'QA-1', displayName: { value: 'QA device' }, channels: [] },
  };
  const state: any = { items: [record], installation, loading: false, loaded: true, error: null, refresh: async () => {} };
  const domain = { supportsCommsReplacement, deviceSearchIdentity, deviceRecordBelongsToInstallation: () => true, searchInstallationDevices: () => ({ total: state.items.length, visible: state.items }), INSTALLATION_DEVICE_RESULT_LIMIT: 250 };
  const module = loadModule('../src/screens/DeviceSearchScreen.tsx', {
    'react-native': { View: 'View', Text: 'Text', FlatList: 'FlatList', StyleSheet: { create: (v: any) => v } },
    '@react-navigation/native': { useIsFocused: () => true },
    '../context/AppProviders': { useAuth: () => ({ user: { id: 'owner' } }), useTheme: () => ({ colors: {} }) },
    '../hooks': { useDeviceSearchRecords: () => state },
    '../domain/meterSearch': domain,
    '../theme': { spacing: {}, typography: {} },
  }, r.react);
  const render = () => r.render(() => module.DeviceSearchScreen({ route: { params: { installationId: 'i' } }, navigation: { goBack() {} } }));
  const card = () => uiNodes(render()).find((n) => n.type === 'FlatList')!.props!.renderItem({ item: record });
  return { state, record, render, card };
}

test('device screen distinguishes failed/missing/loading from a valid empty result and retains retry', () => {
  const h = deviceScreenHarness(); h.state.installation = null; h.state.loaded = false; h.state.loading = true;
  assert.equal(h.render().type, 'LoadingState');
  h.state.loading = false; h.state.error = 'Cannot read devices';
  const failed = h.render(); assert.equal(failed.type, 'RecordLoadState'); assert.equal(failed.props.message, 'Cannot read devices'); assert.equal(typeof failed.props.onRetry, 'function');
  h.state.error = null; h.state.loaded = true;
  assert.match(h.render().props.message, /no longer available/);
  h.state.installation = h.record.installation; h.state.items = [];
  assert.ok(uiNodes(h.render()).some((n) => n.type === 'FlatList'));
});

test('device screen exposes replacement only for supported devices and disables stale rows after failure', () => {
  const h = deviceScreenHarness();
  const replacement = () => uiNodes(h.card()).find((n) => n.props?.title === 'Replace device');
  assert.ok(replacement()); assert.equal(replacement()!.props!.disabled, false);
  h.record.meter.deviceFamily = 'OTHER'; assert.equal(replacement(), undefined);
  h.record.meter.deviceFamily = 'WATTWATCHERS'; h.record.installation.status = 'Completed'; assert.equal(replacement()!.props!.disabled, true);
  h.record.installation.status = 'Draft'; h.state.error = 'Refresh failed';
  assert.equal(replacement()!.props!.disabled, true);
  assert.equal(uiNodes(h.card()).find((n) => n.props?.title === 'Open device')!.props!.disabled, true);
  assert.ok(uiNodes(h.render()).some((n) => n.props?.title === 'Retry device search'));
});
