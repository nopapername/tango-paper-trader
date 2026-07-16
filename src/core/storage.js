(function initStorage(global) {
  const Tango = global.Tango = global.Tango || {};
  const listeners = new Set();

  async function readRaw(keys) {
    if (global.chrome?.storage?.local) return global.chrome.storage.local.get(keys);
    const result = {};
    (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
      const value = global.localStorage?.getItem(key);
      if (value != null) result[key] = JSON.parse(value);
    });
    return result;
  }

  async function writeRaw(values) {
    if (global.chrome?.storage?.local) return global.chrome.storage.local.set(values);
    Object.entries(values).forEach(([key, value]) => global.localStorage?.setItem(key, JSON.stringify(value)));
  }

  function normalizeSettings(settings) {
    return { ...Tango.DEFAULT_SETTINGS, ...(settings || {}) };
  }

  function normalizeState(state, settings) {
    const base = Tango.createInitialState(settings.initialBalanceSol);
    if (!state || Number(state.schemaVersion) !== 1) return base;
    return {
      ...base,
      ...state,
      account: { ...base.account, ...(state.account || {}) },
      positions: state.positions || {},
      trades: Array.isArray(state.trades) ? state.trades.slice(0, Tango.MAX_TRADES) : [],
      dailyRealized: state.dailyRealized || {}
    };
  }

  async function getAll() {
    const raw = await readRaw([Tango.STORAGE_KEY, Tango.SETTINGS_KEY]);
    const settings = normalizeSettings(raw[Tango.SETTINGS_KEY]);
    const state = normalizeState(raw[Tango.STORAGE_KEY], settings);
    return { state, settings };
  }

  async function saveState(state) {
    await writeRaw({ [Tango.STORAGE_KEY]: state });
    notify();
    return state;
  }

  async function saveSettings(settings) {
    const next = normalizeSettings(settings);
    await writeRaw({ [Tango.SETTINGS_KEY]: next });
    notify();
    return next;
  }

  async function initialize(initialBalanceSol, language) {
    const { settings } = await getAll();
    const nextSettings = normalizeSettings({ ...settings, initialBalanceSol: Number(initialBalanceSol), language });
    const state = Tango.createInitialState(nextSettings.initialBalanceSol);
    state.initialized = true;
    await writeRaw({ [Tango.STORAGE_KEY]: state, [Tango.SETTINGS_KEY]: nextSettings });
    notify();
    return { state, settings: nextSettings };
  }

  async function reset() {
    const { settings } = await getAll();
    const state = Tango.createInitialState(settings.initialBalanceSol);
    state.initialized = true;
    await saveState(state);
    return state;
  }

  async function exportData() {
    const data = await getAll();
    return { product: 'Tango Paper Trader', version: Tango.VERSION, exportedAt: Date.now(), ...data };
  }

  async function importData(payload) {
    if (!payload || payload.product !== 'Tango Paper Trader' || !payload.state || !payload.settings) {
      throw new Error('importFailed');
    }
    const settings = normalizeSettings(payload.settings);
    const state = normalizeState(payload.state, settings);
    state.initialized = true;
    await writeRaw({ [Tango.STORAGE_KEY]: state, [Tango.SETTINGS_KEY]: settings });
    notify();
    return { state, settings };
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify() {
    listeners.forEach((listener) => Promise.resolve().then(listener));
  }

  if (global.chrome?.storage?.onChanged) {
    global.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[Tango.STORAGE_KEY] || changes[Tango.SETTINGS_KEY])) notify();
    });
  }

  Tango.Store = { getAll, saveState, saveSettings, initialize, reset, exportData, importData, subscribe };
})(globalThis);
