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

  const usesExtensionCoordinator = Boolean(global.chrome?.storage?.local && global.chrome?.runtime?.sendMessage);
  const coordinator = usesExtensionCoordinator ? null : Tango.StateCoordinator.create({ readRaw, writeRaw });

  async function sendCoordinatorMessage(message) {
    const response = await global.chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      const error = new Error(response?.error || 'storageFailed');
      const details = response?.errorDetails;
      if (details && ['storageFull', 'importTooLarge'].includes(details.code)
        && Number.isSafeInteger(details.measuredBytes)
        && Number.isSafeInteger(details.budgetBytes)) {
        error.code = details.code;
        error.measuredBytes = details.measuredBytes;
        error.budgetBytes = details.budgetBytes;
      }
      throw error;
    }
    return response.result;
  }

  async function runMutation(command) {
    const result = usesExtensionCoordinator
      ? await sendCoordinatorMessage({ type: 'TANGO_STORE_MUTATE', command })
      : await coordinator.mutate(command);
    if (!global.chrome?.storage?.local) notify();
    return result;
  }

  function normalizeSettings(settings) {
    return Tango.State.normalizeSettings(settings);
  }

  function normalizeState(state, settings) {
    return Tango.State.normalizeState(state, settings);
  }

  async function getAll() {
    return usesExtensionCoordinator
      ? sendCoordinatorMessage({ type: 'TANGO_STORE_GET_ALL' })
      : coordinator.getAll();
  }

  async function saveState(state) {
    const result = await runMutation({
      type: 'REPLACE_STATE',
      state,
      expectedRevision: state?.stateRevision ?? 0
    });
    return result.state;
  }

  async function saveSettings(settings) {
    const result = await runMutation({ type: 'SAVE_SETTINGS', settings });
    return result.settings;
  }

  async function patchSettings(patch) {
    const result = await runMutation({ type: 'PATCH_SETTINGS', patch });
    return result.settings;
  }

  async function initialize(defaultBalanceNative = 10, language) {
    return runMutation({ type: 'INITIALIZE', defaultBalanceNative, language });
  }

  async function resetChain(chain, balanceNative = 10) {
    return (await runMutation({ type: 'RESET_CHAIN', chain, balanceNative })).state;
  }

  async function resetAll() {
    return (await runMutation({ type: 'RESET_ALL' })).state;
  }

  async function resetAllWithBalance(balanceNative, language, settingsPatch) {
    return runMutation({ type: 'RESET_ALL_WITH_BALANCE', balanceNative, language, settingsPatch });
  }

  async function exportData() {
    const data = await getAll();
    return { product: 'Tango Paper Trader', version: Tango.VERSION, exportedAt: Date.now(), ...data };
  }

  async function importData(payload) {
    return runMutation({ type: 'IMPORT', payload });
  }

  const executeBuy = (order) => runMutation({ type: 'EXECUTE_BUY', order });
  const executeSell = (order) => runMutation({ type: 'EXECUTE_SELL', order });
  const executeCloseAll = (chain, orders) => runMutation({ type: 'EXECUTE_CLOSE_ALL', chain, orders });
  const updatePositionQuote = async (token, quote) => (await runMutation({ type: 'UPDATE_POSITION_QUOTE', token, quote })).state;
  const updatePositionMetadata = async (token) => (await runMutation({ type: 'UPDATE_POSITION_METADATA', token })).state;
  const updatePositionMetadataBatch = async (tokens) => (await runMutation({ type: 'UPDATE_POSITION_METADATA_BATCH', tokens })).state;

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

  Tango.Store = {
    getAll, saveState, saveSettings, patchSettings, initialize, resetChain, resetAll, resetAllWithBalance, reset: resetAll,
    exportData, importData, executeBuy, executeSell, executeCloseAll,
    updatePositionQuote, updatePositionMetadata, updatePositionMetadataBatch, subscribe
  };
})(globalThis);
