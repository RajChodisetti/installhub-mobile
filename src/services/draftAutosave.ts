export interface DraftAutosaveCoordinator<TSnapshot, TResult> {
  schedule(snapshot: TSnapshot): void;
  flush(): Promise<TResult | null>;
  cancelPending(): Promise<void>;
  dispose(): Promise<void>;
}

interface DraftAutosaveOptions<TSnapshot, TResult> {
  delayMs: number;
  persist: (snapshot: TSnapshot) => Promise<TResult>;
  onPendingChange?: (pending: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onPersisted?: (result: TResult) => void;
  onError?: (error: unknown) => void;
}

interface PendingSnapshot<TSnapshot> {
  revision: number;
  value: TSnapshot;
}

export function createDraftAutosaveCoordinator<TSnapshot, TResult>({
  delayMs,
  persist,
  onPendingChange,
  onSavingChange,
  onPersisted,
  onError,
}: DraftAutosaveOptions<TSnapshot, TResult>): DraftAutosaveCoordinator<TSnapshot, TResult> {
  let revision = 0;
  let savedRevision = 0;
  let cancelledThroughRevision = 0;
  let latest: PendingSnapshot<TSnapshot> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let saveChain: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const isPending = () =>
    !disposed
    && latest !== null
    && latest.revision > savedRevision
    && latest.revision > cancelledThroughRevision;

  const queuePersist = (snapshot: PendingSnapshot<TSnapshot>): Promise<TResult | null> => {
    const operation = saveChain.then(async () => {
      if (
        disposed
        || snapshot.revision <= savedRevision
        || snapshot.revision <= cancelledThroughRevision
      ) {
        return null;
      }

      try {
        const result = await persist(snapshot.value);
        savedRevision = Math.max(savedRevision, snapshot.revision);
        if (!disposed && snapshot.revision > cancelledThroughRevision) {
          if (latest?.revision === snapshot.revision) {
            latest = null;
            onPersisted?.(result);
          }
          onPendingChange?.(isPending());
          onSavingChange?.(isPending());
        }
        return result;
      } catch (error) {
        if (!disposed && latest?.revision === snapshot.revision) {
          onSavingChange?.(false);
          onError?.(error);
        }
        throw error;
      }
    });
    saveChain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  return {
    schedule(value) {
      if (disposed) return;
      revision += 1;
      latest = { revision, value };
      clearTimer();
      onPendingChange?.(true);
      onSavingChange?.(true);
      const scheduled = latest;
      timer = setTimeout(() => {
        timer = null;
        void queuePersist(scheduled).catch(() => {
          // The coordinator reports failures through onError and keeps the
          // latest revision pending so a navigation flush can retry it.
        });
      }, delayMs);
    },

    async flush() {
      if (!isPending() || !latest) return null;
      clearTimer();
      return queuePersist(latest);
    },

    async cancelPending() {
      clearTimer();
      cancelledThroughRevision = revision;
      latest = null;
      onPendingChange?.(false);
      onSavingChange?.(false);
      await saveChain;
    },

    async dispose() {
      disposed = true;
      clearTimer();
      cancelledThroughRevision = revision;
      latest = null;
      await saveChain;
    },
  };
}
