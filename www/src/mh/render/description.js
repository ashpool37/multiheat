import { fmtNum } from "../util/number.js";

/**
 * Render the human-readable description view into a host element.
 * Behavior is intentionally kept identical to the original monolithic `main.js`.
 *
 * @param {object} state Canonical state ({ hot, cold, exchanger })
 * @param {HTMLElement} host Container element to render into
 */
export const renderDescriptionHtml = (state, host) => {
  host.innerHTML = "";

  const addSection = (title, items) => {
    const h = document.createElement("h3");
    h.textContent = title;
    host.appendChild(h);

    const ul = document.createElement("ul");
    for (const text of items) {
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    }
    host.appendChild(ul);
  };

  const streamRate = (s) => {
    if (s.rate !== undefined) return Number(s.rate);
    return Number(s.load) / Math.abs(Number(s.out) - Number(s.in));
  };

  const hotItems = [];
  for (let i = 0; i < state.hot.length; i++) {
    const s = state.hot[i];
    const id = `H${i + 1}`;
    if (s.out === undefined) {
      hotItems.push(
        `${id}. Изотермический. Температура: ${fmtNum(s.in)} К. Нагрузка: ${fmtNum(s.load)} МВт.`,
      );
    } else {
      const rate = streamRate(s);
      hotItems.push(
        `${id}. Охлаждающийся. Температура: с ${fmtNum(s.in)} К до ${fmtNum(s.out)} К. Потоковая теплоёмкость: ${fmtNum(rate)} МВт/К.`,
      );
    }
  }

  const coldItems = [];
  for (let i = 0; i < state.cold.length; i++) {
    const s = state.cold[i];
    const id = `C${i + 1}`;
    if (s.out === undefined) {
      coldItems.push(
        `${id}. Изотермический. Температура: ${fmtNum(s.in)} К. Нагрузка: ${fmtNum(s.load)} МВт.`,
      );
    } else {
      const rate = streamRate(s);
      coldItems.push(
        `${id}. Нагревающийся. Температура: с ${fmtNum(s.in)} К до ${fmtNum(s.out)} К. Потоковая теплоёмкость: ${fmtNum(rate)} МВт/К.`,
      );
    }
  }

  const exchItems = [];
  const exch = Array.isArray(state.exchanger) ? state.exchanger : [];
  if (exch.length !== 0) {
    for (let i = 0; i < exch.length; i++) {
      const ex = exch[i];
      const id = `E${i + 1}`;
      const hasH = ex.hot !== null && ex.hot !== undefined;
      const hasC = ex.cold !== null && ex.cold !== undefined;

      if (hasH && hasC) {
        exchItems.push(
          `${id}. Ячейка теплообмена. Потоки: H${Number(ex.hot) + 1}, C${Number(ex.cold) + 1}. Нагрузка: ${fmtNum(ex.load)} МВт.`,
        );
      } else if (hasH && !hasC) {
        exchItems.push(
          `${id}. Холодильник. Поток: H${Number(ex.hot) + 1}. Нагрузка: ${fmtNum(ex.load)} МВт.`,
        );
      } else if (!hasH && hasC) {
        exchItems.push(
          `${id}. Нагреватель. Поток: C${Number(ex.cold) + 1}. Нагрузка: ${fmtNum(ex.load)} МВт.`,
        );
      } else {
        exchItems.push(`${id}. Некорректная запись теплообменника.`);
      }
    }
  }

  addSection("Потоки, отдающие тепло", hotItems);
  addSection("Потоки, получающие тепло", coldItems);
  addSection("Система теплообмена", exchItems);
};
