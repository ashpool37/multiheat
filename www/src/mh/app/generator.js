/**
 * Контроллер генератора случайных систем для тестового режима.
 *
 * Требования (упрощённый генератор):
 * - параметры задаются отдельно для горячей и холодной стороны:
 *   - количество потоков
 *   - доля изотермических (0–100%)
 *   - распределение температур: равномерное (min/max) или нормальное (mean/variance)
 *   - распределение нагрузок: равномерное (min/max) или нормальное (mean/variance)
 * - кнопка «Сгенерировать»:
 *   - генерирует новую систему БЕЗ решения
 *   - перезаписывает текущую систему
 *   - если текущая система непустая, требуется confirm() (OK/Отмена)
 * - после генерации обновляются представления и визуализация, но только если не скрыты
 *
 * Важно:
 * - Этот модуль НЕ меняет вычислительное ядро.
 * - Он лишь формирует новое каноническое состояние store.state.
 * - UI-элементы должны быть добавлены в #testModeBlock (под селектором «Алгоритм»).
 *
 * Ожидаемые элементы UI (id):
 * - Кнопка:            #btnGenerate
 *
 * Для каждой стороны: prefix = "hot" | "cold"
 * - Кол-во потоков:    #genHotCount / #genColdCount
 * - Доля изотерм (%):  #genHotIsoShare / #genColdIsoShare
 *
 * - Распределение T:   #genHotTempDist / #genColdTempDist   ("uniform" | "normal")
 *   - uniform:         #genHotTempMin, #genHotTempMax
 *   - normal:          #genHotTempMean, #genHotTempVar      (дисперсия, K^2)
 *
 * - Распределение load:#genHotLoadDist / #genColdLoadDist   ("uniform" | "normal")
 *   - uniform:         #genHotLoadMin, #genHotLoadMax       (МВт)
 *   - normal:          #genHotLoadMean, #genHotLoadVar      (дисперсия, (МВт)^2)
 *
 * Примечание:
 * - Для неизотермических потоков мы генерируем {in, out, load}.
 *   Это совместимо с текущей канонической моделью (out+load => rate восстанавливается).
 * - Чтобы гарантировать “все горячие теплее всех холодных”, мы после генерации
 *   при необходимости сдвигаем все температуры hot вверх так, чтобы min(hot) >= max(cold) + ΔT_guard.
 */

import { validateAndNormalizeState } from "../model/state.js";

const DEFAULT_GUARD_DT_K = 20;
const DEFAULT_NONISO_DT_K = 30;

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

/** @param {any} v */
const toNumber = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};

/**
 * @param {any} v
 * @param {number} def
 */
const toIntOr = (v, def) => {
  const x = Math.trunc(toNumber(v));
  return Number.isFinite(x) ? x : def;
};

/**
 * @param {any} v
 * @param {number} def
 */
const toFloatOr = (v, def) => {
  const x = toNumber(v);
  return Number.isFinite(x) ? x : def;
};

/**
 * Обновить подпись `<output>` для range-слайдера “доля изотермических”.
 *
 * @param {HTMLInputElement|null} rangeEl
 * @param {HTMLOutputElement|null} outEl
 */
const syncIsoShareOutput = (rangeEl, outEl) => {
  if (!rangeEl || !outEl) return;
  const v = clamp(0, toFloatOr(rangeEl.value, 50), 100);
  outEl.textContent = `${Math.round(v)}%`;
};

/**
 * Показать/скрыть блоки параметров распределения по значению `<select>`.
 *
 * Разметка:
 * - блоки имеют `data-role="params"`, `data-for="<id select>"`, `data-mode="uniform|normal"`
 *
 * @param {ParentNode} root
 * @param {HTMLSelectElement|null} selectEl
 */
