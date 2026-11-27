import { CLINIC_TIMEZONE as DEFAULT_CLINIC_TIMEZONE } from '../constants';

export function getClinicTimezone(override?: string): string {
  const envTz = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.CLINIC_TIMEZONE;
  return override || envTz || DEFAULT_CLINIC_TIMEZONE;
}

export function buildSlotHoldKey(doctorId: string, slotTimeIso: string): string {
  return `hold:${doctorId}:${slotTimeIso}`;
}

export function buildNextSlotCacheKey(doctorId: string): string {
  return `cache:next_slot:${doctorId}`;
}

/**
 * Returns the YYYY-MM-DD wall-clock calendar date in the clinic timezone (default Asia/Kolkata).
 */
export function getIstDateString(
  date: Date = new Date(),
  timeZone: string = getClinicTimezone(),
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Returns YYYYMMDD in clinic timezone for daily booking references (MB-YYYYMMDD-NNN).
 */
export function getIstDateCompact(
  date: Date = new Date(),
  timeZone: string = getClinicTimezone(),
): string {
  return getIstDateString(date, timeZone).replace(/-/g, '');
}

/**
 * Returns day of week (0 = Sunday .. 6 = Saturday) for a YYYY-MM-DD calendar date.
 */
export function getIstDayOfWeek(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) {
    throw new Error(`Invalid clinic date string: ${dateStr}`);
  }
  const [y, m, d] = parts;
  const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (
    Number.isNaN(utcDate.getTime()) ||
    utcDate.getUTCFullYear() !== y ||
    utcDate.getUTCMonth() !== m - 1 ||
    utcDate.getUTCDate() !== d
  ) {
    throw new Error(`Invalid clinic date string: ${dateStr}`);
  }
  return utcDate.getUTCDay();
}

/**
 * Computes the UTC offset in milliseconds at a given UTC instant for any IANA timezone.
 */
function getTimeZoneOffsetMs(utcInstant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const partMap: Record<string, string> = {};
  for (const part of formatter.formatToParts(utcInstant)) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }
  const asUtcMs = Date.UTC(
    Number(partMap.year),
    Number(partMap.month) - 1,
    Number(partMap.day),
    Number(partMap.hour),
    Number(partMap.minute),
    Number(partMap.second),
  );
  return asUtcMs - Math.floor(utcInstant.getTime() / 1000) * 1000;
}

/**
 * Converts a clinic-timezone wall-clock date (YYYY-MM-DD) and time (HH:mm or HH:mm:ss) into a UTC Date.
 */
export function istWallClockToUtcDate(
  dateStr: string,
  timeStr: string,
  timeZone: string = getClinicTimezone(),
  millis = 0,
): Date {
  const dateParts = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':').map(Number);
  if (
    dateParts.length !== 3 ||
    dateParts.some(Number.isNaN) ||
    timeParts.length < 2 ||
    timeParts.some(Number.isNaN)
  ) {
    throw new Error(`Invalid clinic date/time: ${dateStr} ${timeStr}`);
  }
  const [y, m, d] = dateParts;
  const [hh, mm, ss = 0] = timeParts;
  const targetWallUtcMs = Date.UTC(y, m - 1, d, hh, mm, ss, 0);

  // Two-pass fixed-point solve handles DST transitions accurately for any IANA timezone
  const guess1 = new Date(targetWallUtcMs - getTimeZoneOffsetMs(new Date(targetWallUtcMs), timeZone));
  const finalMs = targetWallUtcMs - getTimeZoneOffsetMs(guess1, timeZone) + millis;
  const dt = new Date(finalMs);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid clinic date/time: ${dateStr} ${timeStr}`);
  }
  return dt;
}

/**
 * Returns UTC [start, end] bounds covering the full clinic calendar day.
 */
export function getIstDayBoundsUtc(
  dateStr: string,
  timeZone: string = getClinicTimezone(),
): { start: Date; end: Date } {
  const start = istWallClockToUtcDate(dateStr, '00:00:00', timeZone, 0);
  const end = istWallClockToUtcDate(dateStr, '23:59:59', timeZone, 999);
  return { start, end };
}

/**
 * Formats an instant as HH:mm in clinic timezone.
 */
export function formatIstDisplayTime(
  date: Date,
  timeZone: string = getClinicTimezone(),
): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
