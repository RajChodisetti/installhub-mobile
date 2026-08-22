import { useCallback, useEffect, useState } from 'react';
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
import { subscribeStore } from '../data/seed';
import type { DeviceSearchRecord } from '../domain/meterSearch';

export function useInstallations() {
  const [items, setItems] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await installationsRepo.list());
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

  return { items, loading, refresh };
}

export function useDeviceSearchRecords(installationId: string) {
  const [items, setItems] = useState<DeviceSearchRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const installation = await installationsRepo.getById(installationId);
      if (!installation) {
        setItems([]);
        return;
      }
      const [zones, boards, meters] = await Promise.all([
        zonesRepo.listByInstallation(installationId),
        electricalAssetsRepo.listByInstallation(installationId),
        canonicalInstallationRepo.meterDevices(installationId),
      ]);
      const boardById = new Map(boards.map((board) => [board.id, board]));
      const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
      setItems(meters.flatMap((meter) => {
        const board = boardById.get(meter.installedOnBoardId);
        const zone = board ? zoneById.get(board.zone_id) : undefined;
        return board && zone ? [{ meter, board, zone, installation }] : [];
      }));
    } finally {
      setLoading(false);
    }
  }, [installationId]);

  useEffect(() => {
    void refresh();
    return subscribeStore(() => { void refresh(); });
  }, [refresh]);

  return { items, loading, refresh };
}

export function useForms(installationId?: string) {
  const [items, setItems] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!installationId) return;
    setLoading(true);
    try {
      setItems(await formsRepo.listByInstallation(installationId));
    } finally {
      setLoading(false);
    }
  }, [installationId]);

  useEffect(() => {
    void refresh();
    return subscribeStore(() => {
      void refresh();
    });
  }, [refresh]);

  return { items, loading, refresh };
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

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
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
      setItem(inst);
      setZones(z);
      setBoards(b);
      setSiteAssets(a);
      setGridSupplies(grids);
      setMeterDevices(meters);
      setMeasurementAssignments(assignments);
      setVirtualMeters(virtuals);
      setReadiness(ready);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    return subscribeStore(() => {
      void refresh();
    });
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
