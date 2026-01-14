/**
 * Утилиты для обработки ошибок в UI.
 */

/**
 * `toErrorText(e)` → `string`.
 * @param {unknown} e
 * @returns {string}
 */
export const toErrorText = (e) => {
  if (e instanceof Error) return e.message || String(e);
  return String(e);
};

/**
 * `isAbortError(e)` → `boolean` (отмена пользователем в File System Access API).
 * @param {unknown} e
 * @returns {boolean}
 */
export const isAbortError = (e) =>
  typeof e === "object" && e !== null && "name" in e && e.name === "AbortError";

/**
 * `isDebugEnabled()` → `boolean`.
 * Управление подробным логированием через `localStorage["multiheat:debug"] === "1"`.
 * @returns {boolean}
 */
export const isDebugEnabled = () => {
  try {
    return localStorage.getItem("multiheat:debug") === "1";
  } catch {
    return false;
  }
};

const nowIso = () => {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
};

const safeString = (v) => {
  try {
    return String(v);
  } catch {
    return "[unprintable]";
  }
};

const errorSummary = (e) => {
  if (e instanceof Error) {
    const out = {
      name: e.name,
      message: e.message,
      stack: e.stack,
    };
    if ("cause" in e) out.cause = e.cause;
    return out;
  }
  return { value: e, text: safeString(e) };
};

const likelyWasmLoadHints = (msgLower) => {
  const hints = [];

  // Типичные ошибки динамического import() при неправильной базе/путях/серверной выдаче.
  if (
    msgLower.includes("failed to fetch dynamically imported module") ||
    msgLower.includes("importing a module script failed") ||
    msgLower.includes("error loading dynamically imported module")
  ) {
    hints.push(
      "Похоже, не удалось загрузить JS-чанк через динамический import(). Проверьте `base` в Vite и пути при хостинге под подкаталогом (GitHub Pages).",
    );
    hints.push(
      "Также проверьте конфигурацию сервера: нельзя отдавать `index.html` вместо `/assets/*.js` (SPA fallback должен исключать ассеты).",
    );
  }

  // Когда сервер возвращает HTML (например, index.html) вместо JS-чанка.
  if (
    msgLower.includes("unexpected token") &&
    (msgLower.includes("<") ||
      msgLower.includes("doctype") ||
      msgLower.includes("html"))
  ) {
    hints.push(
      "Похоже, вместо JS-чанка пришёл HTML (часто это `index.html`). Проверьте пути/`base` и правила rewrite на сервере.",
    );
  }

  // MIME-type для WASM / instantiateStreaming.
  if (
    msgLower.includes("webassembly.instantiatestreaming") ||
    msgLower.includes("mime") ||
    msgLower.includes("application/wasm")
  ) {
    hints.push(
      "Похоже на проблему с MIME-типом WASM. Сервер должен отдавать `.wasm` как `application/wasm` (или загрузчик должен корректно падать на non-streaming).",
    );
  }

  // CSP может блокировать компиляцию WASM.
  if (
    msgLower.includes("content security policy") ||
    msgLower.includes("csp")
  ) {
    hints.push(
      "Похоже на блокировку CSP. Проверьте `script-src` и разрешения на компиляцию WASM (например, `wasm-unsafe-eval`, в зависимости от политики).",
    );
  }

  return hints;
};

/**
 * `logInfo(context, details?)` → `void`.
 * @param {string} context
 * @param {unknown} [details]
 */
export const logInfo = (context, details) => {
  console.info(`[multiheat] ${context}`, details);
};

/**
 * `logWarn(context, details?)` → `void`.
 * @param {string} context
 * @param {unknown} [details]
 */
export const logWarn = (context, details) => {
  console.warn(`[multiheat] ${context}`, details);
};

/**
 * `logDebug(context, details?)` → `void`.
 * Логируется только при `isDebugEnabled() === true`.
 * @param {string} context
 * @param {unknown} [details]
 */
