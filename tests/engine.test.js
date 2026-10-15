const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');

function state(balance = 100) {
  const value = State.createInitialState({ now: 1, initialBalances: { sol: balance } });
  value.initialized = true;
  return value;
}

const settings = State.normalizeSettings({
  slippageBps: 100,
  platformFeeBps: 100,
  chains: { sol: { networkFeeNative: 0.001 } }
});
const token = {
  chain: 'sol', address: '11111111111111111111111111111112', symbol: 'TANGO', name: 'Tango',
  metadataVerified: true, metadataSource: 'GMGN_DETAIL'
};
const quote = {
  priceUsd: 2, marketCapUsd: 2_000_000, liquidityUsd: 500_000,
  nativePriceUsd: 100, observedAt: 1_000, nativePriceObservedAt: 1_000
};
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const ethToken = {
  chain: 'eth', address: EVM_ADDRESS, symbol: 'ETHY',
  metadataVerified: true, metadataSource: 'GMGN_NETWORK'
};
const baseToken = {
  chain: 'base', address: EVM_ADDRESS, symbol: 'BANKR', launchpad: 'Clanker',
  metadataVerified: true, metadataSource: 'GMGN_NETWORK'
};
const paperSettings = State.normalizeSettings({
  slippageBps: 0, platformFeeBps: 0,
  chains: {
    eth: { networkFeeNative: 0 },
    base: { networkFeeNative: 0 }
  }
});

function internalUnknownFallbackQuote(observedAt = 1_000, overrides = {}) {
  const fallback = global.Tango.Supply.fallbackValuation({
    chain: 'eth', launchpad: 'Unknown'
  });
  return {
    chain: 'eth', address: ethToken.address,
    ...fallback,
    marketCapDivisor: fallback.totalSupply,
    provisionalSupply: fallback.totalSupply,
    nativePriceUsd: 2_000,
    observedAt,
    nativePriceObservedAt: observedAt,
    source: 'TANGO_FALLBACK',
    valuationMode: 'MARKET_CAP',
    priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
    syntheticTokenPrice: true,
    provisional: true,
    paperFallback: true,
    ...overrides
  };
}

function exactUnknownFallbackCorrection(observedAt = 2_000, overrides = {}) {
  return {
    chain: 'eth', address: ethToken.address,
    priceUsd: 3_200 / 100_000_000_000,
    marketCapUsd: 3_200,
    totalSupply: 100_000_000_000,
    marketCapDivisor: 100_000_000_000,
    supplySource: 'GMGN_EXACT',
    nativePriceUsd: 2_000,
    observedAt,
    priceObservedAt: observedAt,
    marketCapObservedAt: observedAt,
    nativePriceObservedAt: observedAt,
    source: 'GMGN_NETWORK',
    valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED',
    syntheticTokenPrice: false,
    provisional: false,
    paperFallback: false,
    ...overrides
  };
}

function buyUnknownFallback({ chain, amountNative = 1 }) {
  const address = chain === 'sol' ? token.address : EVM_ADDRESS;
  const initial = State.createInitialState({ now: 1, initialBalances: { [chain]: 10 } });
  initial.initialized = true;
  const testSettings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0,
    chains: { [chain]: { networkFeeNative: 0 } }
  });
  const fallback = Tango.Supply.fallbackValuation({ chain, launchpad: 'Unknown' });
  const provisionalToken = { chain, address, symbol: 'UPGRADE' };
  const fallbackQuote = {
    chain, address, ...fallback,
    marketCapDivisor: fallback.totalSupply,
    provisionalSupply: fallback.totalSupply,
    nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_FALLBACK', valuationMode: 'MARKET_CAP',
    priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP', syntheticTokenPrice: true,
    provisional: true, paperFallback: true
  };
  const bought = Engine.executeBuy(initial, {
    token: provisionalToken, quote: fallbackQuote, amountNative
  }, testSettings, 1_000);
  return {
    state: bought.state, position: bought.position,
    key: Engine.positionKey(chain, address), address, settings: testSettings
  };
}

