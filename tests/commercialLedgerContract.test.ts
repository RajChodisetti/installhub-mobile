import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as commercial from '../src/domain/commercial';

function financialScreen() {
  const values: any[] = []; let cursor = 0; let tree: any;
  const calls: any[] = []; const errors: string[] = [];
  const authority = {};
  const summary = {
    installation: {}, header: { currency: 'AUD', pricingMode: 'charge_up' }, currency: 'AUD',
    lines: [{ id: 'cost', description: 'Retained expense', category: 'material', source: 'manual',
      costAmount: 1, sellAmount: 2, billable: true, invoiced: true, hours: null }],
    autoLabour: { enabled: false }, labour: { cost: 30, sell: 40, hours: 2.5, unchargedCost: 0 }, material: {},
    billablePricedMarginPct: null, currentMarginToDatePct: null, marginBreathingRoomPct: null,
  };
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useCallback: (fn: unknown) => fn, useEffect: () => {}, useState: (initial: any) => {
      const index = cursor++; if (!(index in values)) values[index] = initial;
      return [values[index], (next: any) => { values[index] = next; }];
    } };
  const controls = Object.fromEntries(['FormScrollView', 'Button', 'Card', 'SectionHeader', 'TextArea', 'TextField'].map((name) => [name, name]));
  const modules: Record<string, any> = {
    react, 'react-native': { Alert: { alert: () => { throw new Error('No invoice-state alert is permitted'); } }, RefreshControl: 'RefreshControl', Text: 'Text', View: 'View' },
    '../api/apiClient': { apiClient: {
      createCostLine: async (id: string, payload: any, auth: any) => {
        // Mirrors the dedicated ledger boundary: no hours/invoice-state authoring.
        assert.equal(Object.hasOwn(payload, 'hours'), false);
        assert.equal(Object.hasOwn(payload, 'invoiced'), false);
        calls.push({ id, payload, auth }); return { id: 'created' };
      },
      updateCostLine: () => { throw new Error('Manual invoice state must not be dispatched'); },
    } },
    '../context/AppProviders': { useTheme: () => ({ colors: {} }) },
    '../components/ui': controls,
    '../components/domain/CommercialUi': { CommercialError: 'CommercialError', CommercialStatus: 'CommercialStatus', MoneyRows: 'MoneyRows', QuickInvoice: 'QuickInvoice' },
    '../domain/commercial': commercial, '../services/commercialFiles': {}, '../theme': { spacing: {}, typography: {} },
    '../hooks/useCommercialData': { useCommercialData: () => ({ data: summary, isAdmin: true, scopeKey: 'job',
      setError: (message: string) => errors.push(message), run: async (action: any, success: any) => {
        const result = await action({ cloudAuthority: authority }); success?.(result); return result;
      } }) },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/screens/FinancialSummaryScreen.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  const render = () => { cursor = 0; tree = exports.FinancialSummaryScreen({ route: { params: { installationId: 'job' } }, navigation: {} }); };
  const nodes = (): any[] => {
    const found: any[] = []; const visit = (value: any) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') { found.push(value); visit(value.props?.children); }
    }; visit(tree); return found;
  };
  render(); return { render, nodes, calls, errors, authority, summary };
}

test('actual native financial screen keeps ledger hours/status visible without rejected editing controls', () => {
  const h = financialScreen(); const nodes = h.nodes();
  assert.equal(nodes.some((node) => node.type === 'TextField' && node.props.label === 'Hours (optional)'), false);
  assert.equal(nodes.some((node) => ['Mark invoiced', 'Mark uninvoiced'].includes(node.props?.title)), false);
  const spent = nodes.find((node) => node.type === 'MoneyRows' && node.props.title === 'Spent costs');
  assert.ok(spent.props.rows.some(([label, value]: any[]) => label === 'Labour hours' && value === '2.5'));
  assert.ok(nodes.some((node) => node.type === 'Text' && JSON.stringify(node.props.children).includes('Invoiced')));
  assert.ok(nodes.some((node) => node.type === 'Button' && node.props.title === 'Delete cost line'));
  const copy = nodes.filter((node) => node.type === 'Text').map((node) => JSON.stringify(node.props.children)).join(' ');
  assert.match(copy, /Labour hours are managed through audited financial settings/);
  assert.doesNotMatch(copy, /Recorded hours come from active-work tracking/);
});

test('actual native cost submit sends valid amount/description fields without ledger-owned properties', async () => {
  const h = financialScreen();
  for (const [label, value] of [['Description', ' Synthetic material '], ['Cost (AUD)', '1.25'], ['Sell (AUD, optional)', '2.50']]) {
    h.nodes().find((node) => node.type === 'TextField' && node.props.label === label).props.onChangeText(value); h.render();
  }
  h.nodes().find((node) => node.type === 'Button' && node.props.title === 'Material').props.onPress(); h.render();
  h.nodes().find((node) => node.type === 'Button' && node.props.title === 'Add cost line').props.onPress();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.calls, [{ id: 'job', auth: h.authority, payload: {
    category: 'material', description: 'Synthetic material', costAmount: 1.25, sellAmount: 2.5, billable: true,
  } }]);
});

test('cost payload construction cannot leak retained legacy hours or invoiced properties', () => {
  const legacy = { category: 'labour' as const, description: 'Retained input', cost: '10', sell: '', hours: '4.5', invoiced: true };
  assert.deepEqual(commercial.costLineInput(legacy), {
    category: 'labour', description: 'Retained input', costAmount: 10, sellAmount: null, billable: true,
  });
});
