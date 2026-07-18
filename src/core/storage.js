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
    return Tango.State.normalizeSettings(settings);
  }

  function normalizeState(state, settings) {
    return Tango.State.normalizeState(state, settings);
  }

  async function getAll() {
    const raw = await readRaw([Tango.STORAGE_KEY, Tango.SETTINGS_KEY]);
    const settings = normalizeSettings(raw[Tango.SETTINGS_KEY]);
    const state = normalizeState(raw[Tango.STORAGE_KEY], settings);
    return { state, settings };
  }

  async function saveState(state) {
    const next = normalizeState(state, normalizeSettings({}));
    await writeRaw({ [Tango.STORAGE_KEY]: next });
    // chrome.storage emits onChanged for this write. Notify directly only for
    // the localStorage fallback so subscribers receive exactly one refresh.
    if (!global.chrome?.storage?.local) notify();
    return next;
  }

  async function saveSettings(settings) {
    const next = normalizeSettings(settings);
    await writeRaw({ [Tango.SETTINGS_KEY]: next });
    if (!global.chrome?.storage?.local) notify();
    return next;
  }

  async function initialize(defaultBalanceNative = 10, language) {
    const { settings } = await getAll();
    const nextSettings = Tango.State.normalizeSettings({ ...settings, language });
    const initialBalances = Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, Number(defaultBalanceNative)]));
    const state = Tango.State.createInitialState({ initialBalances });
    state.initialized = true;
    await writeRaw({ [Tango.STORAGE_KEY]: state, [Tango.SETTINGS_KEY]: nextSettings });
    if (!global.chrome?.storage?.local) notify();
    return { state, settings: nextSettings };
  }

  async function resetChain(chain, balanceNative = 10) {
    const { state } = await getAll();
    const next = Tango.State.resetChain(state, chain, balanceNative, Date.now());
    await saveState(next); return next;
  }

  async function resetAll() {
    const { settings } = await getAll();
    const next = Tango.State.resetAll(settings, Date.now());
    await saveState(next); return next;
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
    const state = Tango.State.normalizeState(payload.state, settings, { strict: true });
    state.initialized = true;
    await writeRaw({ [Tango.STORAGE_KEY]: state, [Tango.SETTINGS_KEY]: settings });
    if (!global.chrome?.storage?.local) notify();
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

  Tango.Store = { getAll, saveState, saveSettings, initialize, resetChain, resetAll, reset: resetAll, exportData, importData, subscribe };
})(globalThis);
