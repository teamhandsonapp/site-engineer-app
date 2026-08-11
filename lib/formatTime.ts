// Shared local-time formatting for the Attendance screens (mobile's own
// check-in/out screen, admin's team list, admin's per-engineer detail).
//
// Computed by hand with plain arithmetic (+5:30 on the real UTC instant,
// read back with getUTC*()) — NOT toLocaleTimeString/Intl with a timeZone
// option (Hermes can ship without full ICU tzdata, so Intl.DateTimeFormat
// silently falls back to UTC instead of throwing — confirmed live once:
// "3:42 PM IST rendered as 10:12 am"), and NOT plain getHours()/getMinutes()
// either (those read the DEVICE'S OWN configured local timezone, not IST
// specifically — confirmed live: a raw 15:20 UTC value rendered as "3:20 PM"
// with zero conversion applied, when the real IST time was 8:50 PM).
//
// A THIRD failure mode was found and fixed here too: every source column
// this formats (attendance_records.client_captured_at, geofence_alerts'
// timestamps, etc.) used to be a plain `timestamp without time zone`
// column, so PostgREST returned a naive string with no 'Z'/offset —
// forcing this file to reconstruct the true UTC reading by hand via a
// local-parse-then-local-read round trip. That trick correctly recovered
// the right DISPLAY value regardless of device timezone, but it was a
// trap for any OTHER code doing `.getTime()` arithmetic on the same Date
// object (duration/elapsed-time math, absolute-instant comparisons) — on
// any device not itself configured for UTC, `new Date(naiveString).getTime()`
// silently returns an instant that's wrong by exactly the device's own UTC
// offset. Confirmed live: an engineer's ~13-minute-old check-in showed
// "5h 34m" elapsed on an IST-configured device. Fixed at the source
// instead (see fix-naive-timestamp-columns.sql — these columns are now
// timestamptz, so PostgREST returns a proper offset-suffixed string and
// `d.getTime()` is correct everywhere, automatically) — which is what lets
// this function go back to the simple, direct form below.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIST(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}

export function formatTime12h(d: Date | null): string {
  if (!d) return '—';
  const ist = toIST(d);
  let hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${period}`;
}

// For a scheduled shift window ("9:00 AM – 6:00 PM") — same formatter,
// applied to both ends of the range.
export function formatTimeRange12h(start: Date | null, end: Date | null): string {
  if (!start || !end) return '—';
  return `${formatTime12h(start)} – ${formatTime12h(end)}`;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Same reasoning as formatTime12h above — a date label ("Sun 9 Aug") is
// less obviously wrong than a time when shifted by a UTC offset, but a
// late-night/early-morning session right around midnight IST can genuinely
// land on the wrong calendar day if this isn't converted the same way.
export function formatDateLabel(d: Date): string {
  const ist = toIST(d);
  return `${WEEKDAY_NAMES[ist.getUTCDay()]} ${ist.getUTCDate()} ${MONTH_NAMES[ist.getUTCMonth()]}`;
}
