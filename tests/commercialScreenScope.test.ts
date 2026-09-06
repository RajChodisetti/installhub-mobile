import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function screenLoader(screen: 'FinancialSummary' | 'Invoices' | 'InvoiceDetail') {
  let captured: any; const calls: any[] = [];
  const summary: any = { installationId: 'job', header: { installationId: 'job' }, lines: [{ installationId: 'job' }] };
  const invoice: any = { id: 'invoice', installationId: 'job', lines: [{ invoiceId: 'invoice' }] };
  const api = { getFinancialSummary: async (...args: any[]) => { calls.push(['summary', ...args]); return summary; },
    listInvoices: async (...args: any[]) => { calls.push(['invoices', ...args]); return { items: [invoice] }; },
    getInvoice: async (...args: any[]) => { calls.push(['invoice', ...args]); return invoice; } };
  const react = { createElement: () => ({}), useCallback: (fn: unknown) => fn, useEffect: () => {}, useState: (value: unknown) => [value, () => {}] };
  const modules: Record<string, any> = {
    react, 'react-native': {}, '../api/apiClient': { apiClient: api },
    '../context/AppProviders': { useTheme: () => ({ colors: {} }) },
    '../components/ui': {}, '../components/domain/CommercialUi': {}, '../domain/commercial': {}, '../services/commercialFiles': {},
    '../theme': {}, '../hooks/useCommercialData': { useCommercialData: (loader: unknown, scope: string) => {
      captured = { loader, scope }; return { isAdmin: false, scopeKey: scope }; } },
  };
  const code = ts.transpileModule(readFileSync(new URL(`../src/screens/${screen}Screen.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  exports[`${screen}Screen`]({ route: { params: { installationId: 'job', invoiceId: 'invoice' } }, navigation: {} });
  const authority = {}; return { summary, invoice, calls, scope: captured.scope,
    load: () => captured.loader({ cloudAuthority: authority }), authority };
}

test('actual Financial Summary loader binds authority and rejects a foreign header or cost line', async () => {
  const h = screenLoader('FinancialSummary'); assert.equal(h.scope, 'job'); await h.load();
  assert.deepEqual(h.calls, [['summary', 'job', h.authority]]);
  h.summary.header.installationId = 'other'; await assert.rejects(h.load(), /another installation/);
  h.summary.header.installationId = 'job'; h.summary.lines[0].installationId = 'other'; await assert.rejects(h.load(), /another installation/);
});

test('actual Invoices loader uses one authority for both reads and rejects foreign list entries', async () => {
  const h = screenLoader('Invoices'); assert.equal(h.scope, 'job'); await h.load();
  assert.deepEqual(h.calls, [['invoices', 'job', h.authority], ['summary', 'job', h.authority]]);
  h.invoice.installationId = 'other'; await assert.rejects(h.load(), /another installation/);
});

test('actual Invoice detail scopes both IDs and never presents a different invoice or foreign lines', async () => {
  const h = screenLoader('InvoiceDetail'); assert.equal(h.scope, JSON.stringify(['job', 'invoice'])); await h.load();
  assert.deepEqual(h.calls, [['invoice', 'job', 'invoice', h.authority]]);
  h.invoice.id = 'other'; await assert.rejects(h.load(), /another record/);
  h.invoice.id = 'invoice'; h.invoice.lines[0].invoiceId = 'other'; await assert.rejects(h.load(), /another record/);
});
