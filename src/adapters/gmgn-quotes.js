(function initGmgnQuotes(global) {
  const Tango = global.Tango = global.Tango || {};
  const ADDRESS_KEYS = ['address', 'token_address', 'tokenAddress', 'mint', 'mint_address', 'contract_address', 'contractAddress', 'ca'];
  const PRICE_KEYS = ['price_usd', 'priceUsd', 'usd_price', 'usdPrice', 'price'];
  const MC_KEYS = ['market_cap', 'marketCap', 'market_cap_usd', 'marketCapUsd', 'mc', 'fdv'];
  const LIQUIDITY_KEYS = ['liquidity_usd', 'liquidityUsd', 'liquidity'];
  const SYMBOL_KEYS = ['symbol', 'token_symbol', 'tokenSymbol', 'ticker'];
  const NAME_KEYS = ['name', 'token_name', 'tokenName'];
  const LOGO_KEYS = ['logo', 'logo_url', 'logoUrl', 'image', 'image_url', 'imageUrl'];

  function numberFrom(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value && typeof value === 'object') return numberFrom(value.usd ?? value.value ?? value.amount ?? 0);
    if (typeof value !== 'string') return 0;
    const cleaned = value.replaceAll(',', '').replace(/[^0-9eE.+\-KMBTkmbt]/g, '');
    const match = cleaned.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (!match) return 0;
    let number = Number(match[0]);
    const suffix = cleaned.slice(-1).toUpperCase();
    if (suffix === 'K') number *= 1e3;
    if (suffix === 'M') number *= 1e6;
    if (suffix === 'B') number *= 1e9;
    if (suffix === 'T') number *= 1e12;
    return Number.isFinite(number) ? number : 0;
  }

  function firstValue(object, keys) {
    for (const key of keys) {
      if (object?.[key] != null) return object[key];
    }
    return null;
  }

  function metadataText(value, maxLength) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).trim().slice(0, maxLength);
  }

  function extract(payload, chainId, observedAt) {
    const chain = Tango.Chains?.get?.(chainId);
    if (!chain) return [];
    const found = new Map();
    const queue = [payload];
    const seen = new WeakSet();
    let queueIndex = 0;
    let visited = 0;
    while (queueIndex < queue.length && visited < 8000) {
      const value = queue[queueIndex++];
      visited += 1;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value);
      if (Array.isArray(value)) {
        value.slice(0, 500).forEach((item) => queue.push(item));
        continue;
      }
      const rawAddress = firstValue(value, ADDRESS_KEYS);
      if (Tango.Chains.validateAddress(chain.id, rawAddress)) {
        const address = Tango.Chains.normalizeAddress(chain.id, rawAddress);
        const priceUsd = numberFrom(firstValue(value, PRICE_KEYS));
        const marketCapUsd = numberFrom(firstValue(value, MC_KEYS));
        const liquidityUsd = numberFrom(firstValue(value, LIQUIDITY_KEYS));
        const symbol = metadataText(firstValue(value, SYMBOL_KEYS), 32).replace(/^\$/, '');
        const name = metadataText(firstValue(value, NAME_KEYS), 100);
        const logoUrl = metadataText(firstValue(value, LOGO_KEYS), 1000);
        if (priceUsd > 0 || marketCapUsd > 0) {
          const previous = found.get(address) || {};
          found.set(address, {
            chain: chain.id,
            address,
            priceUsd: priceUsd || previous.priceUsd || 0,
            marketCapUsd: marketCapUsd || previous.marketCapUsd || 0,
            liquidityUsd: liquidityUsd || previous.liquidityUsd || 0,
            symbol: symbol || previous.symbol || '',
            name: name || previous.name || '',
            logoUrl: logoUrl || previous.logoUrl || '',
            observedAt,
            source: 'GMGN_NETWORK'
          });
        }
      }
      Object.values(value).slice(0, 300).forEach((item) => {
        if (item && typeof item === 'object') queue.push(item);
      });
    }
    return [...found.values()];
  }

  Tango.GMGNQuotes = { extract };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGNQuotes;
})(globalThis);
