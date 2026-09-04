/**
 * All date derivation for the invitation.
 *
 * Every displayed date, the weekday, the calendar grid, the countdown
 * target and the .ics file are computed from `wedding.date.iso`.
 * Nothing is hardcoded anywhere else.
 */

/** @param {string} iso */
export function parseWeddingDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`wedding.date.iso is not a valid date: ${iso}`);
  }
  return date;
}

/** Secure-context-safe UID (crypto.randomUUID needs HTTPS/localhost). */
export function icsUid() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return `fallback-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/**
 * The wedding's own calendar fields, read in the wedding's timezone
 * rather than the visitor's, so a guest in another timezone still
 * sees the correct day.
 *
 * @param {Date} date
 * @param {string} iso  used to recover the authored UTC offset
 */
export function weddingParts(date, iso) {
  const offsetMatch = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  let offsetMinutes = -date.getTimezoneOffset();
  if (offsetMatch) {
    const sign = offsetMatch[1] === "-" ? -1 : 1;
    offsetMinutes = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
  }
  // Shift into the wedding's local wall-clock, then read UTC fields.
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(), // 0-indexed
    day: local.getUTCDate(),
    weekday: local.getUTCDay(), // 0 = Sunday
    hours: local.getUTCHours(),
    minutes: local.getUTCMinutes(),
  };
}

const WEEKDAY_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/** e.g. "2027年10月9日 星期六" — weekday derived, never hardcoded. */
export function formatChineseDate(parts) {
  return `${parts.year}年${parts.month + 1}月${parts.day}日 ${WEEKDAY_ZH[parts.weekday]}`;
}

/** e.g. "2027.10.09" for the Latin cover line. */
export function formatDottedDate(parts) {
  const mm = String(parts.month + 1).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}.${mm}.${dd}`;
}

/**
 * Month grid for the calendar, Monday-first (as the reference is).
 * Returns leading blanks followed by day numbers.
 */
export function monthGrid(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0=Sun
  const lead = (firstWeekday + 6) % 7; // convert to Monday-first
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    lead,
    days: Array.from({ length: dayCount }, (_, i) => i + 1),
  };
}

/** Split a whole-second remainder into d/h/m/s, clamped at zero. */
export function breakdown(msRemaining) {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Build an .ics calendar file as a blob URL. */
export function buildIcsUrl({ date, durationHours, summary, description, location }) {
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(date.getTime() + durationHours * 3_600_000);
  const escape = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//wedding-invite//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsUid()}@wedding-invite`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(date)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(summary)}`,
    `DESCRIPTION:${escape(description)}`,
    location ? `LOCATION:${escape(location)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  return URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
}
