export type InstallationStatus = 'Draft' | 'Completed';

export type InstallationReportDetailMode =
  | 'by-electrical-hierarchy'
  | 'by-zone';

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

/** Stable taxonomy codes used by installation-canonical-v2. */
export type BoardTypeCode =
  | 'MSB'
  | 'MSSB'
  | 'DB'
  | 'HVAC_DB'
  | 'LX_DB'
  | 'PV_DB'
  | 'MCC'
  | 'OTHER';

export type SiteAssetTypeCode =
  | 'PV'
  | 'HVAC'
  | 'LIGHTING'
  | 'EV_CHARGER'
  | 'VEHICLE_HOIST'
  | 'FORKLIFT'
  | 'EXHAUST_FAN_SYSTEM'
  | 'POWER_OUTLET'
  | 'HEATER_GEYSER'
  | 'REFRIGERATION'
  | 'COMPRESSED_AIR'
  | 'OTHER';

export interface DisplayCode {
  value: string;
  generatedValue: string;
  isOverridden: boolean;
  /** Server-pinned generator rule; historical versions must round-trip. */
  ruleVersion: number;
  overrideReason?: string;
  /** Offline allocations remain provisional until a successful v2 sync. */
  provisional?: boolean;
}

export interface GridSupply {
  id: string;
  installationId: string;
  name: string;
  isDefault: boolean;
  nmi?: string;
  externalKey?: string;
}

export type ElectricalSource =
  | { kind: 'GRID'; gridSupplyId: string }
  | { kind: 'BOARD'; boardId: string }
  | { kind: 'TBC' };

export type MeterChannelPurpose = 'MAIN_SUPPLY' | 'SUB_CIRCUIT' | 'SPARE';

export interface MeterChannel {
  id: string;
  ordinal: number;
  purpose: MeterChannelPurpose;
  phaseLabel?: string;
  capabilities?: Record<string, unknown>;
  loadTypeCode?: SiteAssetTypeCode;
  customLoadTypeName?: string;
  sensorRating?: string;
  description?: string;
  target?: MeasurementTarget;
  direction?: MeasurementDirection;
}

export interface MeterCommissioningData {
  classification?: string | null;
  coverage?: string | null;
  prestart?: {
    siteInduction?: boolean;
    safeAccess?: boolean;
    correctPpe?: boolean;
    livePointsAware?: boolean;
    canIsolate?: boolean;
    additionalHazards?: boolean;
    safeToProceed?: boolean;
  };
  switchboard?: {
    name?: string | null;
    location?: string | null;
    deviceSerial?: string | null;
    firmware?: string | null;
    antennaType?: string | null;
    signalStrength?: string | null;
    notes?: string | null;
  };
  verification?: {
    voltageChecked?: boolean;
    polarityChecked?: boolean;
    communicationsOk?: boolean;
    notes?: string | null;
  };
  commissioning?: {
    deviceOnline?: boolean;
    channelsReporting?: boolean;
    labeled?: boolean;
    photosTaken?: boolean;
    notes?: string | null;
  };
}

export interface MeterDevice {
  id: string;
  installationId: string;
  installedOnBoardId: string;
  deviceFamily: 'WATTWATCHERS' | 'OTHER';
  deviceModel: 'A3RM' | 'A6M' | 'OTHER';
  customManufacturerName?: string;
  customModelName?: string;
  customName?: string;
  deviceNumber?: string;
  serialNumber: string;
  displayName: DisplayCode;
  channels: MeterChannel[];
  commissioningData?: MeterCommissioningData;
  wwPhotos?: {
    deviceInstalled?: string;
    switchboardOverview?: string;
    labeling?: string;
    extra?: string[];
  };
  notes?: string;
}

export interface ResolvedDisplayCodeChange {
  entityType: 'board' | 'site_asset' | 'meter';
  entityId: string;
  previousValue: string;
  resolvedValue: string;
  resolvedAt: string;
}

