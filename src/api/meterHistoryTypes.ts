export type MeterHistoryVersion = {
  id: string;
  recordVersionNumber: number;
  createdAt: string;
  createdByUserId: string | null;
  operation: 'SNAPSHOT' | 'REPLACEMENT' | 'ROLLBACK';
  sourceFormSubmissionId: string | null;
  restoredFromRecordVersionNumber: number | null;
  reason: string | null;
  device: {
    name: string;
    model: 'A3RM' | 'A6M' | 'OTHER';
    deviceNumber: string | null;
    serialNumber: string;
    channelCount: number;
    switchboardName: string;
  };
  isCurrentState: boolean;
  canRollback: boolean;
  rollbackBlockedReason?: string | null;
  stateHash: string | null;
};

export type MeterHistoryResponse = {
  installationId: string;
  meterId: string;
  versions: MeterHistoryVersion[];
  page: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
};

export type MeterHistoryRollbackResult = {
  installationId: string;
  meterHistory: {
    operation: 'ROLLBACK';
    meterId: string;
    restoredFromRecordVersionNumber: number;
    recordVersionNumber: number;
    treeRevision: number;
    reason: string;
  };
};

export interface MeterHistoryRollbackInput {
  targetRecordVersionNumber: number;
  baseTreeRevision: number;
  reason: string;
  idempotencyKey: string;
}
