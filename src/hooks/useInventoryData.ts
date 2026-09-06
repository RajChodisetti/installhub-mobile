import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, cloudConnectionErrorMessage } from '../api/apiClient';
import { useAuth } from '../context/AppProviders';
import { loadInventoryView } from '../domain/supportCloudReads';
import { captureAuthenticatedCloudActionLease, type AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';

type InventoryView = Awaited<ReturnType<typeof loadInventoryView>>;
type ViewToken = { key: string; principal: unknown; active: boolean; reading: number; mutating: boolean };
export type InventoryAction = <T>(action: (lease: AuthenticatedCloudActionLease, view: InventoryView) => Promise<T>,
  onSuccess?: (result: T) => void) => Promise<void>;

/** Each read and retained scanner/editor callback belongs to one account/view. */
export function useInventoryData(scope: 'mine' | 'company', search: string) {
  const { user } = useAuth();
  const key = JSON.stringify([user?.id, user?.role, scope, search]);
  const rendered = useRef({ key, principal: user });
  rendered.current = { key, principal: user };
  const tokenRef = useRef<ViewToken | null>(null);
  const [snapshot, setSnapshot] = useState<{ token: ViewToken; view: InventoryView; lease: AuthenticatedCloudActionLease }>();
  const [activity, setActivity] = useState<{ token: ViewToken; loading: boolean; busy: boolean; error?: string }>();
  const current = (token: ViewToken | null): token is ViewToken => Boolean(token && token.active
    && token === tokenRef.current && token.key === rendered.current.key && token.principal === rendered.current.principal);
  const assertCurrent = (token: ViewToken | null) => {
    if (!current(token)) throw new Error('Inventory changed. Return to the current inventory and retry.');
  };
  const loadFor = useCallback(async (token: ViewToken, suppliedLease?: AuthenticatedCloudActionLease) => {
    if (!current(token) || !user?.id) return;
    const ticket = ++token.reading;
    setActivity({ token, loading: true, busy: token.mutating });
    setSnapshot(undefined);
    try {
      const lease = suppliedLease ?? await captureAuthenticatedCloudActionLease();
      const check = () => { assertCurrent(token); lease.assertCurrent();
        if (lease.actorUserId !== user.id) throw new Error('Inventory belongs to another account.'); };
      check();
      const view = await loadInventoryView({ scope, search, role: user.role }, {
        getInventoryAccess: async () => { check(); const access = await apiClient.getInventoryAccess(lease.cloudAuthority); check();
          if (access.userId !== lease.actorUserId) throw new Error('Inventory access belongs to another account.'); return access; },
        listInventoryMeters: async (nextScope, query) => { check(); const rows = await apiClient.listInventoryMeters(nextScope, query, lease.cloudAuthority); check(); return rows; },
        listUsers: async () => { check(); const rows = await apiClient.listUsers(lease.cloudAuthority); check(); return rows; },
      });
      check();
      if (ticket === token.reading) setSnapshot({ token, view, lease });
    } catch (error) {
      if (current(token) && ticket === token.reading) setActivity({ token, loading: false, busy: token.mutating, error: cloudConnectionErrorMessage(error) });
    } finally {
      if (current(token) && ticket === token.reading) setActivity((value) => value?.token === token
        ? { ...value, loading: false, busy: token.mutating } : value);
    }
  }, [key, user]);
  useFocusEffect(useCallback(() => {
    const token: ViewToken = { key, principal: user, active: true, reading: 0, mutating: false };
    tokenRef.current = token;
    setSnapshot(undefined);
    setActivity({ token, loading: Boolean(user), busy: false });
    void loadFor(token);
    return () => { token.active = false; token.reading += 1; };
  }, [key, user, loadFor]));

  const token = tokenRef.current;
  let data: InventoryView | undefined;
  if (snapshot?.token === token && current(token)) {
    try { snapshot.lease.assertCurrent(); data = snapshot.view; } catch { /* Hide an expired account's inventory. */ }
  }
  const run: InventoryAction = async (action, onSuccess) => {
    if (!current(token) || token.mutating || !snapshot || snapshot.token !== token || !data) return;
    const lease: AuthenticatedCloudActionLease = { ...snapshot.lease,
      assertCurrent() { assertCurrent(token); snapshot.lease.assertCurrent(); } };
    token.mutating = true;
    setActivity({ token, loading: false, busy: true });
    try {
      lease.assertCurrent();
      const result = await action(lease, snapshot.view);
      lease.assertCurrent();
      // Refresh under the same account. Failure stays visible and never displays
      // the previous result as a successful match for the new request.
      await loadFor(token, snapshot.lease);
      lease.assertCurrent();
      onSuccess?.(result);
    } catch (error) {
      if (current(token)) setActivity({ token, loading: false, busy: true, error: cloudConnectionErrorMessage(error) });
    } finally {
      token.mutating = false;
      if (current(token)) setActivity((value) => value?.token === token ? { ...value, busy: false } : value);
    }
  };
  const visibleActivity = current(token) && activity?.token === token ? activity : undefined;
  return { data, run, viewToken: token, load: () => token && current(token) ? loadFor(token) : Promise.resolve(),
    loading: Boolean(user) && (visibleActivity?.loading ?? true), busy: visibleActivity?.busy ?? false, error: visibleActivity?.error };
}
