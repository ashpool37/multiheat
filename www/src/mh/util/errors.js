/**
 * Error helpers shared across the UI.
 */

/**
 * Convert unknown thrown values into a readable message.
 * Mirrors the previous behavior from `main.js`.
 * @param {unknown} e
 * @returns {string}
 */
export const toErrorText = (e) => {
  if (e instanceof Error) return e.message || String(e);
  return String(e);
};

/**
 * Detect "user cancelled" errors from the File System Access API.
 * Mirrors the previous behavior from `main.js`.
 * @param {unknown} e
 * @returns {boolean}
 */
export const isAbortError = (e) =>
  typeof e === "object" && e !== null && "name" in e && e.name === "AbortError";

/**
 * Console logging helper with consistent prefixing.
 * @param {string} context
 * @param {unknown} e
 */
export const logError = (context, e) => {
  console.error(`[multiheat] ${context}`, e);
};
