import "./style.css";
import toml from "toml";

const $ = (sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Не найден элемент: ${sel}`);
  return el;
};

const btnOpen = $("#btnOpenConfig");
const btnDownload = $("#btnDownloadConfig");
const btnSolve = $("#btnSolve");
const btnVerify = $("#btnVerify");
const statusLabel = $("#statusLabel");
const textArea = $("#configText");
const fileInput = $("#fileInput");

const StatusPrefix = {
  ok: "✅",
  warn: "⚠️",
  err: "❌",
};

const setStatus = (kind, message) => {
  const prefix = StatusPrefix[kind] ?? StatusPrefix.err;
  statusLabel.textContent = `${prefix} ${message}`;
};

const toErrorText = (e) => {
  if (e instanceof Error) return e.message || String(e);
  return String(e);
};

const logError = (context, e) => {
  console.error(`[multiheat] ${context}`, e);
};

const isAbortError = (e) =>
  typeof e === "object" && e && "name" in e && e.name === "AbortError";

const describeZigError = (e) => {
  const msg = toErrorText(e);
  const s = msg.toLowerCase();

  if (s.includes("unbalanced")) return "Решение несбалансировано.";
  if (s.includes("infeasible")) return "Задача неразрешима.";
  if (s.includes("nocompatiblepair"))
    return "Не найдена совместимая пара потоков.";

  return "Подробности в консоли браузера.";
};

const isFiniteNonNegative = (x) => Number.isFinite(x) && x >= 0;
const isFinitePositive = (x) => Number.isFinite(x) && x > 0;

const safeNum = (v, fieldName) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new Error(`Некорректное значение ${fieldName}.`);
  return n;
};

const getOptionalValue = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v && "value" in v) return v.value;
  return v;
};

const toPlainExchanger = (ex) => {
  if (!ex) return ex;
  return {
    hot_end: getOptionalValue(ex.hot_end),
    cold_end: getOptionalValue(ex.cold_end),
    load_MW: ex.load_MW,
  };
};

const dumpExchangers = (xs) => {
  if (xs === null || xs === undefined) return [];
  if (Array.isArray(xs)) return xs.map(toPlainExchanger);

  const obj = Object(xs);
  if (typeof obj[Symbol.iterator] === "function") {
    return Array.from(xs, toPlainExchanger);
  }

  if (typeof obj.length === "number") {
    const out = [];
    for (let i = 0; i < obj.length; i++) {
      const ex = obj[i] ?? obj.at?.(i) ?? obj.get?.(i);
      out.push(toPlainExchanger(ex));
    }
    return out;
  }

  // Почему: формат контейнера зависит от представления массива/среза в рантайме
  return [toPlainExchanger(xs)];
};

const readConfigFromText = (text) => {
  let cfg;
  try {
    cfg = toml.parse(text);
  } catch (e) {
    logError("Ошибка разбора TOML", e);
    throw new Error("Ошибка разбора TOML. Подробности в консоли браузера.");
  }

  if (!cfg || typeof cfg !== "object") {
    throw new Error("Некорректный TOML: ожидается объект конфигурации.");
  }

  if (!cfg.multiheat || typeof cfg.multiheat !== "object") {
    throw new Error("Отсутствует секция [multiheat].");
  }

  const version = cfg.multiheat.version;
  const tempUnit = cfg.multiheat.temp_unit;

  if (version !== "0.0.1") {
    throw new Error(
      'Некорректное значение multiheat.version (ожидается "0.0.1").',
    );
  }
  if (tempUnit !== "K") {
    throw new Error(
      'Некорректное значение multiheat.temp_unit (ожидается "K").',
    );
  }

  const hot = Array.isArray(cfg.hot) ? cfg.hot : [];
  const cold = Array.isArray(cfg.cold) ? cfg.cold : [];
  const exchanger = Array.isArray(cfg.exchanger) ? cfg.exchanger : null;

  if (hot.length === 0)
    throw new Error("Секция [[hot]] пуста или отсутствует.");
  if (cold.length === 0)
    throw new Error("Секция [[cold]] пуста или отсутствует.");

  return { cfg, hot, cold, exchanger };
};

const toSystemStream = (HeatStream, src) => {
  const inT = safeNum(src.in, "in");
  if (!isFiniteNonNegative(inT)) throw new Error("Некорректное значение in.");

  const outT = src.out === undefined ? null : safeNum(src.out, "out");
  if (outT !== null && !isFiniteNonNegative(outT))
    throw new Error("Некорректное значение out.");

  const rate = src.rate === undefined ? null : safeNum(src.rate, "rate");
  if (rate !== null && !isFiniteNonNegative(rate))
    throw new Error("Некорректное значение rate.");

  const load = src.load === undefined ? null : safeNum(src.load, "load");
  if (load !== null && !isFiniteNonNegative(load))
    throw new Error("Некорректное значение load.");

  if (outT === null || outT === inT) {
    if (!isFinitePositive(load))
      throw new Error("Изотермический поток требует положительный load.");
    return new HeatStream({
      isothermal: true,
      in_temp_K: inT,
      out_temp_K: inT,
      rate_MW_per_K: 0.0,
      load_MW: load,
    });
  }

  const dt = Math.abs(outT - inT);
  if (!(dt > 0))
    throw new Error("Некорректная разность температур (out - in).");

  if (isFinitePositive(rate)) {
    return new HeatStream({
      isothermal: false,
      in_temp_K: inT,
      out_temp_K: outT,
      rate_MW_per_K: rate,
      load_MW: rate * dt,
    });
  }

  if (isFinitePositive(load)) {
    return new HeatStream({
      isothermal: false,
      in_temp_K: inT,
      out_temp_K: outT,
      rate_MW_per_K: load / dt,
      load_MW: load,
    });
  }

  throw new Error(
    "Необходимо указать rate или load для неизотермического потока.",
  );
};

const toSystemExchanger = (HeatExchanger, src) => {
  const hot = src.hot === undefined ? null : Number(src.hot);
  const cold = src.cold === undefined ? null : Number(src.cold);
  const load = Number(src.load);

  if (hot === null && cold === null)
    throw new Error("Теплообменник должен иметь hot или cold.");
  if (hot !== null && !Number.isInteger(hot))
    throw new Error("Некорректное значение exchanger.hot.");
  if (cold !== null && !Number.isInteger(cold))
    throw new Error("Некорректное значение exchanger.cold.");
  if (!isFinitePositive(load))
    throw new Error("Некорректное значение exchanger.load.");

  return new HeatExchanger({
    hot_end: hot === null ? null : hot,
    cold_end: cold === null ? null : cold,
    load_MW: load,
  });
};

const buildSystem = (multiheat, parsed, includeExchangers) => {
  const { hot, cold, exchanger } = parsed;

  const HeatStream = multiheat.HeatStream;
  const HeatSystem = multiheat.HeatSystem;
  const HeatExchanger = multiheat.HeatExchanger;

  const hotStreams = hot.map((s) => toSystemStream(HeatStream, s));
  const coldStreams = cold.map((s) => toSystemStream(HeatStream, s));

  const exchangers =
    includeExchangers && exchanger
      ? exchanger.map((e) => toSystemExchanger(HeatExchanger, e))
      : [];

  return new HeatSystem({
    min_dt: 20,
    def_dt: 30,
    hot_streams: hotStreams,
    cold_streams: coldStreams,
    exchangers,
  });
};

const emitToml = (cfg, hot, cold, exchangersPlain) => {
  const lines = [];

  lines.push("[multiheat]");
  lines.push(`version = "${cfg.multiheat.version}"`);
  lines.push(`temp_unit = "${cfg.multiheat.temp_unit}"`);
  lines.push("");

  const emitStreamBlock = (section, s) => {
    lines.push(`[[${section}]]`);
    lines.push(`in = ${Number(s.in)}`);
    if (s.out !== undefined) lines.push(`out = ${Number(s.out)}`);
    if (s.rate !== undefined) lines.push(`rate = ${Number(s.rate)}`);
    if (s.load !== undefined) lines.push(`load = ${Number(s.load)}`);
    lines.push("");
  };

  for (const s of hot) emitStreamBlock("hot", s);
  for (const s of cold) emitStreamBlock("cold", s);

  for (const ex of exchangersPlain) {
    lines.push("[[exchanger]]");
    if (ex.hot_end !== null && ex.hot_end !== undefined)
      lines.push(`hot = ${ex.hot_end}`);
    if (ex.cold_end !== null && ex.cold_end !== undefined)
      lines.push(`cold = ${ex.cold_end}`);
    lines.push(`load = ${Number(ex.load_MW).toFixed(6)}`);
    lines.push("");
  }

  return lines.join("\n");
};

const downloadText = async (text) => {
  const fileName = "multiheat.toml";

  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: "TOML",
          accept: { "text/toml": [".toml"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }

  // Почему: запасной вариант без File System Access API
  const blob = new Blob([text], { type: "text/toml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const setUiEnabled = (enabled) => {
  btnOpen.disabled = !enabled;
  btnDownload.disabled = !enabled;
  btnSolve.disabled = !enabled;
  btnVerify.disabled = !enabled;
};

setUiEnabled(false);

btnOpen.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    textArea.value = text;
    setStatus("ok", "Файл конфигурации загружен.");
  } catch (e) {
    logError("Не удалось прочитать файл", e);
    setStatus(
      "err",
      "Не удалось прочитать файл. Подробности в консоли браузера.",
    );
  }
});

btnDownload.addEventListener("click", async () => {
  try {
    const text = textArea.value ?? "";
    await downloadText(text);
    setStatus("ok", "Конфигурация сохранена.");
  } catch (e) {
    if (isAbortError(e)) {
      setStatus("warn", "Сохранение отменено пользователем.");
      return;
    }
    logError("Не удалось сохранить конфигурацию", e);
    setStatus(
      "err",
      "Не удалось сохранить конфигурацию. Подробности в консоли браузера.",
    );
  }
});

let multiheat = null;

btnSolve.addEventListener("click", () => {
  try {
    if (!multiheat) throw new Error("Модуль вычислений не загружен.");
    const text = textArea.value ?? "";
    const parsed = readConfigFromText(text);

    const system = buildSystem(multiheat, parsed, false);
    multiheat.solve(system);

    const exchangersPlain = dumpExchangers(system.exchangers);
    const outToml = emitToml(
      parsed.cfg,
      parsed.hot,
      parsed.cold,
      exchangersPlain,
    );
    textArea.value = outToml;

    try {
      multiheat.verifySolution(system);
      setStatus(
        "ok",
        `Синтез выполнен. Добавлено теплообменников: ${exchangersPlain.length}.`,
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
});

btnVerify.addEventListener("click", () => {
  try {
    if (!multiheat) throw new Error("Модуль вычислений не загружен.");
    const text = textArea.value ?? "";
    const parsed = readConfigFromText(text);

    const system = buildSystem(multiheat, parsed, true);

    try {
      multiheat.verifySolution(system);
      setStatus("ok", "Проверка пройдена.");
    } catch (e) {
      logError("Проверка не пройдена", e);
      setStatus("warn", `Проверка не пройдена: ${describeZigError(e)}`);
    }
  } catch (e) {
    logError("Не удалось проверить конфигурацию", e);
    setStatus(
      "err",
      "Не удалось проверить конфигурацию. Подробности в консоли браузера.",
    );
  }
});

try {
  // Почему: top-level await позволяет дождаться инициализации WASM
  multiheat = await import("../zig/multiheat_entry.zig");

  const ok =
    typeof multiheat.solve === "function" &&
    typeof multiheat.verifySolution === "function" &&
    typeof multiheat.HeatSystem === "function" &&
    typeof multiheat.HeatStream === "function";

  if (!ok) {
    setStatus(
      "err",
      "Модуль вычислений загружен, но требуемые функции недоступны.",
    );
    setUiEnabled(false);
  } else {
    setUiEnabled(true);
    setStatus(
      "ok",
      "Готов к работе. Откройте файл конфигурации или вставьте её в поле ниже.",
    );
  }
} catch (e) {
  logError("Не удалось загрузить модуль вычислений", e);
  setStatus(
    "err",
    "Не удалось загрузить модуль вычислений. Подробности в консоли браузера.",
  );
  setUiEnabled(false);
}
