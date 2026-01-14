import { fmtNum } from "../util/number.js";

/**
 * Рендерер визуализации теплообменной сети на canvas.
 *
 * Упрощённая схема:
 * - горизонтальные линии потоков (красный = горячие, синий = холодные)
 * - подписи потоков слева: H1..Hx и C1..Cx
 * - подписи температур на начале и конце линии (K); для изотермического потока справа рисуем "="
 * - вертикальные соединения для ячеек теплообмена (exchanger с hot и cold)
 * - «жирные» точки для холодильников (hot без cold, синяя) и нагревателей (cold без hot, красная)
 * - подписи нагрузок для каждой ячейки/холодильника/нагревателя
 *
 * Важно:
 * - ширину canvas задаёт layout (CSS); рендерер не добавляет горизонтальную прокрутку
 * - по высоте canvas может увеличиваться (inline height) если потоков много
 * - промежуточные температуры в точках контакта не рисуем (их нет в состоянии)
 */

// --- Утилиты геометрии и форматирования ---

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

const isStreamIsothermal = (s) => s && (s.out === undefined || s.out === null);

const fmtTempK = (t) => `${fmtNum(t)} K`;

const fmtLoadMw = (q) => `${fmtNum(q)} МВт`;

/**
 * Получить CSS-размер canvas без вмешательства в layout.
 *
 * @param {HTMLCanvasElement} canvas
 */
const getCanvasCssSize = (canvas) => {
  const rect = canvas.getBoundingClientRect();
  const wCss = Math.max(1, Math.floor(rect.width));
  const hCss = Math.max(1, Math.floor(rect.height));
  return { wCss, hCss };
};

/**
 * Подогнать внутреннюю пиксельную сетку canvas под DPR, не трогая CSS-геометрию.
 *
 * @param {HTMLCanvasElement} canvas
 */
const resizeCanvasForDpr = (canvas) => {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const { wCss, hCss } = getCanvasCssSize(canvas);

  const wPx = wCss * dpr;
  const hPx = hCss * dpr;

  // Почему: не трогаем размер без необходимости, чтобы не сбрасывать состояние контекста лишний раз.
  if (canvas.width !== wPx) canvas.width = wPx;
  if (canvas.height !== hPx) canvas.height = hPx;

  return { dpr, wCss, hCss, wPx, hPx };
};

const setCtxTextStyle = (ctx) => {
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textBaseline = "middle";
};

const drawText = (ctx, text, x, y, opts = {}) => {
  const {
    align = "left",
    fillStyle = "#0f172a",
    outline = true,
    outlineStyle = "rgba(255,255,255,0.9)",
    outlineWidth = 3,
  } = opts;

  ctx.textAlign = align;
  ctx.fillStyle = fillStyle;

  if (outline) {
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeStyle = outlineStyle;
    ctx.lineWidth = outlineWidth;
    ctx.strokeText(text, x, y);
  }

  ctx.fillText(text, x, y);
};

const drawLabelBox = (ctx, text, x, y, opts = {}) => {
  const {
    align = "center",
    textFill = "#0f172a",
    boxFill = "#e2e8f0",
    boxStroke = "#0f172a",
    boxStrokeWidth = 1,
    padX = 6,
    padY = 3,
  } = opts;

  ctx.textAlign = align;

  const m = ctx.measureText(text);
  const textW = m.width;
  const textH = 14;

  let x0 = x;
  if (align === "center") x0 = x - textW / 2;
  if (align === "right") x0 = x - textW;

  const rx = Math.floor(x0 - padX);
  const ry = Math.floor(y - textH / 2 - padY);
  const rw = Math.ceil(textW + padX * 2);
  const rh = Math.ceil(textH + padY * 2);

  ctx.fillStyle = boxFill;
  ctx.fillRect(rx, ry, rw, rh);

  ctx.strokeStyle = boxStroke;
  ctx.lineWidth = boxStrokeWidth;
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);

  ctx.fillStyle = textFill;
  ctx.fillText(text, x, y);
};

