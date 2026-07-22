(function initPopupModel(global) {
  const Tango = global.Tango = global.Tango || {};

  function build(state, settings, selectedChain, nativePrices) {
    const chain = Tango.Chains.get(selectedChain) || Tango.Chains.get('sol');
    const nativePriceUsd = Number(nativePrices?.[chain.id] || 0);
    return {
      chain,
      account: state.accounts[chain.id],
      summary: Tango.Engine.portfolioSummary(state, chain.id, nativePriceUsd),
      chainPositions: Tango.ChainView.positions(state, chain.id),
      globalUsd: Tango.Engine.globalUsdSummary(state, nativePrices),
      nativePriceUsd,
      nativeSymbol: chain.nativeSymbol,
      chainOptions: Tango.Chains.all().map(({ id, name, nativeSymbol }) => ({ id, name, nativeSymbol }))
    };
  }

  Tango.PopupModel = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.PopupModel;
})(globalThis);
