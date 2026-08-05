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
    let firstBuy = null;
    const sellTrades = [];
    let matchingTradeSupply = 0;

    const belongsToCurrentToken = (value) => value?.chain === chain
      && Tango.Chains.validateAddress(chain, value.tokenAddress)
      && Tango.Chains.normalizeAddress(chain, value.tokenAddress) === address;
    const knownExecutionSupply = (value) => {
      const supply = belongsToCurrentToken(value) ? Number(value.totalSupply) : 0;
      const source = String(value?.supplySource || value?.totalSupplySource || '');
      if (!Number.isFinite(supply) || !(supply > 0) || !Tango.Supply?.isTrustedSource?.(source)) return 0;
      if (source === Tango.Supply?.SOURCES?.RATIO && !Tango.Supply?.ratioSupplyMatches?.({
        ...value, address: value.tokenAddress,
        priceUsd: value.priceUsd || value.observedPriceUsd
      }, supply)) return 0;
      return supply;
    };

    for (const trade of trades || []) {
      if (trade.chain !== chain || !Tango.Chains.validateAddress(chain, trade.tokenAddress)
        || Tango.Chains.normalizeAddress(chain, trade.tokenAddress) !== address) continue;
      matchingTradeSupply ||= knownExecutionSupply(trade);
      const hasMarketCap = Number(trade.marketCapUsd) > 0;
      const hasFactualPrice = Number(trade.observedPriceUsd) > 0 && !nonFactualPrice(trade);
      if (!hasMarketCap && !hasFactualPrice) continue;
      if (!firstBuy && trade.side === 'BUY') firstBuy = trade;
      if (trade.side === 'SELL' && sellTrades.length < 4) sellTrades.push(trade);
    }

    const knownSupply = knownExecutionSupply(position) || matchingTradeSupply;
    const observedCurrentMarketCap = Number(current.quote.marketCapUsd || 0);
    const coherentCurrentRatio = currentPrice > 0 && observedCurrentMarketCap > 0
      && Boolean(Tango.Supply?.coherentRatioObservation?.({
        ...current.quote, chain, address
      }));
    const suppliedCurrentMarketCap = currentPrice > 0 && knownSupply > 0 ? currentPrice * knownSupply : 0;
    const currentMarketCap = coherentCurrentRatio
      ? observedCurrentMarketCap
      : Number.isFinite(suppliedCurrentMarketCap) ? suppliedCurrentMarketCap : 0;
    const priceAtMarketCap = (
      marketCap, recordedPrice = 0, recordedIsDerived = false, executionSupply = 0
    ) => {
      if (Number(recordedPrice) > 0 && !recordedIsDerived) return Number(recordedPrice);
      if (coherentCurrentRatio) {
        return currentPrice * Number(marketCap) / observedCurrentMarketCap;
      }
      if (Number(executionSupply) > 0) return Number(marketCap) / Number(executionSupply);
      return 0;
    };
    const markers = [];
    const entryMarketCap = Number(position?.averageEntryMarketCap || firstBuy?.marketCapUsd || 0);
    const entryPriceCandidates = [
      {
        price: Number(position?.averageEntryPriceUsd || 0),
        derived: nonFactualPrice(position, position?.averageEntryPriceProvenance)
      },
      { price: Number(firstBuy?.observedPriceUsd || 0), derived: nonFactualPrice(firstBuy) }
    ];
    const entryReference = entryPriceCandidates.find((candidate) => candidate.price > 0 && !candidate.derived)
      || entryPriceCandidates.find((candidate) => candidate.price > 0)
      || { price: 0, derived: false };
    const entryPrice = priceAtMarketCap(
      entryMarketCap,
      entryReference.price,
      entryReference.derived,
      knownExecutionSupply(position) || knownExecutionSupply(firstBuy) || knownSupply
    );
    if (entryMarketCap > 0 || entryPrice > 0) markers.push({
      id: `entry:${chain}:${address}`, side: 'BUY', marketCap: entryMarketCap,
      price: entryPrice,
      label: labels.entry, closeLabel: labels.hide
    });
    sellTrades.forEach((trade) => {
      const marketCap = Number(trade.marketCapUsd || 0);
      const price = priceAtMarketCap(
        marketCap, trade.observedPriceUsd, nonFactualPrice(trade),
        knownExecutionSupply(trade) || knownSupply
      );
      if (marketCap > 0 || price > 0) {
        markers.push({
          id: `sell:${chain}:${address}:${trade.id || `${trade.executedAt}:${trade.marketCapUsd}`}`,
          side: 'SELL', marketCap, price,
          label: labels.exit, closeLabel: labels.hide
        });
      }
    });
    return { chain, tokenAddress: address, currentPrice, currentMarketCap, markers };
  }

  Tango.Markers = { buildPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Markers;
})(globalThis);
