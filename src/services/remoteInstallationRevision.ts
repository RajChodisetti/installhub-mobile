import { sha256 } from 'js-sha256';
import type { RemoteInstallationTree } from '../api/apiClient';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) output[key] = canonicalize(child);
  }
  return output;
}

function byRemoteId(
  records: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...records].sort((left, right) =>
    String(left.id ?? '').localeCompare(String(right.id ?? '')));
}

/**
 * Stable content identity for one pulled server tree. Top-level DB result order
 * is ignored, while meaningful nested order (for example meter channels) is
 * retained.
 */
export function remoteInstallationTreeRevision(
  tree: RemoteInstallationTree,
): string {
  return sha256(JSON.stringify(canonicalize({
    installation: tree.installation,
    gridSupplies: byRemoteId(tree.gridSupplies ?? []),
    zones: byRemoteId(tree.zones),
    electricalAssets: byRemoteId(tree.electricalAssets),
    siteAssets: byRemoteId(tree.siteAssets),
    meterDevices: byRemoteId(tree.meterDevices ?? []),
    measurementAssignments: byRemoteId(tree.measurementAssignments ?? []),
    formSubmissions: byRemoteId(tree.formSubmissions),
    serverDerived: tree.serverDerived,
  })));
}
