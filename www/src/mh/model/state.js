// Нормализация и валидация канонического состояния (без избыточности).

import {
  isFiniteNonNegative,
  isFinitePositive,
  parseNumber,
} from "../util/number.js";

// --- Каноническое состояние (семантика, близкая к конфигурационному TOML) ---

/**
 * `defaultState()` → пустое каноническое состояние системы.
 * @returns {{ multiheat: { version: string, temp_unit: string }, hot: any[], cold: any[], exchanger: any[], stats: any|null }}
 */
export const defaultState = () => ({
  multiheat: { version: "0.0.1", temp_unit: "K" },
  hot: [],
  cold: [],
  exchanger: [],
  stats: null,
});

/**
 * `normalizeStream(s)` → каноническая запись потока.
 * @param {any} s
 * @returns {{ in: number, load: number } | { in: number, out: number, rate: number } | { in: number, out: number, load: number }}
 */
export const normalizeStream = (s) => {
  const inT = parseNumber(s.in, "in");
  if (!isFiniteNonNegative(inT)) throw new Error("Некорректное значение in.");

  const outRaw = s.out === undefined ? null : parseNumber(s.out, "out");
  if (outRaw !== null && !isFiniteNonNegative(outRaw))
    throw new Error("Некорректное значение out.");

  const rateRaw = s.rate === undefined ? null : parseNumber(s.rate, "rate");
  if (rateRaw !== null && !isFiniteNonNegative(rateRaw))
    throw new Error("Некорректное значение rate.");

  const loadRaw = s.load === undefined ? null : parseNumber(s.load, "load");
  if (loadRaw !== null && !isFiniteNonNegative(loadRaw))
    throw new Error("Некорректное значение load.");

  const outIsMissing = outRaw === null;
  const isIso = outIsMissing || outRaw === inT;

  if (isIso) {
    if (!isFinitePositive(loadRaw))
      throw new Error("Изотермический поток требует положительный load.");
    return { in: inT, load: loadRaw };
  }

  const outT = outRaw;
  const dt = Math.abs(outT - inT);
  if (!(dt > 0))
    throw new Error("Некорректная разность температур (out - in).");

  if (isFinitePositive(rateRaw)) return { in: inT, out: outT, rate: rateRaw };
  if (isFinitePositive(loadRaw)) return { in: inT, out: outT, load: loadRaw };

  throw new Error(
    "Необходимо указать rate или load для неизотермического потока.",
  );
};

/**
 * `normalizeExchanger(ex)` → каноническая запись теплообменника.
 * @param {any} ex
 * @returns {{ hot: number|null, cold: number|null, load: number }}
 */
export const normalizeExchanger = (ex) => {
  const hot =
    ex.hot === undefined ? null : parseNumber(ex.hot, "exchanger.hot");
  const cold =
    ex.cold === undefined ? null : parseNumber(ex.cold, "exchanger.cold");
  const load = parseNumber(ex.load, "exchanger.load");

  if (hot === null && cold === null)
    throw new Error("Теплообменник должен иметь hot или cold.");
  if (hot !== null && !Number.isInteger(hot))
    throw new Error("Некорректное значение exchanger.hot.");
  if (cold !== null && !Number.isInteger(cold))
    throw new Error("Некорректное значение exchanger.cold.");
  if (!isFinitePositive(load))
    throw new Error("Некорректное значение exchanger.load.");

  return { hot, cold, load };
};

/**
 * `validateAndNormalizeState(state)` → нормализованное каноническое состояние.
 * Выбрасывает исключение при некорректной структуре/значениях.
 * @param {any} state
 * @returns {{ multiheat: { version: string, temp_unit: string }, hot: any[], cold: any[], exchanger: any[] }}
 */
export const validateAndNormalizeState = (state) => {
  if (!state || typeof state !== "object")
    throw new Error("Некорректная структура данных.");

  if (!state.multiheat || typeof state.multiheat !== "object")
    throw new Error("Отсутствует секция [multiheat].");

  const version = state.multiheat.version;
  const tempUnit = state.multiheat.temp_unit;

  if (version !== "0.0.1")
    throw new Error(
      'Некорректное значение multiheat.version (ожидается "0.0.1").',
    );
  if (tempUnit !== "K")
    throw new Error(
      'Некорректное значение multiheat.temp_unit (ожидается "K").',
    );

  const hot = Array.isArray(state.hot) ? state.hot : [];
  const cold = Array.isArray(state.cold) ? state.cold : [];
  const exchanger = Array.isArray(state.exchanger) ? state.exchanger : [];

  const hotN = hot.map(normalizeStream);
  const coldN = cold.map(normalizeStream);
  const exN = exchanger.map(normalizeExchanger);

  const stats = state.stats;
  const statsN = stats && typeof stats === "object" ? stats : null;

  return {
    multiheat: { version: "0.0.1", temp_unit: "K" },
    hot: hotN,
    cold: coldN,
    exchanger: exN,
    stats: statsN,
  };
};
