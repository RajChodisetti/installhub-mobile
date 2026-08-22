import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyLeasedCloudActionState,
  captureExactCloudActionLease,
  runLeasedCloudActionStep,
  type ExactCloudActionLeaseDependencies,
} from '../src/services/cloudActionLease';

type TestAuthority = {
  actorUserId: string;
  generation: number;
};

function authorityHarness() {
  let actorUserId = 'actor-a';
  let processGeneration = 1;
  let cloudGeneration = 1;

  const dependencies: ExactCloudActionLeaseDependencies<
    TestAuthority,
    TestAuthority
  > = {
    captureProcessAuthority: () => ({ actorUserId, generation: processGeneration }),
    actorForCurrentProcessAuthority: (authority) => (
      authority.actorUserId === actorUserId
      && authority.generation === processGeneration
        ? actorUserId
        : null
    ),
    captureCloudAuthority: async () => ({ actorUserId, generation: cloudGeneration }),
    assertCurrentProcessAuthority: (authority, expectedActorUserId) => {
      if (
        authority.actorUserId !== expectedActorUserId
        || authority.actorUserId !== actorUserId
        || authority.generation !== processGeneration
      ) {
        throw new Error('process authority changed');
      }
    },
    assertCurrentCloudAuthority: (authority, expectedActorUserId) => {
      if (
        authority.actorUserId !== expectedActorUserId
        || authority.actorUserId !== actorUserId
        || authority.generation !== cloudGeneration
      ) {
        throw new Error('cloud authority changed');
      }
    },
    missingProcessAuthorityError: () => new Error('missing process authority'),
    missingCloudAuthorityError: () => new Error('missing cloud authority'),
  };

  return {
    dependencies,
    replaceActor(nextActorUserId: string) {
      actorUserId = nextActorUserId;
      processGeneration += 1;
      cloudGeneration += 1;
    },
  };
}

test('A to B while cloud authority capture is held prevents any request', async () => {
  const harness = authorityHarness();
  let releaseCloudCapture!: () => void;
  const cloudCaptureHeld = new Promise<void>((resolve) => {
    releaseCloudCapture = resolve;
  });
  harness.dependencies.captureCloudAuthority = async () => {
    await cloudCaptureHeld;
    return { actorUserId: 'actor-b', generation: 2 };
  };
  let requests = 0;

  const action = (async () => {
    const lease = await captureExactCloudActionLease(harness.dependencies);
    await runLeasedCloudActionStep(lease, async () => {
      requests += 1;
    });
  })();

  harness.replaceActor('actor-b');
  releaseCloudCapture();
  await assert.rejects(action, /process authority changed/);
  assert.equal(requests, 0);
});

test('A to B during a held local pre-dispatch await prevents the cloud request', async () => {
  const harness = authorityHarness();
  const lease = await captureExactCloudActionLease(harness.dependencies);
  let releasePreparation!: () => void;
  const preparationHeld = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  let preparationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    preparationStarted = resolve;
  });
  let requests = 0;

  const action = (async () => {
    await runLeasedCloudActionStep(lease, async () => {
      preparationStarted();
      await preparationHeld;
    });
    await runLeasedCloudActionStep(lease, async () => {
      requests += 1;
    });
  })();

  await started;
  harness.replaceActor('actor-b');
  releasePreparation();
  await assert.rejects(action, /process authority changed/);
  assert.equal(requests, 0);
});

test('A to B during a held response cannot apply or roll back state as B', async () => {
  const harness = authorityHarness();
  const lease = await captureExactCloudActionLease(harness.dependencies);
  let releaseResponse!: () => void;
  const responseHeld = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  let applied = 0;
  let rolledBack = 0;

  const action = (async () => {
    try {
      const response = await runLeasedCloudActionStep(lease, async () => {
        requestStarted();
        await responseHeld;
        return { accepted: true };
      });
      applyLeasedCloudActionState(lease, () => {
        if (response.accepted) applied += 1;
      });
    } catch (error) {
      await runLeasedCloudActionStep(lease, async () => {
        rolledBack += 1;
      }).catch(() => {});
      throw error;
    }
  })();

  await started;
  harness.replaceActor('actor-b');
  releaseResponse();
  await assert.rejects(action, /process authority changed/);
  assert.equal(applied, 0);
  assert.equal(rolledBack, 0);
});

