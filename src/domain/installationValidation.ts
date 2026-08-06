import type { Installation } from '../types';

const SITE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function validInstallationSiteCode(value: string): boolean {
  return value.length >= 1 && value.length <= 16 && SITE_CODE_PATTERN.test(value);
}

export interface InstallationFieldError {
  field: 'client_name' | 'site_name' | 'site_code' | 'site_address' | 'inspector_name' | 'audit_date' | 'timezone';
  message: string;
}

type InstallationIdentity = Pick<
  Installation,
  'client_name' | 'site_name' | 'site_code' | 'site_address' | 'inspector_name' | 'audit_date' | 'timezone'
>;

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validIanaTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value.trim() }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function validateInstallationIdentity(
  installation: InstallationIdentity,
): InstallationFieldError[] {
  const errors: InstallationFieldError[] = [];
  const required: Array<{
    field: InstallationFieldError['field'];
    label: string;
    value: string | undefined;
  }> = [
    { field: 'client_name', label: 'Client name', value: installation.client_name },
    { field: 'site_name', label: 'Site name', value: installation.site_name },
    { field: 'site_code', label: 'Installation short code', value: installation.site_code },
    { field: 'site_address', label: 'Site address', value: installation.site_address },
    { field: 'inspector_name', label: 'Inspector', value: installation.inspector_name },
    { field: 'audit_date', label: 'Audit date', value: installation.audit_date },
    { field: 'timezone', label: 'Installation timezone', value: installation.timezone },
  ];
  for (const item of required) {
    if (!item.value?.trim()) errors.push({ field: item.field, message: `${item.label} is required.` });
  }
  if (installation.audit_date?.trim() && !validCalendarDate(installation.audit_date.trim())) {
    errors.push({ field: 'audit_date', message: 'Audit date must be a real date in YYYY-MM-DD format.' });
  }
  if (
    installation.site_code?.trim()
    && !validInstallationSiteCode(installation.site_code.trim())
  ) {
    errors.push({
      field: 'site_code',
      message: 'Use 1-16 uppercase letters/digits, with single hyphens only between groups.',
    });
  }
  if (installation.timezone?.trim() && !validIanaTimezone(installation.timezone)) {
    errors.push({ field: 'timezone', message: 'Installation timezone must be a valid IANA timezone such as Australia/Sydney.' });
  }
  return errors;
}
