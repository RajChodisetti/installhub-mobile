export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  InstallationForm: { installationId?: string } | undefined;
  InstallationDetail: { installationId: string };
  ZoneWorkspace: { zoneId: string; installationId: string };
  BoardDetail: { boardId: string; installationId: string; zoneId: string };
  SiteAssetDetail: { assetId: string; installationId: string; zoneId: string };
  MeterForm: { boardId: string; meterId?: string; deviceType?: 'A3RM' | 'A6M' | 'Other' };
  DataView: { installationId: string };
  MeteringTable: { installationId: string };
  InstallationReport: { installationId: string };
  ClientReport: { installationId: string };
  PhotoPreview: { installationId: string };
};

export type MainTabParamList = {
  Dashboard: undefined;
  Settings: undefined;
};