function buyFallbackPosition(scenario) {
  let base = buyUnknownFallback({ chain: scenario.chain });
  if (scenario.name === 'Mayhem') {
    const initial = State.createInitialState({ now: 1, initialBalances: { sol: 10 } });
    initial.initialized = true;
    const pumpSettings = State.normalizeSettings({
      slippageBps: 0, platformFeeBps: 0,
      chains: { sol: { networkFeeNative: 0 } }
    });
    const standardToken = {
      chain: 'sol', address: token.address, symbol: 'PUMP', launchpad: 'Pump.fun',
      launchMode: '', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    };
    const standard = Tango.Supply.fallbackValuation({
      chain: 'sol', launchpad: 'Pump.fun', launchMode: ''
    });
    const standardQuote = {
      chain: 'sol', address: token.address, ...standard,
      marketCapDivisor: standard.totalSupply,
      nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_DETAIL', valuationMode: 'MARKET_CAP',
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP', syntheticTokenPrice: true,
      provisional: true, paperFallback: true
    };
    const bought = Engine.executeBuy(initial, {
      token: standardToken, quote: standardQuote, amountNative: 1
    }, pumpSettings, 1_000);
    base = {
      state: bought.state, position: bought.position, address: token.address,
      key: Engine.positionKey('sol', token.address), settings: pumpSettings
    };
  }
  const launchpad = scenario.name === 'Mayhem' ? 'Pump.fun' : scenario.name;
  const launchMode = scenario.name === 'Mayhem' ? 'Mayhem' : '';
  const verifiedToken = {
    chain: scenario.chain, address: base.address, symbol: scenario.name,
    launchpad, launchMode, metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  const upgradeQuote = {
    chain: scenario.chain, address: base.address,
    priceUsd: 3_200 / scenario.to, marketCapUsd: 3_200,
    totalSupply: scenario.to, marketCapDivisor: scenario.to,
    supplySource: 'LAUNCHPAD_RULE', nativePriceUsd: 2_000,
    observedAt: 2_000, priceObservedAt: 2_000,
    marketCapObservedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_DETAIL', valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED', syntheticTokenPrice: false,
    provisional: false, paperFallback: true
  };
  return { ...base, verifiedToken, upgradeQuote };
}

for (const scenario of [
  { name: 'Bankr', chain: 'robinhood', from: 1_000_000_000, to: 100_000_000_000 },
  { name: 'Clanker', chain: 'base', from: 1_000_000_000, to: 100_000_000_000 },
  { name: 'Mayhem', chain: 'sol', from: 1_000_000_000, to: 2_000_000_000 }
]) {
  test(`verified ${scenario.name} context upgrades before repeat buy`, () => {
    const fixture = buyFallbackPosition(scenario);
    const historicalTrades = structuredClone(fixture.state.trades);
    const rebought = Engine.executeBuy(fixture.state, {
      token: fixture.verifiedToken,
      quote: fixture.upgradeQuote,
      amountNative: 1
    }, fixture.settings, 2_000);

    assert.equal(rebought.state.calibrations[0].reason, 'SUPPLY');
    assert.equal(rebought.state.calibrations[0].fromSupply, scenario.from);
    assert.equal(rebought.state.calibrations[0].toSupply, scenario.to);
    assert.ok(Math.abs(rebought.state.calibrations[0].quantityAfter
      - fixture.position.quantity * scenario.to / scenario.from) <= 1e-12);
    assert.ok(Number.isFinite(rebought.position.quantity));
    assert.deepEqual(rebought.state.trades.slice(1), historicalTrades);
    assert.equal(rebought.state.calibrations[0].costBasisNative, fixture.position.costBasisNative);
    assert.ok(Object.values(rebought.state.accounts).every((account) =>
      Number.isFinite(account.cashBalanceNative) && account.cashBalanceNative >= 0));
    assert.doesNotThrow(() => State.normalizeState(rebought.state, fixture.settings, { strict: true }));
  });

  test(`verified ${scenario.name} context upgrades before partial and exact 100 percent sell`, () => {
    const fixture = buyFallbackPosition(scenario);
    const partial = Engine.executeSell(fixture.state, {
      token: fixture.verifiedToken, quote: fixture.upgradeQuote, percent: 25
    }, fixture.settings, 2_000);
    const calibratedQuantity = partial.state.calibrations[0].quantityAfter;
    assert.ok(Math.abs(partial.trade.quantity - calibratedQuantity * .25) <= 1e-12);
    assert.equal(partial.state.calibrations[0].reason, 'SUPPLY');
    assert.equal(partial.state.calibrations[0].fromSupply, scenario.from);
    assert.equal(partial.state.calibrations[0].toSupply, scenario.to);
    assert.equal(partial.position.costBasisNative, fixture.position.costBasisNative * .75);
    assert.ok(Object.values(partial.state.accounts).every((account) =>
      Number.isFinite(account.cashBalanceNative) && account.cashBalanceNative >= 0));
    assert.doesNotThrow(() => State.normalizeState(partial.state, fixture.settings, { strict: true }));

    const sold = Engine.executeSell(partial.state, {
      token: fixture.verifiedToken,
      quote: { ...fixture.upgradeQuote, observedAt: 3_000, priceObservedAt: 3_000, marketCapObservedAt: 3_000, nativePriceObservedAt: 3_000 },
      percent: 100
    }, fixture.settings, 3_000);
    assert.ok(Math.abs(sold.trade.quantity - partial.position.quantity) <= 1e-12);
    assert.equal(sold.state.positions[fixture.key], undefined);
    assert.ok(Math.abs(sold.state.accounts[scenario.chain].cashBalanceNative - 10) <= 1e-12);
    assert.doesNotThrow(() => State.normalizeState(sold.state, fixture.settings, { strict: true }));
  });
}

test('supply representation changes neutrally while a simultaneous factual price move remains PnL', () => {
  const fixture = buyUnknownFallback({ chain: 'robinhood', amountNative: 1 });
  const old = fixture.position;
  const verifiedToken = {
    chain: 'robinhood', address: fixture.address, symbol: 'BANKR', launchpad: 'Bankr',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  const moved = Engine.updatePositionQuote(fixture.state, verifiedToken, {
    chain: 'robinhood', address: fixture.address,
    priceUsd: old.lastPriceUsd / 100 * 2,
    marketCapUsd: old.lastMarketCapUsd * 2,
    totalSupply: 100_000_000_000, marketCapDivisor: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE', nativePriceUsd: 2_000,
    observedAt: 2_000, priceObservedAt: 2_000,
    marketCapObservedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_DETAIL', valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED', syntheticTokenPrice: false,
    provisional: false, paperFallback: true
  }, 2_000);
  const next = moved.positions[fixture.key];
  assert.ok(Math.abs(next.quantity - old.quantity * 100) <= 1e-12);
  assert.ok(Math.abs(Engine.markPosition(next).valueNative
    - Engine.markPosition(old).valueNative * 2) <= 1e-12);
});

test('internal unknown fallback persists a market-cap provisional supply and exact correction is neutral', () => {
  const bought = Engine.executeBuy(
    state(), { token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 1 },
    paperSettings, 1_000
  );
  const key = Engine.positionKey('eth', ethToken.address);
  const before = structuredClone(bought.state);
  const beforeMark = Engine.markPosition(bought.position).valueNative;

  assert.equal(bought.position.supplySource, 'UNKNOWN_FALLBACK');
  assert.ok(!['GMGN_EXACT', 'GMGN_RATIO', 'LAUNCHPAD_RULE'].includes(bought.position.supplySource));
  assert.equal(bought.position.valuationMode, 'MARKET_CAP');
  assert.equal(bought.position.totalSupply, 1_000_000_000);
  assert.equal(bought.position.marketCapDivisor, 1_000_000_000);
  assert.equal(bought.position.provisionalSupply, 1_000_000_000);
  assert.equal(bought.position.needsCalibration, true);
  assert.equal(bought.position.paperFallback, true);
  assert.doesNotThrow(() => State.normalizeState(bought.state, paperSettings, { strict: true }));

  const factualMove = Engine.updatePositionQuote(bought.state, ethToken, {
    chain: 'eth', address: ethToken.address,
    priceUsd: internalUnknownFallbackQuote().priceUsd * 2,
    marketCapUsd: 6_400,
    nativePriceUsd: 2_000,
    observedAt: 2_000,
    priceObservedAt: 2_000,
    marketCapObservedAt: 2_000,
    nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK',
    valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE',
    syntheticTokenPrice: false,
    provisional: false
  }, 2_000);
  assert.equal(factualMove.positions[key].quantity, bought.position.quantity);
  assert.equal(Engine.markPosition(factualMove.positions[key]).valueNative, beforeMark * 2);
  assert.equal(factualMove.calibrations[0].reason, 'PRICE');
  assert.equal(
    factualMove.calibrations[0].quantityBefore,
    factualMove.calibrations[0].quantityAfter
  );

  const corrected = Engine.updatePositionQuote(
    bought.state, ethToken, exactUnknownFallbackCorrection(), 2_000
  );
  const position = corrected.positions[key];
  assert.equal(position.totalSupply, 100_000_000_000);
  assert.equal(position.supplySource, 'GMGN_EXACT');
  assert.ok(Math.abs(Engine.markPosition(position).valueNative - beforeMark) <= 1e-12);
  assert.notEqual(position.quantity, before.positions[key].quantity);
  assert.equal(position.costBasisNative, before.positions[key].costBasisNative);
  assert.deepEqual(corrected.accounts, before.accounts);
  assert.deepEqual(corrected.trades, before.trades);
  assert.equal(position.realizedPnlNative, before.positions[key].realizedPnlNative);
  assert.equal(corrected.calibrations[0].fromSupply, 1_000_000_000);
  assert.equal(corrected.calibrations[0].toSupply, 100_000_000_000);
  assert.notEqual(
    corrected.calibrations[0].quantityBefore,
    corrected.calibrations[0].quantityAfter
  );
});

test('factual supply upgrades correct 2B and 100B representation without hiding simultaneous price PnL', () => {
  for (const exactSupply of [2_000_000_000, 100_000_000_000]) {
    for (const priceMultiplier of [1, 2]) {
      const label = `${exactSupply}:${priceMultiplier}x`;
      const bought = Engine.executeBuy(
        state(), { token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 1 },
        paperSettings, 1_000
      );
      const originalBuy = JSON.stringify(bought.trade);
      const originalHistory = JSON.stringify(bought.state.trades);
      const beforeMark = Engine.markPosition(bought.position).valueNative;
      const factualPriceUsd = (3_200 / exactSupply) * priceMultiplier;
      const upgraded = Engine.updatePositionQuote(bought.state, ethToken, {
        chain: 'eth', address: ethToken.address,
        priceUsd: factualPriceUsd,
        marketCapUsd: factualPriceUsd * exactSupply,
        totalSupply: exactSupply,
        marketCapDivisor: exactSupply,
        supplySource: 'GMGN_EXACT',
        nativePriceUsd: 2_000,
        observedAt: 2_000,
        priceObservedAt: 2_000,
        marketCapObservedAt: 2_000,
        nativePriceObservedAt: 2_000,
        source: 'GMGN_NETWORK',
        valuationMode: 'MARKET_CAP',
        priceProvenance: 'MARKET_CAP_DERIVED',
        syntheticTokenPrice: false,
        syntheticNativePrice: false,
        provisional: false,
        paperFallback: false
      }, 2_000);
      const position = upgraded.positions[Engine.positionKey('eth', ethToken.address)];

      assert.equal(position.totalSupply, exactSupply, label);
      assert.equal(position.supplySource, 'GMGN_EXACT', label);
      assert.equal(position.lastPriceUsd, factualPriceUsd, label);
      assert.equal(position.lastMarketCapUsd, 3_200 * priceMultiplier, label);
      assert.equal(position.syntheticTokenPrice, false, label);
      assert.equal(position.provisional, false, label);
      const expectedQuantity = bought.position.quantity * exactSupply / 1_000_000_000;
      assert.ok(
        Math.abs(position.quantity - expectedQuantity) <= expectedQuantity * 1e-12,
        label
      );
      assert.ok(Math.abs(
        Engine.markPosition(position).valueNative - beforeMark * priceMultiplier
      ) <= 1e-12, label);
      assert.equal(JSON.stringify(upgraded.trades), originalHistory, label);
      assert.equal(JSON.stringify(upgraded.trades[0]), originalBuy, label);
    }
  }
});

test('internal unknown fallback correction after a partial sell changes only the remaining quantity', () => {
  const bought = Engine.executeBuy(
    state(), { token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 2 },
    paperSettings, 1_000
  );
  const sold = Engine.executeSell(bought.state, {
    token: ethToken,
    quote: internalUnknownFallbackQuote(2_000),
    percent: 50
  }, paperSettings, 2_000);
  const key = Engine.positionKey('eth', ethToken.address);
  const beforePosition = structuredClone(sold.position);
  const tradesBefore = structuredClone(sold.state.trades);
  const accountsBefore = structuredClone(sold.state.accounts);
  const corrected = Engine.updatePositionQuote(
    sold.state, ethToken, exactUnknownFallbackCorrection(3_000), 3_000
  );

  assert.ok(Math.abs(
    Engine.markPosition(corrected.positions[key]).valueNative
      - Engine.markPosition(beforePosition).valueNative
  ) <= 1e-12);
  assert.notEqual(corrected.positions[key].quantity, beforePosition.quantity);
  assert.equal(corrected.positions[key].costBasisNative, beforePosition.costBasisNative);
  assert.equal(corrected.positions[key].realizedPnlNative, beforePosition.realizedPnlNative);
  assert.deepEqual(corrected.trades, tradesBefore);
  assert.deepEqual(corrected.accounts, accountsBefore);
  assert.equal(corrected.trades.find((trade) => trade.side === 'SELL').realizedPnlNative, 0);
});

test('price-only mark remains PnL when a later factual supply correction reports a lower market cap', () => {
  const bought = Engine.executeBuy(
    state(), { token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 1 },
    paperSettings, 1_000
  );
  const key = Engine.positionKey('eth', ethToken.address);
  const priced = Engine.updatePositionQuote(bought.state, ethToken, {
    chain: 'eth', address: ethToken.address,
    priceUsd: internalUnknownFallbackQuote().priceUsd * 2,
    nativePriceUsd: 2_000,
    observedAt: 2_000, priceObservedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE', syntheticTokenPrice: false, provisional: false
  }, 2_000);

  assert.equal(priced.positions[key].lastPriceUsd, internalUnknownFallbackQuote().priceUsd * 2);
  assert.equal(priced.positions[key].quantity, bought.position.quantity);
  assert.equal(priced.positions[key].supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(priced.positions[key].provisionalSupply, 1_000_000_000);
  assert.equal(priced.positions[key].needsCalibration, true);
  const reloaded = State.normalizeState(
    JSON.parse(JSON.stringify(priced)), paperSettings, { strict: true }
  );
  const before = structuredClone(reloaded);
  const beforeMark = Engine.markPosition(reloaded.positions[key]).valueNative;
  const corrected = Engine.updatePositionQuote(
    reloaded, ethToken, exactUnknownFallbackCorrection(3_000), 3_000
  );

  assert.ok(Math.abs(Engine.markPosition(corrected.positions[key]).valueNative - beforeMark / 2) <= 1e-12);
  assert.notEqual(corrected.positions[key].quantity, before.positions[key].quantity);
  assert.equal(corrected.positions[key].costBasisNative, before.positions[key].costBasisNative);
  assert.equal(corrected.positions[key].realizedPnlNative, before.positions[key].realizedPnlNative);
  assert.deepEqual(corrected.accounts, before.accounts);
  assert.deepEqual(corrected.trades, before.trades);
  assert.equal(corrected.calibrations[0].fromSupply, 1_000_000_000);
  assert.equal(corrected.calibrations[0].toSupply, 100_000_000_000);
  assert.notEqual(corrected.calibrations[0].quantityBefore, corrected.calibrations[0].quantityAfter);
});

test('price-only partial-sell state reload keeps factual price PnL through supply correction', () => {
  const bought = Engine.executeBuy(
    state(), { token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 2 },
    paperSettings, 1_000
  );
  const sold = Engine.executeSell(bought.state, {
    token: ethToken, quote: internalUnknownFallbackQuote(2_000), percent: 50
  }, paperSettings, 2_000);
  const key = Engine.positionKey('eth', ethToken.address);
  const priced = Engine.updatePositionQuote(sold.state, ethToken, {
    chain: 'eth', address: ethToken.address,
    priceUsd: internalUnknownFallbackQuote().priceUsd * 2,
    nativePriceUsd: 2_000,
    observedAt: 3_000, priceObservedAt: 3_000, nativePriceObservedAt: 3_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE', syntheticTokenPrice: false, provisional: false
  }, 3_000);
  const reloaded = State.normalizeState(
    JSON.parse(JSON.stringify(priced)), paperSettings, { strict: true }
  );
  const before = structuredClone(reloaded);
  const beforeMark = Engine.markPosition(reloaded.positions[key]).valueNative;
  const corrected = Engine.updatePositionQuote(
    reloaded, ethToken, exactUnknownFallbackCorrection(4_000), 4_000
  );

  assert.ok(Math.abs(Engine.markPosition(corrected.positions[key]).valueNative - beforeMark / 2) <= 1e-12);
  assert.notEqual(corrected.positions[key].quantity, before.positions[key].quantity);
  assert.equal(corrected.positions[key].costBasisNative, before.positions[key].costBasisNative);
  assert.equal(corrected.positions[key].realizedPnlNative, before.positions[key].realizedPnlNative);
  assert.deepEqual(corrected.accounts, before.accounts);
  assert.deepEqual(corrected.trades, before.trades);
  assert.equal(corrected.trades.find((trade) => trade.side === 'SELL').realizedPnlNative, 0);
  assert.equal(corrected.calibrations[0].fromSupply, 1_000_000_000);
  assert.equal(corrected.calibrations[0].toSupply, 100_000_000_000);
});

test('price-first partial sell persists a PRICE trade and keeps factual PnL after strict reload', () => {
  const bought = Engine.executeBuy(
    state(), { token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 2 },
    paperSettings, 1_000
  );
  const key = Engine.positionKey('eth', ethToken.address);
  const factualPrice = {
    chain: 'eth', address: ethToken.address,
    priceUsd: internalUnknownFallbackQuote().priceUsd * 2,
    nativePriceUsd: 2_000,
    observedAt: 2_000, priceObservedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE', syntheticTokenPrice: false, provisional: false
  };
  const priced = Engine.updatePositionQuote(bought.state, ethToken, factualPrice, 2_000);
  const sold = Engine.executeSell(priced, {
    token: ethToken,
    quote: {
      ...factualPrice,
      observedAt: 3_000, priceObservedAt: 3_000, nativePriceObservedAt: 3_000
    },
    percent: 50
  }, paperSettings, 3_000);
  const sell = sold.trade;

  assert.equal(sell.valuationMode, 'PRICE');
  assert.equal(sell.priceProvenance, 'OBSERVED_PRICE');
  assert.equal(sell.marketCapUsd, 0);
  assert.equal(sell.observedPriceUsd, factualPrice.priceUsd);
  const reloaded = State.normalizeState(
    JSON.parse(JSON.stringify(sold.state)), paperSettings, { strict: true }
  );
  const before = structuredClone(reloaded);
  const beforeMark = Engine.markPosition(reloaded.positions[key]).valueNative;
  const corrected = Engine.updatePositionQuote(
    reloaded, ethToken, exactUnknownFallbackCorrection(4_000), 4_000
  );

  assert.ok(Math.abs(Engine.markPosition(corrected.positions[key]).valueNative - beforeMark / 2) <= 1e-12);
  assert.notEqual(corrected.positions[key].quantity, before.positions[key].quantity);
  assert.equal(corrected.positions[key].costBasisNative, before.positions[key].costBasisNative);
  assert.equal(corrected.positions[key].realizedPnlNative, before.positions[key].realizedPnlNative);
  assert.deepEqual(corrected.accounts, before.accounts);
  assert.deepEqual(corrected.trades, before.trades);
  assert.equal(corrected.calibrations[0].fromSupply, 1_000_000_000);
  assert.equal(corrected.calibrations[0].toSupply, 100_000_000_000);
});

test('price-first rebuy persists a PRICE trade while factual supply correction retains PnL', () => {
  const bought = Engine.executeBuy(
    state(), { token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 2 },
    paperSettings, 1_000
  );
  const key = Engine.positionKey('eth', ethToken.address);
  const factualPrice = {
    chain: 'eth', address: ethToken.address,
    priceUsd: internalUnknownFallbackQuote().priceUsd * 2,
    nativePriceUsd: 2_000,
    observedAt: 2_000, priceObservedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE', syntheticTokenPrice: false, provisional: false,
    paperFallback: false
  };
  const priced = Engine.updatePositionQuote(
    bought.state, ethToken, factualPrice, 2_000
  );
  const rebought = Engine.executeBuy(priced, {
    token: ethToken,
    quote: {
      ...factualPrice,
      observedAt: 3_000,
      priceObservedAt: 3_000,
      nativePriceObservedAt: 3_000
    },
    amountNative: 1
  }, paperSettings, 3_000);
  const rebuy = rebought.trade;

  assert.equal(rebuy.valuationMode, 'PRICE');
  assert.equal(rebuy.priceProvenance, 'OBSERVED_PRICE');
  assert.equal(rebuy.observedPriceUsd, factualPrice.priceUsd);
  assert.equal(rebuy.executionPriceUsd, factualPrice.priceUsd);
  assert.equal(rebuy.marketCapUsd, 0);
  assert.equal(rebuy.supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(rebuy.totalSupply, 1_000_000_000);
  assert.equal(rebuy.marketCapDivisor, 1_000_000_000);
  assert.equal(
    rebuy.provisionalSupplyProvenance,
    'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
  );
  assert.equal(rebought.position.valuationMode, 'MARKET_CAP');
  assert.equal(rebought.position.supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(rebought.position.totalSupply, 1_000_000_000);
  assert.equal(
    rebought.position.provisionalSupplyProvenance,
    'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
  );

  const reloadedAfterBuy = State.normalizeState(
    JSON.parse(JSON.stringify(rebought.state)), paperSettings, { strict: true }
  );
  const sold = Engine.executeSell(reloadedAfterBuy, {
    token: ethToken,
    quote: {
      ...factualPrice,
      observedAt: 4_000,
      priceObservedAt: 4_000,
      nativePriceObservedAt: 4_000
    },
    percent: 25
  }, paperSettings, 4_000);
  assert.equal(sold.trade.valuationMode, 'PRICE');
  assert.equal(sold.trade.marketCapUsd, 0);
  const reloadedAfterSell = State.normalizeState(
    JSON.parse(JSON.stringify(sold.state)), paperSettings, { strict: true }
  );
  const before = structuredClone(reloadedAfterSell);
  const beforeMark = Engine.markPosition(before.positions[key]).valueNative;
  const corrected = Engine.updatePositionQuote(
    reloadedAfterSell, ethToken, exactUnknownFallbackCorrection(5_000), 5_000
  );

  assert.ok(Math.abs(
    Engine.markPosition(corrected.positions[key]).valueNative - beforeMark / 2
  ) <= 1e-12);
  assert.notEqual(corrected.positions[key].quantity, before.positions[key].quantity);
  assert.equal(
    corrected.positions[key].costBasisNative,
    before.positions[key].costBasisNative
  );
  assert.equal(
    corrected.positions[key].realizedPnlNative,
    before.positions[key].realizedPnlNative
  );
  assert.deepEqual(corrected.accounts, before.accounts);
  assert.deepEqual(corrected.trades, before.trades);
  assert.equal(corrected.calibrations[0].fromSupply, 1_000_000_000);
  assert.equal(corrected.calibrations[0].toSupply, 100_000_000_000);
});

test('unknown fallback claims fail closed unless every internal invariant is coherent', () => {
  const malformed = [
    ['arbitrary supply', { totalSupply: 42, marketCapDivisor: 42, provisionalSupply: 42 }],
    ['wrong divisor', { marketCapDivisor: 2_000_000_000 }],
    ['missing provisional supply', { provisionalSupply: 0 }],
    ['incoherent price', { priceUsd: 1 }],
    ['not synthetic', { syntheticTokenPrice: false }],
    ['not provisional', { provisional: false }],
    ['not paper fallback', { paperFallback: false }]
  ];
  for (const [name, overrides] of malformed) {
    assert.throws(
      () => Engine.executeBuy(
        state(),
        { token: ethToken, quote: internalUnknownFallbackQuote(1_000, overrides), amountNative: 1 },
        paperSettings,
        1_000
      ),
      /invalidQuote/,
      name
    );
  }
  const forged = JSON.parse(JSON.stringify(internalUnknownFallbackQuote()));
  assert.throws(
    () => Engine.executeBuy(
      state(), { token: ethToken, quote: forged, amountNative: 1 }, paperSettings, 1_000
    ),
    /invalidQuote/
  );
});

test('Engine and State compatibility registries match canonical launchpad supply dimensions', () => {
  const cases = [
    ['sol', 'Pump.fun', '', 1_000_000_000],
    ['sol', 'Pump.fun', 'Mayhem', 2_000_000_000],
    ['sol', 'Pump.fun', 'mayhem-preview', 1_000_000_000],
    ['bsc', 'Four.meme', '', 1_000_000_000],
    ['bsc', 'Flap', '', 1_000_000_000],
    ['base', 'Zora', '', 1_000_000_000],
    ['base', 'Zora Coins', '', 1_000_000_000],
    ['xlayer', 'DYOR', '', 1_000_000_000],
    ['xlayer', 'Bow', '', 1_000_000_000],
    ['xlayer', 'Bow.fun', '', 1_000_000_000],
    ...['base', 'robinhood'].flatMap((chain) => [
      [chain, 'Bankr', '', 100_000_000_000],
      [chain, 'Bankr.bot', '', 100_000_000_000],
      [chain, 'Banker', '', 100_000_000_000],
      [chain, 'Clanker', '', 100_000_000_000]
    ])
  ];
  const canonicalSupply = global.Tango.Supply;
  try {
    delete global.Tango.Supply;
    for (const [chain, launchpad, launchMode, expected] of cases) {
      const context = { chain, launchpad, launchMode };
      assert.equal(Engine.ruleSupply(context), expected, `Engine ${chain}:${launchpad}:${launchMode}`);
      assert.equal(State.ruleSupply(context), expected, `State ${chain}:${launchpad}:${launchMode}`);
      assert.equal(expected, canonicalSupply.ruleSupply(chain, launchpad, launchMode));
    }
  } finally {
    global.Tango.Supply = canonicalSupply;
  }
});

test('field-level factual observation ages cannot be laundered by a fresh envelope timestamp', () => {
  const now = 1_000 + Tango.QUOTE_STALE_MS + 1;
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const snapshot = structuredClone(initial);
  const stalePrice = {
    chain: 'eth', address: ethToken.address,
    priceUsd: 2, marketCapUsd: 2_000,
    nativePriceUsd: 2_000,
    observedAt: now, priceObservedAt: 1_000, marketCapObservedAt: now,
    nativePriceObservedAt: now,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const staleMarketCap = {
    chain: 'base', address: baseToken.address,
    priceUsd: 0, marketCapUsd: 200_000,
    totalSupply: 100_000_000_000, supplySource: 'GMGN_EXACT',
    nativePriceUsd: 2_000,
    observedAt: now, priceObservedAt: 0, marketCapObservedAt: 1_000,
    nativePriceObservedAt: now,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };

  assert.throws(
    () => Engine.executeBuy(initial, { token: ethToken, quote: stalePrice, amountNative: 1 }, paperSettings, now),
    /staleQuote/
  );
  assert.throws(
    () => Engine.executeBuy(initial, { token: baseToken, quote: staleMarketCap, amountNative: 1 }, paperSettings, now),
    /staleQuote/
  );
  assert.deepEqual(initial, snapshot);
});

test('real engine six-chain matrix keeps quick/detail buys and 25/50/exact-100 sells isolated and finite', () => {
  const addresses = {
    sol: 'So11111111111111111111111111111111111111112',
    eth: '0x1111111111111111111111111111111111111111',
    bsc: '0x2222222222222222222222222222222222222222',
    base: '0x3333333333333333333333333333333333333333',
    robinhood: '0x4444444444444444444444444444444444444444',
    xlayer: '0x5555555555555555555555555555555555555555'
  };
  const nativePrices = { sol: 100, eth: 2_000, bsc: 600, base: 2_000, robinhood: 2_000, xlayer: 50 };
  const initialBalances = Object.fromEntries(global.Tango.Chains.all().map((chain) => [chain.id, 10]));
  const matrixSettings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0,
    chains: Object.fromEntries(global.Tango.Chains.all().map((chain) => [chain.id, { networkFeeNative: 0 }]))
  });

  for (const chain of global.Tango.Chains.all()) {
    const token = {
      chain: chain.id, address: addresses[chain.id], symbol: `${chain.id.toUpperCase()}-PAPER`,
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    };
    const quote = (observedAt) => internalUnknownFallbackQuote(observedAt, {
      chain: chain.id, address: token.address,
      nativePriceUsd: nativePrices[chain.id], observedAt, nativePriceObservedAt: observedAt,
    });
    let current = State.createInitialState({ now: 1, initialBalances });
    current.initialized = true;
    const untouchedAccounts = Object.fromEntries(
      global.Tango.Chains.all().filter((item) => item.id !== chain.id)
        .map((item) => [item.id, structuredClone(current.accounts[item.id])])
    );

    const quick = Engine.executeBuy(current, {
      token, quote: quote(1_000), amountNative: 1, sourceUrl: global.Tango.Chains.trenchUrl(chain.id)
    }, matrixSettings, 1_000);
    const detail = Engine.executeBuy(quick.state, {
      token, quote: quote(2_000), amountNative: 1, sourceUrl: global.Tango.Chains.tokenUrl(chain.id, token.address)
    }, matrixSettings, 2_000);
    const quarter = Engine.executeSell(detail.state, {
      token, quote: quote(3_000), percent: 25
    }, matrixSettings, 3_000);
    const half = Engine.executeSell(quarter.state, {
      token, quote: quote(4_000), percent: 50
    }, matrixSettings, 4_000);
    const persistedRemainder = half.position.quantity;
    const closed = Engine.executeSell(half.state, {
      token, quote: quote(5_000), percent: 100
    }, matrixSettings, 5_000);

    assert.ok(Number.isFinite(quick.position.quantity), chain.id);
    assert.ok(Number.isFinite(detail.position.quantity), chain.id);
    assert.equal(closed.trade.quantity, persistedRemainder, chain.id);
    assert.equal(closed.position, null, chain.id);
    assert.equal(closed.trade.nativeSymbol, chain.nativeSymbol, chain.id);
    assert.ok(closed.state.trades.every((trade) => (
      trade.chain === chain.id
      && trade.tokenAddress === global.Tango.Chains.normalizeAddress(chain.id, token.address)
      && Number.isFinite(trade.quantity)
      && Number.isFinite(trade.realizedPnlNative)
    )), chain.id);
    assert.deepEqual(
      Object.fromEntries(Object.keys(untouchedAccounts).map((id) => [id, closed.state.accounts[id]])),
      untouchedAccounts,
      chain.id
    );
    assert.deepEqual(Object.keys(closed.state.positions), [], chain.id);
  }
});

test('exact launchpad supplies keep zero-fee buy, quarter-sell, and exact-close arithmetic finite', () => {
  const solAddress = 'So11111111111111111111111111111111111111112';
  const cases = [
    ['sol', solAddress, 'Pump.fun', '', 1_000_000_000],
    ['sol', solAddress, 'Pump.fun', 'Mayhem', 2_000_000_000],
    ['bsc', EVM_ADDRESS, 'Four.meme', '', 1_000_000_000],
    ['bsc', EVM_ADDRESS, 'Flap', '', 1_000_000_000],
    ['base', EVM_ADDRESS, 'Zora', '', 1_000_000_000],
    ['xlayer', EVM_ADDRESS, 'DYOR', '', 1_000_000_000],
    ['xlayer', EVM_ADDRESS, 'Bow', '', 1_000_000_000],
    ...['base', 'robinhood'].flatMap((chain) => [
      [chain, EVM_ADDRESS, 'Bankr', '', 100_000_000_000],
      [chain, EVM_ADDRESS, 'Banker', '', 100_000_000_000],
      [chain, EVM_ADDRESS, 'Bankr.bot', '', 100_000_000_000],
      [chain, EVM_ADDRESS, 'Clanker', '', 100_000_000_000]
    ]),
    ['eth', EVM_ADDRESS, '', '', 1_000_000_000]
  ];
  const matrixSettings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: Object.fromEntries(global.Tango.Chains.all().map(({ id }) => [id, {
      networkFeeNative: 0
    }]))
  });
  const amountNative = 1;

  for (const [chain, address, launchpad, launchMode, expectedSupply] of cases) {
    const label = `${chain}:${launchpad || 'unknown'}:${launchMode || 'standard'}`;
    const token = {
      chain, address, launchpad, launchMode, symbol: 'MATRIX',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    };
    const makeQuote = (observedAt) => {
      const fallback = global.Tango.Supply.fallbackValuation({ chain, launchpad, launchMode });
      return {
        ...fallback,
        chain,
        address,
        launchpad,
        launchMode,
        totalSupply: fallback.totalSupply,
        marketCapDivisor: fallback.totalSupply,
        provisionalSupply: fallback.totalSupply,
        nativePriceUsd: 1,
        observedAt,
        nativePriceObservedAt: observedAt,
        source: 'TANGO_FALLBACK',
        valuationMode: 'MARKET_CAP',
        priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
        syntheticTokenPrice: true,
        syntheticNativePrice: true,
        provisional: true,
        paperFallback: true
      };
    };
    const initial = State.createInitialState({ now: 1, initialBalances: { [chain]: 10 } });
    initial.initialized = true;
    const bought = Engine.executeBuy(initial, {
      token, quote: makeQuote(1_000), amountNative
    }, matrixSettings, 1_000);
    const quarter = Engine.executeSell(bought.state, {
      token, quote: makeQuote(2_000), percent: 25
    }, matrixSettings, 2_000);
    const remainder = quarter.position.quantity;
    const closed = Engine.executeSell(quarter.state, {
      token, quote: makeQuote(3_000), percent: 100
    }, matrixSettings, 3_000);

    assert.equal(bought.position.totalSupply, expectedSupply, label);
    assert.equal(
      bought.position.quantity,
      amountNative / (3_200 / expectedSupply),
      label
    );
    assert.ok(Number.isFinite(bought.position.quantity), label);
    assert.equal(closed.trade.quantity, remainder, label);
    for (const result of [bought, quarter, closed]) {
      assert.ok([
        result.trade.quantity,
        result.trade.amountNative,
        result.trade.realizedPnlNative,
        result.trade.realizedPnlUsd,
        result.state.accounts[chain].cashBalanceNative
      ].every(Number.isFinite), label);
    }
    assert.equal(closed.position, null, label);
    assert.equal(closed.state.accounts[chain].cashBalanceNative, 10, label);
  }
});

test('fallback BNB execution has finite quantity and a full close uses the persisted quantity exactly', () => {
  const bscToken = { chain: 'bsc', address: EVM_ADDRESS, symbol: 'BNB-FALLBACK' };
  const bscSettings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { bsc: { networkFeeNative: 0 } }
  });
  const fallback = {
    chain: 'bsc', address: EVM_ADDRESS,
    priceUsd: 3_200 / 1_000_000_000, marketCapUsd: 3_200, totalSupply: 1_000_000_000,
    nativePriceUsd: 600, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_FALLBACK', valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE',
    syntheticTokenPrice: true, provisional: true, paperFallback: true
  };
  const initial = State.createInitialState({ now: 1, initialBalances: { bsc: 10 } });
  initial.initialized = true;
  const buy = Engine.executeBuy(initial, { token: bscToken, quote: fallback, amountNative: 1 }, bscSettings, 1_000);
  const sell = Engine.executeSell(buy.state, {
    token: bscToken, quote: { ...fallback, observedAt: 2_000, nativePriceObservedAt: 2_000 }, percent: 100
  }, bscSettings, 2_000);
  assert.ok(Number.isFinite(buy.position.quantity));
  assert.equal(sell.trade.quantity, buy.position.quantity);
  assert.equal(sell.position, null);
  assert.ok(Number.isFinite(sell.trade.realizedPnlNative));

  const quarter = Engine.executeSell(buy.state, {
    token: bscToken, quote: { ...fallback, observedAt: 2_000, nativePriceObservedAt: 2_000 }, percent: 25
  }, bscSettings, 2_000);
  const half = Engine.executeSell(quarter.state, {
    token: bscToken, quote: { ...fallback, observedAt: 3_000, nativePriceObservedAt: 3_000 }, percent: 50
  }, bscSettings, 3_000);
  const remaining = Engine.executeSell(half.state, {
    token: bscToken, quote: { ...fallback, observedAt: 4_000, nativePriceObservedAt: 4_000 }, percent: 100
  }, bscSettings, 4_000);
  assert.equal(quarter.trade.quantity, buy.position.quantity * 0.25);
  assert.equal(half.trade.quantity, quarter.position.quantity * 0.5);
  assert.equal(remaining.trade.quantity, half.position.quantity);
});

