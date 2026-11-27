import {
  CLINIC_TIMEZONE as DEFAULT_CLINIC_TIMEZONE,
  formatIstDisplayTime,
  getClinicTimezone,
  getIstDateCompact,
  getIstDateString,
  getIstDayBoundsUtc,
  getIstDayOfWeek,
  istWallClockToUtcDate,
} from '@medibook/shared';

export const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || DEFAULT_CLINIC_TIMEZONE;

export {
  getClinicTimezone,
  getIstDateString,
  getIstDateCompact,
  getIstDayOfWeek,
  istWallClockToUtcDate,
  getIstDayBoundsUtc,
  formatIstDisplayTime,
};
