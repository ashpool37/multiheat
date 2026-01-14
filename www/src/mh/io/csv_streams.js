import { csvJoin, parseCsv } from "../util/csv.js";
import {
  fmtNum,
  isFiniteNonNegative,
  isFinitePositive,
  parseNumber,
} from "../util/number.js";

/**
 * Emit streams CSV in the UI's Excel/LibreOffice-friendly format.
 * Behavior matches the previous monolithic implementation.
 *
 * @param {{ hot: any[], cold: any[] }} state
 * @returns {string}
 */
export const emitCsvStreams = (state) => {
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

/**
 * Parse streams CSV into a partial canonical state: `{ hot, cold }`.
 * Throws on invalid input (matches previous behavior).
 *
 * @param {string} text
 * @returns {{ hot: any[], cold: any[] }}
 */
export const parseCsvStreamsToStatePartial = (text) => {
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
