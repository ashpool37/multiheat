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

const fmtLoadMw = (q) => `Q=${fmtNum(q)} МВт`;

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

  // Левый гаттер под H1/C1 + температуру на входе.
  // Правый гаттер под температуру на выходе + утилиты + подпись нагрузки.
  let leftGutter = 140;
  let rightGutter = 180;

  // Гарантируем минимальную «рабочую» ширину для рисования линий.
  const minSpan = 120;
  const available = wCss - 2 * pad;

  if (available - leftGutter - rightGutter < minSpan) {
    // Сначала ужимаем правую часть.
    rightGutter = Math.max(110, available - leftGutter - minSpan);
    if (available - leftGutter - rightGutter < minSpan) {
      // Потом левую.
      leftGutter = Math.max(110, available - rightGutter - minSpan);
    }
  }

  const xId = pad; // подпись потока (H1/C1)
  const xTempL = pad + 34; // температура на входе
  const x0 = pad + leftGutter; // начало линий
  const x1 = wCss - pad - rightGutter; // конец линий (до правых подписей/утилит)
  const xTempR = x1 + 10; // температура на выходе (или "=")

  // Зона утилит внутри правого гаттера.
  const xUtilBase =
    x1 + clamp(36, Math.floor(rightGutter * 0.42), rightGutter - 60);
  const xUtilMax = wCss - pad - 10;

  return {
    pad,
    leftGutter,
    rightGutter,
    xId,
    xTempL,
    x0,
    x1,
    xTempR,
    xUtilBase,
    xUtilMax,
  };
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

  const { xId, xTempL, x0, x1, xTempR, xUtilBase, xUtilMax } = computeLayout({
    wCss,
  });

  const top = 20;
  const bottom = 20;
  const gap = 28;
  const groupGap = hot.length > 0 && cold.length > 0 ? 18 : 0;

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

    // Подпись потока слева (на «поле»)
    const id = `${isHot ? "H" : "C"}${idx0 + 1}`;
    drawText(ctx, id, xId, y, {
      align: "left",
      fillStyle: color,
      outline: true,
    });

    // Температура на входе
    if (s && typeof s.in === "number") {
      drawText(ctx, fmtTempK(s.in), xTempL, y, {
        align: "left",
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

  // Позиции по X для «ячееек теплообмена».
  const cellMinX = x0 + 40;
  const cellMaxX = x1 - 40;
  const span = Math.max(1, cellMaxX - cellMinX);

  const cellX = (k) => {
    if (cells.length === 1) return cellMinX + span * 0.5;
    return cellMinX + (span * (k + 1)) / (cells.length + 1);
  };

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

    // Подпись нагрузки
    const qText = fmtLoadMw(ex.load);
    const yMid = (y0c + y1c) / 2;

    // Пытаемся разместить справа от линии, иначе — слева.
    const rightX = x + 8;
    const leftX = x - 8;

    const m = ctx.measureText(qText);
    const fitsRight = rightX + m.width < wCss - 10;

    drawText(ctx, qText, fitsRight ? rightX : leftX, yMid, {
      align: fitsRight ? "left" : "right",
      fillStyle: colors.ink,
      outline: true,
    });
  }

  // Утилиты: точки на соответствующих потоках.
  // Если утилит на одной линии несколько — сдвигаем точки вправо (в пределах правого гаттера).
  /** @type {Map<number, number>} */
  const utilCountByHot = new Map();
  /** @type {Map<number, number>} */
  const utilCountByCold = new Map();

  const drawUtility = ({ kind, ex }) => {
    const isCooler = kind === "cooler";
    const isHeater = kind === "heater";

    const idx = isCooler ? Number(ex.hot) : Number(ex.cold);
    if (!Number.isInteger(idx)) return;

    const yArr = isCooler ? yHot : yCold;
    if (idx < 0 || idx >= yArr.length) return;

    const y = yArr[idx];

    const map = isCooler ? utilCountByHot : utilCountByCold;
    const used = map.get(idx) ?? 0;
    map.set(idx, used + 1);

    const step = 18;
    const xDot = clamp(xUtilBase + used * step, x1 + 26, xUtilMax);

    // Лёгкое продолжение линии до точки
    const streamColor = isCooler ? colors.hot : colors.cold;
    drawLine(ctx, x1, y, xDot - 9, y, {
      strokeStyle: streamColor,
      lineWidth: 2.5,
    });

    // Точка
    const dotColor = isCooler ? colors.cold : colors.hot;
    drawDot(ctx, xDot, y, 7, {
      fillStyle: dotColor,
      strokeStyle: "rgba(15,23,42,0.25)",
      lineWidth: 2,
    });

    // Подпись нагрузки рядом с точкой
    const qText = fmtLoadMw(ex.load);
    const textX = xDot + 10;
    const textAlign =
      textX + ctx.measureText(qText).width < wCss - 8 ? "left" : "right";
    const tx = textAlign === "left" ? textX : xDot - 10;

    drawText(ctx, qText, tx, y - 12, {
      align: textAlign,
      fillStyle: colors.ink,
      outline: true,
    });
  };

  for (const { ex } of coolers) drawUtility({ kind: "cooler", ex });
  for (const { ex } of heaters) drawUtility({ kind: "heater", ex });

  // Мелкая подпись снизу (не обязательно, но полезно для понимания легенды).
  // Это пользовательский текст, поэтому по-русски; сделаем ненавязчиво.
  const legendY = Math.min(hCss - 12, maxY + 8);
  drawText(
    ctx,
    "Горячие: красные линии (H). Холодные: синие линии (C). Ячейки: вертикали. Утилиты: точки (синий — холодильник, красный — нагреватель).",
    x0,
    legendY,
    { align: "left", fillStyle: "rgba(100,116,139,0.95)", outline: false },
  );
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
