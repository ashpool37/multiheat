import { defaultState } from "../model/state.js";

/**
 * App store (single source of truth).
 *
 * This module intentionally stays tiny and "dumb": it only defines the canonical
 * state container + dirty flags used by the UI. All behavior lives in
 * controllers/coordinators (tabs, views, uploads, solve/verify, etc).
 */

/**
 * Create a new store instance.
 *
 * Shape and defaults are kept compatible with the original monolithic `main.js`:
 * - `state` is canonical normalized config-like state
 * - `activeTab` is a string key ("toml" by default)
 * - `viewsSuspended` gates all view regeneration (Hide mode)
 * - `dirty` tracks manual edits in textareas
 *
 * @param {object} [opts]
 * @param {any} [opts.state] Initial canonical state (defaults to `defaultState()`)
 * @param {string} [opts.activeTab] Initial active tab key (defaults to "toml")
 */
export const createStore = (opts = {}) => {
  const initialState = opts.state ?? defaultState();
  const initialTab = opts.activeTab ?? "toml";

  return {
    state: initialState,
    activeTab: initialTab,
    viewsSuspended: false,
    dirty: {
      toml: false,
      csvStreams: false,
      csvSolution: false,
    },
  };
};

/**
 * Convenience helper: mark all editors clean.
 * (Matches how the original code reset dirty flags after sync/solve/upload.)
 *
 * @param {ReturnType<typeof createStore>} store
 */
export const clearDirtyFlags = (store) => {
  store.dirty.toml = false;
  store.dirty.csvStreams = false;
  store.dirty.csvSolution = false;
};
