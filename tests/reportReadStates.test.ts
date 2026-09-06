import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { resolveHistoricalInstallationPackServerTarget } from '../src/services/installationPackHistory';
import { resolveInstallationPackServerTarget } from '../src/services/installationPackTarget';
import { installationReportJobMatchesSelection } from '../src/services/reportVersioning';

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
const form = { id: 'form-a', installation_id: 'installation-a', status: 'Completed', form_type: 'captis-logger', attachments: [{ id: 'photo-a', uri: 'file://evidence.jpg' }], answers: { serial: 'QA-SERIAL' } };
function hookHarness() {
  const r = runtime();
  let read: () => Promise<any[]> = async () => [form];
  let subscriber: (() => void) | undefined;
  const module = loadModule('../src/hooks/index.ts', {
    '../repositories': { formsRepo: { listByInstallation: () => read() } },
    '../data/seed': { subscribeStore: (callback: () => void) => { subscriber = callback; return () => { subscriber = undefined; }; } },
  }, r.react);
  let id: string | undefined = 'installation-a';
  const render = () => r.render(() => module.useForms(id));
  return { ...r, render, setRead: (fn: typeof read) => { read = fn; }, setId: (next: string | undefined) => { id = next; }, notify: () => subscriber?.() };
}

test('forms initial read failure is caught by the effect, finishes loading and supports retry', async () => {
  const h = hookHarness();
  h.setRead(async () => { throw new Error('Storage unavailable'); });
  h.render(); h.effects(); await settle();
  const failed = h.render();
  assert.equal(failed.loading, false); assert.equal(failed.loaded, false);
  assert.equal(failed.error, 'Storage unavailable'); assert.deepEqual(failed.items, []);
  h.setRead(async () => [form]);
  await failed.refresh();
  const retried = h.render();
  assert.equal(retried.error, null); assert.equal(retried.loaded, true);
  assert.deepEqual(retried.items, [form]);
});

test('forms refresh failure preserves loaded answers and evidence but still rejects action callers', async () => {
  const h = hookHarness(); h.render(); h.effects(); await settle();
  h.setRead(async () => { throw new Error('Refresh failed'); });
  await assert.rejects(h.render().refresh(), /Refresh failed/);
  const failed = h.render();
  assert.deepEqual(failed.items, [form]); assert.equal(failed.loaded, true);
  assert.equal(failed.error, 'Refresh failed'); assert.equal(failed.loading, false);
  h.notify(); await settle(); // Subscriber consumes its rejected refresh promise.
  assert.deepEqual(h.render().items, [form]);
});

test('a pending read from another installation cannot expose or replace the current forms', async () => {
  const h = hookHarness(); const old = deferred<any[]>();
  h.setRead(() => old.promise); h.render(); h.effects();
  h.setId('installation-b');
  const next = { ...form, id: 'form-b', installation_id: 'installation-b' };
  h.setRead(async () => [next]);
  assert.deepEqual(h.render().items, []);
  h.effects(); await settle();
  old.resolve([form]); await settle();
  assert.deepEqual(h.render().items, [next]); assert.equal(h.render().error, null);
});

test('newest forms refresh wins over stale success and stale failure', async () => {
  for (const rejects of [false, true]) {
    const h = hookHarness(); h.render(); h.effects(); await settle();
    const old = deferred<any[]>(); h.setRead(() => old.promise);
    const pending = h.render().refresh();
    const observed = pending.catch(() => undefined);
    const latest = { ...form, answers: { serial: 'LATEST' } };
    h.setRead(async () => [latest]); await h.render().refresh();
    if (rejects) old.reject(new Error('Stale failure')); else old.resolve([form]);
    await observed;
    assert.deepEqual(h.render().items, [latest]); assert.equal(h.render().error, null);
  }
});

test('form hook ignores late unmounted failures and does not load without an installation', async () => {
  const h = hookHarness(); const old = deferred<any[]>();
  h.setRead(() => old.promise); h.render(); h.effects();
  const before = h.render(); h.unmount(); old.reject(new Error('Late failure')); await settle();
  assert.deepEqual(h.render().items, before.items); assert.equal(h.render().error, null);
  const empty = hookHarness(); empty.setId(undefined);
  empty.setRead(async () => { throw new Error('Must not read undefined scope'); });
  empty.render(); empty.effects(); await settle();
  assert.equal(empty.render().loading, false); assert.deepEqual(empty.render().items, []);
});

