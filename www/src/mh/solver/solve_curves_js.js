/**
 * solve_curves (JavaScript) — синтез через эквивалентную двухпоточную модель и тепловой каскад.
 *
 * Это порт `solve_curves` из `multiheat/cli/multiheat.zig`.
 *
 * Основная идея (как в Zig):
 * 1) строим общий температурный каркас по "сдвинутым" температурам:
 *    cold-сторона сдвигается вверх на ΔTmin (dt_min), чтобы реализуемость выполнялась автоматически;
 * 2) делаем heat cascade по интервалам, чтобы найти минимально необходимый внешний нагрев (HU);
 * 3) выполняем детерминированное распределение тепла:
 *    на каждом интервале сверху вниз:
 *    - накапливаем доступное тепло hot-потоков,
 *    - покрываем спрос cold-потоков за счёт накопленного остатка,
 *    - дефицит покрываем из ограниченного пула HU (минимальные утилиты);
 * 4) остаток тепла hot после каскада отправляем на охлаждение (CU);
 * 5) компактизируем решение: суммируем одинаковые пары (hot_end, cold_end).
 *
 * Важно:
 * - вход: каноническое состояние UI ({ hot, cold })
 * - выход: список exchanger в каноническом формате ({ hot|null, cold|null, load })
 * - алгоритм НЕ мутирует исходный state
 *
 * Замечание про “идиоматический JS”:
 * - реализация намеренно повторяет структуру и ветвления Zig (без попыток “ускорить любой ценой”)
 * - используется Number (double), поэтому результаты могут отличаться от Zig/WASM (f32) на границах eps
 */

/** Малое число, как в Zig (`eps: f32 = 1e-6`) */
const EPS = 1e-6;

/** Порог для "это уже явно проблема каскада/входа" как в Zig: `if (d > 1e-4) return Error.Infeasible;` */
const INFEASIBLE_EPS = 1e-4;

/**
 * @typedef {{hot:number|null, cold:number|null, load:number}} Exchanger
 */

/**
 * Проверка “изотермичности” в канонической модели:
 * - out отсутствует или равен in (последнее возможно, если вход был задан так пользователем)
 *
 * @param {any} s
 */
const isIsothermal = (s) => {
  if (!s || typeof s !== "object") return true;
  if (s.out === undefined || s.out === null) return true;
  return Number(s.out) === Number(s.in);
};

/**
 * Получить “свойства” потока в семантике, совместимой с Zig/interop:
 * - isothermal: rate=0, req=load, temp=in, target=out(==in)
 * - non-isothermal:
 *   - если задан rate: req = rate*|out-in|
 *   - иначе: rate = load/|out-in|, req = load
 *
 * @param {any} s
 * @returns {{ isothermal: boolean, inT: number, outT: number, rate: number, load: number, req: number }}
 */
const streamProps = (s) => {
  const inT = Number(s?.in);
  const outT =
    s && typeof s === "object" && s.out !== undefined && s.out !== null
      ? Number(s.out)
      : inT;

  const iso = isIsothermal(s);
  const load = Math.max(0, Number(s?.load) || 0);

  if (iso) {
    return { isothermal: true, inT, outT: inT, rate: 0, load, req: load };
  }

  const dt = Math.abs(outT - inT);
  if (!(dt > 0)) {
    // Некорректный поток — считаем, что нагрузки нет.
    return { isothermal: false, inT, outT, rate: 0, load, req: 0 };
  }

  if (s.rate !== undefined && s.rate !== null) {
    const rate = Math.max(0, Number(s.rate) || 0);
    return { isothermal: false, inT, outT, rate, load, req: rate * dt };
  }

  // В canonical допускается {in,out,load}; rate восстанавливаем так же, как в buildZigSystem.
  const rate = load / dt;
  return { isothermal: false, inT, outT, rate, load, req: load };
};

/**
 * Перекрытие длины температурного интервала между отрезком [a0,a1] и интервалом [lo,hi].
 * Порт `Local.overlapDeltaT` из Zig.
 *
 * @param {number} a0
 * @param {number} a1
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
const overlapDeltaT = (a0, a1, lo, hi) => {
  const aLo = Math.min(a0, a1);
  const aHi = Math.max(a0, a1);
  const x0 = Math.max(aLo, lo);
  const x1 = Math.min(aHi, hi);
  return x1 > x0 ? x1 - x0 : 0.0;
};

/**
 * Сортировка по убыванию (как `lessF32Desc`).
 * @param {number} a
 * @param {number} b
 */
