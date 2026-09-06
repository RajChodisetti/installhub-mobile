import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual UI handler with controlled picker/store/refresh boundaries.
const source = readFileSync(new URL('../src/screens/ZoneWorkspaceScreen.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ZoneWorkspaceScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = '';
function findHandler(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'addPhoto' && node.initializer) {
    handler = node.initializer.getText(parsed);
  }
  ts.forEachChild(node, findHandler);
}
findHandler(parsed);
assert.ok(handler);

for (const failure of ['picker', 'save', 'refresh', 'none'] as const) {
  test(`zone photo ${failure} outcome preserves committed evidence`, async () => {
    const deleted: string[] = [];
    const alerts: string[] = [];
    let persisted = false;
    const picker = async () => {
      if (failure === 'picker') throw new Error('Permission denied');
      return 'file:///new-photo.jpg';
    };
    const exports: { invoke?: (source: 'library') => Promise<void> } = {};
    const code = ts.transpileModule(`export const invoke = ${handler};`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      exports, Error,
      zone: { photos: ['file:///old-photo.jpg'] }, zoneId: 'qa-zone',
      pickLocalPhoto: picker, takeLocalPhoto: picker,
      zonesRepo: { update: async (_id: string, values: { photos: string[] }) => {
        if (failure === 'save') throw new Error('Save denied');
        assert.equal(values.photos.join(','), 'file:///old-photo.jpg,file:///new-photo.jpg');
        persisted = true;
      } },
      refresh: async () => { if (failure === 'refresh') throw new Error('Refresh unavailable'); },
      deleteLocalPhoto: (uri: string) => { deleted.push(uri); },
      Alert: { alert: (title: string) => { alerts.push(title); } },
    });
    await exports.invoke!('library');
    assert.equal(persisted, failure === 'refresh' || failure === 'none');
    assert.deepEqual(deleted, failure === 'save' ? ['file:///new-photo.jpg'] : []);
    assert.deepEqual(alerts, failure === 'none' ? [] : [failure === 'refresh' ? 'Photo saved; refresh failed' : 'Photo not added']);
  });
}