type Node = { type?: string; props?: Record<string, any> };
function nodes(root: any): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!root || typeof root !== 'object') return [];
  return [root, ...nodes(root.props?.children)];
}
function screenHarness(name: 'ClientReport' | 'PhotoPreview' | 'InstallationReport' | 'FormsList') {
  const r = runtime();
  const installation: Record<string, any> = {
    item: { id: 'installation-a', site_name: 'QA report', status: 'Draft' },
    zones: [], boards: [], siteAssets: [], meterDevices: [], loading: false, error: null,
    refresh: async () => {},
  };
  const forms: Record<string, any> = { items: [form], loading: false, loaded: true, error: null, refresh: async () => {} };
  const tree = { installation: installation.item, formSubmissions: [form] };
  let treeRead: () => Promise<any> = async () => tree;
  const alerts: any[][] = [];
  const api: Record<string, any> = {};
  const repositories: Record<string, any> = { getInstallationBackupTree: () => treeRead() };
  const sharing: Record<string, any> = { __esModule: true };
  const clientExport: Record<string, any> = {};
  let routeId = 'installation-a';
  const selection = { excluded: {}, loading: false, loaded: true, error: '', readError: '', writeError: '', refresh: async () => {}, toggle() {} };
  let authorityCurrent = true;
  const assertCurrent = () => { if (!authorityCurrent) throw new Error('Session changed'); };
  const lease = { actorUserId: 'actor-a', processAuthority: {}, cloudAuthority: { generation: 1 }, assertCurrent };
  const shared: Record<string, any> = {
    installationReportWeight: () => ({ path: 'LOCAL', reasons: [] }),
    FORM_PDF_TIERS: [],
  };
  const module = loadModule(`../src/screens/${name}Screen.tsx`, {
    'react-native': { ScrollView: 'ScrollView', View: 'View', Text: 'Text', Image: 'Image', Switch: 'Switch', Pressable: 'Pressable', Alert: { alert(...args: any[]) { alerts.push(args); } }, StyleSheet: { create: (value: any) => value } },
    '../hooks': { useInstallation: () => installation, useForms: () => forms },
    '../context/AppProviders': { useTheme: () => ({ colors: {} }) },
    '../theme': { spacing: {}, typography: {}, radii: {} },
    '../hooks/useClientReportPhotoSelection': { useClientReportPhotoSelection: () => selection },
    '../domain/clientReport': { clientReportModel: () => ({ zones: [], completedFormNames: [], includedPhotos: [{ key: 'photo-a', label: 'Synthetic evidence caption', uri: 'file://evidence.jpg' }], photos: [{ key: 'photo-a', label: 'Synthetic evidence caption', uri: 'file://evidence.jpg' }], missingEvidence: [] }) },
    '../services': shared,
    '../services/SyncStatusContext': { useSyncStatus: () => ({ triggerSync: async () => ({ phase: 'done' }) }) },
    '../repositories': repositories,
    '../api/apiClient': { apiClient: api },
    '../services/authenticatedCloudAction': { captureAuthenticatedCloudActionLease: async () => lease },
    '../services/cloudActionLease': { runLeasedCloudActionStep: async (_lease: any, action: () => Promise<any>) => { assertCurrent(); const result = await action(); assertCurrent(); return result; } },
    '../services/assignedWorkMutationGuard': { captureAssignedWorkMutationAuthority: () => lease.processAuthority, actorForCurrentAssignedWorkAuthority: () => 'actor-a', assertCurrentAssignedWorkAuthority: assertCurrent },
    'expo-sharing': sharing,
    '../services/installationPackHistory': { resolveHistoricalInstallationPackServerTarget },
    '../services/clientReport': clientExport,
    '../forms/catalog': { FORM_DEFINITION_BY_TYPE: { 'captis-logger': { shortTitle: 'Captis Logger' } } },
    '../utils': { formatDate: (value: any) => value },
    '../repositories/cloudSyncRepository': { cachedThumbnailUri: () => null },
  }, r.react);
  const render = () => r.render(() => module[`${name}Screen`]({ route: { params: { installationId: routeId } }, navigation: { goBack() {}, navigate() {} } }));
  return { ...r, installation, forms, render, tree, shared, api, repositories, sharing, selection, alerts, clientExport, setRouteId: (id: string) => { routeId = id; }, changeAccount: () => { authorityCurrent = false; }, setTreeRead: (fn: typeof treeRead) => { treeRead = fn; } };
}

