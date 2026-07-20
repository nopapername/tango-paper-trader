(function initDashboardModel(global) {
  const Tango = global.Tango = global.Tango || {};

  function dateKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function matchesFilters(trade, filters = {}) {
    const search = String(filters.search || '').trim().toLowerCase();
    const matchesSearch = !search || `${trade.symbol || ''} ${trade.tokenAddress || ''}`.toLowerCase().includes(search);
    const matchesSide = !filters.side || filters.side === 'ALL' || trade.side === filters.side;
    const matchesResult = !filters.result || filters.result === 'ALL'
      || (filters.result === 'WIN' && Number(trade.realizedPnlNative) > 0)
      || (filters.result === 'LOSS' && Number(trade.realizedPnlNative) < 0);
    const matchesDate = !filters.date || dateKey(trade.executedAt) === filters.date;
    return matchesSearch && matchesSide && matchesResult && matchesDate;
  }

  function settingsFor(settings, chainId) {
    return settings?.chainSettings?.[chainId] || settings?.chains?.[chainId] || {};
  }

  function hasDerivedMarketCapPrice(trade) {
    const provenance = String(trade?.priceProvenance || '');
    if (provenance) {
      return provenance.startsWith('MARKET_CAP') || provenance === 'MIXED_DERIVED';
    }
    return trade?.valuationMode === 'MARKET_CAP';
  }

  function build(state, settings, selectedChain, nativePrices = {}, filters = {}) {
    const chain = Tango.Chains.get(selectedChain) || Tango.Chains.get('sol');
    const nativePriceUsd = Number(nativePrices?.[chain.id] || 0);
    const positions = Tango.ChainView.positions(state, chain.id);
    const trades = Tango.ChainView.trades(state, chain.id).filter((trade) => matchesFilters(trade, filters));
    return {
      chain,
      positions,
      trades,
      summary: Tango.Engine.portfolioSummary(state, chain.id, nativePriceUsd),
      globalUsd: Tango.Engine.globalUsdSummary(state, nativePrices),
      nativePriceUsd,
      chainSettings: settingsFor(settings, chain.id),
      accounts: Tango.Chains.all().map((entry) => ({
        chain: entry,
        summary: Tango.Engine.portfolioSummary(state, entry.id, Number(nativePrices?.[entry.id] || 0)),
        nativePriceUsd: Number(nativePrices?.[entry.id] || 0),
        usdSummary: Number(nativePrices?.[entry.id] || 0) > 0
          ? Tango.Engine.chainUsdSummary(state, entry.id, nativePrices[entry.id])
          : null
      }))
    };
  }

  function tradesCsvRows(state, chain) {
    const selected = Tango.Chains.get(chain) || Tango.Chains.get('sol');
    const fields = [
      'executedAt', 'chain', 'nativeSymbol', 'tokenAddress', 'symbol', 'side', 'amountNative',
      'quantity', 'observedPriceUsd', 'executionPriceUsd', 'marketCapUsd', 'nativePriceUsd',
      'slippageBps', 'platformFeeNative', 'networkFeeNative', 'realizedPnlNative',
      'realizedPnlUsd', 'valuationMode', 'priceProvenance', 'sourceUrl'
    ];
    return Tango.ChainView.trades(state, selected.id).map((trade) => {
      const derived = hasDerivedMarketCapPrice(trade);
      return Object.fromEntries(fields.map((field) => [field,
        field === 'executedAt' ? new Date(trade.executedAt).toISOString()
          : derived && (field === 'observedPriceUsd' || field === 'executionPriceUsd') ? ''
            : trade[field]
      ]));
    });
  }

  function calendar(state, chain, year, month) {
    const selected = Tango.Chains.get(chain) || Tango.Chains.get('sol');
    const prefix = `${year}-${String(Number(month) + 1).padStart(2, '0')}-`;
    const days = Object.fromEntries(Object.entries(Tango.ChainView.daily(state, selected.id))
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, {
        native: Number(value?.native ?? value ?? 0),
        usdAtExecution: Number(value?.usdAtExecution || 0)
      }]));
    const trades = Tango.ChainView.trades(state, selected.id).filter((trade) => {
      const date = new Date(trade.executedAt);
      return trade.side === 'SELL' && date.getFullYear() === Number(year) && date.getMonth() === Number(month);
    });
    const realized = trades.map((trade) => Number(trade.realizedPnlNative || 0));
    const wins = realized.filter((value) => value > 0);
    return {
      chain: selected,
      days,
      trades,
      totalNative: realized.reduce((sum, value) => sum + value, 0),
      winRate: trades.length ? wins.length / trades.length * 100 : 0,
      bestNative: realized.length ? Math.max(...realized) : 0,
      worstNative: realized.length ? Math.min(...realized) : 0
    };
  }

  Tango.DashboardModel = { build, matchesFilters, tradesCsvRows, calendar, hasDerivedMarketCapPrice };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.DashboardModel;
})(globalThis);
