(function initContent(global) {
  if (global.__tangoPaperTraderLoaded) return;
  global.__tangoPaperTraderLoaded = true;

  const Tango = global.Tango;
  const runtime = {
    state: null, settings: null, current: null, drawerOpen: false, modal: null,
    toast: null, lastQuoteWriteAt: 0, quoteTimer: null, observer: null, renderQueued: false,
    presetEditing: null, suppressConfirmForSession: false, audioContext: null, tradeSounds: null,
    nativePrices: new Map(), nativePriceObservedAt: new Map(), nativePricePromises: new Map(),
    quoteRequests: new Map(), quoteRetryAt: new Map(),
    gmgnQuotes: new Map(), quickBuyLocks: new Map(), lastUrl: location.href, routeTimer: null,
    markerTimer: null, interactionUntil: 0, renderDeferralTimer: null, tradePending: false,
    calendarOpen: false, calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    renderedMarkup: null, markerPayloads: new WeakMap(), quickBuySyncQueued: false, activeChainId: null,
    routeEpoch: 0, routeIdentity: null
  };

  const host = document.createElement('div');
  host.id = 'tango-paper-trader-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = chrome.runtime.getURL('src/content/content.css');
  const shell = document.createElement('div');
  shell.className = 'tango-shell';
  shadow.append(stylesheet, shell);
  document.documentElement.appendChild(host);
  shell.addEventListener('pointerdown', () => { runtime.interactionUntil = Date.now() + 500; }, true);

  function activeChain() { return Tango.Chains.fromUrl(location.href); }
  function currentRouteIdentity(url = location.href) {
    const chain = Tango.Chains.fromUrl(url);
    if (!chain) return `unsupported:${String(url)}`;
    let parsed;
    try { parsed = new URL(url); } catch { return `unsupported:${String(url)}`; }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length === 3 && parts[0] === chain.gmgnSlug && parts[1].toLowerCase() === 'token') {
      let address = '';
      try { address = decodeURIComponent(parts[2]); } catch { return `${chain.id}:invalid-token`; }
      if (Tango.Chains.validateAddress(chain.id, address)) {
        return `${chain.id}:token:${Tango.Chains.normalizeAddress(chain.id, address)}`;
      }
    }
    return `${chain.id}:page:${parsed.pathname}${parsed.search}`;
  }
  function detailRouteToken(url = location.href) {
    const chain = Tango.Chains.fromUrl(url);
    if (!chain) return null;
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== chain.gmgnSlug || parts[1].toLowerCase() !== 'token') return null;
    let rawAddress;
    try { rawAddress = decodeURIComponent(parts[2]); } catch { return null; }
    if (!Tango.Chains.validateAddress(chain.id, rawAddress)) return null;
    return { chain: chain.id, address: Tango.Chains.normalizeAddress(chain.id, rawAddress) };
  }
  function captureRoute() {
    const identity = currentRouteIdentity();
    if (runtime.routeIdentity === null) runtime.routeIdentity = identity;
    return { epoch: runtime.routeEpoch, identity };
  }
  function routeCaptureIsCurrent(capture) {
    return Boolean(capture) && capture.epoch === runtime.routeEpoch
      && capture.identity === runtime.routeIdentity
      && capture.identity === currentRouteIdentity();
  }
  function advanceRouteEpoch() {
    runtime.routeEpoch += 1;
    runtime.routeIdentity = currentRouteIdentity();
  }
  function activeAccount() {
    const chain = activeChain();
    return chain && runtime.state ? runtime.state.accounts[chain.id] : null;
  }
  function chainSettings() {
    const chain = activeChain();
    if (!chain || !runtime.settings) return null;
    return runtime.settings.chainSettings?.[chain.id] || runtime.settings.chains?.[chain.id] || null;
  }
  function gmgnQuoteKey(chain, address) {
    const registered = Tango.Chains.get(chain);
    if (!registered || !Tango.Chains.validateAddress(registered.id, address)) return '';
    return `${registered.id}:${Tango.Chains.normalizeAddress(registered.id, address)}`;
  }
  function rememberNativePrice(chain, price, observedAt = Date.now()) {
    const numeric = Number(price || 0);
    if (!(numeric > 0)) return 0;
    runtime.nativePrices.set(chain, numeric);
    runtime.nativePriceObservedAt.set(chain, Number(observedAt));
    return numeric;
  }
  function freshNativePrice(chain, maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000)) {
    const price = Number(runtime.nativePrices.get(chain) || 0);
    const observedAt = Number(runtime.nativePriceObservedAt.get(chain) || 0);
    return price > 0 && observedAt > 0 && Date.now() - observedAt <= maxAgeMs ? price : 0;
  }
  function clearShellMarkup() {
    if (runtime.renderedMarkup !== '') shell.innerHTML = '';
    runtime.renderedMarkup = '';
  }
  function clearChainContext() {
    runtime.current = null;
    runtime.modal = null;
    runtime.calendarOpen = false;
    runtime.gmgnQuotes.clear();
    runtime.quoteRequests.clear();
    runtime.quoteRetryAt.clear();
    runtime.markerPayloads = new WeakMap();
    syncChartMarkers(true);
    Tango.GMGN.clearQuickBuy();
    clearHeaderAccountSummary();
    clearShellMarkup();
  }

  function handlePageMessage(event) {
    if (event.data?.source === 'TANGO_PAPER_CHART' && event.data?.type === 'READY') {
      syncChartMarkers(true);
      return;
    }
    if (event.source === window && event.data?.source === 'TANGO_GMGN_PAGE'
      && event.data?.type === 'NATIVE_PRICES') {
      for (const price of event.data.prices || []) {
        Tango.Chains.all().filter((chain) => chain.nativeSymbol === price.symbol)
          .forEach((chain) => rememberNativePrice(chain.id, price.priceUsd, price.observedAt));
      }
      queueRender();
      return;
    }
    if (event.source !== window || event.data?.source !== 'TANGO_GMGN_PAGE' || event.data?.type !== 'TOKEN_QUOTES') return;
    const chain = activeChain();
    if (!chain) {
      clearChainContext();
      return;
    }
    const positionsByAddress = new Map(Tango.ChainView.positions(runtime.state, chain.id)
      .map((position) => [Tango.Chains.normalizeAddress(chain.id, position.tokenAddress), position]));
    const routeToken = detailRouteToken();
    const metadataUpdates = [];
    let currentQuoteChanged = false;
    (event.data.quotes || []).forEach((quote) => {
      if (quote?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, quote?.address)) return;
      const address = Tango.Chains.normalizeAddress(chain.id, quote.address);
      const cacheKey = gmgnQuoteKey(chain.id, address);
      const cachedQuote = Tango.GMGNQuotes.mergeObservation(runtime.gmgnQuotes.get(cacheKey), quote);
      if (!cachedQuote) return;
      runtime.gmgnQuotes.set(cacheKey, cachedQuote);
      if (!runtime.current && routeToken?.chain === chain.id && routeToken.address === address
        && detailBootstrapObservation(cachedQuote)) {
        const symbol = String(cachedQuote.symbol || '').replace(/^\$/, '').replace(/\s+/g, ' ').trim().slice(0, 32);
        const name = String(cachedQuote.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        const hasVerifiedMetadata = !isPlaceholderTokenLabel(symbol) || !isPlaceholderTokenLabel(name);
        const fallbackSymbol = `${address.slice(0, 6)}…${address.slice(-4)}`;
        runtime.current = {
          token: {
            chain: chain.id, address,
            symbol: symbol || fallbackSymbol, name: name || symbol || fallbackSymbol,
            logoUrl: String(cachedQuote.logoUrl || '').trim().slice(0, 1000),
            metadataVerified: hasVerifiedMetadata,
            metadataSource: hasVerifiedMetadata ? 'GMGN_NETWORK' : ''
          },
          quote: {}
        };
        mergeQuote(runtime.current, cachedQuote);
        currentQuoteChanged = true;
      }
      const isCurrentToken = runtime.current?.token?.chain === chain.id
        && Tango.Chains.normalizeAddress(chain.id, runtime.current.token.address) === address;
      if (isCurrentToken) {
        applyGmgnNetworkMetadata(runtime.current.token, cachedQuote);
        mergeQuote(runtime.current, cachedQuote);
        currentQuoteChanged = true;
      }
      const position = positionsByAddress.get(address);
      const symbol = String(cachedQuote.symbol || '').replace(/^\$/, '').replace(/\s+/g, ' ').trim().slice(0, 32);
      const name = String(cachedQuote.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const logoUrl = String(cachedQuote.logoUrl || '').trim().slice(0, 1000);
      if (position && (!isPlaceholderTokenLabel(symbol) || !isPlaceholderTokenLabel(name) || logoUrl)) {
        metadataUpdates.push({
          chain: position.chain, address: position.tokenAddress,
          symbol, name, logoUrl,
          metadataVerified: true, metadataSource: 'GMGN_NETWORK'
        });
      }
    });
    if (runtime.gmgnQuotes.size > 2000) {
      const overflow = runtime.gmgnQuotes.size - 2000;
      [...runtime.gmgnQuotes.keys()].slice(0, overflow).forEach((key) => runtime.gmgnQuotes.delete(key));
    }
    if (currentQuoteChanged) queueRender();
    if (metadataUpdates.length) Tango.Store.updatePositionMetadataBatch(metadataUpdates)
      .then((state) => { runtime.state = state; queueRender(); })
      .catch(() => null);
  }
  window.addEventListener('message', handlePageMessage);
  window.postMessage({ source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' }, '*');

  function language() { return Tango.I18n.resolveLanguage(runtime.settings?.language); }
  function t(key, vars) { return Tango.I18n.t(key, runtime.settings?.language, vars); }
  function accountMoney(value, signed = false) {
    const chain = activeChain();
    if (!chain) return '--';
    const reference = Number(runtime.nativePrices.get(chain.id)
      || (runtime.current?.token?.chain === chain.id ? runtime.current?.quote?.nativePriceUsd : 0)
      || Tango.ChainView.positions(runtime.state, chain.id).find((position) => position.lastNativePriceUsd)?.lastNativePriceUsd
      || 0);
    if (runtime.settings?.displayCurrency !== 'USD' || !(reference > 0)) {
      return Tango.Format.native(value, chain.nativeSymbol, language(), signed);
    }
    const numeric = Number(value || 0); const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    return `${sign}${Tango.Format.usd(Math.abs(numeric) * reference, language())}`;
  }
  function currentNativePriceUsd() {
    const chain = activeChain();
    if (!chain) return 0;
    return Number(runtime.nativePrices.get(chain.id)
      || (runtime.current?.token?.chain === chain.id ? runtime.current?.quote?.nativePriceUsd : 0)
      || 0);
  }
  function canonicalUsdSummary() {
    const chain = activeChain();
    if (!chain || runtime.settings?.displayCurrency !== 'USD') return null;
    const price = currentNativePriceUsd();
    return price > 0 ? Tango.Engine.chainUsdSummary(runtime.state, chain.id, price) : null;
  }
  function usdMoney(value, signed = false) {
    const numeric = Number(value || 0); const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    return `${sign}${Tango.Format.usd(Math.abs(numeric), language())}`;
  }
  function positionUsdValue(position, mark = Tango.Engine.markPosition(
    position, freshExecutableQuote(position), currentNativePriceUsd()
  )) {
    return Number(position.quantity || 0) * Number(mark.priceUsd || 0);
  }
  function positionUsdTotal(positions) {
    return positions.reduce((sum, position) => sum + positionUsdValue(position), 0);
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function pnlClass(value) { return Number(value) > 0 ? 'tango-up' : Number(value) < 0 ? 'tango-down' : 'tango-flat'; }
  function currentPosition() {
    const chain = activeChain();
    if (!chain || runtime.current?.token?.chain !== chain.id) return null;
    return runtime.state.positions[Tango.Engine.positionKey(runtime.current.token.chain, runtime.current.token.address)] || null;
  }
  function requiresConfirmation() {
    return !runtime.settings.fastMode && runtime.settings.confirmationEnabled && !runtime.suppressConfirmForSession;
  }

  function coalesceAsync(task) {
    let active = null;
    let queued = false;
    return function run() {
      if (active) {
        queued = true;
        return active;
      }
      active = task().finally(() => {
        active = null;
        if (queued) {
          queued = false;
          run();
        }
      });
      return active;
    };
  }

  async function performRefresh() {
    const previousSettings = runtime.settings;
    const chain = activeChain();
    const previousChainSettings = chain
      ? previousSettings?.chainSettings?.[chain.id] || previousSettings?.chains?.[chain.id]
      : null;
    const data = await Tango.Store.getAll();
    runtime.state = data.state;
    runtime.settings = data.settings;
    const currentChainSettings = chainSettings();
    const quickBuyConfigChanged = previousSettings && (
      previousSettings.enabled !== runtime.settings.enabled ||
      previousSettings.showListQuickBuy !== runtime.settings.showListQuickBuy ||
      previousSettings.language !== runtime.settings.language ||
      Number(previousChainSettings?.buyPresets?.[0]) !== Number(currentChainSettings?.buyPresets?.[0])
    );
    if (!chain || !runtime.settings.enabled || !runtime.state.initialized || !runtime.settings.showListQuickBuy || quickBuyConfigChanged) Tango.GMGN.clearQuickBuy();
    if (!runtime.settings.enabled) runtime.current = null;
    queueRender();
  }

  const refresh = coalesceAsync(performRefresh);

  function queueRender() {
    if (runtime.renderQueued) return;
    if (Date.now() < runtime.interactionUntil) {
      clearTimeout(runtime.renderDeferralTimer);
      runtime.renderDeferralTimer = setTimeout(queueRender, Math.max(20, runtime.interactionUntil - Date.now()));
      return;
    }
    runtime.renderQueued = true;
    requestAnimationFrame(() => { runtime.renderQueued = false; render(); });
  }

  function syncQuickBuyButtons() {
    const chain = activeChain();
    const settings = chainSettings();
    if (chain && settings && runtime.settings?.enabled && runtime.state?.initialized && runtime.settings?.showListQuickBuy) {
      Tango.GMGN.discoverTokenCards(handleQuickBuy, settings.buyPresets?.[0] || 0.1, t('paper'));
    } else {
      Tango.GMGN.clearQuickBuy();
    }
  }

  function queueQuickBuySync() {
    if (runtime.quickBuySyncQueued) return;
    runtime.quickBuySyncQueued = true;
    requestAnimationFrame(() => {
      runtime.quickBuySyncQueued = false;
      syncQuickBuyButtons();
    });
  }

  async function syncVisiblePositionMetadata(routeCapture = captureRoute()) {
    if (!routeCaptureIsCurrent(routeCapture)) return;
    const chain = activeChain();
    if (!chain) return;
    const positions = Tango.ChainView.positions(runtime.state, chain.id);
    if (!positions.length) return;
    const tokens = Tango.GMGN.readVisibleTokenMetadata(positions.map((position) => position.tokenAddress));
    const updates = tokens.filter((token) => token.chain === chain.id);
    if (!updates.length || !routeCaptureIsCurrent(routeCapture)) return;
    runtime.state = await Tango.Store.updatePositionMetadataBatch(updates);
    if (!routeCaptureIsCurrent(routeCapture)) return;
    queueRender();
  }

  async function performQuoteTick() {
    const routeCapture = captureRoute();
    const chain = activeChain();
    if (!chain) {
      clearChainContext();
      return;
    }
    if (!runtime.settings?.enabled || !runtime.state?.initialized) {
      Tango.GMGN.clearQuickBuy();
      return;
    }
    const previousCurrent = runtime.current;
    const previousKey = previousCurrent?.token
      ? Tango.Engine.positionKey(previousCurrent.token.chain, previousCurrent.token.address) : '';
    const observedCurrent = await Tango.GMGN.readCurrentToken();
    if (!routeCaptureIsCurrent(routeCapture)) return;
    runtime.current = Tango.GMGN.resolveCurrentTokenRead(runtime.current, observedCurrent);
    if (runtime.current?.token?.chain !== chain.id) runtime.current = null;
    if (runtime.current) {
      runtime.current.quote.nativePriceUsd = freshNativePrice(chain.id);
      if (currentPosition()) {
        runtime.state = await Tango.Store.updatePositionMetadata(runtime.current.token);
        if (!routeCaptureIsCurrent(routeCapture)) return;
      }
    }
    ensureNativePrice(runtime.current, routeCapture);
    ensureTokenQuote(runtime.current, routeCapture);
    const executable = executableQuote(runtime.current?.token, runtime.current?.quote);
    if (routeCaptureIsCurrent(routeCapture) && executable && currentPosition()
      && Date.now() - runtime.lastQuoteWriteAt > 10_000) {
      runtime.state = await Tango.Store.updatePositionQuote(runtime.current.token, executable);
      runtime.lastQuoteWriteAt = Date.now();
      if (!routeCaptureIsCurrent(routeCapture)) return;
    }
    if (!routeCaptureIsCurrent(routeCapture)) return;
    syncQuickBuyButtons();
    await syncVisiblePositionMetadata(routeCapture);
    if (!routeCaptureIsCurrent(routeCapture)) return;
    const currentKey = runtime.current?.token
      ? Tango.Engine.positionKey(runtime.current.token.chain, runtime.current.token.address) : '';
    if (previousKey !== currentKey || runtime.current) queueRender();
  }

  const tickQuote = coalesceAsync(performQuoteTick);

  function ensureNativePrice(context, routeCapture = captureRoute()) {
    const chain = activeChain();
    if (!chain || (context && context.token?.chain !== chain.id)) return;
    const cached = freshNativePrice(chain.id);
    if (cached > 0) {
      if (context) {
        context.quote.nativePriceUsd = cached;
        context.quote.nativePriceObservedAt = runtime.nativePriceObservedAt.get(chain.id);
      }
      return;
    }
    if (runtime.nativePricePromises.has(chain.id)) return;
    const request = chrome.runtime.sendMessage({ type: 'TANGO_GET_NATIVE_PRICE', chain: activeChain().id })
      .then((response) => {
        const price = Number(response?.price || 0);
        if (!(price > 0)) return;
        rememberNativePrice(chain.id, price, Number(response?.observedAt || 0));
        if (routeCaptureIsCurrent(routeCapture) && activeChain()?.id === chain.id) {
          if (runtime.current?.token?.chain === chain.id) {
            runtime.current.quote.nativePriceUsd = price;
            runtime.current.quote.nativePriceObservedAt = runtime.nativePriceObservedAt.get(chain.id);
          }
          queueRender();
        }
      })
      .catch(() => null)
      .finally(() => { runtime.nativePricePromises.delete(chain.id); });
    runtime.nativePricePromises.set(chain.id, request);
  }

  function trustedMarketCapObservation(candidate, token) {
    const persistedTrust = token?.marketCapProvenance === 'SOLANA_PUMP_TRENCH_V1';
    const observedTrust = token?.metadataVerified === true
      && String(token?.metadataSource || '').toUpperCase() === 'GMGN_TRENCH';
    return token?.chain === 'sol'
      && /pump$/i.test(String(token?.tokenAddress || token?.address || ''))
      && (persistedTrust || observedTrust)
      && String(candidate?.source || '').toUpperCase() === 'GMGN_TRENCH_MC'
      && candidate?.valuationMode === 'MARKET_CAP'
      && Number(candidate?.marketCapDivisor) === 1_000_000_000
      && Number(candidate?.marketCapUsd || 0) > 0;
  }

  function displaysMarketCapValuation(quote) {
    return quote?.valuationMode === 'MARKET_CAP'
      && String(quote?.source || '').toUpperCase() === 'GMGN_TRENCH_MC'
      && Number(quote?.marketCapUsd) > 0;
  }

  function acceptedTokenObservation(candidate, token, maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000)) {
    const source = String(candidate?.source || '').toUpperCase();
    const acceptedSource = source === 'DEXSCREENER' || source.startsWith('GMGN');
    const hasValue = Number(candidate?.priceUsd || 0) > 0 || trustedMarketCapObservation(candidate, token);
    const observedAt = Number(candidate?.observedAt || 0);
    return acceptedSource && hasValue && observedAt > 0 && Date.now() - observedAt <= maxAgeMs;
  }

  function detailBootstrapObservation(candidate, maxAgeMs = 30_000) {
    const observedAt = Number(candidate?.observedAt || 0);
    const age = Date.now() - observedAt;
    return String(candidate?.source || '').toUpperCase() === 'GMGN_NETWORK'
      && (Number(candidate?.priceUsd || 0) > 0 || Number(candidate?.marketCapUsd || 0) > 0)
      && observedAt > 0 && age >= -5_000 && age <= maxAgeMs;
  }

  function ensureTokenQuote(context, routeCapture = captureRoute()) {
    const chain = activeChain();
    if (!routeCaptureIsCurrent(routeCapture) || !chain || context?.token?.chain !== chain.id
      || !context?.token?.address || acceptedTokenObservation(context.quote, context.token)) return;
    const address = context.token.address;
    const requestKey = gmgnQuoteKey(chain.id, address);
    const gmgnQuote = freshGmgnQuote(chain.id, address);
    if (acceptedTokenObservation(gmgnQuote, context.token)) {
      mergeQuote(context, gmgnQuote);
      queueRender();
      return;
    }
    if (Date.now() < Number(runtime.quoteRetryAt.get(requestKey) || 0)) return;
    const requestIsCurrent = () => routeCaptureIsCurrent(routeCapture)
      && activeChain()?.id === chain.id
      && context?.token?.chain === chain.id
      && context?.token?.address === address;
    sharedQuoteRequest({ type: 'TANGO_GET_TOKEN_QUOTE', chain: context.token.chain, address }, 1500)
      .then((response) => {
        if (!requestIsCurrent()) return;
        const quote = response?.quote;
        if (!acceptedTokenObservation(quote, context.token)) {
          runtime.quoteRetryAt.set(requestKey, Date.now() + 15_000);
          return;
        }
        runtime.quoteRetryAt.delete(requestKey);
        if (!routeCaptureIsCurrent(routeCapture) || activeChain()?.id !== chain.id
          || runtime.current?.token?.chain !== chain.id
          || runtime.current.token.address !== address) return;
        mergeQuote(runtime.current, quote);
        queueRender();
      })
      .catch(() => {
        if (requestIsCurrent()) runtime.quoteRetryAt.set(requestKey, Date.now() + 15_000);
      });
  }

  function requestWithTimeout(message, timeoutMs = 650) {
    return Promise.race([
      chrome.runtime.sendMessage(message).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }

  function freshGmgnQuote(chain, address, maxAgeMs = 30_000) {
    const quote = runtime.gmgnQuotes.get(gmgnQuoteKey(chain, address));
    return quote && Date.now() - Number(quote.observedAt || 0) <= maxAgeMs ? quote : null;
  }

  function cachedGmgnQuote(chain, address) {
    return runtime.gmgnQuotes.get(gmgnQuoteKey(chain, address)) || null;
  }

  function isPlaceholderTokenLabel(value) {
    return !String(value || '').trim() || /^(TOKEN|UNKNOWN|N\/A)$/i.test(String(value).trim());
  }

  function applyGmgnNetworkMetadata(token, observation) {
    if (!token || observation?.chain !== token.chain
      || !Tango.Chains.validateAddress(token.chain, token.address || token.tokenAddress)
      || !Tango.Chains.validateAddress(token.chain, observation.address)
      || Tango.Chains.normalizeAddress(token.chain, token.address || token.tokenAddress)
        !== Tango.Chains.normalizeAddress(token.chain, observation.address)) return token;
    const symbol = String(observation.symbol || '').replace(/^\$/, '').replace(/\s+/g, ' ').trim().slice(0, 32);
    const name = String(observation.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const logoUrl = String(observation.logoUrl || '').trim().slice(0, 1000);
    if (!isPlaceholderTokenLabel(symbol)) token.symbol = symbol;
    if (!isPlaceholderTokenLabel(name)) token.name = name;
    if (logoUrl) token.logoUrl = logoUrl;
    if (!isPlaceholderTokenLabel(symbol) || !isPlaceholderTokenLabel(name) || logoUrl) {
      token.metadataVerified = true;
      token.metadataSource = 'GMGN_NETWORK';
    }
    return token;
  }

  function mergeQuote(context, quote) {
    if (!quote) return context.quote;
    const chain = context.token?.chain;
    const nativePriceUsd = freshNativePrice(chain);
    const validationContext = persistedQuoteContext(context.token);
    const trustedMarketCap = trustedMarketCapObservation(quote, validationContext);
    context.quote = {
      ...context.quote,
      ...quote,
      priceUsd: Number(quote.priceUsd || 0),
      marketCapUsd: Number(quote.marketCapUsd || 0),
      liquidityUsd: Number(quote.liquidityUsd || 0),
      observedAt: Number(quote.observedAt || 0),
      source: String(quote.source || ''),
      nativePriceUsd,
      nativePriceObservedAt: nativePriceUsd ? runtime.nativePriceObservedAt.get(chain) : 0,
      valuationMode: trustedMarketCap
        ? 'MARKET_CAP'
        : Number(quote.priceUsd) > 0 ? 'PRICE' : ''
    };
    if (trustedMarketCap) context.quote.marketCapDivisor = Number(quote.marketCapDivisor);
    else delete context.quote.marketCapDivisor;
    return context.quote;
  }

  async function sharedQuoteRequest(message, timeoutMs = 650) {
    const identity = message.address ? gmgnQuoteKey(message.chain, message.address) : String(message.chain || '');
    const key = `${message.type}:${identity}`;
    if (runtime.quoteRequests.has(key)) return runtime.quoteRequests.get(key);
    const request = requestWithTimeout(message, timeoutMs).finally(() => {
      if (runtime.quoteRequests.get(key) === request) runtime.quoteRequests.delete(key);
    });
    runtime.quoteRequests.set(key, request);
    return request;
  }

  function trustedTokenObservation(candidate, token) {
    const source = String(candidate?.source || '').toUpperCase();
    const trustedSource = source === 'DEXSCREENER' || source.startsWith('GMGN');
    const hasValue = Number(candidate?.priceUsd || 0) > 0
      || trustedMarketCapObservation(candidate, persistedQuoteContext(token));
    return trustedSource && hasValue && Number(candidate?.observedAt || 0) > 0;
  }

  function positionQuote(position) {
    if (!position) return null;
    const marketCapMode = Tango.Engine.usesMarketCapValuation?.(position) === true;
    const observedAt = Number(position.quoteObservedAt || position.updatedAt || position.openedAt || 0);
    if (marketCapMode) {
      return {
        priceUsd: 0,
        marketCapUsd: Number(position.lastMarketCapUsd || position.averageEntryMarketCap || 0),
        liquidityUsd: 0,
        source: 'GMGN_TRENCH_MC',
        observedAt,
        valuationMode: 'MARKET_CAP',
        marketCapDivisor: Number(position.marketCapDivisor || 0),
        priceProvenance: position.lastPriceProvenance || 'MARKET_CAP_DERIVED',
        nativePriceUsd: Number(position.lastNativePriceUsd || 0),
        nativePriceObservedAt: observedAt
      };
    }
    return {
      priceUsd: Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0),
      marketCapUsd: Number(position.lastMarketCapUsd || 0),
      liquidityUsd: 0,
      source: 'GMGN_LAST_KNOWN',
      observedAt,
      valuationMode: 'PRICE',
      nativePriceUsd: Number(position.lastNativePriceUsd || 0),
      nativePriceObservedAt: observedAt
    };
  }

  function lastKnownNativeObservation(chainId, candidate, position) {
    const chainPosition = Tango.ChainView.positions(runtime.state, chainId)
      .find((item) => Number(item.lastNativePriceUsd || 0) > 0);
    const observations = [
      {
        price: Number(runtime.nativePrices.get(chainId) || 0),
        observedAt: Number(runtime.nativePriceObservedAt.get(chainId) || 0)
      },
      {
        price: Number(candidate?.nativePriceUsd || 0),
        observedAt: Number(candidate?.nativePriceObservedAt || candidate?.observedAt || 0)
      },
      {
        price: Number(position?.lastNativePriceUsd || 0),
        observedAt: Number(position?.quoteObservedAt || position?.updatedAt || position?.openedAt || 0)
      },
      {
        price: Number(chainPosition?.lastNativePriceUsd || 0),
        observedAt: Number(chainPosition?.quoteObservedAt || chainPosition?.updatedAt || chainPosition?.openedAt || 0)
      }
    ].filter(({ price }) => Number.isFinite(price) && price > 0)
      .sort((left, right) => right.observedAt - left.observedAt);
    return observations[0] || { price: 0, observedAt: 0 };
  }

  function paperExecutableQuote(token, candidate, position) {
    const chain = activeChain();
    if (!chain || token?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, token?.address || token?.tokenAddress)) {
      return null;
    }
    const now = Date.now();
    return {
      ...(candidate || {}),
      chain: chain.id,
      address: Tango.Chains.normalizeAddress(chain.id, token.address || token.tokenAddress),
      observedAt: now,
      nativePriceObservedAt: now,
      paperFallback: true
    };
  }

  function refreshPaperQuoteInBackground(token) {
    const chain = activeChain();
    const address = token?.address || token?.tokenAddress;
    if (!chain || token?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, address)) return;
    const normalizedAddress = Tango.Chains.normalizeAddress(chain.id, address);
    const routeCapture = captureRoute();
    const currentMatches = runtime.current?.token?.chain === chain.id
      && Tango.Chains.validateAddress(chain.id, runtime.current.token.address)
      && Tango.Chains.normalizeAddress(chain.id, runtime.current.token.address) === normalizedAddress;
    const context = currentMatches ? runtime.current : {
      token: { ...token, chain: chain.id, address: normalizedAddress },
      quote: cachedGmgnQuote(chain.id, normalizedAddress) || positionQuote(persistedQuoteContext(token)) || {}
    };
    Promise.resolve().then(() => ensureTokenQuote(context, routeCapture)).catch(() => null);
    Promise.resolve().then(() => ensureNativePrice(context, routeCapture)).catch(() => null);
  }

  function resolvePaperTradeQuote(token, candidate, options = {}) {
    const chain = activeChain();
    const address = token?.address || token?.tokenAddress;
    if (!chain || token?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, address)) return null;
    const normalizedAddress = Tango.Chains.normalizeAddress(chain.id, address);
    const position = options?.position === undefined ? persistedQuoteContext(token) : options.position;
    const exact = runtime.gmgnQuotes.get(gmgnQuoteKey(chain.id, normalizedAddress)) || null;
    const candidateSource = String(candidate?.source || '').toUpperCase();
    const candidateIsTrusted = candidateSource === 'DEXSCREENER' || candidateSource.startsWith('GMGN');
    const boundCandidate = candidateIsTrusted ? {
      ...(candidate || {}), chain: chain.id, address: normalizedAddress
    } : null;
    const merged = exact && boundCandidate
      ? Tango.GMGNQuotes.mergeObservation(exact, boundCandidate)
      : boundCandidate || exact;
    const positionAddress = position?.tokenAddress || position?.address;
    const boundPosition = position?.chain === chain.id
      && Tango.Chains.validateAddress(chain.id, positionAddress)
      && Tango.Chains.normalizeAddress(chain.id, positionAddress) === normalizedAddress
      ? position : null;
    const local = merged || positionQuote(boundPosition) || {};
    const marketCapUsd = Number(local.marketCapUsd);
    const safeMarketCapUsd = Number.isFinite(marketCapUsd) && marketCapUsd > 0 ? marketCapUsd : 0;
    const observedPrice = Number(local.priceUsd);
    const safeObservedPrice = Number.isFinite(observedPrice) && observedPrice > 0 ? observedPrice : 0;
    const legacyPumpSupply = chain.id === 'sol' && /pump$/i.test(normalizedAddress)
      && boundPosition?.marketCapProvenance === 'SOLANA_PUMP_TRENCH_V1'
      && boundPosition?.valuationMode === 'MARKET_CAP'
      && Number(boundPosition?.marketCapDivisor) === 1_000_000_000
      ? 1_000_000_000 : 0;
    const supply = Tango.Supply.resolve({
      chain: chain.id,
      totalSupply: local.totalSupply || boundPosition?.totalSupply || legacyPumpSupply,
      supplySource: local.supplySource || local.totalSupplySource || boundPosition?.supplySource
        || (legacyPumpSupply ? 'LEGACY_PUMP_RULE' : ''),
      priceUsd: safeObservedPrice,
      marketCapUsd: safeMarketCapUsd,
      launchpad: token.launchpad || local.launchpad || boundPosition?.launchpad,
      launchMode: token.launchMode || local.launchMode || boundPosition?.launchMode
    });
    const calculatedPrice = !safeObservedPrice && safeMarketCapUsd > 0 && supply
      ? safeMarketCapUsd / supply.totalSupply
      : 0;
    const derivedPrice = Number.isFinite(calculatedPrice) && calculatedPrice > 0 ? calculatedPrice : 0;
    const historicalValue = Number(boundPosition?.lastPriceUsd || boundPosition?.averageEntryPriceUsd || 0);
    const historicalPrice = Number.isFinite(historicalValue) && historicalValue > 0 ? historicalValue : 0;
    const priceUsd = safeObservedPrice || derivedPrice || historicalPrice || 1;
    const native = lastKnownNativeObservation(chain.id, local, boundPosition);
    const nativePriceUsd = Number(native.price || 1);
    const now = Date.now();
    const syntheticTokenPrice = !(safeObservedPrice > 0 || derivedPrice > 0 || historicalPrice > 0);
    const syntheticNativePrice = !(native.price > 0);
    const fallbackSupply = derivedPrice > 0 && supply?.confidence === 'fallback';
    return {
      ...local,
      chain: chain.id,
      address: normalizedAddress,
      priceUsd,
      marketCapUsd: safeMarketCapUsd,
      liquidityUsd: Number.isFinite(Number(local.liquidityUsd)) && Number(local.liquidityUsd) > 0
        ? Number(local.liquidityUsd) : 0,
      nativePriceUsd,
      observedAt: now,
      nativePriceObservedAt: now,
      originalObservedAt: Number(local.observedAt || 0),
      nativeOriginalObservedAt: Number(native.observedAt || 0),
      source: syntheticTokenPrice ? 'TANGO_SYNTHETIC' : String(local.source || 'GMGN_LAST_KNOWN'),
      valuationMode: derivedPrice > 0 ? 'MARKET_CAP' : 'PRICE',
      priceProvenance: syntheticTokenPrice ? 'SYNTHETIC_PRICE'
        : derivedPrice > 0 ? 'MARKET_CAP_DERIVED' : 'OBSERVED_PRICE',
      totalSupply: supply ? Number(supply.totalSupply) : undefined,
      marketCapDivisor: supply ? Number(supply.totalSupply) : undefined,
      supplySource: supply?.source || '',
      supplyConfidence: supply?.confidence || '',
      syntheticTokenPrice,
      syntheticNativePrice,
      provisional: syntheticTokenPrice || syntheticNativePrice || fallbackSupply,
      paperFallback: true
    };
  }

  function requireExecutableQuote(token, candidate) {
    const chain = activeChain();
    if (!chain || token?.chain !== chain.id) throw new Error('unsupportedChain');
    const source = String(candidate?.source || '').toUpperCase();
    if (!(source === 'DEXSCREENER' || source.startsWith('GMGN'))) throw new Error('invalidQuote');
    const nativePriceUsd = freshNativePrice(chain.id);
    if (!(nativePriceUsd > 0)) throw new Error('nativePriceUnavailable');
    const quote = {
      ...candidate,
      nativePriceUsd,
      nativePriceObservedAt: runtime.nativePriceObservedAt.get(chain.id)
    };
    const validation = Tango.Engine.validateQuote(quote, Date.now(), undefined, persistedQuoteContext(token));
    if (!validation.ok) throw new Error(validation.reason);
    return quote;
  }

  function executableQuote(token, candidate) {
    try { return requireExecutableQuote(token, candidate); }
    catch { return null; }
  }

  function persistedQuoteContext(token) {
    const chain = token?.chain;
    const address = token?.tokenAddress || token?.address;
    if (!chain || !address) return token;
    return runtime.state?.positions?.[Tango.Engine.positionKey(chain, address)] || token;
  }

  function freshExecutableQuoteResult(position) {
    const chain = activeChain();
    if (!chain || position?.chain !== chain.id) return { quote: null, reason: 'unsupportedChain' };
    const address = Tango.Chains.normalizeAddress(chain.id, position.tokenAddress);
    const currentMatches = runtime.current?.token?.chain === chain.id
      && Tango.Chains.normalizeAddress(chain.id, runtime.current.token.address) === address;
    const candidate = currentMatches ? runtime.current.quote : freshGmgnQuote(chain.id, address);
    try { return { quote: requireExecutableQuote(position, candidate), reason: null }; }
    catch (error) { return { quote: null, reason: error?.message || 'invalidQuote' }; }
  }

  function freshExecutableQuote(position) {
    return freshExecutableQuoteResult(position).quote;
  }

  function positionUrl(position) {
    return Tango.Chains.tokenUrl(position.chain, position.tokenAddress);
  }

  function openPosition(position) {
    chrome.runtime.sendMessage({ type: 'TANGO_OPEN_TOKEN', url: positionUrl(position) })
      .then((response) => { if (!response?.ok) showToast(t('openTokenFailed'), 'error'); })
      .catch(() => showToast(t('openTokenFailed'), 'error'));
  }

  async function handleQuickBuy(context) {
    if (!runtime.settings?.enabled) return;
    const routeCapture = captureRoute();
    const chain = activeChain();
    if (!chain || context?.token?.chain !== chain.id) return showToast(t('unsupportedChain'), 'error');
    const amountNative = Number(context.amountNative ?? context.amountSol);
    const lockKey = `${gmgnQuoteKey(chain.id, context.token.address)}:${amountNative}`;
    const lastHandledAt = Number(runtime.quickBuyLocks.get(lockKey) || 0);
    if (Date.now() - lastHandledAt < 1000) return;
    runtime.quickBuyLocks.set(lockKey, Date.now());
    if (runtime.quickBuyLocks.size > 100) {
      [...runtime.quickBuyLocks.entries()].filter(([, at]) => Date.now() - at > 5000).forEach(([key]) => runtime.quickBuyLocks.delete(key));
    }
    await buy(amountNative, context, routeCapture);
  }

  async function buy(amountNative, context = runtime.current, routeCapture = captureRoute()) {
    primeTradeAudio();
    if (!routeCaptureIsCurrent(routeCapture)) return;
    if (!runtime.state.initialized) return showToast(t('startPaperTrading'), 'error');
    const chain = activeChain();
    const order = {
      token: context?.token,
      quote: null,
      amountNative: Number(amountNative),
      sourceUrl: context?.sourceUrl || location.href
    };
    try {
      if (!chain || order.token?.chain !== chain.id) throw new Error('unsupportedChain');
      if (!(order.amountNative > 0)) throw new Error('invalidAmount');
      if (order.amountNative > Number(activeAccount()?.cashBalanceNative || 0)) throw new Error('insufficientBalance');
      order.quote = resolvePaperTradeQuote(context?.token, context?.quote);
      if (!order.quote) throw new Error('invalidQuote');
      refreshPaperQuoteInBackground(order.token);
      const orderKey = `${order.token.chain}:${order.token.address || ''}:${order.amountNative}`;
      if (runtime.modal?.type === 'confirm' && runtime.modal.orderKey === orderKey) return;
      if (!routeCaptureIsCurrent(routeCapture)) return;
      previewBuy(order, routeCapture);
      if (requiresConfirmation()) return;
      await commitBuy(order, routeCapture);
    } catch (error) { showToast(t(error.message), 'error'); }
  }

  function previewBuy(order, routeCapture) {
    if (!routeCaptureIsCurrent(routeCapture)) return;
    const chain = activeChain();
    const account = activeAccount();
    const settings = chainSettings();
    if (!chain || order.token?.chain !== chain.id || !account || !settings) throw new Error('unsupportedChain');
    const validation = Tango.Engine.validateQuote(order.quote, Date.now(), undefined, persistedQuoteContext(order.token));
    if (!validation.ok) throw new Error(validation.reason);
    if (!(order.amountNative > 0)) throw new Error('invalidAmount');
    if (order.amountNative > account.cashBalanceNative) throw new Error('insufficientBalance');
    if (!requiresConfirmation()) return;
    const fee = order.amountNative * runtime.settings.platformFeeBps / 10_000;
    const marketCapValuation = displaysMarketCapValuation(order.quote);
    const executionPrice = order.quote.priceUsd * (1 + runtime.settings.slippageBps / 10_000);
    const valuationRows = marketCapValuation
      ? [[t('marketCap'), Tango.Format.usd(order.quote.marketCapUsd, language(), true)]]
      : [
        [t('observedPrice'), Tango.Format.usd(order.quote.priceUsd, language())],
        [t('executionPrice'), Tango.Format.usd(executionPrice, language())]
      ];
    runtime.modal = {
      type: 'confirm',
      orderKey: `${order.token.chain}:${order.token.address || ''}:${order.amountNative}`,
      title: t('simulatedBuy'),
      rows: [
        [t('token'), order.token.symbol], [t('investment'), Tango.Format.native(order.amountNative, chain.nativeSymbol, language())],
        ...valuationRows,
        [t('slippage'), Tango.Format.percent(runtime.settings.slippageBps / 100, language())],
        [t('tradingFee'), Tango.Format.native(fee, chain.nativeSymbol, language())],
        [t('networkFee'), Tango.Format.native(settings.networkFeeNative, chain.nativeSymbol, language())]
      ],
      note: order.quote.provisional === true ? t('provisionalQuote') : undefined,
      allowSessionSuppress: true,
      action: () => commitBuy(order, routeCapture)
    };
    render();
  }

  async function commitBuy(order, routeCapture = captureRoute()) {
    if (!routeCaptureIsCurrent(routeCapture)) return;
    if (runtime.tradePending) return;
    runtime.tradePending = true;
    try {
      if (!routeCaptureIsCurrent(routeCapture) || activeChain()?.id !== order.token?.chain) throw new Error('unsupportedChain');
      const quote = paperExecutableQuote(order.token, order.quote);
      if (!quote) throw new Error('invalidQuote');
      const executableOrder = { ...order, quote };
      const result = await Tango.Store.executeBuy(executableOrder);
      runtime.state = result.state;
      runtime.modal = null;
      playTradeSound('BUY');
      const chain = Tango.Chains.require(order.token.chain);
      showToast(`${t('buySuccess')} · ${Tango.Format.native(order.amountNative, chain.nativeSymbol, language())} ${order.token.symbol}`, 'success');
    } catch (error) { runtime.modal = null; showToast(t(error.message), 'error'); }
    finally { runtime.tradePending = false; }
  }

  async function sell(percent, context = runtime.current, routeCapture = captureRoute()) {
    primeTradeAudio();
    if (!routeCaptureIsCurrent(routeCapture)) return;
    const order = { token: context?.token, quote: null, percent: Number(percent), sourceUrl: location.href };
    try {
      if (activeChain()?.id !== order.token?.chain) throw new Error('unsupportedChain');
      const key = Tango.Engine.positionKey(order.token?.chain, order.token?.address);
      const position = runtime.state.positions[key];
      if (!position) throw new Error('noPosition');
      if (!(order.percent > 0 && order.percent <= 100)) throw new Error('invalidAmount');
      order.quote = resolvePaperTradeQuote(context?.token, context?.quote, { position });
      if (!order.quote) throw new Error('invalidQuote');
      refreshPaperQuoteInBackground(order.token);
      const validation = Tango.Engine.validateQuote(order.quote, Date.now(), undefined, persistedQuoteContext(order.token));
      if (!validation.ok) throw new Error(validation.reason);
      if (requiresConfirmation()) {
        const valuationRow = displaysMarketCapValuation(order.quote)
          ? [t('marketCap'), Tango.Format.usd(order.quote.marketCapUsd, language(), true)]
          : [t('observedPrice'), Tango.Format.usd(order.quote.priceUsd, language())];
        runtime.modal = {
          type: 'confirm', title: t('simulatedSell'),
          rows: [[t('token'), order.token.symbol], [t('amount'), `${percent}%`], valuationRow],
          note: order.quote.provisional === true ? t('provisionalQuote') : undefined,
          allowSessionSuppress: true,
          action: () => commitSell(order, routeCapture)
        };
        return render();
      }
      await commitSell(order, routeCapture);
    } catch (error) { showToast(t(error.message), 'error'); }
  }

  async function sellPosition(position, percent) {
    if (activeChain()?.id !== position.chain) return showToast(t('unsupportedChain'), 'error');
    const routeCapture = captureRoute();
    const token = { chain: position.chain, address: position.tokenAddress, symbol: position.symbol };
    const quote = resolvePaperTradeQuote(token, positionQuote(position), { position });
    if (!quote) return showToast(t('invalidQuote'), 'error');
    refreshPaperQuoteInBackground(token);
    await sell(percent, { token, quote }, routeCapture);
  }

  async function commitSell(order, routeCapture = captureRoute()) {
    if (!routeCaptureIsCurrent(routeCapture)) return;
    if (runtime.tradePending) return;
    runtime.tradePending = true;
    try {
      if (!routeCaptureIsCurrent(routeCapture) || activeChain()?.id !== order.token?.chain) throw new Error('unsupportedChain');
      const position = persistedQuoteContext(order.token);
      const quote = paperExecutableQuote(order.token, order.quote, position);
      if (!quote) throw new Error('invalidQuote');
      const executableOrder = { ...order, quote };
      const result = await Tango.Store.executeSell(executableOrder);
      runtime.state = result.state;
      runtime.modal = null;
      playTradeSound('SELL');
      showToast(`${t('sellSuccess')} · ${order.percent}% ${order.token.symbol}`, 'success');
    } catch (error) { runtime.modal = null; showToast(t(error.message), 'error'); }
    finally { runtime.tradePending = false; }
  }

  function requestCloseAll() {
    const routeCapture = captureRoute();
    const chain = activeChain();
    if (!chain) return showToast(t('unsupportedChain'), 'error');
    const positions = Tango.ChainView.positions(runtime.state, chain.id);
    if (!positions.length) return showToast(t('noPositions'), 'error');
    const summary = Tango.Engine.portfolioSummary(runtime.state, chain.id, currentNativePriceUsd());
    const usdMode = runtime.settings?.displayCurrency === 'USD';
    runtime.modal = {
      type: 'confirm', title: t('closeAllConfirm'),
      rows: [[t('positions'), positions.length], [t('positionTotal'), usdMode
        ? usdMoney(positionUsdTotal(positions))
        : accountMoney(summary.positionsValueNative)]],
      note: t('closeAllHint'),
      action: () => commitCloseAll(routeCapture)
    };
    render();
  }

  async function commitCloseAll(routeCapture = captureRoute()) {
    if (!routeCaptureIsCurrent(routeCapture)) return;
    if (runtime.tradePending) return;
    runtime.tradePending = true;
    try {
      const active = activeChain();
      if (!routeCaptureIsCurrent(routeCapture) || !active) throw new Error('unsupportedChain');
      const chain = activeChain().id;
      const positions = Tango.ChainView.positions(runtime.state, chain);
      const quoteFailures = new Map();
      const resolvedQuotes = new Map();
      positions.forEach((position) => {
        const key = Tango.Engine.positionKey(position.chain, position.tokenAddress);
        const token = { chain: position.chain, address: position.tokenAddress, symbol: position.symbol };
        const quote = resolvePaperTradeQuote(token, positionQuote(position), { position });
        if (quote) {
          resolvedQuotes.set(key, quote);
          refreshPaperQuoteInBackground(token);
        } else quoteFailures.set(key, 'invalidQuote');
      });
      const orders = Tango.ChainView.closeOrders(runtime.state, chain, (position) => {
        const key = Tango.Engine.positionKey(position.chain, position.tokenAddress);
        const quote = resolvedQuotes.get(key) || null;
        if (!quote && !quoteFailures.has(key)) quoteFailures.set(key, 'quoteLoading');
        return quote;
      });
      const result = await Tango.Store.executeCloseAll(chain, orders);
      runtime.state = result.state;
      runtime.modal = null;
      const closed = result.trades.length;
      const orderKeys = new Set(orders.map((order) => Tango.Engine.positionKey(order.token.chain, order.token.address)));
      const skippedFailures = positions
        .filter((position) => !orderKeys.has(Tango.Engine.positionKey(position.chain, position.tokenAddress)))
        .map((position) => ({
          order: { token: { chain: position.chain, address: position.tokenAddress, symbol: position.symbol } },
          reason: quoteFailures.get(Tango.Engine.positionKey(position.chain, position.tokenAddress)) || 'quoteLoading'
        }));
      const failures = [...skippedFailures, ...(result.failures || [])];
      const failedCount = t('closeAllFailedCount', { count: failures.length });
      const failureDetails = failures.map((failure) => {
        const token = failure?.order?.token || {};
        const identity = token.symbol || String(token.address || '').slice(0, 10) || t('token');
        const reason = failure.reason === 'wrongChain' ? 'unsupportedChain' : failure.reason || 'invalidQuote';
        return `${identity}: ${t(reason)}`;
      }).join('; ');
      if (closed) {
        playTradeSound('SELL');
        const message = failures.length
          ? `${t('closeAllPartial')} · ${closed}/${positions.length} · ${failedCount} · ${failureDetails}`
          : `${t('closeAllSuccess')} · ${closed}`;
        showToast(message, failures.length ? 'error' : 'success');
      } else showToast(failures.length
        ? `${t('closeAllPartial')} · ${failedCount} · ${failureDetails}`
        : t('invalidQuote'), 'error');
    } catch (error) { runtime.modal = null; showToast(t(error.message), 'error'); }
    finally { runtime.tradePending = false; }
  }

  async function sellBreakeven() {
    const routeCapture = captureRoute();
    const position = currentPosition();
    if (!position) return showToast(t('noPosition'), 'error');
    const quote = resolvePaperTradeQuote(runtime.current?.token, runtime.current?.quote, { position });
    if (!quote) return showToast(t('invalidQuote'), 'error');
    refreshPaperQuoteInBackground(runtime.current.token);
    const percent = Tango.Engine.breakevenSellPercent(position, quote, runtime.settings);
    if (!(percent > 0 && percent <= 100)) return showToast(t('breakevenUnavailable'), 'error');
    await sell(percent);
  }

  function showToast(message, type) {
    runtime.toast = { message, type };
    render();
    clearTimeout(runtime.toastTimer);
    runtime.toastTimer = setTimeout(() => { runtime.toast = null; render(); }, 2600);
  }

  async function patchRuntimeSettings(patch, fallbackSettings = runtime.settings) {
    try {
      runtime.settings = await Tango.Store.patchSettings(patch);
      render();
      return true;
    } catch {
      try {
        const data = await Tango.Store.getAll();
        runtime.state = data.state;
        runtime.settings = data.settings;
      } catch {
        runtime.settings = fallbackSettings;
      }
      showToast(t('settingsSaveFailed'), 'error');
      return false;
    }
  }

  function primeTradeAudio() {
    if (!runtime.settings?.soundEnabled) return;
    try {
      if (!runtime.tradeSounds && global.Audio) {
        runtime.tradeSounds = {
          BUY: new global.Audio('https://gmgn.ai/static/sounds/Handgun.mp3'),
          SELL: new global.Audio('https://gmgn.ai/static/sounds/Kaching.mp3')
        };
        Object.values(runtime.tradeSounds).forEach((audio) => {
          audio.preload = 'auto';
          audio.volume = 0.55;
        });
      }
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return null;
      if (!runtime.audioContext || runtime.audioContext.state === 'closed') runtime.audioContext = new AudioContext();
      if (runtime.audioContext.state === 'suspended') runtime.audioContext.resume().catch(() => {});
      return runtime.audioContext;
    } catch { return null; }
  }

  function playTradeSound(side) {
    const context = primeTradeAudio();
    const sound = runtime.tradeSounds?.[side];
    if (sound) {
      try {
        sound.currentTime = 0;
        const playback = sound.play();
        if (playback?.catch) playback.catch(() => playFallbackTradeSound(side, context));
        return;
      } catch { /* Fall through to a short locally generated cue. */ }
    }
    playFallbackTradeSound(side, context);
  }

  function playFallbackTradeSound(side, context) {
    if (!context) return;
    try {
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
      gain.connect(context.destination);
      const notes = side === 'BUY' ? [660, 880] : [520, 390];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(context.currentTime + index * 0.09);
        oscillator.stop(context.currentTime + 0.2 + index * 0.09);
      });
    } catch { /* Audio can be blocked by browser policy; the visual confirmation remains. */ }
  }

  function renderBar(summary) {
    const collapsed = runtime.settings.barCollapsed;
    const usdSummary = canonicalUsdSummary();
    const pnl = usdSummary ? usdSummary.pnlUsd : summary.totalPnlNative;
    const pnlMoney = usdSummary ? usdMoney(pnl, true) : accountMoney(pnl, true);
    return `<div class="tango-bar tango-card ${esc(runtime.settings.pnlBarPosition)} ${collapsed ? 'collapsed' : ''}" style="${floatingStyle(runtime.settings.barPosition)}">
      <div class="tango-bar-main" data-action="toggle-drawer">
        ${collapsed ? `<strong class="${pnlClass(pnl)}">${pnlMoney}</strong>` : `
          <span class="tango-paper-badge tango-bar-paper">${t('paper')}</span>
          <div class="tango-stat tango-pnl-hero"><strong class="${pnlClass(pnl)}">${pnlMoney}</strong><span>${t('pnl')}</span></div>`}
        <span class="tango-bar-hint">${t('clickForPositions')} · ${summary.positionCount}</span>
      </div>
      <button class="tango-icon-button" data-action="collapse-bar">${collapsed ? '＋' : '－'}</button>
    </div>`;
  }

  function calendarDateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function renderPnlCalendar() {
    if (!runtime.calendarOpen) return '';
    const chain = activeChain();
    if (!chain) return '';
    const daily = Tango.ChainView.daily(runtime.state, chain.id);
    const date = runtime.calendarMonth;
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const today = new Date();
    const labels = Array.from({ length: 7 }, (_, index) => new Date(2023, 0, index + 1)
      .toLocaleDateString(language(), { weekday: 'narrow' }));
    const cells = Array.from({ length: firstDay }, () => '<span class="tango-calendar-empty"></span>');
    let monthPnl = 0;
    let activeDays = 0;
    for (let day = 1; day <= days; day += 1) {
      const key = calendarDateKey(year, month, day);
      const pnl = Number(daily[key]?.native || 0);
      monthPnl += pnl;
      if (pnl !== 0) activeDays += 1;
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
      cells.push(`<div class="tango-calendar-day ${pnl > 0 ? 'win' : pnl < 0 ? 'loss' : ''} ${isToday ? 'today' : ''}"><span>${day}</span><strong class="${pnlClass(pnl)}">${pnl ? accountMoney(pnl, true) : '—'}</strong></div>`);
    }
    return `<div class="tango-calendar tango-card">
      <div class="tango-calendar-header"><div><span class="tango-paper-badge">${t('paper')}</span><strong>${t('pnlCalendar')}</strong></div><button class="tango-icon-button" data-action="close-calendar">×</button></div>
      <div class="tango-calendar-summary"><div><span>${t('totalPnl')}</span><strong class="${pnlClass(monthPnl)}">${accountMoney(monthPnl, true)}</strong></div><div><span>${t('date')}</span><strong>${activeDays}</strong></div></div>
      <div class="tango-calendar-nav"><button class="tango-icon-button" data-action="calendar-prev">‹</button><strong>${date.toLocaleDateString(language(), { year: 'numeric', month: 'long' })}</strong><button class="tango-icon-button" data-action="calendar-next">›</button></div>
      <div class="tango-calendar-grid">${labels.map((label) => `<span class="tango-calendar-label">${esc(label)}</span>`).join('')}${cells.join('')}</div>
      <div class="tango-calendar-actions">
        <button class="tango-button tango-calendar-dashboard" data-action="dashboard-history">${t('currentChainTrades')} ↗</button>
        <button class="tango-button tango-calendar-dashboard" data-action="dashboard-calendar">${t('openDashboard')} · ${t('pnlCalendar')} ↗</button>
      </div>
    </div>`;
  }

  function clearHeaderAccountSummary() {
    const node = document.querySelector('#tango-header-account-summary');
    node?.parentElement?.classList.remove('tango-header-summary-anchor', 'tango-wallet-summary-anchor');
    node?.remove();
  }

  function ensureHeaderAccountSummaryStyle() {
    if (document.querySelector('#tango-header-account-summary-style')) return;
    const style = document.createElement('style');
    style.id = 'tango-header-account-summary-style';
    style.textContent = `
      .tango-header-summary-anchor { overflow: visible !important; position: relative !important; }
      #tango-header-account-summary {
        align-items: center; background: rgba(12,13,18,.96); border: 1px solid rgba(155,124,255,.34);
        border-radius: 8px; color: #aeb1bd; cursor: pointer; display: flex; font: 650 12px/24px Inter,ui-sans-serif,system-ui,sans-serif;
        gap: 8px; padding: 4px 9px; pointer-events: auto; position: absolute; right: 0;
        top: calc(100% + 2px); white-space: nowrap; width: max-content; z-index: 80;
      }
      #tango-header-account-summary:hover { background: rgba(25,22,39,.98); border-color: rgba(155,124,255,.65); }
      #tango-header-account-summary strong { color: #72f0bd; font-size: 14px; font-weight: 900; }
      #tango-header-account-summary i { background: rgba(255,255,255,.12); height: 13px; width: 1px; }
      #tango-header-account-summary .tango-header-paper-badge { color: #c9bcff; font-size: 10px; font-weight: 850; letter-spacing: .04em; }
      #tango-header-account-summary .tango-header-calendar-link { color: #d8d0ff; font-size: 11px; font-weight: 800; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function renderHeaderAccountSummary(summary) {
    const anchor = document.querySelector('[data-testid="wallet-connected"]')
      || document.querySelector('[data-testid="header-actions"]');
    const chain = activeChain();
    const account = activeAccount();
    if (!anchor || !summary || !chain || !account) {
      clearHeaderAccountSummary();
      return;
    }
    ensureHeaderAccountSummaryStyle();
    let node = document.querySelector('#tango-header-account-summary');
    if (!node) {
      node = document.createElement('div');
      node.id = 'tango-header-account-summary';
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.onpointerdown = (event) => event.stopPropagation();
      node.onclick = (event) => { event.preventDefault(); event.stopPropagation(); runtime.calendarOpen = !runtime.calendarOpen; render(); };
      node.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); runtime.calendarOpen = !runtime.calendarOpen; render();
      };
    }
    if (node.parentElement !== anchor) {
      node.parentElement?.classList.remove('tango-header-summary-anchor', 'tango-wallet-summary-anchor');
      anchor.appendChild(node);
    }
    anchor.classList.add('tango-header-summary-anchor');
    const cash = Tango.Format.native(account.cashBalanceNative, chain.nativeSymbol, language());
    const markup = `<span class="tango-header-paper-badge">${esc(t('paper'))}</span><span>${esc(t('paperBalance'))} <strong>${esc(cash)}</strong></span><i></i><span class="tango-header-calendar-link">▦ ${esc(t('pnlCalendar'))}</span>`;
    if (node.innerHTML !== markup) node.innerHTML = markup;
    node.title = t('pnlCalendar');
  }

  function renderPresetGrid(side, values) {
    if (runtime.presetEditing === 'all') {
      return values.map((value, index) => `<input class="tango-preset-editor ${side}" data-preset-side="${side}" data-preset-index="${index}" type="number" min="0.0001" ${side === 'sell' ? 'max="100"' : ''} step="any" value="${esc(value)}">`).join('');
    }
    const attribute = side === 'buy' ? 'data-buy' : 'data-sell';
    return values.map((value) => `<button class="tango-button tango-preset ${side}-preset" ${attribute}="${value}">${value}${side === 'sell' ? '%' : ''}</button>`).join('');
  }

  async function savePresetEdits() {
    const readValues = (side) => [...shadow.querySelectorAll(`[data-preset-side="${side}"]`)].map((input) => Number(input.value));
    const buyValues = readValues('buy');
    const sellValues = readValues('sell');
    const validBuy = buyValues.length === 8 && buyValues.every((value) => Number.isFinite(value) && value > 0);
    const validSell = sellValues.length === 8 && sellValues.every((value) => Number.isFinite(value) && value > 0 && value <= 100);
    if (!validBuy || !validSell) return showToast(t('invalidPresets'), 'error');
    const chain = activeChain();
    if (!chain || !chainSettings()) return showToast(t('unsupportedChain'), 'error');
    runtime.presetEditing = null;
    try {
      runtime.settings = await Tango.Store.patchSettings({
        chains: { [chain.id]: { buyPresets: buyValues } },
        sellPresets: sellValues
      });
      showToast(t('presetsSaved'), 'success');
    } catch {
      showToast(t('settingsSaveFailed'), 'error');
    }
  }

  function renderPanel() {
    if (!runtime.state.initialized || !runtime.settings.enabled) return '';
    const chain = activeChain();
    const account = activeAccount();
    const settings = chainSettings();
    if (!chain || !account || !settings) return '';
    const current = runtime.current;
    if (!current?.token || current.token.chain !== chain.id) return '';
    const position = currentPosition();
    const liveQuote = executableQuote(current.token, current.quote);
    const paperQuote = liveQuote || resolvePaperTradeQuote(current.token, current.quote, { position });
    const mark = position ? Tango.Engine.markPosition(position, paperQuote, currentNativePriceUsd()) : null;
    const quoteValid = Boolean(paperQuote);
    const symbol = current?.token?.symbol || 'GMGN';
    const tokenTrades = current ? Tango.ChainView.trades(runtime.state, chain.id).filter((trade) =>
      trade.chain === current.token.chain
      && Tango.Chains.normalizeAddress(trade.chain, trade.tokenAddress)
        === Tango.Chains.normalizeAddress(current.token.chain, current.token.address)
    ) : [];
    const totalBuy = tokenTrades.filter((trade) => trade.side === 'BUY').reduce((sum, trade) => sum + Number(trade.amountNative || 0), 0);
    const totalSell = tokenTrades.filter((trade) => trade.side === 'SELL').reduce((sum, trade) => sum + Number(trade.amountNative || 0), 0);
    const totalProfit = tokenTrades.filter((trade) => trade.side === 'SELL').reduce((sum, trade) => sum + Number(trade.realizedPnlNative || 0), 0) + Number(mark?.unrealizedPnlNative || 0);
    const feePercent = Number(runtime.settings.platformFeeBps || 0) / 100;
    const breakevenPercent = Tango.Engine.breakevenSellPercent(position, paperQuote, runtime.settings);
    const breakevenLabel = breakevenPercent ? `${t('breakeven')} ${Tango.Format.number(breakevenPercent, language(), 1)}%` : t('breakeven');
    return `<div class="tango-panel tango-card ${runtime.settings.panelCollapsed ? 'collapsed' : ''}" style="${panelStyle()}">
      <div class="tango-header" data-drag-handle>
        <div class="tango-token-strip"><span class="tango-paper-logo">T</span><strong>TANGO</strong><span class="tango-paper-badge">${t('paper')}</span><span>${esc(symbol)}</span></div>
        <div class="tango-header-actions"><button class="tango-icon-button tango-edit-all" data-action="${runtime.presetEditing === 'all' ? 'save-presets' : 'edit-presets'}" title="${t(runtime.presetEditing === 'all' ? 'savePresets' : 'editPresets')}">${runtime.presetEditing === 'all' ? '✓' : '✎'}</button><button class="tango-icon-button" data-action="toggle-sound" title="${t('sound')}">${runtime.settings.soundEnabled ? '🔊' : '🔇'}</button><button class="tango-icon-button" data-action="dashboard">⚙</button><button class="tango-icon-button" data-action="collapse-panel">${runtime.settings.panelCollapsed ? '＋' : '×'}</button></div>
      </div>
      ${runtime.settings.panelCollapsed ? '' : `<div class="tango-trade-body">
        <section class="tango-trade-block">
          <div class="tango-trade-title buy-title"><span>${t('buy')}</span><span class="tango-title-balance">◎ ${Tango.Format.native(account.cashBalanceNative, chain.nativeSymbol, language())}</span></div>
          <div class="tango-preset-grid">${renderPresetGrid('buy', settings.buyPresets)}</div>
          <div class="tango-trade-meta"><span>⌁ ${Tango.Format.percent(runtime.settings.slippageBps / 100, language())}</span><span>♜ ${Tango.Format.native(settings.networkFeeNative, chain.nativeSymbol, language())}</span><span>♙ ${feePercent}%</span><span class="safe">${t('entryMc')} ${position ? Tango.Format.usd(position.averageEntryMarketCap, language(), true) : '--'}</span></div>
        </section>
        <section class="tango-trade-block">
          <div class="tango-trade-title sell-title"><span>${t('sell')} %</span><span class="tango-title-balance">${position ? `${Tango.Format.compact(position.quantity, language(), 2)} ${esc(symbol)}` : `0 ${esc(symbol)}`}</span></div>
          <div class="tango-preset-grid">${renderPresetGrid('sell', runtime.settings.sellPresets)}</div>
          <div class="tango-trade-meta"><span>⌁ ${runtime.settings.fastMode ? 'FAST' : t('auto')}</span><span>♜ ${Tango.Format.native(settings.networkFeeNative, chain.nativeSymbol, language())}</span><button class="tango-breakeven-link" data-action="breakeven" ${breakevenPercent ? '' : 'disabled'} title="${esc(breakevenPercent ? breakevenLabel : t('breakevenUnavailable'))}">${esc(breakevenLabel)}</button><span class="safe">${t('currentMc')} ${Tango.Format.usd(current.quote.marketCapUsd, language(), true)}</span></div>
        </section>
        <div class="tango-summary-grid">
          <div class="tango-summary-item tango-paper-balance-summary"><span>${t('paperBalance')}</span><strong>${accountMoney(account.cashBalanceNative)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalBuy')}</span><strong>${accountMoney(totalBuy)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalSell')}</span><strong>${accountMoney(totalSell)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalProfit')}</span><strong class="${pnlClass(totalProfit)}">${accountMoney(totalProfit, true)}</strong></div>
        </div>
        <div class="tango-bottom-details">
          <span>${t('entryMc')} <strong>${position ? Tango.Format.usd(position.averageEntryMarketCap, language(), true) : '--'}</strong></span>
          <span>${t('currentMc')} <strong>${Tango.Format.usd(current.quote.marketCapUsd, language(), true)}</strong></span>
          <span>${t('pnl')} <strong class="${pnlClass(mark?.unrealizedPnlNative)}">${position ? Tango.Format.percent(mark.roi, language(), true) : '--'}</strong></span>
          <span>${t('pnlAmount')} <strong class="${pnlClass(totalProfit)}">${accountMoney(totalProfit, true)}</strong></span>
        </div>
        ${paperQuote?.provisional === true
          ? `<div class="tango-warning">${t('provisionalQuote')}</div>`
          : quoteValid ? '' : `<div class="tango-warning">${t('quoteLoading')}</div>`}
      </div>`}
    </div>`;
  }

  function panelStyle() {
    const pos = runtime.settings.panelPosition;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return '';
    return `left:${Math.max(0,pos.x)}px;top:${Math.max(0,pos.y)}px;right:auto;transform:none;`;
  }

  function floatingStyle(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return '';
    return `left:${Math.max(0, position.x)}px;top:${Math.max(0, position.y)}px;right:auto;bottom:auto;transform:none;`;
  }

  function renderDrawer(summary) {
    if (!runtime.drawerOpen) return '';
    const positions = Tango.ChainView.positions(runtime.state, activeChain().id);
    const usdMode = runtime.settings?.displayCurrency === 'USD';
    return `<div class="tango-drawer tango-card" style="${floatingStyle(runtime.settings.drawerPosition)}">
      <div class="tango-drawer-header" data-drawer-drag><div class="tango-brand"><span class="tango-dot"></span>${t('openPositions')}</div><div class="tango-drawer-actions"><button class="tango-button tango-close-all" data-action="close-all" ${positions.length ? '' : 'disabled'}>${t('closeAll')}</button><button class="tango-icon-button" data-action="toggle-drawer">✕</button></div></div>
      <div class="tango-position-total"><span>${t('positionTotal')}</span><strong>${usdMode ? usdMoney(positionUsdTotal(positions)) : accountMoney(summary.positionsValueNative)}</strong><small>${positions.length} ${t('positions')}</small></div>
      ${positions.length ? positions.map((position) => {
        const liveQuote = freshExecutableQuote(position);
        const mark = Tango.Engine.markPosition(position, liveQuote, currentNativePriceUsd());
        const positionValue = usdMode
          ? usdMoney(positionUsdValue(position, mark))
          : accountMoney(mark.valueNative);
        return `<div class="tango-position">
          <div class="tango-row"><button class="tango-position-link" data-position-open data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}" title="${t('openToken')}">${position.logoUrl ? `<img src="${esc(position.logoUrl)}" alt="">` : `<span class="tango-position-fallback">${esc(position.symbol.slice(0, 1))}</span>`}<span><strong>${esc(position.symbol)} ↗</strong><small>${esc(position.name || position.tokenAddress.slice(0, 8))}</small></span></button><strong class="${pnlClass(mark.unrealizedPnlNative)}">${accountMoney(mark.unrealizedPnlNative, true)} · ${Tango.Format.percent(mark.roi, language(), true)}</strong></div>
          <div class="tango-position-meta"><span>${t('value')} ${positionValue}</span><span>${t('cost')} ${accountMoney(position.costBasisNative)}</span><span>${t('held')} ${Tango.Format.duration(Date.now()-position.openedAt, language())}</span></div>
          <div class="tango-mini-actions">
            <button class="tango-button sell-position" data-position-sell="25" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}">25%</button>
            <button class="tango-button sell-position" data-position-sell="50" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}">50%</button>
            <button class="tango-button sell-position" data-position-sell="100" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}">${t('close')}</button>
          </div>${liveQuote ? '' : `<div class="tango-position-note">${t('lastKnownPrice')}</div>`}
        </div>`;
      }).join('') : `<div class="tango-empty">${t('noPositions')}</div>`}
    </div>`;
  }

  function chartMarkerPayload() {
    const chain = activeChain();
    if (!chain || !runtime.current?.token || runtime.current.token.chain !== chain.id) return { markers: [] };
    return Tango.Markers.buildPayload({
      current: runtime.current,
      position: currentPosition(),
      trades: Tango.ChainView.trades(runtime.state, chain.id),
      labels: { entry: t('paperBuy'), exit: t('paperSell'), hide: t('hideChartLine') }
    });
  }

  function syncChartMarkers(force = false) {
    const frames = document.querySelectorAll('iframe[title="Financial Chart"], [data-sentry-component="TradingView"] iframe');
    if (!frames.length) return;
    const payload = chartMarkerPayload();
    const signature = JSON.stringify(payload);
    frames.forEach((frame) => {
      if (!force && runtime.markerPayloads.get(frame) === signature) return;
      runtime.markerPayloads.set(frame, signature);
      frame.contentWindow?.postMessage({ source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload }, '*');
    });
  }

  function renderModal() {
    if (!runtime.modal) return '';
    return `<div class="tango-modal-backdrop"><div class="tango-modal tango-card"><h3>${esc(runtime.modal.title)}</h3>
      <div class="tango-confirm-list">${runtime.modal.rows.map(([label,value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      ${runtime.modal.note ? `<div class="tango-warning">${esc(runtime.modal.note)}</div>` : ''}
      ${runtime.modal.allowSessionSuppress ? `<label class="tango-session-confirm"><input id="tango-skip-session-confirm" type="checkbox"><span>${t('skipConfirmSession')}</span></label>` : ''}
      <div class="tango-modal-actions"><button class="tango-button" data-action="cancel-modal">${t('cancel')}</button><button class="tango-button primary" data-action="confirm-modal">${t('confirm')}</button></div>
    </div></div>`;
  }

  function render() {
    const chain = activeChain();
    if (!chain) {
      clearChainContext();
      return;
    }
    if (!runtime.state || !runtime.settings) return;
    if (!runtime.settings.enabled || !runtime.state.initialized) {
      Tango.GMGN.clearQuickBuy();
      clearShellMarkup();
      clearHeaderAccountSummary();
      return;
    }
    const summary = Tango.Engine.portfolioSummary(runtime.state, activeChain().id, currentNativePriceUsd());
    renderHeaderAccountSummary(summary);
    const markup = `${renderBar(summary)}${renderPanel()}${renderDrawer(summary)}${renderPnlCalendar()}${renderModal()}${runtime.toast ? `<div class="tango-toast ${esc(runtime.toast.type)}">${esc(runtime.toast.message)}</div>` : ''}`;
    if (runtime.renderedMarkup !== markup) {
      shell.innerHTML = markup;
      runtime.renderedMarkup = markup;
      bindEvents();
    }
    syncChartMarkers();
  }

  function bindEvents() {
    shell.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', () => buy(Number(button.dataset.buy))));
    shell.querySelectorAll('[data-sell]').forEach((button) => button.addEventListener('click', () => sell(Number(button.dataset.sell))));
    shell.querySelectorAll('[data-position-open]').forEach((button) => button.addEventListener('click', () => {
      const position = runtime.state.positions[button.dataset.key];
      if (position) openPosition(position);
    }));
    shell.querySelectorAll('[data-position-sell]').forEach((button) => button.addEventListener('click', () => {
      const position = runtime.state.positions[button.dataset.key];
      if (position) sellPosition(position, Number(button.dataset.positionSell));
    }));
    shell.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = element.dataset.action;
      if (action === 'toggle-drawer') { runtime.drawerOpen = !runtime.drawerOpen; render(); }
      if (action === 'collapse-bar') {
        const barCollapsed = !runtime.settings.barCollapsed;
        await patchRuntimeSettings({ barCollapsed });
      }
      if (action === 'collapse-panel') {
        const panelCollapsed = !runtime.settings.panelCollapsed;
        await patchRuntimeSettings({ panelCollapsed });
      }
      if (action === 'dashboard') {
        chrome.runtime.sendMessage({ type: 'TANGO_OPEN_DASHBOARD' })
          .then((response) => { if (!response?.ok) showToast(t('openDashboardFailed'), 'error'); })
          .catch(() => showToast(t('openDashboardFailed'), 'error'));
      }
      if (action === 'dashboard-calendar') {
        chrome.runtime.sendMessage({ type: 'TANGO_OPEN_DASHBOARD', tab: 'calendar', chain: activeChain()?.id })
          .then((response) => { if (!response?.ok) showToast(t('openDashboardFailed'), 'error'); })
          .catch(() => showToast(t('openDashboardFailed'), 'error'));
      }
      if (action === 'dashboard-history') {
        chrome.runtime.sendMessage({ type: 'TANGO_OPEN_DASHBOARD', tab: 'history', chain: activeChain()?.id })
          .then((response) => { if (!response?.ok) showToast(t('openDashboardFailed'), 'error'); })
          .catch(() => showToast(t('openDashboardFailed'), 'error'));
      }
      if (action === 'toggle-sound') {
        const soundEnabled = !runtime.settings.soundEnabled;
        await patchRuntimeSettings({ soundEnabled });
      }
      if (action === 'breakeven') await sellBreakeven();
      if (action === 'close-all') requestCloseAll();
      if (action === 'close-calendar') { runtime.calendarOpen = false; render(); }
      if (action === 'calendar-prev') { runtime.calendarMonth = new Date(runtime.calendarMonth.getFullYear(), runtime.calendarMonth.getMonth() - 1, 1); render(); }
      if (action === 'calendar-next') { runtime.calendarMonth = new Date(runtime.calendarMonth.getFullYear(), runtime.calendarMonth.getMonth() + 1, 1); render(); }
      if (action === 'edit-presets') { runtime.presetEditing = 'all'; render(); }
      if (action === 'save-presets') await savePresetEdits();
      if (action === 'cancel-modal') { runtime.modal = null; render(); }
      if (action === 'confirm-modal') {
        const suppressForSession = Boolean(runtime.modal?.allowSessionSuppress && shadow.querySelector('#tango-skip-session-confirm')?.checked);
        const callback = runtime.modal?.action;
        if (callback) await callback();
        if (suppressForSession) {
          runtime.suppressConfirmForSession = true;
          await chrome.runtime.sendMessage({ type: 'TANGO_SET_SESSION_CONFIRM', suppressed: true }).catch(() => null);
        }
      }
    }));
    shell.querySelectorAll('.tango-preset-editor').forEach((input) => input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') await savePresetEdits();
    }));
    bindDrag();
  }

  function bindDrag() {
    bindDraggable('[data-drag-handle]', '.tango-panel', 'panelPosition');
    bindDraggable('[data-drawer-drag]', '.tango-drawer', 'drawerPosition');
    bindDraggable('.tango-bar', '.tango-bar', 'barPosition');
  }

  function bindDraggable(handleSelector, elementSelector, settingKey) {
    const handle = shadow.querySelector(handleSelector);
    const element = shadow.querySelector(elementSelector);
    if (!handle || !element) return;
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      const rect = element.getBoundingClientRect();
      const startX = event.clientX; const startY = event.clientY;
      const fallbackSettings = { ...runtime.settings, [settingKey]: runtime.settings[settingKey] };
      let dragged = false;
      const onMove = (move) => {
        if (!dragged && Math.hypot(move.clientX - startX, move.clientY - startY) < 5) return;
        dragged = true;
        move.preventDefault();
        const position = {
          x: Math.min(Math.max(0, innerWidth - rect.width), Math.max(0, rect.left + move.clientX - startX)),
          y: Math.min(Math.max(0, innerHeight - rect.height), Math.max(0, rect.top + move.clientY - startY))
        };
        runtime.settings = { ...runtime.settings, [settingKey]: position };
        element.style.left = `${position.x}px`;
        element.style.top = `${position.y}px`;
        element.style.right = 'auto'; element.style.bottom = 'auto'; element.style.transform = 'none';
      };
      const onUp = async () => {
        global.removeEventListener('pointermove', onMove); global.removeEventListener('pointerup', onUp); global.removeEventListener('pointercancel', onUp);
        if (!dragged) return;
        const suppressClick = (click) => { click.preventDefault(); click.stopImmediatePropagation(); };
        element.addEventListener('click', suppressClick, true);
        setTimeout(() => element.removeEventListener('click', suppressClick, true), 0);
        await patchRuntimeSettings({ [settingKey]: runtime.settings[settingKey] }, fallbackSettings);
      };
      global.addEventListener('pointermove', onMove); global.addEventListener('pointerup', onUp); global.addEventListener('pointercancel', onUp);
    });
  }

  function handleRouteChange() {
    if (location.href === runtime.lastUrl) return;
    const previousRouteIdentity = runtime.routeIdentity ?? currentRouteIdentity(runtime.lastUrl);
    runtime.lastUrl = location.href;
    advanceRouteEpoch();
    const nextChainId = activeChain()?.id || null;
    const currentNoLongerMatches = runtime.current
      && Tango.GMGN.resolveCurrentTokenRead(runtime.current, null) !== runtime.current;
    if (nextChainId !== runtime.activeChainId || runtime.routeIdentity !== previousRouteIdentity
      || currentNoLongerMatches) {
      clearChainContext();
    } else runtime.modal = null;
    runtime.activeChainId = nextChainId;
    if (!nextChainId) {
      clearChainContext();
      return;
    }
    queueRender();
    window.postMessage({ source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' }, '*');
    tickQuote();
  }

  async function start() {
    runtime.routeIdentity = currentRouteIdentity();
    const session = await chrome.runtime.sendMessage({ type: 'TANGO_GET_SESSION_CONFIRM' }).catch(() => null);
    runtime.suppressConfirmForSession = Boolean(session?.suppressed);
    runtime.activeChainId = activeChain()?.id || null;
    await refresh();
    await tickQuote();
    runtime.quoteTimer = setInterval(tickQuote, 3000);
    runtime.markerTimer = setInterval(syncChartMarkers, 1000);
    runtime.routeTimer = setInterval(handleRouteChange, 150);
    let mutationTimer;
    runtime.observer = new MutationObserver(() => {
      if (location.href !== runtime.lastUrl) {
        handleRouteChange();
      }
      if (mutationTimer) return;
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        syncQuickBuyButtons();
        if (runtime.settings?.enabled && runtime.state?.initialized) {
          renderHeaderAccountSummary({});
          if (Tango.GMGN.needsCurrentTokenRead(runtime.current)) tickQuote();
        }
        if (document.querySelector('iframe[title="Financial Chart"], [data-sentry-component="TradingView"] iframe')) syncChartMarkers();
      }, 160);
    });
    runtime.observer.observe(document.body, { childList: true, subtree: true });
    const handleQuickBuyAmountChange = (event) => {
      if (event.target?.closest?.('[data-sentry-component="BuyAmountInput"]')) queueQuickBuySync();
    };
    document.addEventListener('input', handleQuickBuyAmountChange, true);
    document.addEventListener('change', handleQuickBuyAmountChange, true);
    Tango.Store.subscribe(refresh);
  }

  start().catch((error) => console.error('[Tango Paper Trader]', error));
})(globalThis);
