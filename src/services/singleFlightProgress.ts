export function createSingleFlightProgressRunner<TProgress, TResult, TContext = undefined>(
  execute: (
    emit: (progress: TProgress) => void,
    context: TContext,
  ) => Promise<TResult>,
  contextsMayShareFlight: (
    activeContext: TContext,
    incomingContext: TContext,
  ) => boolean = Object.is,
): (
  listener: ((progress: TProgress) => void) | undefined,
  context: TContext,
) => Promise<TResult> {
  type Flight = {
    context: TContext;
    listeners: Set<(progress: TProgress) => void>;
    promise: Promise<TResult>;
  };
  let active: Flight | null = null;

  const run = (
    listener: ((progress: TProgress) => void) | undefined,
    context: TContext,
  ): Promise<TResult> => {
    if (active) {
      if (contextsMayShareFlight(active.context, context)) {
        if (listener) active.listeners.add(listener);
        return active.promise;
      }
      // Authority-distinct callers serialize behind the current flight and
      // then execute with their own context. A stricter caller therefore never
      // inherits a weaker first caller's guard.
      const prior = active.promise;
      return prior.then(
        () => run(listener, context),
        () => run(listener, context),
      );
    }

    const listeners = new Set<(progress: TProgress) => void>();
    if (listener) listeners.add(listener);
    let flight: Flight;
    const promise = Promise.resolve()
      .then(() => execute((progress) => {
        for (const notify of listeners) {
          try {
            notify(progress);
          } catch {
            // A UI listener cannot abort the shared operation.
          }
        }
      }, context))
      .finally(() => {
        if (active === flight) active = null;
        listeners.clear();
      });
    flight = { context, listeners, promise };
    active = flight;
    return promise;
  };

  return run;
}
