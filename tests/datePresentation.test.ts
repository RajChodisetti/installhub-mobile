import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate } from '../src/utils';

test('calendar dates keep the recorded day on devices west and east of UTC', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['America/Phoenix', 'Australia/Sydney', 'Pacific/Honolulu']) {
      process.env.TZ = zone;
      const expected = new Date(2026, 8, 5, 12).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      });
      assert.equal(formatDate('2026-09-05'), expected, zone);
    }
    process.env.TZ = 'America/Phoenix';
    assert.notEqual(formatDate('2026-09-05T00:00:00.000Z'), formatDate('2026-09-05'));
    assert.equal(formatDate('2026-02-30'), '2026-02-30');
    assert.equal(formatDate(), '—');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
