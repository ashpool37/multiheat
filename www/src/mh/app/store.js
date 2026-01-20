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
 * @param {"greedy"|"curves"|"trivial"} [opts.solverAlgorithm] Выбранный алгоритм синтеза (по умолчанию `"greedy"`)
 * @returns {{ state: any, activeTab: string, viewsSuspended: boolean, visualizationEnabled: boolean, eqCurvesEnabled: boolean, settingsEnabled: boolean, solverAlgorithm: "greedy"|"curves"|"trivial", dirty: { toml: boolean, csvStreams: boolean, csvSolution: boolean } }}
 */
export const createStore = (opts = {}) => {
  const initialState = opts.state ?? defaultState();
  const initialTab = opts.activeTab ?? "toml";

  const rawAlgo = opts.solverAlgorithm;
  const solverAlgorithm =
    rawAlgo === "greedy" || rawAlgo === "curves" || rawAlgo === "trivial"
      ? rawAlgo
      : "greedy";

  return {
    state: initialState,
    activeTab: initialTab,
    viewsSuspended: false,
    visualizationEnabled: opts.visualizationEnabled ?? false,
    eqCurvesEnabled: opts.eqCurvesEnabled ?? false,
    settingsEnabled: opts.settingsEnabled ?? false,
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
