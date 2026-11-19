/** Walk authorized rows by their immutable primary key, past the REST page limit. */
interface PageQuery<T> extends PromiseLike<{ data: T[] | null; error: unknown }> {
  order(column: string, options: { ascending: boolean }): PageQuery<T>;
  limit(size: number): PageQuery<T>;
  gt(column: string, cursor: string): PageQuery<T>;
}

export async function readRowsById<T extends { id: string }>(
  query: () => PageQuery<T>,
): Promise<T[]> {
  const pageSize = 250;
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    let page = query().order('id', { ascending: true }).limit(pageSize);
    if (cursor !== null) page = page.gt('id', cursor);
    const { data, error } = await page;
    if (error || !data) throw new Error('Source rows unavailable.');
    for (const row of data) {
      if (!row.id || (cursor !== null && row.id <= cursor)) throw new Error('Source row order changed.');
      cursor = row.id;
      rows.push(row);
    }
    if (data.length < pageSize) return rows;
  }
}
