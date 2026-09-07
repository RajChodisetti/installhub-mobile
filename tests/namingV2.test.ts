import {
  availableZoneCode,
  defaultMeterCustomName,
  generatedDisplayCodeV2,
  nameAfterTypeChange,
  normalizedCustomName,
  provisionalDisplayCodeV2,
  resolvedZoneCodes,
} from '../src/domain/namingV2';
import type { Installation, Zone } from '../src/types';

const installation: Installation = {
  id: 'installation', client_name: 'Client', site_name: 'Gold Coast', site_address: '',
  inspector_name: '', audit_date: '', status: 'Draft', site_code: 'GOLD',
  cloud_backup_enabled: false, created_at: '', updated_at: '',
};

const zone = (id: string, name: string, code?: string): Zone => ({
  id, audit_id: installation.id, zone_name: name, ...(code ? { zone_code: code } : {}),
  zone_description: '', photos: [], created_at: '', updated_at: '',
});

test('zone codes are deterministic and disambiguated in stable id order', () => {
  const zones = [zone('z2', 'Plant Room'), zone('z1', 'Plant Room')];
  const codes = resolvedZoneCodes(zones, installation.site_code!);
  assert.equal(codes.get('z1'), 'PLA-GOLD-01');
  assert.equal(codes.get('z2'), 'PLA-GOLD-02');
  assert.equal(availableZoneCode(zones, installation.site_code!, 'Plant Room'), 'PLA-GOLD-03');
});

test('new short zone codes stay within the contract and use a two-character base-36 sequence', () => {
  const zones = Array.from({ length: 10 }, (_, index) => zone(`z-${index}`, 'Plant Room'));
  const codes = resolvedZoneCodes(zones, 'A-Very-Long-Site-Code');
  assert.equal(codes.get('z-0'), 'PLA-A-VERY-L-01');
  assert.equal(codes.get('z-9'), 'PLA-A-VERY-L-0A');
  assert.ok([...codes.values()].every((code) => code.length <= 16));
});

test('v4 display codes share a two-digit sequence and include entity type plus name', () => {
  const zones = [zone('zone', 'Level 1', 'L1')];
  const generated = generatedDisplayCodeV2(installation, {
    zones,
    electricalAssets: [{
      id: 'b1', audit_id: installation.id, zone_id: 'zone', asset_name: 'Main',
      display_code: 'GOLD-L1-01-MAIN', asset_type: 'MSB', meter_present: false,
      meters: [], created_at: '', updated_at: '',
    }],
    siteAssets: [{
      id: 'a1', audit_id: installation.id, zone_id: 'zone', asset_name: 'AHU',
      asset_type: 'HVAC', display_code: 'GOLD-L1-02-AHU', meter_present: false,
      created_at: '', updated_at: '',
    }],
    meterDevices: [],
  }, {
    zoneId: 'zone', customName: 'Distribution Board', fallbackType: 'DB',
    entityKind: 'board', entityTypeCode: 'DB',
  });
  assert.equal(generated, 'GOLD-L1-03-DB-DISTRIBUTION-BOARD');

  const emptyInventory = { zones, electricalAssets: [], siteAssets: [], meterDevices: [] };
  assert.equal(generatedDisplayCodeV2(installation, emptyInventory, {
    zoneId: 'zone', customName: 'Workshop incomer', fallbackType: 'Main switchboard',
    entityKind: 'board', entityTypeCode: 'MSB',
  }), 'GOLD-L1-01-MSB-WORKSHOP-INCOMER');
  assert.equal(generatedDisplayCodeV2(installation, emptyInventory, {
    zoneId: 'zone', customName: 'Air handler 1', fallbackType: 'AC / HVAC',
    entityKind: 'site_asset', entityTypeCode: 'HVAC',
  }), 'GOLD-L1-01-HVAC-AIR-HANDLER-1');
  assert.equal(generatedDisplayCodeV2(installation, emptyInventory, {
    zoneId: 'zone', customName: 'Main incomer', fallbackType: 'A3RM Meter',
    entityKind: 'meter', entityTypeCode: 'A3RM',
  }), 'GOLD-L1-01-A3RM-MAIN-INCOMER');
  assert.equal(generatedDisplayCodeV2(installation, emptyInventory, {
    zoneId: 'zone', customName: 'A3RM Meter', fallbackType: 'A3RM Meter',
    entityKind: 'meter', entityTypeCode: 'A3RM',
  }), 'GOLD-L1-01-A3RM-METER');
});

