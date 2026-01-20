import { buildUiRefs } from "./ui_refs.js";
import { createStore, clearDirtyFlags } from "./store.js";
import { createStatus } from "./status.js";
import { createViewsCoordinator } from "./views.js";
import { createTabsController, Tab } from "./tabs.js";
import { createVisualizationController } from "./visualization.js";
import { createGeneratorController } from "./generator.js";

import {
  logError,
  isAbortError,
  logDebug,
  logInfo,
  logWarn,
  summarizeModuleExports,
  isDebugEnabled,
} from "../util/errors.js";

import * as multiheatModule from "../../../zig/multiheat_entry.zig";
import { getBuildVersions } from "../build_versions.js";

import { defaultState, validateAndNormalizeState } from "../model/state.js";
import { computeSolutionStats } from "../model/stats.js";

import { parseTomlToState, emitToml } from "../io/toml.js";
import {
  parseCsvStreamsToStatePartial,
  emitCsvStreams,
} from "../io/csv_streams.js";
import {
  parseCsvSolutionToExchangers,
  emitCsvSolution,
} from "../io/csv_solution.js";

import { downloadText } from "../io/download.js";

import {
  buildZigSystem,
  dumpExchangersFromZig,
  zigExchangersToState,
  describeZigError,
} from "../zig/interop.js";

import { renderDescriptionHtml } from "../render/description.js";
import { renderTables } from "../render/tables.js";
import { solveGreedyJs } from "../solver/solve_greedy_js.js";
import { solveCurvesJs } from "../solver/solve_curves_js.js";

const { multiheat_version: BUILD_MULTIHEAT_VERSION } =
  getBuildVersions(multiheatModule);

const applyAppVersionUi = (versionStr) => {
  const v =
    typeof versionStr === "string" && versionStr.trim().length > 0
      ? versionStr.trim()
      : null;

  if (!v) return;

  // Заголовок вкладки браузера
  document.title = `Multiheat ${v}`;

  // Заголовок приложения в панели управления
  const h1 = document.querySelector(".mh-title");
  if (h1) h1.textContent = `Multiheat ${v}`;
};

/**
 * Основной модуль приложения: связывает UI, состояние, представления и Zig/WASM.
 */

// --- Синтез на чистом JavaScript ---
//
// Реализации алгоритмов на JS находятся в `../solver/*_js.js`.
// Здесь используются импорты `solveGreedyJs` и `solveCurvesJs`.

const setUiEnabled = (ui, enabled) => {
  const allButtons = [...Object.values(ui.buttons), ...Object.values(ui.tabs)];
  for (const b of allButtons) b.disabled = !enabled;

  ui.toml.textarea.disabled = !enabled;
  ui.csv.streamsTextarea.disabled = !enabled;
  ui.csv.solutionTextarea.disabled = !enabled;
};

const setSolverEnabled = (ui, enabled) => {
  ui.buttons.solve.disabled = !enabled;
  ui.buttons.verify.disabled = !enabled;
};

const createSync = ({ ui, store, refreshAllViews }) => {
  const syncStateFromTomlEditor = () => {
    const text = ui.toml.textarea.value ?? "";
    const next = parseTomlToState(text);

    store.state = next;
    clearDirtyFlags(store);

    if (!store.viewsSuspended) refreshAllViews(true);
  };

  const syncStateFromCsvEditors = () => {
    const streamsText = ui.csv.streamsTextarea.value ?? "";
    const solText = ui.csv.solutionTextarea.value ?? "";

    if (streamsText.trim().length === 0) {
      if (solText.trim().length === 0) {
        store.state = defaultState();
        clearDirtyFlags(store);
        refreshAllViews(true);
        return;
      }
      throw new Error(
        "CSV (потоки) пустой: невозможно применить CSV (решение) без потоков.",
      );
    }

    const partial = parseCsvStreamsToStatePartial(streamsText);
    const base = {
      multiheat: { version: BUILD_MULTIHEAT_VERSION, temp_unit: "K" },
      hot: partial.hot,
      cold: partial.cold,
      exchanger: [],
    };

    if (solText.trim().length > 0) {
      base.exchanger = parseCsvSolutionToExchangers(
        solText,
        base.hot.length,
        base.cold.length,
      );
    }

    store.state = validateAndNormalizeState(base);
    clearDirtyFlags(store);

    if (!store.viewsSuspended) refreshAllViews(true);
  };

  const syncFromActiveEditorIfNeeded = () => {
    if (store.viewsSuspended) return;

    if (store.activeTab === Tab.toml && store.dirty.toml) {
      syncStateFromTomlEditor();
      return;
    }

    if (
      store.activeTab === Tab.csv &&
      (store.dirty.csvStreams || store.dirty.csvSolution)
    ) {
      syncStateFromCsvEditors();
    }
  };

  return {
    syncStateFromTomlEditor,
    syncStateFromCsvEditors,
    syncFromActiveEditorIfNeeded,
  };
};

