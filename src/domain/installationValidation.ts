import type { Installation } from '../types';
import { normalizedSiteCode, isValidInstallationSiteCode } from './installationSiteCode';

export interface InstallationFieldError {
  field: 'client_name' | 'site_name' | 'site_code' | 'site_address' | 'inspector_name' | 'audit_date' | 'job_end_date' | 'job_end_time' | 'timezone';
  message: string;
}

type InstallationIdentity = Pick<
  Installation,
  'client_name' | 'site_name' | 'site_code' | 'site_address' | 'inspector_name' | 'audit_date' | 'job_end_date' | 'job_end_time' | 'timezone'
>;

/** Match portal defaults without changing an unchanged historical site code. */
export function installationIdentityForWrite<T extends InstallationIdentity>(
  values: T,
  initial?: Partial<Installation>,
  today = new Date().toISOString().slice(0, 10),
): T {
  const siteName = values.site_name.trim() || 'Untitled installation';
  const preserveCode = typeof initial?.site_code === 'string'
    && Boolean(initial.site_code.trim())
    && values.site_code === initial.site_code;
  return {
    ...values,
    client_name: values.client_name.trim(),
    site_name: siteName,
    site_address: values.site_address.trim(),
    inspector_name: values.inspector_name.trim(),
    audit_date: values.audit_date.trim() || today,
    ...(Object.prototype.hasOwnProperty.call(values, 'job_end_date')
      ? { job_end_date: values.job_end_date?.trim() || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(values, 'job_end_time')
      ? { job_end_time: values.job_end_time?.trim() || null }
      : {}),
    timezone: values.timezone?.trim() || 'Australia/Sydney',
    site_code: preserveCode
      ? initial.site_code
      : values.site_code?.trim().toUpperCase() || normalizedSiteCode(siteName),
  };
}

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
  initial?: Partial<Installation>,
): InstallationFieldError[] {
  const errors: InstallationFieldError[] = [];
  if (installation.audit_date?.trim() && !validCalendarDate(installation.audit_date.trim())) {
    errors.push({ field: 'audit_date', message: 'Audit date must be a real date in YYYY-MM-DD format.' });
  }
  if (installation.job_end_date?.trim() && !validCalendarDate(installation.job_end_date.trim())) {
    errors.push({ field: 'job_end_date', message: 'Job end date must be a real date in YYYY-MM-DD format.' });
  } else if (
    installation.job_end_date?.trim()
    && installation.audit_date?.trim()
    && installation.job_end_date.trim() < installation.audit_date.trim()
  ) {
    errors.push({ field: 'job_end_date', message: 'Job end date cannot be before the scheduled date.' });
  }
  if (
    installation.job_end_time?.trim()
    && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(installation.job_end_time.trim())
  ) {
    errors.push({ field: 'job_end_time', message: 'Job end time must use 24-hour HH:mm format.' });
  }
  if (
    installation.site_code?.trim()
    && installation.site_code !== initial?.site_code
    && !isValidInstallationSiteCode(installation.site_code.trim())
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
