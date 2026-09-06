import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function harness(before = false) {
  const values: any[] = []; let cursor = 0; let focus: (() => void) | undefined; let tree: any;
  const alerts: any[][] = []; const calls: any[][] = []; const authority = {};
  const lease = { actorUserId: 'actor', cloudAuthority: authority, assertCurrent() {} };
  const view = { access: { userId: 'actor', isMaintainer: false }, scope: 'mine',
    inventory: { data: [], total: 0, truncated: false }, summary: { data: [], total: 0, truncated: false }, users: [] };
  const run = async (action: any, success?: any) => { const result = await action(lease, view); success?.(result); };
  const element = (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
  const react = { createElement: element, Fragment: 'Fragment', useCallback: (f: any) => f, useEffect() {},
    useState(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], (next: any) => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    useRef(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; } };
  const api = { claimInventoryMeterByDeviceId: async (...args: any[]) => { calls.push(['claim', ...args]); },
    updateInventoryMeter: async (...args: any[]) => { calls.push(['update', ...args]); return { id: args[0] }; },
    deleteInventoryMeter: async (...args: any[]) => { calls.push(['delete', ...args]); } };
  const modules: Record<string, any> = { react,
    'react-native': { Alert: { alert: (...args: any[]) => alerts.push(args) }, ...Object.fromEntries(['Modal', 'Pressable', 'RefreshControl', 'Text', 'View'].map(x => [x, x])) },
    '@react-navigation/native': { useFocusEffect: (fn: any) => { focus ??= fn; } },
    '../api/apiClient': { apiClient: api, ApiError: Error },
    '../components/ui': Object.fromEntries(['FormScrollView', 'Badge', 'Button', 'Card', 'EmptyState', 'LoadingState', 'SearchBar', 'TextArea', 'TextField'].map(x => [x, x])),
    '../components/BarcodeScanField': { BarcodeScanField: 'BarcodeScanField' },
    '../context/AppProviders': { useAuth: () => ({ user: { id: 'actor', role: 'inspector' } }), useTheme: () => ({ colors: {} }) },
    '../theme': { radii: {}, spacing: {}, typography: {} },
    '../domain/supportCloudReads': { loadInventoryView: async () => view },
    '../hooks/useInventoryData': { useInventoryData: () => ({ data: view, run, viewToken: lease, load: async () => {}, loading: false, busy: false }) },
  };
  const path = before ? '../../tmp/field-parity-inventory-baseline/src/screens/InventoryScreen.tsx' : '../src/screens/InventoryScreen.tsx';
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code + '\nexports.Editor = InventoryEditor;')((id: string) => { assert.ok(id in modules, id); return modules[id]; }, exports);
  const render = () => { cursor = 0; tree = exports.InventoryScreen(); return tree; };
  function nodes(node = tree): any[] { if (!node || typeof node !== 'object') return []; return [node, ...(node.children ?? []).flatMap((child: any) => nodes(child))]; }
  const button = (title: string) => { const found = nodes().find(n => n.type === 'Button' && n.props.title === title); assert.ok(found, `Missing button: ${title}`); return found.props; };
  const field = (kind: string) => { const found = nodes().find(n => n.type === kind && n.props.label === 'Device ID / serial'); assert.ok(found, kind); return found.props; };
  const initialize = async () => { render(); focus?.(); await new Promise(r => setImmediate(r)); render(); };
  return { initialize, render, button, field, alerts, calls, authority, run, view,
    editor(meter: any) { cursor = 0; values.length = 0; tree = exports.Editor({ meter, users: [], currentUserId: 'actor', run,
      busy: false, onClose() {}, onSaved() {} }); },
  };
}

test('typed scanner fallback preserves the serial when switching to manual entry', async () => {
  const h = harness(Boolean(process.env.FIELD_PARITY_INVENTORY_BEFORE)); await h.initialize();
  h.button('Add meter').onPress(); h.alerts.at(-1)![2].find((x: any) => x.text === 'Scan barcode').onPress(); h.render();
  h.field('BarcodeScanField').onChangeText('qa-stock-001'); h.render();
  h.button('Enter Device ID manually instead').onPress(); h.render();
  assert.equal(h.field('TextField').value, 'qa-stock-001');
});

test('typed serial in scan mode uses Review Device ID and an explicit bound claim confirmation', async () => {
  const h = harness(Boolean(process.env.FIELD_PARITY_INVENTORY_BEFORE)); await h.initialize();
  h.button('Add meter').onPress(); h.alerts.at(-1)![2].find((x: any) => x.text === 'Scan barcode').onPress(); h.render();
  h.field('BarcodeScanField').onChangeText(' qa-stock-002 '); h.render();
  h.button('Review Device ID').onPress();
  assert.equal(h.calls.length, 0);
  assert.equal(h.alerts.at(-1)![1], 'Add QA-STOCK-002 to your inventory?');
  h.alerts.at(-1)![2].find((x: any) => x.text === 'Add meter').onPress();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(h.calls, [['claim', 'QA-STOCK-002', h.authority]]);
});

test('inventory editor binds update and retained delete to the original run authority and meter revision', async () => {
  const h = harness(); h.view.access.isMaintainer = true; h.view.scope = 'company';
  h.editor({ id: 'meter', revision: 7, deviceId: 'QA-EDIT', deviceModel: 'A3RM', status: 'company', custodianUserId: null });
  h.button('Save changes').onPress(); await new Promise(r => setImmediate(r));
  assert.equal(h.calls[0]![0], 'update'); assert.equal(h.calls[0]![1], 'meter');
  assert.equal(h.calls[0]![2].expectedRevision, 7); assert.equal(h.calls[0]![3], h.authority);
  h.button('Delete meter').onPress(); assert.equal(h.calls.length, 1);
  h.alerts.at(-1)![2].find((x: any) => x.text === 'Delete').onPress(); await new Promise(r => setImmediate(r));
  assert.deepEqual(h.calls[1], ['delete', 'meter', h.authority]);
});