const applyDistParamsVisibility = (root, selectEl) => {
  if (!root || !selectEl) return;
  const id = selectEl.id;
  if (!id) return;

  const mode = String(selectEl.value ?? "").toLowerCase();
  const blocks = root.querySelectorAll(
    `[data-role="params"][data-for="${id}"]`,
  );

  for (const b of blocks) {
    const m = String(b.getAttribute("data-mode") ?? "").toLowerCase();
    b.hidden = m !== mode;
  }
};

/**
 * Простая нормальная выборка (Box–Muller).
 * @param {number} mean
 * @param {number} variance
 */
const sampleNormal = (mean, variance) => {
  const v = Math.max(0, Number(variance) || 0);
  const std = Math.sqrt(v);

  // Защита: при std=0 возвращаем mean.
  if (!(std > 0)) return Number(mean) || 0;

  // Box–Muller
  let u1 = 0;
  let u2 = 0;
  // Важно: u1 не должен быть 0.
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();

  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return (Number(mean) || 0) + z * std;
};

/**
 * @param {number} min
 * @param {number} max
 */
const sampleUniform = (min, max) => {
  const a = Number(min);
  const b = Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;

  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  if (!(hi > lo)) return lo;
  return lo + Math.random() * (hi - lo);
};

/**
 * Сгенерировать массив булевых значений с заданной долей true.
 * Доля поддерживается точно (по округлению), затем перемешивается.
 *
 * @param {number} n
 * @param {number} sharePct 0..100
 */
const makeIsoMask = (n, sharePct) => {
  const N = Math.max(0, Math.trunc(n));
  const p = clamp(0, Number(sharePct) || 0, 100) / 100;
  const isoCount = Math.round(N * p);

  const mask = new Array(N);
  for (let i = 0; i < N; i++) mask[i] = i < isoCount;

  // Fisher–Yates shuffle
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = mask[i];
    mask[i] = mask[j];
    mask[j] = t;
  }

  return mask;
};

/**
 * Прочитать параметры генерации для одной стороны из UI.
 *
 * @param {HTMLElement} root
 * @param {"hot"|"cold"} side
 */
const readSideParams = (root, side) => {
  const cap = side === "hot" ? "Hot" : "Cold";
  const q = (id) => root.querySelector(id);

  const countEl = q(`#gen${cap}Count`);
  const isoEl = q(`#gen${cap}IsoShare`);

  const tempDistEl = q(`#gen${cap}TempDist`);
  const tempMinEl = q(`#gen${cap}TempMin`);
  const tempMaxEl = q(`#gen${cap}TempMax`);
  const tempMeanEl = q(`#gen${cap}TempMean`);
  const tempVarEl = q(`#gen${cap}TempVar`);

  const loadDistEl = q(`#gen${cap}LoadDist`);
  const loadMinEl = q(`#gen${cap}LoadMin`);
  const loadMaxEl = q(`#gen${cap}LoadMax`);
  const loadMeanEl = q(`#gen${cap}LoadMean`);
  const loadVarEl = q(`#gen${cap}LoadVar`);

  const count = toIntOr(countEl?.value, side === "hot" ? 4 : 4);
  const isoShare = clamp(0, toFloatOr(isoEl?.value, 50), 100);

  const tempDistRaw = String(tempDistEl?.value ?? "uniform").toLowerCase();
  const tempDist = tempDistRaw === "normal" ? "normal" : "uniform";

  const loadDistRaw = String(loadDistEl?.value ?? "uniform").toLowerCase();
  const loadDist = loadDistRaw === "normal" ? "normal" : "uniform";

  const temp = {
    kind: tempDist,
    min: toFloatOr(tempMinEl?.value, side === "hot" ? 380 : 300),
    max: toFloatOr(tempMaxEl?.value, side === "hot" ? 520 : 380),
    mean: toFloatOr(tempMeanEl?.value, side === "hot" ? 450 : 340),
    variance: Math.max(0, toFloatOr(tempVarEl?.value, 100)),
  };

  const load = {
    kind: loadDist,
    min: Math.max(0, toFloatOr(loadMinEl?.value, 0.5)),
    max: Math.max(0, toFloatOr(loadMaxEl?.value, 3.0)),
    mean: Math.max(0, toFloatOr(loadMeanEl?.value, 1.5)),
    variance: Math.max(0, toFloatOr(loadVarEl?.value, 0.25)),
  };

  return { count, isoShare, temp, load };
};

