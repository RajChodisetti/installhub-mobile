import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import type { ElectricalAsset, Installation, SiteAsset, Zone } from '../types';

/** Pick a local photo URI for zone/board/asset attachments (no cloud upload in v1). */
export async function pickLocalPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0].uri;
}

export async function takeLocalPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.8,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0].uri;
}

export async function shareInstallationReportHtml(html: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share InstallHub report',
      UTI: 'com.adobe.pdf',
    });
  }
}

export function buildInstallationReportHtml(input: {
  installation: Installation;
  zones: Zone[];
  boards: ElectricalAsset[];
  siteAssets: SiteAsset[];
}): string {
  const { installation, zones, boards, siteAssets } = input;
  const meters = boards.flatMap((b) =>
    b.meters.map(
      (m) =>
        `<tr><td>${b.display_code}</td><td>${m.device_name}</td><td>${m.device_type}</td><td>${m.device_id}</td></tr>`,
    ),
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #141C22; padding: 24px; }
    h1 { color: #0E2240; margin: 0 0 4px; }
    .sub { color: #5A6B73; margin-bottom: 24px; }
    h2 { color: #26997A; border-bottom: 1px solid #D5E0DB; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; font-size: 12px; }
    th, td { border: 1px solid #D5E0DB; padding: 8px; text-align: left; }
    th { background: #F7FAF8; }
    .badge { display: inline-block; background: #26997A; color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
  </style>
</head>
<body>
  <h1>INSTALLHUB</h1>
  <div class="sub">Installation Report</div>
  <h2>${installation.site_name}</h2>
  <p><strong>Client:</strong> ${installation.client_name}<br/>
  <strong>Address:</strong> ${installation.site_address}<br/>
  <strong>Inspector:</strong> ${installation.inspector_name}<br/>
  <strong>Date:</strong> ${installation.audit_date}<br/>
  <strong>Status:</strong> <span class="badge">${installation.status}</span></p>

  <h2>Zones (${zones.length})</h2>
  <table>
    <tr><th>Name</th><th>Description</th></tr>
    ${zones.map((z) => `<tr><td>${z.zone_name}</td><td>${z.zone_description || ''}</td></tr>`).join('')}
  </table>

  <h2>Electrical boards (${boards.length})</h2>
  <table>
    <tr><th>Code</th><th>Name</th><th>Type</th><th>Parent TBC</th><th>Meters</th></tr>
    ${boards
      .map(
        (b) =>
          `<tr><td>${b.display_code}</td><td>${b.asset_name}</td><td>${b.asset_type}</td><td>${b.electrical_parent_tbc ? 'Yes' : 'No'}</td><td>${b.meters.length}</td></tr>`,
      )
      .join('')}
  </table>

  <h2>Wattwatcher registry (${meters.length})</h2>
  <table>
    <tr><th>Board</th><th>Device</th><th>Type</th><th>ID</th></tr>
    ${meters.join('') || '<tr><td colspan="4">No meters</td></tr>'}
  </table>

  <h2>Site assets (${siteAssets.length})</h2>
  <table>
    <tr><th>Name</th><th>Type</th><th>Board TBC</th><th>Metered</th></tr>
    ${siteAssets
      .map(
        (a) =>
          `<tr><td>${a.asset_name}</td><td>${a.asset_type}</td><td>${a.electrical_board_tbc ? 'Yes' : 'No'}</td><td>${a.meter_present ? 'Yes' : 'No'}</td></tr>`,
      )
      .join('')}
  </table>
</body>
</html>`;
}

const summaryLog: string[] = [];

export function getSummaryLog(): string[] {
  return [...summaryLog];
}

export async function sendZoneSummaryStub(payload: {
  installationId: string;
  zoneId: string;
  zoneName: string;
  boardCount: number;
  assetCount: number;
}): Promise<{ ok: true; message: string }> {
  const entry = `${new Date().toISOString()} zone=${payload.zoneName} boards=${payload.boardCount} assets=${payload.assetCount}`;
  summaryLog.unshift(entry);
  return { ok: true, message: 'Zone summary queued (demo stub — replace with API).' };
}
