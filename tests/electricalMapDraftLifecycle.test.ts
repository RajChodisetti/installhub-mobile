import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

type Node = { type: unknown; props: Record<string, any> };
const code = ts.transpileModule(readFileSync(new URL('../src/screens/DataViewScreen.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness() {
  const states: unknown[] = []; const effects: Array<() => unknown> = []; let cursor = 0; let first = true;
  let guard = false; let actorCurrent = true; let locked = false; let backs = 0; let loads = 0;
  let buttons: Array<{ text: string; onPress?: () => void }> = [];
  const user: { current: { id: string } | null } = { current: { id: 'owner' } };
  const item = { id: 'i', site_name: 'Site', local_owner_user_id: 'owner', status: 'Draft', tree_revision: 3, server_tree_revision: 3 };
  const aggregate: Record<string, any> = { item, zones: [], boards: [], siteAssets: [], gridSupplies: [], meterDevices: [], measurementAssignments: [], virtualMeters: [], readiness: { issues: [], eligibility: { mappingExport: false } }, loading: false, error: null, refresh: async () => {} };
  const node = (type: unknown, props: Node['props']): Node => ({ type, props });
  const generic = new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : () => [] });
  const modules: Record<string, unknown> = {
    react: { createElement: node, useState: (initial: unknown) => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; }, useMemo: (fn: () => unknown) => fn(), useRef: (value: unknown) => ({ current: value }), useEffect: (fn: () => unknown) => { if (first) effects.push(fn); } },
    'react/jsx-runtime': { jsx: node, jsxs: node },
    'react-native': { View: 'View', Text: 'Text', FlatList: 'FlatList', Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value }, Alert: { alert: (_title: string, _message: string, options: typeof buttons = []) => { buttons = options; } } },
    '@react-navigation/native': { usePreventRemove: (value: boolean) => { guard = value; } },
    '../hooks': { useInstallation: () => aggregate },
    '../context/AppProviders': { useTheme: () => ({ colors: {} }), useAuth: () => ({ user: user.current }) },
    '../theme': { spacing: {}, typography: {} },
    '../components/ui': new Proxy({}, { get: (_target, key) => String(key) }),
    '../components/forms': { FormModal: 'FormModal', SelectChips: 'SelectChips' },
    '../components/RecordLoadState': { RecordLoadState: 'RecordLoadState' },
    '../components/domain/ElectricalSingleLineDiagram': { ElectricalSingleLineDiagram: 'Diagram' },
    '../domain/electricalDiagram': { buildElectricalDiagramModel: () => ({ nodes: [{ id: 'g' }], edges: [], unresolved: [] }) },
    '../domain/reconciliationWorkflow': { partitionReadinessIssues: () => ({ reconciliation: [], validation: [] }), reconciliationProgress: () => ({}), readinessIssueKey: () => '' },
    '../domain/meterSearch': { searchEligibleMeters: () => ({ visible: [] }) },
    '../services/assignedWorkMutationGuard': { assignedWorkActionIsLocked: () => locked },
    '../repositories': { canonicalInstallationRepo: { electricalTree: async () => [], allAssetMetering: async () => [] } },
    '../repositories/electricalMapLayoutRepository': { loadElectricalMapLayout: async () => { loads++; return { lease: { actorUserId: 'owner', assertCurrent: () => { if (!actorCurrent) throw Error('Actor expired'); } } }; } },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => modules[name] ?? generic, exports);
  function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== 'object' || !('props' in value)) return []; const n = value as Node; return [n, ...nodes(n.props.children)]; }
  const render = () => { cursor = 0; const result = exports.DataViewScreen({ route: { params: { installationId: 'i', initialMode: 'ELECTRICAL' } }, navigation: { goBack: () => { backs++; } } }); first = false; return nodes(result); };
  const find = (type: string) => render().find((n) => n.type === type);
  const pending = { document: { version: 1, canvas: { width: 500, height: 500 }, nodes: [{ nodeId: 'g', centerX: 124, centerY: 100 }] }, modelIdentity: 'source:3' };
  return { aggregate, user, pending, render, find, guard: () => guard, backs: () => backs, loads: () => loads,
    expire: () => { actorCurrent = false; }, withdraw: () => { locked = true; },
    async arrange() { render(); for (const effect of effects.splice(0)) effect(); await new Promise<void>((resolve) => setImmediate(resolve)); const diagram = find('Diagram'); assert.ok(diagram); diagram.props.onDraftChange(pending); diagram.props.onLayoutDirtyChange(true); render(); assert.equal(guard, true); },
    confirmDiscard() { buttons.find((button) => button.text === 'Discard and go back')?.onPress?.(); },
  };
}

test('unavailable record retains the pending arrangement, offers retry and explicit discard/back', async () => {
  const h = harness(); await h.arrange(); const item = h.aggregate.item;
  h.aggregate.item = null; h.aggregate.error = 'Retained store read failed';
  assert.equal(h.find('Diagram'), undefined); assert.equal(h.guard(), false);
  const unavailable = h.find('RecordLoadState'); assert.ok(unavailable); assert.equal(typeof unavailable.props.onRetry, 'function');
  unavailable.props.onBack(); assert.equal(h.backs(), 0);
  h.aggregate.item = item; const restored = h.find('Diagram'); assert.deepEqual(restored?.props.retainedDraft, h.pending); assert.equal(h.guard(), true);
  h.aggregate.item = null; h.find('RecordLoadState')?.props.onBack(); h.confirmDiscard(); assert.equal(h.backs(), 1);
  h.aggregate.item = item; assert.equal(h.find('Diagram')?.props.retainedDraft, null); assert.equal(h.guard(), false);
});

test('a transient retained read error keeps positions and navigation protection', async () => {
  const h = harness(); await h.arrange(); h.aggregate.error = 'Offline retained refresh';
  assert.deepEqual(h.find('Diagram')?.props.retainedDraft, h.pending); assert.equal(h.guard(), true);
});

test('logout, an expired actor, and withdrawn access cannot be trapped by pending positions', async () => {
  for (const cause of ['logout', 'expired', 'withdrawn', 'missing-readiness', 'wrong-installation']) {
    const h = harness(); await h.arrange();
    if (cause === 'logout') h.user.current = null;
    if (cause === 'expired') h.expire();
    if (cause === 'withdrawn') h.withdraw();
    if (cause === 'missing-readiness') h.aggregate.readiness = null;
    if (cause === 'wrong-installation') h.aggregate.item = { ...h.aggregate.item, id: 'other' };
    h.render(); assert.equal(h.guard(), false, cause);
  }
});