/**
 * Сэмплер температуры.
 * @param {ReturnType<typeof readSideParams>["temp"]} t
 */
const sampleTempK = (t) => {
  if (t.kind === "normal") return sampleNormal(t.mean, t.variance);
  return sampleUniform(t.min, t.max);
};

/**
 * Сэмплер нагрузки.
 * @param {ReturnType<typeof readSideParams>["load"]} l
 */
const sampleLoadMW = (l) => {
  if (l.kind === "normal") return sampleNormal(l.mean, l.variance);
  return sampleUniform(l.min, l.max);
};

/**
 * Сэмплер ΔT для неизотермического потока (K).
 * Пока фиксировано “примерно DEFAULT_NONISO_DT_K с разбросом”, чтобы генератор был простым.
 */
const sampleNonIsoDeltaTK = () => {
  // Нормальное вокруг 30 K, дисперсия 100 => σ=10
  const dt = Math.abs(sampleNormal(DEFAULT_NONISO_DT_K, 100));
  return clamp(5, dt, 120);
};

/**
 * Сэмплер положительной нагрузки.
 * @param {ReturnType<typeof readSideParams>["load"]} l
 */
const samplePositiveLoadMW = (l) => {
  // Несколько попыток, затем clamp.
  for (let i = 0; i < 24; i++) {
    const x = sampleLoadMW(l);
    if (Number.isFinite(x) && x > 0) return x;
  }
  return Math.max(1e-3, Math.abs(sampleLoadMW(l) || 0));
};

/**
 * Сгенерировать список потоков для одной стороны в каноническом формате.
 *
 * @param {"hot"|"cold"} side
 * @param {ReturnType<typeof readSideParams>} p
 * @returns {any[]}
 */
const generateStreamsForSide = (side, p) => {
  const n = Math.max(0, Math.trunc(p.count));
  const mask = makeIsoMask(n, p.isoShare);

  const out = [];
  for (let i = 0; i < n; i++) {
    const iso = !!mask[i];

    // Температура на входе
    let tin = sampleTempK(p.temp);
    if (!Number.isFinite(tin)) tin = 300;
    tin = Math.max(1, tin);

    // Нагрузка
    let q = samplePositiveLoadMW(p.load);
    if (!Number.isFinite(q)) q = 1;
    q = Math.max(1e-6, q);

    if (iso) {
      out.push({ in: tin, load: q });
      continue;
    }

    // Неизотермический поток: задаём out и load.
    //
    // Важно: не допускаем отрицательных температур, чтобы `validateAndNormalizeState()`
    // не отверг сгенерированную систему при “экзотических” параметрах пользователя.
    const dT = sampleNonIsoDeltaTK();

    if (side === "hot") {
      // Гарантируем tout >= 1 K при заданном dT.
      if (tin - dT < 1) tin = 1 + dT;
    } else {
      // Для холодной стороны ограничение снизу достаточно обеспечить только для tin.
      tin = Math.max(1, tin);
    }

    let tout = side === "hot" ? tin - dT : tin + dT;
    tout = Math.max(1, tout);

    // Если из-за ограничений всё же получилось ровно tin==tout — делаем маленький сдвиг.
    if (tout === tin) tout = side === "hot" ? tin - 1e-3 : tin + 1e-3;

    out.push({ in: tin, out: tout, load: q });
  }

  return out;
};

/**
 * Получить max температуры у набора потоков.
 * @param {any[]} streams
 */