for (const name of ['ClientReport', 'PhotoPreview', 'InstallationReport'] as const) {
  test(`${name} renders missing/failed initial records as Retry/Back instead of endless loading or an empty report`, () => {
    const h = screenHarness(name);
    h.installation.item = null;
    let result = h.render();
    assert.equal(result.type, 'RecordLoadState');
    assert.match(result.props.message, /no longer available/);
    assert.equal(typeof result.props.onRetry, 'function'); assert.equal(typeof result.props.onBack, 'function');
    h.installation.error = 'Installation read failed';
    assert.equal(h.render().props.message, 'Installation read failed');
    h.installation.item = { id: 'installation-a', site_name: 'QA report' }; h.installation.error = null;
    h.forms.error = 'Evidence read failed'; h.forms.loaded = false; h.forms.items = [];
    result = h.render();
    assert.equal(result.type, 'RecordLoadState'); assert.equal(result.props.message, 'Evidence read failed');
  });
  test(`${name} retains visible loaded information, reports refresh failure, and disables export or selection`, () => {
    const h = screenHarness(name); h.forms.error = 'Forms refresh failed';
    const rendered = nodes(h.render());
    assert.ok(rendered.some((node) => node.type === 'RecordLoadState' && node.props?.inline));
    assert.ok(rendered.some((node) => node.type === 'Text' && node.props?.children === (name === 'PhotoPreview' ? 'Photo gallery' : name === 'ClientReport' ? 'Client report' : 'FIELD APP COMPLETE')));
    if (name === 'PhotoPreview') {
      const selections = rendered.filter((node) => node.type === 'Switch');
      assert.ok(selections.length); assert.ok(selections.every((node) => node.props?.disabled === true));
      assert.ok(rendered.some((node) => node.type === 'ReportEvidencePreview' && node.props?.label === 'Synthetic evidence caption'));
    } else {
      const exports = rendered.filter((node) => node.type === 'Button' && /Export \/ Share PDF|Generate on this|Generate through API/.test(node.props?.title));
      assert.ok(exports.length); assert.ok(exports.every((node) => node.props?.disabled === true));
    }
  });
}

test('report tree-weight read failure retains prior model, blocks export and supports retry', async () => {
  const h = screenHarness('InstallationReport');
  h.render(); h.effects(); await settle(); h.render();
  const old = deferred<any>(); h.setTreeRead(() => old.promise);
  // Changing a selected form triggers the real report-tree effect.
  const clear = nodes(h.render()).find((node) => node.type === 'Button' && node.props?.title === 'Clear')!;
  clear.props!.onPress(); h.render(); h.effects();
  const select = nodes(h.render()).find((node) => node.type === 'Button' && node.props?.title === 'Select all')!;
  select.props!.onPress(); h.render(); h.effects();
  const retryNode = () => nodes(h.render()).find((node) => node.type === 'RecordLoadState');
  old.reject(new Error('Report tree unavailable')); await settle();
  assert.match(String(retryNode()?.props?.message), /Report tree unavailable/);
  h.setTreeRead(async () => h.tree); retryNode()!.props!.onRetry();
  h.render(); h.effects(); await settle();
  assert.equal(retryNode(), undefined);
  assert.ok(nodes(h.render()).filter((node) => node.type === 'Button' && /Generate on this|Generate through API/.test(node.props?.title)).every((node) => node.props?.disabled === false));
});

test('FormsList shows repository errors without falsely saying no forms yet', () => {
  const h = screenHarness('FormsList'); h.forms.items = []; h.forms.error = 'Form storage failed'; h.forms.loaded = false;
  const rendered = nodes(h.render());
  assert.ok(rendered.some((node) => node.type === 'RecordLoadState' && node.props?.message === 'Form storage failed'));
  assert.equal(rendered.some((node) => node.type === 'EmptyState' && node.props?.title === 'No forms yet'), false);
});


test('late report-weight failures from an abandoned selection or unmounted screen cannot replace current state', async () => {
  for (const unmount of [false, true]) {
    const h = screenHarness('InstallationReport'); const pending = deferred<any>();
    h.setTreeRead(() => pending.promise); h.render(); h.effects();
    if (unmount) h.unmount();
    else {
      const clear = nodes(h.render()).find((node) => node.type === 'Button' && node.props?.title === 'Clear')!;
      clear.props!.onPress(); h.render(); h.effects();
      h.setTreeRead(async () => h.tree);
      const select = nodes(h.render()).find((node) => node.type === 'Button' && node.props?.title === 'Select all')!;
      select.props!.onPress(); h.render(); h.effects(); await settle();
    }
    pending.reject(new Error('Abandoned read failed')); await settle();
    assert.equal(nodes(h.render()).some((node) => node.type === 'RecordLoadState'), false);
  }
});

