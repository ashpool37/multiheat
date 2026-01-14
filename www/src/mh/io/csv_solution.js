import { csvJoin, parseCsv } from "../util/csv.js";
import { fmtNum, isFinitePositive, parseNumber } from "../util/number.js";

/**
 * Emit CSV for the current solution (exchangers).
 * Preserves the exact headers/labels/types used previously in `main.js`.
 *
 * @param {any} state
 * @returns {string}
 */
export const emitCsvSolution = (state) => {
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

  const exch = Array.isArray(state?.exchanger) ? state.exchanger : [];
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

/**
 * Parse CSV solution into canonical exchanger records.
 * Preserves parsing rules/errors from the previous implementation in `main.js`.
 *
 * @param {string} text
 * @param {number} hotLen
 * @param {number} coldLen
 * @returns {{hot: number|null, cold: number|null, load: number}[]}
 */
export const parseCsvSolutionToExchangers = (text, hotLen, coldLen) => {
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
