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
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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

async function loadDashboard({ deferThirdGetAll = false } = {}) {
  const appElements = new Map();
  const element = (selector) => {
    if (!appElements.has(selector)) appElements.set(selector, {
      value: '', checked: false,
      addEventListener() {}, click() {}, files: [],
      querySelectorAll() { return []; }
    });
    return appElements.get(selector);
  };
  const app = {
    innerHTML: '',
    querySelector: element,
    querySelectorAll() { return []; }
  };
  const fileInput = element('#import-file');
  let persistedState = stateFixture();
  let persistedSettings = settingsFixture();
  const refreshedSettings = deferred();
  let getAllCalls = 0;
  const calls = { saves: [], resetChain: [], resetAll: 0, exportData: 0, downloads: [], nativeMessages: [] };
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
          trades: state.trades.filter((trade) => trade.chain === chain.id),
          summary: Tango.Engine.portfolioSummary(), globalUsd: Tango.Engine.globalUsdSummary(),
          chainSettings: settings.chains[chain.id],
          accounts: Chains.all().map((entry) => ({ chain: entry, summary: Tango.Engine.portfolioSummary(), nativePriceUsd: Number(nativePrices[entry.id] || 0) }))
        };
      },
      tradesCsvRows(state, chain) { return state.trades.filter((trade) => trade.chain === chain); },
      calendar() { return { days: {}, trades: [], totalNative: 0, winRate: 0, bestNative: 0, worstNative: 0 }; }
    },
    Store: {
      getAll() {
        getAllCalls += 1;
        if (deferThirdGetAll && getAllCalls === 3) return refreshedSettings.promise.then(() => ({ state: persistedState, settings: persistedSettings }));
        return Promise.resolve({ state: persistedState, settings: persistedSettings });
      },
      saveSettings(next) {
        const gate = deferred();
        calls.saves.push({ next, gate });
        return gate.promise.then(() => { persistedSettings = next; return next; });
      },
      async resetChain(chain, balance) { calls.resetChain.push([chain, balance]); return persistedState; },
      async resetAll() { calls.resetAll += 1; return persistedState; },
      async exportData() { calls.exportData += 1; return { product: 'Tango Paper Trader', state: persistedState, settings: persistedSettings }; },
      async importData() { return { state: persistedState, settings: persistedSettings }; },
      subscribe() {}
    }
  };
  const context = {
    Promise, Object, Number, String, Array, Map, Set, Math, Date, JSON, Intl, console, Tango, Blob,
    document: {
      documentElement: { lang: '', dataset: {} },
      querySelector(selector) { return selector === '#app' ? app : selector === '#import-file' ? fileInput : element(selector); },
      createElement(tag) {
        if (tag !== 'a') return element(tag);
        const anchor = { href: '', download: '', click() { anchors.push(this); } };
        return anchor;
      }
    },
    location: { hash: '' },
    URL: {
      createObjectURL(blob) { const key = `blob:${++urlId}`; urls.set(key, blob); return key; },
      revokeObjectURL() {}
    },
    setTimeout: (fn) => { fn(); return 0; },
    confirm: () => true,
    navigator: {}, ClipboardItem: class {},
    chrome: {
      runtime: {
        async sendMessage(message) {
          calls.nativeMessages.push(message);
          return { ok: true, price: message.chain === 'eth' ? 2_000 : 100, observedAt: message.chain === 'eth' ? 111 : 222 };
        }
      },
      tabs: { create() {} }
    }
  };
  vm.runInNewContext(source, context, { filename: 'src/dashboard/dashboard.js' });
  assert.ok(context.__dashboardTest, 'dashboard runtime test API must be exposed');
  await context.__dashboardTest.load();
  return {
    api: context.__dashboardTest, calls, app, element, anchors, urls, refreshedSettings,
    get persistedSettings() { return persistedSettings; },
    set persistedSettings(value) { persistedSettings = value; }
  };
}

test('rapid Dashboard chain selections persist only the latest chain without clobbering global settings', async () => {
  const dashboard = await loadDashboard({ deferThirdGetAll: true });
  const first = dashboard.api.saveSelectedChain('eth');
  await new Promise((resolve) => setImmediate(resolve));
  const second = dashboard.api.saveSelectedChain('bsc');
  assert.equal(dashboard.calls.saves.length, 1);
  dashboard.calls.saves[0].gate.resolve();
  await first;
  dashboard.persistedSettings = { ...dashboard.persistedSettings, displayCurrency: 'USD' };
  dashboard.refreshedSettings.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 2);
  assert.equal(dashboard.calls.saves[1].next.selectedChain, 'bsc');
  assert.equal(dashboard.calls.saves[1].next.displayCurrency, 'USD');
  dashboard.calls.saves[1].gate.resolve();
  await second;
  assert.equal(dashboard.api.runtime.selectedChain, 'bsc');
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
  const save = dashboard.api.action('save-settings');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dashboard.calls.saves.length, 1);
  const next = dashboard.calls.saves[0].next;
  assert.deepEqual(next.chains.eth, dashboard.persistedSettings.chains.eth);
  assert.deepEqual(Array.from(next.chains.bsc.buyPresets), [2, 4]);
  assert.equal(next.chains.bsc.networkFeeNative, 0.005);
  assert.equal(next.chains.bsc.initialBalanceNative, 30);
  assert.deepEqual(Array.from(next.sellPresets), [50, 100]);
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
