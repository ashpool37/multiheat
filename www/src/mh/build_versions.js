/**
 * build_versions.js — константы версий сборки для Web UI.
 *
 * Назначение:
 * - получить `multiheat_version` и `earliest_config_version` из Zig/WASM entrypoint;
 * - предоставить функции разбора и сравнения semver для валидации конфигураций;
 * - обеспечить единый “источник правды” версий со стороны сборки (Zig/WASM), без хардкода в UI.
 *
 * Ожидаемые экспорты из `www/zig/multiheat_entry.zig`:
 * - `multiheat_version` (строка "MAJOR.MINOR.PATCH")
 * - `earliest_config_version` (строка "MAJOR.MINOR.PATCH")
 */

/**
 * @typedef {{ major: number, minor: number, patch: number, raw: string }} SemVer
 */

/**
 * Разобрать semver вида "MAJOR.MINOR.PATCH".
 * Строго: ровно 3 компоненты, каждая — неотрицательное целое.
 *
 * @param {string} s
 * @returns {SemVer|null}
 */
export const parseSemVer = (s) => {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);

  if (!Number.isInteger(major) || major < 0) return null;
  if (!Number.isInteger(minor) || minor < 0) return null;
  if (!Number.isInteger(patch) || patch < 0) return null;

  return { major, minor, patch, raw };
};

/**
 * Полное сравнение semver: a >= b.
 *
 * @param {SemVer} a
 * @param {SemVer} b
 * @returns {boolean}
 */
export const semverGE = (a, b) => {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
};

/**
 * Требование совместимости по major/minor:
 * major/minor версии конфигурации не должны быть "новее" major/minor текущей сборки.
 *
 * @param {SemVer} config
 * @param {SemVer} build
 * @returns {boolean}
 */
export const semverMajorMinorNotNewer = (config, build) => {
  if (config.major < build.major) return true;
  if (config.major > build.major) return false;
  return config.minor <= build.minor;
};

/**
 * Нормализовать доступ к экспортам zigar (иногда экспорты лежат в `default`).
 *
 * @param {any} wasmModule
 * @returns {any}
 */
const unwrapWasmModule = (wasmModule) => {
  if (!wasmModule) return null;
  if (typeof wasmModule === "object" && wasmModule && "default" in wasmModule) {
    // Некоторые сборки содержат только default export (или смешанный объект).
    return wasmModule.default ?? wasmModule;
  }
  return wasmModule;
};

/**
 * Привести значение экспорта WASM к строке версии.
 *
 * @param {any} v
 * @returns {string|null}
 */
const toVersionString = (v) => {
  if (v === null || v === undefined) return null;

  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 ? s : null;
  }

  // На случай, если версия приехала как bytes.
  if (typeof Uint8Array !== "undefined" && v instanceof Uint8Array) {
    try {
      const s = new TextDecoder("utf-8").decode(v).trim();
      return s.length > 0 ? s : null;
    } catch {
      return null;
    }
  }

  // На случай, если zigar вернул object-обёртку с `.value`.
  if (typeof v === "object" && v && "value" in v) {
    return toVersionString(v.value);
  }

  // Частый случай для zigar: `[]const u8` экспортируется как slice-объект.
  // Он может быть:
  // - array-like: { length, 0..length-1 }
  // - иметь поле len вместо length
  // В обоих случаях пытаемся собрать Uint8Array и декодировать как UTF-8.
  if (typeof v === "object" && v) {
    const lenRaw =
      "length" in v
        ? v.length
        : "len" in v
          ? v.len
          : "byteLength" in v
            ? v.byteLength
            : null;

    const len = Number(lenRaw);

    if (
      Number.isFinite(len) &&
      Number.isInteger(len) &&
      len >= 0 &&
      len <= 256
    ) {
      try {
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          const b = Number(v[i]);
          bytes[i] = Number.isFinite(b) ? b & 0xff : 0;
        }
        const s = new TextDecoder("utf-8").decode(bytes).trim();
        return s.length > 0 ? s : null;
      } catch {
        // Если slice не индексируется, упадём в общий фолбэк ниже.
      }
    }
  }

  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

