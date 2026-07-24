import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { createDraftAutosaveCoordinator } from '../src/services/draftAutosave';

test('navigation flush saves only the latest draft revision before the debounce expires', async () => {
  const saved: Array<{ caption: string }> = [];
  const pending: boolean[] = [];
  const coordinator = createDraftAutosaveCoordinator({
    delayMs: 20,
    persist: async (snapshot: { caption: string }) => {
      saved.push(snapshot);
      return snapshot;
    },
    onPendingChange: (value) => pending.push(value),
  });

  coordinator.schedule({ caption: 'First caption' });
  coordinator.schedule({ caption: 'Latest caption' });
  await coordinator.flush();
  await wait(40);

  assert.deepEqual(saved, [{ caption: 'Latest caption' }]);
  assert.equal(pending.at(-1), false);
});

test('canceling a pending save before draft deletion prevents a delayed recreation', async () => {
  const saved: string[] = [];
  const coordinator = createDraftAutosaveCoordinator({
    delayMs: 20,
    persist: async (caption: string) => {
      saved.push(caption);
      return caption;
    },
  });

  coordinator.schedule('must not be saved');
  await coordinator.cancelPending();
  await wait(40);
  assert.deepEqual(saved, []);

  coordinator.schedule('autosave remains usable if deletion is aborted');
  await coordinator.flush();
  assert.deepEqual(saved, ['autosave remains usable if deletion is aborted']);
});

test('disposing on a true unmount cancels pending work without persisting it', async () => {
  const saved: string[] = [];
  const coordinator = createDraftAutosaveCoordinator({
    delayMs: 20,
    persist: async (caption: string) => {
      saved.push(caption);
      return caption;
    },
  });

  coordinator.schedule('unmounted caption');
  await coordinator.dispose();
  await wait(40);

  assert.deepEqual(saved, []);
});
