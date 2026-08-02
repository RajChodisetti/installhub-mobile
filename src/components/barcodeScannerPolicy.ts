export interface ScannerPermissionDecision {
  openScanner: boolean;
  manualEntryEnabled: true;
  fallbackMessage?: string;
}

/** Camera denial can never disable or clear the adjacent manual text field. */
export function scannerPermissionDecision(granted: boolean): ScannerPermissionDecision {
  return granted
    ? { openScanner: true, manualEntryEnabled: true }
    : {
        openScanner: false,
        manualEntryEnabled: true,
        fallbackMessage: 'Camera permission needed to scan. You can still type the code.',
      };
}