const desc = (a, b) => (a > b ? -1 : a < b ? 1 : 0);

/**
 * Удаление “почти-дубликатов” по eps (как в Zig).
 * Важно: вход должен быть уже отсортирован в нужном порядке.
 *
 * @param {number[]} xs
 * @param {number} eps
 * @returns {number[]}
 */
const uniqByEps = (xs, eps) => {
  /** @type {number[]} */
  const out = [];
  let prev = null;

  for (const t of xs) {
    if (prev === null || Math.abs(t - prev) > eps) {
      out.push(t);
      prev = t;
    }
  }
  return out;
};

/**
 * Вычислить суммы hot/cold на температурном интервале для heat cascade.
 *
 * Важно: расчёт ведётся в общей "сдвинутой" шкале:
 * - hot: как есть
 * - cold: t + dtMin
 *
 * @param {any[]} hotStreams
 * @param {any[]} coldStreams
 * @param {number} dtMin
 * @param {number} tHi
 * @param {number} tLo
 * @returns {{hotSum:number, coldSum:number}}
 */
const sumsOnInterval = (hotStreams, coldStreams, dtMin, tHi, tLo) => {
  let hotSum = 0.0;
  let coldSum = 0.0;

  // Горячие: изотермы на границе tHi + неизотермические вклады на [tLo, tHi]
  for (let i = 0; i < hotStreams.length; i++) {
    const s = hotStreams[i];
    const p = streamProps(s);

    if (p.isothermal) {
      if (Math.abs(p.inT - tHi) <= EPS && p.load > EPS) hotSum += p.load;
    } else {
      const dT = overlapDeltaT(p.inT, p.outT, tLo, tHi);
      if (dT > EPS) hotSum += p.rate * dT;
    }
  }

  // Холодные: изотермы на границе tHi (в сдвинутой шкале) + неизотермические вклады на [tLo, tHi]
  for (let j = 0; j < coldStreams.length; j++) {
    const s = coldStreams[j];
    const p = streamProps(s);

    if (p.isothermal) {
      const tShift = p.inT + dtMin;
      if (Math.abs(tShift - tHi) <= EPS && p.load > EPS) coldSum += p.load;
    } else {
      const inS = p.inT + dtMin;
      const outS = p.outT + dtMin;
      const dT = overlapDeltaT(inS, outS, tLo, tHi);
      if (dT > EPS) coldSum += p.rate * dT;
    }
  }

  return { hotSum, coldSum };
};

/**
 * Компактизация решения: суммируем одинаковые пары (hot, cold),
 * чтобы уменьшить число элементов, как делает Zig после сортировки.
 *
 * @param {Exchanger[]} exchangers
 * @returns {Exchanger[]}
 */
const compactExchangers = (exchangers) => {
  const keyOpt = (v) => (v === null || v === undefined ? 0xffff : v);

  const sorted = exchangers
    .filter((ex) => ex && typeof ex === "object" && Number(ex.load) > EPS)
    .slice()
    .sort((a, b) => {
      const ah = keyOpt(a.hot);
      const bh = keyOpt(b.hot);
      if (ah !== bh) return ah - bh;

      const ac = keyOpt(a.cold);
      const bc = keyOpt(b.cold);
      return ac - bc;
    });

  /** @type {Exchanger[]} */
  const out = [];

  for (const ex of sorted) {
    if (out.length === 0) {
      out.push({ hot: ex.hot ?? null, cold: ex.cold ?? null, load: Number(ex.load) });
      continue;
    }

    const last = out[out.length - 1];
    const same =
      keyOpt(last.hot) === keyOpt(ex.hot) && keyOpt(last.cold) === keyOpt(ex.cold);

    if (same) {
      last.load += Number(ex.load);
    } else {
      out.push({ hot: ex.hot ?? null, cold: ex.cold ?? null, load: Number(ex.load) });
    }
  }

  // Уберём нулевые/отрицательные после суммирования (на всякий случай)
  return out.filter((ex) => ex.load > EPS);
};

/**
 * solveCurvesJs(state, opts) → список exchanger (канонический формат).
 *
 * @param {any} state
 * @param {{ min_dt?: number }} [opts]
 * @returns {Exchanger[]}
 */
