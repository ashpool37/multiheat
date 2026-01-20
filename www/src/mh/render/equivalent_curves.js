/**
 * Рендер эквивалентных температурных кривых (T+(Q), T-(Q)) на canvas.
 *
 * Цель: отрисовать кривые эквивалентного двухпоточного аппарата в координатах:
 * - X: Q, МВт
 * - Y: T, K
 *
 * Ожидаемый формат входных данных:
 * curves = {
 *   dt_min_K: number,
 *   hot:  [{ q_MW: number, temp_K: number }, ...],
 *   cold: [{ q_MW: number, temp_K: number }, ...],
 * }
 *
 * Примечания:
 * - кривые считаются уже рассчитанными в Zig и передаются через zigar;
 * - внутри этого модуля нет вызова Zig — только отрисовка.
 */

/** @param {number} v */
const isFiniteNumber = (v) => Number.isFinite(Number(v));

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

/**
 * Получить CSS-размер canvas (без вмешательства в layout).
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

  if (canvas.width !== wPx) canvas.width = wPx;
  if (canvas.height !== hPx) canvas.height = hPx;

  return { dpr, wCss, hCss, wPx, hPx };
};

const setCtxTextStyle = (ctx) => {
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textBaseline = "middle";
};

const clear = (ctx, w, h) => {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.restore();
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

const drawPolyline = (ctx, pts, opts = {}) => {
  const { strokeStyle = "#0f172a", lineWidth = 2 } = opts;
  if (!Array.isArray(pts) || pts.length < 2) return;

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
};

/**
 * Нормализовать входные точки кривой (убрать мусор, привести типы).
 *
 * @param {any} xs
 * @returns {{q:number, t:number}[]}
 */
const normalizeCurve = (xs) => {
  if (!xs) return [];
  const arr = Array.isArray(xs) ? xs : Array.from(xs ?? []);
  const out = [];
  for (const p of arr) {
    const q = Number(p?.q_MW);
    const t = Number(p?.temp_K);
    if (!isFiniteNumber(q) || !isFiniteNumber(t)) continue;
    out.push({ q, t });
  }
  // Небольшая защита: сортируем по Q (на всякий случай).
  out.sort((a, b) => a.q - b.q);
  return out;
};

/**
 * Подобрать “красивое” число шагов и размер тика для оси.
 *
 * @param {number} span
 * @param {number} targetTicks
 */
const niceTickStep = (span, targetTicks) => {
  const s = Math.abs(span);
  if (!(s > 0)) return 1;

  const raw = s / Math.max(1, targetTicks);
  const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow10;

  let step = 1;
  if (n <= 1) step = 1;
  else if (n <= 2) step = 2;
  else if (n <= 5) step = 5;
  else step = 10;

  return step * pow10;
};

const formatTick = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);

  const ax = Math.abs(x);
  if (ax >= 1000 || ax < 0.01) return x.toExponential(1).replace(/e\+/, "e");

  // 0..999: 0-2 знака после точки по ситуации
  if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
  const s = x.toFixed(2).replace(/\.?0+$/, "");
  return s;
};

/**
 * Рендер эквивалентных кривых.
 *
 * @param {{canvas: HTMLCanvasElement, curves: any}} args
 */
