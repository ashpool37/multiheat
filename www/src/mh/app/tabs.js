/**
 * Контроллер вкладок.
 *
 * Правила:
 * - «Скрытие» реализовано через `store.viewsSuspended` и `ui.tabPanels.hidden`
 * - клик по уже активной вкладке переключает скрытие/показ левой панели
 * - при переходе на «Описание»/«Таблица» сначала синхронизируем активный редактор
 * - при выходе из режима скрытия возобновляем обновления и принудительно обновляем представления
 */

/** @readonly */
export const Tab = {
  description: "description",
  tables: "tables",
  toml: "toml",
  csv: "csv",
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
 * @param {(info: { ui: any, store: any }) => void} [deps.onUiModeChange] Хук: вызывается после изменения режима/разметки (вкладка/«Скрыть»)
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
  onUiModeChange,
}) => {
  const setActiveTab = (tab, notify = true) => {
    store.activeTab = tab;

    for (const [k, btn] of Object.entries(ui.tabs)) {
      const active = k === tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }

    for (const [k, panel] of Object.entries(ui.panels)) {
      panel.hidden = k !== tab;
    }

    if (notify && typeof onUiModeChange === "function") {
      onUiModeChange({ ui, store });
    }
  };

  const setViewsSuspended = (suspended, notify = true) => {
    store.viewsSuspended = suspended;
    if (ui.tabPanels) ui.tabPanels.hidden = suspended;

    if (notify && typeof onUiModeChange === "function") {
      onUiModeChange({ ui, store });
    }
  };

  const switchTab = (nextTab) => {
    try {
      // Если панель была скрыта, при переходе на другую вкладку сначала раскрываем и обновляем.
      if (store.viewsSuspended) {
        setViewsSuspended(false, false);
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
    /**
     * Клик по вкладке:
     * - если это уже активная вкладка — переключаем скрытие/показ левой панели
     * - иначе — обычное переключение вкладки (с авто-раскрытием, если панель была скрыта)
     *
     * @param {string} tab
     */
    const onTabClick = (tab) => {
      if (store.activeTab === tab) {
        const nextSuspended = !store.viewsSuspended;
        setViewsSuspended(nextSuspended, true);

        // Если раскрыли панель — обновляем представления, чтобы отразить изменения, сделанные в скрытом режиме.
        if (!nextSuspended) {
          refreshAllViews(true);
        }

        return;
      }

      switchTab(tab);
    };

    ui.tabs.description.addEventListener("click", () =>
      onTabClick(Tab.description),
    );
    ui.tabs.tables.addEventListener("click", () => onTabClick(Tab.tables));
    ui.tabs.toml.addEventListener("click", () => onTabClick(Tab.toml));
    ui.tabs.csv.addEventListener("click", () => onTabClick(Tab.csv));
  };

  return {
    Tab,
    setActiveTab,
    setViewsSuspended,
    switchTab,
    hookTabEvents,
  };
};
