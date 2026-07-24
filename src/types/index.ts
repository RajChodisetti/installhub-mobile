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

export type FormType =
  | 'ww-installation'
  | 'a3rm-installation'
  | 'a6m-installation'
  | 'comms-fault'
  | 'ace-switchboard'
  | 'honeywell-q400'
  | 'captis-logger'
  | 'sums-logger';

export type FormStatus = 'Draft' | 'Completed';
export type FormAnswer = 'yes' | 'no' | 'not_applicable' | '';
export type FormValue = string | FormAnswer;
export type CloudUploadStatus = 'pending' | 'uploading' | 'failed' | 'cleared';
export type ThumbnailDownloadStatus = 'pending' | 'downloading' | 'failed' | 'ready';

export interface CloudUploadQueueItem {
  id: string;
  installation_id: string;
  entity_type: 'zone' | 'electrical_asset' | 'site_asset' | 'form_submission';
  entity_id: string;
  field_name: string;
  local_uri: string;
  mime_type: string;
  status: CloudUploadStatus;
  attempts: number;
  checksum?: string;
  session_id?: string;
  remote_url?: string;
  last_error?: string;
  updated_at: string;
}

export interface CloudSyncState {
  synced_at_by_installation: Record<string, string>;
  force_dirty_installation_ids: string[];
  upload_queue: CloudUploadQueueItem[];
  thumbnail_queue: ThumbnailDownloadQueueItem[];
}

export interface ThumbnailDownloadQueueItem {
  id: string;
  installation_id: string;
  remote_uri: string;
  local_uri?: string;
  status: ThumbnailDownloadStatus;
  attempts: number;
  last_error?: string;
  updated_at: string;
}

export interface FormAttachment {
  id: string;
  slot: string;
  uri: string;
  mime_type: string;
  caption?: string;
  captured_at: string;
}

export interface FormSubmission {
  id: string;
  /**
   * Immutable API identity retained only for an unchanged imported copy.
   * It lets server-side PDF generation use the original full-resolution
   * evidence without downloading originals into the mobile app.
   */
  import_source_server_id?: string;
  form_type: FormType;
  schema_version: number;
  status: FormStatus;
  installation_id: string;
  zone_id?: string;
  board_id?: string;
  meter_id?: string;
  site_asset_id?: string;
  answers: Record<string, FormValue>;
  attachments: FormAttachment[];
  created_at: string;
  updated_at: string;
  completed_at?: string;
  supersedes_id?: string;
}

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
  cloud_backup_enabled: boolean;
  /** A server copy still exists while future automatic backups are disabled. */
  cloud_backup_retained?: boolean;
  is_imported_copy?: boolean;
  import_source_server_id?: string;
  /**
   * Import-time tree anchor written by provenance-aware app versions.
   * Older imported copies without it must be backed up under their local ID.
   */
  import_provenance_watermark?: string;
  /** Stable hash of the exact server tree observed when this cpN copy was imported. */
  import_source_tree_revision?: string;
  copy_index?: number;
  thumbnail_status?: 'pending' | 'ready';
  thumbnail_total?: number;
  thumbnail_ready?: number;
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
  formSubmissions: FormSubmission[];
  cloudSync: CloudSyncState;
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