/**
 * Прочитать версии сборки из Zig/WASM entrypoint и вернуть как строки + распарсенные semver.
 *
 * @param {any} wasmModule импортированный модуль `../../../zig/multiheat_entry.zig`
 * @returns {{
 *  multiheat_version: string,
 *  earliest_config_version: string,
 *  multiheat: SemVer,
 *  earliest: SemVer
 * }}
 */
export const getBuildVersions = (wasmModule) => {
  const m = unwrapWasmModule(wasmModule);

  // 1) Основной путь: строки multiheat_version/earliest_config_version.
  // 2) Фолбэк: числа major/minor/patch (если строка пришла в виде slice-объекта или отсутствует).
  const fromTriplet = (prefix) => {
    const major = Number(m?.[`${prefix}_major`]);
    const minor = Number(m?.[`${prefix}_minor`]);
    const patch = Number(m?.[`${prefix}_patch`]);

    if (!Number.isInteger(major) || major < 0) return null;
    if (!Number.isInteger(minor) || minor < 0) return null;
    if (!Number.isInteger(patch) || patch < 0) return null;

    return `${major}.${minor}.${patch}`;
  };

  const buildStr =
    toVersionString(m?.multiheat_version) ?? fromTriplet("multiheat_version");
  const earliestStr =
    toVersionString(m?.earliest_config_version) ??
    fromTriplet("earliest_config_version");

  if (!buildStr) {
    throw new Error(
      "Не удалось определить multiheat_version из Zig/WASM (ожидается экспорт multiheat_version или multiheat_version_{major,minor,patch}).",
    );
  }
  if (!earliestStr) {
    throw new Error(
      "Не удалось определить earliest_config_version из Zig/WASM (ожидается экспорт earliest_config_version или earliest_config_version_{major,minor,patch}).",
    );
  }

  const build = parseSemVer(buildStr);
  const earliest = parseSemVer(earliestStr);

  if (!build) {
    throw new Error(
      `Некорректный формат multiheat_version: "${buildStr}". Ожидается MAJOR.MINOR.PATCH.`,
    );
  }
  if (!earliest) {
    throw new Error(
      `Некорректный формат earliest_config_version: "${earliestStr}". Ожидается MAJOR.MINOR.PATCH.`,
    );
  }

  return {
    multiheat_version: buildStr,
    earliest_config_version: earliestStr,
    multiheat: build,
    earliest,
  };
};

/**
 * Проверить совместимость версии конфигурации с текущей сборкой.
 *
 * Требования:
 * 1) config_version >= earliest_config_version
 * 2) major/minor config_version не новее major/minor multiheat_version (текущей сборки)
 *
 * @param {string} configVersionStr
 * @param {{ multiheat: SemVer, earliest: SemVer }} versions
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export const checkConfigVersionCompatibility = (configVersionStr, versions) => {
  const cfg = parseSemVer(configVersionStr);

  if (!cfg) {
    return {
      ok: false,
      reason: `Некорректный формат multiheat.version: "${String(configVersionStr ?? "")}". Ожидается MAJOR.MINOR.PATCH.`,
    };
  }

  if (!semverGE(cfg, versions.earliest)) {
    return {
      ok: false,
      reason: `Версия конфигурации "${cfg.raw}" не поддерживается. Минимальная поддерживаемая версия: "${versions.earliest.raw}".`,
    };
  }

  if (!semverMajorMinorNotNewer(cfg, versions.multiheat)) {
    return {
      ok: false,
      reason: `Версия конфигурации "${cfg.raw}" новее текущей сборки по major/minor. Текущая версия: "${versions.multiheat.raw}".`,
    };
  }

  return { ok: true };
};
