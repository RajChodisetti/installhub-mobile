import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStore } from '../src/data/seed';
import type { AppDataStore, FormSubmission, FormValue } from '../src/types';

function restart(type: FormSubmission['form_type'], answers: Record<string, FormValue>) {
  const form: FormSubmission = {
    id: 'qa-form', installation_id: 'qa-installation', form_type: type,
    schema_version: 1, status: 'Draft', answers, attachments: [],
    created_at: '2026-09-05T00:00:00.000Z', updated_at: '2026-09-05T00:00:00.000Z',
  };
  const stored: Partial<AppDataStore> = { formSubmissions: [form] };
  const once = normalizeStore(JSON.parse(JSON.stringify(stored)));
  const twice = normalizeStore(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice.formSubmissions[0]?.answers, once.formSubmissions[0]?.answers);
  return twice.formSubmissions[0]!.answers;
}

test('actual startup normalization retains distinct serial and site tag for every WW family', () => {
  for (const type of ['ww-installation', 'a3rm-installation', 'a6m-installation'] as const) {
    const answers = { 'device.id': 'QA-SERIAL', 'device.number': 'QA-SITE-TAG', 'unrelated.note': 'retain' };
    assert.deepEqual(restart(type, answers), answers);
  }
});

test('actual startup normalization retains both old and replacement Comms site tags', () => {
  const answers = {
    'existing.device_id': 'OLD-SERIAL', 'existing.device_number': 'OLD-TAG',
    'works.new_device_id': 'NEW-SERIAL', 'works.new_device_number': 'NEW-TAG',
  };
  assert.deepEqual(restart('comms-fault', answers), answers);
});

test('legacy missing identities are seeded without overwriting an explicitly blank optional tag', () => {
  assert.deepEqual(restart('ww-installation', { 'device.number': 'LEGACY-SERIAL' }), {
    'device.id': 'LEGACY-SERIAL', 'device.number': 'LEGACY-SERIAL',
  });
  assert.deepEqual(restart('ww-installation', { 'device.id': 'SERIAL', 'device.number': '' }), {
    'device.id': 'SERIAL', 'device.number': '',
  });
  const comms = restart('comms-fault', { 'existing.serial_number': 'OLD', 'works.new_serial': 'NEW' });
  assert.equal(comms['existing.device_id'], 'OLD');
  assert.equal(comms['existing.device_number'], 'OLD');
  assert.equal(comms['works.new_device_id'], 'NEW');
  assert.equal(comms['works.new_device_number'], 'NEW');
});
