(function initTangoGmgnQuoteTap() {
  if (window !== window.top || window.__tangoGmgnQuoteTap) return;
  window.__tangoGmgnQuoteTap = true;

  const quoteCache = new Map();
  let lastRequestObservedAt = 0;
  let quoteVersion = 0; let replayVersion = -1; let replayLocked = false;

  function nextRequestObservedAt() {
    lastRequestObservedAt = Math.max(Date.now(), lastRequestObservedAt + 1);
    return lastRequestObservedAt;
  }

  function explicitGmgnChain(url) {
    let parsed;
    try { parsed = new URL(String(url?.url || url || ''), location.href); } catch { return null; }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'gmgn.ai' && !hostname.endsWith('.gmgn.ai')) return null;
    const pathSlug = parsed.pathname.split('/').filter(Boolean)[0];
    // These observed GMGN API routes carry their chain after the resource name.
    // Bind passive responses to that chain even when the page has navigated.
    const apiChain = parsed.pathname.match(
      /^\/(?:api\/v1\/token_mcap_candles|vas\/api\/mul-region\/token_trades_v2)\/([^/]+)\//
    )?.[1];
    return Tango.Chains.get(pathSlug) || Tango.Chains.get(apiChain)
      || Tango.Chains.get(parsed.searchParams.get('chain'));
  }

  function requestContext(url, includeObservedAt = true) {
    let requestUrl;
    try { requestUrl = new URL(String(url?.url || url || ''), location.href).href; }
    catch { requestUrl = String(url?.url || url || ''); }
    const chain = explicitGmgnChain(requestUrl)?.id || Tango.Chains.fromUrl(location.href)?.id || null;
    return { url: requestUrl, chain, observedAt: includeObservedAt ? nextRequestObservedAt() : 0 };
  }

  function publish(quotes) {
    if (!quotes.length) return;
    const merged = quotes.map((quote) => {
      const key = `${quote.chain}:${quote.address}`;
      const previous = quoteCache.get(key);
      const observation = previous === quote ? quote : Tango.GMGNQuotes.mergeObservation(previous, quote);
      if (observation) {
        if (observation !== previous) quoteVersion += 1;
        quoteCache.set(key, observation);
      }
      return observation;
    }).filter(Boolean);
    if (!merged.length) return;
    if (quoteCache.size > 2000) {
      [...quoteCache.keys()].slice(0, quoteCache.size - 2000).forEach((key) => quoteCache.delete(key));
    }
    window.postMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: merged }, '*');
  }

  function inspectPayload(payload, chain, url, observedAt) {
    if (chain) {
      try { publish(Tango.GMGNQuotes.extract(payload, chain, observedAt)); } catch {}
    }
    if (isMajorCoinPriceRequest(url)) {
      try {
        const prices = Tango.GMGNQuotes.extractNativePrices(payload, observedAt, {
          requestUrl: new URL(String(url || ''), location.href).href
        });
        if (prices.length) window.postMessage({
          source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES', prices
        }, '*');
      } catch {}
    }
  }

  function responseMatchesRequestChain(url, chain) {
    const explicitChain = explicitGmgnChain(url)?.id || null;
    return Boolean(chain) && (!explicitChain || explicitChain === chain);
  }

  function isMajorCoinPriceRequest(url) {
    try {
      const parsed = new URL(String(url || ''), location.href);
      return parsed.protocol === 'https:'
        && /(^|\.)gmgn\.ai$/i.test(parsed.hostname)
        && parsed.pathname === '/api/v1/major_coin_prices';
    } catch { return false; }
  }

  function shouldInspectResponse(url, contentType) {
    if (!/json/i.test(contentType || '')) return false;
    try {
      const parsed = new URL(String(url || ''), location.href);
      if (!/(^|\.)gmgn\.ai$/i.test(parsed.hostname)) return false;
      return /(?:token|rank|launchpad|pump|trench|pool|market|quote|price|new)/i.test(parsed.pathname + parsed.search);
    } catch { return false; }
  }

  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = new Proxy(nativeFetch, {
      apply(target, thisArg, args) {
        const requestStart = requestContext(args[0]);
        const request = Reflect.apply(target, thisArg, args);
        request.then((response) => {
          const contentType = response?.headers?.get('content-type') || '';
          const responseUrl = response?.url || requestStart.url;
          if (response?.ok && shouldInspectResponse(responseUrl, contentType)
            && (isMajorCoinPriceRequest(responseUrl)
              || responseMatchesRequestChain(responseUrl, requestStart.chain))) {
            response.clone().json().then((payload) => inspectPayload(
              payload, requestStart.chain, responseUrl, requestStart.observedAt
            )).catch(() => null);
          }
        }).catch(() => null);
        return request;
      }
    });
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function tangoXhrOpen(method, url, ...rest) {
    const requestStart = requestContext(url, false);
    this.__tangoRequestUrl = requestStart.url;
    this.__tangoRequestChain = requestStart.chain;
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function tangoXhrSend(...args) {
    this.__tangoRequestObservedAt = nextRequestObservedAt();
    this.addEventListener('load', () => {
      const contentType = this.getResponseHeader('content-type') || '';
      const responseUrl = this.responseURL || this.__tangoRequestUrl;
      if (this.status >= 200 && this.status < 300 && shouldInspectResponse(responseUrl, contentType)
        && (isMajorCoinPriceRequest(responseUrl)
          || responseMatchesRequestChain(responseUrl, this.__tangoRequestChain))) {
        try {
          inspectPayload(this.responseType === 'json' ? this.response : JSON.parse(this.responseText),
            this.__tangoRequestChain, responseUrl, this.__tangoRequestObservedAt);
        } catch {}
      }
    }, { once: true });
    return xhrSend.apply(this, args);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'TANGO_PAPER_CONTENT' || event.data?.type !== 'REQUEST_QUOTES') return;
    if (replayLocked && replayVersion === quoteVersion) return;
    publish([...quoteCache.values()]);
    replayVersion = quoteVersion; replayLocked = true;
    Promise.resolve().then(() => { replayLocked = false; });
  });
})();

