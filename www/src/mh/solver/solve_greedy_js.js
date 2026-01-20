/**
 * solve_greedy (JavaScript) — жадный синтез теплообменной сети.
 *
 * Это порт алгоритма `solve_greedy` из `multiheat/cli/multiheat.zig`.
 *
 * Цель:
 * - повторить логику Zig максимально близко (выбор пар, постановка утилит, обновление температурных состояний),
 * - но в «идиоматическом» JS: без микро-оптимизаций под скорость Zig/WASM.
 *
 * Важно:
 * - вход: каноническое состояние UI ({ hot, cold, exchanger? })
 * - выход: список `exchanger` в каноническом формате ({ hot|null, cold|null, load })
 * - алгоритм НЕ мутирует исходный state (работает на своих локальных состояниях потоков)
 */

/** Малое число, как в Zig (`eps: f32 = 1e-6`) */
const EPS = 1e-6;

/**
 * @typedef {object} StreamState
 * @property {"hot"|"cold"} side
 * @property {number} index
 * @property {boolean} isothermal
 * @property {number} temp     текущая температура (K)
 * @property {number} target   целевая температура (K)
 * @property {number} rate     МВт/К; 0 для изотермических
 * @property {number} rem      остаточная нагрузка, МВт
 */

/**
 * @typedef {{hot:number|null,cold:number|null,load:number}} Exchanger
 */

/**
 * Вычислить `rate` и требуемую нагрузку потока в семантике, близкой к Zig/interop:
 * - изотермический: req = load, rate = 0
 * - неизотермический:
 *   - если задан rate: req = rate * |out-in|
 *   - иначе: rate = load / |out-in|, req = load
 *
 * @param {any} s
 * @returns {{ isothermal: boolean, inT: number, outT: number, rate: number, req: number }}
 */
const streamProps = (s) => {
  if (!s || typeof s !== "object") {
    return { isothermal: true, inT: 0, outT: 0, rate: 0, req: 0 };
  }

  const inT = Number(s.in);
  const hasOut = s.out !== undefined && s.out !== null;
  const outT = hasOut ? Number(s.out) : inT;

  const isothermal = !hasOut || outT === inT;

  if (isothermal) {
    const req = Math.max(0, Number(s.load) || 0);
    return { isothermal: true, inT, outT, rate: 0, req };
  }

  const dt = Math.abs(outT - inT);
  if (!(dt > 0)) return { isothermal: false, inT, outT, rate: 0, req: 0 };

  if (s.rate !== undefined && s.rate !== null) {
    const rate = Math.max(0, Number(s.rate) || 0);
    return { isothermal: false, inT, outT, rate, req: rate * dt };
  }

  const load = Math.max(0, Number(s.load) || 0);
  const rate = load / dt;
  return { isothermal: false, inT, outT, rate, req: load };
};

const min3 = (a, b, c) => Math.min(a, Math.min(b, c));

/**
 * maxTransferable — порт `maxTransferable()` из Zig.
 *
 * Возвращает максимальную нагрузку, которую можно передать между текущими состояниями потоков
 * при заданном минимальном температурном напоре dtMin.
 *
 * Возвращает null при несовместимости (как Zig ?f32).
 *
 * @param {StreamState} hot
 * @param {StreamState} cold
 * @param {number} dtMin
 * @returns {number|null}
 */
