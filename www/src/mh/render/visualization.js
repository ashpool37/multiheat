/**
 * Минимальный рендерер визуализации.
 *
 * Сейчас рисуем только короткую горизонтальную линию по центру canvas.
 * Важно: canvas масштабируется под devicePixelRatio, чтобы линия не была «мыльной».
 */

/**
 * Получить CSS-размер canvas без вмешательства в layout.
 *
 * Почему: рендерер не должен перезаписывать `canvas.style.width/height`,
 * иначе он ломает адаптивную вёрстку (особенно в split-режиме).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number | undefined} widthCssPx
 * @param {number | undefined} heightCssPx
 */
const getCanvasCssSize = (canvas, widthCssPx, heightCssPx) => {
  const rect = canvas.getBoundingClientRect();

  const w =
    Number.isFinite(widthCssPx) && widthCssPx > 0 ? widthCssPx : rect.width;
  const h =
    Number.isFinite(heightCssPx) && heightCssPx > 0 ? heightCssPx : rect.height;

  const wCss = Math.max(1, Math.floor(w));
  const hCss = Math.max(1, Math.floor(h));

  return { wCss, hCss };
};

/**
 * Подогнать внутреннюю пиксельную сетку canvas под DPR, не трогая CSS-геометрию.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number | undefined} widthCssPx
 * @param {number | undefined} heightCssPx
 */
const resizeCanvasForDpr = (canvas, widthCssPx, heightCssPx) => {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const { wCss, hCss } = getCanvasCssSize(canvas, widthCssPx, heightCssPx);

  // Внутренняя пиксельная сетка (то, что рисует контекст)
  const wPx = wCss * dpr;
  const hPx = hCss * dpr;

  // Почему: не трогаем размер без необходимости, чтобы не сбрасывать состояние контекста лишний раз.
  if (canvas.width !== wPx) canvas.width = wPx;
  if (canvas.height !== hPx) canvas.height = hPx;

  return { dpr, wCss, hCss, wPx, hPx };
};

/**
 * Отрисовать «заглушку» визуализации: короткая горизонтальная линия в центре.
 *
 * Если `widthCssPx`/`heightCssPx` не переданы, размер берём из `canvas.getBoundingClientRect()`.
 *
 * @param {object} deps
 * @param {HTMLCanvasElement} deps.canvas
 * @param {number} [deps.widthCssPx]
 * @param {number} [deps.heightCssPx]
 */
export const renderVisualization = ({ canvas, widthCssPx, heightCssPx }) => {
  if (!canvas) return;

  const { dpr, wCss, hCss } = resizeCanvasForDpr(
    canvas,
    widthCssPx,
    heightCssPx,
  );

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Работаем в CSS-координатах (масштабируем через transform), чтобы было проще считать «по центру».
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Фон прозрачный; просто очищаем.
  ctx.clearRect(0, 0, wCss, hCss);

  const cx = wCss / 2;
  const cy = hCss / 2;

  const lineLen = Math.min(wCss * 0.45, 220);
  const x0 = cx - lineLen / 2;
  const x1 = cx + lineLen / 2;

  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();
};

/**
 * Утилита: вычислить «разумные» размеры canvas из контейнера.
 * Возвращает `{ widthCssPx, heightCssPx }` либо `null`, если контейнер ещё не имеет размеров.
 *
 * @param {HTMLElement} container
 * @param {number} heightCssPx
 * @returns {{ widthCssPx: number, heightCssPx: number } | null}
 */
export const getCanvasSizeFromContainer = (container, heightCssPx) => {
  if (!container) return null;

  const rect = container.getBoundingClientRect();
  const widthCssPx = Math.floor(rect.width);

  if (!Number.isFinite(widthCssPx) || widthCssPx <= 0) return null;
  if (!Number.isFinite(heightCssPx) || heightCssPx <= 0) return null;

  return { widthCssPx, heightCssPx: Math.floor(heightCssPx) };
};
