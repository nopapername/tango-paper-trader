const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
const GMGN = require('../src/adapters/gmgn.js');

test('extracts GMGN and Pump.fun token addresses', () => {
  assert.equal(GMGN.tokenAddressFromUrl('https://gmgn.ai/sol/token/AbC123pump?tab=holders'), 'AbC123pump');
  assert.equal(GMGN.tokenAddressFromUrl('https://pump.fun/coin/AbC123pump'), 'AbC123pump');
});

test('parses compact money and GMGN subscript prices', () => {
  assert.equal(GMGN.parseMoney('$16.03K'), 16030);
  assert.equal(GMGN.parseMoney('$1.82M'), 1_820_000);
  assert.equal(GMGN.parseMoney('$0.0₄160'), 0.000016);
});

test('extracts trench market cap and symbol from card text', () => {
  const text = '68gi...pump\nHIMA\nhimalayancatcoin\n44s\nMC\n$2.6K\nV\n$820.8';
  assert.equal(GMGN._cardSymbol(text), 'HIMA');
  assert.equal(GMGN._cardMarketCap(text), 2600);
});

test('quick-buy injection is restricted to the Solana trench root', () => {
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/?chain=sol'), true);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/sol/token/AbC123pump'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/monitor?chain=sol'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/trend?chain=sol'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/?chain=bsc'), false);
});
