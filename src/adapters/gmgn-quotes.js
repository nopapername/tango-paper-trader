(function initGmgnQuotes(global) {
  const Tango = global.Tango = global.Tango || {};
  const ADDRESS_KEYS = ['address', 'token_address', 'tokenAddress', 'mint', 'mint_address', 'contract_address', 'contractAddress', 'ca'];
  const PRICE_KEYS = ['price_usd', 'priceUsd', 'usd_price', 'usdPrice', 'price'];
  const MC_KEYS = ['market_cap', 'marketCap', 'market_cap_usd', 'marketCapUsd', 'mc', 'fdv'];
  const LIQUIDITY_KEYS = ['liquidity_usd', 'liquidityUsd', 'liquidity'];
  const SUPPLY_KEYS = ['total_supply', 'totalSupply', 'supply'];
  const SYMBOL_KEYS = ['symbol', 'token_symbol', 'tokenSymbol', 'ticker'];
  const NAME_KEYS = ['name', 'token_name', 'tokenName'];
  const LOGO_KEYS = ['logo', 'logo_url', 'logoUrl', 'image', 'image_url', 'imageUrl'];
  const LAUNCHPAD_KEYS = ['launchpad', 'launchPad', 'platform'];
  const LAUNCH_MODE_KEYS = ['launch_mode', 'launchMode'];

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

  function newerPositive(previous, next, valueField, timeField, fallbackTime) {
    const previousTime = Number(previous?.[timeField]
      || (Number(previous?.[valueField]) > 0 ? previous?.observedAt : 0) || 0);
    const nextTime = Number(next?.[timeField] || fallbackTime || 0);
    return Number(next?.[valueField]) > 0 && nextTime >= previousTime
      ? { value: Number(next[valueField]), observedAt: nextTime }
      : { value: Number(previous?.[valueField] || 0), observedAt: previousTime };
  }

  function newerText(previous, next, field, fallbackTime, maxLength) {
    const previousTime = Number(previous?.metadataObservedAt || 0);
    const nextTime = Number(next?.metadataObservedAt || fallbackTime || 0);
    const value = metadataText(next?.[field], maxLength);
    return value && nextTime >= previousTime ? value : metadataText(previous?.[field], maxLength);
  }

  function symbolText(value) {
    return metadataText(value, 32).replace(/^\$/, '');
  }

  function mergeObservation(previous, next) {
    if (!next || !Tango.Chains?.get?.(next.chain)
      || !Tango.Chains.validateAddress(next.chain, next.address)) return null;
    const address = Tango.Chains.normalizeAddress(next.chain, next.address);
    if (previous) {
      if (previous.chain !== next.chain || !Tango.Chains.validateAddress(previous.chain, previous.address)
        || Tango.Chains.normalizeAddress(previous.chain, previous.address) !== address) return null;
    }
    const nextObservedAt = Number(next.observedAt || 0);
    const price = newerPositive(previous, next, 'priceUsd', 'priceObservedAt', nextObservedAt);
    const marketCap = newerPositive(previous, next, 'marketCapUsd', 'marketCapObservedAt', nextObservedAt);
    const liquidity = newerPositive(previous, next, 'liquidityUsd', 'liquidityObservedAt', nextObservedAt);
    const totalSupply = newerPositive(previous, next, 'totalSupply', 'totalSupplyObservedAt', nextObservedAt);
    const previousMetadataAt = Number(previous?.metadataObservedAt
      || ((symbolText(previous?.symbol) || metadataText(previous?.name, 100)
        || metadataText(previous?.logoUrl, 1000) || metadataText(previous?.launchpad, 100)
        || metadataText(previous?.launchMode, 100)) ? previous?.observedAt : 0) || 0);
    const nextMetadataAt = Number(next?.metadataObservedAt || nextObservedAt || 0);
    const hasNewMetadata = Boolean(symbolText(next?.symbol) || metadataText(next?.name, 100)
      || metadataText(next?.logoUrl, 1000) || metadataText(next?.launchpad, 100)
      || metadataText(next?.launchMode, 100));
    const metadataObservedAt = hasNewMetadata && nextMetadataAt >= previousMetadataAt
      ? nextMetadataAt : previousMetadataAt;
    const supplyFromNext = Number(next?.totalSupply) > 0
      && Number(next?.totalSupplyObservedAt || nextObservedAt || 0) >= Number(previous?.totalSupplyObservedAt
        || (Number(previous?.totalSupply) > 0 ? previous?.observedAt : 0) || 0);
    return {
      chain: next.chain,
      address,
      priceUsd: price.value,
      marketCapUsd: marketCap.value,
      liquidityUsd: liquidity.value,
      totalSupply: totalSupply.value,
      totalSupplySource: totalSupply.value > 0
        ? (supplyFromNext ? metadataText(next.totalSupplySource, 64) : metadataText(previous?.totalSupplySource, 64)) || 'GMGN_NETWORK_EXACT'
        : '',
      symbol: newerText(previous, next, 'symbol', nextObservedAt, 32).replace(/^\$/, ''),
      name: newerText(previous, next, 'name', nextObservedAt, 100),
      logoUrl: newerText(previous, next, 'logoUrl', nextObservedAt, 1000),
      launchpad: newerText(previous, next, 'launchpad', nextObservedAt, 100),
      launchMode: newerText(previous, next, 'launchMode', nextObservedAt, 100),
      priceObservedAt: price.observedAt,
      marketCapObservedAt: marketCap.observedAt,
      totalSupplyObservedAt: totalSupply.observedAt,
      metadataObservedAt,
      observedAt: price.value > 0 ? price.observedAt : marketCap.observedAt,
      source: 'GMGN_NETWORK'
    };
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
        const totalSupply = numberFrom(firstValue(value, SUPPLY_KEYS));
        const symbol = symbolText(firstValue(value, SYMBOL_KEYS));
        const name = metadataText(firstValue(value, NAME_KEYS), 100);
        const logoUrl = metadataText(firstValue(value, LOGO_KEYS), 1000);
        const launchpad = metadataText(firstValue(value, LAUNCHPAD_KEYS), 100);
        const launchMode = metadataText(firstValue(value, LAUNCH_MODE_KEYS), 100);
        if (priceUsd > 0 || marketCapUsd > 0) {
          const previous = found.get(address) || null;
          found.set(address, mergeObservation(previous, {
            chain: chain.id,
            address,
            priceUsd,
            marketCapUsd,
            liquidityUsd,
            totalSupply,
            totalSupplySource: totalSupply > 0 ? 'GMGN_NETWORK_EXACT' : '',
            symbol,
            name,
            logoUrl,
            launchpad,
            launchMode,
            observedAt,
            priceObservedAt: priceUsd > 0 ? observedAt : 0,
            marketCapObservedAt: marketCapUsd > 0 ? observedAt : 0,
            totalSupplyObservedAt: totalSupply > 0 ? observedAt : 0,
            metadataObservedAt: symbol || name || logoUrl || launchpad || launchMode ? observedAt : 0,
            source: 'GMGN_NETWORK'
          }));
        }
      }
      Object.values(value).slice(0, 300).forEach((item) => {
        if (item && typeof item === 'object') queue.push(item);
      });
    }
    return [...found.values()];
  }

  function extractNativePrices(payload, observedAt) {
    const nativeSymbols = new Set((Tango.Chains?.all?.() || []).map((chain) => chain.nativeSymbol));
    const found = new Map();
    const queue = [payload];
    const seen = new WeakSet();
    let queueIndex = 0;
    let visited = 0;
    while (queueIndex < queue.length && visited < 8000) {
      const value = queue[queueIndex++];
      visited += 1;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (Array.isArray(value)) {
        value.slice(0, 500).forEach((item) => queue.push(item));
        continue;
      }
      const symbol = metadataText(firstValue(value, SYMBOL_KEYS), 32);
      const priceUsd = numberFrom(firstValue(value, PRICE_KEYS));
      if (nativeSymbols.has(symbol) && priceUsd > 0 && !found.has(symbol)) {
        found.set(symbol, { symbol, priceUsd, observedAt, source: 'GMGN_MAJOR_COIN' });
      }
      Object.values(value).slice(0, 300).forEach((item) => {
        if (item && typeof item === 'object') queue.push(item);
      });
    }
    return [...found.values()];
  }

  Tango.GMGNQuotes = { extract, extractNativePrices, mergeObservation };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGNQuotes;
})(globalThis);
