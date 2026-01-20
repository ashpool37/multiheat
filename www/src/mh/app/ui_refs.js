import { $ } from "../util/dom.js";

/**
 * Собирает ссылки на элементы интерфейса.
 * Если обязательный элемент не найден — выбрасывает исключение.
 *
 * @param {ParentNode} [root=document]
 */
export const buildUiRefs = (root = document) => {
  const q = (sel) => $(sel, root);
  const qOpt = (sel) => root.querySelector(sel);

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

      solve: q("#btnSolve"),
      verify: q("#btnVerify"),
      clear: q("#btnClear"),
    },

    toggles: {
      visualize: q("#btnVisualize"),
      eqCurves: q("#btnEqCurves"),
      test: q("#btnTest"),
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
      hide: q("#tabHide"),
    },

    panels: {
      description: q("#panelDescription"),
      tables: q("#panelTables"),
      toml: q("#panelToml"),
      csv: q("#panelCsv"),
      hide: q("#panelHide"),
    },

    viewsLayout: q("#viewsLayout"),
    tabPanels: q("#tabPanels"),
    testModeBlock: q("#testModeBlock"),

    testMode: {
      algorithmSelect: qOpt("#selAlgorithm"),

      // Генератор случайных систем (элементы могут отсутствовать, если панель ещё не дорисована).
      generator: {
        hot: {
          count: qOpt("#genHotCount"),
          isoPct: qOpt("#genHotIsoShare"),
          tempDist: qOpt("#genHotTempDist"),
          tempMin: qOpt("#genHotTempMin"),
          tempMax: qOpt("#genHotTempMax"),
          tempMean: qOpt("#genHotTempMean"),
          tempVar: qOpt("#genHotTempVar"),
          loadDist: qOpt("#genHotLoadDist"),
          loadMin: qOpt("#genHotLoadMin"),
          loadMax: qOpt("#genHotLoadMax"),
          loadMean: qOpt("#genHotLoadMean"),
          loadVar: qOpt("#genHotLoadVar"),
        },
        cold: {
          count: qOpt("#genColdCount"),
          isoPct: qOpt("#genColdIsoShare"),
          tempDist: qOpt("#genColdTempDist"),
          tempMin: qOpt("#genColdTempMin"),
          tempMax: qOpt("#genColdTempMax"),
          tempMean: qOpt("#genColdTempMean"),
          tempVar: qOpt("#genColdTempVar"),
          loadDist: qOpt("#genColdLoadDist"),
          loadMin: qOpt("#genColdLoadMin"),
          loadMax: qOpt("#genColdLoadMax"),
          loadMean: qOpt("#genColdLoadMean"),
          loadVar: qOpt("#genColdLoadVar"),
        },
        generateButton: qOpt("#btnGenerate"),
      },
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
