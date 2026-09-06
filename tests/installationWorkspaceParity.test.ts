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
  ['Metering table', 'MeteringTable'],
  ['Find devices', 'DeviceSearch'],
  ['Photo gallery', 'PhotoPreview'],
  ['Installation report pack', 'InstallationReport'],
] as const;

test('installation workspace exposes every core field workflow through a registered route', () => {
  assert.match(detailSource, /title="Installation workspace"/);
  assert.match(detailSource, /title={`Zones & assets/);

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
});

// Photo collection and persisted report-selection behavior are covered by
// clientReport.test.ts. The gallery shares that model with the report screen.
