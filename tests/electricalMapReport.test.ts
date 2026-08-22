import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElectricalDiagramModel } from '../src/domain/electricalDiagram';
import type { ElectricalDiagramLayout } from '../src/domain/electricalDiagramLayout';
import {
  ELECTRICAL_REPORT_MAX_DETAIL_WINDOWS,
  buildElectricalMapReportHtml,
  planElectricalReportWindows,
  renderElectricalDiagramSvg,
} from '../src/services/electricalMapReport';
import { electricalDiagramFixture } from './fixtures/electricalDiagramFixture';

test('PDF map is an icon-first vector diagram with exact devices, loads and line semantics', () => {
  const model = buildElectricalDiagramModel(electricalDiagramFixture());
  const svg = renderElectricalDiagramSvg(model);
  const html = buildElectricalMapReportHtml(
    model,
    'by-electrical-hierarchy',
  );

  assert.match(svg, /<svg/);
  assert.match(svg, /Essendon HVAC Meter/);
  assert.match(svg, /DD83710147339/);
  assert.match(svg, /stroke-dasharray="8 6"/);
  assert.match(html, /Details by electrical hierarchy/);
  assert.match(html, /PAC 1 compressor/);
  assert.match(html, /200A/);
  assert.match(html, /device WW-002/);
  assert.match(html, /Ch 4/);
  assert.match(html, /HVAC \/ refrigeration/);
  assert.match(html, /Installed meter/);
  assert.match(html, /Supply - confirmed FED_FROM cable path/);
  assert.match(html, /Measures - confirmed channels; never changes supply/);
  assert.match(html, /Residual - calculation, not a physical cable/);
});

test('zone details keep equal display names separated by stable zone identity', () => {
  const input = electricalDiagramFixture();
  const originalZone = input.zones.find((zone) => zone.id === 'zone-showroom')!;
  input.zones.push({
    ...structuredClone(originalZone),
    id: 'zone-showroom-secondary',
    zone_code: 'SHOW2',
  });
  input.siteAssets.push({
    ...structuredClone(input.siteAssets.find((asset) => asset.id === 'asset-lighting')!),
    id: 'asset-secondary-zone',
    zone_id: 'zone-showroom-secondary',
    asset_name: 'Secondary zone lighting',
    display_code: 'E-SHOW2-01-LX',
  });

  const html = buildElectricalMapReportHtml(
    buildElectricalDiagramModel(input),
    'by-zone',
  );
  assert.equal(html.match(/<h3>Showroom \(SHOW\)<\/h3>/g)?.length, 1);
  assert.equal(html.match(/<h3>Showroom \(SHOW2\)<\/h3>/g)?.length, 1);
  const primaryGroup = html.slice(
    html.indexOf('<h3>Showroom (SHOW)</h3>'),
    html.indexOf('<h3>Showroom (SHOW2)</h3>'),
  );
  const secondaryGroup = html.slice(
    html.indexOf('<h3>Showroom (SHOW2)</h3>'),
    html.indexOf('<h3>Shared / unassigned electrical infrastructure</h3>'),
  );
  assert.match(primaryGroup, /E-SHOW-02-LX/);
  assert.doesNotMatch(primaryGroup, /E-SHOW2-01-LX/);
  assert.match(secondaryGroup, /E-SHOW2-01-LX/);
  assert.doesNotMatch(secondaryGroup, /E-SHOW-02-LX/);
});

test('measurement details identify the exact device when a board has several meters', () => {
  const input = electricalDiagramFixture();
  input.meterDevices.push({
    ...structuredClone(input.meterDevices[1]!),
    id: 'meter-mssb-secondary',
    serialNumber: 'SECONDARY-SERIAL',
    deviceNumber: 'WW-SECONDARY',
    displayName: {
      value: 'Secondary board meter',
      generatedValue: 'Secondary board meter',
      isOverridden: false,
      ruleVersion: 1,
    },
    channels: [{ id: 'secondary-spare', ordinal: 1, purpose: 'SPARE' }],
  });
  const html = buildElectricalMapReportHtml(
    buildElectricalDiagramModel(input),
    'by-electrical-hierarchy',
  );

  assert.match(
    html,
    /Measured by Essendon HVAC Meter · Serial DD83710147339 · Device WW-002 on E-SHOW-01-MSSB/,
  );
  assert.doesNotMatch(
    html,
    /Measured by Secondary board meter .* on E-SHOW-01-MSSB - Ch 4/,
  );
});

test('zone grouping emits each confirmed record once and shared infrastructure once', () => {
  const model = buildElectricalDiagramModel(electricalDiagramFixture());
  const html = buildElectricalMapReportHtml(model, 'by-zone');

  assert.match(html, /Details by physical zone/);
  assert.match(html, /Plant room/);
  assert.match(html, /Showroom/);
  assert.equal(
    html.match(/Shared \/ unassigned electrical infrastructure/g)?.length,
    1,
  );
  const details = html.slice(html.indexOf('<h2>Details by physical zone'));
  assert.equal(details.match(/<strong>E-SHOW-01-HVAC-PAC-1<\/strong>/g)?.length, 1);
});

test('electrical report escapes untrusted installation and device text', () => {
  const input = electricalDiagramFixture();
  input.installation.site_name = '<script>alert("site")</script>';
  input.meterDevices[1]!.displayName.value = '<b>unsafe meter</b>';
  const model = buildElectricalDiagramModel(input);
  const html = buildElectricalMapReportHtml(model, 'by-electrical-hierarchy');

  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<b>unsafe meter/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;unsafe meter&lt;\/b&gt;/);
});

test('on-device map detail pagination is deterministic and bounded', () => {
  const layout: ElectricalDiagramLayout = {
    width: 20_000,
    height: 12_000,
    nodes: [],
    edges: [],
  };
  const windows = planElectricalReportWindows(layout);

  assert.equal(windows.length, ELECTRICAL_REPORT_MAX_DETAIL_WINDOWS);
  assert.equal(windows[0]?.row, 0);
  assert.equal(windows[0]?.column, 0);
  assert.ok((windows[0]?.columnCount ?? 0) > 1);
  assert.deepEqual(planElectricalReportWindows(layout), windows);
});

test('an unresolved installation still renders a useful empty-map page', () => {
  const input = electricalDiagramFixture();
  input.gridSupplies = [];
  const model = buildElectricalDiagramModel(input);
  const html = buildElectricalMapReportHtml(model, 'by-electrical-hierarchy');

  assert.equal(model.nodes.length, 0);
  assert.match(html, /No confirmed electrical map/);
  assert.match(html, /Resolve the incoming supply/);
});
