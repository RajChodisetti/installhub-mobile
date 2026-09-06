import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCloudVersion } from '../src/domain/cloudVersionSummary';
import { loadInstallationAccessView, loadInventoryView } from '../src/domain/supportCloudReads';
import { costLineInput, financeHeaderInput, invoiceActions, invoicePreview, selectedInvoiceLineIds } from '../src/domain/commercial';
import { editableFieldMembership, filterUnifiedPortalUsers } from '../src/domain/unifiedUsers';
import type { CostLine } from '../src/types/commercial';
import type { InstallationAccess } from '../src/api/apiClient';
import type { UnifiedPortalUser } from '../src/types/unifiedUsers';

test('canonical saved-version envelope shows actual entities and report eligibility, with legacy compatibility', () => {
  const tree = { installation: { siteName: 'Site Alpha' }, zones: [{}, {}], electricalAssets: [{}], siteAssets: [{}], formSubmissions: [{}, {}, {}] };
  assert.deepEqual(inspectCloudVersion({ installationTree: tree, readiness: { eligibility: { authoritativeReport: true } } }), {
    siteName: 'Site Alpha', zones: 2, boards: 1, siteAssets: 1, forms: 3, reportEligibility: 'Authoritative',
  });
  assert.equal(inspectCloudVersion(tree).forms, 3);
  assert.equal(inspectCloudVersion({ installationTree: tree, readiness: { eligibility: { authoritativeReport: false } } }).reportEligibility, 'Diagnostic only');
  assert.throws(() => inspectCloudVersion({ unreadable: true }), /unsupported/);
});

test('inspector maintainer can read and search company stock without an admin-directory request', async () => {
  const requests: string[] = [];
  const result = await loadInventoryView({ scope: 'company', search: ' DD501 ', role: 'inspector' }, {
    getInventoryAccess: async () => ({ userId: 'inspector-1', isMaintainer: true }),
    listInventoryMeters: async (scope, q) => { requests.push(`${scope}:${q ?? ''}`); return { data: [], total: q ? 1 : 501, truncated: !q }; },
    listUsers: async () => { throw new Error('Forbidden: admin-only directory should not be called'); },
  });
  assert.deepEqual(requests, ['company:DD501', 'company:']);
  assert.equal(result.access.isMaintainer, true);
  assert.equal(result.inventory.total, 1);
  assert.equal(result.summary.total, 501);
  assert.equal(result.summary.truncated, true);
  assert.deepEqual(result.users, []);
});

test('ordinary user is scoped to own stock and admin-directory failure does not hide inventory', async () => {
  for (const isMaintainer of [false, true]) {
    const result = await loadInventoryView({ scope: 'company', search: '', role: 'admin' }, {
      getInventoryAccess: async () => ({ userId: 'user', isMaintainer }),
      listInventoryMeters: async () => ({ data: [], total: 12, truncated: false }),
      listUsers: async () => { throw new Error('directory temporarily unavailable'); },
    });
    assert.equal(result.scope, isMaintainer ? 'company' : 'mine');
    assert.equal(result.inventory.total, 12);
  }
});

test('inspector can inspect current access without calling the admin user list', async () => {
  const access = { assignedInspectorUserId: 'field-1' } as InstallationAccess;
  const result = await loadInstallationAccessView('installation-1', 'inspector', {
    getInstallationAccess: async (id) => { assert.equal(id, 'installation-1'); return access; },
    listUsers: async () => { throw new Error('Forbidden'); },
  });
  assert.equal(result.access, access);
  assert.deepEqual(result.users, []);
});

test('invoice selection excludes nonbillable, already invoiced and explicitly unchecked lines', () => {
  const lines = [
    { id: 'ready', billable: true, invoiced: false },
    { id: 'unchecked', billable: true, invoiced: false },
    { id: 'billed', billable: true, invoiced: true },
    { id: 'internal', billable: false, invoiced: false },
  ] as CostLine[];
  assert.deepEqual(selectedInvoiceLineIds(lines, new Set(['unchecked'])), ['ready']);
  assert.deepEqual(invoiceActions('draft'), { issue: true, void: true, download: true });
  assert.equal(invoiceActions('issued').issue, false);
  assert.equal(invoiceActions('paid').issue, false);
  assert.deepEqual(invoiceActions('void'), { issue: false, void: false, download: false });
});

test('cost/pricing payloads retain null optional values and never turn blank required cost into zero', () => {
  assert.throws(() => costLineInput({ category: 'labour', description: 'Work', cost: ' ', sell: '' }), /Cost is required/);
  assert.throws(() => costLineInput({ category: 'labour', description: 'Work', cost: 'Infinity', sell: '' }), /valid number/);
  assert.deepEqual(costLineInput({ category: 'labour', description: ' Work ', cost: '10.25', sell: '' }), {
    category: 'labour', description: 'Work', costAmount: 10.25, sellAmount: null, billable: true,
  });
  assert.deepEqual(financeHeaderInput('charge_up', '', ' '), { pricingMode: 'charge_up', pricedAmount: null, notes: null });
});

test('unified directory supports cross-app search and does not edit a source projection', () => {
  const user = { key: 'u', identityIds: [], displayEmail: 'name@example.com', fullName: 'Example', candidateKey: null, possibleDuplicateCount: 0, syncStatus: 'synced', memberships: [{ app: 'installhub', userId: 'field', email: 'name@example.com', fullName: 'Example', identityId: null, role: 'inspector', isActive: true, isSourceProjection: true, sourceApp: 'solarsense', sourceUserId: 'solar', createdAt: '', updatedAt: '' }] } satisfies UnifiedPortalUser;
  assert.equal(filterUnifiedPortalUsers([user], 'Solar Sense').length, 1);
  assert.equal(editableFieldMembership(user), undefined);
});

test('native commercial inputs enforce nonnegative cent prices', () => {
  assert.throws(() => financeHeaderInput('quoted', '-0.01', ''), /negative/);
  assert.throws(() => financeHeaderInput('quoted', '1.001', ''), /increments of 0.01/);
  assert.throws(() => costLineInput({ category: 'labour', description: 'Work', cost: '10', sell: '-1' }), /negative/);
});

test('quick invoice preview uses selected sell amounts with cost fallback and cent-rounded GST', () => {
  const lines = [
    { id: 'sell', billable: true, invoiced: false, costAmount: 10, sellAmount: 12.34 },
    { id: 'fallback', billable: true, invoiced: false, costAmount: 7.65, sellAmount: null },
    { id: 'billed', billable: true, invoiced: true, costAmount: 1000, sellAmount: 5000 },
  ] as CostLine[];
  const preview = invoicePreview(lines, new Set());
  assert.equal(preview.gst, 2);
  assert.equal(preview.total, 21.99);
  assert.equal(invoicePreview(lines, new Set(['sell'])).total, 8.42);
});
