import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanConsequenceHint } from '../src/domain/accessibilityCopy';

test('every boolean switch can announce the consequence of its next state', () => {
  assert.equal(
    booleanConsequenceHint('Safe to proceed?', false),
    'Turning this on records Yes for “Safe to proceed?”.',
  );
  assert.equal(
    booleanConsequenceHint('Additional hazards?', true),
    'Turning this off records No for “Additional hazards?”.',
  );
});
