import { badRequest } from './errors.js';

/**
 * Opaque keyset cursor: [sortValue, id]. sortValue is the full-precision
 * Postgres timestamp text so no rows are skipped at microsecond boundaries.
 */
export type Cursor = [sortValue: string, id: string];

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string')) {
      return value as Cursor;
    }
  } catch {
    // fall through
  }
  throw badRequest('INVALID_CURSOR', 'Malformed pagination cursor');
}

/** Given rows fetched with LIMIT n+1, returns the page plus the next cursor. */
export function paginate<T extends { id: string; sort_ts: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return { page, nextCursor: hasMore && last ? encodeCursor([last.sort_ts, last.id]) : null };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
