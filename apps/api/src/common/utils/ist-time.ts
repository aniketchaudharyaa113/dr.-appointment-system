import { CLINIC_TIMEZONE as SHARED_CLINIC_TIMEZONE } from '@medibook/shared';

export const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || SHARED_CLINIC_TIMEZONE;

const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const istTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Returns the YYYY-MM-DD wall-clock calendar date in Asia/Kolkata for a UTC instant.
 */
export function getIstDateString(date: Date = new Date()): string {
  return istDateFormatter.format(date);
}

/**
 * Returns YYYYMMDD in Asia/Kolkata for daily booking references (MB-YYYYMMDD-NNN).
 */
export function getIstDateCompact(date: Date = new Date()): string {
  return getIstDateString(date).replace(/-/g, '');
}

/**
 * Returns day of week (0 = Sunday .. 6 = Saturday) for an IST YYYY-MM-DD date string.
 */
export function getIstDayOfWeek(dateStr: string): number {
  const istNoon = new Date(`${dateStr}T12:00:00.000+05:30`);
  if (isNaN(istNoon.getTime())) {
    throw new Error(`Invalid IST date string: ${dateStr}`);
  }
  return istNoon.getUTCDay();
}

/**
 * Converts an IST wall-clock date (YYYY-MM-DD) and time (HH:mm or HH:mm:ss) into a UTC Date.
 */
export function istWallClockToUtcDate(dateStr: string, timeStr: string): Date {
  const normalizedTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const dt = new Date(`${dateStr}T${normalizedTime}.000+05:30`);
  if (isNaN(dt.getTime())) {
    throw new Error(`Invalid IST date/time: ${dateStr} ${timeStr}`);
  }
  return dt;
}

/**
 * Returns UTC [start, end] bounds covering the full Asia/Kolkata calendar day.
 */
export function getIstDayBoundsUtc(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00.000+05:30`);
  const end = new Date(`${dateStr}T23:59:59.999+05:30`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid IST date string: ${dateStr}`);
  }
  return { start, end };
}

/**
 * Formats an instant as HH:mm in Asia/Kolkata.
 */
export function formatIstDisplayTime(date: Date): string {
  return istTimeFormatter.format(date);
}