test('unverified caller launchpad metadata cannot select a registry supply rule', () => {
  const unverified = {
    chain: 'base', address: EVM_ADDRESS, symbol: 'CLAIM', launchpad: 'Clanker',
    metadataVerified: false, metadataSource: 'GMGN_TRENCH'
  };
  const result = Engine.executeBuy(state(), {
    token: unverified,
    quote: internalUnknownFallbackQuote(1_000, {
      chain: 'base', address: EVM_ADDRESS,
      launchpad: 'Clanker', nativePriceUsd: 2_000,
    }),
    amountNative: 1
  }, paperSettings, 1_000);

  assert.notEqual(result.position.supplySource, 'LAUNCHPAD_RULE');
  assert.notEqual(result.position.totalSupply, 100_000_000_000);
  assert.equal(result.position.launchpad, '');
});

test('a trustworthy live price changes a fallback position mark without rewriting execution quantity or cost', () => {
  const fallback = {
    priceUsd: 3_200 / 1_000_000_000, marketCapUsd: 3_200, totalSupply: 1_000_000_000,
    nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_FALLBACK', valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE',
    syntheticTokenPrice: true, provisional: true, paperFallback: true
  };
  const bought = Engine.executeBuy(state(), { token: ethToken, quote: fallback, amountNative: 1 }, paperSettings, 1_000);
  const key = Engine.positionKey('eth', ethToken.address);
  const upgraded = Engine.updatePositionQuote(bought.state, ethToken, {
    chain: 'eth', address: ethToken.address, priceUsd: 0.00001, marketCapUsd: 10_000,
    nativePriceUsd: 2_000, observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  }, 2_000);
  assert.equal(upgraded.positions[key].quantity, bought.position.quantity);
  assert.equal(upgraded.positions[key].costBasisNative, bought.position.costBasisNative);
  assert.equal(upgraded.positions[key].lastPriceUsd, 0.00001);
  assert.equal(upgraded.trades[0].quantity, bought.trade.quantity);
});

test('execution rejects a quote explicitly bound to another chain or token address', () => {
  const valid = {
    priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  for (const quote of [
    { ...valid, chain: 'base', address: ethToken.address },
    { ...valid, chain: 'eth', address: '0x2222222222222222222222222222222222222222' }
  ]) {
    assert.throws(
      () => Engine.executeBuy(state(), { token: ethToken, quote, amountNative: 1 }, paperSettings, 1_000),
      /invalidQuote/
    );
  }
});

test('Base market-cap quote uses its exact 100B supply instead of a fixed 1B divisor', () => {
  const initialState = state();
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
    supplySource: 'GMGN_EXACT', nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const result = Engine.executeBuy(initialState, {
    token: baseToken, quote: marketCapQuote, amountNative: 1
  }, paperSettings, 1_000);
  assert.equal(result.trade.observedPriceUsd, 0.000002);
  assert.equal(result.position.totalSupply, 100_000_000_000);
  assert.equal(result.position.marketCapDivisor, 100_000_000_000);
});

test('Base market-cap quotes reject caller supply without explicit trusted provenance', () => {
  const bareBaseToken = { ...baseToken, launchpad: undefined };
  const marketCapOnly = {
    priceUsd: 0, marketCapUsd: 200_000, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const cases = [
    { token: bareBaseToken, quote: { ...marketCapOnly, totalSupply: 100_000_000_000 } },
    { token: { ...bareBaseToken, marketCapDivisor: 100_000_000_000 }, quote: marketCapOnly }
  ];

  for (const item of cases) {
    assert.throws(
      () => Engine.executeBuy(state(), { ...item, amountNative: 1 }, paperSettings, 1_000),
      /invalidQuote/
    );
  }
});

test('unknown caller supply is discarded before ratio and verified Base launchpad resolution', () => {
  const bareBaseToken = { ...baseToken, launchpad: undefined };
  for (const supplySource of [undefined, 'CALLER_UNKNOWN']) {
    const ratio = Engine.executeBuy(state(), {
      token: bareBaseToken,
      quote: {
        priceUsd: 0.000002, marketCapUsd: 200_000, totalSupply: 1, supplySource,
        nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
        source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
      },
      amountNative: 1
    }, paperSettings, 1_000);
    assert.equal(ratio.position.totalSupply, 100_000_000_000);
    assert.equal(ratio.position.supplySource, 'GMGN_RATIO');
    assert.equal(ratio.position.valuationMode, 'PRICE');
  }

  const fallback = Engine.executeBuy(state(), {
    token: baseToken,
    quote: {
      priceUsd: 0, marketCapUsd: 200_000, totalSupply: 1, supplySource: 'CALLER_UNKNOWN',
      nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
    },
    amountNative: 1
  }, paperSettings, 1_000);
  assert.equal(fallback.position.totalSupply, 100_000_000_000);
  assert.equal(fallback.position.supplySource, 'LAUNCHPAD_RULE');
});

test('an incoherent declared GMGN ratio falls through to the verified launchpad rule', () => {
  const result = Engine.executeBuy(state(), {
    token: baseToken,
    quote: {
      priceUsd: 2, marketCapUsd: 200_000,
      totalSupply: 100_000, supplySource: 'GMGN_RATIO',
      priceObservedAt: 2_000, marketCapObservedAt: 1_000,
      priceSource: 'GMGN_NETWORK', marketCapSource: 'GMGN_NETWORK',
      nativePriceUsd: 2_000, observedAt: 2_000, nativePriceObservedAt: 2_000,
      source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
    },
    amountNative: 1
  }, paperSettings, 2_000);

  assert.equal(result.position.totalSupply, 100_000_000_000);
  assert.equal(result.position.supplySource, 'LAUNCHPAD_RULE');
});

test('implicit legacy Pump provenance cannot launder an unrelated caller total supply', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  for (const supplySource of [undefined, 'CALLER_UNKNOWN']) {
    const result = Engine.executeBuy(state(), {
      token: pumpToken,
      quote: {
        priceUsd: 0, marketCapUsd: 4_000, totalSupply: 2_000_000_000, supplySource,
        nativePriceUsd: 100, observedAt: 1_000, nativePriceObservedAt: 1_000,
        source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
      },
      amountNative: 1
    }, paperSettings, 1_000);

    assert.equal(result.trade.observedPriceUsd, 0.000004);
    assert.equal(result.position.totalSupply, 1_000_000_000);
    assert.equal(result.position.supplySource, 'LEGACY_PUMP_RULE');
  }
});

test('new Pump buys reject forged token-level legacy supply provenance', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const unverifiedMarketCapQuote = {
    priceUsd: 0, marketCapUsd: 4_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const forgedTokens = [
    {
      ...pumpToken,
      marketCapDivisor: 1_000_000_000,
      marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
    },
    {
      ...pumpToken,
      totalSupply: 1_000_000_000,
      supplySource: 'LEGACY_PUMP_RULE',
      marketCapDivisor: 1_000_000_000,
      marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
    }
  ];

  for (const forgedToken of forgedTokens) {
    const input = state();
    const snapshot = structuredClone(input);
    assert.throws(() => Engine.executeBuy(input, {
      token: forgedToken, quote: unverifiedMarketCapQuote, amountNative: 1
    }, paperSettings, 1_000), /invalidQuote/);
    assert.deepEqual(input, snapshot);
  }
});

test('explicit rule supply claims require their canonical chain and launch context', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 4_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED', marketCapDivisor: 1_000_000_000
  };
  const invalid = [
    {
      token: baseToken,
      quote: { ...marketCapQuote, totalSupply: 1_000_000_000, supplySource: 'LEGACY_PUMP_RULE' }
    },
    {
      token: pumpToken,
      quote: { ...marketCapQuote, totalSupply: 123, supplySource: 'LEGACY_PUMP_RULE' }
    },
    {
      token: pumpToken,
      quote: {
        ...marketCapQuote, totalSupply: 1_000_000_000, supplySource: 'LEGACY_PUMP_RULE',
        source: 'GMGN_NETWORK'
      }
    },
    {
      token: pumpToken,
      quote: {
        ...marketCapQuote, totalSupply: 1_000_000_000, supplySource: 'LEGACY_PUMP_RULE',
        source: 'GMGN_NETWORK', marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
      }
    },
    {
      token: baseToken,
      quote: { ...marketCapQuote, totalSupply: 1_000_000_000, supplySource: 'LAUNCHPAD_RULE' }
    }
  ];

  for (const item of invalid) {
    const input = state();
    const snapshot = structuredClone(input);
    assert.throws(
      () => Engine.executeBuy(input, { ...item, amountNative: 1 }, paperSettings, 1_000),
      /invalidQuote/
    );
    assert.deepEqual(input, snapshot);
  }

  const legacy = Engine.executeBuy(state(), {
    token: pumpToken,
    quote: {
      ...marketCapQuote, totalSupply: 1_000_000_000, supplySource: 'LEGACY_PUMP_RULE'
    },
    amountNative: 1
  }, paperSettings, 1_000);
  assert.equal(legacy.position.totalSupply, 1_000_000_000);
  assert.equal(legacy.position.supplySource, 'LEGACY_PUMP_RULE');

  const launchpad = Engine.executeBuy(state(), {
    token: baseToken,
    quote: {
      ...marketCapQuote, marketCapUsd: 200_000, nativePriceUsd: 2_000,
      totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE', source: 'GMGN_NETWORK'
    },
    amountNative: 1
  }, paperSettings, 1_000);
  assert.equal(launchpad.position.totalSupply, 100_000_000_000);
  assert.equal(launchpad.position.supplySource, 'LAUNCHPAD_RULE');
});

