const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

global.Tango = {};
const Chains = require('../src/core/chains.js');
const popupSource = fs.readFileSync(path.resolve(__dirname, '../src/popup/popup.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function stateFixture() {
  return {
    initialized: true,
    accounts: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
      initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 0
    }])),
    positions: {}, trades: [],
    dailyRealizedByChain: Object.fromEntries(Chains.all().map((chain) => [chain.id, {}]))
  };
}

function settingsFixture() {
  return {
    selectedChain: 'eth', language: 'en', enabled: true, displayCurrency: 'NATIVE',
    chains: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
      buyPresets: [1], networkFeeNative: 0.001, initialBalanceNative: 10
    }]))
  };
}

function mergeSettingsPatch(settings, patch) {
  const chains = { ...settings.chains };
  Object.entries(patch.chains || {}).forEach(([chainId, chainPatch]) => {
    chains[chainId] = { ...chains[chainId], ...chainPatch };
  });
  return { ...settings, ...patch, chains };
}

async function loadPopup({ failFirstGetAll = false, failAction = '', initialized = true } = {}) {
  const elements = new Map();
  let document;
  let markup = '';
  const createElement = (selector, source = '') => {
    const listeners = new Map();
    const selected = source.match(/<option\s+value="([^"]+)"[^>]*\bselected\b/i)?.[1];
    const value = selected || source.match(/\bvalue="([^"]*)"/i)?.[1] || '';
    return {
      selector, value, checked: /\bchecked\b/i.test(source), files: [],
      addEventListener(type, listener) { listeners.set(type, listener); },
      emit(type) { return listeners.get(type)?.({ target: this }); },
      click() { return listeners.get('click')?.({ target: this }); }
    };
  };
  const element = (selector) => {
    if (selector === '#app') return app;
    if (elements.has(selector)) return elements.get(selector);
    if (!selector.startsWith('#')) return null;
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const opening = markup.match(new RegExp(`<([a-z]+)[^>]*\\bid="${id}"[^>]*>`, 'i'));
    if (!opening) return null;
    const tag = opening[1].toLowerCase();
    const start = opening.index;
    const end = tag === 'select' ? markup.indexOf('</select>', start) : start + opening[0].length;
    const source = markup.slice(start, end < 0 ? start + opening[0].length : end);
    const node = createElement(selector, source);
    elements.set(selector, node);
    return node;
  };
  const app = {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = String(value); elements.clear(); }
  };
  let persistedState = stateFixture();
  persistedState.initialized = initialized;
  let persistedSettings = settingsFixture();
  let getAllCalls = 0;
  const confirmations = [];
  const openedTabs = [];
  const calls = { saves: [], fullSaves: [], initialize: 0, resetChain: 0, resetChainArgs: [], resetAll: 0 };
  const Tango = {
    Chains,
    I18n: { resolveLanguage: (value) => value || 'en', t: (key) => key },
    Format: {
      native: (value, symbol) => `${value} ${symbol}`, usd: (value) => `$${value}`
    },
    Engine: {
      markPosition: () => ({ valueNative: 0 }),
      portfolioSummary: () => ({ cashBalanceNative: 10, equityNative: 10, totalPnlNative: 0, positionCount: 0 }),
      globalUsdSummary: () => ({ assetsUsd: 0, pnlUsd: 0, complete: true })
    },
    PopupModel: {
      build(state, settings, selectedChain) {
        const chain = Chains.get(selectedChain) || Chains.get('sol');
        return {
          chain, account: state.accounts[chain.id], summary: Tango.Engine.portfolioSummary(),
          chainPositions: [], globalUsd: Tango.Engine.globalUsdSummary(), nativeSymbol: chain.nativeSymbol,
          chainOptions: Chains.all().map(({ id, name, nativeSymbol }) => ({ id, name, nativeSymbol }))
        };
      }
    },
    Store: {
      getAll() {
        getAllCalls += 1;
        if (failFirstGetAll && getAllCalls === 1) return Promise.reject(new Error('storage unavailable'));
        return Promise.resolve({ state: persistedState, settings: persistedSettings });
      },
      patchSettings(patch) {
        const gate = deferred();
        calls.saves.push({ patch, gate });
        return gate.promise.then(() => {
          persistedSettings = mergeSettingsPatch(persistedSettings, patch);
          return persistedSettings;
        });
      },
      saveSettings(next) { calls.fullSaves.push(next); throw new Error('Popup must use patchSettings'); },
      async initialize() {
        calls.initialize += 1;
        if (failAction === 'initialize' && calls.initialize === 1) throw new Error('write failed');
        return { state: persistedState, settings: persistedSettings };
      },
      async resetChain(...args) {
        calls.resetChain += 1;
        calls.resetChainArgs.push(args);
        if (failAction === 'reset-chain' && calls.resetChain === 1) throw new Error('write failed');
        return persistedState;
      },
      async resetAll() {
        calls.resetAll += 1;
        if (failAction === 'reset-all' && calls.resetAll === 1) throw new Error('write failed');
        return persistedState;
      }
    }
  };
  document = {
    documentElement: { lang: '' },
    querySelector: element
  };
  const context = {
    Promise, Object, Number, String, Array, Map, Set, Math, Date, JSON, console, Tango, document,
    setTimeout: () => 0,
    confirm: (message) => { confirmations.push(message); return true; },
    chrome: {
      runtime: {
        async sendMessage() { return { ok: true, price: 100, observedAt: 1 }; },
        openOptionsPage() {}
      },
      tabs: { create({ url }) { openedTabs.push(url); } }
    }
  };
  const startup = vm.runInNewContext(popupSource, context, { filename: 'src/popup/popup.js' });
  let startupError = null;
  try { await startup; } catch (error) { startupError = error; }
  await new Promise((resolve) => setImmediate(resolve));
  return {
    app, calls, confirmations, element, openedTabs, startupError,
    get persistedSettings() { return persistedSettings; }
  };
}

