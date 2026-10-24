/** Postgres hands back Date objects; contracts use ISO strings. */
export const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);
export const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value));
