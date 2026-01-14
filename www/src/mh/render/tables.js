import { fmtNum } from "../util/number.js";

/**
 * `renderTable(tableEl, headers, rows)` — перерисовать таблицу.
 *
 * @param {HTMLTableElement} tableEl
 * @param {string[]} headers
 * @param {string[][]} rows
 */
export const renderTable = (tableEl, headers, rows) => {
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const c of r) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  tableEl.innerHTML = "";
  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);
};

/**
 * `renderTables(state, ui)` — отрисовать таблицы потоков и теплообменников.
 *
 * @param {any} state Каноническое состояние
 * @param {any} ui Ссылки на элементы таблиц (`ui.tables.streamsTable`, `ui.tables.exchangersTable`)
 */
export const renderTables = (state, ui) => {
  const streamHeaders = [
    "Поток",
    "Tвх, К",
    "Tвых, К",
    "q, МВт",
    "W, МВт/К",
    "Изотермический?",
    "Сторона",
  ];

  const streamRows = [];

  for (let i = 0; i < state.hot.length; i++) {
    const s = state.hot[i];
    const inT = Number(s.in);
    const outT = s.out !== undefined ? Number(s.out) : inT;
    const dt = Math.abs(outT - inT);
    const iso = s.out === undefined || dt === 0;

    const load =
      s.load !== undefined
        ? Number(s.load)
        : s.rate !== undefined
          ? Number(s.rate) * dt
          : 0;

    const rate = iso
      ? 0
      : s.rate !== undefined
        ? Number(s.rate)
        : s.load !== undefined
          ? Number(s.load) / dt
          : 0;

    streamRows.push([
      `H${i + 1}`,
      fmtNum(inT),
      fmtNum(outT),
      fmtNum(load),
      fmtNum(rate),
      iso ? "да" : "нет",
      "горячий",
    ]);
  }

  for (let i = 0; i < state.cold.length; i++) {
    const s = state.cold[i];
    const inT = Number(s.in);
    const outT = s.out !== undefined ? Number(s.out) : inT;
    const dt = Math.abs(outT - inT);
    const iso = s.out === undefined || dt === 0;

    const load =
      s.load !== undefined
        ? Number(s.load)
        : s.rate !== undefined
          ? Number(s.rate) * dt
          : 0;

    const rate = iso
      ? 0
      : s.rate !== undefined
        ? Number(s.rate)
        : s.load !== undefined
          ? Number(s.load) / dt
          : 0;

    streamRows.push([
      `C${i + 1}`,
      fmtNum(inT),
      fmtNum(outT),
      fmtNum(load),
      fmtNum(rate),
      iso ? "да" : "нет",
      "холодный",
    ]);
  }

  renderTable(ui.tables.streamsTable, streamHeaders, streamRows);

  const exHeaders = [
    "Ячейка",
    "Тип",
    "Горячий поток",
    "Холодный поток",
    "Нагрузка, МВт",
  ];

  const exch = Array.isArray(state.exchanger) ? state.exchanger : [];
  const exRows = exch.map((ex, i) => {
    const hasH = ex.hot !== null && ex.hot !== undefined;
    const hasC = ex.cold !== null && ex.cold !== undefined;
    const type =
      hasH && hasC
        ? "Ячейка теплообмена"
        : hasH
          ? "Холодильник"
          : hasC
            ? "Нагреватель"
            : "—";

    return [
      `E${i + 1}`,
      type,
      hasH ? `H${Number(ex.hot) + 1}` : "—",
      hasC ? `C${Number(ex.cold) + 1}` : "—",
      fmtNum(ex.load),
    ];
  });

  renderTable(ui.tables.exchangersTable, exHeaders, exRows);
};
