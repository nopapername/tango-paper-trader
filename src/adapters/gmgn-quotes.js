(function initGmgnQuotes(global) {
  const Tango = global.Tango = global.Tango || {};
  const ADDRESS_KEYS = ['address', 'token_address', 'tokenAddress', 'mint', 'mint_address', 'contract_address', 'contractAddress', 'ca'];
  const EXPLICIT_PRICE_KEYS = ['price_usd', 'priceUsd', 'usd_price', 'usdPrice'];
  const GENERIC_PRICE_KEYS = ['price'];
  // A pool may expose generic quote-unit values beside explicit USD fields.
  const MC_KEYS = ['market_cap_usd', 'marketCapUsd', 'market_cap', 'marketCap', 'mc', 'fdv'];
  const LIQUIDITY_KEYS = ['liquidity_usd', 'liquidityUsd', 'liquidity'];
  const EXPLICIT_SUPPLY_KEYS = ['total_supply', 'totalSupply'];
  const GENERIC_SUPPLY_KEYS = ['supply'];
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

  function firstField(object, keys) {
    for (const key of keys) {
      if (object?.[key] != null) return { key, value: object[key] };
    }
    return { key: '', value: null };
  }

  function explicitSupplyField(object) {
    let first = null; let ambiguous = false;
    for (const key of EXPLICIT_SUPPLY_KEYS) {
      if (object?.[key] == null) continue;
      const value = numberFrom(object[key]);
      if (!(value > 0)) continue;
      if (!first) first = { key, value };
      else if (first.value !== value) ambiguous = true;
    }
    return { ...(first || { key: '', value: 0 }), ambiguous };
  }

  function objectAddress(object, chain) {
    let address = ''; let conflicting = false;
    for (const key of ADDRESS_KEYS) {
      const candidate = object?.[key];
      if (candidate == null || !Tango.Chains.validateAddress(chain.id, candidate)) continue;
      const normalized = Tango.Chains.normalizeAddress(chain.id, candidate);
      if (!address) address = normalized;
      else if (address !== normalized) conflicting = true;
    }
    return { address, conflicting };
  }

  function coherentValuationTriple(priceUsd, marketCapUsd, totalSupply) {
    return priceUsd > 0 && marketCapUsd > 0 && totalSupply > 0
      && Math.abs(priceUsd * totalSupply - marketCapUsd) <= marketCapUsd * 0.001;
  }

  function trustedMajorCoinPriceUrl(value) {
    let parsed;
    try { parsed = new URL(String(value || '')); } catch { return false; }
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'gmgn.ai' || parsed.hostname.endsWith('.gmgn.ai'))
      && parsed.pathname === '/api/v1/major_coin_prices';
  }

  function metadataText(value, maxLength) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).trim().slice(0, maxLength);
  }

  function factualObservationSource(value) {
    const source = metadataText(value, 64).toUpperCase();
    if (!source || source.includes('SYNTHETIC') || source.includes('DERIVED')
      || source.includes('FALLBACK')) return '';
    return source === 'DEXSCREENER' || source === 'GMGN' || source.startsWith('GMGN_') ? source : '';
  }

  function factualPriceObservation(value) {
    const provenance = metadataText(value?.priceProvenance, 64).toUpperCase();
    return value?.syntheticTokenPrice !== true && value?.provisionalTokenPrice !== true
      && !provenance.includes('SYNTHETIC') && !provenance.includes('DERIVED')
      && !provenance.includes('FALLBACK');
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
    const previousSource = factualObservationSource(previous?.[sourceField] || previous?.source);
    const nextSource = factualObservationSource(next?.[sourceField] || next?.source);
    const previousValid = Number.isFinite(previousValue) && previousValue > 0 && previousSource
      && validObservationTime(previousTimeValue)
      && (valueField !== 'priceUsd' || factualPriceObservation(previous));
    const nextValid = Number.isFinite(nextValue) && nextValue > 0 && nextSource
      && validObservationTime(nextTimeValue)
      && (valueField !== 'priceUsd' || factualPriceObservation(next));
    const previousTime = previousValid ? previousTimeValue : 0;
    const nextTime = nextValid ? nextTimeValue : 0;
    const useNext = nextValid && (!previousValid || nextTime >= previousTime);
    const selected = useNext ? next : previous;
    const value = useNext ? nextValue : previousValid ? previousValue : 0;
    return {
      value,
      observedAt: useNext ? nextTime : previousTime,
      source: value > 0 ? (useNext ? nextSource : previousSource) : '',
      fromNext: useNext,
      selected
    };
  }

  function newerSupply(previous, next, fallbackTime) {
    const candidate = (value) => {
      const totalSupply = Number(value?.totalSupply || 0);
      const observedAt = Number(value?.totalSupplyObservedAt || (
        totalSupply > 0 || value?.totalSupplyAmbiguous === true ? value?.observedAt : 0
      ) || 0);
      const source = factualObservationSource(value?.totalSupplyObservationSource || value?.source);
      const sourceName = metadataText(value?.totalSupplySource, 64);
      const rank = Number(value?.totalSupplyTrustRank || (
        sourceName === 'GMGN_NETWORK_EXACT' || totalSupply > 0 ? 2 : 0
      ));
      return {
        valid: Number.isFinite(totalSupply) && totalSupply > 0
          && Boolean(source) && validObservationTime(observedAt),
        totalSupply,
        observedAt,
        source,
        sourceName,
        rank,
        field: metadataText(value?.totalSupplyField, 64),
        ambiguous: value?.totalSupplyAmbiguous === true,
        selected: value
      };
    };
    const before = candidate(previous);
    const after = candidate({ ...next, observedAt: next?.observedAt || fallbackTime });
    if (after.ambiguous && (!before.valid || after.observedAt >= before.observedAt)) return after;
    if (before.ambiguous && (!after.valid || after.observedAt <= before.observedAt)) return before;
    if (!before.valid) return after.valid || after.ambiguous ? after : before;
    if (!after.valid) return before;
    if (after.rank > before.rank) return after;
    if (after.rank < before.rank) return before;
    if (after.observedAt > before.observedAt) return after;
    if (after.observedAt < before.observedAt) return before;
    if (Math.abs(after.totalSupply - before.totalSupply)
      <= Math.max(after.totalSupply, before.totalSupply) * Number.EPSILON) return after;
    return {
      valid: false,
      totalSupply: 0,
      observedAt: after.observedAt,
      source: '',
      sourceName: '',
      rank: after.rank,
      field: '',
      ambiguous: true,
      selected: null
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
    const previousSource = factualObservationSource(previous?.[sourceField] || previous?.source);
    const nextSource = factualObservationSource(next?.[sourceField] || next?.source);
    const previousValid = Boolean(previousValue) && previousSource && validObservationTime(previousTimeValue);
    const nextValid = Boolean(nextValue) && nextSource && validObservationTime(nextTimeValue);
    const previousTime = previousValid ? previousTimeValue : 0;
    const nextTime = nextValid ? nextTimeValue : 0;
    const useNext = nextValid && (!previousValid || nextTime >= previousTime);
    const selected = useNext ? next : previous;
    const value = useNext ? nextValue : previousValid ? previousValue : '';
    return {
      value,
      observedAt: useNext ? nextTime : previousTime,
      source: value ? (useNext ? nextSource : previousSource) : ''
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
    const totalSupply = newerSupply(previous, next, nextObservedAt);
    let priceObservationId = metadataText(
      price.selected?.priceObservationId || price.selected?.observationId, 128
    );
    let marketCapObservationId = metadataText(
      marketCap.selected?.marketCapObservationId || marketCap.selected?.observationId, 128
    );
    let totalSupplyObservationId = metadataText(
      totalSupply.selected?.totalSupplyObservationId || totalSupply.selected?.observationId, 128
    );
    const sameValuationSource = Boolean(price.source)
      && price.source === marketCap.source && price.source === totalSupply.source;
    const sameValuationObservationId = Boolean(
      priceObservationId && priceObservationId === marketCapObservationId
      && priceObservationId === totalSupplyObservationId
    );
    const sameValuationObservedAt = price.observedAt > 0
      && price.observedAt === marketCap.observedAt
      && price.observedAt === totalSupply.observedAt;
    const contradictoryTriple = sameValuationSource
      && (sameValuationObservationId || sameValuationObservedAt)
      && price.value > 0 && marketCap.value > 0 && totalSupply.valid
      && !coherentValuationTriple(price.value, marketCap.value, totalSupply.totalSupply);
    if (contradictoryTriple) {
      const ambiguityObservedAt = Math.max(
        price.observedAt, marketCap.observedAt, totalSupply.observedAt
      );
      Object.assign(price, { value: 0, observedAt: 0, source: '', selected: null });
      Object.assign(marketCap, { value: 0, observedAt: 0, source: '', selected: null });
      Object.assign(totalSupply, {
        valid: false,
        totalSupply: 0,
        observedAt: ambiguityObservedAt,
        source: '',
        sourceName: '',
        field: '',
        ambiguous: true,
        selected: null
      });
      priceObservationId = '';
      marketCapObservationId = '';
      totalSupplyObservationId = '';
    }
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
          : totalSupply.totalSupply > 0 || totalSupply.ambiguous ? totalSupply.observedAt : metadataObservedAt;
    const source = price.value > 0 ? price.source
      : marketCap.value > 0 ? marketCap.source
        : liquidity.value > 0 ? liquidity.source
          : totalSupply.totalSupply > 0 ? totalSupply.source
            : symbol.source || name.source || logoUrl.source || launchpad.source || launchMode.source;
    return {
      chain: next.chain,
      address,
      priceUsd: price.value,
      marketCapUsd: marketCap.value,
      liquidityUsd: liquidity.value,
      totalSupply: totalSupply.totalSupply,
      totalSupplySource: totalSupply.valid ? totalSupply.sourceName || 'GMGN_NETWORK_EXACT' : '',
      totalSupplyObservationSource: totalSupply.source,
      ...(priceObservationId ? { priceObservationId } : {}),
      ...(marketCapObservationId ? { marketCapObservationId } : {}),
      ...(totalSupplyObservationId ? { totalSupplyObservationId } : {}),
      ...(totalSupply.field ? { totalSupplyField: totalSupply.field } : {}),
      ...(totalSupply.rank > 0 ? { totalSupplyTrustRank: totalSupply.rank } : {}),
      ...(totalSupply.ambiguous ? { totalSupplyAmbiguous: true } : {}),
      ...(price.value > 0 && metadataText(price.selected?.priceProvenance, 64)
        ? { priceProvenance: metadataText(price.selected.priceProvenance, 64) } : {}),
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
      const identity = objectAddress(value, chain);
      if (identity.address && !identity.conflicting) {
        const address = identity.address;
        const explicitPrice = firstField(value, EXPLICIT_PRICE_KEYS);
        const genericPrice = firstField(value, GENERIC_PRICE_KEYS);
        const marketCap = firstField(value, MC_KEYS);
        const supply = explicitSupplyField(value);
        const genericSupply = firstField(value, GENERIC_SUPPLY_KEYS);
        const rawPriceUsd = numberFrom(explicitPrice.value ?? genericPrice.value);
        const rawMarketCapUsd = numberFrom(marketCap.value);
        const rawTotalSupply = supply.ambiguous ? 0 : supply.value;
        const hasTriple = rawPriceUsd > 0 && rawMarketCapUsd > 0 && rawTotalSupply > 0;
        const coherentTriple = hasTriple
          && coherentValuationTriple(rawPriceUsd, rawMarketCapUsd, rawTotalSupply);
        const contradictoryTriple = hasTriple && !coherentTriple;
        const priceUsd = contradictoryTriple ? 0
          : explicitPrice.key ? rawPriceUsd
            : coherentTriple ? rawPriceUsd : 0;
        const marketCapUsd = contradictoryTriple ? 0 : rawMarketCapUsd;
        const liquidityUsd = numberFrom(firstValue(value, LIQUIDITY_KEYS));
        const totalSupply = contradictoryTriple ? 0 : rawTotalSupply;
        const symbol = symbolText(firstValue(value, SYMBOL_KEYS));
        const name = metadataText(firstValue(value, NAME_KEYS), 100);
        const logoUrl = metadataText(firstValue(value, LOGO_KEYS), 1000);
        const launchpad = metadataText(firstValue(value, LAUNCHPAD_KEYS), 100);
        const launchMode = metadataText(firstValue(value, LAUNCH_MODE_KEYS), 100);
        const totalSupplyAmbiguous = supply.ambiguous || contradictoryTriple;
        if (priceUsd > 0 || marketCapUsd > 0 || liquidityUsd > 0 || totalSupply > 0
          || totalSupplyAmbiguous
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
            totalSupplyField: totalSupply > 0 ? supply.key : '',
            totalSupplyTrustRank: totalSupply > 0 ? 2 : 0,
            totalSupplyAmbiguous,
            genericSupplyField: genericSupply.key,
            symbol,
            name,
            logoUrl,
            launchpad,
            launchMode,
            observedAt,
            priceObservedAt: priceUsd > 0 ? observedAt : 0,
            priceSource: priceUsd > 0 ? 'GMGN_NETWORK' : '',
            ...(priceUsd > 0 && !explicitPrice.key
              ? { priceProvenance: 'OBSERVED_PRICE' } : {}),
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

  function extractNativePrices(payload, observedAt, context = {}) {
    const allowGenericPrice = trustedMajorCoinPriceUrl(context?.requestUrl);
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
      const explicitPrice = firstField(value, EXPLICIT_PRICE_KEYS);
      const genericPrice = firstField(value, GENERIC_PRICE_KEYS);
      const tokenShaped = ADDRESS_KEYS.some((key) => value?.[key] != null);
      const priceUsd = numberFrom(explicitPrice.key
        ? explicitPrice.value
        : allowGenericPrice && !tokenShaped ? genericPrice.value : null);
      if (nativeSymbols.has(symbol) && priceUsd > 0 && !found.has(symbol)) {
        found.set(symbol, { symbol, priceUsd, observedAt, source: 'GMGN_MAJOR_COIN' });
      }
      Object.values(value).slice(0, 300).forEach((item) => {
        if (item && typeof item === 'object') queue.push(item);
      });
    }
    return [...found.values()];
  }

  Tango.GMGNQuotes = {
    extract, extractNativePrices, mergeObservation,
    isFactualPriceObservation: factualPriceObservation
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGNQuotes;
})(globalThis);