const maxTempK = (streams) => {
  let m = Number.NEGATIVE_INFINITY;
  for (const s of streams || []) {
    const a = toNumber(s?.in);
    const b = s?.out === undefined ? a : toNumber(s?.out);
    if (Number.isFinite(a)) m = Math.max(m, a);
    if (Number.isFinite(b)) m = Math.max(m, b);
  }
  return Number.isFinite(m) ? m : 0;
};

/**
 * Получить min температуры у набора потоков.
 * @param {any[]} streams
 */
const minTempK = (streams) => {
  let m = Number.POSITIVE_INFINITY;
  for (const s of streams || []) {
    const a = toNumber(s?.in);
    const b = s?.out === undefined ? a : toNumber(s?.out);
    if (Number.isFinite(a)) m = Math.min(m, a);
    if (Number.isFinite(b)) m = Math.min(m, b);
  }
  return Number.isFinite(m) ? m : 0;
};

/**
 * Сдвинуть температуры всех потоков на +deltaK.
 * @param {any[]} streams
 * @param {number} deltaK
 */
const shiftTemps = (streams, deltaK) => {
  if (!Array.isArray(streams)) return;
  const d = Number(deltaK) || 0;
  if (!(d !== 0)) return;

  for (const s of streams) {
    if (!s || typeof s !== "object") continue;
    if (s.in !== undefined) s.in = Number(s.in) + d;
    if (s.out !== undefined) s.out = Number(s.out) + d;
  }
};

/**
 * Гарантировать корректность: все горячие температуры выше всех холодных на ΔT_guard.
 *
 * @param {any[]} hot
 * @param {any[]} cold
 * @param {number} guardK
 */
const enforceSeparation = (hot, cold, guardK) => {
  const guard = Math.max(0, Number(guardK) || 0);

  const coldMax = maxTempK(cold);
  const hotMin = minTempK(hot);

  // Требуем: hotMin >= coldMax + guard
  const need = coldMax + guard - hotMin;

  if (need > 0) {
    // Чуть-чуть больше, чтобы строгие неравенства (если нужны) не упирались в округление.
    shiftTemps(hot, need + 1e-3);
  }
};

/**
 * Проверка: "непустая система" в текущем store.state.
 * @param {any} state
 */
const isNonEmptySystem = (state) => {
  const hotN = Array.isArray(state?.hot) ? state.hot.length : 0;
  const coldN = Array.isArray(state?.cold) ? state.cold.length : 0;
  const exN = Array.isArray(state?.exchanger) ? state.exchanger.length : 0;
  return hotN > 0 || coldN > 0 || exN > 0;
};

/**
 * Создать контроллер генератора.
 *
 * @param {object} deps
 * @param {any} deps.ui ссылки на UI (buildUiRefs)
 * @param {any} deps.store store приложения
 * @param {(forceEditors?: boolean) => void} deps.refreshAllViews функция обновления представлений
 * @returns {{ hookEvents: () => void, destroy: () => void, generateNow: () => void }}
 */
