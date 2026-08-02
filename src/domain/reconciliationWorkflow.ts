import type { ReadinessIssue } from '../types';

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
