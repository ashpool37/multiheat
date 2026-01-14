/**
 * Контроллер вкладок.
 *
 * Правила:
 * - вкладка «Скрыть» включает `store.viewsSuspended` и скрывает `ui.tabPanels`
 * - при переходе на «Описание»/«Таблица» сначала синхронизируем активный редактор
 * - при выходе из «Скрыть» возобновляем обновления и принудительно обновляем представления
 */

/** @readonly */
export const Tab = {
  description: "description",
  tables: "tables",
  toml: "toml",
  csv: "csv",
  hide: "hide",
};

/**
 * Создать контроллер вкладок.
 *
 * @param {object} deps
 * @param {any} deps.ui Ссылки на элементы интерфейса
 * @param {any} deps.store Хранилище состояния приложения
 * @param {(forceEditors?: boolean) => void} deps.refreshAllViews Обновить все представления
 * @param {() => void} deps.updateNonEditableViews Обновить «Описание» и «Таблица»
 * @param {(force?: boolean) => void} deps.updateEditorsFromState Обновить редакторы TOML/CSV из `store.state`
 * @param {() => void} deps.syncFromActiveEditorIfNeeded Синхронизировать `store.state` из активного редактора при необходимости
 * @param {(context: string, e: unknown) => void} deps.logError Логирование ошибок
 * @param {("ok"|"warn"|"err", message: string) => void} deps.setStatus Обновление статусной строки
 */
export const createTabsController = ({
  ui,
  store,
  refreshAllViews,
  updateNonEditableViews,
  updateEditorsFromState,
  syncFromActiveEditorIfNeeded,
  logError,
  setStatus,
}) => {
  const setActiveTab = (tab) => {
    store.activeTab = tab;

    for (const [k, btn] of Object.entries(ui.tabs)) {
      const active = k === tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }

    for (const [k, panel] of Object.entries(ui.panels)) {
      panel.hidden = k !== tab;
    }
  };

  const setViewsSuspended = (suspended) => {
    store.viewsSuspended = suspended;
    if (ui.tabPanels) ui.tabPanels.hidden = suspended;
  };

  const switchTab = (nextTab) => {
    try {
      if (nextTab === Tab.hide) {
        setViewsSuspended(true);
        setActiveTab(nextTab);
        return;
      }

      if (store.viewsSuspended) {
        setViewsSuspended(false);
        refreshAllViews(true);
      }

      const goingToNonEditable =
        nextTab === Tab.description || nextTab === Tab.tables;

      // Почему: не валидируем на каждый ввод, но валидируем перед «чтением» (Описание/Таблица)
      if (goingToNonEditable) {
        syncFromActiveEditorIfNeeded();
      }

      setActiveTab(nextTab);

      if (nextTab === Tab.description || nextTab === Tab.tables) {
        updateNonEditableViews();
      }

      if (nextTab === Tab.toml || nextTab === Tab.csv) {
        updateEditorsFromState(false);
      }
    } catch (e) {
      logError("Ошибка при переключении вкладки", e);
      setStatus(
        "err",
        "Не удалось переключить вкладку: проверьте ввод. Подробности в консоли браузера.",
      );
    }
  };

  const hookTabEvents = () => {
    ui.tabs.description.addEventListener("click", () =>
      switchTab(Tab.description),
    );
    ui.tabs.tables.addEventListener("click", () => switchTab(Tab.tables));
    ui.tabs.toml.addEventListener("click", () => switchTab(Tab.toml));
    ui.tabs.csv.addEventListener("click", () => switchTab(Tab.csv));
    ui.tabs.hide.addEventListener("click", () => switchTab(Tab.hide));
  };

  return {
    Tab,
    setActiveTab,
    setViewsSuspended,
    switchTab,
    hookTabEvents,
  };
};
