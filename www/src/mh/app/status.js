/**
 * Status line helper.
 *
 * This module centralizes status formatting (✅/⚠️/❌) and updating the UI.
 * Behavior matches the original monolithic implementation in `main.js`.
 */

/** @readonly */
export const StatusPrefix = {
  ok: "✅",
  warn: "⚠️",
  err: "❌",
};

/**
 * Create a status setter bound to a DOM element.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.statusEl Element that displays the status line text
 */
export const createStatus = ({ statusEl }) => {
  if (!statusEl) throw new Error("statusEl is required");

  /**
   * Set the status line text.
   *
   * @param {"ok"|"warn"|"err"|string} kind
   * @param {string} message
   */
  const setStatus = (kind, message) => {
    const prefix = StatusPrefix[kind] ?? StatusPrefix.err;
    statusEl.textContent = `${prefix} ${message}`;
  };

  return { setStatus };
};