const maxTransferable = (hot, cold, dtMin) => {
  const d0 = hot.temp - cold.temp;
  if (d0 < dtMin - EPS) return null;

  if (!hot.isothermal && !cold.isothermal) {
    const slope = 1.0 / hot.rate + 1.0 / cold.rate;
    if (slope <= EPS) return null;

    const qDt = (d0 - dtMin) / slope;
    if (!(qDt > 0)) return null;

    const qHotTarget =
      hot.temp > hot.target ? (hot.temp - hot.target) * hot.rate : 0.0;

    const qColdTarget =
      cold.target > cold.temp ? (cold.target - cold.temp) * cold.rate : 0.0;

    return Math.min(
      qDt,
      min3(qHotTarget, qColdTarget, Number.POSITIVE_INFINITY),
    );
  }

  if (hot.isothermal && !cold.isothermal) {
    const qDt = (d0 - dtMin) * cold.rate;

    const qColdTarget =
      cold.target > cold.temp ? (cold.target - cold.temp) * cold.rate : 0.0;

    const qLim = Math.min(qDt, qColdTarget);
    return qLim <= 0 ? null : qLim;
  }

  if (!hot.isothermal && cold.isothermal) {
    const qDt = (d0 - dtMin) * hot.rate;

    const qHotTarget =
      hot.temp > hot.target ? (hot.temp - hot.target) * hot.rate : 0.0;

    const qLim = Math.min(qDt, qHotTarget);
    return qLim <= 0 ? null : qLim;
  }

  // Оба потока изотермические: единственное ограничение — dt_min
  return d0 < dtMin - EPS ? null : Number.POSITIVE_INFINITY;
};

/**
 * solveGreedyJs(state, opts) → список `exchanger` (канонический формат).
 *
 * Порт Zig-алгоритма:
 * - выбираем cold с максимальной temp среди cold, у которых есть совместимый hot
 * - выбираем hot с минимальной temp среди совместимых hot
 * - передаём q_hex, обновляем temp/rem
 * - если совместимой пары нет — ставим утилиты (нагреватель на cold)
 * - в конце добавляем минимальное число утилит для остаточных дисбалансов:
 *   - один холодильник на hot с максимальным остатком
 *   - один нагреватель на cold с максимальным остатком
 *
 * @param {any} state Каноническое состояние ({hot, cold})
 * @param {{ min_dt?: number }} [opts]
 * @returns {Exchanger[]}
 */
