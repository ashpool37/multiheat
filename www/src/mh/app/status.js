/**
 * Строка статуса (✅/⚠️/❌) и функция её обновления.
 */

/** @readonly */
export const StatusPrefix = {
  ok: "✅",
  warn: "⚠️",
  err: "❌",
};

/**
 * Создаёт интерфейс обновления строки статуса.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.statusEl Элемент, в который записывается строка статуса
 * @returns {{ setStatus: (kind: "ok"|"warn"|"err"|string, message: string) => void }}
 */
export const createStatus = ({ statusEl }) => {
  if (!statusEl) throw new Error("Не задан statusEl.");

  const setStatus = (kind, message) => {
    const prefix = StatusPrefix[kind] ?? StatusPrefix.err;
    statusEl.textContent = `${prefix} ${message}`;
  };

  return { setStatus };
};