test('implicit legacy Pump positions ignore unrelated persisted total supply', () => {
  const position = {
    chain: 'sol', tokenAddress: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    quantity: 100_000, costBasisNative: 1,
    averageEntryPriceUsd: 0.000003, averageEntryMarketCap: 3_000,
    lastPriceUsd: 0.000003, lastMarketCapUsd: 3_000, lastNativePriceUsd: 100,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1', totalSupply: 2_000_000_000
  };
  const supplylessQuote = {
    priceUsd: 0, marketCapUsd: 2_000, nativePriceUsd: 100,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP'
  };

  assert.equal(Engine.usesMarketCapValuation(position), true);
  assert.equal(Engine.markPosition(position, supplylessQuote).priceUsd, 0.000002);
});

test('Base market-cap rebuys reuse the position verified exact supply', () => {
  const first = Engine.executeBuy(state(), {
    token: baseToken,
    quote: {
      priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
      supplySource: 'GMGN_EXACT', nativePriceUsd: 2_000,
      observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
    },
    amountNative: 1
  }, paperSettings, 1_000);
  const rebought = Engine.executeBuy(first.state, {
    token: { chain: 'base', address: baseToken.address },
    quote: {
      priceUsd: 0, marketCapUsd: 400_000, nativePriceUsd: 2_000,
      observedAt: 2_000, nativePriceObservedAt: 2_000,
      source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
    },
    amountNative: 1
  }, paperSettings, 2_000);

  assert.equal(rebought.trade.observedPriceUsd, 0.000004);
  assert.equal(rebought.position.totalSupply, 100_000_000_000);
  assert.equal(rebought.position.supplySource, 'GMGN_EXACT');
  assert.equal(rebought.position.valuationMode, 'MARKET_CAP');
});

test('supply-less Base rebuy and sell trades persist the resolved launchpad rule context', () => {
  const fallbackQuote = {
    priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE', nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const bought = Engine.executeBuy(state(), {
    token: baseToken, quote: fallbackQuote, amountNative: 1
  }, paperSettings, 1_000);
  const minimalToken = { chain: 'base', address: baseToken.address };
  const supplylessQuote = {
    priceUsd: 0, marketCapUsd: 300_000, nativePriceUsd: 2_000,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };

  const rebought = Engine.executeBuy(bought.state, {
    token: minimalToken, quote: supplylessQuote, amountNative: 1
  }, paperSettings, 2_000);
  assert.equal(rebought.trade.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(rebought.trade.launchpad, 'Clanker');
  assert.doesNotThrow(() => State.normalizeState(rebought.state, paperSettings, { strict: true }));

  const sold = Engine.executeSell(bought.state, {
    token: minimalToken, quote: supplylessQuote, percent: 50
  }, paperSettings, 2_000);
  assert.equal(sold.trade.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(sold.trade.launchpad, 'Clanker');
  assert.doesNotThrow(() => State.normalizeState(sold.state, paperSettings, { strict: true }));
});

test('nominal token and native prices create an auditable provisional paper fill', () => {
  const initialState = state();
  const syntheticQuote = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const result = Engine.executeBuy(initialState, {
    token: ethToken, quote: syntheticQuote, amountNative: 1
  }, paperSettings, 1_000);
  assert.equal(result.trade.provisional, true);
  assert.equal(result.position.needsCalibration, true);
  assert.equal(result.position.quantity, 1);
});

test('provisional quotes require a concrete calibration dimension', () => {
  assert.throws(
    () => Engine.executeBuy(state(), {
      token: ethToken,
      quote: {
        priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
        source: 'TANGO_SYNTHETIC', provisional: true,
        valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
      },
      amountNative: 1
    }, paperSettings, 1_000),
    /invalidQuote/
  );
});

test('provisional fallback flags require a resolved market-cap supply dimension', () => {
  const initial = state();
  const nakedFallback = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  for (const fallback of [
    { supplyConfidence: 'fallback' },
    { supplySource: 'LAUNCHPAD_RULE' }
  ]) {
    assert.throws(
      () => Engine.executeBuy(initial, {
        token: ethToken, quote: { ...nakedFallback, ...fallback }, amountNative: 1
      }, paperSettings, 1_000),
      /invalidQuote/
    );
  }

  const later = Engine.updatePositionQuote(initial, ethToken, {
    priceUsd: 2, nativePriceUsd: 2_000, observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  }, 2_000);
  assert.equal(later, initial);
  assert.deepEqual(initial.positions, {});
  assert.equal(Engine.portfolioSummary(initial, 'eth').equityNative, initial.accounts.eth.cashBalanceNative);
});

test('naked fallback confidence cannot create PRICE calibration state or change equity on refresh', () => {
  const nakedFallbackPrice = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE', supplyConfidence: 'fallback'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: nakedFallbackPrice, amountNative: 1
  }, paperSettings, 1_000);
  assert.equal(bought.position.needsCalibration, false);
  assert.equal(bought.position.provisional, false);
  assert.equal(bought.position.totalSupply, 0);
  assert.equal(bought.position.supplySource, '');

  const equityBefore = Engine.markPosition(bought.position).valueNative;
  const updated = Engine.updatePositionQuote(bought.state, ethToken, {
    ...nakedFallbackPrice, observedAt: 2_000, nativePriceObservedAt: 2_000
  }, 2_000);
  const key = Engine.positionKey('eth', ethToken.address);
  const position = updated.positions[key];
  assert.equal(position.needsCalibration, false);
  assert.equal(position.provisional, false);
  assert.equal(position.quantity, bought.position.quantity);
  assert.equal(position.costBasisNative, bought.position.costBasisNative);
  assert.equal(Engine.markPosition(position).valueNative, equityBefore);
});

test('supply correction preserves the native mark by adjusting only remaining quantity', () => {
  const provisional = Engine.executeBuy(state(), {
    token: baseToken,
    quote: {
      priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
      supplySource: 'LAUNCHPAD_RULE', supplyConfidence: 'fallback', provisional: true,
      nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
    },
    amountNative: 1
  }, paperSettings, 1_000);
  const calibrated = Engine.updatePositionQuote(provisional.state, baseToken, {
    priceUsd: 0, marketCapUsd: 200_000, totalSupply: 200_000_000_000,
    supplySource: 'GMGN_EXACT', supplyConfidence: 'exact',
    nativePriceUsd: 2_000, observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  }, 2_000);
  const position = calibrated.positions[Engine.positionKey('base', baseToken.address)];
  const beforeMark = Engine.markPosition(provisional.position).valueNative;

  assert.equal(position.quantity, provisional.position.quantity * 2);
  assert.equal(position.costBasisNative, provisional.position.costBasisNative);
  assert.equal(position.averageEntryPriceUsd, provisional.position.averageEntryPriceUsd / 2);
  assert.equal(position.averageEntryMarketCap, provisional.position.averageEntryMarketCap);
  assert.equal(Engine.markPosition(position).valueNative, beforeMark);
  assert.deepEqual(calibrated.trades, provisional.state.trades);
  assert.deepEqual(calibrated.accounts, provisional.state.accounts);
  assert.notEqual(calibrated.calibrations[0].quantityBefore, calibrated.calibrations[0].quantityAfter);
  assert.equal(position.provisional, false);
  assert.equal(position.needsCalibration, false);
  assert.doesNotThrow(() => State.normalizeState(calibrated, paperSettings, { strict: true }));
});

test('late verified Pump Mayhem mode upgrades the mark without changing execution', () => {
  const pumpToken = {
    ...token, address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    launchpad: 'Pump.fun', launchMode: '', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  };
  const standardQuote = {
    priceUsd: 10_000 / 1_000_000_000, marketCapUsd: 10_000,
    totalSupply: 1_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    launchpad: 'Pump.fun', launchMode: '', nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const bought = Engine.executeBuy(state(), {
    token: pumpToken, quote: standardQuote, amountNative: 1
  }, settings, 1_000);
  const key = Engine.positionKey('sol', pumpToken.address);
  const before = bought.position;
  const beforeMark = Engine.markPosition(before);
  const beforeAccount = structuredClone(bought.state.accounts.sol);
  const mayhemToken = { ...pumpToken, launchMode: 'Mayhem' };
  const updated = Engine.updatePositionQuote(bought.state, mayhemToken, {
    ...standardQuote,
    priceUsd: 10_000 / 2_000_000_000,
    totalSupply: 2_000_000_000,
    launchMode: 'Mayhem', observedAt: 2_000, nativePriceObservedAt: 2_000
  }, 2_000);
  const after = updated.positions[key];

  assert.equal(updated.calibrations.length, 1);
  assert.equal(updated.calibrations[0].reason, 'SUPPLY');
  assert.equal(updated.calibrations[0].toPriceUsd, 10_000 / 2_000_000_000);
  assert.notEqual(updated.calibrations[0].quantityBefore, updated.calibrations[0].quantityAfter);
  assert.equal(after.totalSupply, 2_000_000_000);
  assert.equal(after.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(after.launchMode, 'Mayhem');
  assert.equal(after.quantity, before.quantity * 2);
  assert.equal(after.costBasisNative, before.costBasisNative);
  assert.equal(after.realizedPnlNative, before.realizedPnlNative);
  assert.equal(Engine.markPosition(after).valueNative, beforeMark.valueNative);
  assert.deepEqual(updated.accounts.sol, beforeAccount);
  assert.equal(updated.trades.length, bought.state.trades.length);
});

test('native correction neutralizes the provisional native dimension while later price movement remains economic', () => {
  const bought = Engine.executeBuy(state(), {
    token: ethToken,
    quote: {
      priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'TANGO_SYNTHETIC', provisional: true,
      syntheticTokenPrice: true, syntheticNativePrice: true,
      valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
    }, amountNative: 1
  }, paperSettings, 1_000);
  const calibrated = Engine.updatePositionQuote(bought.state, ethToken, {
    priceUsd: 2, marketCapUsd: 2_000_000_000, totalSupply: 1_000_000_000,
    supplySource: 'GMGN_EXACT', nativePriceUsd: 3_000,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  }, 2_000);
  const position = calibrated.positions[Engine.positionKey('eth', ethToken.address)];
  assert.notEqual(position.quantity, bought.position.quantity);
  assert.equal(position.quantity, bought.position.quantity * 3_000);
  assert.equal(position.costBasisNative, 1);
  assert.equal(position.lastPriceUsd, 2);
  assert.equal(Engine.markPosition(position).valueNative, 2);
  assert.equal(calibrated.trades.length, 1);
  assert.deepEqual(calibrated.trades, bought.state.trades);
  assert.equal(calibrated.calibrations.length, 1);
  assert.equal(calibrated.calibrations[0].reason, 'PRICE_AND_NATIVE');
  assert.notEqual(calibrated.calibrations[0].quantityBefore, calibrated.calibrations[0].quantityAfter);
  assert.equal(position.needsCalibration, false);

  const moved = Engine.updatePositionQuote(calibrated, ethToken, {
    priceUsd: 4, marketCapUsd: 4_000_000_000, totalSupply: 1_000_000_000,
    supplySource: 'GMGN_EXACT', nativePriceUsd: 3_000,
    observedAt: 3_000, nativePriceObservedAt: 3_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  }, 3_000);
  const movedPosition = moved.positions[Engine.positionKey('eth', ethToken.address)];
  assert.equal(movedPosition.quantity, position.quantity);
  assert.equal(Engine.markPosition(movedPosition).valueNative, 4);
  assert.equal(moved.calibrations.length, calibrated.calibrations.length);
});

test('a native-only correction is neutral and finite without rewriting history or cash', () => {
  const nativeProvisionalQuote = {
    priceUsd: 2, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', provisional: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: nativeProvisionalQuote, amountNative: 1
  }, paperSettings, 1_000);
  const preservedValueNative = Engine.markPosition(bought.position).valueNative;
  const calibrated = Engine.updatePositionQuote(bought.state, ethToken, {
    ...nativeProvisionalQuote,
    nativePriceUsd: 2_000,
    syntheticNativePrice: false,
    provisional: false,
    observedAt: 2_000,
    nativePriceObservedAt: 2_000
  }, 2_000);
  const position = calibrated.positions[Engine.positionKey('eth', ethToken.address)];

  assert.equal(position.quantity, preservedValueNative * 2_000 / 2);
  assert.equal(Engine.markPosition(position).valueNative, preservedValueNative);
  assert.equal(calibrated.calibrations[0].reason, 'NATIVE');
  assert.notEqual(calibrated.calibrations[0].quantityBefore, calibrated.calibrations[0].quantityAfter);
  assert.deepEqual(calibrated.trades, bought.state.trades);
  assert.deepEqual(calibrated.accounts, bought.state.accounts);
  assert.ok(Object.values(position).filter((value) => typeof value === 'number').every(Number.isFinite));
  assert.doesNotThrow(() => State.normalizeState(calibrated, paperSettings, { strict: true }));
});

test('live marks project neutral supply correction before persisted calibration settles', () => {
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: internalUnknownFallbackQuote(), amountNative: 1
  }, paperSettings, 1_000);
  const snapshot = structuredClone(bought.position);
  const mark = Engine.markPosition(bought.position, exactUnknownFallbackCorrection());
  assert.ok(Math.abs(mark.valueNative - 1) < 1e-12);
  assert.ok(Math.abs(mark.unrealizedPnlNative) < 1e-12);
  assert.deepEqual(bought.position, snapshot);
});

