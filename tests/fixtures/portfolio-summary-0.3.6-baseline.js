function chainAccount(state, chain) {
  const account = state.accounts?.[chain];
  if (!account) throw new Error('unsupportedChain');
  return account;
}
function localDateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
module.exports = function portfolioSummary(state, chain, currentNativePriceUsd, markPosition) {
    const account = chainAccount(state, chain);
    const positions = Object.values(state.positions || {}).filter((position) => position.chain === chain);
    const trades = (state.trades || []).filter((trade) => trade.chain === chain);
    const marks = positions.map((position) => markPosition(position, undefined, currentNativePriceUsd));
    const positionsValueNative = marks.reduce((sum, mark) => sum + mark.valueNative, 0);
    const unrealizedPnlNative = marks.reduce((sum, mark) => sum + mark.unrealizedPnlNative, 0);
    const equityNative = Number(account.cashBalanceNative) + positionsValueNative;
    const totalPnlNative = equityNative - Number(account.initialBalanceNative);
    const closed = trades.filter((trade) => trade.side === 'SELL');
    const wins = closed.filter((trade) => Number(trade.realizedPnlNative) > 0);
    const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.realizedPnlNative), 0);
    const grossLoss = Math.abs(closed.filter((trade) => Number(trade.realizedPnlNative) < 0).reduce((sum, trade) => sum + Number(trade.realizedPnlNative), 0));
    return {
      cashBalanceNative: Number(account.cashBalanceNative), positionsValueNative, equityNative,
      realizedPnlNative: Number(account.realizedPnlNative || 0), unrealizedPnlNative, totalPnlNative,
      todayPnlNative: Number(state.dailyRealizedByChain?.[chain]?.[localDateKey(Date.now())]?.native || 0),
      positionCount: positions.length, totalTrades: trades.length, closedTrades: closed.length,
      winRate: closed.length ? wins.length / closed.length * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
    };
  };
