import type { PhotoMetadataMap } from '../types';

export function photoIsLargeInPdf(
  metadata: PhotoMetadataMap | undefined,
  fieldName: string,
): boolean {
  return metadata?.[fieldName]?.largeInPdf === true;
}

export function setPhotoLargeInPdf(
  metadata: PhotoMetadataMap | undefined,
  fieldName: string,
  largeInPdf: boolean,
): PhotoMetadataMap {
  const next = { ...(metadata ?? {}) };
  next[fieldName] = { largeInPdf };
  return next;
}

export function removePhotoMetadata(
  metadata: PhotoMetadataMap | undefined,
  fieldName: string,
): PhotoMetadataMap {
  const next = { ...(metadata ?? {}) };
  delete next[fieldName];
  return next;
}

export function removeIndexedPhotoMetadata(
  metadata: PhotoMetadataMap | undefined,
  fieldPrefix: string,
  removedIndex: number,
): PhotoMetadataMap {
  const next: PhotoMetadataMap = {};
  const escapedPrefix = fieldPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedPrefix}\\[(\\d+)\\]$`);
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const match = key.match(pattern);
    if (!match) {
      next[key] = { ...value };
      continue;
    }
    const index = Number(match[1]);
    if (index < removedIndex) next[key] = { ...value };
    else if (index > removedIndex) next[`${fieldPrefix}[${index - 1}]`] = { ...value };
  }
  return next;
}

export function normalizePhotoMetadataMap(value: unknown): PhotoMetadataMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: PhotoMetadataMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if (typeof (raw as Record<string, unknown>).largeInPdf === 'boolean') {
      output[key] = { largeInPdf: (raw as Record<string, unknown>).largeInPdf as boolean };
    }
  }
  return output;
}

export function optionalPhotoMetadataMap(value: unknown): PhotoMetadataMap | undefined {
  return value === undefined || value === null
    ? undefined
    : normalizePhotoMetadataMap(value);
}
