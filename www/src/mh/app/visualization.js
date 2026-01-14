import { renderVisualization } from "../render/visualization.js";

/**
 * Контроллер визуализации.
 *
 * Отвечает за:
 * - синхронизацию `store.visualizationEnabled` с переключателем `#btnVisualize`
 * - режимы отображения (скрыто / только вкладки / только визуализация / сплит 50/50)
 * - перерисовку canvas при изменении размеров/режима
 *
 * Важно: этот модуль НЕ переключает вкладки и НЕ меняет `store.viewsSuspended`.
 * Он лишь реагирует на текущие значения `store.viewsSuspended` и `store.visualizationEnabled`.
 */

/**
 * «Высота как TOML» задаётся через CSS (дефолтная высота визуализации),
 * а не через JS и не «в реальном времени».
 */

/**
 * @param {any} ui
 * @param {any} store
 */
const applyLayout = (ui, store) => {
  const viewsLayout = ui.viewsLayout;
  const tabPanels = ui.tabPanels;
  const vizPanel = ui.visualization.panel;

  if (!viewsLayout || !tabPanels || !vizPanel) return;

  const hideActive = !!store.viewsSuspended;
  const vizActive = !!store.visualizationEnabled;

  // Сброс «сплита» до базового состояния.
  const setSplit = (split) => {
    if (split) {
      viewsLayout.style.display = "flex";
      viewsLayout.style.alignItems = "flex-start";
      viewsLayout.style.gap = "12px";

      tabPanels.style.flex = "1 1 0";
      tabPanels.style.minWidth = "0";

      vizPanel.style.flex = "1 1 0";
      vizPanel.style.minWidth = "0";
    } else {
      viewsLayout.style.display = "";
      viewsLayout.style.alignItems = "";
      viewsLayout.style.gap = "";

      tabPanels.style.flex = "";
      tabPanels.style.minWidth = "";

      vizPanel.style.flex = "";
      vizPanel.style.minWidth = "";
    }
  };

  // Скрыть active, Визуализировать inactive: ничего не показываем под панелью управления.
  if (hideActive && !vizActive) {
    viewsLayout.hidden = true;
    vizPanel.hidden = true;
    // `tabPanels.hidden` управляется вкладками, но на всякий случай не раскрываем.
    return;
  }

  // В остальных режимах сам layout видим.
  viewsLayout.hidden = false;

  // Скрыть inactive, Визуализировать inactive: только активное представление вкладок.
  if (!hideActive && !vizActive) {
    vizPanel.hidden = true;
    tabPanels.hidden = false;
    setSplit(false);
    return;
  }

  // Скрыть active, Визуализировать active: только визуализация.
  if (hideActive && vizActive) {
    vizPanel.hidden = false;
    tabPanels.hidden = true; // вкладки «заморожены», но визуализацию показываем
    setSplit(false);
    return;
  }

  // Скрыть inactive, Визуализировать active: сплит 50/50 (слева активная вкладка, справа визуализация).
  vizPanel.hidden = false;
  tabPanels.hidden = false;
  setSplit(true);
};

/**
 * @param {any} ui
 * @param {any} store
 * @param {{ force?: boolean }} [opts]
 */
const redraw = (ui, store, opts = {}) => {
  const vizPanel = ui?.visualization?.panel;
  const canvas = ui?.visualization?.canvas;

  if (!vizPanel || !canvas) return;
  if (vizPanel.hidden) return;
  if (!store.visualizationEnabled && !opts.force) return;

  // Высота визуализации задаётся через CSS; JS не управляет дефолтной высотой.

  const r = canvas.getBoundingClientRect();
  if (!Number.isFinite(r.width) || r.width <= 0) return;
  if (!Number.isFinite(r.height) || r.height <= 0) return;

  renderVisualization({ canvas });
};

/**
 * Создать контроллер визуализации.
 *
 * Ожидается, что вызывающий код будет дергать `controller.apply()`:
 * - после переключения вкладок (включая «Скрыть»)
 * - после изменений, влияющих на размеры (если не хватает ResizeObserver)
 *
 * @param {object} deps
 * @param {any} deps.ui
 * @param {any} deps.store
 */
export const createVisualizationController = ({ ui, store }) => {
  let rafId = 0;
  /** @type {ResizeObserver | null} */
  let ro = null;

  const scheduleRedraw = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      redraw(ui, store);
    });
  };

  const syncStoreFromToggle = () => {
    const btn = ui?.toggles?.visualize;
    if (!btn) return;
    store.visualizationEnabled = btn.getAttribute("aria-pressed") === "true";
  };

  const apply = () => {
    applyLayout(ui, store);
    scheduleRedraw();
  };

  const hookEvents = () => {
    // Переключатель «Визуализировать».
    // Важно: `setupToggle("#btnVisualize")` уже меняет aria-pressed.
    // Здесь мы лишь синхронизируем store и применяем режим.
    if (ui?.toggles?.visualize) {
      ui.toggles.visualize.addEventListener("click", () => {
        syncStoreFromToggle();
        apply();
      });
    }

    // Перерисовка при resize окна.
    window.addEventListener("resize", () => {
      if (!store.visualizationEnabled) return;
      scheduleRedraw();
    });

    // ResizeObserver: следим за изменениями размеров контейнера (сплит/скрыть/перестроение layout).
    if (typeof ResizeObserver !== "undefined" && ui?.viewsLayout) {
      ro = new ResizeObserver(() => {
        if (!store.visualizationEnabled) return;
        if (ui.visualization?.panel?.hidden) return;
        scheduleRedraw();
      });
      ro.observe(ui.viewsLayout);
    }
  };

  const destroy = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;

    if (ro) {
      ro.disconnect();
      ro = null;
    }
  };

  // Инициализация состояния из текущего UI.
  syncStoreFromToggle();

  /**
   * Программно включить/выключить визуализацию.
   *
   * Почему: режимы могут управляться не только кликом пользователя (например, тестовым режимом).
   *
   * @param {boolean} enabled
   */
  const setEnabled = (enabled) => {
    const pressed = !!enabled;
    store.visualizationEnabled = pressed;

    const btn = ui?.toggles?.visualize;
    if (btn) btn.setAttribute("aria-pressed", pressed ? "true" : "false");

    apply();
  };

  return {
    hookEvents,
    apply,
    setEnabled,
    redraw: () => redraw(ui, store, { force: true }),
    destroy,
  };
};