for (const failure of ['none', 'start-hash', 'ready-hash', 'lookup-account', 'lookup-unmount', 'download-account', 'download-unmount'] as const) {
  test(`actual installation-pack server action preserves retained version and hash (${failure})`, async () => {
    const h = screenHarness('InstallationReport');
    Object.assign(h.installation.item, { status: 'Completed', cloud_backup_enabled: true, record_version_number: 4 });
    h.forms.items = [{ ...form, historical_meter_removed: true }];
    h.tree.formSubmissions = h.forms.items;
    const starts: any[][] = []; const downloads: any[] = []; const shares: any[] = [];
    const lookupGate = deferred<any>(); const downloadGate = deferred<string>();
    let heldVersion: any;
    const pin = { recordVersionNumber: 3, recordVersionPayloadHash: 'retained-hash', reportSource: 'canonical-version', detailMode: 'by-electrical-hierarchy', reportVariantKey: 'variant' };
    Object.assign(h.shared, {
      hasIntactImportedSourceProvenance: () => false,
      resolveInstallationPackServerTarget,
      isInstallationTreeBackedUpCurrent: () => true,
      installationPackRevision: () => 'local-revision',
      installationReportJobKey: () => 'job-key',
      clearRememberedReportJob: async () => {},
      rememberedReportJob: async () => null,
      rememberReportJob: async () => {},
      installationReportJobMatchesSelection,
      waitForReportJob: async () => ({ ...pin, recordVersionPayloadHash: failure === 'ready-hash' ? 'wrong' : pin.recordVersionPayloadHash }),
      downloadReportJob: async (...args: any[]) => { downloads.push(args); return failure.startsWith('download-') ? downloadGate.promise : 'file://report.pdf'; },
    });
    Object.assign(h.repositories, {
      installationsRepo: { getById: async () => h.installation.item },
      getInstallationSyncMetadata: async () => ({ forceDirty: false }),
    });
    Object.assign(h.api, {
      listInstallationVersions: async () => ({ versions: [{ versionNumber: 3 }] }),
      getInstallationVersion: async (installationId: string, number: number) => { const candidate = ({
        entityId: installationId, versionNumber: number, payloadHash: 'retained-hash',
        snapshot: {
          snapshotSchema: 'InstallationCanonicalSnapshotV2', payloadHash: 'retained-hash',
          readiness: { eligibility: { authoritativeReport: true } },
          installationTree: { installation: { id: installationId, recordVersionNumber: number }, formSubmissions: number === 3 ? h.forms.items : [] },
        },
      });
        if (number === 3 && failure.startsWith('lookup-')) { heldVersion = candidate; return lookupGate.promise; }
        return candidate;
      },
      startInstallationPdfJob: async (...args: any[]) => {
        starts.push(args);
        return { ...pin, jobId: 'report-job', recordVersionPayloadHash: failure === 'start-hash' ? 'wrong' : pin.recordVersionPayloadHash };
      },
    });
    Object.assign(h.sharing, { isAvailableAsync: async () => true, shareAsync: async (...args: any[]) => { shares.push(args); } });
    h.render(); h.effects(); await settle();
    const button = nodes(h.render()).find((node) => node.type === 'Button' && node.props?.title === 'Generate through API server')!;
    assert.equal(button.props!.disabled, false);
    button.props!.onPress(); await settle(); await settle();
    if (failure.startsWith('lookup-') || failure.startsWith('download-')) {
      if (failure.endsWith('-account')) h.changeAccount(); else h.unmount();
      if (failure.startsWith('lookup-')) lookupGate.resolve(heldVersion); else downloadGate.resolve('file://report.pdf');
      await settle(); await settle();
      assert.equal(starts.length, failure.startsWith('lookup-') ? 0 : 1);
      assert.equal(downloads.length, failure.startsWith('lookup-') ? 0 : 1);
      assert.deepEqual(shares, []); assert.deepEqual(h.alerts, []);
      return;
    }
    assert.equal(starts.length, 1);
    assert.equal(starts[0][0], 'installation-a');
    assert.deepEqual(starts[0][1], ['form-a']);
    assert.equal(starts[0][2].recordVersionNumber, 3);
    assert.equal(starts[0][2].recordVersionPayloadHash, 'retained-hash');
    assert.equal(starts[0][4].generation, 1); assert.equal(starts[0][5].aborted, false);
    if (failure === 'none') {
      assert.deepEqual(h.alerts, []); assert.equal(downloads.length, 1); assert.equal(shares.length, 1);
    } else {
      assert.equal(downloads.length, 0); assert.equal(shares.length, 0);
      assert.equal(h.alerts[0]?.[0], 'API Server PDF Error');
    }
  });
}


test('evidence preview reports native image failure, retries the same URI and ignores old attempt callbacks', () => {
  const r = runtime();
  const module = loadModule('../src/components/ReportEvidencePreview.tsx', {
    'react-native': { ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { absoluteFill: {} } },
    '../context/AppProviders': { useTheme: () => ({ colors: {} }) },
  }, r.react);
  const props = { uri: 'file://owned-evidence.jpg', label: 'Original caption', style: { width: 88, height: 72 } };
  const root = module.ReportEvidencePreview(props);
  assert.equal(root.key, props.uri);
  const render = () => r.render(() => root.type(root.props));
  let result = nodes(render()); r.effects();
  const firstImage = result.find((node) => node.type === 'Image')!;
  assert.deepEqual(firstImage.props!.source, { uri: props.uri });
  assert.ok(result.some((node) => node.type === 'ActivityIndicator'));
  firstImage.props!.onError();
  result = nodes(render());
  assert.ok(result.some((node) => node.type === 'Text' && node.props?.children === 'Preview unavailable'));
  assert.equal(result.some((node) => node.type === 'Image'), false);
  const retry = result.find((node) => node.type === 'Pressable')!;
  assert.equal(retry.props!.accessibilityLabel, 'Retry preview for Original caption');
  retry.props!.onPress();
  firstImage.props!.onError(); // Native callback from the previous image attempt.
  result = nodes(render());
  const retried = result.find((node) => node.type === 'Image')!;
  assert.deepEqual(retried.props!.source, { uri: props.uri });
  assert.ok(result.some((node) => node.type === 'ActivityIndicator'));
  retried.props!.onLoad();
  result = nodes(render());
  assert.equal(result.some((node) => node.type === 'ActivityIndicator'), false);
  assert.equal(result.some((node) => node.type === 'Pressable'), false);
  r.unmount(); retried.props!.onError();
  assert.equal(nodes(render()).some((node) => node.type === 'Pressable'), false);
  assert.equal(module.ReportEvidencePreview({ ...props, uri: 'file://changed-evidence.jpg' }).key, 'file://changed-evidence.jpg');
  assert.equal(props.uri, 'file://owned-evidence.jpg'); assert.equal(props.label, 'Original caption');
});


