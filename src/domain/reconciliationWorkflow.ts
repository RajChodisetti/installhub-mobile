import type {
  MeasurementAssignment,
  ReadinessIssue,
  SiteAsset,
} from '../types';

export type ReadinessIssueGroupId =
  | 'SITE_GRID'
  | 'SWITCHBOARDS'
  | 'ASSET_METERING'
  | 'DEVICES_CHANNELS'
  | 'FIELD_FORMS';

export interface ReadinessIssueSummaryGroup {
  id: ReadinessIssueGroupId;
  label: string;
  count: number;
  blocking: number;
  warnings: number;
}

export interface ExplicitReconciliationContext {
  siteAssets: Array<Pick<SiteAsset, 'id' | 'metering_state'>>;
  measurementAssignments: Array<Pick<MeasurementAssignment, 'id' | 'status' | 'target'>>;
}

/** Reconciliation is reserved for states the installer deliberately left
 * unresolved. Broken confirmed references and other validation failures still
 * block readiness, but appear in completion checks instead of being described
 * as TBC work. */
export function isExplicitReconciliationIssue(
  issue: ReadinessIssue,
  context: ExplicitReconciliationContext,
): boolean {
  if (
    issue.code === 'SUPPLY_TBC' &&
    (issue.entityType === 'board' || issue.entityType === 'site_asset')
  ) {
    return true;
  }
  if (
    issue.code === 'METERING_STATE_INVALID'
    && issue.entityType === 'site_asset'
    && issue.field === 'meteringState'
  ) {
    const asset = context.siteAssets.find((item) => item.id === issue.entityId);
    return Boolean(asset && (!asset.metering_state || asset.metering_state.kind === 'TBC'));
  }
  if (
    issue.code === 'MEASUREMENT_TARGET_TBC' &&
    issue.entityType === 'measurement_assignment' &&
    issue.field === 'targetConfirmation'
  ) {
    const assignment = context.measurementAssignments.find((item) => item.id === issue.entityId);
    return Boolean(
      assignment && (assignment.status === 'TBC' || assignment.target.kind === 'TBC'),
    );
  }
  return false;
}

export function partitionReadinessIssues(
  issues: ReadinessIssue[],
  context: ExplicitReconciliationContext,
): { reconciliation: ReadinessIssue[]; validation: ReadinessIssue[] } {
  const reconciliation: ReadinessIssue[] = [];
  const validation: ReadinessIssue[] = [];
  for (const issue of issues) {
    (isExplicitReconciliationIssue(issue, context) ? reconciliation : validation).push(issue);
  }
  return { reconciliation, validation };
}

const READINESS_GROUPS: Array<{
  id: ReadinessIssueGroupId;
  label: string;
  entityTypes: ReadinessIssue['entityType'][];
}> = [
  {
    id: 'SITE_GRID',
    label: 'Site and incoming grid',
    entityTypes: ['installation', 'grid_supply'],
  },
  {
    id: 'SWITCHBOARDS',
    label: 'Switchboards and supply links',
    entityTypes: ['board'],
  },
  {
    id: 'ASSET_METERING',
    label: 'Assets and metering',
    entityTypes: ['site_asset'],
  },
  {
    id: 'DEVICES_CHANNELS',
    label: 'Devices and channels',
    entityTypes: ['meter', 'channel', 'measurement_assignment'],
  },
  {
    id: 'FIELD_FORMS',
    label: 'Field forms',
    entityTypes: ['form'],
  },
];

/** Keep the installation workspace scannable without discarding any of the
 * underlying readiness checks. The detailed reconciliation screen still owns
 * every individual issue and repair action. */
export function summarizeReadinessIssues(
  issues: ReadinessIssue[],
): ReadinessIssueSummaryGroup[] {
  return READINESS_GROUPS.map((group) => {
    const matching = issues.filter((issue) => group.entityTypes.includes(issue.entityType));
    return {
      id: group.id,
      label: group.label,
      count: matching.length,
      blocking: matching.filter((issue) => issue.severity === 'ERROR').length,
      warnings: matching.filter((issue) => issue.severity === 'WARNING').length,
    };
  }).filter((group) => group.count > 0);
}

export function readinessIssueKey(issue: ReadinessIssue): string {
  return [issue.code, issue.entityType, issue.entityId, issue.field ?? ''].join(':');
}

export function reconciliationProgress(
  baselineIssueKeys: string[],
  currentIssueKeys: string[],
): { total: number; resolved: number; remaining: number; percent: number } {
  const baseline = new Set(baselineIssueKeys);
  const current = new Set(currentIssueKeys);
  const total = new Set([...baseline, ...current]).size;
  const resolved = [...baseline].filter((key) => !current.has(key)).length;
  return {
    total,
    resolved,
    remaining: current.size,
    percent: total === 0 ? 100 : Math.round((resolved / total) * 100),
  };
}
