import { $ } from "../util/dom.js";

/**
 * Собирает ссылки на элементы интерфейса.
 * Если обязательный элемент не найден — выбрасывает исключение.
 *
 * Примечание по новой структуре:
 * - Левая панель: вкладки (Описание/Таблица/TOML/CSV), скрывается повторным нажатием на активную вкладку.
 * - Правая панель: «настройки» и «визуализация» (включая режим «кривые») — взаимоисключающие.
 * - Генератор и селектор алгоритма перенесены в панель «настройки».
 * - Кнопка «Сгенерировать» вынесена в верхнюю панель действий (рядом с «Открыть»).
 *
 * @param {ParentNode} [root=document]
 */
export const buildUiRefs = (root = document) => {
  const q = (sel) => $(sel, root);
  const qOpt = (sel) => root.querySelector(sel);

  // Панель «настройки» теперь обязательна: без неё нет доступа к генератору и выбору алгоритма.
  const settingsPanel = q("#settingsPanel");
  const algorithmSelect = q("#selAlgorithm");

  const generator = {
    hot: {
      count: q("#genHotCount"),
      isoShare: q("#genHotIsoShare"),
      isoShareOut: q("#genHotIsoShareOut"),

      tempDist: q("#genHotTempDist"),
      tempMin: q("#genHotTempMin"),
      tempMax: q("#genHotTempMax"),
      tempMean: q("#genHotTempMean"),
      tempVar: q("#genHotTempVar"),

      loadDist: q("#genHotLoadDist"),
      loadMin: q("#genHotLoadMin"),
      loadMax: q("#genHotLoadMax"),
      loadMean: q("#genHotLoadMean"),
      loadVar: q("#genHotLoadVar"),
    },
    cold: {
      count: q("#genColdCount"),
      isoShare: q("#genColdIsoShare"),
      isoShareOut: q("#genColdIsoShareOut"),

      tempDist: q("#genColdTempDist"),
      tempMin: q("#genColdTempMin"),
      tempMax: q("#genColdTempMax"),
      tempMean: q("#genColdTempMean"),
      tempVar: q("#genColdTempVar"),

      loadDist: q("#genColdLoadDist"),
      loadMin: q("#genColdLoadMin"),
      loadMax: q("#genColdLoadMax"),
      loadMean: q("#genColdLoadMean"),
      loadVar: q("#genColdLoadVar"),
    },
  };

  return {
    status: q("#statusLabel"),

    buttons: {
      openMenu: q("#btnOpenMenu"),
      saveMenu: q("#btnSaveMenu"),

      openToml: q("#menuOpenToml"),
      openCsvStreams: q("#menuOpenCsvStreams"),
      openCsvSolution: q("#menuOpenCsvSolution"),

      saveToml: q("#menuSaveToml"),
      saveCsvStreams: q("#menuSaveCsvStreams"),
      saveCsvSolution: q("#menuSaveCsvSolution"),

      generate: q("#btnGenerate"),

      solve: q("#btnSolve"),
      verify: q("#btnVerify"),
      clear: q("#btnClear"),
    },

    toggles: {
      settings: q("#btnSettings"),
      visualize: q("#btnVisualize"),
      eqCurves: q("#btnEqCurves"),
    },

    menus: {
      open: q("#menuOpen"),
      save: q("#menuSave"),
    },

    inputs: {
      toml: q("#fileToml"),
      csvStreams: q("#fileCsvStreams"),
      csvSolution: q("#fileCsvSolution"),
    },

    tabs: {
      description: q("#tabDescription"),
      tables: q("#tabTables"),
      toml: q("#tabToml"),
      csv: q("#tabCsv"),
    },

    panels: {
      description: q("#panelDescription"),
      tables: q("#panelTables"),
      toml: q("#panelToml"),
      csv: q("#panelCsv"),
    },

    viewsLayout: q("#viewsLayout"),
    tabPanels: q("#tabPanels"),

    // Правая панель «настройки»
    settings: {
      panel: settingsPanel,
      algorithmSelect,
      generator,
    },

    // Совместимость: старый код мог ожидать ui.testMode.algorithmSelect / ui.testMode.generator.*
    // Пока оставляем алиасы, чтобы переход на новую структуру был менее ломким.
    testMode: {
      algorithmSelect,
      generator,
    },

    description: {
      pre: q("#descriptionText"),
    },

    toml: {
      textarea: q("#tomlText"),
    },

    csv: {
      streamsTextarea: q("#csvStreamsText"),
      solutionTextarea: q("#csvSolutionText"),
    },

    tables: {
      streamsTable: q("#streamsTable"),
      exchangersTable: q("#exchangersTable"),
    },

    visualization: {
      panel: q("#vizPanel"),
      canvas: q("#vizCanvas"),
    },
  };
};
