/* Read-only audit reproductions. No production code or Chrome storage is changed. */
const assert = require('node:assert/strict');
global.Tango = {};
require('../../src/core/chains.js');
require('../../src/core/supply.js');
require('../../src/shared/constants.js');
const State = require('../../src/core/state.js');
const Engine = require('../../src/core/engine.js');
const Coordinator = require('../../src/core/state-coordinator.js');
const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';
const token = { chain: 'eth', address: ADDRESS_A, symbol: 'AUDIT' };
const settings = State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } } });
const quote = (time, extra = {}) => ({ priceUsd: 2, marketCapUsd: 0, liquidityUsd: 0, nativePriceUsd: 2000, observedAt: time, nativePriceObservedAt: time, ...extra });
const makeState = () => ({ ...State.createInitialState({ now: 1 }), initialized: true });
function memory(state, localSettings = settings, clock = 2000) {
  let stored = { [Tango.STORAGE_KEY]: structuredClone(state), [Tango.SETTINGS_KEY]: structuredClone(localSettings) };
  let writes = 0;
  const coordinator = Coordinator.create({ now: () => clock,
    readRaw: async () => structuredClone(stored),
    writeRaw: async (values) => { writes++; stored = { ...stored, ...structuredClone(values) }; }
  });
  return { coordinator, stored: () => stored, writes: () => writes };
}
function historyTrade(index, extra = {}) {
  return { id: `history-${index}`, chain: 'eth', tokenAddress: ADDRESS_B, side: 'BUY', quantity: 1,
    amountNative: 0.001, observedPriceUsd: 2, executionPriceUsd: 2, marketCapUsd: 0, liquidityUsd: 0,
    nativePriceUsd: 2000, nativeSymbol: 'ETH', slippageBps: 0, platformFeeNative: 0, networkFeeNative: 0,
    realizedPnlNative: 0, realizedPnlUsd: 0, valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE',
    executedAt: 1001 + index, ...extra };
}
function calibration(index) {
  return { id: `calibration-${index}`, chain: 'eth', tokenAddress: ADDRESS_A, reason: 'PRICE',
    fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 2000, toNativePriceUsd: 2000,
    fromSupply: 0, toSupply: 0, quantityBefore: 1, quantityAfter: 1, costBasisNative: 1, createdAt: index };
}
async function check(name, run) {
  try { console.log(JSON.stringify({ case: name, ...(await run()) })); }
  catch (error) { console.log(JSON.stringify({ case: name, unexpectedError: error.message, stack: error.stack })); process.exitCode = 1; }
}
(async () => {
  await check('future_quote_refresh_persistence', async () => {
    const bought = Engine.executeBuy(makeState(), { token, quote: quote(1000), amountNative: 1 }, settings, 1000);
    const futureQuote = quote(2001);
    const validation = Engine.validateQuote(futureQuote, 2000, undefined, bought.position);
    assert.equal(validation.ok, true);
    const direct = Engine.updatePositionQuoteResult(bought.state, token, futureQuote, 2000);
    let strictError = null;
    try { State.normalizeState(direct.state, settings, { strict: true }); } catch (error) { strictError = error.message; }
    const db = memory(bought.state);
    let mutationError = null;
    try { await db.coordinator.mutate({ type: 'UPDATE_POSITION_QUOTE', token, quote: futureQuote }); }
    catch (error) { mutationError = error.message; }
    return { validation, quoteObservedAt: direct.state.positions[`eth:${ADDRESS_A}`].quoteObservedAt,
      updatedAt: direct.state.positions[`eth:${ADDRESS_A}`].updatedAt, strictError, mutationError, writes: db.writes() };
  });

  await check('history_cap_discards_open_fallback_origin', async () => {
    const fallback = Tango.Supply.fallbackValuation({ chain: 'eth' });
    const fallbackQuote = { ...quote(1000), ...fallback, marketCapDivisor: fallback.totalSupply,
      provisionalSupply: fallback.totalSupply, source: 'TANGO_FALLBACK', valuationMode: 'MARKET_CAP',
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP', syntheticTokenPrice: true, provisional: true, paperFallback: true };
    const bought = Engine.executeBuy(makeState(), { token, quote: fallbackQuote, amountNative: 1 }, settings, 1000);
    bought.state.trades = [...Array.from({ length: Tango.MAX_TRADES - 1 }, (_, index) => historyTrade(index)), bought.trade];
    State.normalizeState(bought.state, settings, { strict: true });
    const order = { token: { chain: 'eth', address: ADDRESS_B }, quote: quote(2000), amountNative: 1 };
    const direct = Engine.executeBuy(bought.state, order, settings, 2000);
    const originRetained = direct.state.trades.some((trade) => trade.id === bought.trade.id);
    const db = memory(bought.state);
    let mutationError = null;
    try { await db.coordinator.mutate({ type: 'EXECUTE_BUY', order }); } catch (error) { mutationError = error.message; }
    let sellError = null;
    try { await db.coordinator.mutate({ type: 'EXECUTE_SELL', order: { token, quote: quote(2000), percent: 100 } }); }
    catch (error) { sellError = error.message; }
    return { beforeLength: bought.state.trades.length, afterLength: direct.state.trades.length,
      beforeBytes: Coordinator.serializedStateBytes(bought.state), originRetained, mutationError, sellError, writes: db.writes() };
  });

  await check('lossless_import_discards_over_cap_tail', async () => {
    const imported = makeState();
    imported.trades = Array.from({ length: Tango.MAX_TRADES + 1 }, (_, index) => historyTrade(index));
    imported.calibrations = Array.from({ length: Tango.MAX_TRADES + 1 }, (_, index) => calibration(index));
    const db = memory(makeState());
    const result = await db.coordinator.mutate({ type: 'IMPORT', payload: {
      product: 'Tango Paper Trader', version: Tango.VERSION, exportedAt: 20000, state: imported, settings
    } });
    return { inputTrades: imported.trades.length, outputTrades: result.state.trades.length,
      inputCalibrations: imported.calibrations.length, outputCalibrations: result.state.calibrations.length,
      inputBytes: Coordinator.serializedStateBytes(imported), budgetBytes: Tango.STATE_STORAGE_BUDGET_BYTES,
      lostTrade: imported.trades.at(-1).id, lostCalibration: imported.calibrations.at(-1).id, writes: db.writes() };
  });

  await check('strict_import_skips_validation_of_over_cap_tail', async () => {
    const imported = makeState();
    imported.trades = [...Array.from({ length: Tango.MAX_TRADES }, (_, index) => historyTrade(index)), { id: 'invalid-tail', chain: 'unsupported', quantity: -1 }];
    const db = memory(makeState());
    const result = await db.coordinator.mutate({ type: 'IMPORT', payload: {
      product: 'Tango Paper Trader', version: Tango.VERSION, exportedAt: 20000, state: imported, settings
    } });
    return { inputTrades: imported.trades.length, outputTrades: result.state.trades.length,
      invalidTailSilentlyDiscarded: !result.state.trades.some((entry) => entry.id === 'invalid-tail'), writes: db.writes() };
  });

  await check('settings_accept_unexecutable_full_fee_slippage', async () => {
    const db = memory(makeState());
    const patched = await db.coordinator.mutate({ type: 'PATCH_SETTINGS', patch: { slippageBps: 10000 } });
    let buyError = null;
    try { await db.coordinator.mutate({ type: 'EXECUTE_BUY', order: { token, quote: quote(2000), amountNative: 1 } }); }
    catch (error) { buyError = error.message; }
    return { savedSlippageBps: patched.settings.slippageBps, buyError, writes: db.writes() };
  });

  await check('initialize_principal_is_not_persisted_into_settings', async () => {
    const db = memory(makeState());
    const initialized = await db.coordinator.mutate({ type: 'INITIALIZE', defaultBalanceNative: 30, language: 'en' });
    const reset = await db.coordinator.mutate({ type: 'RESET_ALL' });
    return { initializedPrincipal: initialized.state.accounts.eth.initialBalanceNative,
      savedSettingsPrincipal: initialized.settings.chains.eth.initialBalanceNative,
      afterResetPrincipal: reset.state.accounts.eth.initialBalanceNative };
  });

  await check('sell_drops_positive_dust_cost_without_realizing_it', async () => {
    const bought = Engine.executeBuy(makeState(), { token, quote: quote(1000, { priceUsd: 1e15 }), amountNative: 1 }, settings, 1000);
    const position = bought.state.positions[`eth:${ADDRESS_A}`];
    State.normalizeState(bought.state, settings, { strict: true });
    const sold = Engine.executeSell(bought.state, { token, quote: quote(2000, { priceUsd: 1e15 }), quantity: 1e-12 }, settings, 2000);
    const summary = Engine.portfolioSummary(sold.state, 'eth', 2000);
    return { soldQuantity: sold.trade.quantity, quantityBefore: position.quantity,
      positionDeleted: !sold.position, cash: sold.state.accounts.eth.cashBalanceNative,
      realizedPnl: sold.state.accounts.eth.realizedPnlNative, unrealizedPnl: summary.unrealizedPnlNative,
      totalPnl: summary.totalPnlNative, unexplainedDifference: summary.totalPnlNative - summary.realizedPnlNative - summary.unrealizedPnlNative };
  });

  await check('close_all_quantity_override_prevents_full_close', async () => {
    const bought = Engine.executeBuy(makeState(), { token, quote: quote(1000), amountNative: 1 }, settings, 1000);
    const result = Engine.executeCloseAll(bought.state, 'eth', [{ token, quote: quote(2000), quantity: 100 }], settings, 2000);
    return { quantityBefore: bought.position.quantity, quantitySold: result.trades[0].quantity,
      remainingQuantity: result.state.positions[`eth:${ADDRESS_A}`]?.quantity, failures: result.failures.length };
  });

  await check('nonfinite_readonly_summary_is_accepted', async () => {
    const input = makeState();
    const summary = Engine.globalUsdSummary(input, Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, Infinity])));
    return { complete: summary.complete, finiteAssets: Number.isFinite(summary.assetsUsd),
      finitePnl: Number.isFinite(summary.pnlUsd), assets: String(summary.assetsUsd), pnl: String(summary.pnlUsd) };
  });

  await check('strict_import_accepts_future_position_opening_time', async () => {
    const bought = Engine.executeBuy(makeState(), { token, quote: quote(1000), amountNative: 1 }, settings, 1000);
    bought.state.positions[`eth:${ADDRESS_A}`].openedAt = 9007199254740991;
    const db = memory(makeState());
    const imported = await db.coordinator.mutate({ type: 'IMPORT', payload: {
      product: 'Tango Paper Trader', version: Tango.VERSION, exportedAt: 2000, state: bought.state, settings
    } });
    let sellError = null;
    try { await db.coordinator.mutate({ type: 'EXECUTE_SELL', order: { token, quote: quote(2000), percent: 100 } }); }
    catch (error) { sellError = error.message; }
    return { openedAt: imported.state.positions[`eth:${ADDRESS_A}`].openedAt,
      updatedAt: imported.state.positions[`eth:${ADDRESS_A}`].updatedAt, sellError, writes: db.writes() };
  });
})();