test('current native observations cannot revalue uncalibrated native fallback quantities', () => {
  const bought = Engine.executeBuy(state(), {
    token: ethToken, amountNative: 1,
    quote: {
      priceUsd: 2, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_NETWORK', provisional: true, syntheticNativePrice: true,
      valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
    }
  }, paperSettings, 1_000);
  const mark = Engine.markPosition(bought.position, undefined, 2_000);
  assert.equal(mark.valueNative, 1);
  assert.equal(Engine.portfolioSummary(bought.state, 'eth', 2_000).positionsValueNative, 1);
  assert.equal(Engine.chainUsdSummary(bought.state, 'eth', 2_000).positionsUsd, 2_000);
});

test('live mark after partial sell corrects a smaller supply while preserving actual market movement', () => {
  const fallback = internalUnknownFallbackQuote();
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: fallback, amountNative: 1
  }, paperSettings, 1_000);
  const sold = Engine.executeSell(bought.state, {
    token: ethToken, quote: { ...fallback, observedAt: 1_500, nativePriceObservedAt: 1_500 }, percent: 10
  }, paperSettings, 1_500);
  const factual = exactUnknownFallbackCorrection(2_000, {
    totalSupply: 100_000_000, marketCapDivisor: 100_000_000,
    marketCapUsd: 2_720, priceUsd: 2_720 / 100_000_000
  });
  const position = sold.state.positions[Engine.positionKey('eth', ethToken.address)];
  const snapshot = structuredClone(sold.state);
  const live = Engine.markPosition(position, factual);
  // 90% remaining, then a genuine 15% market-cap decrease: .9 * .85.
  assert.ok(Math.abs(live.valueNative - 0.765) < 1e-12);
  assert.ok(Math.abs(live.unrealizedPnlNative - -0.135) < 1e-12);
  assert.deepEqual(sold.state, snapshot);
  const calibrated = Engine.updatePositionQuote(sold.state, ethToken, factual, 2_000);
  assert.ok(Math.abs(Engine.markPosition(calibrated.positions[Engine.positionKey('eth', ethToken.address)]).valueNative - 0.765) < 1e-12);
  assert.deepEqual(calibrated.trades, sold.state.trades);
  assert.deepEqual(calibrated.accounts, sold.state.accounts);
});

test('public calibratePosition preserves the raw state return contract', () => {
  const syntheticQuote = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: syntheticQuote, amountNative: 1
  }, paperSettings, 1_000);
  const noop = Engine.calibratePosition(bought.state, ethToken, {
    ...syntheticQuote, observedAt: 2_000, nativePriceObservedAt: 2_000
  }, 2_000);
  assert.equal(noop, bought.state);

  const calibrated = Engine.calibratePosition(bought.state, ethToken, {
    priceUsd: 2, nativePriceUsd: 2_000, observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  }, 2_000);
  assert.notEqual(calibrated, bought.state);
  assert.equal(calibrated.calibrations.length, 1);
});

test('dimension calibration stays finite and leaves execution history and cash immutable', () => {
  const syntheticQuote = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: syntheticQuote, amountNative: 1
  }, paperSettings, 1_000);
  const key = Engine.positionKey('eth', ethToken.address);
  const realQuote = (priceUsd, nativePriceUsd) => ({
    priceUsd, nativePriceUsd, observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  });
  const cases = [
    { name: 'zero cost basis', costBasisNative: 0, quote: realQuote(2, 2) },
    { name: 'huge average overflow', costBasisNative: Number.MAX_VALUE, quote: realQuote(2, 2) },
    { name: 'tiny average underflow', costBasisNative: Number.EPSILON, quote: realQuote(Number.EPSILON, Number.EPSILON) },
    { name: 'quantity overflow', costBasisNative: 1, quote: realQuote(Number.EPSILON, Number.MAX_VALUE) },
    { name: 'quantity underflow', costBasisNative: 1, quote: realQuote(Number.MAX_VALUE, Number.EPSILON) }
  ];

  for (const item of cases) {
    const input = structuredClone(bought.state);
    input.positions[key].costBasisNative = item.costBasisNative;
    const snapshot = structuredClone(input);
    const result = Engine.calibratePosition(input, ethToken, item.quote, 2_000);
    assert.equal(result.positions[key].costBasisNative, input.positions[key].costBasisNative, item.name);
    assert.deepEqual(result.trades, input.trades, item.name);
    assert.deepEqual(result.accounts, input.accounts, item.name);
    assert.deepEqual(input, snapshot, item.name);
    assert.equal(
      Object.values(result.positions[key])
        .filter((value) => typeof value === 'number')
        .every(Number.isFinite),
      true,
      item.name
    );
  }

  for (const item of [
    { name: 'market-cap overflow', totalSupply: Number.MAX_VALUE, quote: realQuote(2, 2) },
    {
      name: 'market-cap underflow', totalSupply: Number.EPSILON,
      quote: realQuote(Number.EPSILON, Number.EPSILON), roundUnsafe: true
    }
  ]) {
    const supplied = Engine.executeBuy(state(), {
      token: ethToken,
      quote: {
        ...syntheticQuote, totalSupply: item.totalSupply, supplySource: 'GMGN_EXACT'
      },
      amountNative: 1
    }, paperSettings, 1_000);
    const result = Engine.calibratePosition(supplied.state, ethToken, item.quote, 2_000);
    if (item.roundUnsafe) assert.equal(result, supplied.state, item.name);
    else assert.equal(
      result.positions[key].quantity,
      supplied.position.quantity * item.quote.nativePriceUsd,
      item.name
    );
    assert.equal(result.positions[key].costBasisNative, supplied.position.costBasisNative, item.name);
  }
});

test('calibration rejects a round-unsafe quantity before it can create an uncloseable position', () => {
  const syntheticQuote = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: syntheticQuote, amountNative: 1
  }, paperSettings, 1_000);
  const roundUnsafeQuote = {
    priceUsd: 1, nativePriceUsd: Number.MAX_VALUE / 2,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const calibrated = Engine.calibratePosition(bought.state, ethToken, roundUnsafeQuote, 2_000);

  assert.equal(calibrated, bought.state);
  assert.doesNotThrow(() => State.normalizeState(calibrated, paperSettings, { strict: true }));
  const sold = Engine.executeSell(calibrated, {
    token: ethToken,
    quote: {
      priceUsd: 1, nativePriceUsd: 1, observedAt: 3_000, nativePriceObservedAt: 3_000,
      source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
    },
    percent: 100
  }, paperSettings, 3_000);
  assert.equal(sold.position, null);
});

test('raw execution errors take precedence over stale quotes before preparation', () => {
  const staleQuote = {
    priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const now = 1_000 + Tango.QUOTE_STALE_MS + 1;
  const invalidSettings = { ...paperSettings, slippageBps: -1 };
  const bought = Engine.executeBuy(state(), {
    token: ethToken,
    quote: { ...staleQuote, observedAt: now, nativePriceObservedAt: now },
    amountNative: 1
  }, paperSettings, now);

  assert.throws(() => Engine.executeSell(state(), {
    token: ethToken, quote: staleQuote, percent: 100
  }, paperSettings, now), /noPosition/);
  assert.throws(() => Engine.executeBuy(state(), {
    token: ethToken, quote: staleQuote, amountNative: 0
  }, paperSettings, now), /invalidAmount/);
  assert.throws(() => Engine.executeBuy(state(), {
    token: ethToken, quote: staleQuote, amountNative: 1
  }, invalidSettings, now), /invalidSettings/);
  assert.throws(() => Engine.executeSell(bought.state, {
    token: ethToken, quote: staleQuote, percent: 0
  }, paperSettings, now), /invalidAmount/);
  assert.throws(() => Engine.executeSell(bought.state, {
    token: ethToken, quote: staleQuote, quantity: 0
  }, paperSettings, now), /invalidAmount/);
  assert.throws(() => Engine.executeSell(bought.state, {
    token: ethToken, quote: staleQuote, percent: 50
  }, invalidSettings, now), /invalidSettings/);
});

test('buy and sell reject invalid trade arithmetic while mark refresh keeps execution immutable', () => {
  const syntheticQuote = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: syntheticQuote, amountNative: 1
  }, paperSettings, 1_000);
  const overflowQuote = {
    priceUsd: Number.EPSILON, nativePriceUsd: Number.MAX_VALUE,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const underflowQuote = {
    ...overflowQuote, priceUsd: Number.MAX_VALUE, nativePriceUsd: Number.EPSILON
  };
  const snapshot = structuredClone(bought.state);

  assert.throws(
    () => Engine.executeBuy(bought.state, {
      token: ethToken, quote: overflowQuote, amountNative: 1
    }, paperSettings, 2_000),
    /invalidArithmetic/
  );
  assert.throws(
    () => Engine.executeSell(bought.state, {
      token: ethToken, quote: underflowQuote, percent: 50
    }, paperSettings, 2_000),
    /invalidArithmetic/
  );
  const refreshed = Engine.updatePositionQuote(bought.state, ethToken, overflowQuote, 2_000);
  assert.equal(refreshed.positions[Engine.positionKey('eth', ethToken.address)].quantity, bought.position.quantity);
  assert.equal(refreshed.positions[Engine.positionKey('eth', ethToken.address)].costBasisNative, bought.position.costBasisNative);
  assert.deepEqual(bought.state, snapshot);
});

test('calibration and quote refresh use the injected clock to reject stale observations', () => {
  const syntheticQuote = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: syntheticQuote, amountNative: 1
  }, paperSettings, 1_000);
  const staleQuote = {
    priceUsd: 2, nativePriceUsd: 2_000, observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const now = 2_000 + Tango.QUOTE_STALE_MS + 1;

  const calibration = Engine.calibratePosition(bought.state, ethToken, staleQuote, now);
  assert.equal(calibration, bought.state);
  assert.equal(Engine.updatePositionQuote(bought.state, ethToken, staleQuote, now), bought.state);
});

test('a stronger exact supply neutralizes a provisional legacy supply dimension', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const legacyQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const bought = Engine.executeBuy(state(), {
    token: pumpToken, quote: legacyQuote, amountNative: 1
  }, paperSettings, 1_000);
  const before = Engine.markPosition(bought.position).valueNative;
  const corrected = Engine.updatePositionQuote(bought.state, pumpToken, {
    ...legacyQuote,
    totalSupply: 2_000_000_000,
    supplySource: 'GMGN_EXACT',
    source: 'GMGN_NETWORK',
    observedAt: 2_000,
    nativePriceObservedAt: 2_000
  }, 2_000);
  const position = corrected.positions[Engine.positionKey('sol', pumpToken.address)];

  assert.equal(Engine.markPosition(position).valueNative, before);
  assert.equal(position.quantity, bought.position.quantity * 2);
  assert.equal(corrected.calibrations[0].reason, 'SUPPLY');
  assert.equal(position.totalSupply, 2_000_000_000);
  assert.equal(position.supplySource, 'GMGN_EXACT');
  assert.equal(Object.hasOwn(position, 'marketCapProvenance'), false);
  assert.doesNotThrow(() => State.normalizeState(corrected, paperSettings, { strict: true }));

  const sold = Engine.executeSell(corrected, {
    token: pumpToken,
    quote: {
      ...legacyQuote,
      totalSupply: 2_000_000_000,
      supplySource: 'GMGN_EXACT',
      source: 'GMGN_NETWORK',
      observedAt: 3_000,
      nativePriceObservedAt: 3_000
    },
    percent: 50
  }, paperSettings, 3_000);
  assert.equal(sold.trade.supplySource, 'GMGN_EXACT');
  assert.equal(Object.hasOwn(sold.trade, 'marketCapProvenance'), false);
  assert.equal(Object.hasOwn(sold.position, 'marketCapProvenance'), false);
  assert.doesNotThrow(() => State.normalizeState(sold.state, paperSettings, { strict: true }));
});

test('synthetic Pump PRICE mark upgrades preserve trusted provenance and execution', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const zeroFeeSettings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { sol: { networkFeeNative: 0 } }
  });
  const synthetic = Engine.executeBuy(state(), {
    token: pumpToken,
    quote: {
      priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'TANGO_SYNTHETIC', provisional: true,
      syntheticTokenPrice: true, syntheticNativePrice: true,
      valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
    },
    amountNative: 1
  }, zeroFeeSettings, 1_000);
  const calibrated = Engine.updatePositionQuote(synthetic.state, pumpToken, {
    priceUsd: 0, marketCapUsd: 4_000, nativePriceUsd: 100,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED', marketCapDivisor: 1_000_000_000
  }, 2_000);
  const key = Engine.positionKey('sol', pumpToken.address);
  const position = calibrated.positions[key];

  assert.equal(position.valuationMode, 'PRICE');
  assert.equal(position.lastPriceProvenance, 'MARKET_CAP_RATIO_DERIVED');
  assert.equal(position.supplySource, 'LEGACY_PUMP_RULE');
  assert.equal(position.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.equal(position.quantity, 100);
  assert.equal(Engine.markPosition(position).valueNative, 0.000004);
  assert.notEqual(calibrated.calibrations[0].quantityBefore, calibrated.calibrations[0].quantityAfter);
  assert.equal(position.costBasisNative, synthetic.position.costBasisNative);
  assert.doesNotThrow(() => State.normalizeState(calibrated, zeroFeeSettings, { strict: true }));

  const rebought = Engine.executeBuy(synthetic.state, {
    token: pumpToken,
    quote: {
      priceUsd: 0, marketCapUsd: 4_000, nativePriceUsd: 100,
      observedAt: 2_000, nativePriceObservedAt: 2_000,
      source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP',
      priceProvenance: 'MARKET_CAP_DERIVED', marketCapDivisor: 1_000_000_000
    },
    amountNative: 1
  }, zeroFeeSettings, 2_000);
  assert.equal(rebought.trade.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.doesNotThrow(() => State.normalizeState(rebought.state, zeroFeeSettings, { strict: true }));
});

