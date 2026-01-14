/**
 * Утилиты для обработки ошибок в UI.
 */

/**
 * `toErrorText(e)` → `string`.
 * @param {unknown} e
 * @returns {string}
 */
export const toErrorText = (e) => {
  if (e instanceof Error) return e.message || String(e);
  return String(e);
};

/**
 * `isAbortError(e)` → `boolean` (отмена пользователем в File System Access API).
 * @param {unknown} e
 * @returns {boolean}
 */
export const isAbortError = (e) =>
  typeof e === "object" && e !== null && "name" in e && e.name === "AbortError";

/**
 * `logError(context, e)` → `void`.
 * @param {string} context
 * @param {unknown} e
 */
export const logError = (context, e) => {
  console.error(`[multiheat] ${context}`, e);
};
