import { defaultState } from "../model/state.js";

/**
 * Хранилище состояния приложения: каноническое состояние и флаги «грязных» редакторов.
 */

/**
 * Создаёт `store`.
 *
 * @param {object} [opts]
 * @param {any} [opts.state] Начальное состояние (по умолчанию `defaultState()`)
 * @param {string} [opts.activeTab] Активная вкладка (по умолчанию `"toml"`)
 * @param {boolean} [opts.visualizationEnabled] Включена ли визуализация (по умолчанию `false`)
 * @param {boolean} [opts.eqCurvesEnabled] Включены ли эквивалентные кривые (по умолчанию `false`)
 * @param {boolean} [opts.settingsEnabled] Включена ли панель «Настройки» (по умолчанию `false`)
 * @param {"solve_greedy_zig"|"solve_greedy_js"|"solve_curves_zig"|"solve_trivial_zig"} [opts.solverAlgorithmId] Выбранный алгоритм синтеза (по умолчанию `"solve_greedy_zig"`)
 * @param {"greedy"|"curves"|"trivial"} [opts.solverAlgorithm] Устаревшее поле (для обратной совместимости)
 * @returns {{ state: any, activeTab: string, viewsSuspended: boolean, visualizationEnabled: boolean, eqCurvesEnabled: boolean, settingsEnabled: boolean, solverAlgorithmId: "solve_greedy_zig"|"solve_greedy_js"|"solve_curves_zig"|"solve_trivial_zig", solverAlgorithm: "greedy"|"curves"|"trivial", dirty: { toml: boolean, csvStreams: boolean, csvSolution: boolean } }}
 */
export const createStore = (opts = {}) => {
  const initialState = opts.state ?? defaultState();
  const initialTab = opts.activeTab ?? "toml";

  const rawId = opts.solverAlgorithmId;

  const isValidAlgoId = (v) =>
    v === "solve_greedy_zig" ||
    v === "solve_greedy_js" ||
    v === "solve_curves_zig" ||
    v === "solve_trivial_zig";

  // Миграция старых значений (из предыдущих версий UI/хранилища) в новый идентификатор solve_*_(zig|js).
  const migrateToAlgoId = (v) => {
    const s = String(v ?? "").trim();
    if (!s) return null;

    // Уже новый формат
    if (isValidAlgoId(s)) return s;

    // Старый формат без префикса solve_ (или с другим именованием)
    if (s === "greedy_zig") return "solve_greedy_zig";
    if (s === "greedy_js") return "solve_greedy_js";
    if (s === "curves_zig") return "solve_curves_zig";
    if (s === "trivial_zig") return "solve_trivial_zig";

    // Ещё более старый формат (без указания провайдера) — считаем Zig/WASM
    if (s === "greedy") return "solve_greedy_zig";
    if (s === "curves") return "solve_curves_zig";
    if (s === "trivial") return "solve_trivial_zig";

    // Совместимость с прежними значениями селектора
    if (s === "solve_greedy") return "solve_greedy_zig";
    if (s === "solve_curves") return "solve_curves_zig";
    if (s === "solve_trivial") return "solve_trivial_zig";

    return null;
  };

  const solverAlgorithmId = isValidAlgoId(rawId)
    ? rawId
    : (migrateToAlgoId(opts.solverAlgorithm) ?? "solve_greedy_zig");

  // Устаревшее поле оставляем (для кода, который ещё ориентируется на "greedy/curves/trivial").
  const base = String(solverAlgorithmId).replace(/_(zig|js)$/, "");
  const solverAlgorithm =
    base === "solve_trivial"
      ? "trivial"
      : base === "solve_curves"
        ? "curves"
        : "greedy";

  return {
    state: initialState,
    activeTab: initialTab,
    viewsSuspended: false,
    visualizationEnabled: opts.visualizationEnabled ?? false,
    eqCurvesEnabled: opts.eqCurvesEnabled ?? false,
    settingsEnabled: opts.settingsEnabled ?? false,
    solverAlgorithmId,
    solverAlgorithm,
    dirty: {
      toml: false,
      csvStreams: false,
      csvSolution: false,
    },
  };
};

/**
 * Сбросить флаги `store.dirty`.
 *
 * @param {ReturnType<typeof createStore>} store
 */
export const clearDirtyFlags = (store) => {
  store.dirty.toml = false;
  store.dirty.csvStreams = false;
  store.dirty.csvSolution = false;
};