export const logDebug = (context, details) => {
  if (!isDebugEnabled()) return;
  console.debug(`[multiheat] ${context}`, details);
};

/**
 * `summarizeModuleExports(mod)` → краткий отчёт по форме импортированного модуля.
 * Полезно для случаев, когда в prod экспорты лежат под `default`.
 *
 * @param {any} mod
 * @returns {{ keys: string[], hasDefault: boolean, defaultKeys: string[] }}
 */
export const summarizeModuleExports = (mod) => {
  const keys =
    mod && (typeof mod === "object" || typeof mod === "function")
      ? Object.keys(mod)
      : [];
  const hasDefault =
    !!mod &&
    (typeof mod === "object" || typeof mod === "function") &&
    "default" in mod;

  const def = hasDefault ? mod.default : null;
  const defaultKeys =
    def && (typeof def === "object" || typeof def === "function")
      ? Object.keys(def)
      : [];

  return { keys, hasDefault, defaultKeys };
};

/**
 * `logError(context, e, extra?)` → `void`.
 * Расширенное логирование с подсказками для диагностики проблем загрузки Zig/WASM в production.
 *
 * @param {string} context
 * @param {unknown} e
 * @param {Record<string, unknown>} [extra]
 */
export const logError = (context, e, extra) => {
  const ts = nowIso();
  const summary = errorSummary(e);

  // Группируем, чтобы не терять важные детали (stack/cause) в шуме консоли.
  const title = ts
    ? `[multiheat] ${context} (${ts})`
    : `[multiheat] ${context}`;
  console.groupCollapsed(title);

  console.error(`[multiheat] ${context}`, e);

  try {
    console.log("[multiheat] location.href:", window?.location?.href);
    console.log("[multiheat] document.baseURI:", document?.baseURI);
    console.log("[multiheat] summary:", summary);
    if (extra) console.log("[multiheat] extra:", extra);

    const msg =
      summary && typeof summary.message === "string"
        ? summary.message
        : typeof summary.text === "string"
          ? summary.text
          : safeString(e);

    const msgLower = msg.toLowerCase();
    const hints = likelyWasmLoadHints(msgLower);
    if (hints.length > 0) {
      console.warn("[multiheat] Возможные причины:");
      for (const h of hints) console.warn(" - " + h);
    }
  } catch {
    // Ничего: логирование не должно ломать приложение.
  } finally {
    console.groupEnd();
  }
};

/**
 * `enableGlobalErrorLogging()` подключает обработчики `error`/`unhandledrejection`.
 * Это нужно, чтобы увидеть причины “тихих” падений динамических import()/WASM в production.
 *
 * Важно: функция идемпотентна.
 *
 * @returns {void}
 */
