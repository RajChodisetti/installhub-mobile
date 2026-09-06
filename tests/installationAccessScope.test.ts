import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadInstallationAccessView } from '../src/domain/supportCloudReads';
import { applyLeasedCloudActionState, runLeasedCloudActionStep } from '../src/services/cloudActionLease';

const screenSource = process.env.ACCESS_SCREEN_SOURCE ?? new URL('../src/screens/InstallationAccessScreen.tsx', import.meta.url);
const code = ts.transpileModule(readFileSync(screenSource, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const same = (a: unknown[] | undefined, b: unknown[]) => Boolean(a && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
const directory = [{ id: 'inspector', fullName: 'Inspector One', email: 'one@example.invalid', role: 'inspector', isActive: true }];
const access = (id: string, assigned: string | null = null): any => ({ installationId: id, ownerUserId: 'owner', assignedInspectorUserId: assigned,
  assignedInspector: assigned ? { ...directory[0], id: assigned, fullName: `Assignment ${assigned}` } : null });

/** Execute the production screen and support loader; control only hook scheduling,
 * navigation lifecycle, authentication and network/native I/O. */
function harness() {
  const slots: any[] = []; let cursor = 0; let dirty = false; let focused = true;
  let installationId = 'a'; let user: any = { id: 'admin', role: 'admin' }; let generation = 1;
  let read: (id: string) => Promise<any> = async (id) => access(id, `${id}-assignee`);
  let usersRead: () => Promise<any> = async () => ({ data: directory });
  let patch: (id: string, assigned: string | null) => Promise<any> = async (id, assigned) => access(id, assigned);
  let captureWait: Promise<void> | undefined; let tree: any;
  const reads: string[] = []; const patches: any[] = []; const alerts: any[][] = []; let directoryReads = 0;
  const captures: any[] = []; const readAuthorities: any[] = []; const directoryAuthorities: any[] = [];
  const react: any = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }]; },
    useRef(initial: any) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(create: () => any, deps: unknown[]) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: create() }; return slots[i].value; },
    useCallback(fn: any, deps: unknown[]) { return react.useMemo(() => fn, deps); },
    useEffect(fn: () => any, deps: unknown[]) { const i = cursor++; const prior = slots[i];
      if (!same(prior?.deps, deps)) slots[i] = { effect: true, deps, fn, pending: true, cleanup: prior?.cleanup }; },
  };
  const jsx = (type: any, props: any, key: any) => ({ type, props, key });
  const native = { Alert: { alert: (...args: any[]) => alerts.push(args) }, StyleSheet: { create: (styles: any) => styles }, Text: 'Text', View: 'View', Pressable: 'Pressable' };
  const modules: Record<string, any> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    '@react-navigation/native': { useFocusEffect: (fn: () => any) => { const i = cursor++; const prior = slots[i];
      if (!prior || prior.fn !== fn) slots[i] = { focus: true, fn, cleanup: prior?.cleanup, pending: true }; } },
    '../components/ui': new Proxy({}, { get: (_target, key) => String(key) }),
    '../context/AppProviders': { useAuth: () => ({ user }), useTheme: () => ({ colors: {} }) },
    '../theme': { spacing: {}, radii: {}, typography: {} },
    '../utils/sourceManagedUsers': { sourceUserDisplayEmail: (value: string) => value, isSourceManagedUser: () => false, isOrphanedSourceUser: () => false, sourceAppDisplayName: () => 'Source' },
    '../domain/supportCloudReads': { loadInstallationAccessView },
    '../services/cloudActionLease': { applyLeasedCloudActionState, runLeasedCloudActionStep },
    '../services/authenticatedCloudAction': { captureAuthenticatedCloudActionLease: async () => {
      const actor = user; const captured = generation;
      const lease = { actorUserId: actor.id, cloudAuthority: { actor: actor.id, generation: captured }, processAuthority: {}, assertCurrent() {
        if (actor !== user || captured !== generation) throw Error('Account/session changed');
      } };
      captures.push(lease);
      if (captureWait) await captureWait; lease.assertCurrent(); return lease;
    } },
    '../api/apiClient': { cloudConnectionErrorMessage: (error: Error) => error.message, apiClient: {
      getInstallationAccess: (id: string, authority: any) => { reads.push(id); readAuthorities.push(authority); return read(id); },
      listUsers: (authority: any) => { directoryReads++; directoryAuthorities.push(authority); return usersRead(); },
      setInstallationAccess: (id: string, assigned: string | null, authority: any) => { patches.push({ id, assigned, authority }); return patch(id, assigned); },
    } },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  const render = () => {
    for (let count = 0; count < 25; count++) {
      dirty = false; cursor = 0; tree = exports.InstallationAccessScreen({ route: { params: { installationId } } });
      for (const effect of slots.filter((s) => s?.pending && (s.effect || (s.focus && focused)))) {
        effect.cleanup?.(); effect.cleanup = effect.fn(); effect.pending = false;
      }
      if (!dirty) return tree;
    }
    throw Error('Screen render did not settle');
  };
  const blur = () => { focused = false; for (const effect of slots.filter((s) => s?.focus)) { effect.cleanup?.(); effect.cleanup = undefined; effect.pending = true; } };
  return { render, reads, patches, alerts, captures, readAuthorities, directoryAuthorities, directoryReads: () => directoryReads,
    flush: async () => { await settle(); return render(); },
    route: (id: string) => { installationId = id; return render(); },
    actor: (id: string, role = 'admin') => { user = { id, role }; generation++; return render(); },
    expire: () => { generation++; return render(); },
    blur, focus: () => { focused = true; return render(); },
    unmount: () => { focused = false; for (const slot of slots) slot?.cleanup?.(); },
    read: (fn: typeof read) => { read = fn; }, usersRead: (fn: typeof usersRead) => { usersRead = fn; }, patch: (fn: typeof patch) => { patch = fn; },
    captureWait: (promise?: Promise<void>) => { captureWait = promise; },
  };
}
function nodes(tree: any): any[] { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
function text(tree: any): string { if (tree == null || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); if (Array.isArray(tree)) return tree.map(text).join(' '); return `${tree.props?.title ?? ''} ${text(tree.props?.children)}`; }
function button(tree: any, title: string) { return nodes(tree).find((node) => node.type === 'Button' && node.props.title === title); }
function select(tree: any, title = 'Inspector One') { const option = nodes(tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel.startsWith(`${title}.`)); assert.ok(option, title); option.props.onPress(); }

test('access rejects a wrong-installation initial response and offers retry without assignment controls', async () => {
  const h = harness(); h.read(async () => access('foreign')); h.render(); const tree = await h.flush();
  assert.equal(button(tree, 'Save access'), undefined); assert.match(text(tree), /different installation/i); assert.ok(button(tree, 'Try again'));
});
test('route replacement immediately hides the previous assignment and cannot save its retained selection', async () => {
  const h = harness(); h.render(); await h.flush(); select(h.render()); const oldSave = button(h.render(), 'Save access').props.onPress;
  const waiting = deferred<any>(); h.read(() => waiting.promise); const tree = h.route('b');
  assert.doesNotMatch(text(tree), /Assignment a-assignee/); assert.equal(button(tree, 'Save access'), undefined);
  oldSave(); await settle(); assert.equal(h.patches.length, 0);
  waiting.resolve(access('b')); await h.flush();
});
test('a late access or directory read cannot replace the new route assignment', async () => {
  for (const boundary of ['access', 'directory']) {
    const h = harness(); const old = deferred<any>();
    if (boundary === 'access') h.read((id) => id === 'a' ? old.promise : Promise.resolve(access(id, 'b-assignee')));
    else { let calls = 0; h.usersRead(() => ++calls === 1 ? old.promise : Promise.resolve({ data: directory })); }
    h.render(); await settle(); h.route('b'); await h.flush();
    old.resolve(boundary === 'access' ? access('a', 'old-assignee') : { data: [{ ...directory[0], fullName: 'Old directory' }] });
    const tree = await h.flush(); assert.match(text(tree), /Assignment b-assignee/); assert.doesNotMatch(text(tree), /Old directory|Assignment old-assignee|Assignment a-assignee/);
  }
});
test('actor replacement and same-account session expiry hide retained assignment and invalidate Save', async () => {
  for (const transition of ['actor', 'session']) {
    const h = harness(); h.render(); await h.flush(); select(h.render()); const save = button(h.render(), 'Save access').props.onPress;
    const pending = deferred<any>(); h.read(() => pending.promise);
    const tree = transition === 'actor' ? h.actor('other-admin') : h.expire();
    assert.doesNotMatch(text(tree), /Assignment a-assignee/); save(); await settle(); assert.equal(h.patches.length, 0);
    pending.resolve(access('a')); await h.flush();
  }
});
test('blur during initial reads suppresses stale success and errors until a fresh focused load', async () => {
  for (const fails of [false, true]) {
    const h = harness(); const old = deferred<any>(); h.read(() => old.promise); h.render(); await settle(); h.blur();
    if (fails) old.reject(Error('Old read failed')); else old.resolve(access('a', 'old-assignee'));
    assert.doesNotMatch(text(await h.flush()), /Old read failed|Assignment old-assignee/); assert.equal(h.alerts.length, 0);
    h.read(async () => access('a', 'fresh-assignee')); h.focus(); assert.match(text(await h.flush()), /Assignment fresh-assignee/);
  }
});
test('blur or route replacement during Save lease capture prevents PATCH dispatch', async () => {
  for (const transition of ['blur', 'route']) {
    const h = harness(); h.render(); await h.flush(); select(h.render()); const waiting = deferred<void>(); h.captureWait(waiting.promise);
    button(h.render(), 'Save access').props.onPress();
    if (transition === 'blur') h.blur(); else h.route('b');
    waiting.resolve(); await h.flush(); assert.equal(h.patches.length, 0); assert.equal(h.alerts.length, 0);
  }
});
test('a stale Save result cannot overwrite the new route, emit alerts or clear its pending action', async () => {
  const h = harness(); h.render(); await h.flush(); select(h.render()); const old = deferred<any>(); h.patch(() => old.promise);
  button(h.render(), 'Save access').props.onPress(); await settle(); assert.equal(h.patches[0].id, 'a');
  h.route('b'); await h.flush(); select(h.render()); const latest = deferred<any>(); h.patch(() => latest.promise);
  button(h.render(), 'Save access').props.onPress(); await settle();
  old.resolve(access('a', 'old-result')); const tree = await h.flush(); assert.ok(button(tree, 'Saving…')); assert.doesNotMatch(text(tree), /old-result/); assert.equal(h.alerts.length, 0);
  latest.resolve(access('b', 'inspector')); await h.flush(); assert.equal(h.alerts[0][0], 'Access updated');
});
test('read-only inspector loads access without the admin directory or PATCH controls', async () => {
  const h = harness(); h.actor('inspector', 'inspector'); const tree = await h.flush();
  assert.match(text(tree), /Assignment a-assignee/); assert.equal(h.directoryReads(), 0); assert.equal(button(tree, 'Save access'), undefined); assert.equal(h.patches.length, 0);
});
test('current admin selection dispatches once with exact installation and captured authority', async () => {
  const h = harness(); h.render(); await h.flush(); select(h.render()); const save = button(h.render(), 'Save access').props.onPress;
  assert.equal(h.readAuthorities[0], h.captures[0].cloudAuthority);
  assert.equal(h.directoryAuthorities[0], h.captures[0].cloudAuthority);
  save(); save(); await h.flush(); assert.equal(h.patches.length, 1); assert.equal(h.patches[0].id, 'a'); assert.equal(h.patches[0].assigned, 'inspector');
  assert.equal(h.patches[0].authority.actor, 'admin'); assert.equal(h.alerts[0][0], 'Access updated');
});
test('current load failure has retry and a successful retry restores only the current assignment', async () => {
  const h = harness(); h.read(async () => { throw Error('Access unavailable'); }); h.render(); let tree = await h.flush();
  assert.match(text(tree), /Access unavailable/); assert.equal(button(tree, 'Save access'), undefined);
  h.read(async () => access('a', 'retry-assignee')); button(tree, 'Try again').props.onPress(); tree = await h.flush();
  assert.match(text(tree), /Assignment retry-assignee/); assert.doesNotMatch(text(tree), /Access unavailable/);
});
test('newest overlapping retry wins over a late success or error from the prior read', async () => {
  for (const fails of [false, true]) {
    const h = harness(); h.read(async () => { throw Error('Retry needed'); }); h.render(); const failed = await h.flush();
    const retry = button(failed, 'Try again').props.onPress; const old = deferred<any>(); const latest = deferred<any>(); let calls = 0;
    h.read(() => ++calls === 1 ? old.promise : latest.promise); retry(); retry(); await settle();
    latest.resolve(access('a', 'latest')); await h.flush();
    if (fails) old.reject(Error('Old retry failed')); else old.resolve(access('a', 'old'));
    const tree = await h.flush(); assert.match(text(tree), /Assignment latest/); assert.doesNotMatch(text(tree), /Assignment old|Old retry failed/);
  }
});
test('wrong-target or inconsistent Save responses cannot report successful assignment', async () => {
  for (const response of [access('other', 'inspector'), access('a', 'other-user'), { ...access('a', 'inspector'), assignedInspector: directory[0] }]) {
    const h = harness(); h.render(); await h.flush(); select(h.render());
    // The third response is intentionally valid, proving exact validation does
    // not reject a server label that differs from the directory label.
    h.patch(async () => response); button(h.render(), 'Save access').props.onPress(); const tree = await h.flush();
    const valid = response.installationId === 'a' && response.assignedInspectorUserId === 'inspector';
    assert.equal(h.alerts.some((args) => args[0] === 'Access updated'), valid);
    assert.equal(Boolean(button(tree, 'Try again')), !valid);
  }
});
test('inconsistent assignment identity is rejected before showing admin controls', async () => {
  const h = harness(); h.read(async () => ({ ...access('a', 'inspector'), assignedInspector: { ...directory[0], id: 'foreign-user' } }));
  h.render(); const tree = await h.flush(); assert.match(text(tree), /does not match its user/); assert.equal(button(tree, 'Save access'), undefined);
});
test('role downgrade rejects retained admin actions and does not fetch the directory for the new inspector view', async () => {
  const h = harness(); h.render(); await h.flush(); select(h.render()); const save = button(h.render(), 'Save access').props.onPress;
  const directoryCount = h.directoryReads(); h.actor('admin', 'inspector'); save(); const tree = await h.flush();
  assert.equal(h.directoryReads(), directoryCount); assert.equal(h.patches.length, 0); assert.equal(button(tree, 'Save access'), undefined);
});
test('pending Save success or rejection after unmount has no UI effects', async () => {
  for (const fails of [false, true]) {
    const h = harness(); h.render(); await h.flush(); select(h.render()); const waiting = deferred<any>(); h.patch(() => waiting.promise);
    button(h.render(), 'Save access').props.onPress(); await settle(); h.unmount();
    if (fails) waiting.reject(Error('Late server error')); else waiting.resolve(access('a', 'inspector'));
    await settle(); assert.equal(h.alerts.length, 0); assert.equal(h.patches.length, 1);
  }
});
test('refocusing the same installation cannot revive its previous Save callback', async () => {
  const h = harness(); h.render(); await h.flush(); select(h.render()); const save = button(h.render(), 'Save access').props.onPress;
  h.blur(); h.focus(); await h.flush(); save(); await settle(); assert.equal(h.patches.length, 0);
});
