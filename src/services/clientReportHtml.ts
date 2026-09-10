import { clientReportModel, type ClientReportData, type ClientReportPhotoExclusions } from '../domain/clientReport';

function escape(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export function buildClientReportHtml(data: ClientReportData, excluded: ClientReportPhotoExclusions, images: Record<string, string>): string {
  const report = clientReportModel(data, excluded);
  const installation = data.installation;
  const assets = data.siteAssets.slice(0, 250).map((asset) => `<tr><td>${escape(asset.asset_name)}</td><td>${escape(asset.asset_type)}</td><td>${asset.metering_state?.kind === 'METERED' ? 'Metered' : asset.metering_state?.kind === 'UNMETERED' ? 'Unmetered' : 'To be confirmed'}</td></tr>`).join('');
  const imageFor = (photo: (typeof report.includedPhotos)[number]) => {
    const source = images[photo.key];
    if (!source || !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(source)) throw new Error(`Preview image unavailable: ${photo.label}`);
    return source;
  };
  let evidence = '';
  let compact: typeof report.includedPhotos = [];
  const flushCompact = () => {
    if (!compact.length) return;
    const columns = compact.length <= 2 ? 2 : 3;
    evidence += `<div class="photo-grid cols-${columns}">${compact.map((photo) => `<figure><img src="${imageFor(photo)}" alt="${escape(photo.label)}"/><figcaption>${escape(photo.label)}</figcaption></figure>`).join('')}</div>`;
    compact = [];
  };
  for (const photo of report.includedPhotos) {
    if (photo.largeInPdf) {
      flushCompact();
      evidence += `<figure class="photo-large"><img src="${imageFor(photo)}" alt="${escape(photo.label)}"/><figcaption>${escape(photo.label)}</figcaption></figure>`;
    } else compact.push(photo);
  }
  flushCompact();
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  @page{size:A4;margin:16mm}body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#142F70;font-size:11pt;line-height:1.5}h1{font-size:26pt}h2{font-size:17pt;border-bottom:1px solid #cbd5e1;padding-bottom:6pt;margin-top:22pt;break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}header{border-bottom:3px solid #142F70}p,td{color:#334155}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #cbd5e1;padding:6pt;text-align:left}tr,figure{break-inside:avoid;page-break-inside:avoid}.photo-grid{display:grid;gap:8pt;margin:8pt 0}.photo-grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.photo-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}figure{margin:0;padding:4pt;border:1px solid #CBD5E1;border-radius:5px;background:#fff}figure img{display:block;width:100%;height:auto;max-height:172px;object-fit:contain}.photo-large{display:block;width:100%;margin:9pt 0}.photo-large img{width:100%;height:auto;max-height:370px;object-fit:contain}figcaption{font-size:9pt;color:#475569;margin-top:4pt;overflow-wrap:anywhere}.zone{padding:8pt;background:#f1f5f9;margin-bottom:7pt;break-inside:avoid}</style></head><body>
  <header><small>FIELD APP COMPLETE</small><h1>Installation summary</h1><h2>${escape(installation.site_name)}</h2><p>${escape(installation.client_name)} · ${escape(installation.site_address)}</p></header>
  <p>Installer: ${escape(installation.inspector_name)}<br/>Date: ${escape(installation.audit_date)}<br/>Status: ${escape(installation.status)}<br/>Zones: ${data.zones.length} · Switchboards: ${data.electricalAssets.length} · Meters: ${report.meterCount}</p>
  <h2>Electrical overview</h2><p>${data.electricalAssets.length} switchboards and ${report.meterCount} installed meter devices were documented across ${data.zones.length} site zones.</p>
  ${report.zones.map((zone) => `<div class="zone"><strong>${escape(zone.name)}</strong><br/>${zone.boards} switchboards · ${zone.assets} site assets</div>`).join('')}
  <h2>Loads and site assets</h2><p>${data.siteAssets.length} site assets were recorded; ${report.meteredAssetCount} have confirmed direct metering.</p>${assets ? `<table><thead><tr><th>Asset</th><th>Type</th><th>Metering</th></tr></thead><tbody>${assets}</tbody></table>` : ''}
  ${data.siteAssets.length > 250 ? '<p>First 250 assets shown in this preview. The formal report pack contains the authoritative dataset.</p>' : ''}
  <h2>Commissioning records</h2><p>${report.completedFormCount} completed field forms${report.completedFormNames.length ? `: ${escape(report.completedFormNames.join(', '))}` : ''}.</p><p>${report.openTbcCount ? `${report.openTbcCount} relationships remain to be confirmed.` : 'All recorded relationships are confirmed.'}</p>
  <h2>Selected evidence</h2><p>${report.includedPhotos.length} of ${report.photos.length} available photos included.</p>${evidence || '<p>No evidence selected for this preview.</p>'}
  </body></html>`;
}
