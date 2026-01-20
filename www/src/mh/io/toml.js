import toml from "toml";

import { logError } from "../util/errors.js";
import { fmtNum } from "../util/number.js";
import { defaultState, validateAndNormalizeState } from "../model/state.js";

/**
 * Нормализовать секцию [stats] (если есть).
 *
 * Почему: [stats] не участвует в вычислениях, но должен сохраняться/отображаться.
 * Здесь мы лишь приводим типы и отбрасываем некорректные значения.
 *
 * @param {any} s
 * @returns {null | {
 *  total_load_hot?: number,
 *  total_load_cold?: number,
 *  load_diff?: number,
 *  algorithm_used?: string,
 *  cell_count?: number,
 *  utility_count?: number,
 *  total_load_cells?: number,
 *  total_load_utilities?: number,
 *  external_power_saved?: number,
 * }}
 */
const normalizeStats = (s) => {
  if (!s || typeof s !== "object") return null;

  /** @type {any} */
  const out = {};

  const setNum = (k) => {
    if (!(k in s)) return;
    const v = Number(s[k]);
    if (Number.isFinite(v)) out[k] = v;
  };

  const setInt = (k) => {
    if (!(k in s)) return;
    const v = Number(s[k]);
    if (Number.isFinite(v)) out[k] = Math.trunc(v);
  };

  const setStr = (k) => {
    if (!(k in s)) return;
    const v = s[k];
    if (typeof v === "string" && v.length > 0) out[k] = v;
  };

  setNum("total_load_hot");
  setNum("total_load_cold");
  setNum("load_diff");
  setStr("algorithm_used");
  setInt("cell_count");
  setInt("utility_count");
  setNum("total_load_cells");
  setNum("total_load_utilities");
  setNum("external_power_saved");

  return Object.keys(out).length > 0 ? out : null;
};

/**
 * `parseTomlToState(text)` → каноническое состояние (после `validateAndNormalizeState`).
 *
 * @param {string} text
 * @returns {ReturnType<typeof validateAndNormalizeState>}
 */
export const parseTomlToState = (text) => {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return defaultState();

  let cfg;
  try {
    cfg = toml.parse(trimmed);
  } catch (e) {
    logError("Ошибка разбора TOML", e);
    throw new Error("Ошибка разбора TOML. Подробности в консоли браузера.");
  }

  const base = validateAndNormalizeState({
    multiheat: cfg.multiheat,
    hot: cfg.hot,
    cold: cfg.cold,
    exchanger: cfg.exchanger,
  });

  const stats = normalizeStats(cfg.stats);
  return stats ? { ...base, stats } : base;
};

/**
 * `emitToml(state)` → TOML.
 *
 * @param {ReturnType<typeof validateAndNormalizeState>} state
 * @returns {string}
 */
export const emitToml = (state) => {
  const lines = [];

  lines.push("[multiheat]");
  lines.push(`version = "${state.multiheat.version}"`);
  lines.push(`temp_unit = "${state.multiheat.temp_unit}"`);
  lines.push("");

  // [stats] — сразу после [multiheat] (если присутствует).
  const st = state && typeof state === "object" ? state.stats : null;
  if (st && typeof st === "object" && Object.keys(st).length > 0) {
    lines.push("[stats]");

    // Фиксированный порядок полей — для стабильного вывода и удобства сравнения.
    if (st.total_load_hot !== undefined)
      lines.push(`total_load_hot = ${fmtNum(st.total_load_hot)}`);
    if (st.total_load_cold !== undefined)
      lines.push(`total_load_cold = ${fmtNum(st.total_load_cold)}`);
    if (st.load_diff !== undefined)
      lines.push(`load_diff = ${fmtNum(st.load_diff)}`);
    if (
      typeof st.algorithm_used === "string" &&
      st.algorithm_used.trim().length > 0
    )
      lines.push(`algorithm_used = "${st.algorithm_used.trim()}"`);
    if (st.cell_count !== undefined)
      lines.push(`cell_count = ${fmtNum(st.cell_count)}`);
    if (st.utility_count !== undefined)
      lines.push(`utility_count = ${fmtNum(st.utility_count)}`);
    if (st.total_load_cells !== undefined)
      lines.push(`total_load_cells = ${fmtNum(st.total_load_cells)}`);
    if (st.total_load_utilities !== undefined)
      lines.push(`total_load_utilities = ${fmtNum(st.total_load_utilities)}`);
    if (st.external_power_saved !== undefined)
      lines.push(`external_power_saved = ${fmtNum(st.external_power_saved)}`);

    lines.push("");
  }

  const emitStreamBlock = (section, s) => {
    lines.push(`[[${section}]]`);
    lines.push(`in = ${fmtNum(s.in)}`);
    if (s.out !== undefined) lines.push(`out = ${fmtNum(s.out)}`);
    if (s.rate !== undefined) lines.push(`rate = ${fmtNum(s.rate)}`);
    if (s.load !== undefined) lines.push(`load = ${fmtNum(s.load)}`);
    lines.push("");
  };

  for (const s of state.hot) emitStreamBlock("hot", s);
  for (const s of state.cold) emitStreamBlock("cold", s);

  if (Array.isArray(state.exchanger) && state.exchanger.length > 0) {
    for (const ex of state.exchanger) {
      lines.push("[[exchanger]]");
      if (ex.hot !== null && ex.hot !== undefined)
        lines.push(`hot = ${ex.hot}`);
      if (ex.cold !== null && ex.cold !== undefined)
        lines.push(`cold = ${ex.cold}`);
      lines.push(`load = ${fmtNum(ex.load)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
};