// Some embedded webviews leave a newly navigated TradingView blob document
// completely empty. Retain only the page's own HTML blobs, and recover an
// identified, persistently empty chart once using a fresh srcdoc navigation.
// Navigation (rather than document.write) also reinstalls frame content scripts.
(function initTangoChartLoadingRecovery() {
  if (window !== window.top || window.__tangoChartLoadingRecovery
    || location.origin !== 'https://gmgn.ai'
    || typeof URL.createObjectURL !== 'function'
    || typeof MutationObserver !== 'function') return;
  window.__tangoChartLoadingRecovery = true;
  const captured = new Map();
  const frames = new WeakMap();
  const selector = 'iframe[title="Financial Chart"],iframe[title="TradingView"]';
  let scanQueued = false;
  let hasRecoveredFrame = false;
  const enabled = () => document.querySelector('#tango-paper-trader-host')
    ?.getAttribute('data-tango-active') === 'true';
  const setState = (frame, state) => frame.setAttribute('data-tango-chart-load-state', state);

  function chartTemplate(html) {
    if (typeof html !== 'string' || html.length > 2_000_000) return false;
    const base = html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    let baseUrl;
    try { baseUrl = new URL(base, location.href); } catch { return false; }
    if (baseUrl.origin !== location.origin
      || !/^\/_next\/static\/trading-view\/[\d.]+\/$/.test(baseUrl.pathname)) return false;
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
    return scripts.some(src => /^bundles\/runtime\./.test(src))
      && scripts.some(src => /^bundles\/library\./.test(src))
      && scripts.every(src => {
        try { const url = new URL(src, baseUrl); return url.origin === baseUrl.origin && url.pathname.startsWith(baseUrl.pathname); }
        catch { return false; }
      });
  }

  function isEmpty(frame) {
    try {
      const doc = frame.contentDocument;
      return doc?.readyState === 'complete' && doc.body && doc.head
        && doc.body.childNodes.length === 0 && doc.head.childNodes.length === 0;
    } catch { return false; }
  }

  async function recover(frame, state, entry) {
    state.pending = false;
    if (!enabled() || !frame.isConnected || frame.getAttribute('src') !== state.source || state.attempted) return;
    if (!isEmpty(frame)) { setState(frame, state.recoveredSource ? 'RECOVERED' : 'HEALTHY'); return; }
    state.attempted = true;
    try {
      const html = await entry.blob.text();
      if (!enabled() || !frame.isConnected || frame.getAttribute('src') !== state.source || !isEmpty(frame)) return;
      if (!chartTemplate(html)) { setState(frame, 'UNRECOGNIZED'); return; }
      state.recoveredSource = state.source;
      state.recoveryHtml = html;
      hasRecoveredFrame = true;
      setState(frame, 'RECOVERING');
      frame.setAttribute('srcdoc', html);
    } catch { setState(frame, 'FAILED'); }
  }

  function scan() {
    scanQueued = false;
    for (const [url, entry] of captured) {
      if (Date.now() - entry.createdAt > 120_000) captured.delete(url);
    }
    for (const frame of document.querySelectorAll(selector)) {
      const source = frame.getAttribute('src');
      let state = frames.get(frame);
      if (state?.recoveredSource && source !== state.recoveredSource) {
        // srcdoc takes precedence over src; never pin GMGN to our old document.
        if (frame.getAttribute('srcdoc') === state.recoveryHtml) frame.removeAttribute('srcdoc');
        frames.delete(frame);
        state = null;
      }
      if (!enabled() || !frame.matches(selector)) continue;
      const entry = captured.get(source);
      if (!entry || Date.now() - entry.createdAt > 120_000) continue;
      if (!state || state.source !== source) {
        state = { source, pending: false, attempted: false };
        frames.set(frame, state);
        frame.addEventListener('load', scheduleScan);
      }
      if (state.recoveredSource && !isEmpty(frame)) setState(frame, 'RECOVERED');
      if (state.pending || state.attempted) continue;
      state.pending = true;
      setState(frame, 'WAITING');
      setTimeout(() => recover(frame, state, entry), 2000);
    }
  }
  function scheduleScan() {
    if (scanQueued || (captured.size === 0 && !hasRecoveredFrame)) return;
    scanQueued = true;
    setTimeout(scan, 50);
  }
  const nativeCreate = URL.createObjectURL;
  URL.createObjectURL = new Proxy(nativeCreate, {
    apply(target, thisArg, args) {
      const url = Reflect.apply(target, thisArg, args);
      try {
        const blob = args[0];
        if (/^text\/html(?:;|$)/i.test(blob?.type || '') && typeof blob.text === 'function'
          && !(blob.size > 2_000_000) && new URL(url).origin === location.origin) {
          captured.set(url, { blob, createdAt: Date.now() });
          while (captured.size > 8) captured.delete(captured.keys().next().value);
          scheduleScan();
        }
      } catch { /* Keep the page's native object URL behavior. */ }
      return url;
    }
  });
  const containsChart = (node) => node?.nodeType === 1
    && (node.matches?.(selector) || node.querySelector?.(selector));
  new MutationObserver((records) => {
    if (records.some(record => record.type === 'attributes'
      ? (record.attributeName === 'data-tango-active'
        ? record.target === document.querySelector('#tango-paper-trader-host')
        : record.target?.matches?.(selector))
      : [...(record.addedNodes || []), ...(record.removedNodes || [])].some(containsChart))) scheduleScan();
  }).observe(document, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'title', 'data-tango-active']
  });
})();
