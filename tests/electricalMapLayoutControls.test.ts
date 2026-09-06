import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as diagram from '../src/domain/electricalDiagram';
import * as geometry from '../src/domain/electricalDiagramLayout';
import * as layouts from '../src/domain/electricalMapLayout';

type Node = { type: unknown; props: Record<string, unknown> };
const code = ts.transpileModule(readFileSync(new URL('../src/components/domain/ElectricalSingleLineDiagram.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness(rejectSave = false) {
  const states: unknown[] = []; let cursor = 0; let buttons: Array<{ text: string; onPress?: () => void }> = [];
  const dirty: boolean[] = []; const saves: layouts.ElectricalMapLayoutDocument[] = [];
  const element = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const props = { model: { installationId: 'i', treeRevision: 3, siteName: 'Site', nodes: [{ id: 'g', kind: 'GRID' as const, name: 'Grid', typeLabel: 'Incoming', zoneName: 'Site', devices: [] }], edges: [], unresolved: [] },
    retainedDraft: null as { document: layouts.ElectricalMapLayoutDocument; modelIdentity: string } | null,
    onDraftChange: (draft: { document: layouts.ElectricalMapLayoutDocument; modelIdentity: string } | null) => { props.retainedDraft = draft; },
    canArrange: true, onLayoutDirtyChange: (value: boolean) => dirty.push(value),
    savedLayout: { version: 1 as const, canvas: { width: 600, height: 400 }, nodes: [{ nodeId: 'g', centerX: 200, centerY: 200 }], layoutRevision: 2 },
    onSaveLayout: async (layout: layouts.ElectricalMapLayoutDocument) => { saves.push(layout); if (rejectSave) throw Error('Server rejected this revision'); },
  };
  const modules: Record<string, unknown> = {
    react: { createElement: element, useState: (initial: unknown) => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; }, useMemo: (fn: () => unknown) => fn(), useEffect: () => {} },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Alert: { alert: (_title: string, _message: string, options: typeof buttons) => { buttons = options; } }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-svg': { default: 'Svg', Polyline: 'Polyline' }, 'lucide-react-native': new Proxy({}, { get: (_target, key) => key }),
    '../../domain/electricalDiagram': diagram, '../../domain/electricalDiagramLayout': geometry, '../../domain/electricalMapLayout': layouts,
    '../../context/AppProviders': { useTheme: () => ({ colors: {} }) }, '../../theme': { radii: {}, spacing: { md: 12, sm: 8 }, typography: {} },
    '../ui': { Button: 'Button', Card: 'Card', EmptyState: 'EmptyState' },
  };
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(modules[name], name); return modules[name]; }, exports);
  const render = () => { cursor = 0; return (exports.ElectricalSingleLineDiagram as (value: unknown) => Node)(props); };
  function nodes(value: unknown): Node[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object' || !('props' in value)) return [];
    const node = value as Node; return [node, ...nodes(node.props.children)];
  }
  const find = (title: string) => nodes(render()).find((node) => node.props.title === title);
  const press = (title: string) => { const node = find(title); assert.ok(node, title); assert.notEqual(node.props.disabled, true, title); (node.props.onPress as () => void)(); };
  return { props, dirty, saves, render, find, press, remount: () => { states.length = 0; }, discard: () => { press('Discard arrangement'); buttons.find((button) => button.text === 'Discard')?.onPress?.(); } };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('completed/read-only maps expose no Arrange action', () => {
  const h = harness(); h.props.canArrange = false; assert.equal(h.find('Arrange symbols'), undefined);
});

test('move/save uses stable saved positions, failed save retains draft, explicit discard clears it', async () => {
  const h = harness(true); h.press('Arrange symbols'); h.press('Move right'); h.press('Save arrangement'); await settle();
  assert.deepEqual(h.saves[0]?.nodes, [{ nodeId: 'g', centerX: 224, centerY: 200 }]);
  assert.ok(h.find('Save arrangement')); assert.deepEqual(h.dirty, [true]);
  h.discard(); assert.equal(h.find('Save arrangement'), undefined); assert.deepEqual(h.dirty, [true, false]);
});

test('successful save releases navigation guard only after persistence resolves', async () => {
  const h = harness(); h.press('Arrange symbols'); h.press('Save arrangement');
  assert.deepEqual(h.dirty, [true]); await settle();
  assert.deepEqual(h.dirty, [true, false]); assert.equal(h.find('Save arrangement'), undefined);
});

test('an installation revision change keeps pending positions but disables saving stale layout', () => {
  const h = harness(); h.press('Arrange symbols'); h.props.model.treeRevision = 4;
  assert.equal(h.find('Save arrangement')?.props.disabled, true); assert.ok(h.find('Discard arrangement'));
  assert.deepEqual(h.dirty, [true]);
});

// Unavailable installation rendering temporarily unmounts the diagram. A retry must
// recover the exact pending positions, while retaining the original source fence.
test('a retained draft survives diagram unmount and source drift cannot make it current', () => {
  const h = harness(); h.press('Arrange symbols'); h.press('Move right');
  const pending = structuredClone(h.props.retainedDraft);
  h.remount();
  assert.ok(h.find('Save arrangement')); assert.deepEqual(h.props.retainedDraft, pending);
  h.press('Move down');
  assert.deepEqual(h.props.retainedDraft?.document.nodes, [{ nodeId: 'g', centerX: 224, centerY: 224 }]);
  h.props.model.treeRevision = 4; h.remount();
  assert.equal(h.find('Save arrangement')?.props.disabled, true);
  assert.deepEqual(h.props.retainedDraft?.document.nodes, [{ nodeId: 'g', centerX: 224, centerY: 224 }]);
  h.discard(); assert.equal(h.props.retainedDraft, null);
});
