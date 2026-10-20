const test = require('node:test');
const assert = require('node:assert/strict');
global.Tango = {};
const Chains = require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');
const legacy = require('./fixtures/portfolio-summary-0.3.6-baseline.js');
function assertEquivalent(state, chain, price) {
  const expected = legacy(state, chain, price, Engine.markPosition);
  const actual = Engine.portfolioSummary(state, chain, price);
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key], `${chain}:${key}`);
}
test('portfolio summaries read each selected sell PnL once rather than repeatedly scanning history', () => {
  const state = State.createInitialState({ now: 1 });
  let reads = 0;
  state.trades = Array.from({ length: 1200 }, (_, index) => ({
    chain: 'bsc', side: 'SELL',
    get realizedPnlNative() { reads += 1; return ((index % 5) - 2) / 100; }
  }));
  const summary = Engine.portfolioSummary(state, 'bsc', 700);
  assert.equal(summary.totalTrades, 1200);
  assert.equal(summary.closedTrades, 1200);
  assert.ok(reads <= 1200, `expected at most1200 PnL reads, got ${reads}`);
});
test('summary outputs exactly match the baseline for six chains, holdings and floating point histories', () => {
  let seed = 7321;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const chains = Chains.all();
  for (let scenario = 0; scenario < 24; scenario += 1) {
    const state = State.createInitialState({ now: 1 });
    state.positions = {};
    for (let index = 0; index < 30; index += 1) {
      const chain = chains[next() % chains.length].id;
      state.positions[`${chain}:${index}`] = {
        chain, tokenAddress: String(index), quantity: next() / 1000,
        costBasisNative: next() / 1e8, lastPriceUsd: next() / 1e6,
        lastNativePriceUsd: (next() % 10000) + 1,
        provisionalNativePrice: index % 5 === 0, valuationMode: index % 2 ? 'PRICE' : 'MARKET_CAP'
      };
    }
    state.trades = Array.from({ length: next() % 600 }, (_, index) => ({
      chain: chains[next() % chains.length].id,
      side: index % 3 ? 'SELL' : 'BUY', realizedPnlNative: ((next() % 100000) - 50000) / 1e7
    }));
    const before = structuredClone(state);
    for (const chain of chains) for (const price of [undefined, 0, 700, 0.00001]) assertEquivalent(state, chain.id, price);
    assert.deepEqual(state, before);
  }
});
test('empty, sparse and nonfinite legacy summary histories preserve baseline edge results', () => {
  const state = State.createInitialState({ now: 1 });
  assertEquivalent(state, 'bsc', undefined);
  const values = [0, -0, 0.1, -0.1, 1e-12, -1e-12, '3', '-5', null, undefined, NaN, Infinity, -Infinity];
  state.trades = values.map((value) => ({ chain: 'bsc', side: 'SELL', realizedPnlNative: value }));
  state.trades.length += 3;
  assertEquivalent(state, 'bsc', 700);
  assertEquivalent(state, 'eth', 700);
  assert.throws(() => Engine.portfolioSummary(state, 'unknown', 1), /unsupportedChain/);
});
