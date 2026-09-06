import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the screen's actual initial-read effect with repository/state doubles.
// This keeps the check independent of a native renderer and avoids a second loader implementation.
const screen = ts.createSourceFile(
  'FormEditorScreen.tsx',
  readFileSync(new URL('../src/screens/FormEditorScreen.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect: ts.Node | undefined;
function findInitialRead(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(screen) === 'useEffect'
    && node.arguments[0]?.getText(screen).includes('formsRepo.getById(formId)')) {
    effect = node.arguments[0];
  }
  ts.forEachChild(node, findInitialRead);
}
findInitialRead(screen);
assert.ok(effect, 'Form editor initial read effect exists');
const effectCode = ts.transpileModule(`const initialRead = ${effect.getText(screen)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const sample = (id = 'form-a') => ({
  id, installation_id: 'installation-a', form_type: 'ww-installation',
  status: 'Draft', schema_version: 2, answers: { device_id: 'captured-device' },
  attachments: [{ id: 'photo-a' }],
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness() {
  const state: Record<string, unknown> = {};
  const initialized = { current: false };
  const mounted = { current: true };
  const scope: Record<string, unknown> = {
    initialized, mounted, formId: 'form-a', installationId: 'installation-a',
    formsRepo: { getById: async () => sample() },
    electricalAssetsRepo: { getById: async () => null },
    zonesRepo: { getById: async () => null },
    canonicalInstallationRepo: { gridSupplies: async () => [] },
    FORM_DEFINITION_BY_TYPE: { 'ww-installation': {} },
    canonicalNmiForBoard: () => '',
    withMirroredDeviceIdentityAnswers: (answers: unknown) => answers,
    answersWithCanonicalBoardContext: (answers: unknown) => answers,
    supportedFormAnswers: (_type: unknown, answers: unknown) => answers,
  };
  for (const key of ['Loading', 'LoadError', 'Form', 'CanonicalBoard', 'CanonicalZoneName', 'CanonicalNmi', 'Answers', 'Attachments']) {
    scope[`set${key}`] = (value: unknown) => { state[key] = value; };
  }
  const start = () => {
    const initialRead = new Function(...Object.keys(scope), `${effectCode}\nreturn initialRead;`)(...Object.values(scope));
    return initialRead() as () => void;
  };
  return { scope, state, initialized, mounted, start };
}

test('missing form finishes loading with an actionable error and never initializes the editor', async () => {
  const h = harness();
  h.scope.formsRepo = { getById: async () => null };
  h.start();
  await settle();
  assert.equal(h.state.Loading, false);
  assert.match(String(h.state.LoadError), /no longer available/);
  assert.equal(h.initialized.current, false);
  assert.equal(h.state.Form, undefined);
});

test('initial repository and linked-board failures are caught; retry can load the captured draft', async () => {
  for (const failure of ['form', 'board']) {
    const h = harness();
    h.scope.formsRepo = { getById: async () => {
      if (failure === 'form') throw new Error('Storage read failed');
      return { ...sample(), board_id: 'board-a' };
    } };
    h.scope.electricalAssetsRepo = { getById: async () => { throw new Error('Storage read failed'); } };
    h.start();
    await settle();
    assert.equal(h.state.LoadError, 'Storage read failed');
    assert.equal(h.state.Loading, false);
    assert.equal(h.initialized.current, false);
    h.scope.formsRepo = { getById: async () => sample() };
    h.start();
    await settle();
    assert.equal(h.state.LoadError, null);
    assert.equal(h.state.Loading, false);
    assert.deepEqual(h.state.Answers, sample().answers);
    assert.deepEqual(h.state.Attachments, sample().attachments);
    assert.equal(h.initialized.current, true);
  }
});

test('foreign-installation and unsupported forms fail without publishing an editor', async () => {
  for (const item of [
    { ...sample(), installation_id: 'other-installation' },
    { ...sample(), form_type: 'unknown-form' },
  ]) {
    const h = harness();
    h.scope.formsRepo = { getById: async () => item };
    h.start();
    await settle();
    assert.equal(h.state.Loading, false);
    assert.match(String(h.state.LoadError), /does not belong|not supported/);
    assert.equal(h.initialized.current, false);
    assert.equal(h.state.Form, undefined);
  }
});

test('an old read cannot overwrite a newer editor after effect cleanup', async () => {
  const h = harness();
  const oldRead = deferred<ReturnType<typeof sample>>();
  h.scope.formsRepo = { getById: () => oldRead.promise };
  const cleanup = h.start();
  cleanup();
  h.scope.formId = 'form-b';
  h.scope.formsRepo = { getById: async () => sample('form-b') };
  h.start();
  await settle();
  h.state.Answers = { device_id: 'new-editor-change' };
  oldRead.resolve(sample());
  await settle();
  assert.equal((h.state.Form as { id: string }).id, 'form-b');
  assert.deepEqual(h.state.Answers, { device_id: 'new-editor-change' });
  assert.equal(h.state.LoadError, null);
  assert.equal(h.state.Loading, false);
});

test('unmount during linked reads publishes neither late errors nor editor state', async () => {
  const h = harness();
  const boardRead = deferred<null>();
  h.scope.formsRepo = { getById: async () => ({ ...sample(), board_id: 'board-a' }) };
  h.scope.electricalAssetsRepo = { getById: () => boardRead.promise };
  const cleanup = h.start();
  await settle();
  cleanup();
  h.mounted.current = false;
  const before = { ...h.state };
  boardRead.reject(new Error('Late read failed'));
  await settle();
  assert.deepEqual(h.state, before);
  assert.equal(h.initialized.current, false);
});
