jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import { fetchAllInBatches, fetchAllRows, ID_BATCH, PAGE_SIZE } from '../fetchAll';
import { truncatedTable } from '../truncationGuard';

// Supabase silently returns at most 1000 rows per request (it once hid
// flowchart links). These tests keep that from coming back.

// A fake query: `total` rows, served a page at a time like PostgREST would.
const fakeTable = (total: number, calls: [number, number][] = []) => () => ({
  range: (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, total - 1, from + PAGE_SIZE - 1);
    const data = from >= total ? [] : Array.from({ length: end - from + 1 }, (_, i) => from + i);
    return Promise.resolve({ data, error: null });
  },
});

describe('fetchAllRows / fetchAllInBatches', () => {
  it('returns every row past 1000, page by page', async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllRows(fakeTable(2345, calls));
    expect(rows).toHaveLength(2345);
    expect(new Set(rows).size).toBe(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops after one request when there are fewer than 1000 rows', async () => {
    const calls: [number, number][] = [];
    expect(await fetchAllRows(fakeTable(12, calls))).toHaveLength(12);
    expect(calls).toHaveLength(1);
  });

  it('exactly 1000 rows: asks once more and gets an empty page', async () => {
    expect(await fetchAllRows(fakeTable(1000))).toHaveLength(1000);
  });

  it('throws instead of returning partial data on an error', async () => {
    await expect(fetchAllRows(() => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }))).rejects.toThrow('boom');
  });

  it('splits long id lists into short batches', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `id-${i}`);
    const seen: number[] = [];
    const rows = await fetchAllInBatches(ids, (batch) => {
      seen.push(batch.length);
      return { range: () => Promise.resolve({ data: batch, error: null }) };
    });
    expect(seen).toEqual([ID_BATCH, ID_BATCH, 400 - 2 * ID_BATCH]);
    expect(rows).toEqual(ids);
  });
});

describe('truncation check (lib/truncationGuard.ts)', () => {
  const url = 'https://x.supabase.co/rest/v1/task_dependencies?select=id';
  it('flags an un-paged read that came back full', () => {
    expect(truncatedTable(url, 'GET', '0-999/*')).toBe('task_dependencies');
  });
  it('ignores short reads, paged reads and writes', () => {
    expect(truncatedTable(url, 'GET', '0-41/*')).toBeNull();
    expect(truncatedTable(`${url}&offset=0&limit=1000`, 'GET', '0-999/*')).toBeNull();
    expect(truncatedTable(url, 'POST', '0-999/*')).toBeNull();
    expect(truncatedTable('https://x.supabase.co/auth/v1/user', 'GET', '0-999/*')).toBeNull();
  });
});

// ─── Source scan ──────────────────────────────────────────────────────────
// Every Supabase read in the app must either filter/limit the rows, be paged
// with fetchAllRows/fetchAllInBatches, or read one of these small lookup
// tables (a handful of rows that can't approach 1000).
const SMALL_LOOKUP_TABLES = new Set([
  'projects',
  'task_types',
  'flowchart_templates',
  'dependency_template_items',
  'app_flow_features',
]);
const FILTER = /\.(eq|neq|in|or|match|filter|gte|gt|lte|lt|is|like|ilike|contains|limit|range|single|maybeSingle|not|textSearch)\(/;
// Node's file tools, typed locally (the app's tsconfig has no Node types).
declare const __dirname: string;
const { readdirSync, readFileSync, statSync } = jest.requireActual('fs') as {
  readdirSync(dir: string): string[];
  readFileSync(file: string, enc: 'utf8'): string;
  statSync(p: string): { isDirectory(): boolean };
};
const { join, relative } = jest.requireActual('path') as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};
const ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

// The whole chained statement starting at `.from(` (up to its `;`/`,` at depth 0).
function statementAt(src: string, start: number): string {
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth < 0) return src.slice(start, k);
    else if ((c === ';' || c === ',') && depth === 0) return src.slice(start, k);
  }
  return src.slice(start);
}

describe('no read can silently lose rows past 1000', () => {
  it('every unfiltered read is paged or reads a small lookup table', () => {
    const offenders: string[] = [];
    for (const file of ['app', 'components', 'lib'].flatMap((d) => sourceFiles(join(ROOT, d)))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\.from\('([a-z_]+)'\)/g)) {
        const stmt = statementAt(src, m.index!);
        if (!/\.select\(/.test(stmt) || /\.(insert|update|delete|upsert)\(/.test(stmt)) continue;
        if (FILTER.test(stmt) || SMALL_LOOKUP_TABLES.has(m[1])) continue;
        // Built inside a fetchAllRows / fetchAllInBatches call (or a makeQuery handed to one).
        const around = src.slice(Math.max(0, m.index! - 600), m.index! + 900);
        if (/fetchAll(Rows|InBatches)\b/.test(around)) continue;
        offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index!).split('\n').length} reads '${m[1]}' with no filter and no paging`);
      }
    }
    // Fix: wrap the query in fetchAllRows(() => …) from lib/fetchAll.ts, or
    // filter it. Only add a table to SMALL_LOOKUP_TABLES if it truly stays tiny.
    expect(offenders).toEqual([]);
  });
});
