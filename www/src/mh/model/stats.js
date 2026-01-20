import { fmtNum } from "../util/number.js";

/**
 * Вычисление статистики решения (stats) для:
 * - вставки в TOML (блок [stats])
 * - отображения на вкладке «Описание»
 *
 * Договорённости:
 * - total_load_hot / total_load_cold — суммарные требуемые тепловые нагрузки потоков (МВт)
 * - load_diff = total_load_cold - total_load_hot (МВт)
 * - cell_count — число ячеек теплообмена (hot != null и cold != null)
 * - utility_count — число утилит (нагреватели/холодильники: ровно один конец null)
 * - total_load_cells — суммарная нагрузка ячеек теплообмена (МВт)
 * - total_load_utilities — суммарная нагрузка утилит (МВт)
 * - external_power_saved — экономия внешней энергии относительно базового сценария «Без теплообмена»
 *   (см. computeExternalBaselineMW)
 *
 * Важно:
 * - В каноническом состоянии поток может быть:
 *   - изотермический: { in, load }
 *   - неизотермический: { in, out, rate } или { in, out, load }
 * - Для статистики мы используем только тепловые нагрузки, а не подробности профилей температуры.
 */

/** @param {any} v */
const toFiniteNumberOr = (v, fallback) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

/**
 * Требуемая нагрузка одного потока (МВт) в канонической модели.
 *
 * @param {any} s
 * @returns {number}
 */
export const requiredLoadMW = (s) => {
  if (!s || typeof s !== "object") return 0;

  // Изотермический: out отсутствует
  if (s.out === undefined || s.out === null) {
    return Math.max(0, toFiniteNumberOr(s.load, 0));
  }

  const inT = toFiniteNumberOr(s.in, NaN);
  const outT = toFiniteNumberOr(s.out, NaN);
  const dt = Math.abs(outT - inT);

  if (!Number.isFinite(dt) || !(dt > 0)) return 0;

  // Предпочитаем rate (если задан), иначе берём load.
  if (s.rate !== undefined && s.rate !== null) {
    const rate = toFiniteNumberOr(s.rate, 0);
    return Math.max(0, rate * dt);
  }

  return Math.max(0, toFiniteNumberOr(s.load, 0));
};

/**
 * Базовая внешняя мощность (МВт) для сценария «Без теплообмена»:
 * - каждый hot поток полностью охлаждается внешним холодильником
 * - каждый cold поток полностью нагревается внешним нагревателем
 *
 * Тогда суммарная внешняя мощность = ΣQ_hot + ΣQ_cold.
 *
 * @param {any} state
 * @returns {number}
 */
export const computeExternalBaselineMW = (state) => {
  const hot = Array.isArray(state?.hot) ? state.hot : [];
  const cold = Array.isArray(state?.cold) ? state.cold : [];

  let qHot = 0;
  for (const s of hot) qHot += requiredLoadMW(s);

  let qCold = 0;
  for (const s of cold) qCold += requiredLoadMW(s);

  return qHot + qCold;
};

/**
 * Посчитать статистику решения.
 *
 * @param {any} state каноническое состояние ({ hot, cold, exchanger })
 * @param {object} [opts]
 * @param {string|null} [opts.algorithm_used] имя функции Zig (например "solve_greedy")
 * @param {string|null} [opts.algorithm_label] человекочитаемое имя алгоритма (например "Жадный")
 * @param {number|null} [opts.solve_time_ms] время синтеза (мс)
 * @returns {{
 *   total_load_hot: number,
 *   total_load_cold: number,
 *   load_diff: number,
 *   algorithm_used: string|null,
 *   algorithm_label: string|null,
 *   solve_time_ms: number|null,
 *   cell_count: number,
 *   utility_count: number,
 *   total_load_cells: number,
 *   total_load_utilities: number,
 *   external_power_saved: number
 * }}
 */
export const computeSolutionStats = (state, opts = {}) => {
  const hot = Array.isArray(state?.hot) ? state.hot : [];
  const cold = Array.isArray(state?.cold) ? state.cold : [];
  const exch = Array.isArray(state?.exchanger) ? state.exchanger : [];

  let totalHot = 0;
  for (const s of hot) totalHot += requiredLoadMW(s);

  let totalCold = 0;
  for (const s of cold) totalCold += requiredLoadMW(s);

  const loadDiff = totalCold - totalHot;

  let cellCount = 0;
  let utilCount = 0;
  let qCells = 0;
  let qUtils = 0;

  for (const ex of exch) {
    if (!ex || typeof ex !== "object") continue;

    const hasH = ex.hot !== null && ex.hot !== undefined;
    const hasC = ex.cold !== null && ex.cold !== undefined;
    const q = Math.max(0, toFiniteNumberOr(ex.load, 0));

    if (hasH && hasC) {
      cellCount += 1;
      qCells += q;
    } else if ((hasH && !hasC) || (!hasH && hasC)) {
      utilCount += 1;
      qUtils += q;
    } else {
      // Некорректная запись (оба null) — не учитываем.
    }
  }

  const baseline = computeExternalBaselineMW(state);
  const externalSaved = Math.max(0, baseline - qUtils);

  return {
    total_load_hot: totalHot,
    total_load_cold: totalCold,
    load_diff: loadDiff,
    algorithm_used: opts.algorithm_used ?? null,
    algorithm_label: opts.algorithm_label ?? null,
    solve_time_ms:
      opts.solve_time_ms === null || opts.solve_time_ms === undefined
        ? null
        : toFiniteNumberOr(opts.solve_time_ms, null),
    cell_count: cellCount,
    utility_count: utilCount,
    total_load_cells: qCells,
    total_load_utilities: qUtils,
    external_power_saved: externalSaved,
  };
};

