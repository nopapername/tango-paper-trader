const assert = require('node:assert/strict');
global.Tango = {};
require('../../src/core/chains.js');
require('../../src/core/supply.js');
require('../../src/shared/constants.js');
const State = require('../../src/core/state.js');
const Engine = require('../../src/core/engine.js');
const Coordinator = require('../../src/core/state-coordinator.js');
require('../../src/content/chain-view.js');
const Dashboard = require('../../src/dashboard/model.js');
const settings = State.normalizeSettings({
  slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } }
});
const time = new Date(2026, 6, 18, 12).getTime();
const token = { chain: 'eth', address: '0x1111111111111111111111111111111111111111', symbol: 'CALENDAR' };
const quote = (priceUsd, observedAt) => ({ priceUsd, nativePriceUsd: 2000, observedAt, nativePriceObservedAt: observedAt });
const initial = { ...State.createInitialState({ now: time }), initialized: true };
const bought = Engine.executeBuy(initial, { token, quote: quote(2, time), amountNative: 1 }, settings, time);
const sold = Engine.executeSell(bought.state, { token, quote: quote(4, time + 1000), percent: 100 }, settings, time + 1000);
const before = Dashboard.calendar(sold.state, 'eth', 2026, 6);
const essential = { ...sold.state, trades: [], calibrations: [] };
const compacted = Coordinator.compactStateForStorage(sold.state, settings, { budgetBytes: Coordinator.serializedStateBytes(essential) });
const after = Dashboard.calendar(compacted.state, 'eth', 2026, 6);
const daySum = Object.values(after.days).reduce((sum, day) => sum + day.native, 0);
assert.equal(before.totalNative, 1);
assert.equal(after.totalNative, 0);
assert.equal(daySum, 1);
assert.equal(compacted.state.accounts.eth.realizedPnlNative, 1);
console.log(JSON.stringify({
  case: 'calendar_summary_disagrees_with_preserved_daily_aggregate_after_compaction',
  before: { trades: sold.state.trades.length, monthTotal: before.totalNative, days: before.days },
  after: { trades: compacted.state.trades.length, monthTotal: after.totalNative, daySum, days: after.days, accountRealized: compacted.state.accounts.eth.realizedPnlNative, winRate: after.winRate, removedTradeIds: compacted.removedTradeIds }
}, null, 2));
