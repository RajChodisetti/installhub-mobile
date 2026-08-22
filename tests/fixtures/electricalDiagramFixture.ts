import type {
  ElectricalAsset,
  GridSupply,
  Installation,
  MeasurementAssignment,
  MeterDevice,
  SiteAsset,
  VirtualMeterDefinition,
  Zone,
} from '../../src/types';
import type { ElectricalDiagramInput } from '../../src/domain/electricalDiagram';

const timestamp = '2026-08-08T12:00:00.000Z';

const installation: Installation = {
  id: 'installation-1',
  client_name: 'Example Client',
  site_name: 'Essendon Workshop',
  site_address: '42 Example Road, Essendon',
  inspector_name: 'Inspector One',
  audit_date: '2026-08-08',
  status: 'Draft',
  tree_revision: 12,
  cloud_backup_enabled: true,
  created_at: timestamp,
  updated_at: timestamp,
};

const zones: Zone[] = [
  {
    id: 'zone-plant',
    audit_id: installation.id,
    zone_code: 'PLANT',
    zone_name: 'Plant room',
    zone_description: 'Main electrical plant',
    photos: [],
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: 'zone-showroom',
    audit_id: installation.id,
    zone_code: 'SHOW',
    zone_name: 'Showroom',
    zone_description: 'Customer-facing area',
    photos: [],
    created_at: timestamp,
    updated_at: timestamp,
  },
];

const gridSupplies: GridSupply[] = [
  {
    id: 'grid-1',
    installationId: installation.id,
    name: 'Incoming grid connection',
    isDefault: true,
    nmi: 'NMI-123',
  },
];

const boards: ElectricalAsset[] = [
  {
    id: 'board-msb',
    audit_id: installation.id,
    zone_id: 'zone-plant',
    asset_name: 'Main Switchboard',
    display_code: 'E-PLANT-01-MSB',
    asset_type: 'MSB',
    type_code: 'MSB',
    electrical_source: { kind: 'GRID', gridSupplyId: 'grid-1' },
    meter_present: true,
    meters: [],
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: 'board-mssb',
    audit_id: installation.id,
    zone_id: 'zone-showroom',
    asset_name: 'Showroom Mechanical Board',
    display_code: 'E-SHOW-01-MSSB',
    asset_type: 'MSSB',
    type_code: 'MSSB',
    electrical_source: { kind: 'BOARD', boardId: 'board-msb' },
    meter_present: true,
    meters: [],
    created_at: timestamp,
    updated_at: timestamp,
  },
];

const meterDevices: MeterDevice[] = [
  {
    id: 'meter-msb',
    installationId: installation.id,
    installedOnBoardId: 'board-msb',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A6M',
    serialNumber: 'DD43710148726',
    deviceNumber: 'WW-001',
    displayName: {
      value: 'MSB Incoming Meter',
      generatedValue: 'MSB Incoming Meter',
      isOverridden: false,
      ruleVersion: 1,
    },
    channels: [
      { id: 'msb-main', ordinal: 1, purpose: 'MAIN_SUPPLY' },
      {
        id: 'msb-wrong',
        ordinal: 2,
        purpose: 'SUB_CIRCUIT',
        loadTypeCode: 'HVAC',
        description: 'Wrong upstream-board mapping',
      },
    ],
  },
  {
    id: 'meter-mssb',
    installationId: installation.id,
    installedOnBoardId: 'board-mssb',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A6M',
    serialNumber: 'DD83710147339',
    deviceNumber: 'WW-002',
    displayName: {
      value: 'Essendon HVAC Meter',
      generatedValue: 'Essendon HVAC Meter',
      isOverridden: false,
      ruleVersion: 1,
    },
    channels: [
      { id: 'mssb-main', ordinal: 1, purpose: 'MAIN_SUPPLY' },
      {
        id: 'mssb-pac',
        ordinal: 4,
        purpose: 'SUB_CIRCUIT',
        loadTypeCode: 'HVAC',
        sensorRating: '200A',
        description: 'PAC 1 compressor',
      },
    ],
  },
];

const assets: SiteAsset[] = [
  {
    id: 'asset-pac',
    audit_id: installation.id,
    zone_id: 'zone-showroom',
    asset_name: 'Showroom PAC 1',
    display_code: 'E-SHOW-01-HVAC-PAC-1',
    asset_type: 'HVAC',
    type_code: 'HVAC',
    electrical_source: { kind: 'BOARD', boardId: 'board-mssb' },
    metering_state: {
      kind: 'METERED',
      measurementAssignmentIds: ['assignment-pac'],
    },
    meter_present: true,
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: 'asset-lighting',
    audit_id: installation.id,
    zone_id: 'zone-showroom',
    asset_name: 'Showroom Lighting',
    display_code: 'E-SHOW-02-LX',
    asset_type: 'Lighting',
    type_code: 'LIGHTING',
    electrical_source: { kind: 'BOARD', boardId: 'board-mssb' },
    metering_state: { kind: 'UNMETERED' },
    meter_present: false,
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: 'asset-invalid',
    audit_id: installation.id,
    zone_id: 'zone-showroom',
    asset_name: 'Workshop PAC Wrong Source',
    display_code: 'E-SHOW-03-HVAC',
    asset_type: 'HVAC',
    type_code: 'HVAC',
    electrical_source: { kind: 'BOARD', boardId: 'board-mssb' },
    metering_state: {
      kind: 'METERED',
      measurementAssignmentIds: ['assignment-wrong-board'],
    },
    meter_present: true,
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: 'asset-tbc',
    audit_id: installation.id,
    zone_id: 'zone-plant',
    asset_name: 'Unresolved Load',
    display_code: 'E-PLANT-02-OTHER',
    asset_type: 'Other',
    type_code: 'OTHER',
    electrical_source: { kind: 'TBC' },
    metering_state: { kind: 'TBC' },
    meter_present: false,
    created_at: timestamp,
    updated_at: timestamp,
  },
];

const measurementAssignments: MeasurementAssignment[] = [
  {
    id: 'assignment-grid-total',
    installationId: installation.id,
    meterId: 'meter-msb',
    channelIds: ['msb-main'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'GRID_BOUNDARY', gridSupplyId: 'grid-1' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  },
  {
    id: 'assignment-mssb-total',
    installationId: installation.id,
    meterId: 'meter-mssb',
    channelIds: ['mssb-main'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'BOARD', boardId: 'board-mssb' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  },
  {
    id: 'assignment-pac',
    installationId: installation.id,
    meterId: 'meter-mssb',
    channelIds: ['mssb-pac'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-pac' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  },
  {
    id: 'assignment-wrong-board',
    installationId: installation.id,
    meterId: 'meter-msb',
    channelIds: ['msb-wrong'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-invalid' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  },
];

const virtualMeterDefinitions: VirtualMeterDefinition[] = [
  {
    id: 'virtual-showroom-residual',
    parentNodeId: 'board-mssb',
    totalMeasurementAssignmentId: 'assignment-mssb-total',
    subtractAssignmentIds: ['assignment-pac'],
    formulaVersion: 1,
    allocation: 'UNALLOCATED_RESIDUAL',
  },
];

export function electricalDiagramFixture(): ElectricalDiagramInput {
  return {
    installation: structuredClone(installation),
    zones: structuredClone(zones),
    boards: structuredClone(boards),
    siteAssets: structuredClone(assets),
    gridSupplies: structuredClone(gridSupplies),
    meterDevices: structuredClone(meterDevices),
    measurementAssignments: structuredClone(measurementAssignments),
    virtualMeterDefinitions: structuredClone(virtualMeterDefinitions),
  };
}
