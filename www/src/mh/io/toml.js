import toml from "toml";

import { logError } from "../util/errors.js";
import { fmtNum } from "../util/number.js";
import { defaultState, validateAndNormalizeState } from "../model/state.js";

/**
 * Parse TOML text into canonical normalized state.
 * Behavior is intentionally identical to the previous monolithic implementation.
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

  return validateAndNormalizeState({
    multiheat: cfg.multiheat,
    hot: cfg.hot,
    cold: cfg.cold,
    exchanger: cfg.exchanger,
  });
};

/**
 * Emit canonical state to TOML text.
 * Behavior is intentionally identical to the previous monolithic implementation.
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
      if (ex.hot !== null && ex.hot !== undefined) lines.push(`hot = ${ex.hot}`);
      if (ex.cold !== null && ex.cold !== undefined)
        lines.push(`cold = ${ex.cold}`);
      lines.push(`load = ${fmtNum(ex.load)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
};
