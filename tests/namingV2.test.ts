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
  const codes = resolvedZoneCodes(zones);
  assert.equal(codes.get('z1'), 'PLANT-ROOM');
  assert.equal(codes.get('z2'), 'PLANT-ROOM-2');
  assert.equal(availableZoneCode(zones, 'Plant Room'), 'PLANT-ROOM-3');
});

test('v2 display codes share a two-digit sequence across entity kinds in a zone', () => {
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
  }, { zoneId: 'zone', customName: 'Distribution Board', fallbackType: 'DB' });
  assert.equal(generated, 'GOLD-L1-03-DISTRIBUTION-BOARD');
});

test('custom suffixes are normalized and generated codes stay within 64 characters', () => {
  assert.equal(normalizedCustomName('Café AHU', 'HVAC'), 'CAFE-AHU');
  const generated = generatedDisplayCodeV2(
    { ...installation, site_code: 'INSTALLATION-CODE' },
    { zones: [zone('zone', 'Long', 'VERY-LONG-ZONE')], electricalAssets: [], siteAssets: [], meterDevices: [] },
    { zoneId: 'zone', customName: 'Café air handling unit with a very long installer supplied description', fallbackType: 'HVAC' },
  );
  assert.ok(generated.length <= 64);
  assert.match(generated, /^INSTALLATION-COD-VERY-LONG-ZONE-01-CAFE-AIR-HANDLING/);
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
    zoneId: 'zone', customName: 'Main Switchboard', fallbackType: 'MSB',
  });
  const second = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'A3RM Meter', fallbackType: 'A3RM Meter',
  });
  const otherZone = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone-2', customName: 'Lighting', fallbackType: 'Lighting',
  });
  assert.equal(first.value, 'GOLD-L1-01-MAIN-SWITCHBOARD');
  assert.equal(second.value, 'GOLD-L1-02-A3RM-METER');
  assert.equal(otherZone.value, 'GOLD-L2-01-LIGHTING');

  // No entities were inserted into inventory: only the durable high-water mark
  // prevents reusing 01/02 after an offline delete.
  const afterDelete = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'HVAC', fallbackType: 'HVAC',
  });
  assert.equal(afterDelete.value, 'GOLD-L1-03-HVAC');
});

test('editable v2 suffixes retain their ordinal while confirmed and legacy names stay frozen', () => {
  const local = { ...installation };
  const inventory = {
    zones: [zone('zone', 'Level 1', 'L1')],
    electricalAssets: [], siteAssets: [], meterDevices: [],
  };
  const original = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Distribution Board', fallbackType: 'DB',
  });
  const edited = provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Kitchen Board', fallbackType: 'DB', current: original,
  });
  assert.equal(edited.value, 'GOLD-L1-01-KITCHEN-BOARD');

  const confirmed = { ...edited, provisional: false };
  assert.equal(provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Ignored', fallbackType: 'DB', current: confirmed,
  }), confirmed);
  const serverConfirmedWithoutFlag = { ...edited, provisional: undefined };
  assert.equal(provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Ignored again', fallbackType: 'DB',
    current: serverConfirmedWithoutFlag,
  }), serverConfirmedWithoutFlag);
  const legacy = {
    value: 'GOLD-DB-001', generatedValue: 'GOLD-DB-001', isOverridden: false,
    ruleVersion: 1, provisional: true,
  };
  assert.equal(provisionalDisplayCodeV2(local, inventory, {
    zoneId: 'zone', customName: 'Ignored', fallbackType: 'DB', current: legacy,
  }), legacy);
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
