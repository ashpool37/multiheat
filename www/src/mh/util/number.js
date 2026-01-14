export const isFiniteNonNegative = (x) => Number.isFinite(x) && x >= 0;
export const isFinitePositive = (x) => Number.isFinite(x) && x > 0;

export const parseNumber = (raw, fieldName) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n))
    throw new Error(`Некорректное числовое значение: ${fieldName}.`);
  return n;
};

export const fmtNum = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s;
};
