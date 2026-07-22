export type InstallationStatus = 'Draft' | 'Completed';

export type BoardType =
  | 'MSB'
  | 'MSSB'
  | 'DB'
  | 'HVAC-DB'
  | 'LX-DB'
  | 'PV-DB'
  | 'MCC'
  | 'Other';

export type SiteAssetType =
  | 'HVAC'
  | 'Lighting'
  | 'Solar / PV'
  | 'EV Charger'
  | 'Exhaust / Fan System'
  | 'Power Outlet'
  | 'Hot Water'
  | 'Refrigeration'
  | 'Compressed Air'
  | 'Other';

export type MeterDeviceType = 'A3RM' | 'A6M' | 'Other';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user';
}

export interface Installation {
  id: string;
  client_name: string;
  site_name: string;
  site_address: string;
  inspector_name: string;
  audit_date: string;
  status: InstallationStatus;
  created_at: string;
  updated_at: string;
}

export interface Zone {
  id: string;
  audit_id: string;
  zone_name: string;
  zone_description: string;
  photos: string[];
  created_at: string;
  updated_at: string;
}

export interface WattwatcherPrestart {
  site_induction?: boolean;
  safe_access?: boolean;
  correct_ppe?: boolean;
  live_points_aware?: boolean;
  can_isolate?: boolean;
  additional_hazards?: boolean;
  safe_to_proceed?: boolean;
}

export interface WattwatcherSwitchboard {
  sb_name?: string;
  sb_location?: string;
  device_serial?: string;
  firmware?: string;
  antenna_type?: string;
  signal_strength?: string;
  notes?: string;
}

export interface WattwatcherChannel {
  purpose?: string;
  load_type?: string;
  rogowski_size?: string;
  description?: string;
  ct_ratio?: string;
}

export interface WattwatcherVerification {
  voltage_checked?: boolean;
  polarity_checked?: boolean;
  communications_ok?: boolean;
  notes?: string;
}

export interface WattwatcherCommissioning {
  device_online?: boolean;
  channels_reporting?: boolean;
  labeled?: boolean;
  photos_taken?: boolean;
  notes?: string;
}

export interface WattwatcherPhotos {
  device_installed?: string;
  switchboard_overview?: string;
  labeling?: string;
  extra?: string[];
}

export interface Meter {
  id: string;
  device_name: string;
  device_type: MeterDeviceType;
  device_id: string;
  /** Optional field tag / device number (barcode-scannable). */
  device_number?: string;
  classification?: string;
  coverage?: string;
  ww_prestart?: WattwatcherPrestart;
  ww_switchboard?: WattwatcherSwitchboard;
  ww_channels?: WattwatcherChannel[];
  ww_verification?: WattwatcherVerification;
  ww_commissioning?: WattwatcherCommissioning;
  ww_photos?: WattwatcherPhotos;
}

export interface ElectricalAsset {
  id: string;
  audit_id: string;
  zone_id: string;
  asset_name: string;
  display_code: string;
  asset_type: BoardType;
  electrical_parent_id?: string | null;
  electrical_parent_tbc?: boolean;
  location_description?: string;
  phase?: string;
  amperage_rating?: string;
  site_nmi?: string;
  photo?: string;
  extra_photos?: string[];
  meter_present: boolean;
  meters: Meter[];
  sub_circuits_description?: string;
  comments?: string;
  created_at: string;
  updated_at: string;
}

export interface MeterChannelRef {
  channel: string;
  description: string;
}

export interface SiteAsset {
  id: string;
  audit_id: string;
  zone_id: string;
  asset_name: string;
  asset_type: SiteAssetType;
  electrical_board_id?: string | null;
  electrical_board_tbc?: boolean;
  location_description?: string;
  location_photo?: string;
  display_code?: string;
  meter_present: boolean;
  meter_switchboard_id?: string | null;
  meter_switchboard_tbc?: boolean;
  meter_channels?: MeterChannelRef[];
  comments?: string;
  extra_photos?: string[];
  created_at: string;
  updated_at: string;
}

export interface AppDataStore {
  user: User;
  installations: Installation[];
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
}

export const BOARD_TYPES: BoardType[] = [
  'MSB',
  'MSSB',
  'DB',
  'HVAC-DB',
  'LX-DB',
  'PV-DB',
  'MCC',
  'Other',
];

export const SITE_ASSET_TYPES: SiteAssetType[] = [
  'HVAC',
  'Lighting',
  'Solar / PV',
  'EV Charger',
  'Exhaust / Fan System',
  'Power Outlet',
  'Hot Water',
  'Refrigeration',
  'Compressed Air',
  'Other',
];

export const METER_DEVICE_TYPES: MeterDeviceType[] = ['A3RM', 'A6M', 'Other'];