export const solveCurvesJs = (state, opts = {}) => {
  const dtMin = Number.isFinite(opts.min_dt) ? Number(opts.min_dt) : 20;

  const hotStreams = Array.isArray(state?.hot) ? state.hot : [];
  const coldStreams = Array.isArray(state?.cold) ? state.cold : [];

  const hotCount = hotStreams.length;
  const coldCount = coldStreams.length;

  // Базовая валидация (по смыслу Zig):
  // - для неизотермических потоков rate должен быть > 0
  // - для изотерм load должен быть >= 0 (в канонике он неотрицателен)
  for (const s of hotStreams) {
    const p = streamProps(s);
    if (!p.isothermal && !(p.rate > 0)) throw new Error("Infeasible");
    if (p.isothermal && !(p.load >= 0)) throw new Error("Infeasible");
  }
  for (const s of coldStreams) {
    const p = streamProps(s);
    if (!p.isothermal && !(p.rate > 0)) throw new Error("Infeasible");
    if (p.isothermal && !(p.load >= 0)) throw new Error("Infeasible");
  }

  // 1) Собираем температурные точки (единая шкала):
  //    - hot: как есть
  //    - cold: +dtMin
  /** @type {number[]} */
  const temps = [];

  for (const s of hotStreams) {
    const p = streamProps(s);
    temps.push(p.inT, p.outT);
  }
  for (const s of coldStreams) {
    const p = streamProps(s);
    temps.push(p.inT + dtMin, p.outT + dtMin);
  }

  if (temps.length === 0) return [];

  temps.sort(desc);
  const uniq = uniqByEps(temps, EPS);

  if (uniq.length < 2) return [];

  // 2) Heat cascade по интервалам: находим минимально необходимый внешний нагрев (HU).
  let huTotal = 0.0;
  let cascade = 0.0;

  for (let k = 0; k + 1 < uniq.length; k++) {
    const tHi = uniq[k];
    const tLo = uniq[k + 1];
    if (!(tHi > tLo + EPS)) continue;

    const { hotSum, coldSum } = sumsOnInterval(
      hotStreams,
      coldStreams,
      dtMin,
      tHi,
      tLo,
    );

    cascade += hotSum - coldSum;
    if (cascade < -EPS) {
      huTotal += -cascade;
      cascade = 0.0;
    }
  }

  // Доп. обработка изотерм на минимальной границе (t_last_cascade).
  const tLastCascade = uniq[uniq.length - 1];
  let hotTail = 0.0;
  let coldTail = 0.0;

  for (const s of hotStreams) {
    const p = streamProps(s);
    if (p.isothermal && Math.abs(p.inT - tLastCascade) <= EPS && p.load > EPS) {
      hotTail += p.load;
    }
  }
  for (const s of coldStreams) {
    const p = streamProps(s);
    if (p.isothermal) {
      const tShift = p.inT + dtMin;
      if (Math.abs(tShift - tLastCascade) <= EPS && p.load > EPS) {
        coldTail += p.load;
      }
    }
  }

  cascade += hotTail - coldTail;
  if (cascade < -EPS) {
    huTotal += -cascade;
    cascade = 0.0;
  }

  let huRemaining = huTotal;

  // 3) Массивы накопления.
  /** @type {number[]} */
  const hotAvail = new Array(hotCount).fill(0.0);

  /** @type {number[]} */
  const heaterLoad = new Array(coldCount).fill(0.0);

  /** @type {number[]} */
  const coolerLoad = new Array(hotCount).fill(0.0);

  /** @type {Exchanger[]} */
  const exchangers = [];

  // 4) Основной проход по температурным интервалам сверху вниз.
  for (let k = 0; k + 1 < uniq.length; k++) {
    const tHi = uniq[k];
    const tLo = uniq[k + 1];
    if (!(tHi > tLo + EPS)) continue;

    // 4.1) Добавляем доступное тепло горячих потоков в этом интервале.
    for (let i = 0; i < hotCount; i++) {
      const s = hotStreams[i];
      const p = streamProps(s);

      if (p.isothermal) {
        if (Math.abs(p.inT - tHi) <= EPS && p.load > EPS) {
          hotAvail[i] += p.load;
        }
      }
    }
    for (let i = 0; i < hotCount; i++) {
      const s = hotStreams[i];
      const p = streamProps(s);

      if (!p.isothermal) {
        const dT = overlapDeltaT(p.inT, p.outT, tLo, tHi);
        if (dT > EPS) hotAvail[i] += p.rate * dT;
      }
    }

    // 4.2) Спрос холодных потоков на этом интервале (в сдвинутой шкале).
    /** @type {number[]} */
    const coldDemand = new Array(coldCount).fill(0.0);

    for (let j = 0; j < coldCount; j++) {
      const s = coldStreams[j];
      const p = streamProps(s);

      if (p.isothermal) {
        const tShift = p.inT + dtMin;
        if (Math.abs(tShift - tHi) <= EPS && p.load > EPS) {
          coldDemand[j] += p.load;
        }
      }
    }
    for (let j = 0; j < coldCount; j++) {
      const s = coldStreams[j];
      const p = streamProps(s);

      if (!p.isothermal) {
        const inS = p.inT + dtMin;
        const outS = p.outT + dtMin;
        const dT = overlapDeltaT(inS, outS, tLo, tHi);
        if (dT > EPS) coldDemand[j] += p.rate * dT;
      }
    }

    // 4.3) Распределение тепла (детерминированно): покрываем спрос из hotAvail.
    // Важно: hotPtr сбрасываем на каждом интервале, как в Zig.
    let hotPtr = 0;

    for (let j = 0; j < coldCount; j++) {
      let d = coldDemand[j];
      if (!(d > EPS)) continue;

      while (d > EPS) {
        while (hotPtr < hotCount && !(hotAvail[hotPtr] > EPS)) hotPtr += 1;
        if (hotPtr >= hotCount) break;

        const q = Math.min(d, hotAvail[hotPtr]);
        if (!(q > EPS)) break;

        exchangers.push({ hot: hotPtr, cold: j, load: q });

        hotAvail[hotPtr] -= q;
        d -= q;
      }

      if (d > EPS) {
        // Дефицит: покрываем HU из ограниченного пула huRemaining.
        const qHu = Math.min(d, huRemaining);
        if (qHu > EPS) {
          heaterLoad[j] += qHu;
          huRemaining -= qHu;
          d -= qHu;
        }

        if (d > INFEASIBLE_EPS) {
          // Как в Zig: значит каскад/вход не согласованы.
          throw new Error("Infeasible");
        }
      }
    }
  }

  // 4.4) Учёт изотерм на минимальной температурной границе t_last.
  const tLast = uniq[uniq.length - 1];

  // Добавляем изотермические горячие нагрузки на t_last.
  for (let i = 0; i < hotCount; i++) {
    const s = hotStreams[i];
    const p = streamProps(s);

    if (p.isothermal && Math.abs(p.inT - tLast) <= EPS && p.load > EPS) {
      hotAvail[i] += p.load;
    }
  }

  // Закрываем возможные изотермические cold на t_last (в сдвинутой шкале).
  /** @type {number[]} */
  const coldTailDemand = new Array(coldCount).fill(0.0);
  for (let j = 0; j < coldCount; j++) {
    const s = coldStreams[j];
    const p = streamProps(s);

    if (p.isothermal) {
      const tShift = p.inT + dtMin;
      if (Math.abs(tShift - tLast) <= EPS && p.load > EPS) {
        coldTailDemand[j] += p.load;
      }
    }
  }

  let hotPtrTail = 0;
  for (let j = 0; j < coldCount; j++) {
    let d = coldTailDemand[j];
    if (!(d > EPS)) continue;

    while (d > EPS) {
      while (hotPtrTail < hotCount && !(hotAvail[hotPtrTail] > EPS)) hotPtrTail += 1;
      if (hotPtrTail >= hotCount) break;

      const q = Math.min(d, hotAvail[hotPtrTail]);
      if (!(q > EPS)) break;

      exchangers.push({ hot: hotPtrTail, cold: j, load: q });

      hotAvail[hotPtrTail] -= q;
      d -= q;
    }

    if (d > EPS) {
      const qHu = Math.min(d, huRemaining);
      if (qHu > EPS) {
        heaterLoad[j] += qHu;
        huRemaining -= qHu;
        d -= qHu;
      }
      if (d > INFEASIBLE_EPS) throw new Error("Infeasible");
    }
  }

  // 4.5) Остаток горячего тепла — в охлаждение (CU).
  for (let i = 0; i < hotCount; i++) {
    const qLeft = hotAvail[i];
    if (qLeft > EPS) coolerLoad[i] += qLeft;
  }

  // 5) Добавляем утилиты (по одному устройству на поток, чтобы не раздувать решение).
  for (let j = 0; j < coldCount; j++) {
    const q = heaterLoad[j];
    if (q > EPS) exchangers.push({ hot: null, cold: j, load: q });
  }
  for (let i = 0; i < hotCount; i++) {
    const q = coolerLoad[i];
    if (q > EPS) exchangers.push({ hot: i, cold: null, load: q });
  }

  // 6) Компактизация (как в Zig).
  return compactExchangers(exchangers);
};

export default solveCurvesJs;