const drawLine = (ctx, x0, y0, x1, y1, opts = {}) => {
  const { strokeStyle = "#0f172a", lineWidth = 2, lineCap = "round" } = opts;

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = lineCap;

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

const drawDot = (ctx, x, y, r, opts = {}) => {
  const {
    fillStyle = "#0f172a",
    strokeStyle = "rgba(15,23,42,0.35)",
    lineWidth = 2,
  } = opts;

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fillStyle;
  ctx.fill();

  if (lineWidth > 0) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
};

const computeLayout = ({ wCss }) => {
  const pad = 12;

  // Делаем поля уже: подписи слева и справа должны быть «близко» к линии,
  // примерно как справа (xTempR = x1 + 10).
  let leftGutter = 96;
  let rightGutter = 118;

  // Минимальная длина линий: уменьшаем, чтобы простые схемы (без аппаратов)
  // не выглядели «слишком растянутыми» в split-режиме.
  const minSpan = 40;
  const available = wCss - 2 * pad;

  if (available - leftGutter - rightGutter < minSpan) {
    rightGutter = Math.max(90, available - leftGutter - minSpan);
    if (available - leftGutter - rightGutter < minSpan) {
      leftGutter = Math.max(90, available - rightGutter - minSpan);
    }
  }

  const x0 = pad + leftGutter; // начало линий
  const x1 = wCss - pad - rightGutter; // конец линий

  // Подписи слева размещаем рядом с линией (как справа), выравниваем вправо.
  const xTempL = Math.max(pad, x0 - 10); // температура на входе
  const xId = Math.max(pad, x0 - 34); // подпись потока (H1/C1)

  // Справа оставляем как было: подпись рядом с линией.
  const xTempR = x1 + 10; // температура на выходе (или "=")

  return { pad, xId, xTempL, x0, x1, xTempR };
};

// --- Основной рендер ---

/**
 * Отрисовать визуализацию.
 *
 * @param {object} deps
 * @param {HTMLCanvasElement} deps.canvas
 * @param {any} [deps.state] Каноническое состояние (multiheat/hot/cold/exchanger)
 */
export const renderVisualization = ({ canvas, state }) => {
  if (!canvas) return;

  const hot = Array.isArray(state?.hot) ? state.hot : [];
  const cold = Array.isArray(state?.cold) ? state.cold : [];
  const exch = Array.isArray(state?.exchanger) ? state.exchanger : [];

  // Если данных нет — оставляем аккуратную заглушку, чтобы пользователь понимал, что «оно работает».
  const hasAny = hot.length > 0 || cold.length > 0 || exch.length > 0;

  // Высотой canvas управляет контроллер; здесь только рисуем текущее состояние.

  const { dpr, wCss, hCss } = resizeCanvasForDpr(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Работаем в CSS-координатах (масштаб через transform).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, wCss, hCss);

  setCtxTextStyle(ctx);

  if (!hasAny) {
    // Сообщение — пользовательский текст, поэтому по-русски.
    drawText(ctx, "Нет данных для визуализации.", wCss / 2, hCss / 2, {
      align: "center",
      fillStyle: "#64748b",
      outline: false,
    });
    return;
  }

  const colors = {
    hot: "#dc2626", // красный
    cold: "#2563eb", // синий
    ink: "#0f172a",
    grid: "rgba(15,23,42,0.55)",
    faint: "rgba(15,23,42,0.25)",
  };

  const { xId, xTempL, x0, x1, xTempR } = computeLayout({
    wCss,
  });

  const top = 20;
  const bottom = 20;
  const gap = 28;
  // Между нижним горячим и верхним холодным делаем зазор чуть больше, чем между линиями внутри группы.
  const groupGap = hot.length > 0 && cold.length > 0 ? gap + 12 : 0;

  /** @type {number[]} */
  const yHot = [];
  /** @type {number[]} */
  const yCold = [];

  for (let i = 0; i < hot.length; i++) yHot.push(top + i * gap);

  const coldTop =
    top + (hot.length > 0 ? (hot.length - 1) * gap + groupGap : 0);
  for (let j = 0; j < cold.length; j++) yCold.push(coldTop + j * gap);

  // Если текущей высоты не хватает (после возможного ensureCanvasMinHeight) — рисуем как есть.
  // Но оставляем небольшой нижний отступ под подписи.
  const maxY =
    Math.max(
      hot.length ? yHot[yHot.length - 1] : 0,
      cold.length ? yCold[yCold.length - 1] : 0,
    ) + bottom;

  // Небольшая «внутренняя» сетка (тонкая), чтобы не было ощущения пустоты.
  // Не делаем сложной — только слабые горизонтальные штрихи.
  ctx.strokeStyle = "rgba(148,163,184,0.25)";
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  for (let y = 20; y < Math.min(hCss - 10, maxY); y += 56) {
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }

  // --- Потоки: линии и подписи ---

  const drawStream = ({ kind, idx0, s, y }) => {
    const isHot = kind === "hot";
    const color = isHot ? colors.hot : colors.cold;

    // Линия потока
    drawLine(ctx, x0, y, x1, y, { strokeStyle: color, lineWidth: 2.5 });

    // Подпись потока слева рядом с линией
    const id = `${isHot ? "H" : "C"}${idx0 + 1}`;
    drawText(ctx, id, xId, y, {
      align: "right",
      fillStyle: color,
      outline: true,
    });

    // Температура на входе (тоже рядом с линией)
    if (s && typeof s.in === "number") {
      drawText(ctx, fmtTempK(s.in), xTempL, y, {
        align: "right",
        fillStyle: colors.ink,
        outline: true,
      });
    }

    // Температура на выходе / "=" для изотермических
    const rightLabel = isStreamIsothermal(s) ? "=" : fmtTempK(s.out);
    drawText(ctx, rightLabel, xTempR, y, {
      align: "left",
      fillStyle: colors.ink,
      outline: true,
    });
  };

  for (let i = 0; i < hot.length; i++)
    drawStream({ kind: "hot", idx0: i, s: hot[i], y: yHot[i] });
  for (let j = 0; j < cold.length; j++)
    drawStream({ kind: "cold", idx0: j, s: cold[j], y: yCold[j] });

  // --- Теплообменники / утилиты ---

  const cells = [];
  const coolers = [];
  const heaters = [];

  for (let i = 0; i < exch.length; i++) {
    const ex = exch[i];
    const hasH = ex && ex.hot !== null && ex.hot !== undefined;
    const hasC = ex && ex.cold !== null && ex.cold !== undefined;

    if (hasH && hasC) cells.push({ ex, i });
    else if (hasH && !hasC) coolers.push({ ex, i });
    else if (!hasH && hasC) heaters.push({ ex, i });
    // else: валидация не должна допускать, но молча игнорируем
  }

  // Позиции по X для «ячеек теплообмена» и утилит.
  //
  // Утилиты ставим на общей вертикали `xUtilLine` (внутри длины линий),
  // при этом расстояние от последней ячейки до `xUtilLine` равно расстоянию
  // между последними двумя ячейками (равномерная сетка по X).
  const xUtilLine = x1 - 18;

  const cellMinBase = x0 + 24;
  let dxCell =
    cells.length > 0 ? (xUtilLine - cellMinBase) / (cells.length + 1) : 0;
  dxCell = Math.max(24, Math.floor(dxCell));

  const cellMinX =
    cells.length > 0
      ? Math.max(x0 + 12, xUtilLine - dxCell * (cells.length + 1))
      : x0 + 24;

  const cellX = (k) => cellMinX + dxCell * (k + 1);

  // Рисуем ячейки теплообмена: вертикальная линия + подпись нагрузки.
  for (let k = 0; k < cells.length; k++) {
    const { ex } = cells[k];
    const hi = Number(ex.hot);
    const ci = Number(ex.cold);

    if (!Number.isInteger(hi) || !Number.isInteger(ci)) continue;
    if (hi < 0 || hi >= yHot.length) continue;
    if (ci < 0 || ci >= yCold.length) continue;

    const x = cellX(k);
    const y0c = yHot[hi];
    const y1c = yCold[ci];

    // Соединение
    drawLine(ctx, x, y0c, x, y1c, {
      strokeStyle: colors.grid,
      lineWidth: 2,
      lineCap: "round",
    });

    // Малые маркеры контакта (не обязательны, но повышают читаемость)
    drawDot(ctx, x, y0c, 3.5, {
      fillStyle: colors.grid,
      strokeStyle: "rgba(255,255,255,0.7)",
      lineWidth: 1,
    });
    drawDot(ctx, x, y1c, 3.5, {
      fillStyle: colors.grid,
      strokeStyle: "rgba(255,255,255,0.7)",
      lineWidth: 1,
    });

    // Подпись нагрузки: без "Q=", в рамке, по центру между соединяемыми линиями.
    const qText = fmtLoadMw(ex.load);
    const yMid = (y0c + y1c) / 2;

    drawLabelBox(ctx, qText, x, yMid, {
      align: "center",
      textFill: colors.ink,
      boxFill: "#dbeafe",
      boxStroke: "rgba(15,23,42,0.8)",
      boxStrokeWidth: 1,
    });
  }

  // Утилиты (холодильники/нагреватели): точки на общей вертикали `xUtilLine`.
  // Важно: линии потоков уже имеют одинаковую длину (до `x1`), поэтому ничего не «удлиняем» под утилиты.

  const drawUtility = ({ kind, ex }) => {
    const isCooler = kind === "cooler";
    const isHeater = kind === "heater";

    const idx = isCooler ? Number(ex.hot) : Number(ex.cold);
    if (!Number.isInteger(idx)) return;

    const yArr = isCooler ? yHot : yCold;
    if (idx < 0 || idx >= yArr.length) return;

    const y = yArr[idx];

    // Точка на общей вертикали (линии потоков уже доходят до x1, не удлиняем отдельно).
    const xDot = xUtilLine;

    const dotColor = isCooler ? colors.cold : colors.hot;
    drawDot(ctx, xDot, y, 7, {
      fillStyle: dotColor,
      strokeStyle: "rgba(15,23,42,0.25)",
      lineWidth: 2,
    });

    // Подпись нагрузки: без "Q=", в рамке, сверху-справа от точки.
    const qText = fmtLoadMw(ex.load);
    drawLabelBox(ctx, qText, xDot + 12, y - 14, {
      align: "left",
      textFill: colors.ink,
      boxFill: "#e2e8f0",
      boxStroke: "rgba(15,23,42,0.8)",
      boxStrokeWidth: 1,
    });
  };

  for (const { ex } of coolers) drawUtility({ kind: "cooler", ex });
  for (const { ex } of heaters) drawUtility({ kind: "heater", ex });
};

/**
 * (Опционально) Устаревшая утилита из ранней версии: оставить для совместимости.
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
