import { toErrorText } from "../util/errors.js";

/**
 * `describeZigError(e)` → краткое сообщение для интерфейса по тексту ошибки из Zig.
 *
 * @param {unknown} e
 * @returns {string}
 */
export const describeZigError = (e) => {
  const msg = toErrorText(e);
  const s = msg.toLowerCase();
  if (s.includes("unbalanced")) return "Решение несбалансировано.";
  if (s.includes("infeasible")) return "Задача неразрешима.";
  if (s.includes("nocompatiblepair"))
    return "Не найдена совместимая пара потоков.";
  return "Подробности в консоли браузера.";
};

/**
 * `buildZigSystem(multiheat, state, includeExchangers)` → объект `HeatSystem` для вызова `solve/verifySolution`.
 *
 * @param {any} multiheat Импортированный zigar-модуль (`../zig/multiheat_entry.zig`)
 * @param {any} state Каноническое состояние ({ hot, cold, exchanger })
 * @param {boolean} includeExchangers Включать ли `state.exchanger` в `system.exchangers`
 * @returns {any} Экземпляр `HeatSystem`
 */
export const buildZigSystem = (multiheat, state, includeExchangers) => {
  const HeatStream = multiheat.HeatStream;
  const HeatSystem = multiheat.HeatSystem;
  const HeatExchanger = multiheat.HeatExchanger;

  const toZigStream = (s) => {
    if (s.out === undefined) {
      return new HeatStream({
        isothermal: true,
        in_temp_K: Number(s.in),
        out_temp_K: Number(s.in),
        rate_MW_per_K: 0.0,
        load_MW: Number(s.load),
      });
    }

    const inT = Number(s.in);
    const outT = Number(s.out);
    const dt = Math.abs(outT - inT);

    if (s.rate !== undefined) {
      return new HeatStream({
        isothermal: false,
        in_temp_K: inT,
        out_temp_K: outT,
        rate_MW_per_K: Number(s.rate),
        load_MW: Number(s.rate) * dt,
      });
    }

    return new HeatStream({
      isothermal: false,
      in_temp_K: inT,
      out_temp_K: outT,
      rate_MW_per_K: Number(s.load) / dt,
      load_MW: Number(s.load),
    });
  };

  const toZigEx = (ex) =>
    new HeatExchanger({
      hot_end: ex.hot === null ? null : Number(ex.hot),
      cold_end: ex.cold === null ? null : Number(ex.cold),
      load_MW: Number(ex.load),
    });

  const hotStreams = state.hot.map(toZigStream);
  const coldStreams = state.cold.map(toZigStream);

  const exchangers =
    includeExchangers && Array.isArray(state.exchanger)
      ? state.exchanger.map(toZigEx)
      : [];

  return new HeatSystem({
    min_dt: 20,
    def_dt: 30,
    hot_streams: hotStreams,
    cold_streams: coldStreams,
    exchangers,
  });
};

/**
 * `getOptionalValue(v)` → значение optional-поля из zigar (или `null`).
 *
 * @param {any} v
 * @returns {any}
 */
export const getOptionalValue = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v && "value" in v) return v.value;
  return v;
};

/**
 * `dumpExchangersFromZig(xs)` → массив теплообменников из `system.exchangers`.
 * Поддерживает массивы, итерируемые объекты, array-like и одиночный объект.
 *
 * @param {any} xs
 * @returns {any[]}
 */
export const dumpExchangersFromZig = (xs) => {
  if (xs === null || xs === undefined) return [];
  if (Array.isArray(xs)) return xs.map((ex) => ex);

  const obj = Object(xs);
  if (typeof obj[Symbol.iterator] === "function") return Array.from(xs);

  if (typeof obj.length === "number") {
    const out = [];
    for (let i = 0; i < obj.length; i++)
      out.push(obj[i] ?? obj.at?.(i) ?? obj.get?.(i));
    return out;
  }

  return [xs];
};

/**
 * `zigExchangersToState(zigExList)` → список `exchanger` в формате канонического состояния.
 *
 * @param {any[]} zigExList
 * @returns {{hot: number|null, cold: number|null, load: number}[]}
 */
export const zigExchangersToState = (zigExList) =>
  zigExList.map((ex) => ({
    hot: getOptionalValue(ex.hot_end),
    cold: getOptionalValue(ex.cold_end),
    load: Number(ex.load_MW),
  }));
