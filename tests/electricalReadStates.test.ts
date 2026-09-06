import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as tableDomain from '../src/domain/meteringTable';

type Node = { type: string; props: Record<string, unknown> };
const empty = { item: null, boards: [], siteAssets: [], gridSupplies: [], meterDevices: [], measurementAssignments: [], readiness: null, loading: false, error: null, refresh: async () => {} };
function render(screen: 'MeteringTable' | 'MeterHistory', aggregate: object, initialStates: unknown[] = []): Node {
  let cursor = 0;
  const element = (type: string, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    react: { useState: (initial: unknown) => [cursor < initialStates.length ? initialStates[cursor++] : (cursor++, initial), () => {}], useMemo: (fn: () => unknown) => fn(), useEffect: () => {}, useCallback: (fn: unknown) => fn, useRef: (value: unknown) => ({ current: value }) },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { FlatList: 'FlatList', Text: 'Text', View: 'View', Alert: {}, StyleSheet: { create: (value: unknown) => value } },
    '../hooks': { useInstallation: () => ({ ...empty, ...aggregate }) },
    '../components/ui': new Proxy({}, { get: (_target, key) => key }),
    '../components/RecordLoadState': { RecordLoadState: 'RecordLoadState' },
    '../context/AppProviders': { useTheme: () => ({ colors: {} }) },
    '../theme': { spacing: {}, typography: {} },
    '../domain/meteringTable': tableDomain,
  };
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(`../src/screens/${screen}Screen.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)((name: string) => modules[name] ?? {}, exports);
  return (exports[`${screen}Screen`] as (props: unknown) => Node)({ navigation: { goBack() {} }, route: { params: { installationId: 'i', meterId: 'm' } } });
}

for (const screen of ['MeteringTable', 'MeterHistory'] as const) {
  test(`${screen}: initial loading differs from missing/failed/foreign installation`, () => {
    assert.equal(render(screen, { loading: true }).type, 'LoadingState');
    for (const aggregate of [{}, { error: 'Read failed' }, { item: { id: 'other' } }]) {
      const result = render(screen, aggregate);
      assert.equal(result.type, 'RecordLoadState');
      assert.equal(typeof result.props.onRetry, 'function'); assert.equal(typeof result.props.onBack, 'function');
    }
  });
}

test('loaded metering rows remain visible during a refresh failure with retry/back alert', () => {
  const snapshot = { installationId: 'i', rows: [{ id: 'a', channelLabels: [] }], inventory: { assets: { confirmedUnmetered: 0 } }, diagnostics: [] };
  const result = render('MeteringTable', { item: { id: 'i' }, error: 'Refresh failed' }, [snapshot]);
  assert.equal(result.type, 'FlatList');
  assert.deepEqual(result.props.data, snapshot.rows);
  const header = result.props.ListHeaderComponent as Node;
  const alert = (header.props.children as Node[]).find((child) => child?.type === 'RecordLoadState');
  assert.equal(alert?.props.message, 'Refresh failed');
  assert.equal(alert?.props.inline, true);
});
