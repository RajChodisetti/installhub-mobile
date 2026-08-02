export function createSingleFlightProgressRunner<TProgress, TResult>(
  execute: (emit: (progress: TProgress) => void) => Promise<TResult>,
): (listener?: (progress: TProgress) => void) => Promise<TResult> {
  let active: Promise<TResult> | null = null;
  const listeners = new Set<(progress: TProgress) => void>();

  return (listener = () => {}) => {
    listeners.add(listener);
    if (!active) {
      active = Promise.resolve()
        .then(() => execute((progress) => {
          for (const notify of listeners) {
            try {
              notify(progress);
            } catch {
              // A UI listener cannot abort the shared backup operation.
            }
          }
        }))
        .finally(() => {
          active = null;
          listeners.clear();
        });
    }
    return active;
  };
}