test('ordinary Pump PRICE refresh, rebuy, and sell persist validated legacy provenance', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_DETAIL'
  };
  const zeroFeeSettings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { sol: { networkFeeNative: 0 } }
  });
  const priceQuote = {
    priceUsd: 2, nativePriceUsd: 100, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const trenchQuote = {
    priceUsd: 0, marketCapUsd: 4_000, nativePriceUsd: 100,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED', marketCapDivisor: 1_000_000_000
  };
  const bought = Engine.executeBuy(state(), {
    token: pumpToken, quote: priceQuote, amountNative: 1
  }, zeroFeeSettings, 1_000);

  const refreshed = Engine.updatePositionQuote(bought.state, pumpToken, trenchQuote, 2_000);
  const key = Engine.positionKey('sol', pumpToken.address);
  assert.equal(refreshed.positions[key].marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.doesNotThrow(() => State.normalizeState(refreshed, zeroFeeSettings, { strict: true }));

  const rebought = Engine.executeBuy(bought.state, {
    token: { chain: 'sol', address: pumpToken.address }, quote: trenchQuote, amountNative: 1
  }, zeroFeeSettings, 2_000);
  assert.equal(rebought.trade.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.equal(rebought.position.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.doesNotThrow(() => State.normalizeState(rebought.state, zeroFeeSettings, { strict: true }));

  const sold = Engine.executeSell(bought.state, {
    token: { chain: 'sol', address: pumpToken.address }, quote: trenchQuote, percent: 50
  }, zeroFeeSettings, 2_000);
  assert.equal(sold.trade.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.equal(sold.position.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.doesNotThrow(() => State.normalizeState(sold.state, zeroFeeSettings, { strict: true }));
});

test('exact supply correction updates marks after a partial sell without rewriting history', () => {
  const fallbackQuote = {
    priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE', supplyConfidence: 'fallback',
    nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const bought = Engine.executeBuy(state(), {
    token: baseToken, quote: fallbackQuote, amountNative: 1
  }, paperSettings, 1_000);
  const sold = Engine.executeSell(bought.state, {
    token: baseToken, quote: { ...fallbackQuote, observedAt: 2_000, nativePriceObservedAt: 2_000 }, percent: 50
  }, paperSettings, 2_000);
  const key = Engine.positionKey('base', baseToken.address);
  const beforePosition = sold.state.positions[key];
  const corrected = Engine.updatePositionQuote(sold.state, baseToken, {
    ...fallbackQuote,
    totalSupply: 200_000_000_000,
    supplySource: 'GMGN_EXACT',
    supplyConfidence: 'exact',
    observedAt: 3_000,
    nativePriceObservedAt: 3_000
  }, 3_000);
  const position = corrected.positions[key];
  assert.equal(Engine.markPosition(position).valueNative, Engine.markPosition(beforePosition).valueNative);
  assert.equal(position.quantity, beforePosition.quantity * 2);
  assert.equal(position.costBasisNative, beforePosition.costBasisNative);
  assert.equal(position.realizedPnlNative, beforePosition.realizedPnlNative);
  assert.deepEqual(corrected.trades, sold.state.trades);
  assert.deepEqual(corrected.accounts, sold.state.accounts);
  assert.notEqual(corrected.calibrations[0].quantityBefore, corrected.calibrations[0].quantityAfter);
  assert.doesNotThrow(() => State.normalizeState(corrected, paperSettings, { strict: true }));
});

test('an exact supply confirmation clears fallback calibration without a neutralizing event', () => {
  const fallbackQuote = {
    priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE', supplyConfidence: 'fallback', provisional: true,
    nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const bought = Engine.executeBuy(state(), {
    token: baseToken, quote: fallbackQuote, amountNative: 1
  }, paperSettings, 1_000);
  const confirmed = Engine.updatePositionQuote(bought.state, baseToken, {
    ...fallbackQuote,
    supplySource: 'GMGN_EXACT',
    supplyConfidence: 'exact',
    provisional: false,
    observedAt: 2_000,
    nativePriceObservedAt: 2_000
  }, 2_000);
  const position = confirmed.positions[Engine.positionKey('base', baseToken.address)];

  assert.equal(position.quantity, bought.position.quantity);
  assert.equal(position.supplySource, 'GMGN_EXACT');
  assert.equal(position.needsCalibration, false);
  assert.equal(position.provisional, false);
  assert.equal(confirmed.calibrations.length, 0);
});

test('a fully closed provisional position is never reopened by a later quote', () => {
  const synthetic = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: synthetic, amountNative: 1
  }, paperSettings, 1_000);
  const closed = Engine.executeSell(bought.state, {
    token: ethToken,
    quote: { ...synthetic, observedAt: 2_000, nativePriceObservedAt: 2_000 },
    percent: 100
  }, paperSettings, 2_000);
  const realQuote = {
    priceUsd: 2, nativePriceUsd: 3_000, observedAt: 3_000, nativePriceObservedAt: 3_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  assert.equal(Engine.updatePositionQuote(closed.state, ethToken, realQuote, 3_000), closed.state);
});

test('position keys preserve Solana case, normalize EVM case, and reject invalid identity', () => {
  const solanaAddress = 'So11111111111111111111111111111111111111112';
  const lowerSolanaAddress = 'so11111111111111111111111111111111111111112';
  assert.notEqual(Engine.positionKey('sol', solanaAddress), Engine.positionKey('sol', lowerSolanaAddress));
  assert.equal(
    Engine.positionKey('eth', '0xA111111111111111111111111111111111111111'),
    'eth:0xa111111111111111111111111111111111111111'
  );
  assert.throws(() => Engine.positionKey('eth', 'bad'), /invalidAddress/);
  assert.throws(() => Engine.positionKey('wat', solanaAddress), /unsupportedChain/);
});

test('buy reduces the requested chain cash and creates a weighted native position', () => {
  const first = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  assert.equal(first.state.accounts.sol.cashBalanceNative, 90);
  assert.equal(first.position.costBasisNative, 10);
  assert.ok(first.position.quantity > 0);
  assert.equal(first.trade.side, 'BUY');
  assert.equal(first.trade.nativeSymbol, 'SOL');

  const secondQuote = { ...quote, priceUsd: 4, marketCapUsd: 4_000_000, observedAt: 2_000 };
  const second = Engine.executeBuy(first.state, { token, quote: secondQuote, amountNative: 10 }, settings, 2_000);
  assert.equal(second.state.accounts.sol.cashBalanceNative, 80);
  assert.equal(second.position.costBasisNative, 20);
  assert.ok(second.position.averageEntryPriceUsd > 2 && second.position.averageEntryPriceUsd < 4.1);
});

test('paper fallback fills record their original quote source and observation times', () => {
  const paperQuote = {
    ...quote,
    source: 'GMGN_LAST_KNOWN',
    observedAt: 2_000,
    nativePriceObservedAt: 2_000,
    originalObservedAt: 1_000,
    nativeOriginalObservedAt: 900,
    paperFallback: true
  };
  const result = Engine.executeBuy(state(), { token, quote: paperQuote, amountNative: 1 }, settings, 2_000);
  assert.equal(result.trade.paperFallback, true);
  assert.equal(result.trade.quoteSource, 'GMGN_LAST_KNOWN');
  assert.equal(result.trade.quoteObservedAtOriginal, 1_000);
  assert.equal(result.trade.nativePriceObservedAtOriginal, 900);
  assert.doesNotThrow(() => State.normalizeState(result.state, settings, { strict: true }));
});

test('BUY replaces future caller provenance with independent safe observation times before persistence', () => {
  const result = Engine.executeBuy(state(), {
    token,
    quote: {
      ...quote,
      source: 'GMGN_NETWORK',
      observedAt: 9_000,
      nativePriceObservedAt: 8_900,
      originalObservedAt: 10_001,
      nativeOriginalObservedAt: 10_002
    },
    amountNative: 1
  }, settings, 10_000);

  assert.equal(result.trade.quoteObservedAtOriginal, 9_000);
  assert.equal(result.trade.nativePriceObservedAtOriginal, 8_900);
  assert.equal(result.position.quoteObservedAt, 9_000);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});

test('BUY replaces malformed caller provenance with independent safe observation times before persistence', () => {
  const result = Engine.executeBuy(state(), {
    token,
    quote: {
      ...quote,
      source: 'GMGN_NETWORK',
      observedAt: 9_000,
      nativePriceObservedAt: 8_900,
      originalObservedAt: Number.NaN,
      nativeOriginalObservedAt: Number.POSITIVE_INFINITY
    },
    amountNative: 1
  }, settings, 10_000);

  assert.equal(result.trade.quoteObservedAtOriginal, 9_000);
  assert.equal(result.trade.nativePriceObservedAtOriginal, 8_900);
  assert.equal(result.position.quoteObservedAt, 9_000);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});

test('repeat BUY omits accepted future-skew provenance instead of retaining an older position timestamp', () => {
  const first = Engine.executeBuy(state(), {
    token,
    quote: { ...quote, observedAt: 9_000, nativePriceObservedAt: 9_000 },
    amountNative: 1
  }, settings, 9_000);
  const result = Engine.executeBuy(first.state, {
    token,
    quote: {
      ...quote,
      source: 'GMGN_NETWORK',
      observedAt: 10_001,
      nativePriceObservedAt: 10_001,
      originalObservedAt: 10_002,
      nativeOriginalObservedAt: 10_002
    },
    amountNative: 1
  }, settings, 10_000);

  assert.equal(Object.hasOwn(result.trade, 'quoteObservedAtOriginal'), false);
  assert.equal(Object.hasOwn(result.trade, 'nativePriceObservedAtOriginal'), false);
  assert.equal(Object.hasOwn(result.position, 'quoteObservedAt'), false);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});

test('SELL replaces future caller provenance with independent safe observation times before persistence', () => {
  const bought = Engine.executeBuy(state(), {
    token, quote: { ...quote, observedAt: 8_000, nativePriceObservedAt: 8_000 }, amountNative: 1
  }, settings, 8_000);
  const result = Engine.executeSell(bought.state, {
    token,
    quote: {
      ...quote,
      source: 'GMGN_NETWORK',
      observedAt: 9_000,
      nativePriceObservedAt: 8_900,
      originalObservedAt: 10_001,
      nativeOriginalObservedAt: 10_002
    },
    percent: 50
  }, settings, 10_000);

  assert.equal(result.trade.quoteObservedAtOriginal, 9_000);
  assert.equal(result.trade.nativePriceObservedAtOriginal, 8_900);
  assert.equal(result.position.quoteObservedAt, 9_000);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});

test('SELL replaces malformed caller provenance with independent safe observation times before persistence', () => {
  const bought = Engine.executeBuy(state(), {
    token, quote: { ...quote, observedAt: 8_000, nativePriceObservedAt: 8_000 }, amountNative: 1
  }, settings, 8_000);
  const result = Engine.executeSell(bought.state, {
    token,
    quote: {
      ...quote,
      source: 'GMGN_NETWORK',
      observedAt: 9_000,
      nativePriceObservedAt: 8_900,
      originalObservedAt: Number.NaN,
      nativeOriginalObservedAt: Number.POSITIVE_INFINITY
    },
    percent: 50
  }, settings, 10_000);

  assert.equal(result.trade.quoteObservedAtOriginal, 9_000);
  assert.equal(result.trade.nativePriceObservedAtOriginal, 8_900);
  assert.equal(result.position.quoteObservedAt, 9_000);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});

test('durable fallback trades preserve an explicit zero original observation time', () => {
  const bought = Engine.executeBuy(state(), {
    token: ethToken,
    quote: internalUnknownFallbackQuote(1_000, { originalObservedAt: 0 }),
    amountNative: 1
  }, paperSettings, 1_000);
  const sold = Engine.executeSell(bought.state, {
    token: ethToken,
    quote: internalUnknownFallbackQuote(2_000, { originalObservedAt: 0 }),
    percent: 100
  }, paperSettings, 2_000);

  assert.equal(bought.trade.quoteObservedAtOriginal, 0);
  assert.equal(sold.trade.quoteObservedAtOriginal, 0);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(sold.state), paperSettings, { strict: true }
  ));
});

test('BUY rejects malformed non-null original observation times before persistence', () => {
  for (const malformed of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => Engine.executeBuy(state(), {
        token: ethToken,
        quote: internalUnknownFallbackQuote(1_000, { originalObservedAt: malformed }),
        amountNative: 1
      }, paperSettings, 1_000),
      /invalidQuote/,
      String(malformed)
    );
  }
});

test('SELL rejects malformed non-null original observation times before persistence', () => {
  const bought = Engine.executeBuy(state(), {
    token: ethToken,
    quote: internalUnknownFallbackQuote(1_000, { originalObservedAt: 0 }),
    amountNative: 1
  }, paperSettings, 1_000);
  for (const malformed of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => Engine.executeSell(bought.state, {
        token: ethToken,
        quote: internalUnknownFallbackQuote(2_000, { originalObservedAt: malformed }),
        percent: 100
      }, paperSettings, 2_000),
      /invalidQuote/,
      String(malformed)
    );
  }
});

test('partial sell preserves native cost basis and realizes native and USD pnl', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  const sellQuote = { ...quote, priceUsd: 4, marketCapUsd: 4_000_000, observedAt: 2_000 };
  const sold = Engine.executeSell(bought.state, { token, quote: sellQuote, percent: 50 }, settings, 2_000);
  const key = Engine.positionKey('sol', token.address);
  assert.ok(sold.state.positions[key]);
  assert.ok(Math.abs(sold.state.positions[key].costBasisNative - 5) < 1e-9);
  assert.ok(sold.trade.realizedPnlNative > 0);
  assert.ok(Math.abs(sold.trade.realizedPnlUsd - sold.trade.realizedPnlNative * sellQuote.nativePriceUsd) < 1e-8);
  assert.equal(sold.trade.side, 'SELL');
});

test('full sell removes a position and updates per-chain daily realized pnl', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  const sold = Engine.executeSell(bought.state, { token, quote: { ...quote, priceUsd: 3, observedAt: 2_000 }, percent: 100 }, settings, 2_000);
  assert.equal(Object.keys(sold.state.positions).length, 0);
  assert.ok(Object.values(sold.state.dailyRealizedByChain.sol).some((value) => value.native !== 0));
});

test('calibrated fractional BSC position closes exactly at 100%', () => {
  const bscToken = { chain: 'bsc', address: EVM_ADDRESS, symbol: 'BNBY' };
  const bscSettings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { bsc: { networkFeeNative: 0 } }
  });
  const freshBscQuote = {
    priceUsd: 2, nativePriceUsd: 600, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: bscToken, quote: freshBscQuote, amountNative: 1
  }, bscSettings, 1_000).state;
  const key = Engine.positionKey('bsc', bscToken.address);
  bought.positions[key].quantity = 123_456_789.12345679;
  bought.positions[key].costBasisNative = 1;

  const sold = Engine.executeSell(bought, {
    token: bscToken,
    quote: { ...freshBscQuote, observedAt: 2_000, nativePriceObservedAt: 2_000 },
    percent: 100
  }, bscSettings, 2_000);

  assert.equal(sold.state.positions[key], undefined);
  assert.equal(sold.trade.quantity, 123_456_789.12345679);
  assert.equal(Number.isFinite(sold.trade.realizedPnlNative), true);
});

