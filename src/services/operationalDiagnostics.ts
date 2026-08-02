import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  projectOperationalDiagnostic,
  type MigrationDiagnosticCode,
  type OperationalDiagnosticEvent,
} from './operationalDiagnosticsPolicy';

const OPERATIONAL_DIAGNOSTICS_KEY = 'installhub.mobile.operational-diagnostics.v1';
const EVENT_LIMIT = 64;

async function append(event: OperationalDiagnosticEvent): Promise<void> {
  try {
    const current = await readOperationalDiagnostics();
    const projected = projectOperationalDiagnostic(event);
    if (!projected) return;
    await AsyncStorage.setItem(
      OPERATIONAL_DIAGNOSTICS_KEY,
      JSON.stringify([...current, projected].slice(-EVENT_LIMIT)),
    );
  } catch {
    // Diagnostics must never block storage, sync, or completion workflows.
  }
}

export async function readOperationalDiagnostics(): Promise<OperationalDiagnosticEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(OPERATIONAL_DIAGNOSTICS_KEY);
    if (!raw) return [];
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return [];
    return values
      .map(projectOperationalDiagnostic)
      .filter((event): event is OperationalDiagnosticEvent => Boolean(event))
      .slice(-EVENT_LIMIT);
  } catch {
    return [];
  }
}

const now = () => new Date().toISOString();

export const recordMigrationDiagnostic = (
  outcome: Extract<OperationalDiagnosticEvent, { kind: 'MIGRATION' }>['outcome'],
  recoveryCode: MigrationDiagnosticCode,
) => append({ kind: 'MIGRATION', recordedAt: now(), outcome, recoveryCode });

export const recordBackupPendingAge = (ageMs: number) =>
  append({ kind: 'BACKUP_PENDING', recordedAt: now(), ageMs: Math.max(0, Math.round(ageMs)) });

export const recordSyncDiagnostic = (input: {
  outcome: Extract<OperationalDiagnosticEvent, { kind: 'SYNC' }>['outcome'];
  conflict: boolean;
  schemaVersion: number;
  latencyMs: number;
}) => append({
  kind: 'SYNC',
  recordedAt: now(),
  outcome: input.outcome,
  conflict: input.conflict,
  schemaVersion: input.schemaVersion,
  latencyMs: Math.max(0, Math.round(input.latencyMs)),
});

export const recordCompletionRejection = (code: string) =>
  append({ kind: 'COMPLETION_REJECTED', recordedAt: now(), code });
