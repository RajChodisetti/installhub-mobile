import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const formsSource = readFileSync(
  new URL('../src/components/forms/index.tsx', import.meta.url),
  'utf8',
);
const boardDetailSource = readFileSync(
  new URL('../src/screens/BoardDetailScreen.tsx', import.meta.url),
  'utf8',
);
const zoneWorkspaceSource = readFileSync(
  new URL('../src/screens/ZoneWorkspaceScreen.tsx', import.meta.url),
  'utf8',
);
const meterScreenSource = readFileSync(
  new URL('../src/screens/MeterFormScreen.tsx', import.meta.url),
  'utf8',
);
const capabilitySource = readFileSync(
  new URL('../src/components/ChannelCapabilitiesEditor.tsx', import.meta.url),
  'utf8',
);

test('saving a switchboard opens or remains on its switchboard view', () => {
  assert.match(zoneWorkspaceSource, /const created = await electricalAssetsRepo\.create/);
  assert.match(zoneWorkspaceSource, /navigation\.navigate\('BoardDetail', \{\s*boardId: created\.id,/);
  assert.doesNotMatch(
    boardDetailSource,
    /setEditOpen\(false\);\s*navigation\.goBack\(\)/,
  );
});

test('switchboard view uses one portal-aligned Add meter action', () => {
  assert.doesNotMatch(boardDetailSource, /Commission new device/);
  assert.doesNotMatch(boardDetailSource, /Add Other Meter/);
  assert.match(boardDetailSource, /title="Add meter"/);
  assert.match(
    boardDetailSource,
    /navigation\.navigate\('MeterForm', \{\s*installationId,\s*boardId,\s*\}\)/,
  );
});

test('switchboard field names match the portal editor', () => {
  assert.match(formsSource, /label="Switchboard name"/);
  [
    'Switchboard name',
    'Switchboard type',
    'Custom switchboard type',
    'Location description',
    'Amperage rating',
    'What supplies this switchboard?',
    'Grid supply',
    'Confirmed parent',
    'Sub-circuits description',
    'Comments',
    'Save switchboard',
    'Main switchboard photo',
    'Extra photos',
  ].forEach((label) => assert.ok(formsSource.includes(label), `${label} should be present`));
});

test('meter editor exposes the portal identity, channel, and evidence fields', () => {
  [
    'Device identity',
    'Device family',
    'Device model',
    'Manufacturer',
    'Custom model',
    'Device name',
    'Generated asset ID',
    'Device ID / serial',
    'Site / asset tag (optional)',
    'Classification',
    'Coverage',
    'Operational notes',
    'Verification & commissioning',
    'Pre-start safety',
    'Switchboard details',
    'Purpose',
    'Load type',
    'Custom load type',
    'CT rating',
    'Rogowski coil',
    'Description',
    'Phase label',
    'Sensor rating / metadata',
    'Meter evidence',
    'Installed device',
    'Switchboard overview',
    'Device and channel labeling',
    'Extra meter photos',
  ].forEach((label) => assert.ok(formsSource.includes(label), `${label} should be present`));

  assert.match(formsSource, /'Wattwatchers' : 'Other manufacturer'/);
  assert.match(formsSource, /'Utility \/ Gate Meter'/);
  assert.match(formsSource, /'Entire Board Load'/);
  assert.match(formsSource, /'CSM550 - External High Gain'/);
  assert.match(meterScreenSource, /label="Measured item"/);
  assert.match(meterScreenSource, /'Measured switchboard'/);
  assert.match(meterScreenSource, /'Measured site asset'/);
  assert.match(meterScreenSource, /'Measured Grid boundary'/);
  assert.match(meterScreenSource, /Save meter and measurement groups/);
  assert.match(meterScreenSource, /Add another measurement group/);
  assert.match(meterScreenSource, /Complete measurement group/);
  assert.match(meterScreenSource, /lockDeviceType=\{Boolean\(meterId && meter\.device_type === 'Other'\)\}/);

  const phaseIndex = meterScreenSource.indexOf('label="Phase grouping"');
  const itemIndex = meterScreenSource.indexOf('label="Measured item"', phaseIndex);
  const flowIndex = meterScreenSource.indexOf('label="Energy flow"', itemIndex);
  const targetIndex = meterScreenSource.indexOf("'Measured switchboard'", flowIndex);
  const channelsIndex = meterScreenSource.indexOf('Measured channels in this group', targetIndex);
  assert.ok(phaseIndex < itemIndex && itemIndex < flowIndex && flowIndex < targetIndex && targetIndex < channelsIndex);
});

test('site asset supply question uses the same wording as the portal', () => {
  [
    'What supplies this asset?',
    'Incoming grid connection',
    'Switchboard',
    'To be confirmed',
    'Supplying switchboard',
    'This electrical relationship may cross physical zones.',
  ].forEach((label) => assert.ok(formsSource.includes(label), `${label} should be present`));
  assert.doesNotMatch(formsSource, /label="Electrical source type"/);
});

test('new Other meters start with an editable custom channel like the portal', () => {
  assert.match(
    formsSource,
    /deviceType === 'A6M' \? 6 : deviceType === 'A3RM' \? 3 : 1/,
  );
  assert.match(formsSource, /id: `\$\{id\}:\$\{index \+ 1\}`, ordinal: index \+ 1, purpose: 'SPARE'/);
});

test('iOS channel controls and ordering match the portal channel editor', () => {
  [
    'Channels',
    'Three channels for A3RM, six for A6M, or one or more explicit custom channels.',
    'Restore channel layout',
    'Add channel',
    'Add site asset',
    'Remove',
    'Purpose',
    'Load type',
    'Custom load type',
    'CT rating',
    'Rogowski coil',
    'Description',
    'Phase label',
    'Sensor rating / metadata',
    'Select an option',
    'Channel capabilities',
    'Add capability',
  ].forEach((label) => assert.ok(
    formsSource.includes(label) || capabilitySource.includes(label),
    `${label} should be present`,
  ));
  assert.doesNotMatch(formsSource, /Remove last channel/);
  assert.match(formsSource, /const CT_RATINGS = \['60A', '120A', '200A', '400A', '600A'\]/);
  assert.match(formsSource, /'3000A – 9cm',[\s\S]*'3000A – 20cm',[\s\S]*'3000A – 29cm'/);
  assert.match(formsSource, /options=\{\['', \.\.\.CT_RATINGS\]\}/);
  assert.match(formsSource, /options=\{\['', \.\.\.ROGOWSKI\]\}/);
  assert.doesNotMatch(formsSource, /withLegacyOption\(CT_RATINGS/);
  assert.doesNotMatch(formsSource, /withLegacyOption\(ROGOWSKI/);
  assert.match(formsSource, /channelAfterSensorRatingChange\(selectedType, channel, value\)/);
  assert.match(formsSource, /channelWithModelValidSensor\(selectedType, \{ \.\.\.c, \[key\]: val \}\)/);
  assert.doesNotMatch(capabilitySource, /title=.*Text|title=.*JSON/);
  assert.match(capabilitySource, /Record arbitrary manufacturer capability keys without assuming a standard meter layout\./);

  const channelStart = formsSource.indexOf('title={`Channel ${ch.ordinal');
  const purposeIndex = formsSource.indexOf('label="Purpose"', channelStart);
  const loadIndex = formsSource.indexOf('label="Load type"', purposeIndex);
  const customIndex = formsSource.indexOf('label="Custom load type"', loadIndex);
  const ctIndex = formsSource.indexOf('label="CT rating"', customIndex);
  const rogowskiIndex = formsSource.indexOf('label="Rogowski coil"', ctIndex);
  const descriptionIndex = formsSource.indexOf('label="Description"', customIndex);
  const phaseIndex = formsSource.indexOf('label="Phase label"', descriptionIndex);
  const sensorIndex = formsSource.indexOf('label="Sensor rating / metadata"', phaseIndex);
  const capabilityIndex = formsSource.indexOf('<ChannelCapabilitiesEditor', sensorIndex);
  assert.ok(
    channelStart < purposeIndex
      && purposeIndex < loadIndex
      && loadIndex < customIndex
      && customIndex < ctIndex
      && ctIndex < rogowskiIndex
      && rogowskiIndex < descriptionIndex
      && descriptionIndex < phaseIndex
      && phaseIndex < sensorIndex
      && sensorIndex < capabilityIndex,
  );
});
