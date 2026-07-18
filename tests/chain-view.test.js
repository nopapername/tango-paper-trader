const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
const View = require('../src/content/chain-view.js');
require('../src/shared/format.js');
require('../src/shared/i18n.js');

const ETH_ADDRESS = '0x1111111111111111111111111111111111111111';
const BSC_ADDRESS = '0x2222222222222222222222222222222222222222';

test('selectors return only the requested chain', () => {
  const state = {
    positions: { a: { chain: 'eth' }, b: { chain: 'bsc' } },
    trades: [{ chain: 'eth', id: 'e' }, { chain: 'bsc', id: 'b' }],
    dailyRealizedByChain: {
      eth: { '2026-07-18': { native: 1 } },
      bsc: { '2026-07-18': { native: 2 } }
    }
  };

  assert.deepEqual(View.positions(state, 'eth'), [{ chain: 'eth' }]);
  assert.deepEqual(View.trades(state, 'eth').map((trade) => trade.id), ['e']);
  assert.deepEqual(View.daily(state, 'eth'), { '2026-07-18': { native: 1 } });
});

test('close orders never include another chain and omit stale valuations', () => {
  const stateWithEthAndBsc = {
    positions: {
      eth: { chain: 'eth', tokenAddress: ETH_ADDRESS, symbol: 'ETH-TOKEN' },
      bsc: { chain: 'bsc', tokenAddress: BSC_ADDRESS, symbol: 'BSC-TOKEN' }
    }
  };
  const freshQuote = { priceUsd: 2, nativePriceUsd: 3_000, observedAt: Date.now() };

  const orders = View.closeOrders(
    stateWithEthAndBsc,
    'eth',
    (position) => position.tokenAddress === ETH_ADDRESS ? freshQuote : null
  );

  assert.deepEqual(orders.map((order) => order.token.chain), ['eth']);
  assert.equal(orders[0].quote, freshQuote);
});

test('native formatting uses the requested symbol and keeps sol as a legacy wrapper', () => {
  assert.equal(global.Tango.Format.native(1.25, 'ETH', 'en', true), '+1.25 ETH');
  assert.equal(global.Tango.Format.native(-2, 'BNB', 'en', true), '-2 BNB');
  assert.equal(global.Tango.Format.sol(3, 'en', true), '+3 SOL');
});

test('multichain runtime errors are localized in English and Chinese', () => {
  for (const key of ['unsupportedChain', 'invalidAddress', 'nativePriceUnavailable', 'partialUsdData', 'closeAllPartial']) {
    assert.notEqual(global.Tango.I18n.t(key, 'en'), key);
    assert.notEqual(global.Tango.I18n.t(key, 'zh-CN'), key);
  }
});
