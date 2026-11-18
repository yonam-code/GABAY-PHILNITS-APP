/**
 * Escapes the wildcard characters of SQL LIKE / ILIKE patterns.
 *
 * The app looks users up case-insensitively with  .ilike('email', value).  In a LIKE pattern "_" matches ANY
 * single character and "%" matches anything, so an email like "juan_dela@gmail.com" would also match
 * "juanXdela@gmail.com" - and an UPDATE (PIN change / reset) could then hit another user's row.
 * Escaping makes the match exact (still case-insensitive).
 */
export const escapeLike = (value) => String(value ?? '').trim().replace(/[\\%_]/g, '\\$&')
