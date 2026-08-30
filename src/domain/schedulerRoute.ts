import type {
  SchedulerRouteCurrentLocation,
  SchedulerRouteJob,
  SchedulerRouteSourceApp,
} from '../api/apiClient';

export const SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH = 3;
export const SCHEDULER_ROUTE_STARTING_ADDRESS_MAX_LENGTH = 300;

function calendarDateParts(value: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function padCalendarPart(value: number): string {
  return String(value).padStart(2, '0');
}

export function schedulerRouteCalendarDateIsValid(value: string): boolean {
  return calendarDateParts(value) !== null;
}

/** Calendar date in the device timezone; unlike ISO slicing it cannot roll to UTC tomorrow. */
export function schedulerRouteLocalCalendarDate(now = new Date()): string {
  return [
    now.getFullYear(),
    padCalendarPart(now.getMonth() + 1),
    padCalendarPart(now.getDate()),
  ].join('-');
}

export function schedulerRouteAddCalendarDays(value: string, days: number): string {
  const parts = calendarDateParts(value);
  if (!parts || !Number.isInteger(days)) return value;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return [
    date.getUTCFullYear(),
    padCalendarPart(date.getUTCMonth() + 1),
    padCalendarPart(date.getUTCDate()),
  ].join('-');
}

export function schedulerRouteLocationIsAustralian(
  location: Pick<SchedulerRouteCurrentLocation, 'latitude' | 'longitude'>,
): boolean {
  return Number.isFinite(location.latitude)
    && Number.isFinite(location.longitude)
    && location.latitude >= -44
    && location.latitude <= -9
    && location.longitude >= 112
    && location.longitude <= 154;
}

export function schedulerRouteCoordinatesFromAddress(
  address: { latitude: number | null; longitude: number | null },
): Pick<SchedulerRouteCurrentLocation, 'latitude' | 'longitude'> | null {
  if (typeof address.latitude !== 'number' || typeof address.longitude !== 'number') {
    return null;
  }
  const coordinates = {
    latitude: address.latitude,
    longitude: address.longitude,
  };
  return schedulerRouteLocationIsAustralian(coordinates) ? coordinates : null;
}

export function schedulerRouteStartingAddress(value: string): string | null {
  const trimmed = value.trim();
  return trimmed
    && trimmed.length >= SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH
    && trimmed.length <= SCHEDULER_ROUTE_STARTING_ADDRESS_MAX_LENGTH
    ? trimmed
    : null;
}

export function schedulerRouteDistance(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 km';
  if (value < 1_000) return `${Math.round(value)} m`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} km`;
}

export function schedulerRouteDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 min';
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function schedulerRouteJobTypeLabel(sourceApp: SchedulerRouteSourceApp): string {
  if (sourceApp === 'ecoaudit') return 'EcoAudit';
  if (sourceApp === 'solarsense') return 'SolarSense';
  if (sourceApp === 'installhub') return 'Field App';
  return 'Custom';
}

export function schedulerRouteJobCanOpenInFieldApp(
  job: Pick<SchedulerRouteJob, 'sourceApp' | 'sourceType' | 'sourceId'>,
): boolean {
  return job.sourceApp === 'installhub'
    && job.sourceType === 'installation'
    && Boolean(job.sourceId.trim());
}

export function schedulerRouteScheduledTimeLabel(
  job: Pick<SchedulerRouteJob, 'scheduledStartAt' | 'scheduledEndAt'>,
  timezone: string,
): string {
  const startDate = new Date(job.scheduledStartAt);
  const endDate = job.scheduledEndAt ? new Date(job.scheduledEndAt) : null;
  if (Number.isNaN(startDate.getTime())) return job.scheduledStartAt;
  try {
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    });
    const start = formatter.format(startDate);
    const end = endDate && !Number.isNaN(endDate.getTime())
      ? formatter.format(endDate)
      : null;
    return end ? `${start}–${end}` : start;
  } catch {
    return job.scheduledStartAt;
  }
}