export const createGeneratorController = ({ ui, store, refreshAllViews }) => {
  /** @type {AbortController | null} */
  let ac = null;

  const root = ui?.testModeBlock ?? document;
  const btnGenerate = root?.querySelector?.("#btnGenerate") ?? null;

  const generateNow = () => {
    // Подтверждение перезаписи, если текущая система непустая.
    if (isNonEmptySystem(store?.state)) {
      const ok = window.confirm(
        "Сгенерировать новую систему и заменить текущую? Текущие данные будут потеряны.",
      );
      if (!ok) return;
    }

    // Читаем параметры.
    const hotParams = readSideParams(root, "hot");
    const coldParams = readSideParams(root, "cold");

    // Генерация потоков.
    const hot = generateStreamsForSide("hot", hotParams);
    const cold = generateStreamsForSide("cold", coldParams);

    // Гарантия разнесения температур (hot выше cold).
    enforceSeparation(hot, cold, DEFAULT_GUARD_DT_K);

    // Формируем новое состояние (без решения) и нормализуем его так же,
    // как при импорте из TOML/CSV (единые правила канонической модели).
    const nextStateRaw = {
      multiheat: { version: "0.0.1", temp_unit: "K" },
      hot,
      cold,
      exchanger: [],
      stats: null,
    };

    const nextState = validateAndNormalizeState(nextStateRaw);
    store.state = nextState;

    // Сброс dirty-флагов (генерация заменяет данные редакторов).
    if (store?.dirty) {
      store.dirty.toml = false;
      store.dirty.csvStreams = false;
      store.dirty.csvSolution = false;
    }

    // Обновить визуализацию всегда (если она активна), а представления — только если они не приостановлены.
    // Почему: `refreshAllViews()` внутри сам учитывает `store.viewsSuspended` для вкладок/редакторов,
    // но при этом может перерисовать canvas (режим «Скрыть» + «Визуализировать»).
    if (typeof refreshAllViews === "function") {
      refreshAllViews(true);
    }
  };

  const hookEvents = () => {
    if (ac) ac.abort();
    ac = new AbortController();
    const { signal } = ac;

    // --- Лёгкая “проводка” UI генератора: слайдеры и переключение параметров распределений ---
    // Важно: генерирование может быть “дорогим”, а эти обработчики — нет.
    try {
      /** @type {HTMLInputElement|null} */
      const hotShare = root?.querySelector?.("#genHotIsoShare") ?? null;
      /** @type {HTMLOutputElement|null} */
      const hotShareOut = root?.querySelector?.("#genHotIsoShareOut") ?? null;

      /** @type {HTMLInputElement|null} */
      const coldShare = root?.querySelector?.("#genColdIsoShare") ?? null;
      /** @type {HTMLOutputElement|null} */
      const coldShareOut = root?.querySelector?.("#genColdIsoShareOut") ?? null;

      const hookShare = (rangeEl, outEl) => {
        if (!rangeEl) return;
        const apply = () => syncIsoShareOutput(rangeEl, outEl);
        apply();
        rangeEl.addEventListener("input", apply, { signal });
        rangeEl.addEventListener("change", apply, { signal });
      };

      hookShare(hotShare, hotShareOut);
      hookShare(coldShare, coldShareOut);

      /** @type {HTMLSelectElement|null} */
      const selHotTemp = root?.querySelector?.("#genHotTempDist") ?? null;
      /** @type {HTMLSelectElement|null} */
      const selHotLoad = root?.querySelector?.("#genHotLoadDist") ?? null;
      /** @type {HTMLSelectElement|null} */
      const selColdTemp = root?.querySelector?.("#genColdTempDist") ?? null;
      /** @type {HTMLSelectElement|null} */
      const selColdLoad = root?.querySelector?.("#genColdLoadDist") ?? null;

      const hookDist = (sel) => {
        if (!sel) return;
        const apply = () => applyDistParamsVisibility(root, sel);
        apply();
        sel.addEventListener("change", apply, { signal });
      };

      hookDist(selHotTemp);
      hookDist(selHotLoad);
      hookDist(selColdTemp);
      hookDist(selColdLoad);
    } catch (e) {
      // Почему: генератор — вспомогательная утилита; UI может меняться,
      // а приложение не должно падать из-за “косметики”.
      console.warn("Не удалось инициализировать UI генератора:", e);
    }

    // --- Кнопка “Сгенерировать” ---
    if (!btnGenerate) {
      // UI может быть ещё не добавлен — не падаем.
      return;
    }

    btnGenerate.addEventListener(
      "click",
      () => {
        try {
          generateNow();
        } catch (e) {
          // Почему: генератор — тестовая утилита; ошибки не должны ломать приложение.
          console.error("Ошибка генерации системы:", e);
          window.alert(
            "Не удалось сгенерировать систему. Подробности в консоли браузера.",
          );
        }
      },
      { signal },
    );
  };

  const destroy = () => {
    if (ac) ac.abort();
    ac = null;
  };

  return { hookEvents, destroy, generateNow };
};

export default createGeneratorController;
