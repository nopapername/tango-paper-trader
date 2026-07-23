(function initTangoGmgnQuoteTap() {
  if (window !== window.top || window.__tangoGmgnQuoteTap) return;
  window.__tangoGmgnQuoteTap = true;

  const paperActionDispatchAt = new Map();
  const paperTradeEvents = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'keydown', 'keyup'];
  function paperActionTarget(event) {
    return event.composedPath().find((node) => node instanceof Element && node.matches?.('[data-tango-paper-action="quick-buy"]')) || null;
  }
  function blockGmgnPaperAction(event) {
    const button = paperActionTarget(event);
    if (!button) return;
    if ((event.type === 'keydown' || event.type === 'keyup') && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type !== 'pointerup' && event.type !== 'click' && event.type !== 'keydown') return;
    const actionId = button.dataset.tangoActionId;
    const lastDispatchAt = Number(paperActionDispatchAt.get(actionId) || 0);
    if (!actionId || Date.now() - lastDispatchAt < 700) return;
    paperActionDispatchAt.set(actionId, Date.now());
    if (paperActionDispatchAt.size > 500) {
      const expiresBefore = Date.now() - 60_000;
      paperActionDispatchAt.forEach((dispatchedAt, key) => {
        if (dispatchedAt < expiresBefore) paperActionDispatchAt.delete(key);
      });
    }
    window.postMessage({ source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK', actionId }, '*');
  }
  paperTradeEvents.forEach((type) => window.addEventListener(type, blockGmgnPaperAction, { capture: true, passive: false }));

  const quoteCache = new Map();
  let lastRequestObservedAt = 0;

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
    return Tango.Chains.get(pathSlug) || Tango.Chains.get(parsed.searchParams.get('chain'));
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
      if (observation) quoteCache.set(key, observation);
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
    if (isMajorCoinPricesResponse(url)) {
      try {
        const prices = Tango.GMGNQuotes.extractNativePrices(payload, observedAt);
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

  function isMajorCoinPricesResponse(url) {
    return /\/api\/v1\/major_coin_prices(?:\?|$)/i.test(String(url || ''));
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
            && (isMajorCoinPricesResponse(responseUrl)
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
        && (isMajorCoinPricesResponse(responseUrl)
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
    publish([...quoteCache.values()]);
  });
})();