const setupDropdownMenus = (ui) => {
  const openBtn = ui.buttons.openMenu;
  const saveBtn = ui.buttons.saveMenu;
  const openMenu = ui.menus.open;
  const saveMenu = ui.menus.save;

  const setExpanded = (btn, expanded) => {
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  };

  const closeMenu = (btn, menu) => {
    menu.hidden = true;
    setExpanded(btn, false);
  };

  const toggleMenu = (btn, menu) => {
    const nextHidden = !menu.hidden;
    menu.hidden = nextHidden;
    setExpanded(btn, !nextHidden);
  };

  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu(saveBtn, saveMenu);
    toggleMenu(openBtn, openMenu);
  });

  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu(openBtn, openMenu);
    toggleMenu(saveBtn, saveMenu);
  });

  // Почему: клик вне меню закрывает выпадающие списки
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!openMenu.hidden && !openMenu.contains(t) && !openBtn.contains(t))
      closeMenu(openBtn, openMenu);
    if (!saveMenu.hidden && !saveMenu.contains(t) && !saveBtn.contains(t))
      closeMenu(saveBtn, saveMenu);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!openMenu.hidden) closeMenu(openBtn, openMenu);
    if (!saveMenu.hidden) closeMenu(saveBtn, saveMenu);
  });

  const closeBoth = () => {
    closeMenu(openBtn, openMenu);
    closeMenu(saveBtn, saveMenu);
  };

  for (const el of [
    ui.buttons.openToml,
    ui.buttons.openCsvStreams,
    ui.buttons.openCsvSolution,
    ui.buttons.saveToml,
    ui.buttons.saveCsvStreams,
    ui.buttons.saveCsvSolution,
  ]) {
    el.addEventListener("click", () => closeBoth());
  }
};

// Режим «Тестировать» удалён: скрытие левой панели делается повторным нажатием на активную вкладку,
// а параметры (алгоритм/генератор) живут в панели «настройки».

const hasAnyUserData = ({ store, ui }) => {
  const s = store.state;
  const hotLen = Array.isArray(s?.hot) ? s.hot.length : 0;
  const coldLen = Array.isArray(s?.cold) ? s.cold.length : 0;
  const exLen = Array.isArray(s?.exchanger) ? s.exchanger.length : 0;

  if (hotLen > 0 || coldLen > 0 || exLen > 0) return true;

  const empty = defaultState();

  if (store.dirty.toml) {
    const cur = (ui.toml.textarea.value ?? "").trim();
    const def = emitToml(empty).trim();
    if (cur !== def) return true;
  }

  if (store.dirty.csvStreams) {
    const cur = (ui.csv.streamsTextarea.value ?? "").trim();
    const def = emitCsvStreams(empty).trim();
    if (cur !== def) return true;
  }

  if (store.dirty.csvSolution) {
    const cur = (ui.csv.solutionTextarea.value ?? "").trim();
    const def = emitCsvSolution(empty).trim();
    if (cur !== def) return true;
  }

  return false;
};

/**
 * `startApp()` запускает интерфейс и подключает модуль вычислений Zig/WASM.
 * @returns {Promise<{ ui: any, store: any, multiheat: any | null }>}
 */
