(function initTangoGmgnQuoteTap() {
  if (window !== window.top || window.__tangoGmgnQuoteTap) return;
  window.__tangoGmgnQuoteTap = true;

  const quoteCache = new Map();
  const ADDRESS_KEYS = ['address', 'token_address', 'tokenAddress', 'mint', 'mint_address', 'contract_address', 'contractAddress', 'ca'];
  const PRICE_KEYS = ['price_usd', 'priceUsd', 'usd_price', 'usdPrice', 'price'];
  const MC_KEYS = ['market_cap', 'marketCap', 'market_cap_usd', 'marketCapUsd', 'mc', 'fdv'];
  const LIQUIDITY_KEYS = ['liquidity_usd', 'liquidityUsd', 'liquidity'];

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

  function validSolanaAddress(value) {
    return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  }

  function extractQuotes(payload) {
    const found = new Map();
    const queue = [payload];
    let queueIndex = 0;
    let visited = 0;
    while (queueIndex < queue.length && visited < 8000) {
      const value = queue[queueIndex++];
      visited += 1;
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        value.slice(0, 500).forEach((item) => queue.push(item));
        continue;
      }
      const address = firstValue(value, ADDRESS_KEYS);
      if (validSolanaAddress(address)) {
        const priceUsd = numberFrom(firstValue(value, PRICE_KEYS));
        const marketCapUsd = numberFrom(firstValue(value, MC_KEYS));
        const rawLiquidity = firstValue(value, LIQUIDITY_KEYS);
        const liquidityUsd = numberFrom(typeof rawLiquidity === 'object' ? rawLiquidity?.usd : rawLiquidity);
        if (priceUsd > 0 || marketCapUsd > 0) {
          const key = address.toLowerCase();
          const previous = found.get(key) || quoteCache.get(key) || {};
          found.set(key, {
            address,
            priceUsd: priceUsd || previous.priceUsd || 0,
            marketCapUsd: marketCapUsd || previous.marketCapUsd || 0,
            liquidityUsd: liquidityUsd || previous.liquidityUsd || 0,
            observedAt: Date.now(),
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

  function publish(quotes) {
    if (!quotes.length) return;
    quotes.forEach((quote) => quoteCache.set(quote.address.toLowerCase(), quote));
    if (quoteCache.size > 2000) {
      [...quoteCache.keys()].slice(0, quoteCache.size - 2000).forEach((key) => quoteCache.delete(key));
    }
    window.postMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes }, '*');
  }

  function inspectPayload(payload) {
    try { publish(extractQuotes(payload)); } catch {}
  }

  function shouldInspectResponse(url, contentType) {
    if (!/json/i.test(contentType || '')) return false;
    try {
      const parsed = new URL(String(url || ''), location.href);
      if (!/(^|\.)gmgn\.ai$/i.test(parsed.hostname)) return false;
      return /(?:token|rank|launchpad|pump|trench|pool|market|quote|price|swap|new)/i.test(parsed.pathname + parsed.search);
    } catch { return false; }
  }

  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = new Proxy(nativeFetch, {
      apply(target, thisArg, args) {
        const request = Reflect.apply(target, thisArg, args);
        request.then((response) => {
          const contentType = response?.headers?.get('content-type') || '';
          if (response?.ok && shouldInspectResponse(response.url, contentType)) {
            response.clone().json().then(inspectPayload).catch(() => null);
          }
        }).catch(() => null);
        return request;
      }
    });
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function tangoXhrOpen(method, url, ...rest) {
    try { this.__tangoRequestUrl = new URL(String(url || ''), location.href).href; }
    catch { this.__tangoRequestUrl = String(url || ''); }
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function tangoXhrSend(...args) {
    this.addEventListener('load', () => {
      const contentType = this.getResponseHeader('content-type') || '';
      if (this.status >= 200 && this.status < 300 && shouldInspectResponse(this.__tangoRequestUrl, contentType)) {
        try { inspectPayload(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
      }
    }, { once: true });
    return xhrSend.apply(this, args);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'TANGO_PAPER_CONTENT' || event.data?.type !== 'REQUEST_QUOTES') return;
    publish([...quoteCache.values()]);
  });
})();
