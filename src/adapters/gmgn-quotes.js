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
  const MAX_FUTURE_SKEW_MS = 5_000;

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

  function validObservationTime(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      && value - Date.now() <= MAX_FUTURE_SKEW_MS;
  }

  function newerPositive(previous, next, valueField, timeField, sourceField, fallbackTime) {
    const previousValue = Number(previous?.[valueField] || 0);
    const nextValue = Number(next?.[valueField] || 0);
    const previousTimeValue = previous?.[timeField]
      || (Number.isFinite(previousValue) && previousValue > 0 ? previous?.observedAt : 0) || 0;
    const nextTimeValue = next?.[timeField] || fallbackTime || 0;
    const previousValid = Number.isFinite(previousValue) && previousValue > 0
      && validObservationTime(previousTimeValue);
    const nextValid = Number.isFinite(nextValue) && nextValue > 0
      && validObservationTime(nextTimeValue);
    const previousTime = previousValid ? previousTimeValue : 0;
    const nextTime = nextValid ? nextTimeValue : 0;
    const useNext = nextValid && (!previousValid || nextTime >= previousTime);
    const selected = useNext ? next : previous;
    const value = useNext ? nextValue : previousValid ? previousValue : 0;
    return {
      value,
      observedAt: useNext ? nextTime : previousTime,
      source: value > 0 ? metadataText(selected?.[sourceField] || selected?.source, 64) : '',
      fromNext: useNext
    };
  }

  function newerText(previous, next, field, timeField, sourceField, fallbackTime, maxLength) {
    const clean = field === 'symbol' ? symbolText : (value) => metadataText(value, maxLength);
    const previousValue = clean(previous?.[field]);
    const nextValue = clean(next?.[field]);
    const previousTimeValue = previousValue
      ? previous?.[timeField] || previous?.metadataObservedAt || previous?.observedAt || 0 : 0;
    const nextTimeValue = nextValue
      ? next?.[timeField] || next?.metadataObservedAt || fallbackTime || 0 : 0;
    const previousValid = Boolean(previousValue) && validObservationTime(previousTimeValue);
    const nextValid = Boolean(nextValue) && validObservationTime(nextTimeValue);
    const previousTime = previousValid ? previousTimeValue : 0;
    const nextTime = nextValid ? nextTimeValue : 0;
    const useNext = nextValid && (!previousValid || nextTime >= previousTime);
    const selected = useNext ? next : previous;
    const value = useNext ? nextValue : previousValid ? previousValue : '';
    return {
      value,
      observedAt: useNext ? nextTime : previousTime,
      source: value ? metadataText(selected?.[sourceField] || selected?.source, 64) : ''
    };
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
    const price = newerPositive(previous, next, 'priceUsd', 'priceObservedAt', 'priceSource', nextObservedAt);
    const marketCap = newerPositive(previous, next, 'marketCapUsd', 'marketCapObservedAt', 'marketCapSource', nextObservedAt);
    const liquidity = newerPositive(previous, next, 'liquidityUsd', 'liquidityObservedAt', 'liquiditySource', nextObservedAt);
    const totalSupply = newerPositive(
      previous, next, 'totalSupply', 'totalSupplyObservedAt', 'totalSupplyObservationSource', nextObservedAt
    );
    const symbol = newerText(previous, next, 'symbol', 'symbolObservedAt', 'symbolSource', nextObservedAt, 32);
    const name = newerText(previous, next, 'name', 'nameObservedAt', 'nameSource', nextObservedAt, 100);
    const logoUrl = newerText(previous, next, 'logoUrl', 'logoUrlObservedAt', 'logoUrlSource', nextObservedAt, 1000);
    const launchpad = newerText(previous, next, 'launchpad', 'launchpadObservedAt', 'launchpadSource', nextObservedAt, 100);
    const launchMode = newerText(previous, next, 'launchMode', 'launchModeObservedAt', 'launchModeSource', nextObservedAt, 100);
    const metadataObservedAt = Math.max(
      symbol.observedAt, name.observedAt, logoUrl.observedAt, launchpad.observedAt, launchMode.observedAt
    );
    const observedAt = price.value > 0 ? price.observedAt
      : marketCap.value > 0 ? marketCap.observedAt
        : liquidity.value > 0 ? liquidity.observedAt
          : totalSupply.value > 0 ? totalSupply.observedAt : metadataObservedAt;
    const source = price.value > 0 ? price.source
      : marketCap.value > 0 ? marketCap.source
        : liquidity.value > 0 ? liquidity.source
          : totalSupply.value > 0 ? totalSupply.source
            : symbol.source || name.source || logoUrl.source || launchpad.source || launchMode.source;
    return {
      chain: next.chain,
      address,
      priceUsd: price.value,
      marketCapUsd: marketCap.value,
      liquidityUsd: liquidity.value,
      totalSupply: totalSupply.value,
      totalSupplySource: totalSupply.value > 0
        ? (totalSupply.fromNext ? metadataText(next.totalSupplySource, 64) : metadataText(previous?.totalSupplySource, 64)) || 'GMGN_NETWORK_EXACT'
        : '',
      totalSupplyObservationSource: totalSupply.source,
      symbol: symbol.value,
      name: name.value,
      logoUrl: logoUrl.value,
      launchpad: launchpad.value,
      launchMode: launchMode.value,
      priceObservedAt: price.observedAt,
      priceSource: price.source,
      marketCapObservedAt: marketCap.observedAt,
      marketCapSource: marketCap.source,
      liquidityObservedAt: liquidity.observedAt,
      liquiditySource: liquidity.source,
      totalSupplyObservedAt: totalSupply.observedAt,
      symbolObservedAt: symbol.observedAt,
      symbolSource: symbol.source,
      nameObservedAt: name.observedAt,
      nameSource: name.source,
      logoUrlObservedAt: logoUrl.observedAt,
      logoUrlSource: logoUrl.source,
      launchpadObservedAt: launchpad.observedAt,
      launchpadSource: launchpad.source,
      launchModeObservedAt: launchMode.observedAt,
      launchModeSource: launchMode.source,
      metadataObservedAt,
      observedAt,
      source
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
        if (priceUsd > 0 || marketCapUsd > 0 || liquidityUsd > 0 || totalSupply > 0
          || symbol || name || logoUrl || launchpad || launchMode) {
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
            priceSource: priceUsd > 0 ? 'GMGN_NETWORK' : '',
            marketCapObservedAt: marketCapUsd > 0 ? observedAt : 0,
            marketCapSource: marketCapUsd > 0 ? 'GMGN_NETWORK' : '',
            liquidityObservedAt: liquidityUsd > 0 ? observedAt : 0,
            liquiditySource: liquidityUsd > 0 ? 'GMGN_NETWORK' : '',
            totalSupplyObservedAt: totalSupply > 0 ? observedAt : 0,
            totalSupplyObservationSource: totalSupply > 0 ? 'GMGN_NETWORK' : '',
            symbolObservedAt: symbol ? observedAt : 0,
            symbolSource: symbol ? 'GMGN_NETWORK' : '',
            nameObservedAt: name ? observedAt : 0,
            nameSource: name ? 'GMGN_NETWORK' : '',
            logoUrlObservedAt: logoUrl ? observedAt : 0,
            logoUrlSource: logoUrl ? 'GMGN_NETWORK' : '',
            launchpadObservedAt: launchpad ? observedAt : 0,
            launchpadSource: launchpad ? 'GMGN_NETWORK' : '',
            launchModeObservedAt: launchMode ? observedAt : 0,
            launchModeSource: launchMode ? 'GMGN_NETWORK' : '',
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
