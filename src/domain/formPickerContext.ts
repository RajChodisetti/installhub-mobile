import type { FormType } from '../types';

export interface FormPickerContext {
  boardId?: string;
  meterId?: string;
  siteAssetId?: string;
}

export function wwCommissioningPickerParams({
  installationId,
  zoneId,
  boardId,
}: {
  installationId: string;
  zoneId: string;
  boardId: string;
}) {
  return { installationId, zoneId, boardId, formType: 'ww-installation' as const };
}

export function isFormTypeAvailableForContext(
  formType: FormType,
  { boardId, meterId, siteAssetId }: FormPickerContext,
): boolean {
  if (formType === 'comms-fault' && !meterId) return false;
  if (boardId && meterId) {
    return formType === 'ww-installation' || formType === 'comms-fault';
  }
  if (meterId) return formType === 'comms-fault';
  if (boardId) return formType === 'ww-installation' || formType === 'ace-switchboard';
  if (siteAssetId) {
    return formType === 'honeywell-q400'
      || formType === 'captis-logger'
      || formType === 'sums-logger';
  }
  return true;
}