test('custom suffixes are normalized and generated codes stay within 64 characters', () => {
  assert.equal(normalizedCustomName('Café AHU', 'HVAC'), 'CAFE-AHU');
  const generated = generatedDisplayCodeV2(
    { ...installation, site_code: 'INSTALLATION-CODE' },
    { zones: [zone('zone', 'Long', 'VERY-LONG-ZONE')], electricalAssets: [], siteAssets: [], meterDevices: [] },
    {
      zoneId: 'zone', customName: 'Café air handling unit with a very long installer supplied description',
      fallbackType: 'HVAC', entityKind: 'site_asset', entityTypeCode: 'HVAC',
    },
  );
  assert.ok(generated.length <= 64);
  assert.match(generated, /^INSTALLATION-COD-VERY-LONG-ZONE-01-HVAC-CAFE-AIR-HANDLING/);
});

test('offline v2 allocations share a durable zone high-water mark and do not reuse deletes', () => {
  const local = { ...installation };
  const inventory = {
    zones: [zone('zone', 'Level 1', 'L1'), zone('zone-2', 'Level 2', 'L2')],
    electricalAssets: [],
    siteAssets: [],
    meterDevices: [],
  };
  const first = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Main Switchboard', fallbackType: 'MSB', entityKind: 'board', entityTypeCode: 'MSB',
  });
  const second = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'A3RM Meter', fallbackType: 'A3RM Meter', entityKind: 'meter', entityTypeCode: 'A3RM',
  });
  const otherZone = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone-2', customName: 'Lighting', fallbackType: 'Lighting', entityKind: 'site_asset', entityTypeCode: 'LIGHTING',
  });
  assert.equal(first.value, 'GOLD-L1-01-MSB-MAIN-SWITCHBOARD');
  assert.equal(second.value, 'GOLD-L1-02-A3RM-METER');
  assert.equal(otherZone.value, 'GOLD-L2-01-LIGHTING');

  // No entities were inserted into inventory: only the durable high-water mark
  // prevents reusing 01/02 after an offline delete.
  const afterDelete = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'HVAC', fallbackType: 'HVAC', entityKind: 'site_asset', entityTypeCode: 'HVAC',
  });
  assert.equal(afterDelete.value, 'GOLD-L1-03-HVAC');
});

test('editable provisional names retain ordinals, confirmed names freeze, and legacy provisional names upgrade', () => {
  const local = { ...installation };
  const inventory = {
    zones: [zone('zone', 'Level 1', 'L1')],
    electricalAssets: [], siteAssets: [], meterDevices: [],
  };
  const original = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Distribution Board', fallbackType: 'DB', entityKind: 'board', entityTypeCode: 'DB',
  });
  const edited = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Kitchen Board', fallbackType: 'DB', entityKind: 'board', entityTypeCode: 'DB', current: original,
  });
  assert.equal(edited.value, 'GOLD-L1-01-DB-KITCHEN-BOARD');
  assert.equal(edited.ruleVersion, 4);

  const confirmed = { ...edited, provisional: false };
  assert.equal(provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Ignored', fallbackType: 'DB', entityKind: 'board', entityTypeCode: 'DB', current: confirmed,
  }), confirmed);
  const serverConfirmedWithoutFlag = { ...edited, provisional: undefined };
  assert.equal(provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Ignored again', fallbackType: 'DB', entityKind: 'board', entityTypeCode: 'DB',
    current: serverConfirmedWithoutFlag,
  }), serverConfirmedWithoutFlag);
  const legacy = {
    value: 'GOLD-DB-001', generatedValue: 'GOLD-DB-001', isOverridden: false,
    ruleVersion: 1, provisional: true,
  };
  const upgraded = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Upgraded', fallbackType: 'DB', entityKind: 'board', entityTypeCode: 'DB', current: legacy,
  });
  assert.equal(upgraded.value, 'GOLD-L1-02-DB-UPGRADED');
  assert.equal(upgraded.ruleVersion, 4);
});

test('type-derived names advance only while pristine', () => {
  assert.equal(defaultMeterCustomName('A3RM'), 'A3RM Meter');
  assert.equal(defaultMeterCustomName('A6M'), 'A6M Meter');
  assert.equal(defaultMeterCustomName('OTHER', 'PowerScout'), 'PowerScout');
  assert.equal(defaultMeterCustomName('OTHER', '', 'Acme'), 'Acme');
  assert.equal(defaultMeterCustomName('OTHER'), 'Other Meter');
  assert.equal(nameAfterTypeChange('A3RM Meter', 'A3RM Meter', 'A6M Meter'), 'A6M Meter');
  assert.equal(nameAfterTypeChange('Plant meter', 'A3RM Meter', 'A6M Meter'), 'Plant meter');
});
import assert from 'node:assert/strict';
import test from 'node:test';
