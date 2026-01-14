/**
 * CSV helpers.
 *
 * Notes:
 * - `parseCsv` is a minimal RFC4180-ish parser with proper quote handling,
 *   intended to accept CSV exported by Excel/LibreOffice.
 * - It trims cells (matches previous frontend behavior).
 */

/**
 * Join cells into a single CSV line with escaping.
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
 * Parse CSV text into rows and trimmed string cells.
 * Supports:
 * - quoted cells with escaped quotes ("")
 * - commas as separators
 * - CRLF/CR/LF newlines
 *
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