export interface VirtualMeterDefinition {
  id: string;
  parentNodeId: string;
  totalMeasurementAssignmentId: string;
  subtractAssignmentIds: string[];
  formulaVersion: 1;
  allocation: 'UNALLOCATED_RESIDUAL';
}

export type MeasurementTarget =
  | { kind: 'BOARD'; boardId: string }
  | { kind: 'SITE_ASSET'; siteAssetId: string }
  | { kind: 'GRID_BOUNDARY'; gridSupplyId: string }
  | { kind: 'TBC' };

export type MeasurementDirection =
  | 'CONSUMPTION'
  | 'GENERATION'
  | 'BIDIRECTIONAL';

export interface MeasurementAssignment {
  id: string;
  installationId: string;
  meterId: string;
  channelIds: string[];
  phaseMode: 'SINGLE_PHASE' | 'THREE_PHASE' | 'OTHER';
  target: MeasurementTarget;
  direction: MeasurementDirection;
  status: 'CONFIRMED' | 'TBC';
}

export type MeteringState =
  | { kind: 'METERED'; measurementAssignmentIds: string[] }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' };

export type ReadinessEntityType =
  | 'installation'
  | 'grid_supply'
  | 'board'
  | 'site_asset'
  | 'meter'
  | 'channel'
  | 'measurement_assignment'
  | 'virtual_meter'
  | 'form';

export interface ReadinessIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  entityType: ReadinessEntityType;
  entityId: string;
  field?: string;
  message: string;
  candidateIds?: string[];
}

export interface InstallationReadiness {
  installationId: string;
  treeRevision: number;
  recordVersionNumber?: number;
  readyToComplete: boolean;
  eligibility: {
    draftDiagnosticReport: boolean;
    authoritativeReport: boolean;
    mappingExport: boolean;
    dataDomeDelivery: boolean;
  };
  issues: ReadinessIssue[];
}

export type BackupConflictState =
  | { kind: 'NONE' }
  | { kind: 'CONFLICT'; localBaseTreeRevision: number; remoteTreeRevision?: number; detectedAt: string };

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
export type UserSourceApp = 'ecoaudit' | 'solarsense';
export type UserSourceState = 'linked' | 'orphaned' | 'explicit';

