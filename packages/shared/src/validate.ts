import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses `data` with `schema`, turning validation failures into a 400 response. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export const IdParam = z.object({ id: z.uuid({ message: 'Invalid id' }) });

export const isoDateTime = z.iso
  .datetime({ offset: true, message: 'Expected an ISO-8601 date-time, e.g. 2026-12-31T19:00:00Z' })
  .transform((value) => new Date(value));
