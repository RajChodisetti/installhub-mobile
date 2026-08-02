export type MigrationDiagnosticCode =
  | 'CORRUPT_STORE'
  | 'MIGRATION_FAILED'
  | 'RECOVERY_WRITE_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'RECOVERY_COPY_RETAINED'
  | 'RECOVERY_RESTORED';

export type OperationalDiagnosticEvent =
  | {
      kind: 'MIGRATION';
      recordedAt: string;
      outcome: 'SUCCESS' | 'RECOVERY_AVAILABLE' | 'RECOVERED' | 'FAILED';
      recoveryCode: MigrationDiagnosticCode;
    }
  | {
      kind: 'BACKUP_PENDING';
      recordedAt: string;
      ageMs: number;
    }
  | {
      kind: 'SYNC';
      recordedAt: string;
      outcome: 'SUCCESS' | 'FAILURE' | 'OFFLINE' | 'CONFLICT';
      conflict: boolean;
      schemaVersion: number;
      latencyMs: number;
    }
  | {
      kind: 'COMPLETION_REJECTED';
      recordedAt: string;
      code: string;
    };

const MIGRATION_CODES = new Set<MigrationDiagnosticCode>([
  'CORRUPT_STORE',
  'MIGRATION_FAILED',
  'RECOVERY_WRITE_FAILED',
  'PERSISTENCE_FAILED',
  'RECOVERY_COPY_RETAINED',
  'RECOVERY_RESTORED',
]);

function safeRecordedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function safeMetric(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue >= 0 ? numberValue : null;
}

/**
 * Privacy boundary for local operational diagnostics. It reconstructs a new
 * object from an explicit allow-list and therefore cannot retain answers,
 * file locations, auth material, customer fields, or recovery secrets.
 */
export function projectOperationalDiagnostic(value: unknown): OperationalDiagnosticEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const recordedAt = safeRecordedAt(raw.recordedAt);
  if (!recordedAt) return null;

  if (raw.kind === 'MIGRATION') {
    const outcomes = new Set(['SUCCESS', 'RECOVERY_AVAILABLE', 'RECOVERED', 'FAILED']);
    if (!outcomes.has(String(raw.outcome)) || !MIGRATION_CODES.has(raw.recoveryCode as MigrationDiagnosticCode)) {
      return null;
    }
    return {
      kind: 'MIGRATION',
      recordedAt,
      outcome: raw.outcome as Extract<OperationalDiagnosticEvent, { kind: 'MIGRATION' }>['outcome'],
      recoveryCode: raw.recoveryCode as MigrationDiagnosticCode,
    };
  }

  if (raw.kind === 'BACKUP_PENDING') {
    const ageMs = safeMetric(raw.ageMs);
    return ageMs === null ? null : { kind: 'BACKUP_PENDING', recordedAt, ageMs };
  }

  if (raw.kind === 'SYNC') {
    const outcomes = new Set(['SUCCESS', 'FAILURE', 'OFFLINE', 'CONFLICT']);
    const latencyMs = safeMetric(raw.latencyMs);
    const schemaVersion = safeMetric(raw.schemaVersion);
    if (!outcomes.has(String(raw.outcome)) || latencyMs === null || schemaVersion === null) return null;
    return {
      kind: 'SYNC',
      recordedAt,
      outcome: raw.outcome as Extract<OperationalDiagnosticEvent, { kind: 'SYNC' }>['outcome'],
      conflict: raw.conflict === true,
      schemaVersion,
      latencyMs,
    };
  }

  if (raw.kind === 'COMPLETION_REJECTED') {
    const code = typeof raw.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(raw.code)
      ? raw.code
      : 'UNKNOWN';
    return { kind: 'COMPLETION_REJECTED', recordedAt, code };
  }
  return null;
}
