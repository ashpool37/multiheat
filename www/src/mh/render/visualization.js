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

// --- Форматирование нагрузок ---
//
// Требования:
// - 2 значащие цифры
// - экспонента, если есть >= 2 ведущих нуля после точки (|x| < 0.01)
// - убрать ведущий ноль у дробей: ".12", "-.12"
// - для ячеек: значение отдельно, "МВт" отдельной строкой в рамке
// - для утилит: одна строка (без переноса), но те же правила округления/экспоненты/ведущего нуля

const dropLeadingZero = (s) => s.replace(/^(-?)0\./, "$1.");

const fmtSig2 = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);

  const ax = Math.abs(x);
  // Экспонента при >= 2 ведущих нуля после точки: 0.00xx...
  if (ax > 0 && ax < 0.01) {
    // 2 значащие цифры => одна цифра после точки
    const s = x.toExponential(1).replace(/e\+/, "e");
    return s;
  }

  // Обычная запись с 2 значащими цифрами
  let s = x.toPrecision(2);

  // toPrecision может дать экспоненту на очень больших числах — это допустимо.
  // Для обычных дробей убираем ведущий ноль.
  if (!s.includes("e") && !s.includes("E")) s = dropLeadingZero(s);

  // Уберём лишние нули у десятичной формы, если они появились
  if (!s.includes("e") && !s.includes("E")) s = s.replace(/\.?0+$/, "");

  return s;
};

const fmtLoadValue = (q) => fmtSig2(q);

const fmtUtilityLabel = (q) => `${fmtSig2(q)} МВт`;

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

const drawLoadBox = (ctx, valueText, unitText, x, y, opts = {}) => {
  const {
    boxFill = "#dbeafe",
    boxStroke = "rgba(15,23,42,0.8)",
    boxStrokeWidth = 1,
    textFill = "#0f172a",
    padX = 7,
    padY = 5,
    lineGap = 2,
  } = opts;

  const line1 = String(valueText);
  const line2 = String(unitText);

  const m1 = ctx.measureText(line1);
  const m2 = ctx.measureText(line2);

  const textW = Math.max(m1.width, m2.width);
  const lineH = 14;
  const boxW = Math.ceil(textW + padX * 2);
  const boxH = Math.ceil(lineH * 2 + lineGap + padY * 2);

  const rx = Math.floor(x - boxW / 2);
  const ry = Math.floor(y - boxH / 2);

  ctx.fillStyle = boxFill;
  ctx.fillRect(rx, ry, boxW, boxH);

  ctx.strokeStyle = boxStroke;
  ctx.lineWidth = boxStrokeWidth;
  ctx.strokeRect(rx + 0.5, ry + 0.5, boxW - 1, boxH - 1);

  ctx.fillStyle = textFill;
  ctx.textAlign = "center";

  const y1 = ry + padY + lineH / 2;
  const y2 = ry + padY + lineH + lineGap + lineH / 2;

  ctx.fillText(line1, x, y1);
  ctx.fillText(line2, x, y2);
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

const computeLayout = ({ wCss, hasExchangers }) => {
  const pad = 12;

  // Когда появляются ячейки, нам нужен больший «рабочий» горизонтальный диапазон.
  // Поэтому делаем поля ещё чуть уже (линии растут влево/вправо в пределах canvas),
  // а сам canvas при необходимости расширяем через minWidth (см. ниже).
  let leftGutter = hasExchangers ? 82 : 96;
  let rightGutter = hasExchangers ? 110 : 118;

  // Минимальная длина линий: в простом случае (без аппаратов) должны помещаться в split-режиме.
  const minSpan = 40;
  const available = wCss - 2 * pad;

  if (available - leftGutter - rightGutter < minSpan) {
    rightGutter = Math.max(84, available - leftGutter - minSpan);
    if (available - leftGutter - rightGutter < minSpan) {
      leftGutter = Math.max(84, available - rightGutter - minSpan);
    }
  }

  const x0 = pad + leftGutter; // начало линий
  const x1 = wCss - pad - rightGutter; // конец линий

  // Температуры слева размещаем рядом с линией, выравниваем вправо.
  // ID потока позиционируем динамически (в drawStream), чтобы не перекрывать температуру.
  const xTempL = Math.max(pad, x0 - 10); // температура на входе

  const xTempR = x1 + 10; // температура на выходе (или "=")

  return { pad, leftGutter, rightGutter, minSpan, xTempL, x0, x1, xTempR };
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

  // Ширину canvas задаёт layout/контроллер; рендерер не изменяет `min-width`.
  // Здесь выполняем один корректный проход рендеринга без «двойной инициализации» контекста.
  const hasExchangers = exch.some(
    (ex) =>
      ex &&
      ex.hot !== null &&
      ex.hot !== undefined &&
      ex.cold !== null &&
      ex.cold !== undefined,
  );

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

  const { pad, xTempL, x0, x1, xTempR } = computeLayout({
    wCss,
    hasExchangers,
  });

  const top = 20;
  const bottom = 20;
  const gap = 28;
  // Между нижним горячим и верхним холодным делаем зазор заметно больше (нужен «коридор» под подписи нагрузок).
  const groupGap = hot.length > 0 && cold.length > 0 ? gap + 22 : 0;

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

    // Температура на входе (рядом с линией)
    const inText = s && typeof s.in === "number" ? fmtTempK(s.in) : "";
    if (inText) {
      drawText(ctx, inText, xTempL, y, {
        align: "right",
        fillStyle: colors.ink,
        outline: true,
      });
    }

    // ID потока: ставим левее температуры на входе так, чтобы не перекрывались.
    const id = `${isHot ? "H" : "C"}${idx0 + 1}`;
    const inW = inText ? ctx.measureText(inText).width : 0;
    const xId = Math.max(pad, xTempL - inW - 10);
    drawText(ctx, id, xId, y, {
      align: "right",
      fillStyle: color,
      outline: true,
    });

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
  const UTIL_INSET = 18;
  const DX_CELL = 90; // постоянный шаг между аппаратами

  const xUtilLine = x1 - UTIL_INSET;

  // Ячейки располагаем равномерно по X с постоянным шагом:
  // ... , E(k-1), E(k), ..., E(last), [util]
  // При этом расстояние от последней ячейки до util равно расстоянию между последними двумя ячейками.
  const cellX = (k) => xUtilLine - DX_CELL * (cells.length - k);

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

    // Подпись нагрузки:
    // - 2 значащие цифры
    // - значение и единица измерения на разных строках в рамке
    // - центрируем в «коридоре» между нижним горячим и верхним холодным (если обе группы есть)
    const vText = fmtLoadValue(ex.load);

    const yBand =
      hot.length > 0 && cold.length > 0
        ? (yHot[yHot.length - 1] + yCold[0]) / 2
        : (y0c + y1c) / 2;

    drawLoadBox(ctx, vText, "МВт", x, yBand, {
      boxFill: "#dbeafe",
      boxStroke: "rgba(15,23,42,0.8)",
      boxStrokeWidth: 1,
      textFill: colors.ink,
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

    // Подпись нагрузки утилиты:
    // - одна строка (без переноса)
    // - 2 значащие цифры, экспонента при необходимости, без ведущего нуля у дроби
    const qText = fmtUtilityLabel(ex.load);
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
