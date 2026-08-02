import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { hasStoredCloudSession } from '../api/apiClient';
import { runCloudBackup } from './syncService';

const TASK_NAME = 'installhub-cloud-backup';

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      if (!await hasStoredCloudSession()) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      const result = await runCloudBackup();
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