/**
 * Сформировать человекочитаемые строки статистики для вкладки «Описание».
 *
 * @param {ReturnType<typeof computeSolutionStats>} stats
 * @returns {string[]}
 */
export const formatStatsForDescription = (stats) => {
  if (!stats || typeof stats !== "object") return [];

  const lines = [];

  const humanizeAlgorithm = (algorithmUsed) => {
    const a = algorithmUsed ? String(algorithmUsed).trim() : "";
    if (!a) return null;

    // Поддержка новых идентификаторов: <base>_(zig|js)
    const m = a.match(/^(.*)_(zig|js)$/);
    const base = m ? m[1] : a;
    const provider = m ? m[2] : null;

    let baseLabel = null;
    if (base === "solve_greedy") baseLabel = "Жадный";
    else if (base === "solve_curves") baseLabel = "Эквивалентные кривые";
    else if (base === "solve_trivial") baseLabel = "Без теплообмена";

    if (!baseLabel) {
      // Фолбэк: показываем исходную строку.
      return a;
    }

    if (provider === "zig") return `${baseLabel} (Zig/WASM)`;
    if (provider === "js") return `${baseLabel} (JavaScript)`;
    return baseLabel;
  };

  const algoLabelRaw =
    stats.algorithm_label && String(stats.algorithm_label).trim().length > 0
      ? String(stats.algorithm_label).trim()
      : null;

  const algoLabel = algoLabelRaw ?? humanizeAlgorithm(stats.algorithm_used);

  const totalHot = toFiniteNumberOr(stats.total_load_hot, 0);
  const totalCold = toFiniteNumberOr(stats.total_load_cold, 0);
  const diff = toFiniteNumberOr(stats.load_diff, 0);

  const cells = Math.trunc(toFiniteNumberOr(stats.cell_count, 0));
  const utils = Math.trunc(toFiniteNumberOr(stats.utility_count, 0));

  const qCells = toFiniteNumberOr(stats.total_load_cells, 0);
  const qUtils = toFiniteNumberOr(stats.total_load_utilities, 0);

  const saved = toFiniteNumberOr(stats.external_power_saved, 0);

  // Важно: `Number(null) === 0`, поэтому нельзя прогонять null через toFiniteNumberOr,
  // иначе будет ложное "0 мс" даже когда время отсутствует.
  const solveTimeMsRaw =
    stats.solve_time_ms === null || stats.solve_time_ms === undefined
      ? NaN
      : toFiniteNumberOr(stats.solve_time_ms, NaN);

  const solveTimeMs =
    Number.isFinite(solveTimeMsRaw) && solveTimeMsRaw >= 0
      ? Math.round(solveTimeMsRaw)
      : null;

  lines.push(`Суммарная нагрузка горячих потоков: ${fmtNum(totalHot)} МВт.`);

  lines.push(`Суммарная нагрузка холодных потоков:  ${fmtNum(totalCold)} МВт.`);

  lines.push(`Разность нагрузок (холодные - горячие): ${fmtNum(diff)} МВт.`);

  lines.push(`Количество ячеек теплообмена: ${cells}.`);
  lines.push(`Количество утилит (нагревателей и холодильников): ${utils}.`);
  lines.push(`Суммарная нагрузка ячеек теплообмена: ${fmtNum(qCells)} МВт.`);
  lines.push(`Суммарная нагрузка утилит: ${fmtNum(qUtils)}.`);

  // Экономия внешней энергии: положительное значение — хорошо.
  lines.push(
    `Экономия внешней энергии относительно режима «Без теплообмена»: ${fmtNum(saved)} МВт.`,
  );

  if (algoLabel) lines.push(`Алгоритм: ${algoLabel}.`);

  // Требование: время синтеза выводим последней строкой (точность до мс).
  if (solveTimeMs !== null) lines.push(`Время синтеза: ${solveTimeMs} мс.`);

  return lines;
};
