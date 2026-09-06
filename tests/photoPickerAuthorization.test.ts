import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as ownedMediaPaths from '../src/services/ownedMediaPaths';

function loadMediaService(name: 'formMedia' | 'localMedia', platform = 'ios') {
  const calls: string[] = [];
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = parts.map(String).join('/'); }
    create() { calls.push('directory'); }
    toString() { return this.uri; }
  }
  class File extends Directory {
    exists = true;
    copy() { calls.push('copy'); }
    delete() { calls.push('delete'); }
  }
  const mocks: Record<string, unknown> = {
    './ownedMediaPaths': ownedMediaPaths,
    'react-native': { Platform: { OS: platform } },
    'expo-image-picker': {
      requestCameraPermissionsAsync: async () => { calls.push('camera-permission'); return { granted: false }; },
      requestMediaLibraryPermissionsAsync: async () => { calls.push('library-permission'); return { granted: false }; },
      launchCameraAsync: async () => { calls.push('camera'); throw new Error('Denied camera must not launch'); },
      launchImageLibraryAsync: async () => {
        calls.push('picker');
        return { canceled: false, assets: [{ uri: 'file:///selected-synthetic.jpg' }] };
      },
    },
    'expo-file-system': { Directory, File, Paths: { document: 'file:///documents' } },
    'expo-image-manipulator': {
      SaveFormat: { JPEG: 'jpeg' },
      manipulateAsync: async (uri: string) => {
        assert.equal(uri, 'file:///selected-synthetic.jpg');
        calls.push('process'); return { uri: 'file:///processed.jpg' };
      },
    },
    '../utils': { createId: () => 'qa-photo', nowIso: () => '2026-09-05T12:00:00.000Z' },
  };
  const code = ts.transpileModule(
    readFileSync(new URL(`../src/services/${name}.ts`, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports: Record<string, (...args: string[]) => Promise<unknown>> = {};
  vm.runInNewContext(code, {
    exports,
    require: (dependency: string) => {
      assert.ok(dependency in mocks, `Unmocked native boundary ${dependency}`);
      return mocks[dependency];
    },
  });
  const pick = () => name === 'formMedia'
    ? exports.addFormPhoto!('qa-form', 'meter.face', 'library')
    : exports.pickLocalPhoto!();
  const capture = () => name === 'formMedia'
    ? exports.addFormPhoto!('qa-form', 'meter.face', 'camera')
    : exports.takeLocalPhoto!();
  return { calls, pick, capture };
}

for (const service of ['formMedia', 'localMedia'] as const) {
  test(`${service}: iOS picker preserves chosen evidence without broad library permission`, async () => {
    const { calls, pick } = loadMediaService(service);
    const result = await pick();
    assert.ok(result);
    assert.ok(calls.includes('picker'));
    assert.ok(calls.includes('copy'), 'selected photo is copied into persistent app storage');
    assert.ok(!calls.includes('library-permission'));
    assert.ok(!calls.includes('camera-permission'));
  });
  test(`${service}: denying camera permission prevents capture`, async () => {
    const { calls, capture } = loadMediaService(service);
    await assert.rejects(capture, /Camera access is required/);
    assert.deepEqual(calls, ['camera-permission']);
  });
  test(`${service}: non-iOS permission behavior remains unchanged`, async () => {
    const { calls, pick } = loadMediaService(service, 'android');
    assert.equal(await pick(), null);
    assert.deepEqual(calls, ['library-permission']);
  });
}