export interface CloudUploadQueueItem {
  id: string;
  installation_id: string;
  entity_type: 'zone' | 'electrical_asset' | 'site_asset' | 'meter_device' | 'form_submission';
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

/**
 * Exact final backup request retained until its authoritative server tree has
 * been pulled and merged. This closes every crash window around a successful
 * complete push without advancing the local CAS base prematurely.
 */
export interface PendingCompleteBackupAttempt {
  version: 1;
  id: string;
  installation_id: string;
  payload: Record<string, unknown>;
  payload_sha256: string;
  base_tree_revision?: number;
  local_tree_revision: number;
  tree_watermark: string;
  installation_status: InstallationStatus;
  prepared_at: string;
  accepted_tree_revision?: number;
  accepted_record_version_number?: number | null;
}

export interface ConflictedCompleteBackupAttempt extends PendingCompleteBackupAttempt {
  conflicted_at: string;
}

export interface CloudSyncState {
  synced_at_by_installation: Record<string, string>;
  force_dirty_installation_ids: string[];
  pending_complete_attempts?: Record<string, PendingCompleteBackupAttempt>;
  conflicted_complete_attempts?: Record<string, ConflictedCompleteBackupAttempt>;
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
  /** Server-confirmed immutable commissioning history whose meter was removed. */
  historical_meter_removed?: boolean;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user';
  source_managed?: boolean;
  source_app?: UserSourceApp | null;
  source_state?: UserSourceState;
}

export interface AssignedWorkPrestartAcknowledgement {
  actor_user_id: string;
  assigned_job_summary_sha256: string;
  acknowledged_at: string;
}

/** Local-only scheduler summary captured independently from the editable installation tree. */
export interface AssignedWorkJobSummarySnapshot {
  actor_user_id: string;
  assigned_inspector_user_id: string;
  client_name: string;
  customer_name?: string;
  site_name: string;
  site_address: string;
  site_locality?: string;
  site_state?: string;
  site_postcode?: string;
  audit_date: string;
  inspector_name: string;
  maas?: boolean | null;
  service_type?: string;
  metering_solution_type?: string;
  planned_meter_type?: string;
  custom_job_number?: string;
  site_contact_name?: string;
  site_contact_phone?: string;
  site_contact_email?: string;
  fergus_job_number?: string;
  quote_number?: string;
  job_comments?: string;
  access_information?: string;
  pulled_at: string;
}

/**
 * Last installation-metadata values accepted from the assigned-work server.
 * This local-only base enables a field-aware three-way merge without treating
 * unrelated zone, asset, meter, or form edits as metadata conflicts.
 */
export interface AssignedWorkServerMetadataSnapshot {
  client_name: string;
  customer_name: string | null;
  site_name: string;
  site_address: string;
  site_locality: string | null;
  site_state: string | null;
  site_postcode: string | null;
  site_country_code: string | null;
  inspector_name: string;
  audit_date: string;
  timezone: string | null;
  maas: boolean | null;
  service_type: string | null;
  metering_solution_type: string | null;
  planned_meter_type: string | null;
  custom_job_number: string | null;
  site_contact_name: string | null;
  site_contact_phone: string | null;
  site_contact_email: string | null;
  fergus_job_number: string | null;
  quote_number: string | null;
  job_comments: string | null;
  access_information: string | null;
  warranty_device: boolean | null;
  monitoring_installed: boolean | null;
  hardware_installed: boolean | null;
  solar_capacity_kw: number | null;
  additional_monitoring_required: boolean | null;
  additional_monitoring_hardware: string | null;
}

export interface AssignedWorkRefreshConflict {
  base: AssignedWorkServerMetadataSnapshot;
  incoming: AssignedWorkServerMetadataSnapshot;
  local_base_tree_revision: number;
  remote_tree_revision: number;
  conflicting_fields: Array<keyof AssignedWorkServerMetadataSnapshot>;
  remote_tree_changed: boolean;
  incoming_tree_fingerprint: string;
  detected_at: string;
}
export interface Installation {
  id: string;
  /** Local-only durable owner used to fence shared-device data between logins. */
  local_owner_user_id?: string;
  /** Server ownership metadata used to separate local work from assigned work. */
  created_by_user_id?: string;
  assigned_inspector_user_id?: string;
  /** Local visibility tombstone; never included in canonical backup payloads. */
  assigned_work_state?: 'none' | 'active' | 'inactive';
  assigned_work_actor_user_id?: string;
  /** Last scheduler summary pulled for this assigned actor; excluded from canonical backup payloads. */
  assigned_work_job_summary?: AssignedWorkJobSummarySnapshot;
  /** Local-only acknowledgement for the current assigned actor and pulled summary. */
  assigned_work_prestart_acknowledgement?: AssignedWorkPrestartAcknowledgement;
  /** Last accepted server metadata base; excluded from canonical backup payloads. */
  assigned_work_server_metadata_base?: AssignedWorkServerMetadataSnapshot;
  /** Last accepted server child/form projection; local-only edits never mutate this value. */
  assigned_work_server_tree_fingerprint?: string;
  /** Pauses backup until overlapping or unknown remote edits are explicitly resolved. */
  assigned_work_refresh_conflict?: AssignedWorkRefreshConflict;
  client_name: string;
  /** The end customer when different from the contracting client. */
  customer_name?: string | null;
  site_name: string;
  site_address: string;
  /** Structured Australian address parts; site_address remains the display fallback. */
  site_locality?: string | null;
  site_state?: string | null;
  site_postcode?: string | null;
  site_country_code?: string | null;
  inspector_name: string;
  audit_date: string;
  status: InstallationStatus;
  /** Scheduler-provided job classification and site-access metadata. */
  maas?: boolean | null;
  service_type?: string | null;
  metering_solution_type?: string | null;
  /** Planning intent only; installed meters remain canonical MeterDevice rows. */
  planned_meter_type?: string | null;
  custom_job_number?: string | null;
  site_contact_name?: string | null;
  site_contact_phone?: string | null;
  site_contact_email?: string | null;
  fergus_job_number?: string | null;
  quote_number?: string | null;
  job_comments?: string | null;
  /** Sensitive operational detail, limited to users authorised for this installation. */
  access_information?: string | null;
  /** Nullable job-level outcome summaries; null means not yet confirmed. */
  warranty_device?: boolean | null;
  monitoring_installed?: boolean | null;
  hardware_installed?: boolean | null;
  solar_capacity_kw?: number | null;
  additional_monitoring_required?: boolean | null;
  additional_monitoring_hardware?: string | null;
  /** installation-canonical-v2 local metadata. */
  tree_schema_version?: 2;
  external_key?: string;
  site_code?: string;
  timezone?: string;
  /** Monotonic local mutation counter. Never use this value as a server CAS base. */
  tree_revision?: number;
  /** Last authoritative server revision accepted by push/upload/lifecycle APIs. */
  server_tree_revision?: number;
  record_version_number?: number;
  display_code_sequences?: Partial<Record<BoardTypeCode | SiteAssetTypeCode, number>>;
  /**
   * Local high-water marks for naming-rule-v2 allocations. Keys are stable
   * zone IDs so renaming a zone never makes an offline sequence reusable.
   * The server remains authoritative when concurrent devices sync.
   */
  display_code_zone_sequences?: Record<string, number>;
  completed_at?: string;
  /** Authoritative user identifier recorded by the server completion action. */
  completed_by_user_id?: string;
  completed_from_revision?: number;
  /** Optional technician note captured by the authoritative completion action. */
  completion_notes?: string | null;
  reopened_at?: string;
  reopen_reason?: string;
  /** Preserves evidence that a schema-v1 client had marked this locally complete. */
  legacy_completed_unpinned?: boolean;
  pending_completion?: {
    baseTreeRevision: number;
    /** Exact local mutation revision validated after backup/readiness. */
    localTreeRevision?: number;
    /** Exact whole-tree watermark validated inside the serialized dispatch fence. */
    treeWatermark?: string;
    idempotencyKey: string;
    createdAt: string;
    /** Exact normalized value replayed with the same completion idempotency key. */
    completionNotes?: string | null;
  };
  backup_conflict?: BackupConflictState;
  /** Generated display codes changed by the server during the latest sync. */
  resolved_display_code_changes?: ResolvedDisplayCodeChange[];
  server_derived?: {
    treeRevision: number;
    recordVersionNumber?: number;
    virtualMeterDefinitions: VirtualMeterDefinition[];
  };
  cloud_backup_enabled: boolean;
  /** A server copy still exists while future automatic backups are disabled. */
  cloud_backup_retained?: boolean;
  is_imported_copy?: boolean;
  import_source_server_id?: string;
  /** Immutable source version used only while imported provenance remains intact. */
  import_source_record_version_number?: number;
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
  zone_code?: string;
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
  /** Stable channel identity projected from the canonical meter definition. */
  id?: string;
  /** Explicit positive ordinal; never inferred as three channels for custom meters. */
  ordinal?: number;
  purpose?: string;
  phase_label?: string;
  capabilities?: Record<string, unknown>;
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
  /** Editable human suffix used by naming-rule-v2. */
  custom_name?: string;
  device_type: MeterDeviceType;
  device_id: string;
  /** Optional site / asset tag (barcode-scannable), distinct from the serial identity. */
  device_number?: string;
  custom_manufacturer_name?: string;
  custom_model_name?: string;
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
  type_code?: BoardTypeCode;
  custom_type_name?: string;
  display_code_meta?: DisplayCode;
  electrical_source?: ElectricalSource;
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
  type_code?: SiteAssetTypeCode;
  custom_type_name?: string;
  display_code_meta?: DisplayCode;
  electrical_source?: ElectricalSource;
  metering_state?: MeteringState;
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

export interface SiteAssetEditorDraftRecord {
  scope: string;
  userId: string;
  installationId: string;
  assetId?: string;
  baseTreeRevision: number;
  baseAssetUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  payload: {
    version: 1;
    assetName: string;
    typeCode: SiteAssetTypeCode;
    customTypeName: string;
    displayCode: string;
    customCode: boolean;
    locationDescription: string;
    /** Optional for compatibility with recovery drafts created before asset media was editable. */
    locationPhoto?: string;
    /** Optional for compatibility with recovery drafts created before asset media was editable. */
    extraPhotos?: string[];
    sourceKey: string;
    sourceBoardSearch: string;
    meteringKind: 'METERED' | 'UNMETERED' | 'TBC';
    selectedMeterId: string;
    selectedChannelIds: string[];
    phaseMode: MeasurementAssignment['phaseMode'];
    direction: MeasurementDirection | '';
    meterSearch: string;
    comments: string;
    deviceDetour: { beforeMeterIds: string[]; startReturnToken: number } | null;
  };
  checksum: string;
}

/**
 * Local-only, inert snapshot retained when a canonical assigned checkout is
 * reassigned to another actor on the same device. Records in this envelope are
 * excluded from normal repositories and cloud dispatch, but remain available
 * for actor-scoped recovery/support without colliding with the clean canonical
 * checkout materialized for the replacement actor.
 */
export interface AssignedWorkRecoveryCheckout {
  version: 1;
  id: string;
  actor_user_id: string;
  replacement_actor_user_id: string;
  canonical_installation_id: string;
  quarantined_at: string;
  installation: Installation;
  gridSupplies: GridSupply[];
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
  meterDevices: MeterDevice[];
  measurementAssignments: MeasurementAssignment[];
  formSubmissions: FormSubmission[];
  siteAssetEditorDrafts: SiteAssetEditorDraftRecord[];
  cloudSync: {
    synced_at?: string;
    force_dirty: boolean;
    pending_complete_attempt?: PendingCompleteBackupAttempt;
    conflicted_complete_attempt?: ConflictedCompleteBackupAttempt;
    upload_queue: CloudUploadQueueItem[];
    thumbnail_queue: ThumbnailDownloadQueueItem[];
  };
}

export interface AppDataStore {
  schemaVersion?: 3;
  user: User;
  installations: Installation[];
  gridSupplies: GridSupply[];
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
  meterDevices: MeterDevice[];
  measurementAssignments: MeasurementAssignment[];
  formSubmissions: FormSubmission[];
  /** Encrypted, local-only recovery state; never included in canonical API trees. */
  siteAssetEditorDrafts?: SiteAssetEditorDraftRecord[];
  /** Actor-owned reassignment recovery snapshots; never included in API trees. */
  assignedWorkRecoveryCheckouts?: AssignedWorkRecoveryCheckout[];
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

export const BOARD_TYPE_CODES: BoardTypeCode[] = [
  'MSB',
  'MSSB',
  'DB',
  'HVAC_DB',
  'LX_DB',
  'PV_DB',
  'MCC',
  'OTHER',
];

export const SITE_ASSET_TYPE_CODES: SiteAssetTypeCode[] = [
  'PV',
  'HVAC',
  'LIGHTING',
  'EV_CHARGER',
  'VEHICLE_HOIST',
  'FORKLIFT',
  'EXHAUST_FAN_SYSTEM',
  'POWER_OUTLET',
  'HEATER_GEYSER',
  'REFRIGERATION',
  'COMPRESSED_AIR',
  'OTHER',
];
