const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

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
