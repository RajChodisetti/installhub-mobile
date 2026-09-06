import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { cloudConnectionErrorMessage } from '../api/apiClient';
import { useAuth } from '../context/AppProviders';
import { captureAuthenticatedCloudActionLease, type AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import { runLeasedCloudActionStep } from '../services/cloudActionLease';

type ViewToken = { key: string; principal: unknown; active: boolean; reading: number; mutating: boolean };

export function useCommercialData<T>(loader: (lease: AuthenticatedCloudActionLease) => Promise<T>, scopeKey: string) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const key = JSON.stringify([user?.id ?? null, user?.role ?? null, scopeKey]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const currentPrincipal = useRef(user);
  currentPrincipal.current = user;
  const tokenRef = useRef<ViewToken | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; data: T; lease: AuthenticatedCloudActionLease }>();
  const [activity, setActivity] = useState<{ token: ViewToken; loading: boolean; busy: boolean; error?: string }>();
  const current = (token: ViewToken | null): token is ViewToken => Boolean(token && token.active
    && tokenRef.current === token && currentKey.current === token.key && currentPrincipal.current === token.principal);
  const assertCurrent = (token: ViewToken | null) => {
    if (!current(token)) throw new Error('The commercial screen changed. Return to the current record and retry.');
  };
  const bind = (token: ViewToken, lease: AuthenticatedCloudActionLease): AuthenticatedCloudActionLease => ({
    ...lease,
    assertCurrent: () => { assertCurrent(token); lease.assertCurrent(); },
  });
  const loadFor = useCallback(async (token: ViewToken, suppliedLease?: AuthenticatedCloudActionLease) => {
    if (!current(token) || !isAdmin) return;
    const ticket = ++token.reading;
    setActivity({ token, loading: true, busy: token.mutating });
    try {
      const actorLease = suppliedLease ?? await captureAuthenticatedCloudActionLease();
      const lease = bind(token, actorLease);
      lease.assertCurrent();
      const response = await runLeasedCloudActionStep(lease, () => loader(lease));
      if (current(token) && ticket === token.reading) setSnapshot({ key: token.key, data: response, lease: actorLease });
    } catch (caught) {
      if (current(token) && ticket === token.reading) setActivity({ token, loading: false, busy: token.mutating, error: cloudConnectionErrorMessage(caught) });
    } finally {
      if (current(token) && ticket === token.reading) setActivity((value) => value?.token === token
        ? { ...value, loading: false, busy: token.mutating } : value);
    }
  }, [isAdmin, key, loader]);
  useFocusEffect(useCallback(() => {
    const token: ViewToken = { key, principal: user, active: true, reading: 0, mutating: false };
    tokenRef.current = token;
    setActivity({ token, loading: isAdmin, busy: false });
    if (isAdmin) void loadFor(token);
    return () => { token.active = false; token.reading += 1; };
  }, [isAdmin, key, loadFor, user]));

  // Every returned callback belongs to this render's focus token. In
  // particular, retained Alert confirmations cannot adopt a later actor or view.
  const token = tokenRef.current;
  const load = () => token && current(token) ? loadFor(token) : Promise.resolve();
  const setError = (message: string | undefined) => {
    if (current(token)) setActivity((value) => ({ token, loading: value?.token === token && value.loading,
      busy: token.mutating, error: message }));
  };
  const run = async <Result,>(action: (lease: AuthenticatedCloudActionLease) => Promise<Result>, onSuccess?: (result: Result) => void): Promise<Result | null> => {
    if (!isAdmin || !current(token) || token.mutating) return null;
    token.mutating = true;
    setActivity({ token, loading: false, busy: true });
    try {
      const actorLease = await captureAuthenticatedCloudActionLease();
      const lease = bind(token, actorLease);
      const result = await runLeasedCloudActionStep(lease, () => action(lease));
      await loadFor(token, actorLease);
      lease.assertCurrent();
      onSuccess?.(result);
      return result;
    } catch (caught) {
      if (current(token)) setError(cloudConnectionErrorMessage(caught));
      return null;
    } finally {
      token.mutating = false;
      if (current(token)) setActivity((value) => value?.token === token ? { ...value, busy: false } : value);
    }
  };
  let data: T | undefined;
  if (isAdmin && snapshot?.key === key) {
    // The actor/credential fence also invalidates a same-ID re-login. Focus
    // lifetime is checked for actions; a same-scope read can remain visible
    // during a refresh, so use its original underlying authority here.
    try { snapshot.lease.assertCurrent(); data = snapshot.data; } catch { /* stale snapshot stays hidden */ }
  }
  const visibleActivity = activity?.token.key === key && activity.token === tokenRef.current ? activity : undefined;
  return { data, loading: isAdmin && (visibleActivity?.loading ?? true), busy: visibleActivity?.busy ?? false,
    error: visibleActivity?.error, isAdmin, scopeKey: key, load, run, setError };
}
