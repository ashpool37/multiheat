import "./style.css";
import toml from "toml";

const $ = (sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Не найден элемент интерфейса: ${sel}`);
  return el;
};

const StatusPrefix = {
  ok: "✅",
  warn: "⚠️",
  err: "❌",
};

const setStatus = (kind, message) => {
  const prefix = StatusPrefix[kind] ?? StatusPrefix.err;
  ui.status.textContent = `${prefix} ${message}`;
};

const logError = (context, e) => {
  console.error(`[multiheat] ${context}`, e);
};

const toErrorText = (e) => {
  if (e instanceof Error) return e.message || String(e);
  return String(e);
};

const isAbortError = (e) =>
  typeof e === "object" && e && "name" in e && e.name === "AbortError";

const isFiniteNonNegative = (x) => Number.isFinite(x) && x >= 0;
const isFinitePositive = (x) => Number.isFinite(x) && x > 0;

const parseNumber = (raw, fieldName) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n))
    throw new Error(`Некорректное числовое значение: ${fieldName}.`);
  return n;
};

const fmtNum = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s;
};

const describeZigError = (e) => {
  const msg = toErrorText(e);
  const s = msg.toLowerCase();
  if (s.includes("unbalanced")) return "Решение несбалансировано.";
  if (s.includes("infeasible")) return "Задача неразрешима.";
  if (s.includes("nocompatiblepair"))
    return "Не найдена совместимая пара потоков.";
  return "Подробности в консоли браузера.";
};

const csvJoin = (cells) => {
  const esc = (x) => {
    const str = String(x ?? "");
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  return cells.map(esc).join(",");
};

const parseCsv = (text) => {
  // Почему: нужен разбор кавычек, иначе CSV из Excel/LibreOffice ломается
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") continue;

    cur += ch;
  }

  row.push(cur);
  rows.push(row);
  return rows.map((r) => r.map((c) => (c ?? "").trim()));
};

// --- Canonical state (no redundancy, similar to config TOML) ---

const defaultState = () => ({
  multiheat: { version: "0.0.1", temp_unit: "K" },
  hot: [],
  cold: [],
  exchanger: [],
});

const normalizeStream = (s) => {
  const inT = parseNumber(s.in, "in");
  if (!isFiniteNonNegative(inT)) throw new Error("Некорректное значение in.");

  const outRaw = s.out === undefined ? null : parseNumber(s.out, "out");
  if (outRaw !== null && !isFiniteNonNegative(outRaw))
    throw new Error("Некорректное значение out.");

  const rateRaw = s.rate === undefined ? null : parseNumber(s.rate, "rate");
  if (rateRaw !== null && !isFiniteNonNegative(rateRaw))
    throw new Error("Некорректное значение rate.");

  const loadRaw = s.load === undefined ? null : parseNumber(s.load, "load");
  if (loadRaw !== null && !isFiniteNonNegative(loadRaw))
    throw new Error("Некорректное значение load.");

  const outIsMissing = outRaw === null;
  const isIso = outIsMissing || outRaw === inT;

  if (isIso) {
    if (!isFinitePositive(loadRaw))
      throw new Error("Изотермический поток требует положительный load.");
    return { in: inT, load: loadRaw };
  }

  const outT = outRaw;
  const dt = Math.abs(outT - inT);
  if (!(dt > 0))
    throw new Error("Некорректная разность температур (out - in).");

  if (isFinitePositive(rateRaw)) return { in: inT, out: outT, rate: rateRaw };
  if (isFinitePositive(loadRaw)) return { in: inT, out: outT, load: loadRaw };

  throw new Error(
    "Необходимо указать rate или load для неизотермического потока.",
  );
};

const normalizeExchanger = (ex) => {
  const hot =
    ex.hot === undefined ? null : parseNumber(ex.hot, "exchanger.hot");
  const cold =
    ex.cold === undefined ? null : parseNumber(ex.cold, "exchanger.cold");
  const load = parseNumber(ex.load, "exchanger.load");

  if (hot === null && cold === null)
    throw new Error("Теплообменник должен иметь hot или cold.");
  if (hot !== null && !Number.isInteger(hot))
    throw new Error("Некорректное значение exchanger.hot.");
  if (cold !== null && !Number.isInteger(cold))
    throw new Error("Некорректное значение exchanger.cold.");
  if (!isFinitePositive(load))
    throw new Error("Некорректное значение exchanger.load.");

  return { hot, cold, load };
};

const validateAndNormalizeState = (state) => {
  if (!state || typeof state !== "object")
    throw new Error("Некорректная структура данных.");

  if (!state.multiheat || typeof state.multiheat !== "object")
    throw new Error("Отсутствует секция [multiheat].");

  const version = state.multiheat.version;
  const tempUnit = state.multiheat.temp_unit;

  if (version !== "0.0.1")
    throw new Error(
      'Некорректное значение multiheat.version (ожидается "0.0.1").',
    );
  if (tempUnit !== "K")
    throw new Error(
      'Некорректное значение multiheat.temp_unit (ожидается "K").',
    );

  const hot = Array.isArray(state.hot) ? state.hot : [];
  const cold = Array.isArray(state.cold) ? state.cold : [];
  const exchanger = Array.isArray(state.exchanger) ? state.exchanger : [];

  const hotN = hot.map(normalizeStream);
  const coldN = cold.map(normalizeStream);
  const exN = exchanger.map(normalizeExchanger);

  return {
    multiheat: { version: "0.0.1", temp_unit: "K" },
    hot: hotN,
    cold: coldN,
    exchanger: exN,
  };
};

// --- TOML ---

const parseTomlToState = (text) => {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return defaultState();

  let cfg;
  try {
    cfg = toml.parse(trimmed);
  } catch (e) {
    logError("Ошибка разбора TOML", e);
    throw new Error("Ошибка разбора TOML. Подробности в консоли браузера.");
  }

  return validateAndNormalizeState({
    multiheat: cfg.multiheat,
    hot: cfg.hot,
    cold: cfg.cold,
    exchanger: cfg.exchanger,
  });
};

const emitToml = (state) => {
  const lines = [];

  lines.push("[multiheat]");
  lines.push(`version = "${state.multiheat.version}"`);
  lines.push(`temp_unit = "${state.multiheat.temp_unit}"`);
  lines.push("");

  const emitStreamBlock = (section, s) => {
    lines.push(`[[${section}]]`);
    lines.push(`in = ${fmtNum(s.in)}`);
    if (s.out !== undefined) lines.push(`out = ${fmtNum(s.out)}`);
    if (s.rate !== undefined) lines.push(`rate = ${fmtNum(s.rate)}`);
    if (s.load !== undefined) lines.push(`load = ${fmtNum(s.load)}`);
    lines.push("");
  };

  for (const s of state.hot) emitStreamBlock("hot", s);
  for (const s of state.cold) emitStreamBlock("cold", s);

  if (Array.isArray(state.exchanger) && state.exchanger.length > 0) {
    for (const ex of state.exchanger) {
      lines.push("[[exchanger]]");
      if (ex.hot !== null && ex.hot !== undefined)
        lines.push(`hot = ${ex.hot}`);
      if (ex.cold !== null && ex.cold !== undefined)
        lines.push(`cold = ${ex.cold}`);
      lines.push(`load = ${fmtNum(ex.load)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
};

// --- CSV (streams) ---

const emitCsvStreams = (state) => {
  const lines = [];
  lines.push(
    csvJoin([
      "Номер потока",
      "Т на входе, К",
      "Т на выходе, К",
      "q, МВт",
      "W, МВт/К",
      "Фазовый переход?",
    ]),
  );
  lines.push(csvJoin(["Горячие потоки", "", "", "", "", ""]));

  const emitStreamRow = (prefix, idx1, s) => {
    const id = `${prefix}${idx1}`;
    const inT = Number(s.in);
    const outT = s.out !== undefined ? Number(s.out) : inT;
    const dt = Math.abs(outT - inT);

    const isIso = s.out === undefined || dt === 0;
    const load =
      s.load !== undefined
        ? Number(s.load)
        : s.rate !== undefined
          ? Number(s.rate) * dt
          : 0;
    const rate = isIso
      ? 0
      : s.rate !== undefined
        ? Number(s.rate)
        : s.load !== undefined
          ? Number(s.load) / dt
          : 0;

    const phase = isIso ? "Фазовый переход" : "";

    lines.push(
      csvJoin([
        id,
        fmtNum(inT),
        fmtNum(outT),
        fmtNum(load),
        fmtNum(rate),
        phase,
      ]),
    );
  };

  for (let i = 0; i < state.hot.length; i++)
    emitStreamRow("H", i + 1, state.hot[i]);

  lines.push(csvJoin(["Холодные потоки", "", "", "", "", ""]));

  for (let i = 0; i < state.cold.length; i++)
    emitStreamRow("C", i + 1, state.cold[i]);

  return lines.join("\n");
};

const parseCsvStreamsToStatePartial = (text) => {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => (r[0] ?? "") === "Номер потока");
  if (headerIdx < 0)
    throw new Error("CSV (потоки): не найдена строка заголовков.");

  let mode = null; // "hot" | "cold"
  const hot = [];
  const cold = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const first = (r[0] ?? "").trim();
    if (!first) continue;

    const low = first.toLowerCase();

    if (low.startsWith("горячие потоки")) {
      mode = "hot";
      continue;
    }
    if (low.startsWith("холодные потоки")) {
      mode = "cold";
      continue;
    }
    if (low.startsWith("суммарная")) continue;
    if (mode !== "hot" && mode !== "cold") continue;

    const inT = parseNumber(r[1], "Т на входе, К");
    const outT = parseNumber(r[2], "Т на выходе, К");
    const q = parseNumber(r[3], "q, МВт");
    const w = parseNumber(r[4], "W, МВт/К");

    if (!isFiniteNonNegative(inT) || !isFiniteNonNegative(outT))
      throw new Error("CSV (потоки): некорректные температуры.");
    if (!isFiniteNonNegative(q) || !isFiniteNonNegative(w))
      throw new Error("CSV (потоки): некорректные численные значения.");

    const isIso = Math.abs(outT - inT) < 1e-12 || w === 0;

    let stream;
    if (isIso) {
      if (!isFinitePositive(q))
        throw new Error(
          "CSV (потоки): изотермический поток требует положительный q.",
        );
      stream = { in: inT, load: q };
    } else {
      if (isFinitePositive(w)) stream = { in: inT, out: outT, rate: w };
      else if (isFinitePositive(q)) stream = { in: inT, out: outT, load: q };
      else
        throw new Error(
          "CSV (потоки): для неизотермического потока нужен W или q.",
        );
    }

    if (mode === "hot") hot.push(stream);
    else cold.push(stream);
  }

  if (hot.length === 0)
    throw new Error("CSV (потоки): не найдены горячие потоки.");
  if (cold.length === 0)
    throw new Error("CSV (потоки): не найдены холодные потоки.");

  return { hot, cold };
};

