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
      const quoteSource = String(value?.quoteSource || '').trim().toUpperCase();
      const source = String(value?.source || '').trim().toUpperCase();
      const fallbackSources = ['TANGO_FALLBACK', 'TANGO_FALLBACK_CARD_MARKET_CAP'];
      const factualQuoteSource = quoteSource === 'DEXSCREENER'
        || quoteSource === 'GMGN' || quoteSource.startsWith('GMGN_');
      const independentlyFactualPrice = provenance === 'OBSERVED_PRICE' && factualQuoteSource;
      return fallbackSources.includes(quoteSource)
        || (fallbackSources.includes(source) && !independentlyFactualPrice)
        || provenance.startsWith('MARKET_CAP')
        || provenance === 'MIXED_DERIVED'
        || provenance === 'SYNTHETIC_PRICE'
        || provenance.startsWith('FALLBACK_')
        || value?.syntheticTokenPrice === true
        || value?.provisionalTokenPrice === true
        || value?.valuationMode === 'MARKET_CAP';
    };
    const UNKNOWN_FALLBACK_PROVENANCE = 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1';
    const CARD_MARKET_CAP_SOURCE = 'TANGO_FALLBACK_CARD_MARKET_CAP';
    const CARD_MARKET_CAP_VALUATION = 'CARD_MARKET_CAP_FALLBACK_SUPPLY';
    const CARD_MARKET_CAP_OBSERVATION_SOURCES = new Set([
      'GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'
    ]);
    const upper = (value) => String(value || '').trim().toUpperCase();
    const positiveCoordinate = (value) => {
      const number = Number(value || 0);
      return Number.isFinite(number) && number > 0 ? number : 0;
    };

    const usablePrice = (value, explicitPrice, explicitProvenance = value?.priceProvenance) => (
      nonFactualPrice(value, explicitProvenance) ? 0 : positiveCoordinate(explicitPrice)
    );

    const durableUnknownFallbackIdentity = (value) => {
      const expectedSupply = Number(Tango.Supply?.UNKNOWN_TOTAL_SUPPLY || 1_000_000_000);
      return value?.supplySource === 'UNKNOWN_FALLBACK'
        && value?.provisionalSupplyProvenance === UNKNOWN_FALLBACK_PROVENANCE
        && Number(value?.totalSupply) === expectedSupply
        && Number(value?.marketCapDivisor) === expectedSupply
        && Number(value?.provisionalSupply) === expectedSupply;
    };

    const verifiedCardMarketCap = (value, marketCap) => {
      const price = positiveCoordinate(value?.observedPriceUsd);
      const observedAt = Number(value?.quoteObservedAtOriginal || 0);
      const executedAt = Number(value?.executedAt || 0);
      const supply = Number(value?.totalSupply || 0);
      const source = upper(value?.source);
      const marketCapSource = upper(value?.marketCapSource);
      const valuationSource = upper(value?.valuationSource);
      return upper(value?.quoteSource) === CARD_MARKET_CAP_SOURCE
        && (!source || source === CARD_MARKET_CAP_SOURCE)
        && (!marketCapSource || CARD_MARKET_CAP_OBSERVATION_SOURCES.has(marketCapSource))
        && (!valuationSource || valuationSource === CARD_MARKET_CAP_VALUATION)
        && value?.paperFallback === true
        && value?.provisional === true
        && value?.syntheticTokenPrice === true
        && upper(value?.valuationMode) === 'MARKET_CAP'
        && upper(value?.priceProvenance) === 'SYNTHETIC_PRICE'
        && durableUnknownFallbackIdentity(value)
        && Number.isSafeInteger(observedAt) && observedAt > 0
        && Number.isSafeInteger(executedAt) && executedAt > 0
        && observedAt <= executedAt
        && marketCap > 0 && price > 0 && supply > 0
        && Math.abs(marketCap / price - supply) <= supply * 0.001;
    };

    const hasCardMarketCapSignature = (value) => (
      [value?.quoteSource, value?.source, value?.marketCapSource]
        .some((candidate) => upper(candidate) === CARD_MARKET_CAP_SOURCE)
      || upper(value?.valuationSource) === CARD_MARKET_CAP_VALUATION
    );

    const nonFactualMarketCap = (value, explicitMarketCap) => {
      const marketCap = positiveCoordinate(explicitMarketCap);
      if (!marketCap) return false;
      const quoteSource = upper(value?.quoteSource);
      const source = upper(value?.source);
      const marketCapSource = upper(value?.marketCapSource);
      const valuationSource = upper(value?.valuationSource);
      if (hasCardMarketCapSignature(value)) {
        return !verifiedCardMarketCap(value, marketCap);
      }
      if (marketCapSource === 'TANGO_FALLBACK'
        || quoteSource === 'TANGO_FALLBACK'
        || source === 'TANGO_FALLBACK'
        || quoteSource === 'TANGO_POSITION_HISTORY'
        || source === 'TANGO_POSITION_HISTORY'
        || ['UNKNOWN_INITIAL_MARKET_CAP', 'LAUNCHPAD_INITIAL_MARKET_CAP'].includes(valuationSource)) {
        return true;
      }
      const canonical = Number(Tango.Supply?.UNKNOWN_INITIAL_MARKET_CAP_USD || 3_200);
      const price = positiveCoordinate(value?.observedPriceUsd || value?.averageEntryPriceUsd);
      const coherentSynthetic = value?.paperFallback === true
        && value?.provisional === true
        && value?.syntheticTokenPrice === true
        && upper(value?.valuationMode) === 'MARKET_CAP'
        && upper(value?.priceProvenance || value?.averageEntryPriceProvenance) === 'SYNTHETIC_PRICE'
        && price > 0
        && Math.abs(marketCap / price - Number(value?.totalSupply))
          <= Number(value?.totalSupply) * 0.001;
      return durableUnknownFallbackIdentity(value)
        && (marketCap === canonical || coherentSynthetic);
    };

    const usableMarketCap = (value, explicitMarketCap) => (
      nonFactualMarketCap(value, explicitMarketCap) ? 0 : positiveCoordinate(explicitMarketCap)
    );

    const usableCoordinates = (value, {
      price = value?.observedPriceUsd,
      provenance = value?.priceProvenance,
      marketCap = value?.marketCapUsd
    } = {}) => ({
      price: usablePrice(value, price, provenance),
      marketCap: usableMarketCap(value, marketCap)
    });

    const currentPrice = usablePrice(current.quote, current.quote.priceUsd);
    let firstBuy = null;
    const sellTrades = [];
    let matchingTradeSupply = 0;

    const belongsToCurrentToken = (value) => value?.chain === chain
      && Tango.Chains.validateAddress(chain, value.tokenAddress)
      && Tango.Chains.normalizeAddress(chain, value.tokenAddress) === address;
    const verifiedCardEntryAverage = () => {
      if (!belongsToCurrentToken(position)) return 0;
      const history = Array.from(trades || []).reverse()
        .filter(trade => belongsToCurrentToken(trade) && trade.executedAt >= position.openedAt)
        .sort((left, right) => left.executedAt - right.executedAt);
      if (!history.length || history[0].side !== 'BUY'
        || history[0].executedAt !== position.openedAt) return 0;
      let quantity = 0; let cost = 0; let average = 0;
      for (const trade of history) {
        const units = positiveCoordinate(trade.quantity);
        if (!units) return 0;
        if (trade.side === 'BUY') {
          const addedCost = positiveCoordinate(trade.amountNative);
          const marketCap = positiveCoordinate(trade.marketCapUsd);
          if (!addedCost || !verifiedCardMarketCap(trade, marketCap)) return 0;
          average = (cost * average + addedCost * marketCap) / (cost + addedCost);
          cost += addedCost;
          quantity += units;
        } else if (trade.side === 'SELL' && units < quantity) {
          cost *= (quantity - units) / quantity;
          quantity -= units;
        } else return 0;
        if (![quantity, cost, average].every(Number.isFinite)) return 0;
      }
      const matches = (actual, expected) => Number.isFinite(Number(expected))
        && Math.abs(actual - Number(expected)) <= Math.max(1e-12, Math.abs(actual) * 1e-8);
      // Complete independently observed fills must explain both the remaining
      // economics and the stored average. Truncated or mixed history fails closed.
      return matches(quantity, position.quantity) && matches(cost, position.costBasisNative)
        && matches(average, position.averageEntryMarketCap) ? average : 0;
    };
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
      if (!belongsToCurrentToken(trade)) continue;
      matchingTradeSupply ||= knownExecutionSupply(trade);
      const coordinates = usableCoordinates(trade);
      if (!(coordinates.marketCap > 0) && !(coordinates.price > 0)) continue;
      const candidate = { trade, ...coordinates };
      if (!firstBuy && trade.side === 'BUY') firstBuy = candidate;
      if (trade.side === 'SELL' && sellTrades.length < 4) sellTrades.push(candidate);
      if (firstBuy && sellTrades.length === 4 && matchingTradeSupply > 0) break;
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
    const positionEntry = usableCoordinates(position, {
      marketCap: position?.averageEntryMarketCap,
      price: position?.averageEntryPriceUsd,
      provenance: position?.averageEntryPriceProvenance
    });
    const cardEntry = hasCardMarketCapSignature(position);
    const entryMarketCap = cardEntry
      ? verifiedCardEntryAverage()
      : positionEntry.marketCap || firstBuy?.marketCap || 0;
    const entryMarketCapOwner = positionEntry.marketCap > 0 ? position : firstBuy?.trade;
    const directEntryPrice = positionEntry.price || firstBuy?.price || 0;
    const entryPrice = directEntryPrice || priceAtMarketCap(
      entryMarketCap, 0, true,
      knownExecutionSupply(entryMarketCapOwner) || knownSupply
    );
    if (entryMarketCap > 0 || entryPrice > 0) markers.push({
      id: `entry:${chain}:${address}`, side: 'BUY', marketCap: entryMarketCap,
      price: entryPrice,
      label: labels.entry, closeLabel: labels.hide
    });
    sellTrades.forEach(({ trade, marketCap, price: directPrice }) => {
      const price = priceAtMarketCap(
        marketCap, directPrice, false,
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
