import type { UserSourceApp, UserSourceState } from '../types';

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
  FormsList: { installationId: string };
  FormTypePicker: {
    installationId: string;
    zoneId?: string;
    boardId?: string;
    meterId?: string;
    siteAssetId?: string;
  };
  FormEditor: { formId: string };
  RemoteInstallations: undefined;
  UserManagement: undefined;
  UserEditor: {
    userId?: string;
    sourceManaged?: boolean;
    sourceApp?: UserSourceApp | null;
    sourceState?: UserSourceState;
  };
  ChangePassword: undefined;
  Diagnostics: undefined;
  InstallationAccess: { installationId: string };
  CloudStorage: {
    installationId: string;
    serverInstallationId: string;
  };
};

export type MainTabParamList = {
  Dashboard: undefined;
  Settings: undefined;
};