function selectionHarness() {
  const r = runtime();
  let id = 'installation-a';
  let read: (id: string) => Promise<any> = async () => ({ 'photo-a': 'file://a.jpg' });
  let write: (id: string, selection: any) => Promise<void> = async () => {};
  const listeners = new Map<string, (selection: any) => void>();
  const module = loadModule('../src/hooks/useClientReportPhotoSelection.ts', {
    '../domain/clientReport': { withClientReportPhotoIncluded: (previous: any, photo: any, included: boolean) => {
      const next = { ...previous }; if (included) delete next[photo.key]; else next[photo.key] = photo.uri; return next;
    } },
    '../repositories/clientReportPreferencesRepository': {
      readClientReportPhotoExclusions: (id: string) => read(id),
      writeClientReportPhotoExclusions: (id: string, next: any) => write(id, next),
      subscribeClientReportPhotoExclusions: (id: string, callback: (value: any) => void) => { listeners.set(id, callback); return () => listeners.delete(id); },
    },
  }, r.react);
  return { ...r, render: () => r.render(() => module.useClientReportPhotoSelection(id)),
    setId: (value: string) => { id = value; }, setRead: (value: typeof read) => { read = value; },
    setWrite: (value: typeof write) => { write = value; }, publish: (id: string, value: any) => listeners.get(id)?.(value),
  };
}

test('unknown saved photo choices block toggles until a successful read/retry', async () => {
  const h = selectionHarness(); const writes: any[] = [];
  h.setRead(async () => { throw new Error('Disk read failed'); });
  h.setWrite(async (...args) => { writes.push(args); });
  h.render(); h.effects(); await settle();
  assert.equal(h.render().loaded, false); assert.equal(h.render().loading, false); assert.ok(h.render().readError);
  await h.render().toggle({ key: 'photo-b', uri: 'file://b.jpg' }, false);
  assert.deepEqual(writes, []);
  h.setRead(async () => ({ 'photo-a': 'file://a.jpg' }));
  await h.render().refresh();
  assert.equal(h.render().loaded, true); assert.equal(h.render().readError, '');
  assert.deepEqual(h.render().excluded, { 'photo-a': 'file://a.jpg' });
});

test('photo choices remain scoped across route changes and ignore previous-scope read/write callbacks', async () => {
  const h = selectionHarness(); h.render(); h.effects(); await settle();
  const oldWrite = deferred<void>(); h.setWrite(() => oldWrite.promise);
  const pendingWrite = h.render().toggle({ key: 'photo-b', uri: 'file://b.jpg' }, false);
  const oldRead = deferred<any>(); h.setRead(() => oldRead.promise);
  const pendingRead = h.render().refresh().catch(() => undefined);
  h.setId('installation-b'); h.setRead(async () => ({ 'photo-c': 'file://c.jpg' }));
  assert.deepEqual(h.render().excluded, {}); assert.equal(h.render().loaded, false); assert.equal(h.render().readError, '');
  h.effects(); await settle();
  oldRead.resolve({ 'photo-a': 'file://a.jpg' }); oldWrite.reject(new Error('Old write failed'));
  await Promise.all([pendingRead, pendingWrite]);
  assert.deepEqual(h.render().excluded, { 'photo-c': 'file://c.jpg' });
  assert.equal(h.render().writeError, ''); assert.equal(h.render().readError, '');
});

