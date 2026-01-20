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
  const vizPanel = ui?.visualization?.panel;

  // Панель «Настройки» может жить рядом с визуализацией и вести себя так же.
  // Важно: панель необязательная, чтобы приложение не ломалось до обновления разметки.
  const settingsPanel =
    ui?.settings?.panel ?? document.querySelector("#settingsPanel");

  if (!viewsLayout || !tabPanels) return;

  const hideActive = !!store.viewsSuspended;
  const vizActive = !!store.visualizationEnabled;
  const settingsActive = !!store.settingsEnabled;

  const rightActive = vizActive || settingsActive;

  const hideAllRightPanels = () => {
    if (vizPanel) vizPanel.hidden = true;
    if (settingsPanel) settingsPanel.hidden = true;
  };

  const showRightPanel = () => {
    hideAllRightPanels();
    if (settingsActive) {
      if (settingsPanel) settingsPanel.hidden = false;
    } else if (vizActive) {
      if (vizPanel) vizPanel.hidden = false;
    }
  };

  // Сброс «сплита» до базового состояния.
  //
  // Адаптивное поведение:
  // - на широких экранах: 50/50 слева вкладки, справа активная правая панель
  // - на узких экранах: правая панель должна быть НАД вкладками (вертикальная раскладка)
  const setSplit = (split) => {
    const narrow =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 860px)").matches;

    if (split) {
      viewsLayout.style.display = "flex";
      viewsLayout.style.gap = "12px";

      if (narrow) {
        // Узкий экран: правая панель сверху, вкладки снизу.
        viewsLayout.style.flexDirection = "column";
        viewsLayout.style.alignItems = "stretch";

        tabPanels.style.order = "2";
        tabPanels.style.flex = "1 1 auto";
        tabPanels.style.minWidth = "0";

        if (vizPanel) {
          vizPanel.style.order = "1";
          vizPanel.style.flex = "0 0 auto";
          vizPanel.style.minWidth = "0";
        }
        if (settingsPanel) {
          settingsPanel.style.order = "1";
          settingsPanel.style.flex = "0 0 auto";
          settingsPanel.style.minWidth = "0";
        }
      } else {
        // Широкий экран: классический сплит 50/50.
        viewsLayout.style.flexDirection = "row";
        viewsLayout.style.alignItems = "flex-start";

        tabPanels.style.order = "";
        tabPanels.style.flex = "1 1 0";
        tabPanels.style.minWidth = "0";

        if (vizPanel) {
          vizPanel.style.order = "";
          vizPanel.style.flex = "1 1 0";
          vizPanel.style.minWidth = "0";
        }
        if (settingsPanel) {
          settingsPanel.style.order = "";
          settingsPanel.style.flex = "1 1 0";
          settingsPanel.style.minWidth = "0";
        }
      }
    } else {
      viewsLayout.style.display = "";
      viewsLayout.style.alignItems = "";
      viewsLayout.style.gap = "";
      viewsLayout.style.flexDirection = "";

      tabPanels.style.order = "";
      tabPanels.style.flex = "";
      tabPanels.style.minWidth = "";

      if (vizPanel) {
        vizPanel.style.order = "";
        vizPanel.style.flex = "";
        vizPanel.style.minWidth = "";
      }
      if (settingsPanel) {
        settingsPanel.style.order = "";
        settingsPanel.style.flex = "";
        settingsPanel.style.minWidth = "";
      }
    }
  };

  // «Скрыть» active и справа ничего не открыто: ничего не показываем под панелью управления.
  if (hideActive && !rightActive) {
    viewsLayout.hidden = true;
    hideAllRightPanels();
    // `tabPanels.hidden` управляется вкладками, но на всякий случай не раскрываем.
    return;
  }

  // В остальных режимах сам layout видим.
  viewsLayout.hidden = false;

  // Обычный режим: только активное представление вкладок.
  if (!hideActive && !rightActive) {
    hideAllRightPanels();
    tabPanels.hidden = false;
    setSplit(false);
    return;
  }

  // «Скрыть» active и справа что-то открыто: показываем только правую панель.
  if (hideActive && rightActive) {
    showRightPanel();
    tabPanels.hidden = true; // вкладки «заморожены», но правую панель показываем
    setSplit(false);
    return;
  }

  // Вкладки слева + активная правая панель: сплит 50/50.
  showRightPanel();
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

  // Важно: сравниваем требуемую ширину с шириной ПАНЕЛИ визуализации, а не canvas.
  // Почему: при split-раскладке/переключениях кнопок размеры могут кратковременно «скакать»,
  // и `canvas.getBoundingClientRect().width` не всегда отражает доступную ширину контейнера,
  // из-за чего min-width не выставляется и ячейки «уезжают» влево за границу.
  const panelRectW = vizPanel?.getBoundingClientRect?.().width ?? 0;

  // Сравниваем с «контентной» шириной панели (без padding), иначе min-width может не выставиться
  // и ячейки уйдут влево за границу canvas/панели.
  let contentW = panelRectW;
  if (vizPanel && Number.isFinite(panelRectW) && panelRectW > 0) {
    const cs = window.getComputedStyle(vizPanel);
    const padL = Number.parseFloat(cs.paddingLeft || "0") || 0;
    const padR = Number.parseFloat(cs.paddingRight || "0") || 0;
    contentW = Math.max(0, panelRectW - padL - padR);
  }

  const baseW =
    Number.isFinite(contentW) && contentW > 0
      ? contentW
      : canvas.getBoundingClientRect().width;

  if (cellCount > 0 && Number.isFinite(baseW) && baseW > 0) {
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

    // Если контент шире контейнера — расширяем canvas через min-width,
    // а прокрутку обеспечит сама панель (overflow-x: auto).
    if (targetMinW > baseW + 1) {
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

  /**
   * Получить активную «правую вкладку» из store.
   *
   * Важно: «кривые» — это отдельная правая вкладка, но отображается внутри панели визуализации.
   *
   * @returns {"none"|"settings"|"viz"|"curves"}
   */
  const getRightKindFromStore = () => {
    if (store.settingsEnabled) return "settings";
    if (store.eqCurvesEnabled) return "curves";
    if (store.visualizationEnabled) return "viz";
    return "none";
  };

  /** @param {HTMLElement|null} btn @param {boolean} pressed */
  const setPressed = (btn, pressed) => {
    if (!btn) return;
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
  };

  /**
   * Установить активную правую вкладку (строго взаимоисключающую).
   *
   * Почему: мы НЕ полагаемся на внешний «авто-тоггл» aria-pressed — управляем состоянием здесь,
   * чтобы правая система вкладок была консистентной.
   *
   * @param {"none"|"settings"|"viz"|"curves"} kind
   */
  const setRightKind = (kind) => {
    const vizBtn = ui?.toggles?.visualize ?? null;
    const eqBtn = ui?.toggles?.eqCurves ?? null;
    const settingsBtn = ui?.toggles?.settings ?? null;

    const enableSettings = kind === "settings";
    const enableCurves = kind === "curves";
    const enableViz = kind === "viz" || enableCurves;

    // Важно: «кривые» — это отдельная правая вкладка, но отображается внутри панели визуализации.
    store.settingsEnabled = enableSettings;
    store.visualizationEnabled = enableViz;
    store.eqCurvesEnabled = enableCurves;

    setPressed(settingsBtn, enableSettings);

    // «Кривые» показываются в панели визуализации, но кнопка «Визуализировать» при этом не нажата.
    // Поэтому `store.visualizationEnabled` может быть true, а `btnVisualize[aria-pressed]` — false.
    setPressed(vizBtn, kind === "viz");
    setPressed(eqBtn, enableCurves);
  };

  const apply = () => {
    applyLayout(ui, store);
    scheduleRedraw();
  };

  const hookEvents = () => {
    // Правая «система вкладок»: взаимоисключающее поведение + повторное нажатие закрывает панель.

    if (ui?.toggles?.visualize) {
      ui.toggles.visualize.addEventListener("click", () => {
        const active = store.visualizationEnabled && !store.eqCurvesEnabled;
        setRightKind(active ? "none" : "viz");
        apply();
      });
    }

    if (ui?.toggles?.eqCurves) {
      ui.toggles.eqCurves.addEventListener("click", () => {
        const active = store.visualizationEnabled && store.eqCurvesEnabled;
        setRightKind(active ? "none" : "curves");
        apply();
      });
    }

    if (ui?.toggles?.settings) {
      ui.toggles.settings.addEventListener("click", () => {
        const active = store.settingsEnabled;
        setRightKind(active ? "none" : "settings");
        apply();
      });
    }

    // Обновление при resize окна.
    //
    // Важно:
    // - раскладка должна пересчитываться всегда, потому что на узких экранах правая панель
    //   должна переходить в режим "сверху над вкладками"
    // - перерисовку canvas выполняем только когда визуализация действительно активна
    window.addEventListener("resize", () => {
      applyLayout(ui, store);

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

  // Инициализация состояния из текущего UI:
  // читаем начальные aria-pressed (если они выставлены разметкой), затем нормализуем правую панель.
  const readPressed = (btn) => btn?.getAttribute("aria-pressed") === "true";

  store.settingsEnabled = readPressed(ui?.toggles?.settings);
  store.visualizationEnabled = readPressed(ui?.toggles?.visualize);
  store.eqCurvesEnabled = readPressed(ui?.toggles?.eqCurves);

  // Приоритет: настройки > кривые > визуализация > ничего
  if (store.settingsEnabled) setRightKind("settings");
  else if (store.eqCurvesEnabled) setRightKind("curves");
  else if (store.visualizationEnabled) setRightKind("viz");
  else setRightKind("none");

  /**
   * Программно включить/выключить визуализацию.
   *
   * Почему: режимы могут управляться не только кликом пользователя (например, тестовым режимом).
   *
   * @param {boolean} enabled
   */
  const setEnabled = (enabled) => {
    setRightKind(enabled ? "viz" : "none");
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
