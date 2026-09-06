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
  assert.match(source, /M3 - Inspection/);
  assert.match(source, /M4 - BD\/Upselling/);
  assert.match(source, /M5 — Other/);
  assert.match(source, /label="Metering type selection"/);
  assert.match(source, /label="Custom job number"/);
  assert.match(detailSource, /\['Electricity NMI', electricityNmi\]/);
  assert.match(detailSource, /\['Existing device ID', item\.existing_device_id \?\? ''\]/);
  assert.match(detailSource, /\['Job comments \/ scope', item\.job_comments \?\? ''\]/);
  assert.doesNotMatch(detailSource, /Installation outcome/);
  assert.doesNotMatch(source, /<SectionHeader title="Installation outcome"/);
  assert.match(remoteSource, /existing_device_id: optionalText\(source, 'existingDeviceId', 'existing_device_id'\)/);
  assert.match(backupSource, /existingDeviceId: tree\.installation\.existing_device_id/);
  assert.match(detailSource, /setZoneCode\(availableZoneCode\(zones, value\)\)/);
  assert.match(detailSource, /zone_description: normalizedDescription/);
  assert.doesNotMatch(source, /label="Planned meter type"/);
  assert.doesNotMatch(source, /label="Fergus job number"/);
  assert.doesNotMatch(source, /label="Quote number"/);
  assert.doesNotMatch(source, /label="Customer name"/);
  assert.doesNotMatch(source, /fergus_job_number: nullableText/);
  assert.doesNotMatch(source, /quote_number: nullableText/);
});
