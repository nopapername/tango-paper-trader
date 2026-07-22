(function initMarkers(global) {
  const Tango = global.Tango = global.Tango || {};

  function buildPayload({ current, position, trades, labels }) {
    if (!current?.token) return { markers: [] };
    const chainDefinition = Tango.Chains?.get(current.token.chain);
    if (!chainDefinition || !Tango.Chains.validateAddress(chainDefinition.id, current.token.address)) return { markers: [] };
    const chain = chainDefinition.id;
    const address = Tango.Chains.normalizeAddress(chain, current.token.address);
    const nonFactualPrice = (value, explicitProvenance = value?.priceProvenance) => {
      const provenance = String(explicitProvenance || '').toUpperCase();
      return provenance.startsWith('MARKET_CAP')
        || provenance === 'MIXED_DERIVED'
        || provenance === 'SYNTHETIC_PRICE'
        || provenance.startsWith('FALLBACK_')
        || value?.syntheticTokenPrice === true
        || value?.provisionalTokenPrice === true
        || value?.valuationMode === 'MARKET_CAP';
    };
    const currentPrice = nonFactualPrice(current.quote) ? 0 : Number(current.quote.priceUsd || 0);
    const currentMarketCap = Number(current.quote.marketCapUsd || 0);
    let firstBuy = null;
    const sellTrades = [];

    for (const trade of trades || []) {
      if (trade.chain !== chain || !Tango.Chains.validateAddress(chain, trade.tokenAddress)
        || Tango.Chains.normalizeAddress(chain, trade.tokenAddress) !== address
        || !(Number(trade.marketCapUsd) > 0)) continue;
      if (!firstBuy && trade.side === 'BUY') firstBuy = trade;
      if (trade.side === 'SELL' && sellTrades.length < 4) sellTrades.push(trade);
      if (firstBuy && sellTrades.length === 4) break;
    }

    const priceAtMarketCap = (marketCap, recordedPrice = 0, recordedIsDerived = false) => Number(recordedPrice) > 0 && !recordedIsDerived
      ? Number(recordedPrice)
      : currentPrice > 0 && currentMarketCap > 0
        ? currentPrice * Number(marketCap) / currentMarketCap
        : 0;
    const markers = [];
    const entryMarketCap = Number(position?.averageEntryMarketCap || firstBuy?.marketCapUsd || 0);
    if (entryMarketCap > 0) markers.push({
      id: `entry:${chain}:${address}`, side: 'BUY', marketCap: entryMarketCap,
      price: priceAtMarketCap(
        entryMarketCap,
        position?.averageEntryPriceUsd || firstBuy?.observedPriceUsd,
        nonFactualPrice(position, position?.averageEntryPriceProvenance)
          || nonFactualPrice(firstBuy)
      ),
      label: labels.entry, closeLabel: labels.hide
    });
    sellTrades.forEach((trade) => {
      markers.push({
        id: `sell:${chain}:${address}:${trade.id || `${trade.executedAt}:${trade.marketCapUsd}`}`,
        side: 'SELL', marketCap: Number(trade.marketCapUsd),
        price: priceAtMarketCap(trade.marketCapUsd, trade.observedPriceUsd, nonFactualPrice(trade)),
        label: labels.exit, closeLabel: labels.hide
      });
    });
    return { chain, tokenAddress: address, currentPrice, currentMarketCap, markers };
  }

  Tango.Markers = { buildPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Markers;
})(globalThis);
