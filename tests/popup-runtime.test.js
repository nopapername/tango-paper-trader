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

function stateFixture(balanceByChain = {}) {
  return {
    initialized: true,
    accounts: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
      initialBalanceNative: balanceByChain[chain.id] ?? 10,
      cashBalanceNative: balanceByChain[chain.id] ?? 10,
      realizedPnlNative: 0
    }])),
    positions: {}, trades: [],
    dailyRealizedByChain: Object.fromEntries(Chains.all().map((chain) => [chain.id, {}]))
  };
}

function settingsFixture(balanceByChain = {}) {
  return {
    selectedChain: 'eth', language: 'en', enabled: true, displayCurrency: 'NATIVE',
    chains: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
      buyPresets: [1], networkFeeNative: 0.001,
      initialBalanceNative: balanceByChain[chain.id] ?? 10
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

async function loadPopup({
  failFirstGetAll = false, failAction = '', initialized = true,
  accountBalances = {}, settingBalances = {}, confirmResult = true, activeTabUrl = '', nativeResponder = null, theme = 'dark', systemLight = false
} = {}) {
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
  let persistedState = stateFixture(accountBalances);
  persistedState.initialized = initialized;
  let persistedSettings = settingsFixture(settingBalances);
  persistedSettings.theme = theme;
  let getAllCalls = 0;
  const confirmations = [];
  const openedTabs = [];
  const runtimeMessages = [];
  const storageListeners = [];
  const timers = [];
  const calls = {
    saves: [], fullSaves: [], initialize: 0,
    resetChain: 0, resetChainArgs: [], resetAll: 0, resetAllWithBalance: [], tabQueries: [], modelNativePrices: []
  };
  const Tango = {
    Chains,
    I18n: { resolveLanguage: (value) => value || 'en', t: (key) => key,
      resolveTheme: (setting) => setting === 'light' || setting === 'dark' ? setting : systemLight ? 'light' : 'dark' },
    Format: {
      native: (value, symbol) => `${value} ${symbol}`, usd: (value) => `$${value}`
    },
    Engine: {
      markPosition: () => ({ valueNative: 0 }),
      portfolioSummary: () => ({ cashBalanceNative: 10, equityNative: 10, totalPnlNative: 0, positionCount: 0 }),
      globalUsdSummary: () => ({ assetsUsd: 0, pnlUsd: 0, complete: true })
    },
    PopupModel: {
      build(state, settings, selectedChain, nativePrices) {
        calls.modelNativePrices.push({ ...nativePrices });
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
      },
      async resetAllWithBalance(balanceNative, language) {
        calls.resetAllWithBalance.push([balanceNative, language]);
        if (failAction === 'reset-all-with-balance' && calls.resetAllWithBalance.length === 1) {
          throw new Error('write failed');
        }
        persistedState = {
          ...persistedState,
          accounts: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
            ...persistedState.accounts[chain.id],
            initialBalanceNative: balanceNative,
            cashBalanceNative: balanceNative,
            realizedPnlNative: 0
          }]))
        };
        persistedSettings = {
          ...persistedSettings,
          language,
          chains: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
            ...persistedSettings.chains[chain.id], initialBalanceNative: balanceNative
          }]))
        };
        return { state: persistedState, settings: persistedSettings };
      }
    }
  };
  document = {
    documentElement: { lang: '', dataset: {} },
    querySelector: element
  };
  const context = {
    Promise, Object, Number, String, Array, Map, Set, Math, Date, JSON, console, Tango, document,
    setTimeout: (fn, delay) => { const timer = { fn, delay, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    matchMedia: () => ({ matches: systemLight, addEventListener() {} }),
    confirm: (message) => { confirmations.push(message); return confirmResult; },
    chrome: {
      runtime: {
        getURL(value) { return `chrome-extension://test/${value}`; },
        async sendMessage(message) {
          runtimeMessages.push(message);
          if (message?.type === 'TANGO_GET_NATIVE_PRICE' && nativeResponder) return nativeResponder(message);
          return message?.type === 'TANGO_OPEN_GMGN'
            ? { ok: true } : { ok: true, price: 100, observedAt: Date.now() };
        },
        openOptionsPage() {}
      },
      storage: { onChanged: { addListener(listener) { storageListeners.push(listener); }, removeListener() {} } },
      tabs: {
        create({ url }) { openedTabs.push(url); },
        async query(query) {
          calls.tabQueries.push(query);
          return activeTabUrl ? [{ url: activeTabUrl }] : [];
        }
      }
    }
  };
  const startup = vm.runInNewContext(popupSource, context, { filename: 'src/popup/popup.js' });
  let startupError = null;
  try { await startup; } catch (error) { startupError = error; }
  await new Promise((resolve) => setImmediate(resolve));
  return {
    app, calls, confirmations, element, openedTabs, runtimeMessages, storageListeners, startupError, timers, document, context,
    async applyExternalSettings(patch) {
      persistedSettings = mergeSettingsPatch(persistedSettings, patch);
      for (const listener of storageListeners) listener({}, 'local');
      await new Promise((resolve) => setImmediate(resolve));
    },
    get persistedSettings() { return persistedSettings; },
    get persistedState() { return persistedState; }
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

test('Popup Dashboard button uses the background route and surfaces opening failures', async () => {
  const popup = await loadPopup();
  await popup.element('#dashboard').click();
  assert.ok(popup.runtimeMessages.some((message) => message.type === 'TANGO_OPEN_DASHBOARD'));
  popup.context.chrome.runtime.sendMessage = async () => ({ ok: false, error: 'unavailable' });
  await popup.element('#dashboard').click();
  assert.match(popup.app.innerHTML, /openDashboardFailed/);
  popup.context.chrome.runtime.sendMessage = () => { throw new Error('context invalidated'); };
  await popup.element('#dashboard').click();
  assert.match(popup.app.innerHTML, /openDashboardFailed/);
});

test('Popup routes an uninitialized account to onboarding without writing fixed defaults', async () => {
  const popup = await loadPopup({ initialized: false });

  assert.match(popup.app.innerHTML, /id="open-onboarding"/);
  await popup.element('#open-onboarding').click();

  assert.equal(popup.calls.initialize, 0);
  assert.deepEqual(popup.openedTabs, ['chrome-extension://test/dashboard.html?onboarding=1']);
});

test('Popup common-capital reset contains a rejected atomic write and restores authoritative UI', async () => {
  const popup = await loadPopup({ failAction: 'reset-all-with-balance' });
  popup.element('#common-capital-balance').value = '12';
  const rejection = await popup.element('#save-common-capital').click().then(() => null, (error) => error);

  assert.equal(rejection, null);
  assert.deepEqual(popup.calls.resetAllWithBalance, [[12, 'en']]);
  assert.match(popup.app.innerHTML, /id="popup-chain"/);
  assert.match(popup.app.innerHTML, /settingsSaveFailed/);
});

test('Popup clears rejected-write feedback after a successful retry', async () => {
  const popup = await loadPopup({ failAction: 'reset-all-with-balance' });
  popup.element('#common-capital-balance').value = '12';
  await popup.element('#save-common-capital').click();
  assert.match(popup.app.innerHTML, /settingsSaveFailed/);

  popup.element('#common-capital-balance').value = '12';
  await popup.element('#save-common-capital').click();

  assert.equal(popup.calls.resetAllWithBalance.length, 2);
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
  assert.deepEqual(popup.calls.resetAllWithBalance, []);
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

test('Popup waits for pending settings before atomically changing common capital', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  selector.value = 'bsc';

  const changing = selector.emit('change');
  const reset = popup.element('#save-common-capital');
  popup.element('#common-capital-balance').value = '12';
  const resetting = reset.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(popup.calls.resetAllWithBalance.length, 0);
  popup.calls.saves[0].gate.resolve();
  await Promise.all([changing, resetting]);
  assert.deepEqual(popup.calls.resetAllWithBalance, [[12, 'en']]);
  assert.equal(popup.persistedSettings.selectedChain, 'bsc');
});

test('Popup waits for a pending selection before opening the shared GMGN entry', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  const gmgn = popup.element('#gmgn');
  selector.value = 'bsc';

  const changing = selector.emit('change');
  const opening = gmgn.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(popup.openedTabs, []);
  assert.equal(popup.runtimeMessages.some((message) => message.type === 'TANGO_OPEN_GMGN'), false);
  popup.calls.saves[0].gate.resolve();
  await Promise.all([changing, opening]);
  assert.deepEqual(popup.openedTabs, []);
  assert.equal(popup.runtimeMessages.at(-1).type, 'TANGO_OPEN_GMGN');
});

test('Popup cancels a queued GMGN navigation when another chain is selected while waiting', async () => {
  const popup = await loadPopup();
  popup.element('#popup-chain').value = 'bsc';
  const firstChange = popup.element('#popup-chain').emit('change');
  const opening = popup.element('#gmgn').click();
  await new Promise(resolve => setImmediate(resolve));
  popup.element('#popup-chain').value = 'base';
  const secondChange = popup.element('#popup-chain').emit('change');
  popup.calls.saves[0].gate.resolve();
  await Promise.all([firstChange, opening]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(popup.runtimeMessages.filter(message => message.type === 'TANGO_OPEN_GMGN').length, 0);
  popup.calls.saves[1].gate.resolve();
  await secondChange;
  await popup.element('#gmgn').click();
  assert.equal(popup.runtimeMessages.filter(message => message.type === 'TANGO_OPEN_GMGN').length, 1);
  assert.equal(popup.persistedSettings.selectedChain, 'base');
});

test('Popup master switch follows an external shortcut storage change while open', async () => {
  const popup = await loadPopup();
  assert.equal(popup.storageListeners.length, 1);
  assert.equal(popup.element('#master-enabled').checked, true);
  await popup.applyExternalSettings({ enabled: false });
  assert.equal(popup.element('#master-enabled').checked, false);
  assert.match(popup.app.innerHTML, />OFF</);
});

test('Popup uses the active GMGN tab chain until an explicit selector choice persists', async () => {
  const popup = await loadPopup({ activeTabUrl: 'https://gmgn.ai/?chain=robinhood' });

  assert.equal(popup.persistedSettings.selectedChain, 'eth');
  assert.equal(popup.element('#popup-chain').value, 'robinhood');
  assert.deepEqual(popup.calls.saves, []);
  assert.deepEqual(JSON.parse(JSON.stringify(popup.calls.tabQueries)), [{ active: true, currentWindow: true }]);
  await popup.element('#gmgn').click();
  assert.equal(popup.runtimeMessages.filter(message => message.type === 'TANGO_OPEN_GMGN').length, 1);
  assert.equal(popup.persistedSettings.selectedChain, 'eth');

  await popup.applyExternalSettings({ enabled: false });
  assert.equal(popup.element('#popup-chain').value, 'robinhood');

  const selector = popup.element('#popup-chain');
  selector.value = 'bsc';
  const changing = selector.emit('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(popup.calls.saves.map(({ patch }) => patch)), JSON.stringify([{ selectedChain: 'bsc' }]));
  popup.calls.saves[0].gate.resolve();
  await changing;

  assert.equal(popup.persistedSettings.selectedChain, 'bsc');
  assert.equal(popup.element('#popup-chain').value, 'bsc');
});

test('Popup native refresh has independent timeout, periodic retry, and does not block initial controls', async () => {
  let hung = true;
  const popup = await loadPopup({ nativeResponder: message => message.chain === 'sol' && hung
    ? new Promise(() => {}) : { ok: true, price: 100, observedAt: Date.now() } });
  assert.ok(popup.element('#master-enabled'));
  assert.ok(popup.element('#refresh-native-prices'));
  assert.equal(popup.calls.modelNativePrices.at(-1).eth, 100);
  assert.equal(popup.calls.modelNativePrices.at(-1).sol, 0);
  const timeout = popup.timers.find(timer => timer.delay === 8000 && !timer.cancelled); timeout.fn();
  await new Promise(resolve => setImmediate(resolve));
  hung = false;
  const before = popup.runtimeMessages.length;
  const poll = popup.timers.find(timer => timer.delay === 30000 && !timer.cancelled); poll.fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(popup.runtimeMessages.length > before);
  assert.equal(popup.calls.modelNativePrices.at(-1).sol, 100);
});

test('Popup auto theme follows system light mode and expired prices never reach its model', async () => {
  const popup = await loadPopup({ theme: 'auto', systemLight: true, nativeResponder: () => ({ ok: true, price: 999, observedAt: 1 }) });
  assert.equal(popup.document.documentElement.dataset.theme, 'light');
  assert.ok(Object.values(popup.calls.modelNativePrices.at(-1)).every(value => value === 0));
});

test('Popup invalid common principal shows a validation message and performs no mutation', async () => {
  const popup = await loadPopup();
  popup.element('#common-capital-balance').value = '';
  await popup.element('#save-common-capital').click();
  assert.deepEqual(popup.calls.resetAllWithBalance, []);
  assert.match(popup.app.innerHTML, /invalidCommonCapital/);
  assert.equal(popup.element('#common-capital-balance').value, '', 'invalid input must remain editable');
});

test('Popup rejected selection does not block a later common-capital reset', async () => {
  const popup = await loadPopup();
  const selector = popup.element('#popup-chain');
  selector.value = 'bsc';

  const changing = selector.emit('change');
  await new Promise((resolve) => setImmediate(resolve));
  popup.calls.saves[0].gate.reject(new Error('write failed'));
  await changing;

  assert.equal(popup.element('#popup-chain').value, 'eth');
  popup.element('#common-capital-balance').value = '12';
  await popup.element('#save-common-capital').click();
  assert.deepEqual(popup.calls.resetAllWithBalance, [[12, 'en']]);
});

test('Popup changes equal common capital through one confirmed all-chain reset', async () => {
  const popup = await loadPopup();
  assert.equal(popup.element('#common-capital-balance').value, '10');
  popup.element('#common-capital-balance').value = '12.5';
  await popup.element('#save-common-capital').click();

  assert.deepEqual(popup.confirmations, ['commonCapitalResetConfirm']);
  assert.deepEqual(popup.calls.resetAllWithBalance, [[12.5, 'en']]);
  assert.equal(popup.calls.resetChain, 0);
  for (const chain of Chains.all()) {
    assert.equal(popup.persistedState.accounts[chain.id].initialBalanceNative, 12.5);
    assert.equal(popup.persistedSettings.chains[chain.id].initialBalanceNative, 12.5);
  }
});

test('Popup repairs divergent legacy principals even when the displayed amount is unchanged', async () => {
  const popup = await loadPopup({
    settingBalances: { bsc: 25 },
    accountBalances: { xlayer: 30 }
  });
  assert.equal(popup.element('#common-capital-balance').value, '10');

  await popup.element('#save-common-capital').click();

  assert.deepEqual(popup.confirmations, ['commonCapitalResetConfirm']);
  assert.deepEqual(popup.calls.resetAllWithBalance, [[10, 'en']]);
  for (const chain of Chains.all()) {
    assert.equal(popup.persistedState.accounts[chain.id].initialBalanceNative, 10);
    assert.equal(popup.persistedSettings.chains[chain.id].initialBalanceNative, 10);
  }
});

test('Popup cancellation leaves divergent legacy principals untouched and performs no write', async () => {
  const popup = await loadPopup({ settingBalances: { bsc: 25 }, confirmResult: false });

  await popup.element('#save-common-capital').click();

  assert.deepEqual(popup.confirmations, ['commonCapitalResetConfirm']);
  assert.deepEqual(popup.calls.resetAllWithBalance, []);
  assert.equal(popup.persistedSettings.chains.bsc.initialBalanceNative, 25);
});
