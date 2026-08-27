import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Field App authors the new scope, metering type, and custom job number only', () => {
  const source = readFileSync(
    new URL('../src/components/forms/index.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /label="Scope categorization"/);
  assert.match(source, /M1 - New install/);
  assert.match(source, /M2 - Faults \/ COMMS fault/);
  assert.match(source, /M3 - Inspection/);
  assert.match(source, /M4 - BD\/Upselling/);
  assert.match(source, /M5 — Other/);
  assert.match(source, /label="Metering type selection"/);
  assert.match(source, /label="Custom job number"/);
  assert.doesNotMatch(source, /label="Planned meter type"/);
  assert.doesNotMatch(source, /label="Fergus job number"/);
  assert.doesNotMatch(source, /label="Quote number"/);
  assert.doesNotMatch(source, /label="Customer name"/);
  assert.doesNotMatch(source, /fergus_job_number: nullableText/);
  assert.doesNotMatch(source, /quote_number: nullableText/);
});
