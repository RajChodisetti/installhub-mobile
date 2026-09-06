import type { AppDataStore, FormSubmission } from '../types';
import {
  meterAfterCommsReplacement,
  supportedFormAnswers,
  validateForm,
} from '../forms/catalog';
import {
  answersWithCanonicalBoardContext,
  deviceLabelPrefix,
  meterFromInstallationForm,
} from './meterCommissioning';
import {
  bumpTreeRevision,
  replaceBoardMetersFromLegacy,
} from './installationV2';

/**
 * Completes the immutable form and projects its operational meter in one
 * store mutation. Any thrown validation error leaves the caller's transaction
 * free to roll back the whole change.
 */
export function completeFormSubmissionInStore(
  store: AppDataStore,
  formId: string,
  timestamp: string,
  createMeterId: () => string,
): FormSubmission {
  const index = store.formSubmissions.findIndex((form) => form.id === formId);
  if (index < 0) throw new Error('Form submission not found');
  const current = { ...store.formSubmissions[index] };
  if (current.status === 'Completed') {
    throw new Error('Completed forms are immutable. Create an amendment instead.');
  }
  const installation = store.installations.find(
    (item) => item.id === current.installation_id,
  );
  if (!installation) throw new Error('Installation not found');
  if (installation.status === 'Completed') {
    throw new Error('Reopen this completed installation before completing a form.');
  }
  const errors = validateForm(current);
  if (errors.length) throw new Error(errors.join('\n'));

  // Form relationships are optional capture context. Keep valid local links,
  // and drop stale links instead of making them mandatory completion fields.
  const scopedBoards = store.electricalAssets.filter((item) => item.audit_id === current.installation_id);
  if (current.zone_id && !store.zones.some((item) => item.id === current.zone_id && item.audit_id === current.installation_id)) current.zone_id = undefined;
  if (current.board_id && !scopedBoards.some((item) => item.id === current.board_id)) current.board_id = undefined;
  if (current.site_asset_id && !store.siteAssets.some((item) => item.id === current.site_asset_id && item.audit_id === current.installation_id)) current.site_asset_id = undefined;
  if (current.meter_id) {
    const device = store.meterDevices.find((item) => item.id === current.meter_id && item.installationId === current.installation_id);
    const legacyBoard = scopedBoards.find((item) => item.meters.some((meter) => meter.id === current.meter_id));
    const installedOnBoardId = device?.installedOnBoardId ?? legacyBoard?.id;
    if (!installedOnBoardId || (current.board_id && installedOnBoardId !== current.board_id)) current.meter_id = undefined;
  }

  let boardId = current.board_id;
  let meterId = current.meter_id;
  let answers = current.answers;
  const supportedWwDevice = current.form_type !== 'ww-installation'
    || ['A3RM', 'A6M'].includes(String(answers['device.type'] ?? ''));
  if (boardId && supportedWwDevice && ['ww-installation', 'a3rm-installation', 'a6m-installation'].includes(current.form_type)) {
    const board = store.electricalAssets.find(
      (item) => item.id === boardId && item.audit_id === current.installation_id,
    );
    if (!board) throw new Error('The selected switchboard is no longer available.');
    meterId ??= createMeterId();
    answers = answersWithCanonicalBoardContext(answers, board);
    const zone = store.zones.find((item) => item.id === board.zone_id);
    const labelPrefix = deviceLabelPrefix(
      installation.site_name,
      zone?.zone_name ?? '',
    );
    const meter = meterFromInstallationForm(
      { ...current, answers },
      board,
      meterId,
      labelPrefix,
    );
    const meters = board.meters.some((item) => item.id === meterId)
      ? board.meters.map((item) => item.id === meterId ? meter : item)
      : [...board.meters, meter];
    replaceBoardMetersFromLegacy(store, board, meters);
    board.updated_at = timestamp;
  } else if (
    current.form_type === 'comms-fault' &&
    current.answers['works.replace_device'] === 'yes' && boardId && meterId
  ) {
    const board = store.electricalAssets.find(
      (item) => item.id === boardId && item.audit_id === current.installation_id,
    );
    const existing = board?.meters.find((item) => item.id === meterId);
    if (!board || !existing) throw new Error('The linked meter is no longer available.');
    const zone = store.zones.find((item) => item.id === board.zone_id);
    const replacement = meterAfterCommsReplacement(
      existing,
      current.answers,
      deviceLabelPrefix(installation.site_name, zone?.zone_name ?? ''),
    );
    replaceBoardMetersFromLegacy(
      store,
      board,
      board.meters.map((item) => item.id === meterId ? replacement : item),
    );
    board.updated_at = timestamp;
  }

  const completed: FormSubmission = {
    ...current,
    board_id: boardId,
    meter_id: meterId,
    answers: supportedFormAnswers(current.form_type, answers, current.schema_version),
    status: 'Completed',
    completed_at: timestamp,
    updated_at: timestamp,
  };
  store.formSubmissions[index] = completed;
  bumpTreeRevision(store, completed.installation_id);
  return completed;
}
