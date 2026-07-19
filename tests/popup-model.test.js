const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const popupSource = fs.readFileSync(path.join(root, 'src', 'popup', 'popup.js'), 'utf8');

function loadPopupModel() {
  const context = vm.createContext({ console, Date, Intl, Number, Object, Array, String, JSON, Map, Set });
  for (const file of [
    'src/core/chains.js',
    'src/shared/constants.js',
    'src/core/state.js',
    'src/core/engine.js',
    'src/content/chain-view.js',
    'src/popup/model.js'
  ]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return context.Tango;
}

function stateWithEthAndBsc(Tango) {
  const state = Tango.State.createInitialState({ now: 1 });
  state.initialized = true;
  state.positions['eth:0x1111111111111111111111111111111111111111'] = {
    chain: 'eth', tokenAddress: '0x1111111111111111111111111111111111111111',
    quantity: 1, costBasisNative: 1, lastPriceUsd: 2_000, lastNativePriceUsd: 2_000
  };
  state.positions['bsc:0x2222222222222222222222222222222222222222'] = {
    chain: 'bsc', tokenAddress: '0x2222222222222222222222222222222222222222',
    quantity: 1, costBasisNative: 1, lastPriceUsd: 600, lastNativePriceUsd: 600
  };
  return state;
}

test('Popup model shows one chain and a separate global USD summary', () => {
  const Tango = loadPopupModel();
  const state = stateWithEthAndBsc(Tango);
  const settings = Tango.State.normalizeSettings({ language: 'en' });
  const prices = { sol: 150, eth: 2_000, bsc: 600, base: 2_000, robinhood: 2_000, xlayer: 50 };

  const model = Tango.PopupModel.build(state, settings, 'eth', prices);

  assert.equal(model.chain.id, 'eth');
  assert.equal(model.summary.positionCount, 1);
  assert.equal(model.summary.cashBalanceNative, state.accounts.eth.cashBalanceNative);
  assert.equal(model.chainPositions.some((position) => position.chain === 'bsc'), false);
  assert.equal(model.globalUsd.assetsUsd > 0, true);
  assert.equal(model.nativeSymbol, 'ETH');
  assert.deepEqual(Array.from(model.chainOptions, (chain) => chain.id), ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']);
});

test('unknown selected chain falls back to Solana without changing state', () => {
  const Tango = loadPopupModel();
  const state = stateWithEthAndBsc(Tango);
  const settings = Tango.State.normalizeSettings({ language: 'en' });
  const before = JSON.stringify(state);

  const model = Tango.PopupModel.build(state, settings, 'unknown', {});

  assert.equal(model.chain.id, 'sol');
  assert.equal(JSON.stringify(state), before);
});

test('Popup model aggregates every priced chain exactly and reports missing prices', () => {
  const Tango = loadPopupModel();
  const state = stateWithEthAndBsc(Tango);
  const settings = Tango.State.normalizeSettings({ language: 'en' });
  const prices = { sol: 100, eth: 1_000, bsc: 500, base: 200, robinhood: 1_000, xlayer: 50 };

  const complete = Tango.PopupModel.build(state, settings, 'eth', prices).globalUsd;
  assert.deepEqual(JSON.parse(JSON.stringify(complete)), { assetsUsd: 30_000, pnlUsd: 1_500, complete: true, missingChains: [] });

  const partial = Tango.PopupModel.build(state, settings, 'eth', { ...prices, bsc: 0 }).globalUsd;
  assert.deepEqual(JSON.parse(JSON.stringify(partial)), { assetsUsd: 24_500, pnlUsd: 1_000, complete: false, missingChains: ['bsc'] });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function popupRuntime() {
  const Chains = require('../src/core/chains.js');
  const listeners = new Map();
  const app = { innerHTML: '' };
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      addEventListener(type, listener) { listeners.set(`${selector}:${type}`, listener); },
      emit(type, value) { return listeners.get(`${selector}:${type}`)?.({ target: { value } }); }
    });
    return elements.get(selector);
  }
  const document = {
    documentElement: {},
    querySelector(selector) { return selector === '#app' ? app : element(selector); },
    querySelectorAll() { return []; }
  };
  const state = { initialized: true };
  let persistedSettings = { enabled: true, language: 'en', selectedChain: 'sol', displayCurrency: 'NATIVE', chains: {} };
  const saveCalls = [];
  const Tango = {
    Chains,
    I18n: { resolveLanguage: (value) => value || 'en', t: (key) => key },
    Format: { native: String, usd: String },
    Engine: { markPosition: () => ({ valueNative: 0 }) },
    PopupModel: {
      build(currentState, currentSettings, selectedChain) {
        const chain = Chains.get(selectedChain) || Chains.get('sol');
        return {
          chain, account: {}, nativeSymbol: chain.nativeSymbol,
          summary: { cashBalanceNative: 0, equityNative: 0, totalPnlNative: 0, positionCount: 0 },
          chainPositions: [], globalUsd: { assetsUsd: 0, pnlUsd: 0, complete: true },
          chainOptions: Chains.all().map(({ id, name, nativeSymbol }) => ({ id, name, nativeSymbol }))
        };
      }
    },
    Store: {
      getAll() {
        return Promise.resolve({ state, settings: persistedSettings });
      },
      patchSettings(patch) {
        const gate = deferred();
        saveCalls.push({ patch, gate });
        return gate.promise.then(() => {
          persistedSettings = { ...persistedSettings, ...patch };
          return persistedSettings;
        });
      },
      initialize: async () => ({ state, settings: persistedSettings }), resetChain: async () => state, resetAll: async () => state
    }
  };
  const source = popupSource.replace(
    '  await loadInitial();\n})(globalThis);',
    '  await loadInitial();\n  global.__popupTest = { getSettings: () => settings };\n})(globalThis);'
  );
  assert.notEqual(source, popupSource, 'popup test harness must replace startup');
  const context = {
    Promise, Object, Number, String, Array, Map, Set, Math, console, Tango, document,
    chrome: { runtime: { sendMessage: async () => ({ ok: false }), openOptionsPage() {} }, tabs: { create() {} } },
    confirm: () => true
  };
  return Promise.resolve(vm.runInNewContext(source, context, { filename: 'src/popup/popup.js' })).then(() => ({
    app, element, saveCalls, get persistedSettings() { return persistedSettings; },
    set persistedSettings(value) { persistedSettings = value; }
  }));
}

test('rapid chain selections keep the latest chain and concurrent global setting', async () => {
  const popup = await popupRuntime();
  const selector = popup.element('#popup-chain');
  const first = selector.emit('change', 'eth');
  await new Promise((resolve) => setImmediate(resolve));
  const second = selector.emit('change', 'bsc');
  assert.equal(popup.saveCalls.length, 1, 'obsolete selection must not start a competing settings write');
  popup.saveCalls[0].gate.resolve();
  await first;
  assert.doesNotMatch(popup.app.innerHTML, /<option value="eth" selected>/);
  popup.persistedSettings = { ...popup.persistedSettings, displayCurrency: 'USD' };
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(popup.saveCalls.length, 2);
  assert.equal(JSON.stringify(popup.saveCalls[1].patch), JSON.stringify({ selectedChain: 'bsc' }));
  popup.saveCalls[1].gate.resolve();
  await second;

  assert.equal(popup.persistedSettings.selectedChain, 'bsc');
  assert.equal(popup.persistedSettings.displayCurrency, 'USD');
  assert.match(popup.app.innerHTML, /<option value="bsc" selected>/);
  assert.doesNotMatch(popup.app.innerHTML, /<option value="eth" selected>/);
});