test('Popup startup storage failure renders a retry that recovers', async () => {
  const popup = await loadPopup({ failFirstGetAll: true });
  assert.equal(popup.startupError, null);
  assert.match(popup.app.innerHTML, /storageLoadFailed/);
  const retry = popup.element('#retry-storage-load');
  assert.ok(retry);
  await retry.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(popup.app.innerHTML, /id="popup-chain"/);
});

test('Popup initialization contains a rejected write, reloads authoritative setup state, and shows recovery feedback', async () => {
  const popup = await loadPopup({ failAction: 'initialize', initialized: false });
  const rejection = await popup.element('#initialize').click().then(() => null, (error) => error);

  assert.equal(rejection, null);
  assert.equal(popup.calls.initialize, 1);
  assert.match(popup.app.innerHTML, /id="initialize"/);
  assert.match(popup.app.innerHTML, /settingsSaveFailed/);
});

test('Popup reset actions contain rejected writes and restore authoritative account UI', async () => {
  for (const [failAction, selector, callField] of [
    ['reset-chain', '#reset-chain-button', 'resetChain'],
    ['reset-all', '#reset-all-button', 'resetAll']
  ]) {
    const popup = await loadPopup({ failAction });
    const rejection = await popup.element(selector).click().then(() => null, (error) => error);

    assert.equal(rejection, null, failAction);
    assert.equal(popup.calls[callField], 1, failAction);
    assert.match(popup.app.innerHTML, /id="popup-chain"/);
    assert.match(popup.app.innerHTML, /settingsSaveFailed/);
  }
});

test('Popup clears rejected-write feedback after a successful retry', async () => {
  const popup = await loadPopup({ failAction: 'reset-chain' });
  await popup.element('#reset-chain-button').click();
  assert.match(popup.app.innerHTML, /settingsSaveFailed/);

  await popup.element('#reset-chain-button').click();

  assert.equal(popup.calls.resetChain, 2);
  assert.doesNotMatch(popup.app.innerHTML, /settingsSaveFailed/);
});

test('Popup rolls back a selected chain when settings persistence fails', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  selector.value = 'bsc';
  const changing = selector.emit('change');
  await new Promise((resolve) => setImmediate(resolve));
  popup.calls.saves[0].gate.reject(new Error('write failed'));
  const rejection = await changing.then(() => null, (error) => error);
  assert.equal(rejection, null);
  assert.equal(popup.persistedSettings.selectedChain, 'eth');
  assert.equal(popup.element('#popup-chain').value, 'eth');
  assert.match(popup.app.innerHTML, /settingsSaveFailed/);
});

test('Popup restores the enabled switch when settings persistence fails', async () => {
  const popup = await loadPopup();
  const toggle = popup.element('#master-enabled');
  toggle.checked = false;
  const saving = toggle.emit('change');
  await new Promise((resolve) => setImmediate(resolve));
  popup.calls.saves[0].gate.reject(new Error('write failed'));
  const rejection = await saving.then(() => null, (error) => error);
  assert.equal(rejection, null);
  assert.equal(popup.element('#master-enabled').checked, true);
  assert.match(popup.app.innerHTML, /settingsSaveFailed/);
});

