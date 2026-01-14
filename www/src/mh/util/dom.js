/**
 * Утилиты поиска элементов DOM.
 */

/**
 * `$(sel, root)` → `Element`. Если элемент не найден — выбрасывает исключение.
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
 * `$maybe(sel, root)` → `Element|null`.
 * @param {string} sel
 * @param {ParentNode} [root=document]
 * @returns {Element|null}
 */
export const $maybe = (sel, root = document) => root.querySelector(sel);

/**
 * `$$(sel, root)` → `Element[]` (статический список).
 * @param {string} sel
 * @param {ParentNode} [root=document]
 * @returns {Element[]}
 */
export const $$ = (sel, root = document) =>
  Array.from(root.querySelectorAll(sel));

/**
 * `byId(id)` → `HTMLElement`. Если элемент не найден — выбрасывает исключение.
 * @param {string} id
 * @returns {HTMLElement}
 */
export const byId = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент интерфейса: #${id}`);
  return el;
};
