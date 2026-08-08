const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Accepts "YYYY-MM-DD HH:MM:SS" (Postgres's raw text format) or
// "YYYY-MM-DDTHH:MM:SS" (what the booking form sends) and reads the digits
// directly - never constructs a Date object, so no timezone conversion can
// happen. This mirrors utils/datetime.ts on the backend deliberately.
const SLOT_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

function parse(raw) {
  const match = SLOT_REGEX.exec(raw || "");
  if (!match) return null;
  return {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
}

// Turns a raw slot_time string into the same "YYYY-MM-DDTHH:MM:SS" key shape
// used by the booking form, so Set-based taken-slot comparisons line up.
export function slotToKey(raw) {
  const p = parse(raw);
  if (!p) return raw;
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

// Human-readable display, e.g. "Sun, Aug 2, 2026, 9:00 AM" - built manually
// from the raw digits, deliberately never through Date/toLocaleString(),
// which would reinterpret the naive value through the browser's timezone.
export function formatSlot(raw) {
  const p = parse(raw);
  if (!p) return raw || "—";

  // Only used to compute the weekday name via calendar math - not a real
  // timestamp, so no timezone conversion is involved.
  const weekday = DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  const minute = String(p.minute).padStart(2, "0");

  return `${weekday}, ${MONTHS[p.month - 1]} ${p.day}, ${p.year}, ${hour12}:${minute} ${ampm}`;
}
