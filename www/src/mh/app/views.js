/**
 * Координатор обновления представлений.
 *
 * Синхронизирует:
 * - неизменяемые представления (Описание/Таблицы) с `store.state`
 * - редакторы (TOML/CSV) с учётом `store.dirty` и фокуса
 *
 * Режим «Скрыть» реализован через `store.viewsSuspended`.
 */

/**
 * Создать координатор обновления представлений для `store` и `ui`.
 *
 * Зависимости передаются извне:
 * - эмиттеры: `emitToml`, `emitCsvStreams`, `emitCsvSolution`
 * - рендереры: `renderDescriptionHtml`, `renderTables`
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
   * Обновить редакторы (textarea) из канонического состояния.
   *
   * Правила:
   * - при `store.viewsSuspended` ничего не делаем
   * - не перезаписываем редактор, если он в фокусе и помечен как dirty (кроме `force === true`)
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
   * Обновить все представления, если они не приостановлены.
   *
   * @param {boolean} [forceEditors=false]
   */
  const refreshAllViews = (forceEditors = false) => {
    if (store.viewsSuspended) return;
    updateNonEditableViews();
    updateEditorsFromState(forceEditors);
  };

  /**
   * Включить/выключить режим «Скрыть» (приостановка регенерации представлений).
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
