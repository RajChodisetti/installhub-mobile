/** Installation confirmations are separate from evidence-upload counters. No record IDs leave the run. */
export interface BackupInstallationOutcome {
  selected: number;
  confirmed: number;
  alreadyCurrent: number;
  deferred: number;
  remaining: number;
}

export function shouldRecordConfirmedBackup(progress: {
  phase: string; installationOutcome?: BackupInstallationOutcome;
}): boolean {
  const outcome = progress.installationOutcome;
  return progress.phase === 'done' && Boolean(outcome && outcome.confirmed > 0
    && outcome.remaining === 0 && outcome.deferred === 0);
}

function installations(count: number): string {
  return `${count} installation${count === 1 ? '' : 's'}`;
}

export function backupOutcomeMessage(outcome?: BackupInstallationOutcome): {
  title: string; message: string; needsAttention: boolean;
} {
  if (!outcome) return {
    title: 'Backup check finished',
    message: 'Installation confirmation details are unavailable.', needsAttention: false,
  };
  if (outcome.remaining > 0 || outcome.deferred > 0) return {
    title: 'Backup needs attention',
    message: `${installations(outcome.confirmed)} backed up and confirmed. ${installations(outcome.remaining)} still ${outcome.remaining === 1 ? 'needs' : 'need'} backup.${outcome.deferred ? ` Backup is paused for ${installations(outcome.deferred)}; open the installation to review its status.` : ''}`,
    needsAttention: true,
  };
  if (outcome.confirmed > 0) return {
    title: 'Installation backup confirmed',
    message: `${installations(outcome.confirmed)} backed up and confirmed.`, needsAttention: false,
  };
  return {
    title: 'Backup check finished',
    message: `${outcome.selected > 0 ? 'No installation backups confirmed.' : 'No installations uploaded.'}${outcome.alreadyCurrent ? ` ${installations(outcome.alreadyCurrent)} already up to date.` : ''}`,
    needsAttention: false,
  };
}