test('the same EVM address remains isolated across chain accounts', () => {
  const address = '0x1111111111111111111111111111111111111111';
  let next = State.createInitialState({ now: 1 }); next.initialized = true;
  const chainSettings = State.normalizeSettings({});
  const evmQuote = {
    priceUsd: 2, marketCapUsd: 2_000_000, nativePriceUsd: 2000,
    observedAt: 1000, nativePriceObservedAt: 1000
  };
  next = Engine.executeBuy(next, { token: { chain: 'eth', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 1 }, chainSettings, 1000).state;
  next = Engine.executeBuy(next, { token: { chain: 'base', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 2 }, chainSettings, 1000).state;
  assert.equal(next.accounts.eth.cashBalanceNative, 9);
  assert.equal(next.accounts.base.cashBalanceNative, 8);
  assert.notEqual(next.positions[`eth:${address}`].costBasisNative, next.positions[`base:${address}`].costBasisNative);
});

test('close all only closes orders for the requested chain', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmQuote = {
    priceUsd: 2, marketCapUsd: 2_000_000, nativePriceUsd: 2000,
    observedAt: 1000, nativePriceObservedAt: 1000
  };
  let next = State.createInitialState({ now: 1 }); next.initialized = true;
  next = Engine.executeBuy(next, { token: { chain: 'eth', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 1 }, settings, 1000).state;
  next = Engine.executeBuy(next, { token: { chain: 'bsc', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 1 }, settings, 1000).state;
  const result = Engine.executeCloseAll(next, 'eth', [
    { token: { chain: 'eth', address, symbol: 'AAA' }, quote: { ...evmQuote, observedAt: 2000 } },
    { token: { chain: 'bsc', address, symbol: 'AAA' }, quote: { ...evmQuote, observedAt: 2000 } }
  ], settings, 2000);
  assert.equal(Object.values(result.state.positions).some((position) => position.chain === 'eth'), false);
  assert.equal(Object.values(result.state.positions).some((position) => position.chain === 'bsc'), true);
  assert.equal(result.failures.length, 1);
});

test('verified Solana Pump market-cap quotes can buy and track native pnl without a token price', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const bought = Engine.executeBuy(state(), { token: pumpToken, quote: marketCapQuote, amountNative: 1 }, settings, 1_000);
  assert.equal(bought.position.valuationMode, 'MARKET_CAP');
  assert.equal(bought.trade.valuationMode, 'MARKET_CAP');
  assert.equal(bought.trade.priceProvenance, 'MARKET_CAP_DERIVED');
  assert.equal(bought.trade.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  const doubled = { ...marketCapQuote, marketCapUsd: 6_000, observedAt: 2_000 };
  const mark = Engine.markPosition(bought.position, doubled);
  assert.ok(mark.valueNative > bought.position.costBasisNative * 1.9);
  assert.ok(Engine.executeSell(bought.state, { token: pumpToken, quote: doubled, percent: 100 }, settings, 2_000).trade.realizedPnlNative > 0);
});

test('EVM market-cap-only observations cannot execute through the engine', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmToken = { chain: 'eth', address, symbol: 'AAA' };
  const marketCapOnly = {
    priceUsd: 0,
    marketCapUsd: 2_000_000,
    nativePriceUsd: 2_000,
    observedAt: 1_000,
    source: 'GMGN_NETWORK',
    valuationMode: 'MARKET_CAP',
    marketCapDivisor: 1_000_000_000
  };
  const evmState = State.createInitialState({ now: 1 });
  evmState.initialized = true;
  assert.throws(
    () => Engine.executeBuy(evmState, { token: evmToken, quote: marketCapOnly, amountNative: 1 }, settings, 1_000),
    /invalidQuote/
  );
});

test('untrusted market-cap mode never overrides a real token price', () => {
  const evmAddress = '0x1111111111111111111111111111111111111111';
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const cases = [
    {
      token: { chain: 'eth', address: evmAddress, symbol: 'AAA' },
      quote: { ...quote, marketCapUsd: 9_000_000, valuationMode: 'MARKET_CAP', source: 'GMGN_NETWORK', marketCapDivisor: 1_000_000_000 }
    },
    {
      token: pumpToken,
      quote: { ...quote, marketCapUsd: 9_000_000, valuationMode: 'MARKET_CAP', source: 'GMGN_NETWORK', marketCapDivisor: 1_000_000_000 }
    },
    {
      token: pumpToken,
      quote: { ...quote, marketCapUsd: 9_000_000, valuationMode: 'MARKET_CAP', source: 'GMGN_TRENCH_MC', marketCapDivisor: 1_000_000 }
    }
  ];
  for (const item of cases) {
    const next = State.createInitialState({ now: 1 });
    next.initialized = true;
    const result = Engine.executeBuy(next, { token: item.token, quote: item.quote, amountNative: 1 }, settings, 1_000);
    assert.equal(result.trade.observedPriceUsd, 2);
    assert.equal(result.position.valuationMode, 'PRICE');
  }
});

test('trusted Pump market-cap provenance survives detail metadata across every engine boundary', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const first = Engine.executeBuy(state(), { token: pumpToken, quote: marketCapQuote, amountNative: 1 }, settings, 1_000);
  const enrichedState = Engine.updatePositionMetadata(first.state, {
    ...pumpToken,
    metadataSource: 'GMGN_DETAIL',
    name: 'Pump Detail'
  });
  const key = Engine.positionKey('sol', pumpToken.address);
  const enriched = enrichedState.positions[key];
  const doubled = { ...marketCapQuote, marketCapUsd: 6_000, observedAt: 2_000 };
  assert.equal(enriched.metadataSource, 'GMGN_DETAIL');
  assert.equal(enriched.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.ok(Engine.markPosition(enriched, doubled).valueNative > enriched.costBasisNative * 1.9);

  const updated = Engine.updatePositionQuote(enrichedState, pumpToken, doubled, 2_000);
  assert.equal(updated.positions[key].lastMarketCapUsd, 6_000);
  const rebought = Engine.executeBuy(updated, {
    token: { ...pumpToken, metadataSource: 'GMGN_DETAIL' }, quote: doubled, amountNative: 1
  }, settings, 2_000);
  assert.equal(Number.isFinite(rebought.position.quantity), true);
  assert.ok(rebought.trade.executionPriceUsd > 0);
  const sold = Engine.executeSell(rebought.state, {
    token: { chain: 'sol', address: pumpToken.address }, quote: doubled, percent: 25
  }, settings, 2_000);
  assert.ok(sold.trade.executionPriceUsd > 0);
  assert.equal(sold.trade.priceProvenance, 'MARKET_CAP_DERIVED');
  const closed = Engine.executeCloseAll(sold.state, 'sol', [{
    token: { chain: 'sol', address: pumpToken.address }, quote: doubled
  }], settings, 2_000);
  assert.equal(closed.failures.length, 0);
  assert.equal(closed.trades.length, 1);
});

test('portfolio summary is chain-local', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmQuote = { priceUsd: 2, nativePriceUsd: 2000, observedAt: 1000, nativePriceObservedAt: 1000 };
  let next = state();
  next = Engine.executeBuy(next, { token, quote, amountNative: 10 }, settings, 1000).state;
  next = Engine.executeBuy(next, { token: { chain: 'eth', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 2 }, settings, 1000).state;
  const marked = Engine.updatePositionQuote(next, token, { ...quote, priceUsd: 3, observedAt: 2000 }, 2_000);
  const summary = Engine.portfolioSummary(marked, 'sol');
  assert.equal(summary.positionCount, 1);
  assert.equal(summary.totalTrades, 1);
  assert.ok(summary.equityNative > 100);
});

test('current native price overrides stored marks and keeps native and USD summaries coherent', () => {
  const next = State.createInitialState({ now: 1 });
  next.accounts.eth.cashBalanceNative = 9;
  const position = {
    chain: 'eth', tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    quantity: 1, costBasisNative: 1, lastPriceUsd: 100, lastNativePriceUsd: 100
  };
  next.positions[`eth:${position.tokenAddress}`] = position;

  assert.equal(Engine.markPosition(position, undefined, 200).valueNative, 0.5);
  const native = Engine.portfolioSummary(next, 'eth', 200);
  assert.equal(native.positionsValueNative, 0.5);
  assert.equal(native.equityNative, 9.5);
  assert.equal(native.totalPnlNative, -0.5);
  assert.deepEqual(Engine.chainUsdSummary(next, 'eth', 200), {
    cashUsd: 1_800, positionsUsd: 100, assetsUsd: 1_900, principalUsd: 2_000, pnlUsd: -100
  });
});

test('legacy one-billion ratio inference is limited to coherent Solana Pump positions', () => {
  const ratioPosition = {
    chain: 'eth', tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    averageEntryPriceUsd: 2, averageEntryMarketCap: 2_000_000_000
  };
  assert.equal(Engine.usesMarketCapValuation(ratioPosition), false);
  assert.equal(Engine.usesMarketCapValuation({
    ...ratioPosition,
    chain: 'sol', tokenAddress: '9cfBkPsoQ2NPHYPi7b69bcQG8FKfNc33k2UfRxiPpump',
    valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  }), false);
  assert.equal(Engine.usesMarketCapValuation({
    ...ratioPosition,
    chain: 'sol', tokenAddress: '9cfBkPsoQ2NPHYPi7b69bcQG8FKfNc33k2UfRxiPpump'
  }), true);
});

test('forged persisted market-cap divisor cannot influence a trusted quote', () => {
  const position = {
    chain: 'sol', tokenAddress: '9cfBkPsoQ2NPHYPi7b69bcQG8FKfNc33k2UfRxiPpump',
    quantity: 100, costBasisNative: 1, averageEntryPriceUsd: 2,
    lastPriceUsd: 2, lastNativePriceUsd: 100,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1,
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
  };
  const marketCapQuote = {
    priceUsd: 2, marketCapUsd: 6_000, nativePriceUsd: 100,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  assert.equal(Engine.markPosition(position, marketCapQuote).priceUsd, 2);
});

test('wrong-byte Pump suffix cannot activate defensive market-cap trust', () => {
  const position = {
    chain: 'sol', tokenAddress: '11111111111111111111111111111111pump',
    quantity: 100, costBasisNative: 1, averageEntryPriceUsd: 2,
    lastPriceUsd: 2, lastNativePriceUsd: 100,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
  };
  const marketCapQuote = {
    priceUsd: 2, marketCapUsd: 6_000, nativePriceUsd: 100,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };

  assert.equal(Engine.usesMarketCapValuation(position), false);
  assert.equal(Engine.markPosition(position, marketCapQuote).priceUsd, 2);
});

test('global USD summary excludes native asset appreciation from paper PnL', () => {
  const next = State.createInitialState({ now: 1 });
  next.accounts.sol.cashBalanceNative = 11;
  next.accounts.eth.cashBalanceNative = 8;
  assert.deepEqual(Engine.globalUsdSummary(next, { sol: 150, eth: 2000, bsc: 0, base: 2000, robinhood: 2000, xlayer: 50 }), {
    assetsUsd: 58150, pnlUsd: -3850, complete: false, missingChains: ['bsc']
  });
});

test('chain USD summary values cash and principal at the current native quote but positions at their USD mark', () => {
  const next = State.createInitialState({ now: 1 });
  next.accounts.eth.cashBalanceNative = 9;
  next.positions['eth:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] = {
    chain: 'eth',
    tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    quantity: 1,
    costBasisNative: 1,
    lastPriceUsd: 100,
    lastNativePriceUsd: 100
  };

  assert.deepEqual(Engine.chainUsdSummary(next, 'eth', 200), {
    cashUsd: 1_800,
    positionsUsd: 100,
    assetsUsd: 1_900,
    principalUsd: 2_000,
    pnlUsd: -100
  });
  assert.deepEqual(Engine.globalUsdSummary(next, { eth: 200 }), {
    assetsUsd: 1_900,
    pnlUsd: -100,
    complete: false,
    missingChains: ['sol', 'bsc', 'base', 'robinhood', 'xlayer']
  });
});

test('stale and invalid native quotes are rejected', () => {
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, observedAt: 1 }, amountNative: 1 }, settings, 50_000), /staleQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { priceUsd: 2, nativePriceUsd: 0, observedAt: 1_000 }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
});

test('token and native quote timestamps must be independently valid and fresh', () => {
  const now = 20_000;
  const fresh = { ...quote, observedAt: 5_000, nativePriceObservedAt: 19_999 };
  assert.deepEqual(Engine.validateQuote(fresh, now), { ok: true });

  const missingNative = { ...fresh };
  delete missingNative.nativePriceObservedAt;
  assert.deepEqual(Engine.validateQuote(missingNative, now), { ok: false, reason: 'invalidQuote' });
  for (const nativePriceObservedAt of ['19_999', 19_999.5, 0, -1, NaN, Infinity]) {
    assert.deepEqual(
      Engine.validateQuote({ ...fresh, nativePriceObservedAt }, now),
      { ok: false, reason: 'invalidQuote' }
    );
  }
  assert.deepEqual(
    Engine.validateQuote({ ...fresh, nativePriceObservedAt: now + 5_001 }, now),
    { ok: false, reason: 'invalidQuote' }
  );
  assert.deepEqual(
    Engine.validateQuote({ ...fresh, nativePriceObservedAt: now - 15_001 }, now),
    { ok: false, reason: 'staleQuote' }
  );
});

test('execution rejects invalid identity, non-finite quote data, and unbounded timestamps', () => {
  const badEvm = { chain: 'eth', address: '0x1234' };
  assert.throws(() => Engine.executeBuy(state(), { token: badEvm, quote, amountNative: 1 }, settings, 1_000), /invalidAddress/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, priceUsd: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, nativePriceUsd: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, marketCapUsd: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, observedAt: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), {
    token, quote: { ...quote, observedAt: 1_000 }, staleMs: Infinity, amountNative: 1
  }, settings, 1_000), /invalidQuote/);
});

test('execution rejects non-finite amounts and unsafe fee settings', () => {
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: Infinity }, settings, 1_000), /invalidAmount/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: 1 }, { ...settings, slippageBps: Infinity }, 1_000), /invalidSettings/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: 1 }, { ...settings, platformFeeBps: -1 }, 1_000), /invalidSettings/);
  const badNetworkFee = structuredClone(settings);
  badNetworkFee.chains.sol.networkFeeNative = Infinity;
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: 1 }, badNetworkFee, 1_000), /invalidSettings/);
});

test('round rejects finite inputs whose requested precision would become non-finite', () => {
  assert.throws(() => Engine.round(Number.MAX_VALUE), /invalidArithmetic/);
});

test('ordinary buys reject derived overflow, underflow, zero rounding, and unsafe aggregates without mutation', () => {
  const expectUnchanged = (input, action, name) => {
    const snapshot = structuredClone(input);
    assert.throws(action, /invalidArithmetic/, name);
    assert.deepEqual(input, snapshot, name);
  };
  const extremeQuote = (priceUsd, nativePriceUsd) => ({
    priceUsd, nativePriceUsd, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  });

  let input = state();
  expectUnchanged(input, () => Engine.executeBuy(input, {
    token: ethToken, quote: extremeQuote(Number.EPSILON, Number.MAX_VALUE), amountNative: 1
  }, paperSettings, 1_000), 'quantity overflow');

  input = state();
  expectUnchanged(input, () => Engine.executeBuy(input, {
    token: ethToken, quote: extremeQuote(Number.MAX_VALUE, Number.EPSILON), amountNative: 1
  }, paperSettings, 1_000), 'quantity underflow');

  input = state();
  expectUnchanged(input, () => Engine.executeBuy(input, {
    token: ethToken, quote: extremeQuote(2, 2_000), amountNative: Number.EPSILON
  }, paperSettings, 1_000), 'rounded zero amount');

  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: extremeQuote(2, 2_000), amountNative: 1
  }, paperSettings, 1_000).state;
  const key = Engine.positionKey('eth', ethToken.address);
  bought.positions[key].quantity = Number.MAX_VALUE;
  bought.positions[key].averageEntryPriceUsd = Number.MAX_VALUE;
  expectUnchanged(bought, () => Engine.executeBuy(bought, {
    token: ethToken,
    quote: { ...extremeQuote(2, 2_000), observedAt: 2_000, nativePriceObservedAt: 2_000 },
    amountNative: 1
  }, paperSettings, 2_000), 'weighted average overflow');

  input = state();
  input.accounts.eth.cashBalanceNative = Number.MAX_VALUE;
  expectUnchanged(input, () => Engine.executeBuy(input, {
    token: ethToken, quote: extremeQuote(2, 2_000), amountNative: 1
  }, paperSettings, 1_000), 'cash balance rounding overflow');
});

test('ordinary sells reject derived proceeds and PnL overflow or underflow without mutation', () => {
  const normalQuote = {
    priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: normalQuote, amountNative: 1
  }, paperSettings, 1_000).state;
  const key = Engine.positionKey('eth', ethToken.address);
  const expectUnchanged = (input, quoteOverride, name) => {
    const snapshot = structuredClone(input);
    assert.throws(() => Engine.executeSell(input, {
      token: ethToken,
      quote: {
        ...normalQuote, ...quoteOverride, observedAt: 2_000, nativePriceObservedAt: 2_000
      },
      percent: 50
    }, paperSettings, 2_000), /invalidArithmetic/, name);
    assert.deepEqual(input, snapshot, name);
  };

  expectUnchanged(structuredClone(bought), {
    priceUsd: Number.MAX_VALUE, nativePriceUsd: Number.EPSILON
  }, 'proceeds overflow');
  expectUnchanged(structuredClone(bought), {
    priceUsd: Number.EPSILON, nativePriceUsd: Number.MAX_VALUE
  }, 'proceeds underflow');

  const pnlOverflow = structuredClone(bought);
  pnlOverflow.positions[key].costBasisNative = Number.MAX_VALUE;
  expectUnchanged(pnlOverflow, {}, 'realized USD PnL overflow');

  const costShareUnderflow = structuredClone(bought);
  costShareUnderflow.positions[key].costBasisNative = Number.MIN_VALUE;
  expectUnchanged(costShareUnderflow, {}, 'cost share underflow');

  const accountOverflow = structuredClone(bought);
  accountOverflow.accounts.eth.cashBalanceNative = Number.MAX_VALUE;
  expectUnchanged(accountOverflow, {}, 'cash balance rounding overflow');

  const dailyOverflow = structuredClone(bought);
  dailyOverflow.dailyRealizedByChain.eth['1970-01-01'] = {
    native: Number.MAX_VALUE, usdAtExecution: 0
  };
  expectUnchanged(dailyOverflow, { priceUsd: 4 }, 'daily realized rounding overflow');
});

