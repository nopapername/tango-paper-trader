(function initChainView(global) {
  const Tango = global.Tango = global.Tango || {};
  const positions = (state, chain) => Object.values(state?.positions || {})
    .filter((position) => position.chain === chain);
  const trades = (state, chain) => (state?.trades || [])
    .filter((trade) => trade.chain === chain);
  const daily = (state, chain) => state?.dailyRealizedByChain?.[chain] || {};
  const closeOrders = (state, chain, quoteForPosition) => positions(state, chain).flatMap((position) => {
    const quote = quoteForPosition(position);
    if (!quote) return [];
    return [{ token: { chain, address: position.tokenAddress, symbol: position.symbol }, quote }];
  });

  Tango.ChainView = { positions, trades, daily, closeOrders };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.ChainView;
})(globalThis);