test('reopen, delete, and access PATCH wire the exact lease through API and local state', () => {
  const api = readFileSync(
    new URL('../src/api/apiClient.ts', import.meta.url),
    'utf8',
  );
  const deleteMethod = api.slice(
    api.indexOf('  deleteInstallationCloud:'),
    api.indexOf('  getInstallationReadiness:', api.indexOf('  deleteInstallationCloud:')),
  );
  const reopenMethod = api.slice(
    api.indexOf('  reopenInstallation:'),
    api.indexOf('  putInstallationActiveTimeSession:', api.indexOf('  reopenInstallation:')),
  );
  const accessMethod = api.slice(
    api.indexOf('  setInstallationAccess:'),
    api.indexOf('  listInstallationFiles:', api.indexOf('  setInstallationAccess:')),
  );
  for (const method of [deleteMethod, reopenMethod, accessMethod]) {
    assert.match(method, /authority\?: CloudSessionAuthority/);
    assert.match(method, /request<[\s\S]*authority/);
  }

  const detail = readFileSync(
    new URL('../src/screens/InstallationDetailScreen.tsx', import.meta.url),
    'utf8',
  );
  const reopen = detail.slice(
    detail.indexOf('  async function reopenInstallation()'),
    detail.indexOf('\n  function openGridEditor', detail.indexOf('  async function reopenInstallation()')),
  );
  const disable = detail.slice(
    detail.indexOf('  async function disableCloudBackup('),
    detail.indexOf('\n  function confirmRemoveCloudCopy', detail.indexOf('  async function disableCloudBackup(')),
  );
  assert.ok(
    reopen.indexOf('captureAuthenticatedCloudActionLease()')
      < reopen.indexOf('getPendingCompleteBackupAttempt'),
  );
  assert.match(reopen, /reopenInstallation\([\s\S]*actionLease!\.cloudAuthority/);
  assert.match(reopen, /applyServerState\([\s\S]*actorUserId: actionLease!\.actorUserId/);
  assert.match(reopen, /expectedLocalTreeRevision: reopenLocalTreeRevision/);
  assert.match(reopen, /expectedTreeWatermark: reopenTreeWatermark/);
  assert.match(reopen, /expectedServerTreeRevision: reopenServerTreeRevision/);
  assert.match(reopen, /assertCurrent: actionLease!\.assertCurrent/);
  assert.ok(
    disable.indexOf('captureAuthenticatedCloudActionLease()')
      < disable.indexOf('getPendingCompleteBackupAttempt'),
  );
  assert.match(disable, /deleteInstallationCloud\([\s\S]*actionLease!\.cloudAuthority/);
  assert.match(disable, /setCloudBackupEnabled\([\s\S]*actionLease!\.processAuthority/);
  assert.match(disable, /disabledLocally[\s\S]*runLeasedCloudActionStep\([\s\S]*true,[\s\S]*processAuthority/);

  for (const [filename, methodName] of [
    ['RemoteInstallationsScreen.tsx', 'deleteInstallationCloud'],
    ['InstallationAccessScreen.tsx', 'setInstallationAccess'],
  ] as const) {
    const screen = readFileSync(
      new URL(`../src/screens/${filename}`, import.meta.url),
      'utf8',
    );
    assert.ok(
      screen.indexOf('captureAuthenticatedCloudActionLease()')
        < screen.indexOf(`apiClient.${methodName}(`),
      filename,
    );
    assert.match(screen, new RegExp(`${methodName}\\([\\s\\S]*actionLease!\\.cloudAuthority`));
    assert.match(screen, /applyLeasedCloudActionState\(/);
  }

  const repository = readFileSync(
    new URL('../src/repositories/index.ts', import.meta.url),
    'utf8',
  );
  for (const methodName of ['update', 'setCloudBackupEnabled', 'applyServerState']) {
    const start = repository.indexOf(`  async ${methodName}(`);
    const end = repository.indexOf('\n  async ', start + 1);
    const method = repository.slice(start, end);
    assert.match(method, /authority/);
    assert.match(
      method,
      /assertAssignedWorkMutationAllowed\(installation, (?:authority|mutationAuthority)\)/,
    );
  }
});