// --- CSV (solution) ---

const emitCsvSolution = (state) => {
  const lines = [];
  lines.push(
    csvJoin([
      "Номер ячейки",
      "Горячий поток",
      "Холодный поток",
      "Нагрузка, МВт",
      "Тип",
    ]),
  );

  const exch = Array.isArray(state.exchanger) ? state.exchanger : [];
  for (let i = 0; i < exch.length; i++) {
    const ex = exch[i];
    const hasH = ex.hot !== null && ex.hot !== undefined;
    const hasC = ex.cold !== null && ex.cold !== undefined;

    let type = "Ячейка теплообмена";
    if (hasH && !hasC) type = "Холодильник";
    else if (!hasH && hasC) type = "Нагреватель";

    const hLabel = hasH ? `H${Number(ex.hot) + 1}` : "";
    const cLabel = hasC ? `C${Number(ex.cold) + 1}` : "";

    lines.push(csvJoin([`E${i + 1}`, hLabel, cLabel, fmtNum(ex.load), type]));
  }

  return lines.join("\n");
};

const parseCsvSolutionToExchangers = (text, hotLen, coldLen) => {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => (r[0] ?? "") === "Номер ячейки");
  if (headerIdx < 0)
    throw new Error("CSV (решение): не найдена строка заголовков.");

  const parseEnd = (s, prefix, maxLen) => {
    const t = (s ?? "").trim();
    if (!t) return null;
    const m = t.match(new RegExp(`^${prefix}(\\d+)$`, "i"));
    if (!m)
      throw new Error(
        `CSV (решение): некорректный идентификатор потока: ${t}.`,
      );
    const idx1 = Number(m[1]);
    if (!Number.isInteger(idx1) || idx1 <= 0)
      throw new Error(`CSV (решение): некорректный номер потока: ${t}.`);
    const idx0 = idx1 - 1;
    if (idx0 >= maxLen)
      throw new Error(`CSV (решение): индекс потока вне диапазона: ${t}.`);
    return idx0;
  };

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const id = (r[0] ?? "").trim();
    if (!id) continue;

    const hot = parseEnd(r[1], "H", hotLen);
    const cold = parseEnd(r[2], "C", coldLen);
    const load = parseNumber(r[3], "Нагрузка, МВт");

    if (!isFinitePositive(load))
      throw new Error("CSV (решение): нагрузка должна быть положительной.");
    if (hot === null && cold === null)
      throw new Error("CSV (решение): у строки должен быть указан H или C.");

    out.push({ hot, cold, load });
  }

  return out;
};