test('Popup preserves a pending chain selection when enabled changes concurrently', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  const toggle = popup.element('#master-enabled');

  selector.value = 'bsc';
  const changingChain = selector.emit('change');
  await new Promise((resolve) => setImmediate(resolve));

  toggle.checked = false;
  const changingEnabled = toggle.emit('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(popup.calls.saves.length, 1, 'settings writes must share one queue');

  popup.calls.saves[0].gate.resolve();
  await changingChain;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(popup.calls.saves[0].patch), JSON.stringify({ selectedChain: 'bsc' }));
  assert.equal(JSON.stringify(popup.calls.saves[1].patch), JSON.stringify({ enabled: false }));
  popup.calls.saves[1].gate.resolve();
  await changingEnabled;

  assert.equal(popup.persistedSettings.selectedChain, 'bsc');
  assert.equal(popup.persistedSettings.enabled, false);
  assert.deepEqual(popup.calls.fullSaves, []);
});

test('Popup account language persists only the owned language field', async () => {
  const popup = await loadPopup();
  const language = popup.element('#account-language');
  language.value = 'zh-CN';
  const saving = language.emit('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(popup.calls.saves[0].patch), JSON.stringify({ language: 'zh-CN' }));
  popup.calls.saves[0].gate.resolve();
  await saving;
  assert.equal(popup.persistedSettings.language, 'zh-CN');
});

test('Popup rolls back a failed latest chain selection to the last successful queued chain', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');

  selector.value = 'bsc';
  const firstChange = selector.emit('change');
  await new Promise((resolve) => setImmediate(resolve));

  selector.value = 'sol';
  const secondChange = selector.emit('change');
  assert.equal(popup.calls.saves.length, 1);

  popup.calls.saves[0].gate.resolve();
  await firstChange;
  await new Promise((resolve) => setImmediate(resolve));
  popup.calls.saves[1].gate.reject(new Error('write failed'));
  await secondChange;

  assert.equal(popup.persistedSettings.selectedChain, 'bsc');
  assert.equal(popup.element('#popup-chain').value, 'bsc');
  assert.match(popup.app.innerHTML, /settingsSaveFailed/);
});

test('Popup waits for a pending BSC selection before resetting the selected chain', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  const reset = popup.element('#reset-chain-button');
  selector.value = 'bsc';

  const changing = selector.emit('change');
  const resetting = reset.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(popup.calls.resetChain, 0);
  popup.calls.saves[0].gate.resolve();
  await Promise.all([changing, resetting]);
  assert.equal(popup.calls.resetChain, 1);
  assert.equal(popup.calls.resetChainArgs[0][0], 'bsc');
  assert.notEqual(popup.calls.resetChainArgs[0][0], 'eth');
});

test('Popup waits for a pending BSC selection before opening GMGN', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  const gmgn = popup.element('#gmgn');
  selector.value = 'bsc';

  const changing = selector.emit('change');
  const opening = gmgn.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(popup.openedTabs, []);
  popup.calls.saves[0].gate.resolve();
  await Promise.all([changing, opening]);
  assert.deepEqual(popup.openedTabs, [Chains.trenchUrl('bsc')]);
});

test('Popup rejected selection cancels its scoped action, rolls back, and remains usable', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  const staleReset = popup.element('#reset-chain-button');
  selector.value = 'bsc';

  const changing = selector.emit('change');
  const pendingReset = staleReset.click();
  await new Promise((resolve) => setImmediate(resolve));
  popup.calls.saves[0].gate.reject(new Error('write failed'));
  await Promise.all([changing, pendingReset]);

  assert.equal(popup.calls.resetChain, 0);
  assert.equal(popup.element('#popup-chain').value, 'eth');
  await popup.element('#reset-chain-button').click();
  assert.equal(popup.calls.resetChain, 1);
  assert.equal(popup.calls.resetChainArgs[0][0], 'eth');
});

test('Popup confirmations keep selected-chain and permanent all-six-chain resets separate', async () => {
  const popup = await loadPopup();
  await popup.element('#reset-chain-button').click();
  await popup.element('#reset-all-button').click();

  assert.deepEqual(popup.confirmations, ['resetSelectedChainConfirm', 'resetAllChainsConfirm']);
  assert.equal(popup.calls.resetChain, 1);
  assert.equal(popup.calls.resetAll, 1);
});
