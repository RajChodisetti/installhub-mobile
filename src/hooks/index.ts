import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ElectricalAsset,
  FormSubmission,
  GridSupply,
  Installation,
  InstallationReadiness,
  MeasurementAssignment,
  MeterDevice,
  SiteAsset,
  VirtualMeterDefinition,
  Zone,
} from '../types';
import {
  canonicalInstallationRepo,
  electricalAssetsRepo,
  formsRepo,
  installationsRepo,
  siteAssetsRepo,
  zonesRepo,
} from '../repositories';
import { getStore, initStore, subscribeStore } from '../data/seed';
import type { DeviceSearchRecord } from '../domain/meterSearch';
import { localDashboardSnapshot } from '../domain/jobDashboard';
import { actorForCurrentAssignedWorkAuthority, captureAssignedWorkMutationAuthority } from '../services/assignedWorkMutationGuard';

export function useInstallations() {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof localDashboardSnapshot>>({ items: [], countsByInstallation: {} });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await initStore();
      const actorUserId = actorForCurrentAssignedWorkAuthority(captureAssignedWorkMutationAuthority());
      setSnapshot(localDashboardSnapshot(getStore(), actorUserId));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeStore(() => {
      void refresh();
    });
  }, [refresh]);

  return { ...snapshot, loading, refresh };
}

export function useDeviceSearchRecords(installationId: string) {
  const authority = captureAssignedWorkMutationAuthority();
  const actor = actorForCurrentAssignedWorkAuthority(authority);
  const scope = `${installationId}:${actor}:${authority.generation}`;
  const [state, setState] = useState<{
    scope: string; items: DeviceSearchRecord[]; installation: Installation | null;
    loading: boolean; loaded: boolean; error: string | null;
  }>({ scope, items: [], installation: null, loading: true, loaded: false, error: null });
  const request = useRef(0);
  const mounted = useRef(true);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const refresh = useCallback(async () => {
    if (!mounted.current || currentScope.current !== scope) return;
    const version = ++request.current;
    const isCurrent = () => mounted.current && currentScope.current === scope
      && request.current === version && actorForCurrentAssignedWorkAuthority(authority) === actor;
    setState((prior) => ({ ...(prior.scope === scope ? prior : {
      scope, items: [], installation: null, loaded: false,
    }), loading: true, error: null }));
    try {
      if (!actor) throw new Error('Sign in to search installation devices.');
      const installation = await installationsRepo.getById(installationId);
      if (!isCurrent()) return;
      if (!installation) {
        setState({ scope, items: [], installation: null, loaded: true, loading: false, error: null });
        return;
      }
      if (installation.id !== installationId || installation.local_owner_user_id !== actor) {
        throw new Error('This installation is unavailable to the signed-in account.');
      }
      const [zones, boards, meters] = await Promise.all([
        zonesRepo.listByInstallation(installationId),
        electricalAssetsRepo.listByInstallation(installationId),
        canonicalInstallationRepo.meterDevices(installationId),
      ]);
      if (!isCurrent()) return;
      const boardById = new Map(boards.map((board) => [board.id, board]));
      const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
      const items = meters.flatMap((meter) => {
        const board = boardById.get(meter.installedOnBoardId);
        const zone = board ? zoneById.get(board.zone_id) : undefined;
        return board && zone ? [{ meter, board, zone, installation }] : [];
      });
      setState({ scope, items, installation, loaded: true, loading: false, error: null });
    } catch (caught) {
      if (isCurrent()) setState((prior) => ({ ...prior, loading: false,
        error: caught instanceof Error ? caught.message : 'Installation devices could not be loaded.' }));
      throw caught;
    }
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    const unsubscribe = subscribeStore(() => { void refresh().catch(() => undefined); });
    return () => { mounted.current = false; request.current += 1; unsubscribe(); };
  }, [refresh]);
  const scoped = state.scope === scope ? state : {
    items: [], installation: null, loaded: false, loading: true, error: null,
  };
  return { ...scoped, refresh };
}