// --- Views (description/tables) ---

const renderDescriptionHtml = (state, host) => {
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

  const hotItems = [];
  for (let i = 0; i < state.hot.length; i++) {
    const s = state.hot[i];
    const id = `H${i + 1}`;
    if (s.out === undefined) {
      hotItems.push(
        `${id}. Изотермический. Температура: ${fmtNum(s.in)} К. Нагрузка: ${fmtNum(s.load)} МВт.`,
      );
    } else {
      const rate =
        s.rate !== undefined
          ? Number(s.rate)
          : Number(s.load) / Math.abs(Number(s.out) - Number(s.in));
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
      const rate =
        s.rate !== undefined
          ? Number(s.rate)
          : Number(s.load) / Math.abs(Number(s.out) - Number(s.in));
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

const renderTable = (tableEl, headers, rows) => {
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

const renderTables = (state) => {
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

const updateNonEditableViews = () => {
  if (store.viewsSuspended) return;
  renderDescriptionHtml(store.state, ui.description.pre);
  renderTables(store.state);
};

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

const refreshAllViews = (forceEditors = false) => {
  if (store.viewsSuspended) return;
  updateNonEditableViews();
  updateEditorsFromState(forceEditors);
};

// --- Zig interop ---

const buildZigSystem = (multiheat, state, includeExchangers) => {
  const HeatStream = multiheat.HeatStream;
  const HeatSystem = multiheat.HeatSystem;
  const HeatExchanger = multiheat.HeatExchanger;

  const toZigStream = (s) => {
    if (s.out === undefined) {
      return new HeatStream({
        isothermal: true,
        in_temp_K: Number(s.in),
        out_temp_K: Number(s.in),
        rate_MW_per_K: 0.0,
        load_MW: Number(s.load),
      });
    }

    const inT = Number(s.in);
    const outT = Number(s.out);
    const dt = Math.abs(outT - inT);

    if (s.rate !== undefined) {
      return new HeatStream({
        isothermal: false,
        in_temp_K: inT,
        out_temp_K: outT,
        rate_MW_per_K: Number(s.rate),
        load_MW: Number(s.rate) * dt,
      });
    }

    return new HeatStream({
      isothermal: false,
      in_temp_K: inT,
      out_temp_K: outT,
      rate_MW_per_K: Number(s.load) / dt,
      load_MW: Number(s.load),
    });
  };

  const toZigEx = (ex) =>
    new HeatExchanger({
      hot_end: ex.hot === null ? null : Number(ex.hot),
      cold_end: ex.cold === null ? null : Number(ex.cold),
      load_MW: Number(ex.load),
    });

  const hotStreams = state.hot.map(toZigStream);
  const coldStreams = state.cold.map(toZigStream);

  const exchangers =
    includeExchangers && Array.isArray(state.exchanger)
      ? state.exchanger.map(toZigEx)
      : [];

  return new HeatSystem({
    min_dt: 20,
    def_dt: 30,
    hot_streams: hotStreams,
    cold_streams: coldStreams,
    exchangers,
  });
};

const getOptionalValue = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v && "value" in v) return v.value;
  return v;
};

const dumpExchangersFromZig = (xs) => {
  if (xs === null || xs === undefined) return [];
  if (Array.isArray(xs)) return xs.map((ex) => ex);

  const obj = Object(xs);
  if (typeof obj[Symbol.iterator] === "function") return Array.from(xs);

  if (typeof obj.length === "number") {
    const out = [];
    for (let i = 0; i < obj.length; i++)
      out.push(obj[i] ?? obj.at?.(i) ?? obj.get?.(i));
    return out;
  }

  return [xs];
};

const zigExchangersToState = (zigExList) => {
  return zigExList.map((ex) => ({
    hot: getOptionalValue(ex.hot_end),
    cold: getOptionalValue(ex.cold_end),
    load: Number(ex.load_MW),
  }));
};

// --- File download/upload ---

const downloadText = async (text, suggestedName, mime, exts) => {
  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: suggestedName, accept: { [mime]: exts } }],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }

  // Почему: запасной вариант без File System Access API
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// --- UI binding ---

const Tab = {
  description: "description",
  tables: "tables",
  toml: "toml",
  csv: "csv",
  hide: "hide",
};

const ui = {
  status: $("#statusLabel"),

  buttons: {
    openMenu: $("#btnOpenMenu"),
    saveMenu: $("#btnSaveMenu"),

    openToml: $("#menuOpenToml"),
    openCsvStreams: $("#menuOpenCsvStreams"),
    openCsvSolution: $("#menuOpenCsvSolution"),

    saveToml: $("#menuSaveToml"),
    saveCsvStreams: $("#menuSaveCsvStreams"),
    saveCsvSolution: $("#menuSaveCsvSolution"),

    solve: $("#btnSolve"),
    verify: $("#btnVerify"),
    clear: $("#btnClear"),
  },

  menus: {
    open: $("#menuOpen"),
    save: $("#menuSave"),
  },

  inputs: {
    toml: $("#fileToml"),
    csvStreams: $("#fileCsvStreams"),
    csvSolution: $("#fileCsvSolution"),
  },

  tabs: {
    description: $("#tabDescription"),
    tables: $("#tabTables"),
    toml: $("#tabToml"),
    csv: $("#tabCsv"),
    hide: $("#tabHide"),
  },

  panels: {
    description: $("#panelDescription"),
    tables: $("#panelTables"),
    toml: $("#panelToml"),
    csv: $("#panelCsv"),
    hide: $("#panelHide"),
  },

  tabPanels: $("#tabPanels"),
  testModeBlock: $("#testModeBlock"),

  description: {
    pre: $("#descriptionText"),
  },

  toml: {
    textarea: $("#tomlText"),
  },

  csv: {
    streamsTextarea: $("#csvStreamsText"),
    solutionTextarea: $("#csvSolutionText"),
  },

  tables: {
    streamsTable: $("#streamsTable"),
    exchangersTable: $("#exchangersTable"),
  },
};

const store = {
  state: defaultState(),
  activeTab: Tab.toml,
  viewsSuspended: false,
  dirty: {
    toml: false,
    csvStreams: false,
    csvSolution: false,
  },
};

const setUiEnabled = (enabled) => {
  const allButtons = [...Object.values(ui.buttons), ...Object.values(ui.tabs)];
  for (const b of allButtons) b.disabled = !enabled;
  ui.toml.textarea.disabled = !enabled;
  ui.csv.streamsTextarea.disabled = !enabled;
  ui.csv.solutionTextarea.disabled = !enabled;
};

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

const syncStateFromTomlEditor = () => {
  const text = ui.toml.textarea.value ?? "";
  const next = parseTomlToState(text);
  store.state = next;
  store.dirty.toml = false;
  store.dirty.csvStreams = false;
  store.dirty.csvSolution = false;
  if (!store.viewsSuspended) refreshAllViews(true);
};

const syncStateFromCsvEditors = () => {
  const streamsText = ui.csv.streamsTextarea.value ?? "";
  const solText = ui.csv.solutionTextarea.value ?? "";

  if (streamsText.trim().length === 0) {
    if (solText.trim().length === 0) {
      store.state = defaultState();
      store.dirty.toml = false;
      store.dirty.csvStreams = false;
      store.dirty.csvSolution = false;
      refreshAllViews(true);
      return;
    }
    throw new Error(
      "CSV (потоки) пустой: невозможно применить CSV (решение) без потоков.",
    );
  }

  const partial = parseCsvStreamsToStatePartial(streamsText);
  const base = {
    multiheat: { version: "0.0.1", temp_unit: "K" },
    hot: partial.hot,
    cold: partial.cold,
    exchanger: [],
  };

  if (solText.trim().length > 0) {
    base.exchanger = parseCsvSolutionToExchangers(
      solText,
      base.hot.length,
      base.cold.length,
    );
  }

  store.state = validateAndNormalizeState(base);
  store.dirty.toml = false;
  store.dirty.csvStreams = false;
  store.dirty.csvSolution = false;
  if (!store.viewsSuspended) refreshAllViews(true);
};

const syncFromActiveEditorIfNeeded = () => {
  if (store.viewsSuspended) return;

  if (store.activeTab === Tab.toml && store.dirty.toml) {
    syncStateFromTomlEditor();
    return;
  }
  if (
    store.activeTab === Tab.csv &&
    (store.dirty.csvStreams || store.dirty.csvSolution)
  ) {
    syncStateFromCsvEditors();
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

    // Почему: не проверяем при вставке, но проверяем перед "чтением" (Описание/Таблица)
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

const onUploadToml = async (file) => {
  try {
    const text = await file.text();

    if (store.viewsSuspended) {
      store.state = parseTomlToState(text);
      store.dirty.toml = false;
      store.dirty.csvStreams = false;
      store.dirty.csvSolution = false;
      setStatus("ok", "TOML загружен.");
      return;
    }

    ui.toml.textarea.value = text;
    store.dirty.toml = true;

    syncStateFromTomlEditor();
    setActiveTab(Tab.toml);
    setStatus("ok", "TOML загружен и проверен.");
  } catch (e) {
    logError("Загрузка TOML не удалась", e);
    setStatus(
      "err",
      "Не удалось загрузить TOML. Подробности в консоли браузера.",
    );
  }
};

const onUploadCsvStreams = async (file) => {
  try {
    const text = await file.text();

    if (store.viewsSuspended) {
      const partial = parseCsvStreamsToStatePartial(text);
      store.state = validateAndNormalizeState({
        multiheat: { version: "0.0.1", temp_unit: "K" },
        hot: partial.hot,
        cold: partial.cold,
        exchanger: [],
      });
      store.dirty.toml = false;
      store.dirty.csvStreams = false;
      store.dirty.csvSolution = false;
      setStatus("warn", "CSV (потоки) загружен. Решение очищено.");
      return;
    }

    ui.csv.streamsTextarea.value = text;
    store.dirty.csvStreams = true;

    // Почему: при замене потоков старое решение теряет смысл
    ui.csv.solutionTextarea.value = "";
    store.dirty.csvSolution = false;

    syncStateFromCsvEditors();
    setActiveTab(Tab.csv);
    setStatus("warn", "CSV (потоки) загружен и проверен. Решение очищено.");
  } catch (e) {
    logError("Загрузка CSV (потоки) не удалась", e);
    setStatus(
      "err",
      "Не удалось загрузить CSV (потоки). Подробности в консоли браузера.",
    );
  }
};

const onUploadCsvSolution = async (file) => {
  try {
    const text = await file.text();

    if (store.viewsSuspended) {
      const hotLen = Array.isArray(store.state?.hot)
        ? store.state.hot.length
        : 0;
      const coldLen = Array.isArray(store.state?.cold)
        ? store.state.cold.length
        : 0;

      if (hotLen === 0 || coldLen === 0) {
        throw new Error(
          "Невозможно загрузить CSV (решение): сначала загрузите CSV (потоки) или TOML.",
        );
      }

      const exchangers = parseCsvSolutionToExchangers(text, hotLen, coldLen);

      store.state = validateAndNormalizeState({
        ...store.state,
        exchanger: exchangers,
      });
      store.dirty.toml = false;
      store.dirty.csvStreams = false;
      store.dirty.csvSolution = false;

      setStatus("ok", "CSV (решение) загружен.");
      return;
    }

    ui.csv.solutionTextarea.value = text;
    store.dirty.csvSolution = true;

    syncStateFromCsvEditors();
    setActiveTab(Tab.csv);
    setStatus("ok", "CSV (решение) загружен и проверен.");
  } catch (e) {
    logError("Загрузка CSV (решение) не удалась", e);
    setStatus(
      "err",
      "Не удалось загрузить CSV (решение). Подробности в консоли браузера.",
    );
  }
};

const hookEvents = () => {
  ui.toml.textarea.addEventListener("input", () => {
    store.dirty.toml = true;
  });
  ui.csv.streamsTextarea.addEventListener("input", () => {
    store.dirty.csvStreams = true;
  });
  ui.csv.solutionTextarea.addEventListener("input", () => {
    store.dirty.csvSolution = true;
  });

  ui.tabs.description.addEventListener("click", () =>
    switchTab(Tab.description),
  );
  ui.tabs.tables.addEventListener("click", () => switchTab(Tab.tables));
  ui.tabs.toml.addEventListener("click", () => switchTab(Tab.toml));
  ui.tabs.csv.addEventListener("click", () => switchTab(Tab.csv));
  ui.tabs.hide.addEventListener("click", () => switchTab(Tab.hide));

  ui.buttons.openToml.addEventListener("click", () => ui.inputs.toml.click());
  ui.buttons.openCsvStreams.addEventListener("click", () =>
    ui.inputs.csvStreams.click(),
  );
  ui.buttons.openCsvSolution.addEventListener("click", () =>
    ui.inputs.csvSolution.click(),
  );

  ui.inputs.toml.addEventListener("change", async () => {
    const file = ui.inputs.toml.files?.[0];
    ui.inputs.toml.value = "";
    if (!file) return;
    await onUploadToml(file);
  });

  ui.inputs.csvStreams.addEventListener("change", async () => {
    const file = ui.inputs.csvStreams.files?.[0];
    ui.inputs.csvStreams.value = "";
    if (!file) return;
    await onUploadCsvStreams(file);
  });

  ui.inputs.csvSolution.addEventListener("change", async () => {
    const file = ui.inputs.csvSolution.files?.[0];
    ui.inputs.csvSolution.value = "";
    if (!file) return;
    await onUploadCsvSolution(file);
  });

  ui.buttons.saveToml.addEventListener("click", async () => {
    try {
      if (store.viewsSuspended) {
        setStatus(
          "warn",
          "Режим «Скрыть» активен: сохранение представлений отключено.",
        );
        return;
      }
      syncFromActiveEditorIfNeeded();
      const text = emitToml(store.state);
      await downloadText(text, "multiheat.toml", "text/toml", [".toml"]);
      setStatus("ok", "TOML сохранён.");
    } catch (e) {
      if (isAbortError(e)) {
        setStatus("warn", "Сохранение отменено пользователем.");
        return;
      }
      logError("Сохранение TOML не удалось", e);
      setStatus(
        "err",
        "Не удалось сохранить TOML. Подробности в консоли браузера.",
      );
    }
  });

  ui.buttons.saveCsvStreams.addEventListener("click", async () => {
    try {
      if (store.viewsSuspended) {
        setStatus(
          "warn",
          "Режим «Скрыть» активен: сохранение представлений отключено.",
        );
        return;
      }
      syncFromActiveEditorIfNeeded();
      const text = emitCsvStreams(store.state);
      await downloadText(text, "multiheat_streams.csv", "text/csv", [".csv"]);
      setStatus("ok", "CSV (потоки) сохранён.");
    } catch (e) {
      if (isAbortError(e)) {
        setStatus("warn", "Сохранение отменено пользователем.");
        return;
      }
      logError("Сохранение CSV (потоки) не удалось", e);
      setStatus(
        "err",
        "Не удалось сохранить CSV (потоки). Подробности в консоли браузера.",
      );
    }
  });

  ui.buttons.saveCsvSolution.addEventListener("click", async () => {
    try {
      if (store.viewsSuspended) {
        setStatus(
          "warn",
          "Режим «Скрыть» активен: сохранение представлений отключено.",
        );
        return;
      }
      syncFromActiveEditorIfNeeded();
      const text = emitCsvSolution(store.state);
      await downloadText(text, "multiheat_solution.csv", "text/csv", [".csv"]);
      setStatus("ok", "CSV (решение) сохранён.");
    } catch (e) {
      if (isAbortError(e)) {
        setStatus("warn", "Сохранение отменено пользователем.");
        return;
      }
      logError("Сохранение CSV (решение) не удалось", e);
      setStatus(
        "err",
        "Не удалось сохранить CSV (решение). Подробности в консоли браузера.",
      );
    }
  });
};

// --- App entry ---

let multiheat = null;

const solveCurrent = () => {
  try {
    if (!multiheat) throw new Error("Модуль вычислений не загружен.");

    syncFromActiveEditorIfNeeded();

    try {
      store.state = validateAndNormalizeState(store.state);
    } catch (e) {
      logError("Проверка входных данных перед синтезом не пройдена", e);
      setStatus(
        "err",
        "Не удалось синтезировать систему: входные данные некорректны. Подробности в консоли браузера.",
      );
      return;
    }

    if (store.state.hot.length === 0 || store.state.cold.length === 0) {
      setStatus(
        "err",
        "Невозможно синтезировать систему: добавьте хотя бы один горячий и один холодный поток.",
      );
      return;
    }

    const system = buildZigSystem(multiheat, store.state, false);

    try {
      multiheat.solve(system);
    } catch (e) {
      logError("Синтез (solve) завершился с ошибкой", e);
      setStatus(
        "err",
        `Не удалось синтезировать систему: ${describeZigError(e)}`,
      );
      return;
    }

    const zigExList = dumpExchangersFromZig(system.exchangers);
    const next = {
      ...store.state,
      exchanger: zigExchangersToState(zigExList),
    };

    store.state = validateAndNormalizeState(next);
    store.dirty.toml = false;
    store.dirty.csvStreams = false;
    store.dirty.csvSolution = false;

    refreshAllViews(true);

    try {
      const verifySystem = buildZigSystem(multiheat, store.state, true);
      multiheat.verifySolution(verifySystem);
      setStatus(
        "ok",
        `Синтез выполнен. Добавлено теплообменников: ${store.state.exchanger.length}.`,
      );
    } catch (e) {
      logError("Проверка после синтеза не пройдена", e);
      setStatus(
        "warn",
        `Синтез выполнен, но проверка не пройдена: ${describeZigError(e)}`,
      );
    }
  } catch (e) {
    logError("Не удалось синтезировать систему", e);
    setStatus(
      "err",
      "Не удалось синтезировать систему. Подробности в консоли браузера.",
    );
  }
};

const verifyCurrent = () => {
  try {
    if (!multiheat) throw new Error("Модуль вычислений не загружен.");

    syncFromActiveEditorIfNeeded();

    try {
      store.state = validateAndNormalizeState(store.state);
    } catch (e) {
      logError(
        "Проверка входных данных перед проверкой решения не пройдена",
        e,
      );
      setStatus(
        "err",
        "Не удалось проверить систему: входные данные некорректны. Подробности в консоли браузера.",
      );
      return;
    }

    if (store.state.hot.length === 0 || store.state.cold.length === 0) {
      setStatus(
        "err",
        "Невозможно проверить систему: добавьте хотя бы один горячий и один холодный поток.",
      );
      return;
    }

    const system = buildZigSystem(multiheat, store.state, true);

    try {
      multiheat.verifySolution(system);
      setStatus("ok", "Проверка пройдена.");
    } catch (e) {
      logError("Проверка не пройдена", e);
      setStatus("warn", `Проверка не пройдена: ${describeZigError(e)}`);
    }
  } catch (e) {
    logError("Не удалось проверить систему", e);
    setStatus(
      "err",
      "Не удалось проверить систему. Подробности в консоли браузера.",
    );
  }
};

const init = async () => {
  setUiEnabled(false);
  hookEvents();
  setActiveTab(Tab.toml);

  ui.buttons.solve.addEventListener("click", solveCurrent);
  ui.buttons.verify.addEventListener("click", verifyCurrent);

  setStatus(
    "ok",
    "Готов к работе. Откройте файл конфигурации или вставьте её в поле ниже.",
  );

  try {
    // Почему: ждём инициализации WASM перед включением интерфейса
    multiheat = await import("../zig/multiheat_entry.zig");

    const ok =
      typeof multiheat.solve === "function" &&
      typeof multiheat.verifySolution === "function" &&
      typeof multiheat.HeatSystem === "function" &&
      typeof multiheat.HeatStream === "function" &&
      typeof multiheat.HeatExchanger === "function";

    if (!ok) {
      setUiEnabled(false);
      setStatus(
        "err",
        "Модуль вычислений загружен, но требуемые функции недоступны.",
      );
      return;
    }

    setUiEnabled(true);

    // Почему: два независимых переключателя-заглушки (без логики) для будущих режимов
    const setupToggle = (selector) => {
      const btn = document.querySelector(selector);
      if (!btn) return;

      btn.classList.add("mh-toggle");
      btn.setAttribute("aria-pressed", "false");

      btn.addEventListener("click", () => {
        const active = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
    };

    setupToggle("#btnVisualize");
    setupToggle("#btnTest");

    // Почему: начальное состояние пустое; пользователь вставит/загрузит данные
    store.state = defaultState();
    refreshAllViews(true);
    setStatus(
      "ok",
      "Готов к работе. Откройте файл конфигурации или вставьте её в поле ниже.",
    );
  } catch (e) {
    logError("Не удалось загрузить модуль вычислений", e);
    setUiEnabled(false);
    setStatus(
      "err",
      "Не удалось загрузить модуль вычислений. Подробности в консоли браузера.",
    );
  }
};

await init();

// Режим тестирования: показывает заглушку и по умолчанию уводит во вкладку "Скрыть".
(() => {
  const btnTest = document.querySelector("#btnTest");
  const block = ui.testModeBlock;

  if (!btnTest || !block) return;

  const apply = () => {
    const active = btnTest.getAttribute("aria-pressed") === "true";
    block.hidden = !active;

    if (active) {
      switchTab(Tab.hide);
    }
  };

  btnTest.addEventListener("click", () => {
    queueMicrotask(apply);
  });

  apply();
})();

(() => {
  const openBtn = ui.buttons.openMenu;
  const saveBtn = ui.buttons.saveMenu;
  const openMenu = ui.menus.open;
  const saveMenu = ui.menus.save;

  const setExpanded = (btn, expanded) => {
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  };

  const closeMenu = (btn, menu) => {
    menu.hidden = true;
    setExpanded(btn, false);
  };

  const toggleMenu = (btn, menu) => {
    const nextHidden = !menu.hidden;
    menu.hidden = nextHidden;
    setExpanded(btn, !nextHidden);
  };

  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu(saveBtn, saveMenu);
    toggleMenu(openBtn, openMenu);
  });

  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu(openBtn, openMenu);
    toggleMenu(saveBtn, saveMenu);
  });

  // Почему: кликом вне меню закрываем выпадашки
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!openMenu.hidden && !openMenu.contains(t) && !openBtn.contains(t))
      closeMenu(openBtn, openMenu);
    if (!saveMenu.hidden && !saveMenu.contains(t) && !saveBtn.contains(t))
      closeMenu(saveBtn, saveMenu);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!openMenu.hidden) closeMenu(openBtn, openMenu);
    if (!saveMenu.hidden) closeMenu(saveBtn, saveMenu);
  });

  const closeBoth = () => {
    closeMenu(openBtn, openMenu);
    closeMenu(saveBtn, saveMenu);
  };

  for (const el of [
    ui.buttons.openToml,
    ui.buttons.openCsvStreams,
    ui.buttons.openCsvSolution,
    ui.buttons.saveToml,
    ui.buttons.saveCsvStreams,
    ui.buttons.saveCsvSolution,
  ]) {
    el.addEventListener("click", () => closeBoth());
  }
})();

