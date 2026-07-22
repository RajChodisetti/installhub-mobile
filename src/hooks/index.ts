import { useCallback, useEffect, useState } from 'react';
import type { ElectricalAsset, Installation, SiteAsset, Zone } from '../types';
import {
  electricalAssetsRepo,
  installationsRepo,
  siteAssetsRepo,
  zonesRepo,
} from '../repositories';
import { subscribeStore } from '../data/seed';

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

export function useInstallation(id?: string) {
  const [item, setItem] = useState<Installation | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [boards, setBoards] = useState<ElectricalAsset[]>([]);
  const [siteAssets, setSiteAssets] = useState<SiteAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [inst, z, b, a] = await Promise.all([
        installationsRepo.getById(id),
        zonesRepo.listByInstallation(id),
        electricalAssetsRepo.listByInstallation(id),
        siteAssetsRepo.listByInstallation(id),
      ]);
      setItem(inst);
      setZones(z);
      setBoards(b);
      setSiteAssets(a);
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

  return { item, zones, boards, siteAssets, loading, refresh };
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