export function useForms(installationId?: string) {
  const [state, setState] = useState<{
    installationId?: string;
    items: FormSubmission[];
    loading: boolean;
    loaded: boolean;
    error: string | null;
  }>({ items: [], loading: true, loaded: false, error: null });
  const refreshVersion = useRef(0);
  const mounted = useRef(true);
  const currentId = useRef(installationId);
  currentId.current = installationId;

  const refresh = useCallback(async () => {
    if (!mounted.current || currentId.current !== installationId) return;
    const version = ++refreshVersion.current;
    const isCurrent = () => mounted.current && version === refreshVersion.current
      && currentId.current === installationId;
    setState((current) => ({
      ...(current.installationId === installationId ? current : {
        installationId, items: [], loaded: false,
      }),
      loading: Boolean(installationId), error: null,
    }));
    if (!installationId) return;
    try {
      const items = await formsRepo.listByInstallation(installationId);
      if (isCurrent()) setState({ installationId, items, loading: false, loaded: true, error: null });
    } catch (caught) {
      if (isCurrent()) setState((current) => ({
        ...current, loading: false,
        error: caught instanceof Error ? caught.message : 'Field forms could not be loaded.',
      }));
      throw caught;
    }
  }, [installationId]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    const unsubscribe = subscribeStore(() => {
      void refresh().catch(() => undefined);
    });
    return () => {
      mounted.current = false;
      refreshVersion.current += 1;
      unsubscribe();
    };
  }, [refresh]);

  const scoped = state.installationId === installationId ? state : {
    items: [], loading: Boolean(installationId), loaded: false, error: null,
  };
  return { ...scoped, refresh };
}

export function useInstallation(id?: string) {
  const [item, setItem] = useState<Installation | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [boards, setBoards] = useState<ElectricalAsset[]>([]);
  const [siteAssets, setSiteAssets] = useState<SiteAsset[]>([]);
  const [gridSupplies, setGridSupplies] = useState<GridSupply[]>([]);
  const [meterDevices, setMeterDevices] = useState<MeterDevice[]>([]);
  const [measurementAssignments, setMeasurementAssignments] = useState<MeasurementAssignment[]>([]);
  const [virtualMeters, setVirtualMeters] = useState<VirtualMeterDefinition[]>([]);
  const [readiness, setReadiness] = useState<InstallationReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshVersion = useRef(0);
  const mounted = useRef(true);
  const currentId = useRef(id);
  currentId.current = id;

  const refresh = useCallback(async () => {
    if (!id || !mounted.current) return;
    const version = ++refreshVersion.current;
    const isCurrent = () => mounted.current && version === refreshVersion.current
      && currentId.current === id;
    setLoading(true);
    setError(null);
    try {
      const [inst, z, b, a, grids, meters, assignments, virtuals, ready] = await Promise.all([
        installationsRepo.getById(id),
        zonesRepo.listByInstallation(id),
        electricalAssetsRepo.listByInstallation(id),
        siteAssetsRepo.listByInstallation(id),
        canonicalInstallationRepo.gridSupplies(id),
        canonicalInstallationRepo.meterDevices(id),
        canonicalInstallationRepo.measurementAssignments(id),
        canonicalInstallationRepo.virtualMeters(id),
        canonicalInstallationRepo.readiness(id),
      ]);
      if (!isCurrent()) return;
      setItem(inst);
      setZones(z);
      setBoards(b);
      setSiteAssets(a);
      setGridSupplies(grids);
      setMeterDevices(meters);
      setMeasurementAssignments(assignments);
      setVirtualMeters(virtuals);
      setReadiness(ready);
    } catch (caught) {
      if (isCurrent()) {
        setError(caught instanceof Error ? caught.message : 'Installation data could not be loaded.');
      }
      throw caught;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    const unsubscribe = subscribeStore(() => {
      void refresh().catch(() => undefined);
    });
    return () => {
      mounted.current = false;
      refreshVersion.current += 1;
      unsubscribe();
    };
  }, [refresh]);

  return {
    item,
    zones,
    boards,
    siteAssets,
    gridSupplies,
    meterDevices,
    measurementAssignments,
    virtualMeters,
    readiness,
    loading,
    error,
    refresh,
  };
}

export function useZoneWorkspace(zoneId?: string) {
  const [zone, setZone] = useState<Zone | null>(null);
  const [boards, setBoards] = useState<ElectricalAsset[]>([]);
  const [siteAssets, setSiteAssets] = useState<SiteAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!zoneId) return;
    setLoading(true);
    try {
      const z = await zonesRepo.getById(zoneId);
      setZone(z);
      if (z) {
        const [b, a] = await Promise.all([
          electricalAssetsRepo.listByZone(zoneId),
          siteAssetsRepo.listByZone(zoneId),
        ]);
        setBoards(b);
        setSiteAssets(a);
      }
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    void refresh();
    return subscribeStore(() => {
      void refresh();
    });
  }, [refresh]);

  return { zone, boards, siteAssets, loading, refresh };
}
