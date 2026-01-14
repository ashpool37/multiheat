/**
 * Утилиты CSV.
 *
 * `parseCsv(text)` возвращает массив строк; все ячейки нормализуются через `trim()`.
 */

/**
 * `csvJoin(cells)` → строка CSV (с экранированием при необходимости).
 * @param {Array<unknown>} cells
 * @returns {string}
 */
export const csvJoin = (cells) => {
  const esc = (x) => {
    const str = String(x ?? "");
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  return cells.map(esc).join(",");
};

/**
 * `parseCsv(text)` → `string[][]`.
 * Поддерживает кавычки и экранирование `""`, разделитель `,`, переводы строк CRLF/CR/LF.
 * @param {string} text
 * @returns {string[][]}
 */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  const s = String(text ?? "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
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
