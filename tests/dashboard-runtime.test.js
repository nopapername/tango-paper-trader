const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

global.Tango = {};
const Chains = require('../src/core/chains.js');
const dashboardSource = fs.readFileSync(path.resolve(__dirname, '../src/dashboard/dashboard.js'), 'utf8');

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
    positions: {},
    trades: [
      { id: 'eth', chain: 'eth', executedAt: Date.UTC(2026, 6, 18), nativeSymbol: 'ETH', symbol: 'ETHY', side: 'SELL', realizedPnlNative: 1 },
      { id: 'bsc', chain: 'bsc', executedAt: Date.UTC(2026, 6, 18), nativeSymbol: 'BNB', symbol: 'BSCY', side: 'SELL', realizedPnlNative: 2 }
    ],
    dailyRealizedByChain: Object.fromEntries(Chains.all().map((chain) => [chain.id, {}]))
  };
}

function settingsFixture() {
  return {
    selectedChain: 'eth', language: 'en', theme: 'dark', displayCurrency: 'NATIVE',
    onboardingInitialized: false,
    sellPresets: [25, 50, 100], slippageBps: 50, platformFeeBps: 100,
    pnlBarPosition: 'bottom', fastMode: false, confirmationEnabled: true,
    soundEnabled: true, showListQuickBuy: true,
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

async function loadDashboard({
  deferThirdGetAll = false, failFirstGetAll = false, failAction = '',
  dashboardLocation = { hash: '', search: '' }, initialized = true,
  closeSucceeds = true, corruptResetReadback = false,
  emitStorageDuringReset = false, failOpenGmgn = false, openGmgnFailures = 0,
  deferResetAllWithBalance = false, deferOpenGmgn = false,
  initialState = null, initialSettings = null, importFailure = null
} = {}) {
  const appElements = new Map();
  let document;
  let appMarkup = '';
  const decode = (value) => String(value || '').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
  const createElement = (selector, attributes = '') => {
    const listeners = new Map();
    const value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || '';
    return {
      selector, value: decode(value), checked: /\bchecked\b/.test(attributes), files: [], innerHTML: '',
      addEventListener(type, listener) { listeners.set(type, listener); },
      emit(type) { return listeners.get(type)?.({ target: this }); },
      focus() { document.activeElement = this; },
      type(text) {
        for (const character of String(text)) {
          if (document.activeElement !== this) break;
          this.value += character;
          listeners.get('input')?.({ target: this });
        }
      },
      click() { return listeners.get('click')?.({ target: this }); },
      querySelectorAll() { return []; }
    };
  };
  const element = (selector) => {
    if (appElements.has(selector)) return appElements.get(selector);
    if (!selector.startsWith('#')) return null;
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = appMarkup.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`, 'i'));
    if (!match) return null;
    const node = createElement(selector, match[0]);
    if (selector === '#history-results') node.innerHTML = appMarkup;
    appElements.set(selector, node);
    return node;
  };
  const app = {
    get innerHTML() { return appMarkup; },
    set innerHTML(value) {
      if (document?.activeElement && appElements.has(document.activeElement.selector)) document.activeElement = null;
      appMarkup = String(value);
      appElements.clear();
    },
    querySelector: element,
    querySelectorAll() { return []; }
  };
  const fileInput = createElement('#import-file');
  let persistedState = initialState ? structuredClone(initialState) : stateFixture();
  if (!initialState) persistedState.initialized = initialized;
  let persistedSettings = initialSettings ? structuredClone(initialSettings) : settingsFixture();
  const refreshedSettings = deferred();
  const resetAllWithBalanceGate = deferred();
  const openGmgnGate = deferred();
  let getAllCalls = 0;
  let openGmgnAttempts = 0;
  let storageSubscriber = null;
  const calls = { getAll: 0, saves: [], fullSaves: [], resetChain: [], resetAll: 0, resetAllWithBalance: [], exportData: 0, downloads: [], nativeMessages: [], confirms: [], tabs: [], close: 0, sequence: [] };
  const anchors = [];
  const urls = new Map();
  let urlId = 0;
  const source = dashboardSource.replace(
    /  Tango\.Store\.subscribe\(load\);load\(\);\r?\n\}\)\(globalThis\);\s*$/,
    '  Tango.Store.subscribe(load);\n  global.__dashboardTest = { runtime, load, render, saveSelectedChain, refreshNativePrices, action, tradesCsv };\n})(globalThis);'
  );
  assert.notEqual(source, dashboardSource, 'dashboard test harness must replace startup');
  const Tango = {
    VERSION: 'test', Chains,
    I18n: {
      resolveLanguage: (value) => value || 'en',
      t: (key, _language, vars) => key === 'onboardingCapitalAllocation'
        ? `${key}:${vars?.amount}`
        : key === 'importTooLarge'
          ? `${key}:${vars?.measured}/${vars?.budget}`
          : key
    },
    Format: { native: (value, symbol) => `${value} ${symbol}`, usd: (value) => `$${value}`, percent: String, number: String, duration: String },
    Engine: {
      markPosition: () => ({ valueNative: 0, unrealizedPnlNative: 0, roi: 0 }),
      portfolioSummary: () => ({ cashBalanceNative: 10, equityNative: 10, realizedPnlNative: 0, unrealizedPnlNative: 0, totalPnlNative: 0, positionCount: 0, totalTrades: 0, winRate: 0, profitFactor: 0 }),
      globalUsdSummary: () => ({ assetsUsd: 0, pnlUsd: 0, complete: true })
    },
    DashboardModel: {
      build(state, settings, selectedChain, nativePrices, filters) {
        const chain = Chains.get(selectedChain) || Chains.get('sol');
        return {
          chain,
          positions: Object.values(state.positions).filter((position) => position.chain === chain.id),
          trades: state.trades.filter((trade) => trade.chain === chain.id).filter((trade) => {
            const search = String(filters?.search || '').toLowerCase();
            const matchesSearch = !search || `${trade.symbol} ${trade.tokenAddress || ''}`.toLowerCase().includes(search);
            const matchesSide = !filters?.side || filters.side === 'ALL' || trade.side === filters.side;
            const matchesResult = !filters?.result || filters.result === 'ALL'
              || (filters.result === 'WIN' && Number(trade.realizedPnlNative) > 0)
              || (filters.result === 'LOSS' && Number(trade.realizedPnlNative) < 0);
            return matchesSearch && matchesSide && matchesResult;
          }),
          summary: Tango.Engine.portfolioSummary(), globalUsd: Tango.Engine.globalUsdSummary(),
          chainSettings: settings.chains[chain.id],
          accounts: Chains.all().map((entry) => ({
            chain: entry,
            summary: Tango.Engine.portfolioSummary(),
            nativePriceUsd: Number(nativePrices[entry.id] || 0),
            usdSummary: { assetsUsd: entry.id === 'eth' ? 1_900 : 1_000, pnlUsd: entry.id === 'eth' ? -100 : 0 }
          }))
        };
      },
      hasDerivedMarketCapPrice(trade) {
        return String(trade?.priceProvenance || '').startsWith('MARKET_CAP')
          || trade?.priceProvenance === 'MIXED_DERIVED'
          || trade?.valuationMode === 'MARKET_CAP';
      },
      tradesCsvRows(state, chain) { return state.trades.filter((trade) => trade.chain === chain); },
      calendar() { return { days: {}, trades: [], totalNative: 0, winRate: 0, bestNative: 0, worstNative: 0 }; }
    },
    Store: {
      getAll() {
        getAllCalls += 1;
        calls.getAll += 1;
        calls.sequence.push('read');
        if (failFirstGetAll && getAllCalls === 1) return Promise.reject(new Error('storage unavailable'));
        if (deferThirdGetAll && getAllCalls === 3) return refreshedSettings.promise.then(() => ({ state: persistedState, settings: persistedSettings }));
        if (corruptResetReadback && calls.resetAllWithBalance.length) {
          const corrupt = structuredClone(persistedState);
          corrupt.accounts.eth.cashBalanceNative += 1;
          return Promise.resolve({ state: corrupt, settings: persistedSettings });
        }
        return Promise.resolve({ state: persistedState, settings: persistedSettings });
      },
      patchSettings(patch) {
        if (Object.hasOwn(patch, 'onboardingInitialized')) {
          calls.saves.push({ patch, gate: null });
          persistedSettings = mergeSettingsPatch(persistedSettings, patch);
          return Promise.resolve(persistedSettings);
        }
        const gate = deferred();
        calls.saves.push({ patch, gate });
        return gate.promise.then(() => {
          persistedSettings = mergeSettingsPatch(persistedSettings, patch);
          return persistedSettings;
        });
      },
      saveSettings(next) { calls.fullSaves.push(next); throw new Error('Dashboard must use patchSettings'); },
      async resetChain(chain, balance) {
        calls.resetChain.push([chain, balance]);
        if (failAction === 'reset-chain') throw new Error('write failed');
        return persistedState;
      },
      async resetAll() {
        calls.resetAll += 1;
        if (failAction === 'reset-all') throw new Error('write failed');
        return persistedState;
      },
      async resetAllWithBalance(balanceNative, language, settingsPatch) {
        calls.sequence.push('reset');
        calls.resetAllWithBalance.push([balanceNative, language, settingsPatch]);
        if (failAction === 'reset-all-with-balance') throw new Error('write failed');
        if (deferResetAllWithBalance) await resetAllWithBalanceGate.promise;
        persistedState = stateFixture();
        persistedState.initialized = true;
        persistedState.positions = {};
        persistedState.trades = [];
        for (const chain of Chains.all()) {
          persistedState.accounts[chain.id] = {
            initialBalanceNative: balanceNative, cashBalanceNative: balanceNative, realizedPnlNative: 0
          };
        }
        const patchedSettings = mergeSettingsPatch(persistedSettings, settingsPatch || {});
        persistedSettings = {
          ...patchedSettings,
          ...(language === undefined ? {} : { language }),
          chains: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
            ...patchedSettings.chains[chain.id], initialBalanceNative: balanceNative
          }]))
        };
        if (emitStorageDuringReset && storageSubscriber) await storageSubscriber();
        return { state: persistedState, settings: persistedSettings };
      },
      async exportData() { calls.exportData += 1; return { product: 'Tango Paper Trader', state: persistedState, settings: persistedSettings }; },
      async importData() {
        if (importFailure) throw importFailure;
        return { state: persistedState, settings: persistedSettings };
      },
      subscribe(callback) { storageSubscriber = callback; }
    }
  };
  let confirmImpl = () => true;
  document = {
    activeElement: null,
    documentElement: { lang: '', dataset: {} },
    querySelector(selector) { return selector === '#app' ? app : selector === '#import-file' ? fileInput : element(selector); },
    createElement(tag) {
      if (tag !== 'a') return createElement(tag);
      const anchor = { href: '', download: '', click() { anchors.push(this); } };
      return anchor;
    }
  };
  const context = {
    Promise, Object, Number, String, Array, Map, Set, Math, Date, JSON, Intl, URLSearchParams, console, Tango, Blob,
    document,
    location: dashboardLocation,
    URL: {
      createObjectURL(blob) { const key = `blob:${++urlId}`; urls.set(key, blob); return key; },
      revokeObjectURL() {}
    },
    setTimeout: (fn, delay) => { if (Number(delay) < 1_000) fn(); return 0; },
    closed: false,
    close() { calls.close += 1; calls.sequence.push('close'); if (closeSucceeds) context.closed = true; },
    confirm(message) { calls.confirms.push(message); return confirmImpl(message); },
    navigator: {}, ClipboardItem: class {},
    chrome: {
      runtime: {
        async sendMessage(message) {
          calls.nativeMessages.push(message);
          if (message.type === 'TANGO_OPEN_GMGN') {
            calls.sequence.push('open');
            openGmgnAttempts += 1;
            if (deferOpenGmgn) await openGmgnGate.promise;
            return { ok: !failOpenGmgn && openGmgnAttempts > openGmgnFailures };
          }
          return { ok: true, price: message.chain === 'eth' ? 2_000 : 100, observedAt: message.chain === 'eth' ? 111 : 222 };
        }
      },
      tabs: { create(details) { calls.tabs.push(details); } }
    }
  };
  vm.runInNewContext(source, context, { filename: 'src/dashboard/dashboard.js' });
  assert.ok(context.__dashboardTest, 'dashboard runtime test API must be exposed');
  let initialLoadError = null;
  try { await context.__dashboardTest.load(); } catch (error) { initialLoadError = error; }
  return {
    api: context.__dashboardTest, calls, app, element, anchors, urls, refreshedSettings,
    resetAllWithBalanceGate, openGmgnGate, document, context, initialLoadError, fileInput,
    async emitStorage() { return storageSubscriber?.(); },
    setConfirm(callback) { confirmImpl = callback; },
    get persistedState() { return persistedState; },
    set persistedState(value) { persistedState = value; },
    get persistedSettings() { return persistedSettings; },
    set persistedSettings(value) { persistedSettings = value; }
  };
}

function fillSettingsForm(dashboard) {
  const fields = {
    '#setting-language': 'en', '#setting-currency': 'NATIVE', '#setting-theme': 'dark',
    '#setting-buy-presets': '2, 4', '#setting-network-fee': '0.005',
    '#setting-sell-presets': '50, 100', '#setting-slippage': '75', '#setting-platform-fee': '125',
    '#setting-bar-position': 'top'
  };
  Object.entries(fields).forEach(([selector, value]) => { dashboard.element(selector).value = value; });
  ['#setting-fast', '#setting-confirm', '#setting-sound', '#setting-list-buy'].forEach((selector) => {
    dashboard.element(selector).checked = true;
  });
}

test('rapid Dashboard chain selections persist only the latest chain without clobbering global settings', async () => {
  const dashboard = await loadDashboard();
  const first = dashboard.api.saveSelectedChain('eth');
  await new Promise((resolve) => setImmediate(resolve));
  const second = dashboard.api.saveSelectedChain('bsc');
  assert.equal(dashboard.calls.saves.length, 1);
  dashboard.persistedSettings = { ...dashboard.persistedSettings, displayCurrency: 'USD' };
  dashboard.calls.saves[0].gate.resolve();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 2);
  assert.equal(JSON.stringify(dashboard.calls.saves[1].patch), JSON.stringify({ selectedChain: 'bsc' }));
  dashboard.calls.saves[1].gate.resolve();
  await second;
  assert.equal(dashboard.api.runtime.selectedChain, 'bsc');
  assert.equal(dashboard.persistedSettings.displayCurrency, 'USD');
  assert.deepEqual(dashboard.calls.fullSaves, []);
});

test('Dashboard history deep link starts on the explicit current chain without a date filter', async () => {
  const dashboard = await loadDashboard({
    dashboardLocation: { hash: '#history', search: '?chain=bsc' }
  });
  assert.equal(dashboard.api.runtime.tab, 'history');
  assert.equal(dashboard.api.runtime.selectedChain, 'bsc');
  assert.equal(dashboard.api.runtime.filters.date, '');
  assert.match(dashboard.app.innerHTML, /BSCY/);
  assert.doesNotMatch(dashboard.app.innerHTML, /ETHY/);
});

test('Dashboard deep-link chain is startup-only and does not override a later user selection', async () => {
  const dashboard = await loadDashboard({
    dashboardLocation: { hash: '#history', search: '?chain=bsc' }
  });
  const selection = dashboard.api.saveSelectedChain('eth');
  await new Promise((resolve) => setImmediate(resolve));
  dashboard.calls.saves[0].gate.resolve();
  await selection;
  await dashboard.api.load();
  assert.equal(dashboard.api.runtime.selectedChain, 'eth');
});

test('Dashboard startup storage failure renders a retry that recovers', async () => {
  const dashboard = await loadDashboard({ failFirstGetAll: true });
  assert.equal(dashboard.initialLoadError, null);
  assert.match(dashboard.app.innerHTML, /storageLoadFailed/);
  const retry = dashboard.element('#retry-storage-load');
  assert.ok(retry);
  await retry.click();
  assert.match(dashboard.app.innerHTML, /Selected chain/);
});

test('Dashboard chain-account USD display uses the canonical USD summary instead of reconverting native equity', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.nativePrices.eth = 200;
  dashboard.api.render();

  assert.match(dashboard.app.innerHTML, /\$1900/);
  assert.doesNotMatch(dashboard.app.innerHTML, /\$2000/);
});

test('Dashboard reset actions contain rejected writes, reload authoritative data, and remain usable', async () => {
  for (const action of ['reset-chain', 'reset-all']) {
    const dashboard = await loadDashboard({ failAction: action });
    const loadsBefore = dashboard.calls.getAll;
    const rejection = await dashboard.api.action(action).then(() => null, (error) => error);

    assert.equal(rejection, null, action);
    assert.equal(dashboard.calls.getAll, loadsBefore + 1, `${action} reloads authoritative data`);
    assert.match(dashboard.app.innerHTML, /settingsSaveFailed/);
    await dashboard.api.action('export-csv');
    assert.equal(dashboard.anchors.length, 1, `${action} leaves actions usable`);
  }
});

test('Dashboard rolls back an optimistic chain selection when settings persistence fails', async () => {
  const dashboard = await loadDashboard();
  const selection = dashboard.api.saveSelectedChain('bsc');
  assert.equal(dashboard.api.runtime.selectedChain, 'bsc');
  await new Promise((resolve) => setImmediate(resolve));
  dashboard.calls.saves[0].gate.reject(new Error('write failed'));
  const rejection = await selection.then(() => null, (error) => error);
  assert.equal(rejection, null);
  assert.equal(dashboard.api.runtime.selectedChain, 'eth');
  assert.equal(dashboard.api.runtime.settings.selectedChain, 'eth');
  assert.match(dashboard.app.innerHTML, /settingsSaveFailed/);
  assert.match(dashboard.app.innerHTML, /<option value="eth" selected>/);
});

test('Dashboard rolls back a failed latest selection to a stale-successful queued selection', async () => {
  const dashboard = await loadDashboard();
  const bscSelection = dashboard.api.saveSelectedChain('bsc');
  await new Promise((resolve) => setImmediate(resolve));
  const solSelection = dashboard.api.saveSelectedChain('sol');
  assert.equal(dashboard.calls.saves.length, 1);

  dashboard.calls.saves[0].gate.resolve();
  await bscSelection;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 2);
  dashboard.calls.saves[1].gate.reject(new Error('write failed'));
  await solSelection;

  assert.equal(dashboard.persistedSettings.selectedChain, 'bsc');
  assert.equal(dashboard.api.runtime.settings.selectedChain, 'bsc');
  assert.equal(dashboard.api.runtime.selectedChain, 'bsc');
  assert.match(dashboard.app.innerHTML, /settingsSaveFailed/);
  assert.match(dashboard.app.innerHTML, /<option value="bsc" selected>/);
});

test('Dashboard settings-save failure restores persisted values and shows an error', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.tab = 'settings';
  dashboard.api.render();
  fillSettingsForm(dashboard);
  const saving = dashboard.api.action('save-settings');
  await new Promise((resolve) => setImmediate(resolve));
  dashboard.calls.saves[0].gate.reject(new Error('write failed'));
  const rejection = await saving.then(() => null, (error) => error);
  assert.equal(rejection, null);
  assert.equal(dashboard.api.runtime.settings.theme, 'dark');
  assert.equal(dashboard.api.runtime.settings.slippageBps, 50);
  assert.match(dashboard.app.innerHTML, /settingsSaveFailed/);
  assert.equal(dashboard.element('#setting-slippage').value, '50');
});

test('selected-chain reset waits for the visible BSC selection to persist and never targets the old chain', async () => {
  const dashboard = await loadDashboard();
  const selection = dashboard.api.saveSelectedChain('bsc');
  assert.equal(dashboard.api.runtime.selectedChain, 'bsc');
  assert.match(dashboard.app.innerHTML, /<option value="bsc" selected>/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 1);
  const reset = dashboard.api.action('reset-chain');
  assert.deepEqual(dashboard.calls.resetChain, []);
  dashboard.calls.saves[0].gate.resolve();
  await selection;
  await reset;
  assert.deepEqual(dashboard.calls.resetChain, [['bsc', 10]]);
  assert.match(dashboard.calls.confirms[0], /BNB Chain/);
  assert.match(dashboard.calls.confirms[0], /other chains.*preserv/i);
});

test('CSV export waits for selected-chain persistence and contains BSC rather than the old chain', async () => {
  const dashboard = await loadDashboard();
  const selection = dashboard.api.saveSelectedChain('bsc');
  await new Promise((resolve) => setImmediate(resolve));
  const exporting = dashboard.api.action('export-csv');
  assert.equal(dashboard.anchors.length, 0);
  dashboard.calls.saves[0].gate.resolve();
  await selection;
  await exporting;
  const csvAnchor = dashboard.anchors.at(-1);
  const csv = await dashboard.urls.get(csvAnchor.href).text();
  assert.match(csv, /bsc/);
  assert.doesNotMatch(csv, /eth/);
});

test('selection and immediate scoped settings save serialize and preserve BSC plus global and per-chain edits', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.tab = 'settings';
  dashboard.api.render();
  const selection = dashboard.api.saveSelectedChain('bsc');
  assert.match(dashboard.app.innerHTML, /Buy presets.*BNB/);
  fillSettingsForm(dashboard);
  const settingsSave = dashboard.api.action('save-settings');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 1, 'settings save must queue behind selected-chain persistence');
  dashboard.calls.saves[0].gate.resolve();
  await selection;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 2);
  const patch = dashboard.calls.saves[1].patch;
  assert.equal(Object.hasOwn(patch, 'selectedChain'), false);
  assert.deepEqual(Array.from(patch.chains.bsc.buyPresets), [2, 4]);
  assert.equal(patch.chains.bsc.networkFeeNative, 0.005);
  assert.equal(Object.hasOwn(patch.chains, 'eth'), false);
  assert.deepEqual(Array.from(patch.sellPresets), [50, 100]);
  dashboard.calls.saves[1].gate.resolve();
  await settingsSave;
  assert.equal(dashboard.persistedSettings.selectedChain, 'bsc');
});

test('multi-character history search retains focus and updates filtered results incrementally', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.tab = 'history';
  dashboard.api.render();
  const search = dashboard.element('#trade-search');
  search.focus();
  search.type('ethy');
  assert.equal(dashboard.document.activeElement, search);
  assert.equal(search.value, 'ethy');
  assert.equal(dashboard.api.runtime.filters.search, 'ethy');
  assert.match(dashboard.element('#history-results').innerHTML, /ETHY/);
  search.type('x');
  assert.equal(dashboard.document.activeElement, search);
  assert.equal(search.value, 'ethyx');
  assert.doesNotMatch(dashboard.element('#history-results').innerHTML, /ETHY/);
  assert.match(dashboard.element('#history-results').innerHTML, /noTrades/);
});

test('history labels market-cap-derived fills without rendering the synthetic token price', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.state.trades[0] = {
    ...dashboard.api.runtime.state.trades[0], amountNative: 1, executionPriceUsd: 0.000004,
    marketCapUsd: 4_000, valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  dashboard.api.runtime.tab = 'history';
  dashboard.api.render();
  assert.match(dashboard.app.innerHTML, /marketCap[^<]*.*\$4000/s);
  assert.doesNotMatch(dashboard.app.innerHTML, /\$0\.000004/);
});

test('selected reset revalidates its chain after confirmation and reset prompts state exact destructive scope', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.selectedChain = 'bsc';
  dashboard.api.runtime.settings.selectedChain = 'bsc';
  let changedSelection;
  dashboard.setConfirm(() => {
    changedSelection = dashboard.api.saveSelectedChain('eth');
    return true;
  });
  await dashboard.api.action('reset-chain');
  assert.deepEqual(dashboard.calls.resetChain, []);
  assert.match(dashboard.calls.confirms[0], /BNB Chain/);
  assert.match(dashboard.calls.confirms[0], /only/i);
  assert.match(dashboard.calls.confirms[0], /other chains.*preserv/i);
  await new Promise((resolve) => setImmediate(resolve));
  dashboard.calls.saves.at(-1).gate.resolve();
  await changedSelection;

  dashboard.setConfirm(() => true);
  await dashboard.api.action('reset-all');
  assert.match(dashboard.calls.confirms.at(-1), /all chains/i);
  assert.match(dashboard.calls.confirms.at(-1), /permanent/i);
  assert.equal(dashboard.calls.resetAll, 1);
});

test('selected-chain and all-chain reset actions stay separate', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.selectedChain = 'bsc';
  dashboard.api.runtime.settings.selectedChain = 'bsc';
  await dashboard.api.action('reset-chain');
  assert.deepEqual(dashboard.calls.resetChain, [['bsc', 10]]);
  assert.equal(dashboard.calls.resetAll, 0);
  await dashboard.api.action('reset-all');
  assert.equal(dashboard.calls.resetAll, 1);
});

test('saving Dashboard settings changes chain controls only for the selected chain', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.selectedChain = 'bsc';
  dashboard.api.runtime.settings.selectedChain = 'bsc';
  dashboard.api.runtime.tab = 'settings';
  dashboard.api.render();
  fillSettingsForm(dashboard);
  const save = dashboard.api.action('save-settings');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 1);
  const patch = dashboard.calls.saves[0].patch;
  assert.equal(Object.hasOwn(patch.chains, 'eth'), false);
  assert.deepEqual(Array.from(patch.chains.bsc.buyPresets), [2, 4]);
  assert.equal(patch.chains.bsc.networkFeeNative, 0.005);
  assert.equal(Object.hasOwn(patch.chains.bsc, 'initialBalanceNative'), false);
  assert.deepEqual(Array.from(patch.sellPresets), [50, 100]);
  dashboard.calls.saves[0].gate.resolve();
  await save;
});

test('Dashboard onboarding defaults to 10 and commits one verified six-chain reset before closing', async () => {
  const dashboard = await loadDashboard({
    initialized: false,
    dashboardLocation: { hash: '', search: '?onboarding=1' }
  });

  assert.match(dashboard.app.innerHTML, /onboardingCommonCapital/);
  assert.match(dashboard.app.innerHTML, /paperOnly/);
  assert.match(dashboard.app.innerHTML, /independentChains/);
  assert.equal(dashboard.element('#onboarding-balance').value, '10');
  assert.equal(dashboard.element('#onboarding-language').value, 'en');
  assert.match(dashboard.app.innerHTML, /onboardingCapitalAllocation:10/);
  dashboard.element('#onboarding-balance').value = '12.5';
  dashboard.element('#onboarding-balance').emit('input');
  assert.equal(dashboard.element('#onboarding-capital-note').textContent, 'onboardingCapitalAllocation:12.5');
  dashboard.element('#onboarding-language').value = 'zh-CN';
  await dashboard.element('#complete-onboarding').click();

  assert.deepEqual(dashboard.calls.resetAllWithBalance, [[12.5, 'zh-CN', undefined]]);
  assert.deepEqual(dashboard.calls.sequence.slice(-4), ['reset', 'read', 'open', 'close']);
  assert.equal(dashboard.calls.nativeMessages.at(-1).type, 'TANGO_OPEN_GMGN');
  assert.equal(dashboard.context.closed, true);
  assert.equal(
    JSON.stringify(dashboard.calls.saves.map((entry) => entry.patch)),
    JSON.stringify([{ onboardingInitialized: true }])
  );
});

test('Dashboard onboarding invalid or interrupted forms persist nothing', async () => {
  const interrupted = await loadDashboard({ initialized: false });
  const balance = interrupted.element('#onboarding-balance');
  const language = interrupted.element('#onboarding-language');
  assert.ok(balance, 'onboarding balance control is rendered');
  assert.ok(language, 'onboarding language control is rendered');
  balance.value = '99';
  language.value = 'zh-CN';
  assert.deepEqual(interrupted.calls.resetAllWithBalance, []);
  assert.deepEqual(interrupted.calls.saves, []);

  interrupted.element('#onboarding-balance').value = '0';
  await interrupted.element('#complete-onboarding').click();
  assert.deepEqual(interrupted.calls.resetAllWithBalance, []);
  assert.match(interrupted.app.innerHTML, /invalidCommonCapital/);
});

test('Dashboard onboarding stays open when persisted read-back is not the requested six-chain balance', async () => {
  const dashboard = await loadDashboard({ initialized: false, corruptResetReadback: true });
  const complete = dashboard.element('#complete-onboarding');
  assert.ok(complete, 'onboarding completion control is rendered');
  await complete.click();

  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.equal(dashboard.calls.close, 0);
  assert.equal(dashboard.calls.nativeMessages.some((message) => message.type === 'TANGO_OPEN_GMGN'), false);
  assert.match(dashboard.app.innerHTML, /onboardingVerificationFailed/);
});

test('Dashboard onboarding keeps custom values and reports a distinct GMGN open failure', async () => {
  const dashboard = await loadDashboard({
    initialized: false,
    dashboardLocation: { hash: '', search: '?onboarding=1' },
    emitStorageDuringReset: true,
    failOpenGmgn: true
  });

  dashboard.element('#onboarding-balance').value = '12.5';
  dashboard.element('#onboarding-language').value = 'zh-CN';
  await dashboard.element('#complete-onboarding').click();

  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.deepEqual(dashboard.calls.resetAllWithBalance[0], [12.5, 'zh-CN', undefined]);
  assert.equal(dashboard.calls.close, 0);
  assert.match(dashboard.app.innerHTML, /onboardingCommonCapital/);
  assert.match(dashboard.app.innerHTML, /openGmgnFailed/);
  assert.doesNotMatch(dashboard.app.innerHTML, /onboardingVerificationFailed/);
  assert.equal(dashboard.element('#onboarding-balance').value, '12.5');
  assert.equal(dashboard.element('#onboarding-language').value, 'zh-CN');
  assert.ok(dashboard.element('#complete-onboarding'));
});

test('Dashboard onboarding retry opens GMGN without resetting verified intervening paper state', async () => {
  const dashboard = await loadDashboard({
    initialized: false,
    dashboardLocation: { hash: '', search: '?onboarding=1' },
    openGmgnFailures: 1
  });

  dashboard.element('#onboarding-balance').value = '12.5';
  dashboard.element('#onboarding-language').value = 'zh-CN';
  await dashboard.element('#complete-onboarding').click();
  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.equal(
    dashboard.calls.nativeMessages.filter((message) => message.type === 'TANGO_OPEN_GMGN').length,
    1
  );

  dashboard.persistedState.positions['eth:intervening'] = {
    chain: 'eth', tokenAddress: 'intervening', quantity: 1
  };
  dashboard.persistedState.trades.unshift({
    id: 'intervening', chain: 'eth', side: 'BUY', quantity: 1
  });
  await dashboard.element('#complete-onboarding').click();

  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.equal(
    dashboard.calls.nativeMessages.filter((message) => message.type === 'TANGO_OPEN_GMGN').length,
    2
  );
  assert.equal(dashboard.persistedState.positions['eth:intervening'].quantity, 1);
  assert.equal(dashboard.persistedState.trades[0].id, 'intervening');
  assert.equal(dashboard.context.closed, true);
});

test('Dashboard onboarding overlapping double clicks reset once and open at most once', async () => {
  const dashboard = await loadDashboard({
    initialized: false,
    dashboardLocation: { hash: '', search: '?onboarding=1' },
    deferResetAllWithBalance: true
  });

  const first = dashboard.element('#complete-onboarding').click();
  const second = dashboard.element('#complete-onboarding').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);

  dashboard.resetAllWithBalanceGate.resolve();
  await Promise.all([first, second]);
  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.ok(
    dashboard.calls.nativeMessages.filter((message) => message.type === 'TANGO_OPEN_GMGN').length <= 1
  );
});

test('Dashboard onboarding open failure plus storage rerender retries open only', async () => {
  const dashboard = await loadDashboard({
    initialized: false,
    dashboardLocation: { hash: '', search: '?onboarding=1' },
    openGmgnFailures: 1
  });

  await dashboard.element('#complete-onboarding').click();
  assert.equal(dashboard.persistedSettings.onboardingInitialized, true);
  dashboard.persistedState.positions['eth:intervening'] = {
    chain: 'eth', tokenAddress: 'intervening', quantity: 1
  };
  dashboard.persistedState.trades.unshift({
    id: 'intervening', chain: 'eth', side: 'BUY', quantity: 1
  });
  await dashboard.emitStorage();
  await dashboard.element('#complete-onboarding').click();

  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.equal(
    dashboard.calls.nativeMessages.filter((message) => message.type === 'TANGO_OPEN_GMGN').length,
    2
  );
  assert.equal(dashboard.persistedState.positions['eth:intervening'].quantity, 1);
  assert.equal(dashboard.persistedState.trades[0].id, 'intervening');
});

test('Dashboard onboarding stale URL reload uses durable marker and skips reset', async () => {
  const first = await loadDashboard({
    initialized: false,
    dashboardLocation: { hash: '', search: '?onboarding=1' },
    failOpenGmgn: true
  });
  await first.element('#complete-onboarding').click();
  assert.equal(first.persistedSettings.onboardingInitialized, true);
  first.persistedState.positions['eth:intervening'] = {
    chain: 'eth', tokenAddress: 'intervening', quantity: 1
  };
  first.persistedState.trades.unshift({
    id: 'intervening', chain: 'eth', side: 'BUY', quantity: 1
  });

  const reloaded = await loadDashboard({
    dashboardLocation: { hash: '', search: '?onboarding=1' },
    initialState: first.persistedState,
    initialSettings: first.persistedSettings
  });
  await reloaded.element('#complete-onboarding').click();

  assert.equal(reloaded.calls.resetAllWithBalance.length, 0);
  assert.equal(
    reloaded.calls.nativeMessages.filter((message) => message.type === 'TANGO_OPEN_GMGN').length,
    1
  );
  assert.equal(reloaded.persistedState.positions['eth:intervening'].quantity, 1);
  assert.equal(reloaded.persistedState.trades[0].id, 'intervening');
});

test('Dashboard onboarding shows completion when the browser cannot close the tab', async () => {
  const dashboard = await loadDashboard({ initialized: false, closeSucceeds: false });
  const complete = dashboard.element('#complete-onboarding');
  assert.ok(complete, 'onboarding completion control is rendered');
  await complete.click();

  assert.equal(dashboard.calls.close, 1);
  assert.deepEqual(dashboard.calls.sequence.slice(-2), ['open', 'close']);
  assert.match(dashboard.app.innerHTML, /onboardingComplete/);
});

test('changing common capital requires confirmation and resets every chain through one mutation', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.tab = 'settings';
  dashboard.api.render();
  fillSettingsForm(dashboard);
  const commonCapital = dashboard.element('#setting-common-balance');
  assert.ok(commonCapital, 'common-capital control is rendered');
  commonCapital.value = '30';
  dashboard.setConfirm(() => false);

  await dashboard.api.action('save-settings');
  assert.deepEqual(dashboard.calls.resetAllWithBalance, []);
  assert.deepEqual(dashboard.calls.saves, []);

  dashboard.setConfirm(() => true);
  const saving = dashboard.api.action('save-settings');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.equal(dashboard.calls.resetAllWithBalance[0][0], 30);
  assert.equal(dashboard.calls.resetAllWithBalance[0][1], 'en');
  assert.equal(dashboard.calls.resetAllWithBalance[0][2].theme, 'dark');
  assert.match(dashboard.calls.confirms.at(-1), /commonCapitalResetConfirm/);
  await saving;
  assert.deepEqual(dashboard.calls.saves, []);
  for (const chain of Chains.all()) {
    assert.equal(dashboard.persistedSettings.chains[chain.id].initialBalanceNative, 30, chain.id);
  }
});

test('saving a displayed principal reconciles legacy unequal chain principals', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.settings.chains.bsc.initialBalanceNative = 25;
  dashboard.persistedSettings.chains.bsc.initialBalanceNative = 25;
  dashboard.api.runtime.tab = 'settings';
  dashboard.api.render();
  fillSettingsForm(dashboard);

  await dashboard.api.action('save-settings');

  assert.equal(dashboard.calls.resetAllWithBalance.length, 1);
  assert.equal(dashboard.calls.resetAllWithBalance[0][0], 10);
  assert.equal(dashboard.calls.saves.length, 0);
  for (const chain of Chains.all()) {
    assert.equal(dashboard.persistedSettings.chains[chain.id].initialBalanceNative, 10, chain.id);
  }
});

test('language-only Dashboard settings changes remain a normal scoped patch', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.tab = 'settings';
  dashboard.api.render();
  fillSettingsForm(dashboard);
  dashboard.element('#setting-language').value = 'zh-CN';

  const saving = dashboard.api.action('save-settings');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dashboard.calls.resetAllWithBalance, []);
  assert.equal(dashboard.calls.saves[0].patch.language, 'zh-CN');
  dashboard.calls.saves[0].gate.resolve();
  await saving;
});

test('CSV exports selected-chain rows while JSON export keeps the full state', async () => {
  const dashboard = await loadDashboard();
  dashboard.api.runtime.selectedChain = 'eth';
  await dashboard.api.action('export-csv');
  const csvAnchor = dashboard.anchors.at(-1);
  const csv = await dashboard.urls.get(csvAnchor.href).text();
  assert.match(csv, /eth/);
  assert.doesNotMatch(csv, /bsc/);
  await dashboard.api.action('export-json');
  const jsonAnchor = dashboard.anchors.at(-1);
  const backup = JSON.parse(await dashboard.urls.get(jsonAnchor.href).text());
  assert.equal(dashboard.calls.exportData, 1);
  assert.deepEqual(backup.state.trades.map((trade) => trade.chain), ['eth', 'bsc']);
});

test('CSV download neutralizes spreadsheet formulas without changing numbers, escaping, JSON, or state', async () => {
  const state = stateFixture();
  const dangerous = [
    '=HYPERLINK("https://evil.example","x")',
    '+SUM(1,1)',
    '-1+1',
    '@SUM(1,1)',
    ' \t\u0000=CMD()'
  ];
  state.trades = dangerous.map((symbol, index) => ({
    ...state.trades[0],
    id: `danger-${index}`,
    symbol,
    sourceUrl: index === 0
      ? '\r\n@SUM(2,2)'
      : `https://gmgn.ai/eth/token/safe-${index}?a=1,b=2`,
    realizedPnlNative: -42
  }));
  const before = structuredClone(state);
  const dashboard = await loadDashboard({ initialState: state });

  await dashboard.api.action('export-csv');

  const csvAnchor = dashboard.anchors.at(-1);
  const csvBlob = dashboard.urls.get(csvAnchor.href);
  const csv = await csvBlob.text();
  assert.equal(csvBlob.type, 'text/csv;charset=utf-8');
  assert.deepEqual([...new Uint8Array(await csvBlob.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(csv.startsWith('executedAt,'));
  for (const value of dangerous) {
    const escaped = `'${value}`.replaceAll('"', '""');
    assert.ok(csv.includes(`"${escaped}"`), value);
  }
  assert.ok(csv.includes(`"'\r\n@SUM(2,2)"`));
  assert.ok(csv.includes('"https://gmgn.ai/eth/token/safe-1?a=1,b=2"'));
  assert.ok(csv.includes('"-42"'));
  assert.equal(csv.includes(`"'-42"`), false);
  assert.equal(JSON.stringify(dashboard.api.runtime.state), JSON.stringify(before));

  await dashboard.api.action('export-json');
  const jsonAnchor = dashboard.anchors.at(-1);
  const backup = JSON.parse(await dashboard.urls.get(jsonAnchor.href).text());
  assert.deepEqual(backup.state, before);
});

test('Dashboard preserves native price observation timestamps from the background', async () => {
  const dashboard = await loadDashboard();
  await dashboard.api.refreshNativePrices();
  assert.equal(dashboard.api.runtime.nativePrices.eth, 2_000);
  assert.equal(dashboard.api.runtime.nativePriceObservedAt.eth, 111);
  assert.equal(dashboard.calls.nativeMessages.every((message) => message.type === 'TANGO_GET_NATIVE_PRICE'), true);
});

test('Dashboard reports oversized import bytes and keeps authoritative data unchanged', async () => {
  const initialState = stateFixture();
  const initialSettings = settingsFixture();
  const error = new Error('importTooLarge');
  error.code = 'importTooLarge';
  error.measuredBytes = 9 * 1024 * 1024;
  error.budgetBytes = 8 * 1024 * 1024;
  const dashboard = await loadDashboard({
    initialState,
    initialSettings,
    importFailure: error
  });
  dashboard.fileInput.files = [{
    text: async () => JSON.stringify({ product: 'Tango Paper Trader' })
  }];

  await dashboard.fileInput.emit('change');

  assert.equal(dashboard.api.runtime.toast, 'importTooLarge:9.00/8.00');
  assert.equal(JSON.stringify(dashboard.api.runtime.state), JSON.stringify(initialState));
  assert.equal(JSON.stringify(dashboard.api.runtime.settings), JSON.stringify(initialSettings));
  assert.equal(dashboard.fileInput.value, '');
});

test('Dashboard falls back to the generic import toast for malformed typed byte details', async () => {
  const cases = [
    Object.assign(new Error('importTooLarge'), {
      code: 'importTooLarge', measuredBytes: -1, budgetBytes: 1
    }),
    Object.assign(new Error('importTooLarge'), {
      code: 'importTooLarge', measuredBytes: 1, budgetBytes: 0
    }),
    Object.assign(new Error('importTooLarge'), {
      code: 'importTooLarge', measuredBytes: 1, budgetBytes: 1
    }),
    Object.assign(new Error('importTooLarge'), {
      code: 'importTooLarge', measuredBytes: 1, budgetBytes: 2
    }),
    Object.assign(new Error('importFailed'), {
      code: 'importTooLarge', measuredBytes: 2, budgetBytes: 1
    }),
    new Error('importFailed')
  ];

  for (const importFailure of cases) {
    const dashboard = await loadDashboard({ importFailure });
    dashboard.fileInput.files = [{
      text: async () => JSON.stringify({ product: 'Tango Paper Trader' })
    }];

    await dashboard.fileInput.emit('change');

    assert.equal(dashboard.api.runtime.toast, 'importFailed', importFailure.message);
    assert.equal(dashboard.fileInput.value, '');
  }
});
