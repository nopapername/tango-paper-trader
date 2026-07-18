(function initMarkers(global) {
  const Tango = global.Tango = global.Tango || {};

  function buildPayload({ current, position, trades, labels }) {
    if (!current?.token) return { markers: [] };
    const chain = current.token.chain;
    const address = current.token.address.toLowerCase();
    const currentPrice = Number(current.quote.priceUsd || 0);
    const currentMarketCap = Number(current.quote.marketCapUsd || 0);
    let firstBuy = null;
    const sellTrades = [];

    for (const trade of trades || []) {
      if (trade.chain !== chain || trade.tokenAddress.toLowerCase() !== address || !(Number(trade.marketCapUsd) > 0)) continue;
      if (!firstBuy && trade.side === 'BUY') firstBuy = trade;
      if (trade.side === 'SELL' && sellTrades.length < 4) sellTrades.push(trade);
      if (firstBuy && sellTrades.length === 4) break;
    }

    const priceAtMarketCap = (marketCap, recordedPrice = 0) => Number(recordedPrice) > 0
      ? Number(recordedPrice)
      : currentPrice > 0 && currentMarketCap > 0
        ? currentPrice * Number(marketCap) / currentMarketCap
        : 0;
    const markers = [];
    const entryMarketCap = Number(position?.averageEntryMarketCap || firstBuy?.marketCapUsd || 0);
    if (entryMarketCap > 0) markers.push({
      id: `entry:${address}`, side: 'BUY', marketCap: entryMarketCap,
      price: priceAtMarketCap(entryMarketCap, position?.averageEntryPriceUsd), label: labels.entry, closeLabel: labels.hide
    });
    sellTrades.forEach((trade) => {
      markers.push({
        id: `sell:${trade.id || `${trade.executedAt}:${trade.marketCapUsd}`}`, side: 'SELL', marketCap: Number(trade.marketCapUsd),
        price: priceAtMarketCap(trade.marketCapUsd, trade.observedPriceUsd), label: labels.exit, closeLabel: labels.hide
      });
    });
    return { tokenAddress: address, currentPrice, currentMarketCap, markers };
  }

  Tango.Markers = { buildPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Markers;
})(globalThis);
