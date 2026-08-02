import * as ImagePicker from 'expo-image-picker';

export * from './formMedia';
export * from './formReport';
export * from './formReportTarget';
export * from './reportJobs';
export * from './reportVersioning';
export * from './installationReport';
export * from './installationPackTarget';
export * from './remoteInstallationRevision';
export * from './importedSourceVerification';

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
