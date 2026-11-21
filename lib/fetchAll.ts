// Reads that must never silently lose rows (2026-11-20).
//
// Supabase (PostgREST) returns AT MOST 1000 rows per request, with no error
// and no warning — anything past row 1000 simply isn't there. That once hid
// flowchart links once the project passed 1000 of them. Every read of a table
// that can grow (tasks, links, logs …) goes through one of these helpers:
//
//   fetchAllRows(() => supabase.from('x').select('…').eq(…).order('id'))
//       — pages 1000 at a time until the last, short page.
//   fetchAllInBatches(ids, (batch) => supabase.from('x').select('…').in('task_id', batch))
//       — also splits a long id list, so the request URL stays short.
//
// lib/__tests__/unboundedReads.test.ts fails the build if a new unbounded
// read of a growing table is added without one of these.

export const PAGE_SIZE = 1000; // Supabase's default "Max rows" per request
export const ID_BATCH = 150; // ids per request — keeps the URL well under the size limit

type Result<T> = { data: T[] | null; error: { message: string } | null };
// Any Supabase select builder: `.range()` gives back the same awaitable builder.
interface Pageable<T> {
  range(from: number, to: number): PromiseLike<Result<T>>;
}

/** Every row the query matches. Give the query an `.order(…)` so pages don't shift. */
export async function fetchAllRows<T>(makeQuery: () => Pageable<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Splits `ids` into batches; every row for every batch (each batch also paged). */
export async function fetchAllInBatches<T>(ids: string[], makeQuery: (batch: string[]) => Pageable<T>): Promise<T[]> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) batches.push(ids.slice(i, i + ID_BATCH));
  const parts = await Promise.all(batches.map((batch) => fetchAllRows(() => makeQuery(batch))));
  return parts.flat();
}
