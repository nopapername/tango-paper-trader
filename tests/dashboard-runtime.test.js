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
    sellPresets: [25, 50, 100], slippageBps: 50, platformFeeBps: 100,
    pnlBarPosition: 'bottom', fastMode: false, confirmationEnabled: true,
    soundEnabled: true, showListQuickBuy: true,
    chains: Object.fromEntries(Chains.all().map((chain) => [chain.id, {
      buyPresets: [1], networkFeeNative: 0.001, initialBalanceNative: chain.id === 'bsc' ? 25 : 10
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
  dashboardLocation = { hash: '', search: '' }
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
  let persistedState = stateFixture();
  let persistedSettings = settingsFixture();
  const refreshedSettings = deferred();
  let getAllCalls = 0;
  const calls = { getAll: 0, saves: [], fullSaves: [], resetChain: [], resetAll: 0, exportData: 0, downloads: [], nativeMessages: [], confirms: [], tabs: [] };
  const anchors = [];
  const urls = new Map();
  let urlId = 0;
  const source = dashboardSource.replace(
    /  Tango\.Store\.subscribe\(load\);load\(\);\r?\n\}\)\(globalThis\);\s*$/,
    '  global.__dashboardTest = { runtime, load, render, saveSelectedChain, refreshNativePrices, action, tradesCsv };\n})(globalThis);'
  );
  assert.notEqual(source, dashboardSource, 'dashboard test harness must replace startup');
  const Tango = {
    VERSION: 'test', Chains,
    I18n: { resolveLanguage: (value) => value || 'en', t: (key) => key },
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
        if (failFirstGetAll && getAllCalls === 1) return Promise.reject(new Error('storage unavailable'));
        if (deferThirdGetAll && getAllCalls === 3) return refreshedSettings.promise.then(() => ({ state: persistedState, settings: persistedSettings }));
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
      async exportData() { calls.exportData += 1; return { product: 'Tango Paper Trader', state: persistedState, settings: persistedSettings }; },
      async importData() { return { state: persistedState, settings: persistedSettings }; },
      subscribe() {}
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
    confirm(message) { calls.confirms.push(message); return confirmImpl(message); },
    navigator: {}, ClipboardItem: class {},
    chrome: {
      runtime: {
        async sendMessage(message) {
          calls.nativeMessages.push(message);
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
    api: context.__dashboardTest, calls, app, element, anchors, urls, refreshedSettings, document, initialLoadError,
    setConfirm(callback) { confirmImpl = callback; },
    get persistedSettings() { return persistedSettings; },
    set persistedSettings(value) { persistedSettings = value; }
  };
}

function fillSettingsForm(dashboard) {
  const fields = {
    '#setting-language': 'en', '#setting-currency': 'NATIVE', '#setting-theme': 'dark',
    '#setting-buy-presets': '2, 4', '#setting-initial-balance': '30', '#setting-network-fee': '0.005',
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
  assert.deepEqual(dashboard.calls.resetChain, [['bsc', 25]]);
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
  assert.deepEqual(dashboard.calls.resetChain, [['bsc', 25]]);
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
  assert.equal(patch.chains.bsc.initialBalanceNative, 30);
  assert.deepEqual(Array.from(patch.sellPresets), [50, 100]);
  dashboard.calls.saves[0].gate.resolve();
  await save;
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

test('Dashboard preserves native price observation timestamps from the background', async () => {
  const dashboard = await loadDashboard();
  await dashboard.api.refreshNativePrices();
  assert.equal(dashboard.api.runtime.nativePrices.eth, 2_000);
  assert.equal(dashboard.api.runtime.nativePriceObservedAt.eth, 111);
  assert.equal(dashboard.calls.nativeMessages.every((message) => message.type === 'TANGO_GET_NATIVE_PRICE'), true);
});
