import { renderVisualization } from "../render/visualization.js";
import { renderEquivalentCurves } from "../render/equivalent_curves.js";
import {
  buildZigSystem,
  dumpZigList,
  describeZigError,
} from "../zig/interop.js";

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
 *
 * Важно:
 * - контроллер НЕ «следит» за высотой TOML и не пытается синхронизировать её с canvas
 * - но контроллер может увеличить высоту canvas, если потоков много (чтобы не сжимать линии и подписи)
 * - обратно к CSS-дефолту возвращаемся, когда увеличение больше не нужно
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

  // Высота «как TOML» — это CSS-дефолт. Но если потоков много, увеличиваем canvas по высоте,
  // чтобы сохранить читаемые отступы и подписи. Когда рост не нужен — возвращаемся к CSS-дефолту.
  const state = store?.state;
  const hotN = Array.isArray(state?.hot) ? state.hot.length : 0;
  const coldN = Array.isArray(state?.cold) ? state.cold.length : 0;
  const n = hotN + coldN;

  // Запоминаем CSS-дефолтную высоту (без inline) один раз, чтобы можно было «вернуться назад».
  if (!canvas.dataset.mhVizBaseHeightPx) {
    const prev = canvas.style.height;
    canvas.style.height = "";
    const baseRect = canvas.getBoundingClientRect();
    canvas.style.height = prev;
    const baseH = Math.floor(baseRect.height);
    if (Number.isFinite(baseH) && baseH > 0) {
      canvas.dataset.mhVizBaseHeightPx = String(baseH);
    }
  }

  const baseH = Number(canvas.dataset.mhVizBaseHeightPx || "0");

  // Грубая оценка: одна «строка» на поток + поля под подписи.
  // Промежуточные температуры по аппаратам не рисуем, поэтому этого достаточно.
  let requiredH = 0;
  if (n > 0) {
    const padTop = 24;
    const padBottom = 44; // + место под двухстрочные подписи нагрузок
    const rowStep = 28;

    // В рендере зазор между группами (между нижним hot и верхним cold) больше обычного шага.
    // Здесь важно добавить только «добавку» сверх уже учтённого шага (rowStep), иначе будет двойной учёт.
    // В render/visualization.js: groupGap = gap + 22, при gap == rowStep == 28 => extra = 22.
    const groupGapExtra = hotN > 0 && coldN > 0 ? 22 : 0;

    requiredH = padTop + padBottom + (n - 1) * rowStep + groupGapExtra;
  }

  // Если требуемая высота не превышает CSS-дефолт — убираем inline height.
  // Если превышает — задаём inline height (только увеличиваем, ширину не трогаем).
  if (Number.isFinite(baseH) && baseH > 0 && requiredH > 0) {
    if (requiredH <= baseH + 1) {
      if (canvas.style.height) canvas.style.height = "";
    } else {
      const hPx = Math.ceil(requiredH);
      if (canvas.dataset.mhVizHeightPx !== String(hPx)) {
        canvas.style.height = `${hPx}px`;
        canvas.dataset.mhVizHeightPx = String(hPx);
      }
    }
  }

  // При наличии ячеек удерживаем постоянный шаг по X, расширяя canvas по ширине (min-width),
  // чтобы расстояния между ячейками не сжимались, а появлялась горизонтальная прокрутка.
  const exch = Array.isArray(state?.exchanger) ? state.exchanger : [];
  const cellCount = exch.filter(
    (ex) =>
      ex &&
      ex.hot !== null &&
      ex.hot !== undefined &&
      ex.cold !== null &&
      ex.cold !== undefined,
  ).length;

  const curW = canvas.getBoundingClientRect().width;

  if (cellCount > 0 && Number.isFinite(curW) && curW > 0) {
    // Эти константы должны соответствовать геометрии рендера.
    const PAD = 12;
    const LEFT_GUTTER = 82;
    const RIGHT_GUTTER = 110;
    const MIN_SPAN = 40;

    const UTIL_INSET = 40;
    const DX_CELL = 60; // постоянный шаг между ячейками
    const CELL_LEFT_MARGIN = 24; // небольшой воздух до первой ячейки

    const requiredSpan =
      UTIL_INSET + CELL_LEFT_MARGIN + DX_CELL * Math.max(1, cellCount);

    const requiredMinWidth =
      PAD * 2 + LEFT_GUTTER + RIGHT_GUTTER + Math.max(MIN_SPAN, requiredSpan);

    const targetMinW = Math.ceil(requiredMinWidth);
    const prevMinW = Number(canvas.dataset.mhVizMinWidthPx || "0");

    if (targetMinW > curW + 1) {
      if (prevMinW !== targetMinW) {
        canvas.style.minWidth = `${targetMinW}px`;
        canvas.dataset.mhVizMinWidthPx = String(targetMinW);
      }
    } else {
      if (canvas.style.minWidth) canvas.style.minWidth = "";
      canvas.dataset.mhVizMinWidthPx = "0";
    }
  } else {
    if (canvas.style.minWidth) canvas.style.minWidth = "";
    canvas.dataset.mhVizMinWidthPx = "0";
  }

  const r = canvas.getBoundingClientRect();
  if (!Number.isFinite(r.width) || r.width <= 0) return;
  if (!Number.isFinite(r.height) || r.height <= 0) return;

  // Режим эквивалентных кривых: вместо схемы сети рисуем T+(Q) и T-(Q).
  if (store.eqCurvesEnabled) {
    const mh = opts?.multiheat;

    const renderError = (msg) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || rect.width <= 0) return;
      if (!Number.isFinite(rect.height) || rect.height <= 0) return;

      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      const wCss = Math.max(1, Math.floor(rect.width));
      const hCss = Math.max(1, Math.floor(rect.height));

      const wPx = wCss * dpr;
      const hPx = hCss * dpr;

      if (canvas.width !== wPx) canvas.width = wPx;
      if (canvas.height !== hPx) canvas.height = hPx;

      // Работаем в CSS-координатах.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);

      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = "#0f172a";

      const pad = 12;
      const text = String(msg ?? "");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], pad, pad + i * 16);
      }
    };

    if (!mh || typeof mh.computeEquivalentCurves !== "function") {
      renderError(
        "Эквивалентные кривые недоступны: Zig-модуль не инициализирован.",
      );
      return;
    }

    try {
      // Важно: берём текущее каноническое состояние (как для solve/verify).
      // Аппараты решения для построения эквивалентных кривых не нужны.
      const system = buildZigSystem(mh, state, false);

      const zigCurves = mh.computeEquivalentCurves(system);

      const hot = dumpZigList(zigCurves.hot).map((p) => ({
        q_MW: Number(p.q_MW),
        temp_K: Number(p.temp_K),
      }));
      const cold = dumpZigList(zigCurves.cold).map((p) => ({
        q_MW: Number(p.q_MW),
        temp_K: Number(p.temp_K),
      }));

      const curves = {
        dt_min_K: Number(zigCurves.dt_min_K),
        hot,
        cold,
      };

      renderEquivalentCurves({ canvas, curves });

      // Освобождение памяти, выделенной в Zig.
      // Важно: ошибки освобождения не должны ломать уже выполненную отрисовку.
      if (typeof mh.freeEquivalentCurves === "function") {
        try {
          mh.freeEquivalentCurves(zigCurves);
        } catch (freeErr) {
          console.warn(
            "Не удалось освободить память эквивалентных кривых:",
            freeErr,
          );
        }
      }
    } catch (e) {
      // Почему: визуализация не должна «падать» из-за ошибок вычисления.
      console.error("Не удалось построить эквивалентные кривые:", e);
      renderError(`Ошибка: ${describeZigError(e)}`);
    }

    return;
  }

  renderVisualization({ canvas, state });
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
export const createVisualizationController = ({ ui, store, multiheat }) => {
  let rafId = 0;
  /** @type {ResizeObserver | null} */
  let ro = null;

  const scheduleRedraw = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      redraw(ui, store, { multiheat });
    });
  };

  const syncStoreFromToggle = () => {
    const btn = ui?.toggles?.visualize;
    if (!btn) return;
    store.visualizationEnabled = btn.getAttribute("aria-pressed") === "true";
  };

  const syncEqCurvesFromToggle = () => {
    const btn = ui?.toggles?.eqCurves;
    if (!btn) return;
    store.eqCurvesEnabled = btn.getAttribute("aria-pressed") === "true";
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

        // Если визуализация выключена (в том числе вручную пользователем) —
        // режим эквивалентных кривых автоматически сбрасываем.
        if (!store.visualizationEnabled) {
          store.eqCurvesEnabled = false;
          const eqBtn = ui?.toggles?.eqCurves;
          if (eqBtn) eqBtn.setAttribute("aria-pressed", "false");
        }

        apply();
      });
    }

    // Переключатель «Эквивалентные кривые».
    // Важно: это только режим отрисовки. При включении автоматически включаем панель визуализации.
    if (ui?.toggles?.eqCurves) {
      ui.toggles.eqCurves.addEventListener("click", () => {
        syncEqCurvesFromToggle();

        if (store.eqCurvesEnabled) {
          store.visualizationEnabled = true;
          const vizBtn = ui?.toggles?.visualize;
          if (vizBtn) vizBtn.setAttribute("aria-pressed", "true");
        }

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
  syncEqCurvesFromToggle();

  // Если эквивалентные кривые включены, а визуализация выключена — включаем визуализацию,
  // иначе панель может остаться скрытой.
  if (store.eqCurvesEnabled && !store.visualizationEnabled) {
    store.visualizationEnabled = true;
    const vizBtn = ui?.toggles?.visualize;
    if (vizBtn) vizBtn.setAttribute("aria-pressed", "true");
  }

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

    // Почему: при программном отключении визуализации (например, тестовым режимом)
    // режим эквивалентных кривых должен быть сброшен, чтобы не оставаться "включённым в фоне".
    if (!pressed) {
      store.eqCurvesEnabled = false;
      const eqBtn = ui?.toggles?.eqCurves;
      if (eqBtn) eqBtn.setAttribute("aria-pressed", "false");
    }

    apply();
  };

  return {
    hookEvents,
    apply,
    setEnabled,
    redraw: () => redraw(ui, store, { force: true, multiheat }),
    destroy,
  };
};
