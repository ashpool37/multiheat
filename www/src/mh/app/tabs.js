/**
 * Tab controller.
 *
 * Extracted from the previous monolithic `main.js` without changing behavior:
 * - "Hide" tab suspends view updates (`store.viewsSuspended = true`) and hides `ui.tabPanels`
 * - Switching to non-editable views (Description/Table) validates/syncs active editors first
 * - Switching away from Hide re-enables views and forces a full refresh
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
 * @param {object} deps
 * @param {any} deps.ui
 * @param {any} deps.store
 * @param {(forceEditors?: boolean) => void} deps.refreshAllViews
 * @param {() => void} deps.updateNonEditableViews
 * @param {(force?: boolean) => void} deps.updateEditorsFromState
 * @param {() => void} deps.syncFromActiveEditorIfNeeded
 * @param {(context: string, e: unknown) => void} deps.logError
 * @param {("ok"|"warn"|"err", message: string) => void} deps.setStatus
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

      // Why: don't validate on every paste/keystroke, but validate before "reading" (Description/Table)
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
