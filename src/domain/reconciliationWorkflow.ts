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

const READINESS_REASON_BY_CODE: Record<string, string> = {
  CHANNEL_DUPLICATE_ASSIGNMENT: 'The same device channel is included in more than one measurement group, so its reading would be counted twice.',
  CHANNEL_NOT_FOUND: 'A saved measurement group refers to a device channel that no longer exists.',
  CHANNEL_PURPOSE_CONFLICT: 'The channel purpose does not match the item that its measurement group is linked to.',
  CHANNEL_UNASSIGNED: 'An active non-spare channel has not been placed in a measurement group.',
  CUSTOM_TYPE_REQUIRED: 'Other was selected without recording the custom equipment type.',
  DISPLAY_CODE_DUPLICATE: 'Two records use the same display code, so the code cannot identify one item safely.',
  DISPLAY_CODE_INVALID: 'The saved display code is missing or does not follow the required format.',
  ELECTRICAL_CYCLE: 'The saved supply links form a loop instead of a valid upstream-to-downstream path.',
  FORM_CONTEXT_REQUIRED: 'This form is missing a required link to its zone, switchboard, or device.',
  FORM_INCOMPLETE: 'This form still has required answers or evidence that have not been completed.',
  GRID_SUPPLY_INVALID: 'The incoming connection is missing required details or conflicts with another saved connection.',
  METER_BOARD_MISMATCH: 'This device is linked to a switchboard that does not contain it.',
  METER_CAPABILITY_REQUIRED: 'Required channel or sensor capability details have not been recorded for this device.',
  METER_DEVICE_REQUIRED: 'Required device identity, model, or channel details have not been recorded.',
  METER_PRESENT_MISMATCH: 'The meter-present answer does not match the devices or measurement links saved for this item.',
  PHASE_GROUP_INVALID: 'The number of selected channels does not match the chosen phase grouping.',
  SENSOR_RATING_INVALID: 'The saved CT or Rogowski rating is missing or does not match this device type.',
  SUPPLY_SOURCE_INVALID: 'The saved incoming connection or parent switchboard link no longer points to a valid record.',
  VIRTUAL_METER_SOURCE_INCOMPLETE: 'There are not enough confirmed parent and child measurements to calculate this virtual reading safely.',
};

/** Plain-language reason shown beside a canonical reconciliation error. */
export function reconciliationIssueWhy(issue: ReadinessIssue): string {
  if (issue.code === 'SUPPLY_TBC') {
    if (issue.entityType === 'board') {
      return 'This switchboard was saved without a confirmed incoming connection or parent switchboard.';
    }
    if (issue.entityType === 'site_asset') {
      return 'This asset was saved without a confirmed incoming connection or supplying switchboard.';
    }
    return 'This record was saved without a confirmed electrical supply.';
  }
  if (issue.code === 'METERING_STATE_INVALID') {
    return issue.field === 'meteringState'
      ? 'This asset was saved without confirming whether it is metered or unmetered.'
      : 'The asset metering choice does not match its saved measurement group.';
  }
  if (issue.code === 'MEASUREMENT_TARGET_TBC') {
    return 'This channel group was saved without confirming what it measures.';
  }
  return READINESS_REASON_BY_CODE[issue.code]
    ?? 'The saved record does not meet the current installation rules. Open it to review the highlighted fields.';
}

/** Reconciliation is reserved for deliberately unresolved relationships.
 * Optional quality diagnostics never become completion gates. */
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
    (issue.field === 'targetConfirmation' || issue.field === 'target')
  ) {
    const assignment = context.measurementAssignments.find((item) => item.id === issue.entityId);
    return Boolean(
      assignment && assignment.target.kind === 'TBC',
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