test('same-installation refresh errors preserve known session choices; failed persistence is a separate warning', async () => {
  const h = selectionHarness(); h.render(); h.effects(); await settle();
  h.setRead(async () => { throw new Error('Refresh failed'); });
  await assert.rejects(h.render().refresh());
  assert.equal(h.render().loaded, true); assert.deepEqual(h.render().excluded, { 'photo-a': 'file://a.jpg' });
  assert.ok(h.render().readError); assert.equal(h.render().writeError, '');
  h.setRead(async () => ({ 'photo-a': 'file://a.jpg' })); await h.render().refresh();
  h.setWrite(async () => { throw new Error('Write failed'); });
  await h.render().toggle({ key: 'photo-b', uri: 'file://b.jpg' }, false);
  assert.deepEqual(h.render().excluded, { 'photo-a': 'file://a.jpg', 'photo-b': 'file://b.jpg' });
  assert.equal(h.render().loaded, true); assert.equal(h.render().readError, ''); assert.ok(h.render().writeError);
});

test('explicit session choice subscriptions supersede a pending read and late unmount errors do not publish', async () => {
  const h = selectionHarness(); const pending = deferred<any>(); h.setRead(() => pending.promise);
  h.render(); h.effects();
  h.publish('installation-a', { 'photo-explicit': 'file://explicit.jpg' });
  pending.resolve({}); await settle();
  assert.deepEqual(h.render().excluded, { 'photo-explicit': 'file://explicit.jpg' }); assert.equal(h.render().loaded, true);
  const late = deferred<any>(); h.setRead(() => late.promise); const refresh = h.render().refresh().catch(() => undefined);
  h.unmount(); late.reject(new Error('Unmounted read')); await refresh;
  assert.equal(h.render().readError, '');
});

test('client/gallery expose selection read retry but allow known explicit session choices after a write failure', () => {
  for (const name of ['ClientReport', 'PhotoPreview'] as const) {
    const h = screenHarness(name); h.selection.loaded = false; h.selection.readError = 'Saved choices unreadable';
    assert.equal(h.render().type, 'RecordLoadState'); assert.equal(h.render().props.message, 'Saved choices unreadable');
    h.selection.loaded = true; h.selection.readError = ''; h.selection.writeError = 'Choices not saved for next launch';
    const rendered = nodes(h.render());
    assert.ok(rendered.some((node) => node.type === 'Text' && node.props?.children === h.selection.writeError));
    const controls = rendered.filter((node) => node.type === 'Switch' || (node.type === 'Button' && node.props?.title === 'Export / Share PDF'));
    assert.ok(controls.length); assert.ok(controls.every((node) => node.props?.disabled === false));
    h.selection.readError = 'Refresh unreadable';
    assert.ok(nodes(h.render()).filter((node) => node.type === 'Switch' || (node.type === 'Button' && node.props?.title === 'Export / Share PDF')).every((node) => node.props?.disabled === true));
  }
});

test('preference repository distinguishes absent storage from corrupt saved choices without caching failed reads', async () => {
  let raw: string | null = null;
  const repo = loadModule('../src/repositories/clientReportPreferencesRepository.ts', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => raw } },
    '../domain/clientReport': { parseClientReportPhotoExclusions: (value: string | null) => value ? JSON.parse(value) : {} },
  }, {});
  assert.deepEqual(await repo.readClientReportPhotoExclusions('empty'), {});
  for (const [index, corrupt] of ['{bad', '[]', 'null', '{"photo-a":true}', '{"photo-a":""}'].entries()) {
    raw = corrupt;
    await assert.rejects(repo.readClientReportPhotoExclusions(`corrupt-${index}`), /unreadable/);
    raw = '{"photo-a":"file://a.jpg"}';
    assert.deepEqual(await repo.readClientReportPhotoExclusions(`corrupt-${index}`), { 'photo-a': 'file://a.jpg' });
  }
});


test('report polling checks action authority before HTTP and again before publishing a returned status', async () => {
  let active = false; const calls: any[][] = []; const statuses: any[] = [];
  const pending = deferred<any>();
  const jobs = loadModule('../src/services/reportJobs.ts', {
    '../api/apiClient': { apiClient: { getExportJobStatus: async (...args: any[]) => { calls.push(args); return pending.promise; } } },
    '../constants/syncConfig': { SYNC_API_URL: 'https://qa.invalid' },
  }, {});
  const authority = { generation: 1 }; const controller = new AbortController();
  const context = { authority, assertCurrent: () => { if (!active) throw new Error('Scope changed'); } };
  await assert.rejects(jobs.waitForReportJob('job-a', (value: any) => statuses.push(value), controller.signal, context), /Scope changed/);
  assert.deepEqual(calls, []);
  active = true;
  const running = jobs.waitForReportJob('job-a', (value: any) => statuses.push(value), controller.signal, context);
  const rejected = assert.rejects(running, /Scope changed/);
  active = false; pending.resolve({ status: 'complete' }); await rejected;
  assert.deepEqual(calls, [['job-a', authority, controller.signal]]); assert.deepEqual(statuses, []);
});

