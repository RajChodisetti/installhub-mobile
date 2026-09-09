const SCHEDULER_NOTIFICATION_KINDS = new Set([
  'assigned',
  'changed',
  'assignment_removed',
  'cancelled',
  'manual_reminder',
  'one_day_before',
  'one_hour_before',
  'day_of',
]);

export type InstallHubSchedulerNotificationData = {
  type: 'scheduler';
  notificationKind:
    | 'assigned'
    | 'changed'
    | 'assignment_removed'
    | 'cancelled'
    | 'manual_reminder'
    | 'one_day_before'
    | 'one_hour_before'
    | 'day_of';
  eventId: string;
  sourceApp: 'installhub';
  sourceType: 'installation';
  sourceId: string;
  scheduledStartAt: string;
};

type NotificationLike = {
  request: {
    identifier?: string;
    content: {
      data?: Record<string, unknown>;
    };
  };
};

type NotificationResponseLike = {
  notification: NotificationLike;
};

type NotificationSubscriptionLike = {
  remove: () => void;
};

export interface SchedulerNotificationListenerDependencies {
  addNotificationReceivedListener: (
    listener: (notification: NotificationLike) => void,
  ) => NotificationSubscriptionLike;
  addNotificationResponseReceivedListener: (
    listener: (response: NotificationResponseLike) => void,
  ) => NotificationSubscriptionLike;
  getLastNotificationResponse: () => Promise<NotificationResponseLike | null>;
  clearLastNotificationResponse: () => Promise<void>;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

export function isInstallHubSchedulerNotificationData(
  value: unknown,
): value is InstallHubSchedulerNotificationData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.type === 'scheduler'
    && SCHEDULER_NOTIFICATION_KINDS.has(String(data.notificationKind ?? ''))
    && nonEmptyText(data.eventId)
    && data.sourceApp === 'installhub'
    && data.sourceType === 'installation'
    && nonEmptyText(data.sourceId)
    && nonEmptyText(data.scheduledStartAt);
}

/**
 * Refreshes assigned work for live receipts, notification interactions, and
 * the response that launched a cold app. The caller owns actor/session fencing.
 */
export function listenForInstallHubSchedulerNotifications(
  dependencies: SchedulerNotificationListenerDependencies,
  requestRefresh: (notification: InstallHubSchedulerNotificationData) => void,
): () => void {
  let active = true;
  const handledRequestIds = new Set<string>();
  const handleNotification = (notification: NotificationLike): boolean => {
    if (!active) return false;
    if (!isInstallHubSchedulerNotificationData(notification.request.content.data)) {
      return false;
    }
    const data = notification.request.content.data;
    const requestId = notification.request.identifier?.trim();
    if (requestId && handledRequestIds.has(requestId)) return true;
    if (requestId) handledRequestIds.add(requestId);
    requestRefresh(data);
    return true;
  };

  const received = dependencies.addNotificationReceivedListener((notification) => {
    handleNotification(notification);
  });
  let responded: NotificationSubscriptionLike;
  try {
    responded = dependencies.addNotificationResponseReceivedListener((response) => {
      handleNotification(response.notification);
    });
  } catch (error) {
    received.remove();
    throw error;
  }

  void dependencies.getLastNotificationResponse()
    .then(async (lastResponse) => {
      if (!lastResponse || !handleNotification(lastResponse.notification)) return;
      await dependencies.clearLastNotificationResponse();
    })
    // A native response lookup must not prevent app use or live listeners.
    .catch(() => {});

  return () => {
    active = false;
    received.remove();
    responded.remove();
  };
}
