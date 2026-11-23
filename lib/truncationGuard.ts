import * as Sentry from '@sentry/react-native';

// Safety net for Supabase's silent 1000-row cut-off (2026-11-20).
//
// A read that doesn't page (lib/fetchAll.ts) and matches more than 1000 rows
// comes back with exactly 1000 and no error — data just goes missing (this
// hid flowchart links once). Every REST read passes through here: if one
// that did NOT ask for a page comes back full, it is reported (dev console +
// Sentry, table name only — no row data or filter values) so it gets fixed
// instead of quietly showing an incomplete screen.

export const SUPABASE_MAX_ROWS = 1000;

const reported = new Set<string>();

/** Table name when this GET came back as a full, un-paged response; else null. */
export function truncatedTable(url: string, method: string, contentRange: string | null): string | null {
  if (method.toUpperCase() !== 'GET' || !contentRange) return null;
  const path = /\/rest\/v1\/([^?/]+)/.exec(url);
  if (!path) return null;
  // Paged on purpose (fetchAllRows / .range() / .limit()): not a cut-off.
  if (/[?&](limit|offset)=/.test(url)) return null;
  const m = /^(\d+)-(\d+)\//.exec(contentRange);
  if (!m) return null;
  return Number(m[2]) - Number(m[1]) + 1 >= SUPABASE_MAX_ROWS ? decodeURIComponent(path[1]) : null;
}

export function guardedFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await baseFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');
      const table = truncatedTable(url, method, res.headers.get('content-range'));
      if (table && !reported.has(table)) {
        reported.add(table);
        const msg = `[supabase] "${table}" read returned ${SUPABASE_MAX_ROWS} rows without paging — rows past that were cut off. Use fetchAllRows / fetchAllInBatches (lib/fetchAll.ts).`;
        if (__DEV__) console.warn(msg);
        Sentry.captureMessage(msg, 'warning');
      }
    } catch {
      // Never let the check itself break a request.
    }
    return res;
  };
}
