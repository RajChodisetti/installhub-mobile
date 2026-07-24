import assert from 'node:assert/strict';
import test from 'node:test';
import { copyName, nextCopyIndex } from '../src/repositories/copyNaming';

test('imported installation copies use the next durable cp suffix', () => {
  assert.equal(nextCopyIndex([]), 1);
  assert.equal(nextCopyIndex([{ copy_index: 1 }, { copy_index: 2 }]), 3);
  assert.equal(nextCopyIndex([{ copy_index: 2 }]), 3);
  assert.equal(copyName('Main Switchroom', 3), 'Main Switchroom cp3');
});
