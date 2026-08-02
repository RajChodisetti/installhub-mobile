/** Validates the exact CAS revision retained with a confirmed evidence row. */
export function confirmedUploadTreeRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('Confirmed evidence is missing its authoritative tree revision.');
  }
  return Number(value);
}