test('partial sells reject positive cost basis collapse before mutating state', () => {
  const normalQuote = {
    priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const input = Engine.executeBuy(state(), {
    token: ethToken, quote: normalQuote, amountNative: 1
  }, paperSettings, 1_000).state;
  const key = Engine.positionKey('eth', ethToken.address);
  input.positions[key].costBasisNative = Number.MIN_VALUE;
  const snapshot = structuredClone(input);

  assert.throws(() => Engine.executeSell(input, {
    token: ethToken,
    quote: { ...normalQuote, observedAt: 2_000, nativePriceObservedAt: 2_000 },
    percent: 75
  }, paperSettings, 2_000), /invalidArithmetic/);
  assert.deepEqual(input, snapshot);
});

test('execution stores canonical mixed-case EVM identity', () => {
  const address = '0xA111111111111111111111111111111111111111';
  const result = Engine.executeBuy(
    State.createInitialState({ now: 1 }),
    {
      token: { chain: 'ETH', address },
      quote: { priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000 },
      amountNative: 1
    },
    State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } } }),
    1_000
  );
  assert.equal(result.trade.chain, 'eth');
  assert.equal(result.trade.tokenAddress, address.toLowerCase());
  assert.ok(result.state.positions[`eth:${address.toLowerCase()}`]);
});

test('breakeven sell computes a native percentage needed to recover remaining cost', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  const now = Date.now();
  const higherQuote = { ...quote, priceUsd: 4, observedAt: now, nativePriceObservedAt: now };
  const percent = Engine.breakevenSellPercent(bought.position, higherQuote, settings);
  assert.ok(percent > 45 && percent < 60);
  assert.equal(Engine.breakevenSellPercent(bought.position, { ...higherQuote, priceUsd: 0.5 }, settings), null);
});

test('a positive dust remainder retains its cost and keeps portfolio accounting consistent', () => {
  const now = 2000;
  const highQuote = { priceUsd: 1e15, nativePriceUsd: 2000, observedAt: now, nativePriceObservedAt: now };
  const bought = Engine.executeBuy(state(), { token: ethToken, quote: highQuote, amountNative: 1 }, paperSettings, now);
  const sold = Engine.executeSell(bought.state, { token: ethToken, quote: highQuote, quantity: 1e-12 }, paperSettings, now);
  assert.equal(sold.position.quantity, 1e-12);
  assert.equal(sold.position.costBasisNative, 0.5);
  const summary = Engine.portfolioSummary(sold.state, 'eth', 2000);
  assert.equal(summary.totalPnlNative, summary.realizedPnlNative + summary.unrealizedPnlNative);
});

test('close all always uses the full current position even when an order carries a quantity', () => {
  const bought = Engine.executeBuy(state(), { token: ethToken, quote, amountNative: 1 }, paperSettings, 1000);
  const result = Engine.executeCloseAll(bought.state, 'eth', [{ token: ethToken, quote, quantity: 1 }], paperSettings, 1000);
  assert.equal(result.failures.length, 0);
  assert.equal(result.trades[0].quantity, bought.position.quantity);
  assert.equal(result.state.positions[Engine.positionKey('eth', ethToken.address)], undefined);
});

test('USD summaries reject non-finite native prices and do not mark missing chains complete', () => {
  for (const value of [Infinity, -Infinity, NaN]) assert.throws(() => Engine.chainUsdSummary(state(), 'eth', value), /invalidNativePrice/);
  const summary = Engine.globalUsdSummary(state(), { sol: 100, eth: Infinity, bsc: 500, base: 2000, robinhood: 2000, xlayer: 50 });
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.missingChains, ['eth']);
  assert.ok(Number.isFinite(summary.assetsUsd));
  assert.ok(Number.isFinite(summary.pnlUsd));
});

test('USD summaries reject finite native inputs whose valuation overflows', () => {
  const next = State.createInitialState({ now: 1, initialBalances: { eth: 1e15 } });
  assert.throws(() => Engine.chainUsdSummary(next, 'eth', 1e308), /invalidArithmetic/);
  const prices = Object.fromEntries(global.Tango.Chains.all().map((chain) => [chain.id, 1]));
  const summary = Engine.globalUsdSummary(next, { ...prices, eth: 1e308 });
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.missingChains, ['eth']);
  assert.equal(summary.assetsUsd, 50);
  assert.equal(summary.pnlUsd, 0);
});

test('chain USD summary rejects position multiplication and total asset overflow', () => {
  const next = State.createInitialState({ now: 1 });
  next.positions[`eth:${EVM_ADDRESS}`] = {
    chain: 'eth', tokenAddress: EVM_ADDRESS,
    quantity: 1e308, costBasisNative: 1, lastPriceUsd: 2, lastNativePriceUsd: 1
  };
  assert.throws(() => Engine.chainUsdSummary(next, 'eth', 1), /invalidArithmetic/);
  next.positions[`eth:${EVM_ADDRESS}`].lastPriceUsd = 1;
  next.accounts.eth.cashBalanceNative = 1e308;
  assert.throws(() => Engine.chainUsdSummary(next, 'eth', 1), /invalidArithmetic/);
});

test('global USD summary excludes chains that overflow aggregate assets or pnl atomically', () => {
  for (const overflow of ['assets', 'pnl']) {
    const next = State.createInitialState({ now: 1 });
    for (const chain of ['sol', 'eth']) {
      next.accounts[chain].cashBalanceNative = overflow === 'assets' ? 1e308 : 0;
      next.accounts[chain].initialBalanceNative = 1e308;
      assert.ok(Object.values(Engine.chainUsdSummary(next, chain, 1)).every(Number.isFinite));
    }
    const summary = Engine.globalUsdSummary(next, { sol: 1, eth: 1, bsc: 1, base: 1, robinhood: 1, xlayer: 1 });
    assert.equal(summary.complete, false, overflow);
    assert.deepEqual(summary.missingChains, ['eth'], overflow);
    assert.equal(summary.assetsUsd, overflow === 'assets' ? 1e308 : 40, overflow);
    assert.equal(summary.pnlUsd, overflow === 'assets' ? 0 : -1e308, overflow);
    assert.ok(Number.isFinite(summary.assetsUsd) && Number.isFinite(summary.pnlUsd), overflow);
  }
});

test('close all settles every valid position and keeps chain daily pnl consistent', () => {
  const otherToken = { ...token, address: '11111111111111111111111111111113', symbol: 'OTHER' };
  const first = Engine.executeBuy(state(), { token, quote, amountNative: 5 }, settings, 1_000);
  const second = Engine.executeBuy(first.state, { token: otherToken, quote, amountNative: 5 }, settings, 1_100);
  const closeQuote = { ...quote, priceUsd: 3, marketCapUsd: 3_000_000, observedAt: 2_000 };
  const result = Engine.executeCloseAll(second.state, 'sol', [
    { token, quote: closeQuote }, { token: otherToken, quote: closeQuote }
  ], settings, 2_000);
  assert.equal(Object.keys(result.state.positions).length, 0);
  assert.equal(result.trades.length, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(Object.keys(result.state.dailyRealizedByChain.sol).length, 1);
  assert.ok(result.state.accounts.sol.cashBalanceNative > second.state.accounts.sol.cashBalanceNative);
});

test('adding a market-cap trench quote to a price position keeps the original valuation mode', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const first = Engine.executeBuy(state(), { token: pumpToken, quote, amountNative: 1 }, settings, 1_000);
  const listQuote = {
    priceUsd: 0, marketCapUsd: 4_000_000, nativePriceUsd: 100,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const second = Engine.executeBuy(first.state, { token: pumpToken, quote: listQuote, amountNative: 1 }, settings, 2_000);
  assert.equal(second.position.valuationMode, 'PRICE');
  assert.ok(second.position.averageEntryPriceUsd > 2 && second.position.averageEntryPriceUsd < 4.1);
});

test('ratio-derived PRICE positions remain strict-importable across trusted Pump market-cap rebuys', () => {
  const pumpToken = {
    ...token,
    address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const priceBuy = Engine.executeBuy(state(), {
    token: pumpToken,
    quote: { ...quote, source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE' },
    amountNative: 1
  }, settings, 1_000);
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 4_000_000, nativePriceUsd: 100,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };

  const firstRatioBuy = Engine.executeBuy(priceBuy.state, {
    token: pumpToken, quote: marketCapQuote, amountNative: 1
  }, settings, 2_000);
  assert.equal(firstRatioBuy.position.valuationMode, 'PRICE');
  assert.equal(firstRatioBuy.position.lastPriceProvenance, 'MARKET_CAP_RATIO_DERIVED');
  assert.equal(firstRatioBuy.position.marketCapProvenance, undefined);
  assert.doesNotThrow(() => State.normalizeState(firstRatioBuy.state, settings, { strict: true }));

  const secondRatioBuy = Engine.executeBuy(firstRatioBuy.state, {
    token: pumpToken,
    quote: { ...marketCapQuote, marketCapUsd: 6_000_000, observedAt: 3_000, nativePriceObservedAt: 3_000 },
    amountNative: 1
  }, settings, 3_000);
  assert.equal(secondRatioBuy.trade.priceProvenance, 'MARKET_CAP_RATIO_DERIVED');
  assert.equal(secondRatioBuy.position.marketCapProvenance, undefined);
  assert.doesNotThrow(() => State.normalizeState(secondRatioBuy.state, settings, { strict: true }));
});

test('detail metadata replaces a trench placeholder without changing chain balances', () => {
  const placeholder = { ...token, symbol: 'TOKEN', name: 'Token' };
  const bought = Engine.executeBuy(state(), { token: placeholder, quote, amountNative: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const enriched = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'Cogito', name: 'Cogito Token', logoUrl: 'https://example.com/cogito.png',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  assert.equal(enriched.positions[key].symbol, 'Cogito');
  assert.equal(enriched.positions[key].name, 'Cogito Token');
  assert.equal(enriched.positions[key].quantity, bought.state.positions[key].quantity);
  assert.equal(enriched.accounts.sol.cashBalanceNative, bought.state.accounts.sol.cashBalanceNative);
});

test('buying on a detail page cannot change another position logo', () => {
  const trenchToken = { ...token, address: '11111111111111111111111111111114', symbol: 'TRENCH', logoUrl: 'https://example.com/trench.png' };
  const detailToken = { ...token, address: '11111111111111111111111111111115', symbol: 'DETAIL', logoUrl: 'https://example.com/detail.png' };
  const trenchBuy = Engine.executeBuy(state(), { token: trenchToken, quote, amountNative: 1 }, settings, 1_000);
  const detailBuy = Engine.executeBuy(trenchBuy.state, { token: detailToken, quote, amountNative: 1 }, settings, 1_100);
  const detailRebuy = Engine.executeBuy(detailBuy.state, {
    token: { ...detailToken, logoUrl: 'https://example.com/detail-new.png' }, quote, amountNative: 1
  }, settings, 1_200);
  assert.equal(detailRebuy.state.positions[Engine.positionKey('sol', trenchToken.address)].logoUrl, trenchToken.logoUrl);
  assert.equal(detailRebuy.state.positions[Engine.positionKey('sol', detailToken.address)].logoUrl, detailToken.logoUrl);

  const verifiedLogoRefresh = Engine.updatePositionMetadata(detailRebuy.state, {
    ...detailToken, logoUrl: 'https://example.com/detail-new.png', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  const rebuyAfterRefresh = Engine.executeBuy(verifiedLogoRefresh, {
    token: { ...detailToken, logoUrl: '' }, quote, amountNative: 1
  }, settings, 1_300);
  assert.equal(rebuyAfterRefresh.state.positions[Engine.positionKey('sol', trenchToken.address)].logoUrl, trenchToken.logoUrl);
  assert.equal(rebuyAfterRefresh.state.positions[Engine.positionKey('sol', detailToken.address)].logoUrl, 'https://example.com/detail-new.png');
});

test('trading one of several positions cannot replace any existing token identity', () => {
  const tokens = [
    { ...token, address: '11111111111111111111111111111117', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: '11111111111111111111111111111118', symbol: 'BBB', name: 'Beta', logoUrl: 'https://example.com/b.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: '11111111111111111111111111111119', symbol: 'CCC', name: 'Gamma', logoUrl: 'https://example.com/c.png', metadataSource: 'GMGN_TRENCH' }
  ];
  let next = state();
  tokens.forEach((item, index) => {
    next = Engine.executeBuy(next, { token: item, quote: { ...quote, observedAt: 1_000 + index }, amountNative: 1 }, settings, 1_000 + index).state;
  });
  const identitiesBefore = Object.fromEntries(Object.entries(next.positions).map(([key, position]) => [key, {
    symbol: position.symbol, name: position.name, logoUrl: position.logoUrl, metadataSource: position.metadataSource
  }]));
  const staleHeaderForB = {
    ...tokens[1], symbol: tokens[0].symbol, name: tokens[0].name, logoUrl: tokens[0].logoUrl,
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  const afterRebuy = Engine.executeBuy(next, {
    token: staleHeaderForB, quote: { ...quote, observedAt: 2_000 }, amountNative: 1
  }, settings, 2_000).state;
  const identitiesAfter = Object.fromEntries(Object.entries(afterRebuy.positions).map(([key, position]) => [key, {
    symbol: position.symbol, name: position.name, logoUrl: position.logoUrl, metadataSource: position.metadataSource
  }]));
  assert.deepEqual(identitiesAfter, identitiesBefore);
});

test('only verified address-bound metadata can repair a position and GMGN network outranks DOM metadata', () => {
  const trenchToken = { ...token, symbol: 'TOKEN', name: 'Token', logoUrl: '', metadataVerified: true, metadataSource: 'GMGN_TRENCH' };
  const bought = Engine.executeBuy(state(), { token: trenchToken, quote, amountNative: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const ignoredNetwork = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'WRONG', name: 'Wrong', logoUrl: 'https://example.com/wrong.png', metadataVerified: false, metadataSource: 'GMGN_NETWORK'
  });
  assert.equal(ignoredNetwork, bought.state);
  const detail = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'RIGHT', name: 'Right Token', logoUrl: 'https://example.com/right.png', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  assert.equal(detail.positions[key].symbol, 'RIGHT');
  assert.equal(detail.positions[key].logoUrl, 'https://example.com/right.png');
  const staleTrench = Engine.updatePositionMetadata(detail, {
    ...token, symbol: 'STALE', name: 'Stale', logoUrl: 'https://example.com/stale.png', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  });
  assert.equal(staleTrench, detail);
  const network = Engine.updatePositionMetadata(detail, {
    ...token, symbol: 'API', name: 'API Token', logoUrl: 'https://example.com/api.png',
    metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  });
  assert.equal(network.positions[key].symbol, 'API');
  assert.equal(network.positions[key].logoUrl, 'https://example.com/api.png');
  const staleDetail = Engine.updatePositionMetadata(network, {
    ...token, symbol: 'OLD', name: 'Old Detail', logoUrl: 'https://example.com/old.png',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  assert.equal(staleDetail, network);
});

test('an unverified new order cannot seed a borrowed name or logo', () => {
  const borrowed = {
    ...token, address: '11111111111111111111111111111116', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png',
    metadataVerified: false, metadataSource: 'GMGN_NETWORK'
  };
  const bought = Engine.executeBuy(state(), { token: borrowed, quote, amountNative: 1 }, settings, 1_000);
  assert.equal(bought.position.symbol, 'TOKEN');
  assert.equal(bought.position.name, 'TOKEN');
  assert.equal(bought.position.logoUrl, '');
});

test('a repeat buy does not promote the source rank of legacy identity data', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const legacy = structuredClone(bought.state);
  delete legacy.positions[key].metadataSource;
  legacy.positions[key].symbol = '3';
  legacy.positions[key].name = '3';
  const repeated = Engine.executeBuy(legacy, { token, quote: { ...quote, observedAt: 2_000 }, amountNative: 1 }, settings, 2_000);
  assert.equal(repeated.position.symbol, '3');
  assert.equal(repeated.position.metadataSource, '');
});
