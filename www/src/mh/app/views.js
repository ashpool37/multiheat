/**
 * View refresh coordinator.
 *
 * Responsibilities:
 * - Keep non-editable views (Description/Tables) in sync with canonical state.
 * - Keep editor views (TOML/CSV textareas) in sync with canonical state,
 *   respecting dirty flags and focused editors.
 * - Implement the "Hide" mode behavior via `viewsSuspended`.
 *
 * This module is designed to preserve behavior/performance of the prior
 * monolithic implementation in `main.js`.
 */

/**
 * Create a coordinator bound to the app's `store` + `ui`.
 *
 * Required dependencies are injected to keep this module decoupled:
 * - emitters: `emitToml`, `emitCsvStreams`, `emitCsvSolution`
 * - renderers: `renderDescriptionHtml`, `renderTables`
 *
 * @param {object} deps
 * @param {object} deps.store
 * @param {object} deps.ui
 * @param {(state:any)=>string} deps.emitToml
 * @param {(state:any)=>string} deps.emitCsvStreams
 * @param {(state:any)=>string} deps.emitCsvSolution
 * @param {(state:any, host:HTMLElement)=>void} deps.renderDescriptionHtml
 * @param {(state:any, ui:any)=>void} deps.renderTables
 */
export const createViewsCoordinator = ({
  store,
  ui,
  emitToml,
  emitCsvStreams,
  emitCsvSolution,
  renderDescriptionHtml,
  renderTables,
}) => {
  const updateNonEditableViews = () => {
    if (store.viewsSuspended) return;
    renderDescriptionHtml(store.state, ui.description.pre);
    renderTables(store.state, ui);
  };

  /**
   * Update editor textareas from canonical state.
   *
   * Matches previous behavior:
   * - do nothing when views are suspended
   * - do not overwrite a textarea while it's focused AND marked dirty,
   *   unless `force === true`
   *
   * @param {boolean} [force=false]
   */
  const updateEditorsFromState = (force = false) => {
    if (store.viewsSuspended) return;

    const tomlText = emitToml(store.state);
    const csvStreams = emitCsvStreams(store.state);
    const csvSolution = emitCsvSolution(store.state);

    if (
      force ||
      (!store.dirty.toml && document.activeElement !== ui.toml.textarea)
    ) {
      ui.toml.textarea.value = tomlText;
      store.dirty.toml = false;
    }

    if (
      force ||
      (!store.dirty.csvStreams &&
        document.activeElement !== ui.csv.streamsTextarea)
    ) {
      ui.csv.streamsTextarea.value = csvStreams;
      store.dirty.csvStreams = false;
    }

    if (
      force ||
      (!store.dirty.csvSolution &&
        document.activeElement !== ui.csv.solutionTextarea)
    ) {
      ui.csv.solutionTextarea.value = csvSolution;
      store.dirty.csvSolution = false;
    }
  };

  /**
   * Refresh all views derived from canonical state.
   * Does nothing if views are suspended.
   *
   * @param {boolean} [forceEditors=false]
   */
  const refreshAllViews = (forceEditors = false) => {
    if (store.viewsSuspended) return;
    updateNonEditableViews();
    updateEditorsFromState(forceEditors);
  };

  /**
   * Toggle "Hide" mode.
   *
   * Matches previous behavior:
   * - `store.viewsSuspended` gates all view regeneration
   * - `ui.tabPanels.hidden` hides the representations area
   *
   * @param {boolean} suspended
   */
  const setViewsSuspended = (suspended) => {
    store.viewsSuspended = suspended;
    if (ui.tabPanels) ui.tabPanels.hidden = suspended;
  };

  return {
    updateNonEditableViews,
    updateEditorsFromState,
    refreshAllViews,
    setViewsSuspended,
  };
};