test('report download checks originating scope inside the delayed token callback before downloading', async () => {
  let active = true; const token = deferred<void>(); const downloaded: any[] = [];
  const authority = { generation: 1 };
  const jobs = loadModule('../src/services/reportJobs.ts', {
    'expo-file-system': { Directory: class { create() {} }, File: class { uri = 'file://report.pdf'; }, Paths: { cache: 'file://cache' } },
    '../api/apiClient': { runWithCloudAccessToken: async (operation: (token: string) => Promise<any>, captured: any) => {
      assert.equal(captured, authority); await token.promise; return operation('opaque-test-token');
    } },
    '../constants/syncConfig': { SYNC_API_URL: 'https://qa.invalid' },
    './authenticatedFileDownload': { authenticatedFileDownload: async (input: any) => { downloaded.push(input); return { uri: 'file://report.pdf' }; } },
  }, {});
  const running = jobs.downloadReportJob('job-a', 'report.pdf', { authority, assertCurrent: () => { if (!active) throw new Error('Scope changed'); } });
  const rejected = assert.rejects(running, /Scope changed/);
  active = false; token.resolve(); await rejected;
  assert.deepEqual(downloaded, []);
});

test('report API methods pass captured authority and abort signal through the real HTTP request boundary', async () => {
  const source = ts.createSourceFile('apiClient.ts', readFileSync(new URL('../src/api/apiClient.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let properties: ts.ObjectLiteralElementLike[] = [];
  const wanted = new Set(['startInstallationPdfJob', 'getExportJobStatus', 'listInstallationVersions', 'getInstallationVersion']);
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'apiClient' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      properties = node.initializer.properties.filter((property) => Boolean(property.name && wanted.has(property.name.getText(source))));
    }
    ts.forEachChild(node, visit);
  };
  visit(source); assert.equal(properties.length, 4);
  const code = ts.transpileModule(`const api = { ${properties.map((property) => property.getText(source)).join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: any[][] = [];
  const api = new Function('request', 'installationReportVersionFields', `${code}; return api;`)(
    async (...args: any[]) => { calls.push(args); }, (pin: any) => ({ recordVersionNumber: pin.recordVersionNumber }),
  );
  const authority = { generation: 1 }; const signal = new AbortController().signal;
  await api.startInstallationPdfJob('installation-a', ['form-b', 'form-a'], { recordVersionNumber: 3 }, 'by-zone', authority, signal);
  await api.getExportJobStatus('job-a', authority, signal);
  await api.listInstallationVersions('installation-a', authority, signal);
  await api.getInstallationVersion('installation-a', 3, authority, signal);
  assert.ok(calls.every((args) => args[5] === signal && args[6] === authority));
  assert.deepEqual(calls[0][2], { formSubmissionIds: ['form-a', 'form-b'], detailMode: 'by-zone', recordVersionNumber: 3 });
});


test('retained refresh callbacks from a previous installation cannot reset the new forms or photo choices', async () => {
  const forms = hookHarness(); forms.render(); forms.effects(); await settle();
  const oldFormsRefresh = forms.render().refresh;
  forms.setId('installation-b'); forms.setRead(async () => [{ ...form, id: 'form-b' }]);
  forms.render(); forms.effects(); await settle();
  const newForms = forms.render(); await oldFormsRefresh();
  assert.deepEqual(forms.render().items, newForms.items); assert.equal(forms.render().loading, false);

  const choices = selectionHarness(); choices.render(); choices.effects(); await settle();
  const oldChoicesRefresh = choices.render().refresh;
  choices.setId('installation-b'); choices.setRead(async () => ({ 'photo-b': 'file://b.jpg' }));
  choices.render(); choices.effects(); await settle();
  await oldChoicesRefresh();
  assert.deepEqual(choices.render().excluded, { 'photo-b': 'file://b.jpg' }); assert.equal(choices.render().loading, false);
});


test('a newer explicit choice supersedes the persistence warning from an older in-flight selection', async () => {
  const h = selectionHarness(); h.render(); h.effects(); await settle();
  const old = deferred<void>(); h.setWrite(() => old.promise);
  const write = h.render().toggle({ key: 'old-choice', uri: 'file://old.jpg' }, false);
  h.publish('installation-a', { 'new-choice': 'file://new.jpg' });
  old.reject(new Error('Previous choice failed')); await write;
  assert.deepEqual(h.render().excluded, { 'new-choice': 'file://new.jpg' });
  assert.equal(h.render().writeError, ''); assert.equal(h.render().readError, '');
});


test('installation report resets pending operation state for a new route while the old action cannot continue', async () => {
  const h = screenHarness('InstallationReport'); const oldRead = deferred<any>();
  h.repositories.installationsRepo = { getById: () => oldRead.promise };
  h.render(); h.effects(); await settle();
  nodes(h.render()).find((node) => node.type === 'Button' && node.props?.title === 'Generate through API server')!.props!.onPress();
  await settle();
  assert.ok(nodes(h.render()).some((node) => node.type === 'Button' && node.props?.title === 'Preparing PDF…'));
  h.setRouteId('installation-b'); h.installation.item = { id: 'installation-b', site_name: 'Another installation', status: 'Draft' };
  h.render(); h.effects(); await settle();
  assert.equal(nodes(h.render()).some((node) => node.type === 'Button' && node.props?.title === 'Preparing PDF…'), false);
  oldRead.resolve({ id: 'installation-a' }); await settle();
  assert.deepEqual(h.alerts, []);
  assert.equal(nodes(h.render()).some((node) => node.type === 'Button' && node.props?.title === 'Preparing PDF…'), false);
});

for (const event of ['none', 'account', 'unmount', 'route'] as const) {
  test(`local client export retains originating actor/screen and avoids stale publication (${event})`, async () => {
    const h = screenHarness('ClientReport'); const prepared = deferred<void>();
    const shares: any[] = []; let calls = 0;
    h.clientExport.shareClientReportPdf = async (data: any, excluded: any, assertCurrent: () => void) => {
      calls += 1; assertCurrent(); await prepared.promise; assertCurrent(); shares.push({ data, excluded });
    };
    h.render(); h.effects();
    const button = nodes(h.render()).find((node) => node.type === 'Button' && node.props?.title === 'Export / Share PDF')!;
    button.props!.onPress(); button.props!.onPress(); // A second native callback cannot start another export before render.
    assert.equal(calls, 1);
    if (event === 'account') h.changeAccount();
    if (event === 'unmount') h.unmount();
    if (event === 'route') {
      h.setRouteId('installation-b'); h.installation.item = { id: 'installation-b', site_name: 'Another installation' };
      h.render(); h.effects();
      assert.equal(nodes(h.render()).some((node) => node.type === 'Button' && node.props?.title === 'Preparing PDF…'), false);
    }
    prepared.resolve(); await settle();
    assert.equal(shares.length, event === 'none' ? 1 : 0);
    assert.deepEqual(h.alerts, []);
    if (event === 'none' || event === 'route') {
      assert.equal(nodes(h.render()).some((node) => node.type === 'Button' && node.props?.title === 'Preparing PDF…'), false);
    }
  });
}

for (const boundary of ['image', 'bytes', 'print', 'availability'] as const) {
  test(`actual local client PDF pipeline stops after the originating scope changes during ${boundary}`, async () => {
    let current = true; const gate = deferred<any>(); const shares: any[] = []; const prints: any[] = []; const deleted: string[] = [];
    class LocalFile {
      exists = true;
      constructor(public uri: string) {}
      async base64() { return boundary === 'bytes' ? gate.promise : 'AQID'; }
      delete() { deleted.push(this.uri); }
    }
    const pipeline = loadModule('../src/services/clientReport.ts', {
      'expo-file-system': { File: LocalFile },
      'expo-image-manipulator': { manipulateAsync: async () => boundary === 'image' ? gate.promise : { uri: 'file://processed.jpg' }, SaveFormat: { JPEG: 'jpeg' } },
      'expo-print': { __esModule: true, printToFileAsync: async (input: any) => { prints.push(input); return boundary === 'print' ? gate.promise : { uri: 'file://report.pdf', numberOfPages: 1 }; } },
      'expo-sharing': { __esModule: true, isAvailableAsync: async () => boundary === 'availability' ? gate.promise : true, shareAsync: async (...args: any[]) => { shares.push(args); } },
      '../domain/clientReport': { clientReportModel: () => ({ includedPhotos: [{ key: 'photo-a', label: 'Original caption', uri: 'file://original.jpg' }] }) },
      '../repositories/cloudSyncRepository': { cachedThumbnailUri: () => undefined },
      './ownedMediaPaths': { resolveOwnedMediaUri: (uri: string) => uri },
      './clientReportHtml': { buildClientReportHtml: () => '<html>QA report</html>' },
      './reportPage': { A4_PRINT_WIDTH: 595, A4_PRINT_HEIGHT: 842 },
    }, {});
    const data = { installation: { site_name: 'QA site' } }; const excluded = { 'omitted-photo': 'file://omitted.jpg' };
    const result = pipeline.shareClientReportPdf(data, excluded, () => { if (!current) throw new Error('Originating scope changed'); });
    const rejected = assert.rejects(result, /Originating scope changed/);
    await settle(); current = false;
    gate.resolve(boundary === 'image' ? { uri: 'file://processed.jpg' } : boundary === 'bytes' ? 'AQID' : boundary === 'print' ? { uri: 'file://report.pdf', numberOfPages: 1 } : true);
    await rejected;
    assert.deepEqual(shares, []);
    assert.equal(prints.length, boundary === 'image' || boundary === 'bytes' ? 0 : 1);
    assert.deepEqual(excluded, { 'omitted-photo': 'file://omitted.jpg' });
    assert.ok(deleted.every((uri) => uri === 'file://processed.jpg'));
  });
}
