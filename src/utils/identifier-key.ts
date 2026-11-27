const IDENTIFIER_KEY_RE = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

/** Whether `key` is an identifier, which an object literal writes without quotes, as oxfmt does. */
export function isIdentifierKey(key: string): boolean {
  return IDENTIFIER_KEY_RE.test(key);
}