export const startApp = async () => {
  // Версия должна приходить из сборки (единственный источник правды — build_options в Zig/WASM entrypoint).
  applyAppVersionUi(BUILD_MULTIHEAT_VERSION);

  const ui = buildUiRefs(document);
  const store = createStore({ activeTab: Tab.toml });
  const { setStatus } = createStatus({ statusEl: ui.status });

  const views = createViewsCoordinator({
    store,
    ui,
    emitToml,
    emitCsvStreams,
    emitCsvSolution,
    renderDescriptionHtml,
    renderTables,
  });

  // Контроллер визуализации создаём чуть позже (после setupToggle),
  // но ссылка нужна уже здесь, чтобы не попадать в TDZ внутри onUiModeChange.
  let visualization = null;

  const refreshAllViews = (forceEditors = false) => {
    views.refreshAllViews(forceEditors);
    if (visualization) visualization.redraw();
  };

  const sync = createSync({
    ui,
    store,
    refreshAllViews,
  });

  const tabs = createTabsController({
    ui,
    store,
    refreshAllViews,
    updateNonEditableViews: views.updateNonEditableViews,
    updateEditorsFromState: views.updateEditorsFromState,
    syncFromActiveEditorIfNeeded: sync.syncFromActiveEditorIfNeeded,
    logError,
    setStatus,
    onUiModeChange: () => {
      // Почему: «Скрыть»/переключение вкладок меняют разметку; визуализация должна подстроиться.
      if (visualization) visualization.apply();
    },
  });

  // --- Привязка событий (без WASM) ---

  setUiEnabled(ui, true);
  setSolverEnabled(ui, false);

  // Правая «система вкладок» (настройки/визуализация/кривые):
  // состоянием (aria-pressed) управляет контроллер правой панели; здесь лишь гарантируем базовые атрибуты.
  const ensurePressedToggleAttrs = (btn) => {
    if (!btn) return;
    btn.classList.add("mh-toggle");
    if (!btn.hasAttribute("aria-pressed"))
      btn.setAttribute("aria-pressed", "false");
  };

  ensurePressedToggleAttrs(ui?.toggles?.settings);
  ensurePressedToggleAttrs(ui?.toggles?.visualize);
  ensurePressedToggleAttrs(ui?.toggles?.eqCurves);

  visualization = createVisualizationController({
    ui,
    store,
    multiheat: multiheatModule,
  });
  visualization.hookEvents();

  // Генератор случайных систем (панель «настройки»; кнопка «Сгенерировать» — в верхней панели).
  const generator = createGeneratorController({ ui, store, refreshAllViews });
  generator.hookEvents();

  // Выбор алгоритма (панель «настройки»).
  // Почему: селектор — источник истины для store, а store — для solveCurrent().
  if (ui?.settings?.algorithmSelect) {
    const sel = ui.settings.algorithmSelect;

    // Новый формат: машиночитаемые идентификаторы с суффиксом _zig/_js.
    // Для обратной совместимости принимаем старые значения без суффикса.
    const normalizeAlgoId = (v) => {
      const s = String(v ?? "").trim();
      if (!s) return "solve_greedy_zig";

      // Если уже новый формат — как есть (но только для формата `solve_*_(zig|js)`).
      if ((s.endsWith("_zig") || s.endsWith("_js")) && s.startsWith("solve_"))
        return s;

      // Старые значения селектора → считаем Zig/WASM.
      if (s === "solve_greedy") return "solve_greedy_zig";
      if (s === "solve_curves") return "solve_curves_zig";
      if (s === "solve_trivial") return "solve_trivial_zig";

      // Старые/экспериментальные значения без префикса `solve_`.
      if (s === "greedy_zig") return "solve_greedy_zig";
      if (s === "curves_zig") return "solve_curves_zig";
      if (s === "trivial_zig") return "solve_trivial_zig";
      if (s === "greedy_js") return "solve_greedy_js";
      if (s === "curves_js") return "solve_curves_js";

      // Фолбэк: тоже Zig/WASM.
      return `${s}_zig`;
    };

    // Основной идентификатор алгоритма — store.solverAlgorithmId.
    // legacy store.solverAlgorithm поддерживаем без указания провайдера ("greedy"|"curves"|"trivial").
    if (!store.solverAlgorithmId) {
      const a = String(store.solverAlgorithm ?? "").trim();

      if (a === "trivial") store.solverAlgorithmId = "solve_trivial_zig";
      else if (a === "curves") store.solverAlgorithmId = "solve_curves_zig";
      else if (a === "greedy") store.solverAlgorithmId = "solve_greedy_zig";
      // Старые/экспериментальные значения с провайдером — тоже мигрируем.
      else if (a === "trivial_zig")
        store.solverAlgorithmId = "solve_trivial_zig";
      else if (a === "curves_zig") store.solverAlgorithmId = "solve_curves_zig";
      else if (a === "greedy_zig") store.solverAlgorithmId = "solve_greedy_zig";
      else if (a === "greedy_js") store.solverAlgorithmId = "solve_greedy_js";
      else if (a === "curves_js") store.solverAlgorithmId = "solve_curves_js";
      else store.solverAlgorithmId = "solve_greedy_zig";
    }

    // Инициализируем значение селектора из store.
    sel.value = normalizeAlgoId(store.solverAlgorithmId);

    sel.addEventListener("change", () => {
      const v = normalizeAlgoId(sel.value);
      store.solverAlgorithmId = v;

      // legacy store.solverAlgorithm: без указания провайдера, только базовый алгоритм.
      const base = v.replace(/_(zig|js)$/, "");
      if (base === "solve_trivial") store.solverAlgorithm = "trivial";
      else if (base === "solve_curves") store.solverAlgorithm = "curves";
      else store.solverAlgorithm = "greedy";
    });
  }

  // Флаги dirty редакторов
  ui.toml.textarea.addEventListener("input", () => {
    store.dirty.toml = true;
  });
  ui.csv.streamsTextarea.addEventListener("input", () => {
    store.dirty.csvStreams = true;
  });
  ui.csv.solutionTextarea.addEventListener("input", () => {
    store.dirty.csvSolution = true;
  });

  // Вкладки
  tabs.hookTabEvents();
  tabs.setActiveTab(Tab.toml);

  store.state = defaultState();
  refreshAllViews(true);

  // Почему: режимы «Скрыть»/«Визуализировать» должны применяться после первичного рендера.
  visualization.apply();

  // «Открыть»: пункты меню → выбор файла
  ui.buttons.openToml.addEventListener("click", () => ui.inputs.toml.click());
  ui.buttons.openCsvStreams.addEventListener("click", () =>
    ui.inputs.csvStreams.click(),
  );
  ui.buttons.openCsvSolution.addEventListener("click", () =>
    ui.inputs.csvSolution.click(),
  );

  // Обработчики загрузки файлов
  const onUploadToml = async (file) => {
    try {
      const text = await file.text();

      if (store.viewsSuspended) {
        store.state = parseTomlToState(text);
        clearDirtyFlags(store);
        setStatus("ok", "TOML загружен.");
        return;
      }

      ui.toml.textarea.value = text;
      store.dirty.toml = true;

      sync.syncStateFromTomlEditor();
      tabs.setActiveTab(Tab.toml);
      setStatus("ok", "TOML загружен и проверен.");
    } catch (e) {
      logError("Загрузка TOML не удалась", e);
      setStatus(
        "err",
        "Не удалось загрузить TOML. Подробности в консоли браузера.",
      );
    }
  };

  const onUploadCsvStreams = async (file) => {
    try {
      const text = await file.text();

      if (store.viewsSuspended) {
        const partial = parseCsvStreamsToStatePartial(text);
        store.state = validateAndNormalizeState({
          multiheat: { version: BUILD_MULTIHEAT_VERSION, temp_unit: "K" },
          hot: partial.hot,
          cold: partial.cold,
          exchanger: [],
        });
        clearDirtyFlags(store);
        setStatus("warn", "CSV (потоки) загружен. Решение очищено.");
        return;
      }

      ui.csv.streamsTextarea.value = text;
      store.dirty.csvStreams = true;

      // Почему: при замене потоков прежнее решение теряет смысл
      ui.csv.solutionTextarea.value = "";
      store.dirty.csvSolution = false;

      sync.syncStateFromCsvEditors();
      tabs.setActiveTab(Tab.csv);
      setStatus("warn", "CSV (потоки) загружен и проверен. Решение очищено.");
    } catch (e) {
      logError("Загрузка CSV (потоки) не удалась", e);
      setStatus(
        "err",
        "Не удалось загрузить CSV (потоки). Подробности в консоли браузера.",
      );
    }
  };

  const onUploadCsvSolution = async (file) => {
    try {
      const text = await file.text();

      if (store.viewsSuspended) {
        const hotLen = Array.isArray(store.state?.hot)
          ? store.state.hot.length
          : 0;
        const coldLen = Array.isArray(store.state?.cold)
          ? store.state.cold.length
          : 0;

        if (hotLen === 0 || coldLen === 0) {
          throw new Error(
            "Невозможно загрузить CSV (решение): сначала загрузите CSV (потоки) или TOML.",
          );
        }

        const exchangers = parseCsvSolutionToExchangers(text, hotLen, coldLen);

        store.state = validateAndNormalizeState({
          ...store.state,
          exchanger: exchangers,
        });
        clearDirtyFlags(store);

        setStatus("ok", "CSV (решение) загружен.");
        return;
      }

      ui.csv.solutionTextarea.value = text;
      store.dirty.csvSolution = true;

      sync.syncStateFromCsvEditors();
      tabs.setActiveTab(Tab.csv);
      setStatus("ok", "CSV (решение) загружен и проверен.");
    } catch (e) {
      logError("Загрузка CSV (решение) не удалась", e);
      setStatus(
        "err",
        "Не удалось загрузить CSV (решение). Подробности в консоли браузера.",
      );
    }
  };

  ui.inputs.toml.addEventListener("change", async () => {
    const file = ui.inputs.toml.files?.[0];
    ui.inputs.toml.value = "";
    if (!file) return;
    await onUploadToml(file);
  });

  ui.inputs.csvStreams.addEventListener("change", async () => {
    const file = ui.inputs.csvStreams.files?.[0];
    ui.inputs.csvStreams.value = "";
    if (!file) return;
    await onUploadCsvStreams(file);
  });

  ui.inputs.csvSolution.addEventListener("change", async () => {
    const file = ui.inputs.csvSolution.files?.[0];
    ui.inputs.csvSolution.value = "";
    if (!file) return;
    await onUploadCsvSolution(file);
  });

  // Обработчики сохранения
  ui.buttons.saveToml.addEventListener("click", async () => {
    try {
      if (store.viewsSuspended) {
        setStatus(
          "warn",
          "Режим «Скрыть» активен: сохранение представлений отключено.",
        );
        return;
      }
      sync.syncFromActiveEditorIfNeeded();
      const text = emitToml(store.state);
      await downloadText(text, "multiheat.toml", "text/toml", [".toml"]);
      setStatus("ok", "TOML сохранён.");
    } catch (e) {
      if (isAbortError(e)) {
        setStatus("warn", "Сохранение отменено пользователем.");
        return;
      }
      logError("Сохранение TOML не удалось", e);
      setStatus(
        "err",
        "Не удалось сохранить TOML. Подробности в консоли браузера.",
      );
    }
  });

  ui.buttons.saveCsvStreams.addEventListener("click", async () => {
    try {
      if (store.viewsSuspended) {
        setStatus(
          "warn",
          "Режим «Скрыть» активен: сохранение представлений отключено.",
        );
        return;
      }
      sync.syncFromActiveEditorIfNeeded();
      const text = emitCsvStreams(store.state);
      await downloadText(text, "multiheat_streams.csv", "text/csv", [".csv"]);
      setStatus("ok", "CSV (потоки) сохранён.");
    } catch (e) {
      if (isAbortError(e)) {
        setStatus("warn", "Сохранение отменено пользователем.");
        return;
      }
      logError("Сохранение CSV (потоки) не удалось", e);
      setStatus(
        "err",
        "Не удалось сохранить CSV (потоки). Подробности в консоли браузера.",
      );
    }
  });

  ui.buttons.saveCsvSolution.addEventListener("click", async () => {
    try {
      if (store.viewsSuspended) {
        setStatus(
          "warn",
          "Режим «Скрыть» активен: сохранение представлений отключено.",
        );
        return;
      }
      sync.syncFromActiveEditorIfNeeded();
      const text = emitCsvSolution(store.state);
      await downloadText(text, "multiheat_solution.csv", "text/csv", [".csv"]);
      setStatus("ok", "CSV (решение) сохранён.");
    } catch (e) {
      if (isAbortError(e)) {
        setStatus("warn", "Сохранение отменено пользователем.");
        return;
      }
      logError("Сохранение CSV (решение) не удалось", e);
      setStatus(
        "err",
        "Не удалось сохранить CSV (решение). Подробности в консоли браузера.",
      );
    }
  });

  // Сброс данных
  ui.buttons.clear.addEventListener("click", () => {
    try {
      const ok = window.confirm("Сбросить все данные?");
      if (!ok) return;

      store.state = defaultState();
      clearDirtyFlags(store);

      refreshAllViews(true);
      setStatus("ok", "Данные сброшены.");
    } catch (e) {
      logError("Сброс данных не удался", e);
      setStatus(
        "err",
        "Не удалось сбросить данные. Подробности в консоли браузера.",
      );
    }
  });

  // Защита от случайного закрытия вкладки
  window.addEventListener("beforeunload", (e) => {
    if (!hasAnyUserData({ store, ui })) return;
    e.preventDefault();
    e.returnValue = "";
    return "";
  });

  // Выпадающие меню
  setupDropdownMenus(ui);

  // Начальный статус
  setStatus(
    "ok",
    "Готов к работе. Откройте файл конфигурации или вставьте её в поле ниже.",
  );

  // --- Интеграция Zig/WASM ---
  // Почему: используем статический импорт, чтобы избежать зависаний/TDZ в production-сборке
  // из-за обёрток динамического import() и modulepreload.
  let multiheat = null;

  logDebug("Старт Zig/WASM инициализации (статический импорт)", {
    href: window.location?.href,
    baseURI: document.baseURI,
    importMetaUrl: import.meta.url,
    debug: isDebugEnabled(),
  });

  const solveCurrent = () => {
    try {
      if (!multiheat) throw new Error("Модуль вычислений не загружен.");

      sync.syncFromActiveEditorIfNeeded();

      try {
        // Почему: validateAndNormalizeState не знает о [stats] и может его отбросить.
        // Для синтеза stats не нужен, но для отображения/экспорта (TOML/Описание) — нужен.
        const prevStats = store.state?.stats ?? null;
        store.state = validateAndNormalizeState(store.state);
        if (prevStats) store.state = { ...store.state, stats: prevStats };
      } catch (e) {
        logError("Проверка входных данных перед синтезом не пройдена", e);
        setStatus(
          "err",
          "Не удалось синтезировать систему: входные данные некорректны. Подробности в консоли браузера.",
        );
        return;
      }

      if (store.state.hot.length === 0 || store.state.cold.length === 0) {
        setStatus(
          "err",
          "Невозможно синтезировать систему: добавьте хотя бы один горячий и один холодный поток.",
        );
        return;
      }

      // Zig-систему собираем только для ветки Zig/WASM (JS-решатель работает напрямую с каноническим state).

      // Выбор алгоритма синтеза.
      //
      // Новый формат идентификаторов:
      // - суффикс _zig: реализация Zig/WASM
      // - суффикс _js: реализация на чистом JavaScript
      //
      // Для обратной совместимости поддерживаем старые значения без суффикса.
      const normalizeAlgoId = (v) => {
        const s = String(v ?? "").trim();
        if (!s) return "solve_greedy_zig";
        if ((s.endsWith("_zig") || s.endsWith("_js")) && s.startsWith("solve_"))
          return s;

        if (s === "solve_greedy") return "solve_greedy_zig";
        if (s === "solve_curves") return "solve_curves_zig";
        if (s === "solve_trivial") return "solve_trivial_zig";

        if (s === "greedy_zig") return "solve_greedy_zig";
        if (s === "curves_zig") return "solve_curves_zig";
        if (s === "trivial_zig") return "solve_trivial_zig";
        if (s === "greedy_js") return "solve_greedy_js";
        if (s === "curves_js") return "solve_curves_js";

        return `${s}_zig`;
      };

      const algoId = normalizeAlgoId(
        store.solverAlgorithmId ??
          (store.solverAlgorithm === "trivial"
            ? "solve_trivial_zig"
            : store.solverAlgorithm === "curves"
              ? "solve_curves_zig"
              : "solve_greedy_zig"),
      );

      const provider = algoId.endsWith("_js") ? "js" : "zig";
      const baseName = algoId.replace(/_(zig|js)$/, "");
      const usedName = `${baseName}_${provider}`;

      const humanAlgo = (() => {
        // Берём человекочитаемое имя из селектора алгоритмов (как в UI),
        // чтобы статистика совпадала с текущими подписями в настройках.
        const sel = ui?.settings?.algorithmSelect ?? null;
        if (sel && sel instanceof HTMLSelectElement) {
          const opt =
            (sel.selectedOptions && sel.selectedOptions[0]) ||
            sel.options?.[sel.selectedIndex] ||
            null;

          const label = opt ? String(opt.textContent ?? "").trim() : "";
          if (label) return label;
        }

        // Фолбэк: формируем по типу реализации.
        if (baseName === "solve_trivial")
          return provider === "js"
            ? "Без теплообмена (JavaScript)"
            : "Без теплообмена (Zig/WASM)";
        if (baseName === "solve_curves")
          return provider === "js"
            ? "Эквивалентные кривые (JavaScript)"
            : "Эквивалентные кривые (Zig/WASM)";
        return provider === "js" ? "Жадный (JavaScript)" : "Жадный (Zig/WASM)";
      })();

      const nowMs =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? () => performance.now()
          : () => Date.now();

      let nextExchangers = null;

      const t0 = nowMs();

      // Выполнение синтеза
      if (provider === "js") {
        if (baseName === "solve_greedy") {
          nextExchangers = solveGreedyJs(store.state, { min_dt: 20 });
        } else if (baseName === "solve_curves") {
          try {
            nextExchangers = solveCurvesJs(store.state, { min_dt: 20 });
          } catch (e) {
            logError("Синтез (solve_curves_js) завершился с ошибкой", e);
            setStatus(
              "err",
              "Не удалось синтезировать систему (JavaScript): задача неразрешима или входные данные некорректны. Подробности в консоли браузера.",
            );
            return;
          }
        } else {
          setStatus(
            "err",
            "Невозможно синтезировать: выбранный алгоритм JavaScript пока не реализован.",
          );
          return;
        }
      } else {
        const solveFn =
          baseName === "solve_trivial"
            ? multiheat.solve_trivial
            : baseName === "solve_curves"
              ? multiheat.solve_curves
              : multiheat.solve_greedy;

        if (typeof solveFn !== "function") {
          setStatus(
            "err",
            `Невозможно синтезировать: алгоритм «${humanAlgo}» недоступен в модуле вычислений.`,
          );
          return;
        }

        const system = buildZigSystem(multiheat, store.state, false);

        try {
          solveFn(system);
        } catch (e) {
          logError(`Синтез (${usedName}) завершился с ошибкой`, e);
          setStatus(
            "err",
            `Не удалось синтезировать систему: ${describeZigError(e)}`,
          );
          return;
        }

        const zigExList = dumpExchangersFromZig(system.exchangers);
        nextExchangers = zigExchangersToState(zigExList);
      }

      const solveTimeMs = Math.round(nowMs() - t0);

      const next = {
        ...store.state,
        exchanger: Array.isArray(nextExchangers) ? nextExchangers : [],
      };

      const normalized = validateAndNormalizeState(next);
      const stats = computeSolutionStats(normalized, {
        algorithm_used: usedName,
        algorithm_label: humanAlgo,
        solve_time_ms: solveTimeMs,
      });

      store.state = { ...normalized, stats };
      clearDirtyFlags(store);

      refreshAllViews(true);

      try {
        const verifySystem = buildZigSystem(multiheat, store.state, true);
        multiheat.verifySolution(verifySystem);
        setStatus(
          "ok",
          `Синтез выполнен. Добавлено теплообменников: ${store.state.exchanger.length}.`,
        );
      } catch (e) {
        logError("Проверка после синтеза не пройдена", e);
        setStatus(
          "warn",
          `Синтез выполнен, но проверка не пройдена: ${describeZigError(e)}`,
        );
      }
    } catch (e) {
      logError("Не удалось синтезировать систему", e);
      setStatus(
        "err",
        "Не удалось синтезировать систему. Подробности в консоли браузера.",
      );
    }
  };

  const verifyCurrent = () => {
    try {
      if (!multiheat) throw new Error("Модуль вычислений не загружен.");

      sync.syncFromActiveEditorIfNeeded();

      try {
        // Почему: validateAndNormalizeState не знает о [stats] и может его отбросить.
        // При проверке решение/статистика не должны исчезать.
        const prevStats = store.state?.stats ?? null;
        store.state = validateAndNormalizeState(store.state);
        if (prevStats) store.state = { ...store.state, stats: prevStats };
      } catch (e) {
        logError(
          "Проверка входных данных перед проверкой решения не пройдена",
          e,
        );
        setStatus(
          "err",
          "Не удалось проверить систему: входные данные некорректны. Подробности в консоли браузера.",
        );
        return;
      }

      if (store.state.hot.length === 0 || store.state.cold.length === 0) {
        setStatus(
          "err",
          "Невозможно проверить систему: добавьте хотя бы один горячий и один холодный поток.",
        );
        return;
      }

      const system = buildZigSystem(multiheat, store.state, true);

      try {
        multiheat.verifySolution(system);
        setStatus("ok", "Проверка пройдена.");
      } catch (e) {
        logError("Проверка не пройдена", e);
        setStatus("warn", `Проверка не пройдена: ${describeZigError(e)}`);
      }
    } catch (e) {
      logError("Не удалось проверить систему", e);
      setStatus(
        "err",
        "Не удалось проверить систему. Подробности в консоли браузера.",
      );
    }
  };

  ui.buttons.solve.addEventListener("click", solveCurrent);
  ui.buttons.verify.addEventListener("click", verifyCurrent);

  try {
    // Почему: включаем вычисления только после проверки экспортируемого API.
    // Модуль Zig/WASM импортирован статически на уровне модуля (`import * as multiheatModule ...`),
    // поэтому здесь не используем динамический import() и связанные с ним обёртки.
    logInfo(
      "Подключение модуля вычислений (Zig/WASM) (статический импорт)...",
      {
        href: window.location?.href,
        baseURI: document.baseURI,
      },
    );

    multiheat = multiheatModule;

    logInfo("Модуль вычислений доступен", {
      exports: summarizeModuleExports(multiheat),
    });

    const checks = {
      solve_greedy: typeof multiheat?.solve_greedy,
      solve_curves: typeof multiheat?.solve_curves,
      solve_trivial: typeof multiheat?.solve_trivial,
      verifySolution: typeof multiheat?.verifySolution,
      HeatSystem: typeof multiheat?.HeatSystem,
      HeatStream: typeof multiheat?.HeatStream,
      HeatExchanger: typeof multiheat?.HeatExchanger,
    };

    const def = multiheat && "default" in multiheat ? multiheat.default : null;
    const defaultChecks = def
      ? {
          solve_greedy: typeof def?.solve_greedy,
          solve_curves: typeof def?.solve_curves,
          solve_trivial: typeof def?.solve_trivial,
          verifySolution: typeof def?.verifySolution,
          HeatSystem: typeof def?.HeatSystem,
          HeatStream: typeof def?.HeatStream,
          HeatExchanger: typeof def?.HeatExchanger,
        }
      : null;

    logDebug("Проверка экспортируемого API Zig/WASM", {
      checks,
      defaultChecks,
    });

    const ok =
      checks.solve_greedy === "function" &&
      checks.verifySolution === "function" &&
      checks.HeatSystem === "function" &&
      checks.HeatStream === "function" &&
      checks.HeatExchanger === "function";

    if (!ok) {
      logWarn("Zig/WASM импортирован, но API не совпадает с ожидаемым", {
        checks,
        defaultChecks,
        exports: summarizeModuleExports(multiheat),
        hint:
          defaultChecks &&
          defaultChecks.solve_greedy === "function" &&
          defaultChecks.verifySolution === "function"
            ? "Похоже, нужные экспорты находятся под `default`. Это часто проявляется только в production-сборке."
            : null,
      });

      setSolverEnabled(ui, false);
      setStatus(
        "err",
        "Модуль вычислений загружен, но требуемые функции недоступны.",
      );
      return { ui, store, multiheat: null };
    }

    logInfo("Zig/WASM готов: включаем вычисления", { checks });

    setUiEnabled(ui, true);
    setSolverEnabled(ui, true);

    setStatus(
      "ok",
      "Готов к работе. Откройте файл конфигурации или вставьте её в поле ниже.",
    );

    return { ui, store, multiheat };
  } catch (e) {
    logError("Не удалось загрузить модуль вычислений", e, {
      href: window.location?.href,
      baseURI: document.baseURI,
      importMetaUrl: import.meta.url,
      debug: isDebugEnabled(),
      mode: "static-import",
    });
    setSolverEnabled(ui, false);
    setStatus(
      "err",
      "Не удалось загрузить модуль вычислений. Подробности в консоли браузера.",
    );
    return { ui, store, multiheat: null };
  }
};

export default startApp;
