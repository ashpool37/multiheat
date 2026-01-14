/**
 * DOM query helpers.
 *
 * The frontend uses these helpers to keep DOM access consistent and fail-fast
 * when required UI elements are missing.
 */

/**
 * Query a single element. Throws if not found.
 * @param {string} sel
 * @param {ParentNode} [root=document]
 * @returns {Element}
 */
export const $ = (sel, root = document) => {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Не найден элемент интерфейса: ${sel}`);
  return el;
};

/**
 * Query a single element. Returns null if not found.
 * @param {string} sel
 * @param {ParentNode} [root=document]
 * @returns {Element|null}
 */
export const $maybe = (sel, root = document) => root.querySelector(sel);

/**
 * Query all elements (static list).
 * @param {string} sel
 * @param {ParentNode} [root=document]
 * @returns {Element[]}
 */
export const $$ = (sel, root = document) =>
  Array.from(root.querySelectorAll(sel));

/**
 * Get element by id. Throws if not found.
 * @param {string} id
 * @returns {HTMLElement}
 */
export const byId = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент интерфейса: #${id}`);
  return el;
};