export const solveGreedyJs = (state, opts = {}) => {
  const dtMin = Number.isFinite(opts.min_dt) ? Number(opts.min_dt) : 20;

  const hot = Array.isArray(state?.hot) ? state.hot : [];
  const cold = Array.isArray(state?.cold) ? state.cold : [];

  /** @type {StreamState[]} */
  const hotStates = hot.map((s, i) => {
    const p = streamProps(s);
    return {
      side: "hot",
      index: i,
      isothermal: p.isothermal,
      temp: p.inT,
      target: p.outT,
      rate: p.isothermal ? 0.0 : p.rate,
      rem: p.req,
    };
  });

  /** @type {StreamState[]} */
  const coldStates = cold.map((s, i) => {
    const p = streamProps(s);
    return {
      side: "cold",
      index: i,
      isothermal: p.isothermal,
      temp: p.inT,
      target: p.outT,
      rate: p.isothermal ? 0.0 : p.rate,
      rem: p.req,
    };
  });

  /** @type {Exchanger[]} */
  const exchangers = [];

  // --- Основной цикл (как в Zig) ---
  while (true) {
    /** @type {number|null} */
    let coldIdx = null;
    let coldBestTemp = -Number.POSITIVE_INFINITY;

    // 1) выбрать cold (самый «горячий» по текущей temp), у которого есть совместимый hot
    for (let i = 0; i < coldStates.length; i++) {
      const c = coldStates[i];
      if (!(c.rem > EPS)) continue;

      let hasHot = false;

      for (let j = 0; j < hotStates.length; j++) {
        const h = hotStates[j];
        if (!(h.rem > EPS)) continue;
        if (h.temp - c.temp < dtMin - EPS) continue;

        const qOpt = maxTransferable(h, c, dtMin);
        if (qOpt !== null && qOpt > EPS) {
          hasHot = true;
          break;
        }
      }

      if (!hasHot) continue;

      if (c.temp > coldBestTemp) {
        coldBestTemp = c.temp;
        coldIdx = i;
      }
    }

    // 2) если ни один cold не имеет совместимого hot — ставим нагреватель на «самый горячий» cold с остатком
    if (coldIdx === null) {
      /** @type {number|null} */
      let worstIdx = null;
      let worstTemp = -Number.POSITIVE_INFINITY;

      for (let i = 0; i < coldStates.length; i++) {
        const c = coldStates[i];
        if (!(c.rem > EPS)) continue;

        if (c.temp > worstTemp) {
          worstTemp = c.temp;
          worstIdx = i;
        }
      }

      if (worstIdx !== null) {
        exchangers.push({
          hot: null,
          cold: coldStates[worstIdx].index,
          load: coldStates[worstIdx].rem,
        });
        coldStates[worstIdx].rem = 0.0;
        continue;
      }

      // все cold удовлетворены
      break;
    }

    const cstate = coldStates[coldIdx];

    // 3) выбрать hot (самый «холодный» по temp среди совместимых)
    /** @type {number|null} */
    let hotIdx = null;
    let hotBestTemp = Number.POSITIVE_INFINITY;

    for (let i = 0; i < hotStates.length; i++) {
      const h = hotStates[i];
      if (!(h.rem > EPS)) continue;
      if (h.temp - cstate.temp < dtMin - EPS) continue;

      const qOpt = maxTransferable(h, cstate, dtMin);
      if (qOpt === null || !(qOpt > EPS)) continue;

      if (h.temp < hotBestTemp) {
        hotBestTemp = h.temp;
        hotIdx = i;
      }
    }

    // 4) если совместимого hot нет — остаток cold покрываем нагревателем
    if (hotIdx === null) {
      exchangers.push({ hot: null, cold: cstate.index, load: cstate.rem });
      coldStates[coldIdx].rem = 0.0;
      continue;
    }

    const hstate = hotStates[hotIdx];

    // 5) получить q_limit, затем q_hex = min(q_limit, h.rem, c.rem)
    const qLimit = maxTransferable(hstate, cstate, dtMin);
    if (qLimit === null) {
      exchangers.push({ hot: null, cold: cstate.index, load: cstate.rem });
      coldStates[coldIdx].rem = 0.0;
      continue;
    }

    let qHex = qLimit;
    qHex = Math.min(qHex, hstate.rem);
    qHex = Math.min(qHex, cstate.rem);

    if (!(qHex > EPS)) {
      exchangers.push({ hot: null, cold: cstate.index, load: cstate.rem });
      coldStates[coldIdx].rem = 0.0;
      continue;
    }

    // 6) зафиксировать ячейку теплообмена
    exchangers.push({ hot: hstate.index, cold: cstate.index, load: qHex });

    // 7) обновить состояния температур и остатков
    if (!hotStates[hotIdx].isothermal && hotStates[hotIdx].rate > EPS) {
      hotStates[hotIdx].temp -= qHex / hotStates[hotIdx].rate;
    }
    if (!coldStates[coldIdx].isothermal && coldStates[coldIdx].rate > EPS) {
      coldStates[coldIdx].temp += qHex / coldStates[coldIdx].rate;
    }

    hotStates[hotIdx].rem -= qHex;
    coldStates[coldIdx].rem -= qHex;
  }

  // --- Финальные утилиты (как в Zig) ---
  let residualHot = 0.0;
  for (const h of hotStates) residualHot += h.rem;

  let residualCold = 0.0;
  for (const c of coldStates) residualCold += c.rem;

  if (residualHot > EPS) {
    let bestIdx = null;
    let bestRem = 0.0;

    for (const h of hotStates) {
      if (h.rem > bestRem) {
        bestRem = h.rem;
        bestIdx = h.index;
      }
    }

    if (bestIdx !== null) {
      exchangers.push({ hot: bestIdx, cold: null, load: residualHot });
    }
  }

  if (residualCold > EPS) {
    let bestIdx = null;
    let bestRem = 0.0;

    for (const c of coldStates) {
      if (c.rem > bestRem) {
        bestRem = c.rem;
        bestIdx = c.index;
      }
    }

    if (bestIdx !== null) {
      exchangers.push({ hot: null, cold: bestIdx, load: residualCold });
    }
  }

  return exchangers;
};

export default solveGreedyJs;