const hasAnyUserData = () => {
  const s = store.state;
  const hotLen = Array.isArray(s?.hot) ? s.hot.length : 0;
  const coldLen = Array.isArray(s?.cold) ? s.cold.length : 0;
  const exLen = Array.isArray(s?.exchanger) ? s.exchanger.length : 0;

  if (hotLen > 0 || coldLen > 0 || exLen > 0) return true;

  const empty = defaultState();

  if (store.dirty.toml) {
    const cur = (ui.toml.textarea.value ?? "").trim();
    const def = emitToml(empty).trim();
    if (cur !== def) return true;
  }

  if (store.dirty.csvStreams) {
    const cur = (ui.csv.streamsTextarea.value ?? "").trim();
    const def = emitCsvStreams(empty).trim();
    if (cur !== def) return true;
  }

  if (store.dirty.csvSolution) {
    const cur = (ui.csv.solutionTextarea.value ?? "").trim();
    const def = emitCsvSolution(empty).trim();
    if (cur !== def) return true;
  }

  return false;
};

window.addEventListener("beforeunload", (e) => {
  if (!hasAnyUserData()) return;
  e.preventDefault();
  e.returnValue = "";
  return "";
});

const setupClear = () => {
  const btnClear = document.querySelector("#btnClear");
  if (!btnClear) return;

  btnClear.addEventListener("click", () => {
    try {
      const ok = window.confirm("Сбросить все данные?");
      if (!ok) return;

      store.state = defaultState();
      store.dirty.toml = false;
      store.dirty.csvStreams = false;
      store.dirty.csvSolution = false;

      refreshAllViews(true);
      setStatus("ok", "Данные сброшены.");
    } catch (e) {
      logError("Сброс данных не удался", e);
      setStatus(
        "err",
        "Не удалось сбросить данные. Подробности в консоли браузера.",
      );
    }
  });
};

setupClear();
