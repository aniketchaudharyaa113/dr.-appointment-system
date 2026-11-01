export interface ParsedSlot {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number; // 0=Sunday, matches JS Date.getDay() / Postgres day_of_week convention
  hhmmss: string; // "09:00:00" - directly comparable against availability.start_time/end_time
}

// Accepts "YYYY-MM-DDTHH:MM[:SS]" or "YYYY-MM-DD HH:MM[:SS]" (Postgres's own
// text output uses a space instead of "T"), and reads the digits literally -
// no Date object is constructed from the full string, so no timezone
// interpretation can sneak in.
const SLOT_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

export function parseSlot(raw: string): ParsedSlot | null {
  const match = SLOT_REGEX.exec(raw);
  if (!match) return null;

  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);

  // Date.UTC here is purely a calendar calculator (what weekday is this date?),
  // never used to represent a real moment in time - so no timezone conversion
  // is actually happening, despite the "UTC" in the API name.
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const hhmmss = `${h}:${mi}:00`;

  return { year, month, day, hour, minute, dayOfWeek, hhmmss };
}

// A sortable "YYYY-MM-DDTHH:MM" key for comparing two wall-clock moments -
// safe because the shape is fixed-width and zero-padded throughout.
export function slotKey(p: ParsedSlot): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// "Now", expressed in the clinic's timezone (Asia/Kolkata) and in the exact
// same shape as parseSlot() - so it can be compared directly with slotKey(),
// without ever converting either side through UTC. Using Intl here (rather
// than relying on the server process's own default timezone) means this is
// correct no matter what machine or container this code runs on.
export function nowInClinicTimezone(): ParsedSlot {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const asString = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  return parseSlot(asString)!;
}