export const enableGlobalErrorLogging = () => {
  if (typeof window === "undefined") return;

  // Почему: предотвращаем повторную установку обработчиков при повторных импортов модулей.
  if (window.__multiheat_global_error_logging_enabled) return;
  window.__multiheat_global_error_logging_enabled = true;

  window.addEventListener("error", (ev) => {
    // ev.error может быть undefined для некоторых ошибок загрузки ресурсов.
    logError("Глобальная ошибка (window.error)", ev.error ?? ev.message, {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
      type: ev.type,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    logError(
      "Необработанное отклонение промиса (unhandledrejection)",
      ev.reason,
      {
        type: ev.type,
      },
    );
  });

  logDebug("Глобальные обработчики ошибок подключены", {
    href: window.location?.href,
    baseURI: document?.baseURI,
    userAgent: navigator?.userAgent,
  });
};

/**
 * `isTraceEnabled()` → `boolean`.
 * Управление трассировкой низкоуровневых событий загрузки через
 * `localStorage["multiheat:trace"] === "1"`.
 *
 * Зачем: иногда `import()` “зависает” (top-level await внутри подключаемого модуля),
 * и в консоли нет явной причины. Эти хуки помогают увидеть, что именно происходит
 * (fetch, WebAssembly, Worker) во время инициализации.
 *
 * @returns {boolean}
 */
export const isTraceEnabled = () => {
  try {
    return localStorage.getItem("multiheat:trace") === "1";
  } catch {
    return false;
  }
};

const safeUrlForLog = (input) => {
  try {
    if (typeof input === "string") return input;
    if (input && typeof input === "object" && "url" in input) return input.url;
    return safeString(input);
  } catch {
    return "[unprintable url]";
  }
};

const withDurationMs = (t0) => {
  const t1 = (() => {
    try {
      return typeof performance !== "undefined" &&
        typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    } catch {
      return Date.now();
    }
  })();

  const dt = t1 - t0;
  return typeof dt === "number" && Number.isFinite(dt)
    ? Math.round(dt * 10) / 10
    : null;
};

const nowMs = () => {
  try {
    return typeof performance !== "undefined" &&
      typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
};

/**
 * `enableRuntimeTracing()` подключает трассировку `fetch` / `WebAssembly` / `Worker`.
 *
 * Важно:
 * - включается ТОЛЬКО при `localStorage["multiheat:trace"] === "1"`
 * - идемпотентна
 * - не должна менять поведение (только логировать)
 *
 * @returns {void}
 */
export const enableRuntimeTracing = () => {
  if (typeof window === "undefined") return;

  if (!isTraceEnabled()) return;

  if (window.__multiheat_runtime_tracing_enabled) return;
  window.__multiheat_runtime_tracing_enabled = true;

  // --- fetch() ---
  try {
    if (
      typeof window.fetch === "function" &&
      !window.__multiheat_fetch_patched
    ) {
      const originalFetch = window.fetch.bind(window);

      window.fetch = async (...args) => {
        const t0 = nowMs();
        const url = safeUrlForLog(args[0]);
        const init = args[1] ?? null;

        logInfo("TRACE fetch →", {
          url,
          method: init?.method ?? (args[0] && args[0].method) ?? "GET",
          mode: init?.mode ?? (args[0] && args[0].mode) ?? null,
          credentials:
            init?.credentials ?? (args[0] && args[0].credentials) ?? null,
          cache: init?.cache ?? (args[0] && args[0].cache) ?? null,
        });

        try {
          const res = await originalFetch(...args);
          logInfo("TRACE fetch ←", {
            url,
            status: res?.status ?? null,
            ok: res?.ok ?? null,
            redirected: res?.redirected ?? null,
            type: res?.type ?? null,
            contentType: (() => {
              try {
                return res?.headers?.get?.("content-type") ?? null;
              } catch {
                return null;
              }
            })(),
            duration_ms: withDurationMs(t0),
          });
          return res;
        } catch (e) {
          logError("TRACE fetch ×", e, {
            url,
            duration_ms: withDurationMs(t0),
          });
          throw e;
        }
      };

      window.__multiheat_fetch_patched = true;
      logDebug("TRACE: fetch() перехвачен", {});
    }
  } catch (e) {
    logError("TRACE: не удалось перехватить fetch()", e);
  }

  // --- WebAssembly.* ---
  try {
    if (typeof WebAssembly === "object" && WebAssembly) {
      if (
        typeof WebAssembly.instantiateStreaming === "function" &&
        !WebAssembly.__multiheat_instantiateStreaming_patched
      ) {
        const orig = WebAssembly.instantiateStreaming.bind(WebAssembly);
        WebAssembly.instantiateStreaming = async (source, importObject) => {
          const t0 = nowMs();

          let ct = null;
          try {
            if (source && typeof source === "object" && "headers" in source) {
              ct = source.headers?.get?.("content-type") ?? null;
            }
          } catch {
            ct = null;
          }

          logInfo("TRACE WebAssembly.instantiateStreaming →", {
            sourceType: typeof source,
            contentType: ct,
          });

          try {
            const out = await orig(source, importObject);
            logInfo("TRACE WebAssembly.instantiateStreaming ←", {
              duration_ms: withDurationMs(t0),
            });
            return out;
          } catch (e) {
            logError("TRACE WebAssembly.instantiateStreaming ×", e, {
              duration_ms: withDurationMs(t0),
            });
            throw e;
          }
        };

        WebAssembly.__multiheat_instantiateStreaming_patched = true;
        logDebug("TRACE: WebAssembly.instantiateStreaming перехвачен", {});
      }

      if (
        typeof WebAssembly.instantiate === "function" &&
        !WebAssembly.__multiheat_instantiate_patched
      ) {
        const orig = WebAssembly.instantiate.bind(WebAssembly);
        WebAssembly.instantiate = async (
          bufferSourceOrModule,
          importObject,
        ) => {
          const t0 = nowMs();

          const kind = (() => {
            try {
              if (bufferSourceOrModule instanceof WebAssembly.Module)
                return "WebAssembly.Module";
            } catch {}
            try {
              if (bufferSourceOrModule instanceof ArrayBuffer)
                return "ArrayBuffer";
            } catch {}
            const t = typeof bufferSourceOrModule;
            return t === "object" ? "object" : t;
          })();

          logInfo("TRACE WebAssembly.instantiate →", { input: kind });

          try {
            const out = await orig(bufferSourceOrModule, importObject);
            logInfo("TRACE WebAssembly.instantiate ←", {
              duration_ms: withDurationMs(t0),
            });
            return out;
          } catch (e) {
            logError("TRACE WebAssembly.instantiate ×", e, {
              input: kind,
              duration_ms: withDurationMs(t0),
            });
            throw e;
          }
        };

        WebAssembly.__multiheat_instantiate_patched = true;
        logDebug("TRACE: WebAssembly.instantiate перехвачен", {});
      }
    }
  } catch (e) {
    logError("TRACE: не удалось перехватить WebAssembly.*", e);
  }

  // --- Worker ---
  try {
    if (typeof Worker === "function" && !window.__multiheat_worker_patched) {
      const OriginalWorker = Worker;

      // Почему: подменяем конструктор, чтобы увидеть, создаются ли воркеры и с каким URL.
      // eslint-disable-next-line no-global-assign
      Worker = function (...args) {
        const t0 = nowMs();
        const url = safeUrlForLog(args[0]);
        const opts = args[1] ?? null;

        logInfo("TRACE new Worker() →", {
          url,
          type: opts?.type ?? null,
          name: opts?.name ?? null,
          credentials: opts?.credentials ?? null,
        });

        try {
          const w = new OriginalWorker(...args);
          logInfo("TRACE new Worker() ←", {
            url,
            duration_ms: withDurationMs(t0),
          });
          return w;
        } catch (e) {
          logError("TRACE new Worker() ×", e, {
            url,
            duration_ms: withDurationMs(t0),
          });
          throw e;
        }
      };

      window.__multiheat_worker_patched = true;
      logDebug("TRACE: Worker перехвачен", {});
    }
  } catch (e) {
    logError("TRACE: не удалось перехватить Worker", e);
  }

  logInfo("TRACE: трассировка runtime включена", {
    href: window.location?.href,
    baseURI: document?.baseURI,
    crossOriginIsolated:
      typeof window?.crossOriginIsolated === "boolean"
        ? window.crossOriginIsolated
        : null,
    hasWorker: typeof Worker === "function",
    hasSharedArrayBuffer: typeof SharedArrayBuffer === "function",
    hasInstantiateStreaming:
      typeof WebAssembly?.instantiateStreaming === "function",
  });
};

// Подключаем глобальные обработчики сразу при загрузке модуля утилит ошибок.
enableGlobalErrorLogging();

// Трассировку включаем только по флагу в localStorage, чтобы не “шуметь” в обычном режиме.
enableRuntimeTracing();
