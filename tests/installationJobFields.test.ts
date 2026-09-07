import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Field App authors planning fields and shows assigned job details without outcomes', () => {
  const source = readFileSync(
    new URL('../src/components/forms/index.tsx', import.meta.url),
    'utf8',
  );
  const detailSource = readFileSync(
    new URL('../src/screens/InstallationDetailScreen.tsx', import.meta.url),
    'utf8',
  );
  const remoteSource = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  const backupSource = readFileSync(
    new URL('../src/services/backupMedia.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /label="Electricity NMI"/);
  assert.match(source, /initialElectricityNmi/);
  assert.match(source, /electricityNmi: nullableText\(electricity_nmi\)/);
  assert.match(source, /label="MaaS"/);
  assert.match(source, /Not recorded/);
  assert.match(source, /label="Scope categorization"/);
  assert.match(source, /M1 - New install/);
  assert.match(source, /M2 - Faults \/ COMMS fault/);
  assert.match(source, /Meters to replace/);
  assert.match(source, /knownReplacementMeters/);
  assert.match(source, /Select one or more known site meters, or add a meter number that is not listed/);
  assert.match(source, /storedReplacementMeterNumbers\(replacement_meter_numbers\)/);
  assert.match(source, /M3 - Inspection/);
  assert.match(source, /M4 - BD\/Upselling/);
  assert.match(source, /M5 — Other/);
  assert.match(source, /label="Metering type selection"/);
  assert.match(source, /label="Custom job number"/);
  [
    'Client Name',
    'Title',
    'Job Number #',
    'Site Name',
    'Site Address',
    'Suburb',
    'State',
    'Postcode',
    'Site Contact Name',
    'Site Contact Number',
    'Site Contact Email',
    'MaaS (Yes/No)',
    'MAAS Type',
    'Meter Type',
    'Job Type',
    'Scope Notes',
    'Electricity NMI',
  ].forEach((label) => {
    assert.ok(detailSource.includes(label), `${label} should be visible on installation detail`);
  });
  [
    'Site & address',
    'Client & contact',
    'Job & schedule',
    'Metering & supply',
  ].forEach((section) => {
    assert.ok(detailSource.includes(section), `${section} should organize installation details`);
  });
  assert.match(detailSource, /const electricityNmi = primaryGridSupply\?\.nmi\?\.trim\(\) \?\? ''/);
  assert.match(detailSource, /const hasElectricityNmi = electricityNmi\.length > 0/);
  assert.match(detailSource, /const showAddNmi = !readOnly && !hasElectricityNmi/);
  assert.match(detailSource, /\{showAddNmi \? \(/);
  assert.match(detailSource, /title="Add NMI"/);
  assert.doesNotMatch(detailSource, /Edit NMI/);
  assert.match(detailSource, /openGridEditor\(primaryGridSupply\?\.id\)/);
  assert.match(detailSource, /\['Meters to replace', replacementMeterNumbers\.length/);
  assert.match(detailSource, /title={`Replace \$\{meterNumber\}`}/);
  assert.match(detailSource, /\['Scope Notes', recordedValue\(item\.job_comments\)\]/);
  assert.doesNotMatch(detailSource, /Installation outcome/);
  assert.doesNotMatch(source, /<SectionHeader title="Installation outcome"/);
  assert.match(remoteSource, /existing_device_id: optionalText\(source, 'existingDeviceId', 'existing_device_id'\)/);
  assert.match(remoteSource, /schedule_title: scheduleTitle/);
  assert.match(backupSource, /existingDeviceId: tree\.installation\.existing_device_id/);
  assert.match(detailSource, /availableZoneCode\(zones, item\.site_code \|\| item\.site_name, value\)/);
  assert.doesNotMatch(detailSource, /Customer Name/);
  assert.match(detailSource, /assignedJobSummary\?\.schedule_title/);
  assert.match(detailSource, /zone_description: normalizedDescription/);
  assert.doesNotMatch(source, /label="Planned meter type"/);
  assert.doesNotMatch(source, /label="Fergus job number"/);
  assert.doesNotMatch(source, /label="Quote number"/);
  assert.doesNotMatch(source, /label="Customer name"/);
  assert.doesNotMatch(source, /fergus_job_number: nullableText/);
  assert.doesNotMatch(source, /quote_number: nullableText/);
});
