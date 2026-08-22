import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import {
  assertCurrentCloudSessionAuthority,
  captureCloudSessionAuthority,
} from '../api/apiClient';
import { runCloudBackup, type CloudBackupRunAuthority } from './syncService';
import { getStore, initStore } from '../data/seed';
import { syncActiveTimeSessions } from './activeTimeSync';
import {
  assertCurrentAssignedWorkAuthority,
  bootstrapHeadlessAssignedWorkAuthority,
} from './assignedWorkMutationGuard';

const TASK_NAME = 'installhub-cloud-backup';

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      await initStore();
      const cloudAuthority = await captureCloudSessionAuthority();
      if (!cloudAuthority) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      assertCurrentCloudSessionAuthority(
        cloudAuthority,
        cloudAuthority.actorUserId,
      );
      const persistedActorUserId = getStore().user.id;
      const assignedWorkAuthority = bootstrapHeadlessAssignedWorkAuthority(
        cloudAuthority.actorUserId,
        persistedActorUserId,
      );
      assertCurrentCloudSessionAuthority(
        cloudAuthority,
        cloudAuthority.actorUserId,
      );
      assertCurrentAssignedWorkAuthority(
        assignedWorkAuthority,
        cloudAuthority.actorUserId,
      );
      if (getStore().user.id !== cloudAuthority.actorUserId) {
        throw new Error('The persisted background actor changed.');
      }
      const backupAuthority: CloudBackupRunAuthority = {
        identity: assignedWorkAuthority,
        actorUserId: cloudAuthority.actorUserId,
        cloudAuthority,
        assignedWorkAuthority,
        assertAdditionalAuthority: () => {
          assertCurrentAssignedWorkAuthority(
            assignedWorkAuthority,
            cloudAuthority.actorUserId,
          );
          if (getStore().user.id !== cloudAuthority.actorUserId) {
            throw new Error('The persisted background actor changed.');
          }
        },
      };
      const result = await runCloudBackup(undefined, backupAuthority);
      assertCurrentCloudSessionAuthority(
        cloudAuthority,
        cloudAuthority.actorUserId,
      );
      if (result.phase === 'done') {
        await syncActiveTimeSessions(cloudAuthority.actorUserId, cloudAuthority);
      }
      return result.phase === 'done'
        ? BackgroundTask.BackgroundTaskResult.Success
        : BackgroundTask.BackgroundTaskResult.Failed;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerCloudBackupTask(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
}
