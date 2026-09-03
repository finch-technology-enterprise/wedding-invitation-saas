/** Unix milliseconds. All timestamps in D1 are INTEGER ms — sortable,
 * compact, and free of timezone-string ambiguity. */
export function nowMs(): number {
  return Date.now();
}