export const renderEquivalentCurves = ({ canvas, curves }) => {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { dpr, wCss, hCss, wPx, hPx } = resizeCanvasForDpr(canvas);

  // Работаем в CSS-координатах.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  clear(ctx, wPx, hPx);

  setCtxTextStyle(ctx);

  const hot = normalizeCurve(curves?.hot);
  const cold = normalizeCurve(curves?.cold);

  if (hot.length < 2 && cold.length < 2) {
    drawText(
      ctx,
      "Эквивалентные кривые недоступны: недостаточно данных.",
      12,
      18,
      { align: "left", fillStyle: "#0f172a" },
    );
    return;
  }

  // --- Диапазоны по осям ---
  let qMax = 0;
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;

  for (const p of [...hot, ...cold]) {
    qMax = Math.max(qMax, p.q);
    tMin = Math.min(tMin, p.t);
    tMax = Math.max(tMax, p.t);
  }

  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) {
    drawText(ctx, "Не удалось определить диапазон температур.", 12, 18);
    return;
  }

  // Немного воздуха по Y, чтобы подписи не прижимались.
  const tSpan = Math.max(1e-6, tMax - tMin);
  tMin -= tSpan * 0.05;
  tMax += tSpan * 0.05;

  // Если Q почти ноль — зададим минимальный масштаб, чтобы ось была видимой.
  if (!(qMax > 0)) qMax = 1;

  // --- Разметка области графика ---
  const pad = 12;
  const left = pad + 54; // место под подписи делений по T
  const right = wCss - pad - 16;
  const top = pad + 18;
  const bottom = hCss - pad - 34; // место под подписи по Q

  const plotW = Math.max(1, right - left);
  const plotH = Math.max(1, bottom - top);

  // --- Преобразование координат ---
  const xOfQ = (q) => left + (clamp(0, q, qMax) / qMax) * plotW;
  const yOfT = (t) => {
    const u = (t - tMin) / (tMax - tMin);
    const uu = clamp(0, u, 1);
    return bottom - uu * plotH;
  };

  // --- Оси ---
  drawLine(ctx, left, bottom, right, bottom, {
    strokeStyle: "rgba(15,23,42,0.9)",
    lineWidth: 2,
    lineCap: "round",
  });
  drawLine(ctx, left, bottom, left, top, {
    strokeStyle: "rgba(15,23,42,0.9)",
    lineWidth: 2,
    lineCap: "round",
  });

  // Заголовки осей (как в run.ijs)
  drawText(ctx, "T, K", left - 38, top - 8, {
    align: "left",
    fillStyle: "rgba(15,23,42,0.9)",
    outline: false,
  });
  drawText(ctx, "Q, МВт", right, bottom + 22, {
    align: "right",
    fillStyle: "rgba(15,23,42,0.9)",
    outline: false,
  });

  // Подпись ΔTmin (если есть)
  if (isFiniteNumber(curves?.dt_min_K)) {
    const s = `ΔTmin = ${formatTick(curves.dt_min_K)} K`;
    drawText(ctx, s, right, top - 8, {
      align: "right",
      fillStyle: "rgba(15,23,42,0.7)",
      outline: false,
    });
  }

  // --- Сетка и деления ---
  const xStep = niceTickStep(qMax, 6);
  const yStep = niceTickStep(tMax - tMin, 6);

  // Вертикальные линии (Q)
  for (let q = 0; q <= qMax + 1e-9; q += xStep) {
    const x = xOfQ(q);
    drawLine(ctx, x, bottom, x, top, {
      strokeStyle: "rgba(15,23,42,0.08)",
      lineWidth: 1,
      lineCap: "butt",
    });

    drawLine(ctx, x, bottom, x, bottom + 4, {
      strokeStyle: "rgba(15,23,42,0.65)",
      lineWidth: 1,
      lineCap: "butt",
    });

    drawText(ctx, formatTick(q), x, bottom + 16, {
      align: "center",
      fillStyle: "rgba(15,23,42,0.85)",
      outline: true,
      outlineStyle: "rgba(255,255,255,0.95)",
      outlineWidth: 3,
    });
  }

  // Горизонтальные линии (T)
  // Начинаем с ближайшего “красивого” деления.
  const yStart = Math.ceil(tMin / yStep) * yStep;
  for (let t = yStart; t <= tMax + 1e-9; t += yStep) {
    const y = yOfT(t);
    drawLine(ctx, left, y, right, y, {
      strokeStyle: "rgba(15,23,42,0.08)",
      lineWidth: 1,
      lineCap: "butt",
    });

    drawLine(ctx, left - 4, y, left, y, {
      strokeStyle: "rgba(15,23,42,0.65)",
      lineWidth: 1,
      lineCap: "butt",
    });

    drawText(ctx, formatTick(t), left - 8, y, {
      align: "right",
      fillStyle: "rgba(15,23,42,0.85)",
      outline: true,
      outlineStyle: "rgba(255,255,255,0.95)",
      outlineWidth: 3,
    });
  }

  // --- Легенда ---
  const legendY = top + 8;
  const legendX0 = left + 10;
  const legendGap = 140;

  const drawLegend = (x, label, color) => {
    drawLine(ctx, x, legendY, x + 22, legendY, {
      strokeStyle: color,
      lineWidth: 3,
      lineCap: "round",
    });
    drawText(ctx, label, x + 28, legendY, {
      align: "left",
      fillStyle: "rgba(15,23,42,0.9)",
      outline: true,
      outlineStyle: "rgba(255,255,255,0.95)",
      outlineWidth: 3,
    });
  };

  // Как в run.ijs: red, green
  drawLegend(legendX0, "T+(Q) (горячий)", "#dc2626");
  drawLegend(legendX0 + legendGap, "T-(Q) (холодный)", "#16a34a");

  // --- Преобразуем точки кривых в экранные координаты ---
  const toScreenPts = (curve) =>
    curve.map((p) => ({
      x: xOfQ(p.q),
      y: yOfT(p.t),
    }));

  const hotPts = toScreenPts(hot);
  const coldPts = toScreenPts(cold);

  // --- Рисуем кривые ---
  drawPolyline(ctx, hotPts, { strokeStyle: "#dc2626", lineWidth: 2.5 });
  drawPolyline(ctx, coldPts, { strokeStyle: "#16a34a", lineWidth: 2.5 });

  // --- Маркеры начальных/конечных точек ---
  const drawEndpoint = (pt, color) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(15,23,42,0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  if (hotPts.length > 0) {
    drawEndpoint(hotPts[0], "#dc2626");
    drawEndpoint(hotPts[hotPts.length - 1], "#dc2626");
  }
  if (coldPts.length > 0) {
    drawEndpoint(coldPts[0], "#16a34a");
    drawEndpoint(coldPts[coldPts.length - 1], "#16a34a");
  }

  // --- Подпись Q_max ---
  const qLabel = `Qmax = ${formatTick(qMax)} МВт`;
  drawText(ctx, qLabel, right, top + 28, {
    align: "right",
    fillStyle: "rgba(15,23,42,0.7)",
    outline: false,
  });
};
