import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detailSource = readFileSync(
  new URL('../src/screens/InstallationDetailScreen.tsx', import.meta.url),
  'utf8',
);
const navigatorSource = readFileSync(
  new URL('../src/navigation/RootNavigator.tsx', import.meta.url),
  'utf8',
);

const workspaceActions = [
  ['Electrical map & reconciliation', 'DataView'],
  ['Field forms & PDFs', 'FormsList'],
  ['Find devices', 'DeviceSearch'],
  ['Photo gallery', 'PhotoPreview'],
  ['Installation report pack', 'InstallationReport'],
] as const;

test('installation workspace exposes every core field workflow through a registered route', () => {
  assert.match(detailSource, /title="Installation workspace"/);
  const zonesIndex = detailSource.indexOf('title="Zones"');
  const incomingConnectionsIndex = detailSource.indexOf('title={`Incoming grid connections');
  const workspaceIndex = detailSource.indexOf('title="Installation workspace"');
  assert.ok(zonesIndex >= 0, 'zones should be visible on installation detail');
  assert.ok(incomingConnectionsIndex >= 0, 'incoming connections should be visible on installation detail');
  assert.ok(zonesIndex < workspaceIndex, 'zones should appear above the installation workspace');
  assert.ok(incomingConnectionsIndex < workspaceIndex, 'incoming connections should appear above field work');
  assert.doesNotMatch(detailSource, /title={`Zones & assets/);

  workspaceActions.forEach(([label, route]) => {
    assert.ok(detailSource.includes(label), `${label} should be visible in the workspace`);
    assert.ok(
      detailSource.includes(`navigation.navigate('${route}'`),
      `${label} should navigate to ${route}`,
    );
    assert.ok(
      navigatorSource.includes(`name="${route}"`),
      `${route} should be registered in the root navigator`,
    );
  });
  assert.doesNotMatch(detailSource, /Metering table/i);
});

test('secondary tools contain no duplicate field-work actions', () => {
  const moreToolsIndex = detailSource.indexOf("? 'More tools (locked)'");
  const modalIndex = detailSource.indexOf('<FormModal', moreToolsIndex);
  assert.ok(moreToolsIndex >= 0);
  assert.ok(modalIndex > moreToolsIndex);

  const secondaryToolsSource = detailSource.slice(moreToolsIndex, modalIndex);
  assert.doesNotMatch(secondaryToolsSource, /Incoming grid connections/);
  assert.doesNotMatch(secondaryToolsSource, /Field Forms \/ PDFs/);
  assert.doesNotMatch(secondaryToolsSource, /Installation data & checks/);
  assert.doesNotMatch(secondaryToolsSource, /Metering Table/);
  assert.doesNotMatch(secondaryToolsSource, /Full Installation Report/);
});

// Photo collection and persisted report-selection behavior are covered by
// clientReport.test.ts. The gallery shares that model with the report screen.
