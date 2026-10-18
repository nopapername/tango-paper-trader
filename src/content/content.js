(function initContent(global) {
  if (global.__tangoPaperTraderLoaded) return;
  global.__tangoPaperTraderLoaded = true;

  const Tango = global.Tango;
  const runtime = {
    afterBuyDetailModes: {}, afterBuyDetailRevision: 0,
    state: null, settings: null, current: null, drawerOpen: false, modal: null, extensionInvalidated: false,
    toast: null, lastQuoteWriteAt: 0, lastQuoteWriteKey: null, quoteTimer: null, observer: null, renderQueued: false,
    presetEditing: null, presetDraft: null, suppressConfirmForSession: false, audioContext: null, tradeSounds: null,
    nativePrices: new Map(), nativePriceObservedAt: new Map(), nativePricePromises: new Map(),
    persistentNativePrices: new Map(), persistentNativePriceObservedAt: new Map(),
    quoteRequests: new Map(), quoteRetryAt: new Map(),
    gmgnQuotes: new Map(), persistentGmgnQuotes: new Map(),
    quickBuyLocks: new Map(), lastUrl: location.href, routeTimer: null,
    markerTimer: null, interactionUntil: 0, renderDeferralTimer: null, tradePending: false,
    refreshRetryTimer: null, refreshRetryDelay: 500, floatingGesture: false, cancelFloatingResize: null,
    pnlDateKey: null, calendarOpen: false, calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    renderedMarkup: null, markerPayloads: new WeakMap(), markerFrameListeners: new WeakSet(),
    chartFrameRoutes: new WeakMap(), chartFrameReadyBeforeLoad: new WeakSet(),
    chartFrameAwaitingReady: new WeakSet(), chartFrameProbeIds: new WeakMap(), chartProbeSequence: 0,
    chartFrameGenerations: new WeakMap(), chartFrameReadyProbeIds: new WeakMap(),
    chartFrameGenerationSequence: 0,
    chartFrameTentative: new WeakSet(),
    latestMarkerPayload: { markers: [] },
    quickBuySyncQueued: false, activeChainId: null,
    routeEpoch: 0, routeIdentity: null, pendingMutationRoots: new Set(), quickBuyMode: 'unknown', lastSingleChainId: null,
    quickBuySettingsPending: false, quickBuyAuthoritativelyDisabled: false,
    positionCalibrationPromises: new Map(), positionCalibrationTargets: new Map(),
    positionCalibrationDirty: new Set()
  };

  const afterBuyDetailPreferenceKey = 'tangoGmgnAfterBuyDetailV1';
  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName === 'local') {
      for (const [key, change] of Object.entries(changes || {})) {
        if (!key.startsWith(afterBuyDetailPreferenceKey + ':')) continue;
        const scope = key.slice(afterBuyDetailPreferenceKey.length + 1);
        if (!afterBuyDetailScopes().includes(scope)) continue;
        runtime.afterBuyDetailRevision += 1;
        if (validAfterBuyDetailMode(change?.newValue)) runtime.afterBuyDetailModes[scope] = change.newValue;
        else delete runtime.afterBuyDetailModes[scope];
      }
    }
    const settingsKey = Tango.SETTINGS_KEY || 'tangoPaperTraderSettingsV1';
    if (areaName !== 'local'
      || !Object.prototype.hasOwnProperty.call(changes || {}, settingsKey)) return;
    runtime.quickBuySettingsPending = true;
    runtime.quickBuyAuthoritativelyDisabled = changes[settingsKey]?.newValue?.enabled === false;
  });

  const host = document.createElement('div');
  host.id = 'tango-paper-trader-host';
  host.setAttribute('data-tango-version', String(Tango.VERSION || ''));
  host.setAttribute('data-tango-token-open-status', 'idle');
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = chrome.runtime.getURL('src/content/content.css');
  const shell = document.createElement('div');
  shell.className = 'tango-shell';
  shadow.append(stylesheet, shell);
  document.documentElement.appendChild(host);
  const trustedSessionSuppressInputs = new WeakSet();

  function requireTrustedUserEvent(event) {
    if (event?.isTrusted === true) return true;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    return false;
  }

  function blockUntrustedShellEvent(event) {
    requireTrustedUserEvent(event);
  }

  // Remain active when the paper UI is disabled so a second press restores it.
  // Some embedded browsers do not dispatch manifest extension commands.
  window.addEventListener('keydown', async (event) => {
    if (event.isTrusted !== true || event.repeat || event.isComposing
      || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey
      || (event.code !== 'KeyY' && String(event.key || '').toLowerCase() !== 'y')) return;
    event.preventDefault();
    try {
      const response = await sendContentMessage({ type: 'TANGO_TOGGLE_SHORTCUT' });
      if (!response?.ok) showToast(t('settingsSaveFailed'), 'error');
    } catch { showToast(t('settingsSaveFailed'), 'error'); }
  }, true);

  for (const type of ['click', 'keydown', 'change', 'pointerdown']) {
    shell.addEventListener(type, blockUntrustedShellEvent, { capture: true, passive: false });
  }

  shell.addEventListener('pointerdown', (event) => {
    if (event.isTrusted === true) runtime.interactionUntil = Date.now() + 500;
  }, true);

  // Chrome may throw before returning a Promise after an extension reload.
  function noteInvalidatedContext(error) {
    if (!/extension context invalidated|^extensionReloadRequired$/i.test(String(error?.message || ''))) return false;
    runtime.extensionInvalidated = true;
    runtime.cancelFloatingResize?.();
    if (runtime.quoteTimer !== null) clearInterval(runtime.quoteTimer);
    runtime.quoteTimer = null;
    if (runtime.refreshRetryTimer !== null) clearTimeout(runtime.refreshRetryTimer);
    runtime.refreshRetryTimer = null;
    return true;
  }

  async function sendContentMessage(message) {
    if (runtime.extensionInvalidated) throw new Error('extensionReloadRequired');
    try { return await chrome.runtime.sendMessage(message); }
    catch (error) {
      noteInvalidatedContext(error);
      throw error;
    }
  }

  function activeChain() {
    const route = Tango.Chains.fromUrl(location.href);
    if (route) return route;
    if (!combinedTrench()) return null;
    return Tango.Chains.get(runtime.lastSingleChainId) || Tango.Chains.get(runtime.activeChainId)
      || Tango.Chains.get(runtime.settings?.selectedChain) || Tango.Chains.get('sol');
  }
  function accountChainLabel() {
    return combinedTrench() ? ' · ' + String(activeChain()?.id || '').toUpperCase() : '';
  }
  function combinedTrench() { return Tango.GMGN._isCombinedTrenchPage?.() === true; }
  function executionChain(token) {
    if (combinedTrench()) return Tango.Chains.get(token?.chain);
    const pageChain = activeChain();
    return pageChain && token?.chain === pageChain.id ? pageChain : null;
  }
  const quickBuyOrderValidators = new WeakMap();
  const quickBuyDetailIntents = new WeakMap();

  function validAfterBuyDetailMode(mode) { return ['open', 'navigate', 'none'].includes(mode); }
  function afterBuyDetailScopes() { return [...Tango.Chains.all().map(chain => chain.id), 'combined']; }
  function afterBuyDetailScope() { return combinedTrench() ? 'combined' : Tango.Chains.fromUrl(location.href)?.id; }

  function synchronizeAfterBuyDetailPreference(root = document) {
    const scope = afterBuyDetailScope();
    if (!scope) return null;
    const mode = Tango.GMGN.readAfterBuyDetailMode?.(root);
    if (!validAfterBuyDetailMode(mode)) return runtime.afterBuyDetailModes[scope] || null;
    if (mode !== runtime.afterBuyDetailModes[scope]) {
      runtime.afterBuyDetailRevision += 1;
      runtime.afterBuyDetailModes[scope] = mode;
      // UI preference only: never write the simulated ledger or trading settings.
      // Keep per-chain and combined-page preferences from leaking across routes.
      try {
        Promise.resolve(chrome.storage?.local?.set?.({ [afterBuyDetailPreferenceKey + ':' + scope]: mode }))
          .catch(noteInvalidatedContext);
      } catch (error) { noteInvalidatedContext(error); }
    }
    return mode;
  }

  async function loadAfterBuyDetailPreference() {
    const revision = runtime.afterBuyDetailRevision;
    const scopes = afterBuyDetailScopes();
    try {
      const values = await chrome.storage?.local?.get?.(scopes.map(scope => afterBuyDetailPreferenceKey + ':' + scope));
      if (revision === runtime.afterBuyDetailRevision) {
        for (const scope of scopes) {
          const mode = values?.[afterBuyDetailPreferenceKey + ':' + scope];
          if (validAfterBuyDetailMode(mode)) runtime.afterBuyDetailModes[scope] = mode;
        }
      }
    } catch (error) { noteInvalidatedContext(error); }
    synchronizeAfterBuyDetailPreference();
  }

  async function followQuickBuyDetail(order, routeCapture) {
    const mode = quickBuyDetailIntents.get(order);
    quickBuyDetailIntents.delete(order);
    // Storage notifications briefly mark settings pending after a successful
    // trade. That execution guard must not cancel an already-settled UI action.
    if (!routeCaptureIsCurrent(routeCapture) || runtime.extensionInvalidated
      || runtime.quickBuyAuthoritativelyDisabled || runtime.settings?.enabled !== true
      || !['open', 'navigate'].includes(mode)) return;
    const url = Tango.Chains.tokenUrl(order.token.chain, order.token.address);
    if (mode === 'open') {
      await openPosition({ chain: order.token.chain, tokenAddress: order.token.address });
    } else if (!routeMatchesDetailToken(order.token)) {
      try { location.assign(url); }
      catch { showToast(t('openTokenFailed'), 'error'); }
    }
  }

  const combinedQuoteChains = new Set();
  function validateQuickBuyOrder(order) {
    const validate = quickBuyOrderValidators.get(order);
    if (validate && validate() !== true) throw new Error('invalidQuote');
  }
  function paperExecutionDisabled() {
    return runtime.quickBuySettingsPending
      || runtime.quickBuyAuthoritativelyDisabled
      || runtime.settings?.enabled !== true;
  }
  function setContentClass(element, name, enabled) {
    if (!element?.classList) return;
    const present = element.classList.contains?.(name)
      ?? String(element.className || '').split(/\s+/).includes(name);
    if (enabled && !present) element.classList.add(name);
    if (!enabled && present) element.classList.remove(name);
  }
  function applyContentTheme() {
    const theme = Tango.I18n.resolveTheme?.(runtime.settings?.theme)
      || (runtime.settings?.theme === 'light' ? 'light' : 'dark');
    if (host.getAttribute?.('data-theme') !== theme) host.setAttribute?.('data-theme', theme);
    const header = document.querySelector('#tango-header-account-summary');
    if (header && header.getAttribute?.('data-theme') !== theme) header.setAttribute?.('data-theme', theme);
  }
  window.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change', () => {
    if (runtime.settings?.theme === 'auto') applyContentTheme();
  });
  function currentRouteIdentity(url = location.href) {
    const chain = Tango.Chains.fromUrl(url);
    if (!chain) return combinedTrench() ? `combined:${String(url)}` : `unsupported:${String(url)}`;
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
  function routeTokenPlaceholder(url = location.href) {
    const routeToken = detailRouteToken(url);
    if (!routeToken) return null;
    const address = routeToken.address;
    const symbol = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const label = {
      token: {
        chain: routeToken.chain, address, symbol, name: symbol, logoUrl: '',
        metadataVerified: false, metadataSource: ''
      },
      quote: {}
    };
    const matchesRoute = (candidate) => candidate?.token?.chain === routeToken.chain
      && Tango.Chains.validateAddress(routeToken.chain, candidate.token.address || candidate.token.tokenAddress)
      && Tango.Chains.normalizeAddress(routeToken.chain, candidate.token.address || candidate.token.tokenAddress) === address;
    const snapshot = Tango.GMGN.readTrenchSnapshot?.(routeToken.chain, address);
    if (matchesRoute(snapshot)) return {
      token: { ...snapshot.token, chain: routeToken.chain, address }, quote: { ...(snapshot.quote || {}) }
    };
    const position = runtime.state?.positions?.[Tango.Engine.positionKey(routeToken.chain, address)];
    if (position?.chain === routeToken.chain && Tango.Chains.validateAddress(routeToken.chain, position.tokenAddress)
      && Tango.Chains.normalizeAddress(routeToken.chain, position.tokenAddress) === address) {
      return {
        token: {
          chain: routeToken.chain, address, symbol: position.symbol || symbol, name: position.name || position.symbol || symbol,
          logoUrl: position.logoUrl || '', launchpad: position.launchpad || '', launchMode: position.launchMode || '',
          metadataVerified: Boolean(position.metadataSource), metadataSource: position.metadataSource || ''
        },
        quote: positionQuote(position) || {}
      };
    }
    const trade = [...(runtime.state?.trades || [])].reverse().find((item) => item?.chain === routeToken.chain
      && Tango.Chains.validateAddress(routeToken.chain, item.tokenAddress)
      && Tango.Chains.normalizeAddress(routeToken.chain, item.tokenAddress) === address);
    if (trade) return {
      token: {
        chain: routeToken.chain, address, symbol: trade.symbol || symbol, name: trade.name || trade.symbol || symbol,
        logoUrl: trade.logoUrl || '', launchpad: trade.launchpad || '', launchMode: trade.launchMode || '',
        metadataVerified: Boolean(trade.quoteSource), metadataSource: trade.quoteSource || ''
      },
      quote: {}
    };
    return label;
  }
  function ensureRouteTokenContext() {
    const placeholder = routeTokenPlaceholder();
    if (!placeholder) return null;
    const current = runtime.current;
    if (current?.token?.chain === placeholder.token.chain
      && Tango.Chains.validateAddress(placeholder.token.chain, current.token.address)
      && Tango.Chains.normalizeAddress(placeholder.token.chain, current.token.address)
        === placeholder.token.address) return current;
    runtime.current = placeholder;
    return runtime.current;
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
    const nextIdentity = currentRouteIdentity();
    const framesAwaitingRouteSeal = [];
    chartFrames().forEach((frame) => {
      if (!runtime.markerFrameListeners.has(frame)) return;
      framesAwaitingRouteSeal.push(frame);
      runtime.chartFrameTentative.add(frame);
      runtime.chartFrameReadyBeforeLoad.delete(frame);
      runtime.chartFrameAwaitingReady.delete(frame);
      runtime.markerPayloads.delete(frame);
    });
    runtime.routeEpoch += 1;
    runtime.routeIdentity = nextIdentity;
    framesAwaitingRouteSeal.forEach((frame) => {
      runtime.chartFrameRoutes.set(frame, { epoch: runtime.routeEpoch, identity: nextIdentity });
      beginChartFrameGeneration(frame);
    });
    Tango.GMGN._clearChartTrust?.();
    framesAwaitingRouteSeal.forEach((frame) => probeChartFrameReady(frame));
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
  function validObservationTime(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      && value - Date.now() <= 5_000;
  }
  function rememberNativePrice(chain, price, observedAt = Date.now(), persistenceEligible = true) {
    const numeric = Number(price || 0);
    const nextObservedAt = observedAt;
    if (persistenceEligible) {
      const previousPersistentAt = Number(runtime.persistentNativePriceObservedAt.get(chain) || 0);
      if (Number.isFinite(numeric) && numeric > 0 && validObservationTime(nextObservedAt)
        && nextObservedAt >= previousPersistentAt) {
        runtime.persistentNativePrices.set(chain, numeric);
        runtime.persistentNativePriceObservedAt.set(chain, nextObservedAt);
      }
    }
    const previousObservedAt = Number(runtime.nativePriceObservedAt.get(chain) || 0);
    if (!Number.isFinite(numeric) || !(numeric > 0) || !validObservationTime(nextObservedAt)
      || nextObservedAt < previousObservedAt) {
      return Number(runtime.nativePrices.get(chain) || 0);
    }
    runtime.nativePrices.set(chain, numeric);
    runtime.nativePriceObservedAt.set(chain, nextObservedAt);
    return numeric;
  }
  function freshNativePrice(chain, maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000)) {
    const price = Number(runtime.nativePrices.get(chain) || 0);
    const observedAt = Number(runtime.nativePriceObservedAt.get(chain) || 0);
    return price > 0 && observedAt > 0 && Date.now() - observedAt <= maxAgeMs ? price : 0;
  }
  function freshPersistentNativePrice(chain, maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000)) {
    const price = Number(runtime.persistentNativePrices.get(chain) || 0);
    const observedAt = Number(runtime.persistentNativePriceObservedAt.get(chain) || 0);
    return price > 0 && observedAt > 0 && Date.now() - observedAt <= maxAgeMs ? price : 0;
  }
  function clearShellMarkup() {
    Tango.TradeReplay?.close();
    if (runtime.renderedMarkup !== '') shell.innerHTML = '';
    runtime.renderedMarkup = '';
  }
  function clearChainContext() {
    clearChartMarkers();
    runtime.current = null;
    runtime.lastQuoteWriteKey = null;
    runtime.modal = null;
    runtime.calendarOpen = false;
    runtime.gmgnQuotes.clear();
    runtime.persistentGmgnQuotes.clear();
    runtime.quoteRequests.clear();
    runtime.quoteRetryAt.clear();
    combinedQuoteChains.clear();
    runtime.positionCalibrationPromises.clear();
    runtime.positionCalibrationTargets.clear();
    runtime.positionCalibrationDirty.clear();
    clearQuickBuyButtons();
    clearHeaderAccountSummary();
    clearShellMarkup();
  }

  function isPageObservationRecord(value) {
    // The bridge sends flat scalar records. Reject objects in scalar fields
    // before Number/String conversion so one malformed item cannot break a batch.
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && Object.values(value).every((field) => field == null
        || ['string', 'number', 'boolean'].includes(typeof field)));
  }

  function handlePageMessage(event) {
    if (event.data?.source === 'TANGO_PAPER_CHART' && event.data?.type === 'READY') {
      const frame = [...chartFrames()].find((candidate) => candidate.contentWindow === event.source);
      if (frame) {
        const registrationChanged = registerChartFrame(frame);
        const routeCurrent = routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame));
        const hasProbeId = Object.prototype.hasOwnProperty.call(event.data || {}, 'probeId');
        const hasFrameGeneration = Object.prototype.hasOwnProperty.call(event.data || {}, 'frameGeneration');
        const probeTagged = hasProbeId || hasFrameGeneration;
        const probeId = typeof event.data?.probeId === 'string' ? event.data.probeId : '';
        const frameGeneration = event.data?.frameGeneration;
        const expectedProbeId = runtime.chartFrameProbeIds.get(frame);
        const expectedGeneration = runtime.chartFrameGenerations.get(frame);
        if (probeTagged && (
          !hasProbeId
          || !hasFrameGeneration
          || !routeCurrent
          || !probeId
          || probeId.length > CHART_PROBE_ID_MAX_CHARS
          || !Number.isSafeInteger(frameGeneration)
          || frameGeneration <= 0
          || expectedProbeId !== probeId
          || expectedGeneration !== frameGeneration
        )) return;
        const tentative = runtime.chartFrameTentative.has(frame);
        const readyIdentity = chartReadyIdentity(event.data?.identity);
        const routeToken = detailRouteToken();
        const independentlyMatchesRoute = Boolean(routeToken && readyIdentity
          && readyIdentity.chain === routeToken.chain && readyIdentity.address === routeToken.address);
        if (tentative && (!probeTagged || !independentlyMatchesRoute)) {
          if (registrationChanged) replayChartMarkers(frame);
          return;
        }
        if (routeToken && routeCurrent) {
          const markedReady = Tango.GMGN._markChartFrameReady?.(frame, routeToken) === true;
          if (markedReady) {
            if (probeTagged) {
              runtime.chartFrameReadyProbeIds.set(frame, probeId);
              runtime.chartFrameProbeIds.delete(frame);
            }
            if (tentative) runtime.chartFrameTentative.delete(frame);
            runtime.chartFrameReadyBeforeLoad.delete(frame);
            if (probeTagged) runtime.chartFrameAwaitingReady.delete(frame);
            else {
              const readyFollowedLoad = runtime.chartFrameAwaitingReady.delete(frame);
              if (!readyFollowedLoad) runtime.chartFrameReadyBeforeLoad.add(frame);
            }
          }
        }
        replayChartMarkers(frame);
      }
      return;
    }
    if (event.source === window && event.data?.source === 'TANGO_GMGN_PAGE'
      && event.data?.type === 'NATIVE_PRICES') {
      if (!Array.isArray(event.data.prices)) return;
      for (const price of event.data.prices.slice(0, 16)) {
        if (!isPageObservationRecord(price)) continue;
        Tango.Chains.all().filter((chain) => chain.nativeSymbol === price.symbol)
          .forEach((chain) => rememberNativePrice(
            chain.id, price.priceUsd, price.observedAt, false
          ));
      }
      queueRender();
      return;
    }

    if (event.source === window && event.data?.source === 'TANGO_GMGN_PAGE' && event.data?.type === 'REPLAY_CANDLES') {
      const token=detailRouteToken(),batch=event.data.batch;
      if(runtime.settings?.enabled && token && batch?.chain===token.chain && batch.address===token.address) Tango.TradeReplay?.recordBatch(batch);
      return;
    }
    if (event.source !== window || event.data?.source !== 'TANGO_GMGN_PAGE' || event.data?.type !== 'TOKEN_QUOTES') return;
    if (!Array.isArray(event.data.quotes)) return;
    const pageChain = combinedTrench() ? null : activeChain();
    if (!pageChain && !combinedTrench()) { clearChainContext(); return; }
    const routeToken = detailRouteToken();
    let currentQuoteChanged = false;
    event.data.quotes.slice(0, 500).forEach((quote) => {
      if (!isPageObservationRecord(quote)) return;
      const chain = pageChain || Tango.Chains.get(quote?.chain);
      if (!chain || quote?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, quote?.address)) return;
      const address = Tango.Chains.normalizeAddress(chain.id, quote.address);
      const maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000);
      const normalizedQuote = normalizeObservationDimensions(quote, maxAgeMs, false);
      if (!trustedCachedObservation(normalizedQuote, chain.id, address, maxAgeMs, false)) return;
      const cacheKey = gmgnQuoteKey(chain.id, address);
      const previousQuote = normalizeObservationDimensions(
        runtime.gmgnQuotes.get(cacheKey), maxAgeMs, false
      );
      let cachedQuote = normalizeObservationDimensions(
        Tango.GMGNQuotes.mergeObservation(previousQuote, normalizedQuote), maxAgeMs, false
      );
      // A network replay may describe an older pool state despite arriving now.
      // Prefer the independently verified current header for this route only.
      if (runtime.settings?.enabled && routeToken?.chain === chain.id && routeToken.address === address) {
        const snapshot = Tango.GMGN.readVerifiedCurrentTokenSnapshot?.(routeToken);
        const live = normalizeObservationDimensions(snapshot?.quote, maxAgeMs, false);
        if (snapshot?.token?.chain === chain.id && snapshot.token.address === address
          && trustedCachedObservation(live, chain.id, address, maxAgeMs, false)
          && acceptedTokenObservation(live, snapshot.token, maxAgeMs)) {
          cachedQuote = preferObservationDimensions(cachedQuote, live);
        } else {
          const current = runtime.current;
          const previousHeader = current?.token?.chain === chain.id && current.token.address === address
            ? normalizeObservationDimensions({ ...current.quote,
              chain: current.quote?.chain ?? chain.id, address: current.quote?.address ?? address
            }, maxAgeMs, false) : null;
          // React may replace a verified header before the 48 ms identity probe
          // completes. Keep its fresh quote; never extend its observation time.
          if (previousHeader?.source === 'GMGN' && Number(previousHeader.priceUsd) > 0
            && trustedCachedObservation(previousHeader, chain.id, address, maxAgeMs, false)) {
            cachedQuote = preferObservationDimensions(cachedQuote, previousHeader);
          }
        }
      }
      if (!trustedCachedObservation(cachedQuote, chain.id, address, maxAgeMs, false)) return;
      runtime.gmgnQuotes.set(cacheKey, cachedQuote);
      if(runtime.settings?.enabled && routeToken?.chain===chain.id && routeToken.address===address) Tango.TradeReplay?.recordQuote(cachedQuote);
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
    });
    if (runtime.gmgnQuotes.size > 2000) {
      const overflow = runtime.gmgnQuotes.size - 2000;
      [...runtime.gmgnQuotes.keys()].slice(0, overflow).forEach((key) => runtime.gmgnQuotes.delete(key));
    }
    if (currentQuoteChanged) {
      publishChartMarkers();
      queueRender();
    }
  }
  window.addEventListener('message', handlePageMessage);
  window.postMessage({ source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' }, '*');

  function language() { return Tango.I18n.resolveLanguage(runtime.settings?.language); }
  function t(key, vars) { return Tango.I18n.t(key, runtime.settings?.language, vars); }
  function accountMoney(value, signed = false) {
    const chain = activeChain();
    if (!chain) return '--';
    const reference = currentNativePriceUsd();
    if (runtime.settings?.displayCurrency !== 'USD' || !(reference > 0)) {
      return Tango.Format.native(value, chain.nativeSymbol, language(), signed);
    }
    const numeric = Number(value || 0); const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    const usdValue = Math.abs(numeric) * reference;
    return Number.isFinite(usdValue) ? `${sign}${Tango.Format.usd(usdValue, language())}` : '--';
  }
  function currentNativePriceUsd() {
    const chain = activeChain();
    if (!chain) return 0;
    const current = freshNativePrice(chain.id);
    if (current > 0) return current;
    const quote = runtime.current?.token?.chain === chain.id ? runtime.current.quote : null;
    const price = Number(quote?.nativePriceUsd || 0);
    return Number.isFinite(price) && price > 0 && quote?.syntheticNativePrice !== true
      && freshObservationTime(quote?.nativePriceObservedAt || quote?.nativeObservedAt, Number(Tango.QUOTE_STALE_MS || 15_000))
      ? price : 0;
  }
  function canonicalUsdSummary() {
    const chain = activeChain();
    if (!chain || runtime.settings?.displayCurrency !== 'USD') return null;
    const price = currentNativePriceUsd();
    if (!Number.isFinite(price) || price <= 0) return null;
    try { return Tango.Engine.chainUsdSummary(runtime.state, chain.id, price, freshExecutableQuote); }
    catch (error) {
      if (['invalidArithmetic', 'invalidNativePrice'].includes(error?.message)) return null;
      throw error;
    }
  }
  function usdMoney(value, signed = false) {
    const numeric = Number(value || 0); const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    return `${sign}${Tango.Format.usd(Math.abs(numeric), language())}`;
  }
  function positionUsdValue(position, mark = Tango.Engine.markPosition(
    position, freshExecutableQuote(position), currentNativePriceUsd()
  )) {
    return Number(mark.quantity ?? position.quantity ?? 0) * Number(mark.priceUsd || 0);
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
    async function drain() {
      let result;
      do {
        queued = false;
        result = await task();
      } while (queued);
      return result;
    }
    return function run() {
      if (active) {
        queued = true;
        return active;
      }
      active = drain().finally(() => {
        active = null;
      });
      return active;
    };
  }

  async function performRefresh() {
    const previousState = runtime.state;
    const previousSettings = runtime.settings;
    const chain = activeChain();
    const previousChainSettings = chain
      ? previousSettings?.chainSettings?.[chain.id] || previousSettings?.chains?.[chain.id]
      : null;
    runtime.quickBuySettingsPending = true;
    document.documentElement?.classList?.remove('tango-paper-native-quick-buy-allowed');
    let data;
    try {
      data = await Tango.Store.getAll();
    } catch (error) {
      clearQuickBuyButtons();
      throw error;
    }
    runtime.state = data.state;
    runtime.settings = data.settings;
    runtime.quickBuyAuthoritativelyDisabled = runtime.settings?.enabled === false;
    runtime.quickBuySettingsPending = false;
    const becameReady = runtime.settings.enabled === true
      && runtime.state.initialized === true
      && (previousSettings?.enabled === false || previousState?.initialized !== true);
    const currentChainSettings = chainSettings();
    const quickBuyConfigChanged = previousSettings && (
      previousSettings.enabled !== runtime.settings.enabled ||
      previousSettings.showListQuickBuy !== runtime.settings.showListQuickBuy ||
      previousSettings.language !== runtime.settings.language ||
      Number(previousChainSettings?.buyPresets?.[0]) !== Number(currentChainSettings?.buyPresets?.[0])
      || (combinedTrench() && JSON.stringify(previousSettings.chainSettings || previousSettings.chains)
        !== JSON.stringify(runtime.settings.chainSettings || runtime.settings.chains))
    );
    const quickBuyShouldBeActive = Boolean(((chain && currentChainSettings) || combinedTrench())
      && runtime.settings.enabled && runtime.state.initialized && runtime.settings.showListQuickBuy);
    if (quickBuyShouldBeActive) {
      setContentClass(document.documentElement, 'tango-paper-quick-buy-active', true);
      if (quickBuyConfigChanged || becameReady || runtime.quickBuyMode !== 'active') {
        syncQuickBuyButtons();
      }
    } else {
      clearQuickBuyButtons();
    }
    if (!runtime.settings.enabled || !runtime.state.initialized) {
      clearChartMarkers();
      runtime.current = null;
    }
    if (becameReady) ensureRouteTokenContext();
    if (becameReady) {
      window.postMessage({ source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' }, '*');
      tickQuote();
    }
    queueRender();
  }

  const refresh = coalesceAsync(performRefresh);

  function scheduleRefreshRetry() {
    if (runtime.refreshRetryTimer !== null) return;
    const delay = runtime.refreshRetryDelay;
    runtime.refreshRetryDelay = Math.min(delay * 2, 5_000);
    runtime.refreshRetryTimer = setTimeout(() => {
      runtime.refreshRetryTimer = null;
      return refreshRecoverably();
    }, delay);
  }

  async function refreshRecoverably() {
    try {
      await refresh();
      if (runtime.refreshRetryTimer !== null) clearTimeout(runtime.refreshRetryTimer);
      runtime.refreshRetryTimer = null;
      runtime.refreshRetryDelay = 500;
      return true;
    } catch (error) {
      if (noteInvalidatedContext(error)) return false;
      console.error('[Tango Paper Trader] settings refresh failed', error);
      scheduleRefreshRetry();
      return false;
    }
  }

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

  function quickBuyPolicyKey() {
    const chain = activeChain();
    const settings = chainSettings();
    return JSON.stringify({
      enabled: runtime.settings?.enabled === true,
      initialized: runtime.state?.initialized === true,
      showListQuickBuy: runtime.settings?.showListQuickBuy === true,
      chain: chain?.id || '', preset: settings?.buyPresets?.[0] || 0.1, paperLabel: t('paper')
    });
  }

  function paperQuickBuyMutationNode(node) {
    const paperClass = '.tango-list-quick-buy';
    const paperAction = '[data-tango-paper-action="quick-buy"]';
    return Boolean(node?.matches?.(paperClass) || node?.matches?.(paperAction)
      || node?.closest?.(paperClass) || node?.closest?.(paperAction));
  }

  function containsPaperQuickBuyMutationNode(node) {
    return paperQuickBuyMutationNode(node)
      || Boolean(node?.querySelector?.('.tango-list-quick-buy')
        || node?.querySelector?.('[data-tango-paper-action="quick-buy"]'));
  }

  function quickBuyMutationRoots(node, {
    includeAncestors = true, includeDescendants = false
  } = {}) {
    if (node?.nodeType !== 1) return [];
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'BODY' || tag === 'HTML' || paperQuickBuyMutationNode(node)) return [];
    const tokenItem = '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]';
    const card = '[class~="group/a"]';
    const slot = '.BuyButton-continer';
    const roots = new Set();
    const add = (candidate) => {
      if (candidate && !paperQuickBuyMutationNode(candidate)) roots.add(candidate);
    };
    const isStructuralRoot = Boolean(
      node.matches?.(tokenItem) || node.matches?.(card) || node.matches?.(slot)
    );
    if (isStructuralRoot) add(node);
    if (includeAncestors) add(node.closest?.(tokenItem) || node.closest?.(card) || node.closest?.(slot));
    if (includeDescendants && !isStructuralRoot) {
      const descendants = (selector) => [...(node.querySelectorAll?.(selector) || [])]
        .filter((candidate) => !paperQuickBuyMutationNode(candidate));
      const preferred = descendants(tokenItem);
      const cards = preferred.length ? [] : descendants(card);
      const fallback = preferred.length ? preferred : (cards.length ? cards : descendants(slot));
      fallback.forEach(add);
      if (!roots.size) add(node.querySelector?.(tokenItem) || node.querySelector?.(card) || node.querySelector?.(slot));
    }
    return [...roots];
  }

  function nativeQuickBuyMutationRoots(node, target) {
    if (node?.nodeType !== 1 || paperQuickBuyMutationNode(node)) return [];
    const selector = 'button, [role="button"], a[href], [data-testid="quickbuy"]';
    const candidates = [node.matches?.(selector) ? node : null,
      ...(node.querySelectorAll?.(selector) || [])].filter(Boolean);
    const targetSlot = target?.matches?.('.BuyButton-continer') ? target
      : target?.closest?.('.BuyButton-continer');
    const roots = new Set();
    for (const candidate of candidates) {
      if (paperQuickBuyMutationNode(candidate)) continue;
      const slot = candidate.closest?.('.BuyButton-continer') || targetSlot;
      if (slot && !paperQuickBuyMutationNode(slot)) roots.add(slot);
    }
    return [...roots];
  }

  function chartMutationNode(node) {
    return String(node?.tagName || '').toUpperCase() === 'IFRAME' || Boolean(node?.contentWindow)
      || Boolean(node?.querySelector?.('iframe[title="Financial Chart"], iframe[title="TradingView"], [data-sentry-component="TradingView"] iframe'));
  }

  function headerMutationNode(node) {
    const wallet = '[data-testid="wallet-connected"]';
    const actions = '[data-testid="header-actions"]';
    return Boolean(node?.matches?.(wallet) || node?.matches?.(actions)
      || node?.querySelector?.(wallet) || node?.querySelector?.(actions));
  }

  function detailHeaderMutationNode(node, includeDescendants = false) {
    const selector = '[data-sentry-component="BaseInfoBar"], [data-sentry-component="TokenHeader"], #token-base-symbol';
    return Boolean(node?.matches?.(selector) || (includeDescendants
      ? node?.querySelector?.(selector) : node?.closest?.(selector)));
  }

  let lastQuickBuyFullSyncAt = 0;

  function syncQuickBuyButtons(roots, {
    fast = false, addedRoots = [], removedRoots = [], hrefMutations = [],
    policyKey = quickBuyPolicyKey()
  } = {}) {
    if (runtime.quickBuySettingsPending) return;
    const chain = activeChain();
    const settings = chainSettings();
    if (((chain && settings) || combinedTrench()) && runtime.settings?.enabled && runtime.state?.initialized && runtime.settings?.showListQuickBuy) {
      setContentClass(document.documentElement, 'tango-paper-native-quick-buy-allowed', false);
      setContentClass(document.documentElement, 'tango-paper-quick-buy-active', true);
      if (!Array.isArray(roots) || !roots.length) lastQuickBuyFullSyncAt = Date.now();
      Tango.GMGN.discoverTokenCards(handleQuickBuy, settings?.buyPresets?.[0] || 0.1, t('paper'), roots, {
        fast, addedRoots, removedRoots, hrefMutations, policyKey,
        onChain: id => {
          combinedQuoteChains.add(id);
          ensureNativePrice({ token: { chain: id }, quote: {} });
        },
        readChainPresets: id => (runtime.settings.chainSettings?.[id] || runtime.settings.chains?.[id])?.buyPresets
      });
      syncTrenchPositionBadges(roots);
      runtime.quickBuyMode = 'active';
    } else {
      clearQuickBuyButtons();
    }
  }

  function syncTrenchPositionBadges(roots) {
    if (!runtime.settings?.enabled || !runtime.state?.initialized) {
      Tango.GMGN.clearPositionBadges?.();
      return;
    }
    Tango.GMGN.syncPositionBadges?.((token, readCardQuote) => {
      if (!Tango.Chains.validateAddress(token?.chain, token?.address)) return null;
      const position = runtime.state.positions[Tango.Engine.positionKey(token.chain, token.address)];
      if (!position || !(Number(position.quantity) > 0)) return null;
      const cardQuote = readCardQuote();
      Tango.GMGN.rememberTrenchSnapshot?.({ token, quote: cardQuote });
      const quote = resolvePaperTradeQuote(token, cardQuote, { position });
      const mark = Tango.Engine.markPosition(position, quote || undefined, combinedTrench() ? freshNativePrice(token.chain) : currentNativePriceUsd());
      if (!(Number.isFinite(mark.valueNative) && mark.valueNative >= 0)) return null;
      const symbol = Tango.Chains.get(token.chain).nativeSymbol;
      const label = language().toLowerCase().startsWith('zh') ? '持仓' : 'Holding';
      return { text: `${label} ${Tango.Format.native(mark.valueNative, symbol, language())}`,
        title: `${label} ${Tango.Format.number(mark.valueNative, language(), 8)} ${symbol}` };
    }, roots, (chain, address) => Tango.Chains.validateAddress(chain, address)
      && Number(runtime.state.positions[
      Tango.Engine.positionKey(chain, address)]?.quantity) > 0);
  }

  function clearQuickBuyButtons() {
    setContentClass(document.documentElement, 'tango-paper-quick-buy-active', false);
    const nativeAllowed = !runtime.quickBuySettingsPending
      && runtime.settings?.enabled === false;
    if (nativeAllowed) {
      setContentClass(document.documentElement, 'tango-paper-native-quick-buy-allowed', true);
    } else {
      setContentClass(document.documentElement, 'tango-paper-native-quick-buy-allowed', false);
    }
    const nextMode = nativeAllowed ? 'cleared' : 'guarded';
    if (runtime.quickBuyMode === nextMode) return;
    Tango.GMGN.clearQuickBuy(nativeAllowed);
    runtime.quickBuyMode = nextMode;
  }

  function queueQuickBuySync(root) {
    if (root) runtime.pendingMutationRoots.add(root);
    if (runtime.quickBuySyncQueued) return;
    runtime.quickBuySyncQueued = true;
    requestAnimationFrame(() => {
      runtime.quickBuySyncQueued = false;
      const roots = [...runtime.pendingMutationRoots];
      runtime.pendingMutationRoots.clear();
      if (roots.length) syncQuickBuyButtons(roots, {
        fast: false, addedRoots: [], removedRoots: [], policyKey: quickBuyPolicyKey()
      });
    });
  }

  function probeQuickBuyHealth() {
    if (!runtime.settings?.enabled || !runtime.state?.initialized || !runtime.settings?.showListQuickBuy) return;
    if (Tango.GMGN.quickBuyNeedsReconcile?.()) syncQuickBuyButtons();
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
    if (runtime.extensionInvalidated) return;
    const routeCapture = captureRoute();
    const chain = activeChain();
    if (combinedTrench()) {
      if (!runtime.settings?.enabled || !runtime.state?.initialized) { clearQuickBuyButtons(); return; }
      if (runtime.quickBuyMode !== 'active' || Date.now() - lastQuickBuyFullSyncAt >= 30_000) syncQuickBuyButtons();
      for (const id of combinedQuoteChains) ensureNativePrice({ token: { chain: id }, quote: {} });
      ensureNativePrice(null, routeCapture);
      syncTrenchPositionBadges();
      queueRender();
      return;
    }
    if (!chain) {
      clearChainContext();
      return;
    }
    if (!runtime.settings?.enabled || !runtime.state?.initialized) {
      clearQuickBuyButtons();
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
      const observedAddress = observedCurrent?.token?.address || observedCurrent?.token?.tokenAddress;
      const currentAddress = runtime.current.token?.address || runtime.current.token?.tokenAddress;
      const observedTokenMatchesCurrent = observedCurrent?.token?.chain === chain.id
        && Tango.Chains.validateAddress(chain.id, observedAddress)
        && Tango.Chains.validateAddress(chain.id, currentAddress)
        && Tango.Chains.normalizeAddress(chain.id, observedAddress)
          === Tango.Chains.normalizeAddress(chain.id, currentAddress);
      if (currentPosition() && observedTokenMatchesCurrent) {
        runtime.state = await Tango.Store.updatePositionMetadata(observedCurrent.token);
        if (!routeCaptureIsCurrent(routeCapture)) return;
      }
    }
    ensureNativePrice(runtime.current, routeCapture);
    ensureTokenQuote(runtime.current, routeCapture);
    const position = currentPosition();
    const paperQuote = position
      ? resolvePaperTradeQuote(runtime.current?.token, runtime.current?.quote, {
        position, persistenceOnly: true
      }) : null;
    const calibrationUpgrade = positionCalibrationUpgrade(position, paperQuote);
    const executable = executableQuote(runtime.current?.token, paperQuote, { persistenceOnly: true });
    if (routeCaptureIsCurrent(routeCapture) && position && calibrationUpgrade) {
      await queueImmediateCurrentCalibration(routeCapture);
      if (!routeCaptureIsCurrent(routeCapture)) return;
    } else if (routeCaptureIsCurrent(routeCapture) && executable && position
      && (runtime.lastQuoteWriteKey !== Tango.Engine.positionKey(chain.id, runtime.current.token.address)
        || Date.now() - runtime.lastQuoteWriteAt > 10_000)) {
      const token = { ...runtime.current.token };
      const writeKey = Tango.Engine.positionKey(chain.id, token.address);
      const nextState = await Tango.Store.updatePositionQuote(token, executable);
      if (!routeCaptureIsCurrent(routeCapture)
        || !runtime.current?.token
        || Tango.Engine.positionKey(runtime.current.token.chain, runtime.current.token.address) !== writeKey) return;
      runtime.state = nextState;
      runtime.lastQuoteWriteAt = Date.now();
      runtime.lastQuoteWriteKey = writeKey;
    }
    if (!routeCaptureIsCurrent(routeCapture)) return;
    // Mutation lanes and the 750ms health probe reconcile new/replaced slots.
    // Retain a full sweep for missed page events without scanning every quote tick.
    if (runtime.quickBuyMode !== 'active' || !(Tango.GMGN._hasQuickBuyList?.() ?? Tango.GMGN._isTrenchPage?.())
      || Date.now() - lastQuickBuyFullSyncAt >= 30_000) syncQuickBuyButtons();
    await syncVisiblePositionMetadata(routeCapture);
    if (!routeCaptureIsCurrent(routeCapture)) return;
    const currentKey = runtime.current?.token
      ? Tango.Engine.positionKey(runtime.current.token.chain, runtime.current.token.address) : '';
    if (previousKey !== currentKey || runtime.current) queueRender();
  }

  const tickQuote = coalesceAsync(async () => {
    try { return await performQuoteTick(); }
    catch (error) {
      if (!noteInvalidatedContext(error)) throw error;
    }
  });

  function ensureNativePrice(context, routeCapture = captureRoute()) {
    if (runtime.extensionInvalidated) return;
    const chain = context?.token ? executionChain(context.token) : activeChain();
    if (!chain || (context && context.token?.chain !== chain.id)) return;
    const cached = freshNativePrice(chain.id);
    if (cached > 0) {
      if (context) {
        context.quote.nativePriceUsd = cached;
        context.quote.nativePriceObservedAt = runtime.nativePriceObservedAt.get(chain.id);
      }
    }
    if (freshPersistentNativePrice(chain.id) > 0) return;
    if (runtime.nativePricePromises.has(chain.id)) return;
    const request = sendContentMessage({ type: 'TANGO_GET_NATIVE_PRICE', chain: chain.id })
      .then((response) => {
        const price = Number(response?.price || 0);
        if (!(price > 0)) return;
        rememberNativePrice(chain.id, price, Number(response?.observedAt || 0));
        if (routeCaptureIsCurrent(routeCapture) && (activeChain()?.id === chain.id || combinedTrench())) {
          if (runtime.current?.token?.chain === chain.id) {
            runtime.current.quote.nativePriceUsd = price;
            runtime.current.quote.nativePriceObservedAt = runtime.nativePriceObservedAt.get(chain.id);
          }
          queueRender();
          queueImmediateCurrentCalibration(routeCapture);
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
    const normalized = normalizeObservationDimensions(candidate, maxAgeMs);
    const acceptedSource = Boolean(factualObservationSource(normalized?.source));
    const hasValue = Number(normalized?.priceUsd || 0) > 0
      || trustedMarketCapObservation(normalized, token);
    const observedAt = Number(candidate?.observedAt || 0);
    return acceptedSource && hasValue && freshObservationTime(observedAt, maxAgeMs);
  }

  function factualObservationSource(value, allowDex = true) {
    const source = String(value || '').trim().toUpperCase();
    if (!source || source.includes('SYNTHETIC') || source.includes('DERIVED')
      || source.includes('FALLBACK')) return '';
    if (allowDex && source === 'DEXSCREENER') return source;
    return source === 'GMGN' || source.startsWith('GMGN_') ? source : '';
  }

  function freshObservationTime(value, maxAgeMs) {
    const observedAt = Number(value || 0);
    return Number.isSafeInteger(observedAt) && observedAt > 0
      && observedAt - Date.now() <= 5_000 && Date.now() - observedAt <= maxAgeMs;
  }

  function normalizeObservationDimensions(candidate, maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000), allowDex = true) {
    if (!candidate) return null;
    const normalized = { ...candidate };
    for (const dimension of [
      ['priceUsd', 'priceObservedAt', 'priceSource', 'priceObservationId'],
      ['marketCapUsd', 'marketCapObservedAt', 'marketCapSource', 'marketCapObservationId'],
      ['liquidityUsd', 'liquidityObservedAt', 'liquiditySource', 'liquidityObservationId'],
      ['totalSupply', 'totalSupplyObservedAt', 'totalSupplyObservationSource', 'totalSupplyObservationId']
    ]) {
      const [valueField, timeField, sourceField, observationIdField] = dimension;
      const value = Number(candidate[valueField] || 0);
      const observedAt = candidate[timeField] == null
        ? Number(candidate.observedAt || 0) : Number(candidate[timeField]);
      const source = factualObservationSource(
        candidate[sourceField] == null ? candidate.source : candidate[sourceField], allowDex
      );
      const factualPrice = valueField !== 'priceUsd'
        || Tango.GMGNQuotes.isFactualPriceObservation(candidate);
      const valid = Number.isFinite(value) && value > 0 && Boolean(source)
        && freshObservationTime(observedAt, maxAgeMs) && factualPrice;
      normalized[valueField] = valid ? value : 0;
      normalized[timeField] = valid ? observedAt : 0;
      normalized[sourceField] = valid ? source : '';
      if (!valid) normalized[observationIdField] = '';
      if (!valid && valueField === 'priceUsd') normalized.priceProvenance = '';
      if (!valid && valueField === 'totalSupply') {
        normalized.totalSupplySource = '';
        normalized.supplySource = '';
        normalized.totalSupplyField = '';
        normalized.totalSupplyTrustRank = 0;
      }
    }
    return normalized;
  }

  function trustedCachedObservation(candidate, chain, address, maxAgeMs, allowDex = true) {
    const candidateAddress = candidate?.address || candidate?.tokenAddress;
    if (candidate?.chain !== chain || !Tango.Chains.validateAddress(chain, candidateAddress)
      || Tango.Chains.normalizeAddress(chain, candidateAddress) !== address
      || !factualObservationSource(candidate?.source, allowDex)
      || !freshObservationTime(candidate?.observedAt, maxAgeMs)) return false;
    if (['priceUsd', 'marketCapUsd', 'liquidityUsd', 'totalSupply'].some((field) =>
      candidate?.[field] != null && (!Number.isFinite(Number(candidate[field])) || Number(candidate[field]) < 0))) return false;
    if (!Tango.GMGNQuotes.isFactualPriceObservation(candidate)) return false;
    for (const [valueField, timeField, sourceField] of [
      ['priceUsd', 'priceObservedAt', 'priceSource'],
      ['marketCapUsd', 'marketCapObservedAt', 'marketCapSource'],
      ['liquidityUsd', 'liquidityObservedAt', 'liquiditySource'],
      ['totalSupply', 'totalSupplyObservedAt', 'totalSupplyObservationSource']
    ]) {
      const source = candidate?.[sourceField] == null
        ? candidate?.source : candidate[sourceField];
      const observedAt = candidate?.[timeField] == null
        ? candidate?.observedAt : candidate[timeField];
      if (Number(candidate?.[valueField] || 0) > 0
        && (!factualObservationSource(source, allowDex)
          || !freshObservationTime(observedAt, maxAgeMs))) return false;
    }
    return true;
  }

  function detailBootstrapObservation(candidate, maxAgeMs = 30_000) {
    const observedAt = Number(candidate?.observedAt || 0);
    const age = Date.now() - observedAt;
    return String(candidate?.source || '').toUpperCase() === 'GMGN_NETWORK'
      && (Number(candidate?.priceUsd || 0) > 0 || Number(candidate?.marketCapUsd || 0) > 0)
      && observedAt > 0 && age >= -5_000 && age <= maxAgeMs;
  }

  function ensureTokenQuote(context, routeCapture = captureRoute()) {
    if (runtime.extensionInvalidated) return;
    const chain = activeChain();
    if (!routeCaptureIsCurrent(routeCapture) || !chain || context?.token?.chain !== chain.id
      || !context?.token?.address) return;
    const address = context.token.address;
    const requestKey = gmgnQuoteKey(chain.id, address);
    const persistentQuote = freshPersistentGmgnQuote(chain.id, address);
    if (acceptedTokenObservation(persistentQuote, context.token)) {
      mergeQuote(context, persistentQuote);
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
        const persistentQuote = rememberPersistentGmgnQuote(quote);
        if (!persistentQuote) return;
        mergeQuote(runtime.current, persistentQuote);
        queueRender();
      })
      .catch(() => {
        if (requestIsCurrent()) runtime.quoteRetryAt.set(requestKey, Date.now() + 15_000);
      });
  }

  function requestWithTimeout(message, timeoutMs = 650) {
    return Promise.race([
      sendContentMessage(message).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }

  function freshGmgnQuote(chain, address, maxAgeMs = 30_000) {
    const quote = runtime.gmgnQuotes.get(gmgnQuoteKey(chain, address));
    return quote && Date.now() - Number(quote.observedAt || 0) <= maxAgeMs ? quote : null;
  }

  function freshPersistentGmgnQuote(chain, address, maxAgeMs = 30_000) {
    const quote = runtime.persistentGmgnQuotes.get(gmgnQuoteKey(chain, address));
    return quote && Date.now() - Number(quote.observedAt || 0) <= maxAgeMs ? quote : null;
  }

  function rememberPersistentGmgnQuote(quote) {
    const chain = Tango.Chains.get(quote?.chain)?.id;
    const address = quote?.address || quote?.tokenAddress;
    if (!chain || !Tango.Chains.validateAddress(chain, address)) return null;
    const normalizedAddress = Tango.Chains.normalizeAddress(chain, address);
    const key = gmgnQuoteKey(chain, normalizedAddress);
    const maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000);
    const normalized = normalizeObservationDimensions(quote, maxAgeMs);
    const persistent = normalizeObservationDimensions(
      Tango.GMGNQuotes.mergeObservation(runtime.persistentGmgnQuotes.get(key), normalized),
      maxAgeMs
    );
    if (!trustedCachedObservation(persistent, chain, normalizedAddress, maxAgeMs)) return null;
    runtime.persistentGmgnQuotes.set(key, persistent);
    const display = normalizeObservationDimensions(
      Tango.GMGNQuotes.mergeObservation(runtime.gmgnQuotes.get(key), persistent), maxAgeMs
    );
    if (trustedCachedObservation(display, chain, normalizedAddress, maxAgeMs)) {
      runtime.gmgnQuotes.set(key, display);
    }
    return persistent;
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
    // Do not replace the live header with a secondary-pool DEX quote while
    // its factual GMGN USD price is fresh. Stale/missing prices still refresh.
    if (String(quote.source || '').toUpperCase() === 'DEXSCREENER') {
      const current = normalizeObservationDimensions(context.quote);
      if (Number(current?.priceUsd) > 0
        && String(current.priceSource || '').toUpperCase().startsWith('GMGN')) return context.quote;
    }
    const nativePriceUsd = freshNativePrice(chain);
    const validationContext = persistedQuoteContext(context.token);
    const trustedMarketCap = trustedMarketCapObservation(quote, validationContext);
    const fieldObservation = (valueField, timeField, sourceField) => {
      const value = Number(quote[valueField] || 0);
      if (!(Number.isFinite(value) && value > 0)) {
        return { [timeField]: 0, [sourceField]: '' };
      }
      return {
        [timeField]: quote[timeField] == null
          ? Number(quote.observedAt || 0) : Number(quote[timeField]),
        [sourceField]: quote[sourceField] == null
          ? String(quote.source || '') : String(quote[sourceField])
      };
    };
    context.quote = {
      ...context.quote,
      ...quote,
      priceUsd: Number(quote.priceUsd || 0),
      marketCapUsd: Number(quote.marketCapUsd || 0),
      liquidityUsd: Number(quote.liquidityUsd || 0),
      ...fieldObservation('priceUsd', 'priceObservedAt', 'priceSource'),
      ...fieldObservation('marketCapUsd', 'marketCapObservedAt', 'marketCapSource'),
      ...fieldObservation('liquidityUsd', 'liquidityObservedAt', 'liquiditySource'),
      ...(Object.prototype.hasOwnProperty.call(quote, 'totalSupply')
        ? fieldObservation('totalSupply', 'totalSupplyObservedAt', 'totalSupplyObservationSource')
        : {}),
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
    const syntheticTokenPrice = position.syntheticTokenPrice === true
      || position.provisionalTokenPrice === true;
    const syntheticNativePrice = position.syntheticNativePrice === true
      || position.provisionalNativePrice === true;
    const provisional = syntheticTokenPrice || syntheticNativePrice || position.provisional === true;
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
        nativePriceObservedAt: observedAt,
        syntheticTokenPrice, syntheticNativePrice, provisional
      };
    }
    return {
      priceUsd: Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0),
      marketCapUsd: Number(position.lastMarketCapUsd || 0),
      liquidityUsd: 0,
      source: 'TANGO_POSITION_HISTORY',
      observedAt,
      valuationMode: 'PRICE',
      nativePriceUsd: Number(position.lastNativePriceUsd || 0),
      nativePriceObservedAt: observedAt,
      syntheticTokenPrice, syntheticNativePrice, provisional
    };
  }

  function lastKnownNativeObservation(chainId, candidate, position, persistenceOnly = false) {
    const chainPosition = Tango.ChainView.positions(runtime.state, chainId)
      .find((item) => Number(item.lastNativePriceUsd || 0) > 0);
    const observations = [
      {
        price: Number((persistenceOnly
          ? runtime.persistentNativePrices : runtime.nativePrices).get(chainId) || 0),
        observedAt: Number((persistenceOnly
          ? runtime.persistentNativePriceObservedAt : runtime.nativePriceObservedAt).get(chainId) || 0),
        synthetic: false
      },
      {
        price: Number(candidate?.nativePriceUsd || 0),
        observedAt: Number(candidate?.nativePriceObservedAt || candidate?.observedAt || 0),
        synthetic: candidate?.syntheticNativePrice === true
      },
      {
        price: Number(position?.lastNativePriceUsd || 0),
        observedAt: Number(position?.quoteObservedAt || position?.updatedAt || position?.openedAt || 0),
        synthetic: position?.syntheticNativePrice === true || position?.provisionalNativePrice === true
      },
      {
        price: Number(chainPosition?.lastNativePriceUsd || 0),
        observedAt: Number(chainPosition?.quoteObservedAt || chainPosition?.updatedAt || chainPosition?.openedAt || 0),
        synthetic: chainPosition?.syntheticNativePrice === true || chainPosition?.provisionalNativePrice === true
      }
    ].filter(({ price, synthetic }) => !synthetic && Number.isFinite(price) && price > 0)
      .sort((left, right) => right.observedAt - left.observedAt);
    return observations[0] || { price: 0, observedAt: 0 };
  }

  function paperExecutableQuote(token, candidate, position) {
    const chain = executionChain(token);
    if (!chain || token?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, token?.address || token?.tokenAddress)) {
      return null;
    }
    const now = Date.now();
    const provenance = String(candidate?.priceProvenance || '').toUpperCase();
    const provisionalTokenPrice = candidate?.syntheticTokenPrice === true
      || candidate?.provisionalTokenPrice === true
      || provenance === 'SYNTHETIC_PRICE'
      || provenance.startsWith('FALLBACK_')
      || String(candidate?.source || '').toUpperCase() === 'TANGO_FALLBACK';
    const provisionalNativePrice = candidate?.syntheticNativePrice === true
      || candidate?.provisionalNativePrice === true;
    const originalObservedAt = Number(candidate?.originalObservedAt ?? candidate?.observedAt ?? 0);
    const nativeOriginalObservedAt = Number(
      candidate?.nativeOriginalObservedAt ?? candidate?.nativePriceObservedAt ?? 0
    );
    return {
      ...(candidate || {}),
      chain: chain.id,
      address: Tango.Chains.normalizeAddress(chain.id, token.address || token.tokenAddress),
      observedAt: provisionalTokenPrice ? now : candidate?.observedAt,
      ...(candidate?.priceObservedAt != null ? {
        priceObservedAt: provisionalTokenPrice ? now : candidate.priceObservedAt
      } : {}),
      nativePriceObservedAt: provisionalNativePrice ? now : candidate?.nativePriceObservedAt,
      ...(provisionalTokenPrice ? { originalObservedAt } : {}),
      ...(provisionalNativePrice ? { nativeOriginalObservedAt } : {}),
      paperFallback: true
    };
  }

  function refreshPaperQuoteInBackground(token) {
    const chain = executionChain(token);
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

  function recoverRejectedSellQuote(stage, token, quote, error) {
    if (!['invalidQuote', 'staleQuote', 'nativePriceUnavailable'].includes(error?.message)) return;
    // Preserve this attempt separately: background card scans can replace the
    // general quote diagnostic before the user reports an intermittent failure.
    recordQuoteRejection(stage + ':' + error.message, token, quote, 'data-tango-sell-rejection');
    // Recovery is quote-only. Never retry a sell or relax price validation.
    refreshPaperQuoteInBackground(token);
  }

  function preferObservationDimensions(merged, candidate) {
    if (!merged || !candidate) return merged;
    const preferred = { ...merged };
    for (const [valueField, timeField, sourceField] of [
      ['priceUsd', 'priceObservedAt', 'priceSource'],
      ['marketCapUsd', 'marketCapObservedAt', 'marketCapSource'],
      ['liquidityUsd', 'liquidityObservedAt', 'liquiditySource']
    ]) {
      if (!(Number.isFinite(Number(candidate[valueField])) && Number(candidate[valueField]) > 0)) continue;
      preferred[valueField] = Number(candidate[valueField]);
      preferred[timeField] = Number(candidate[timeField] || candidate.observedAt || 0);
      preferred[sourceField] = String(candidate[sourceField] || candidate.source || '');
    }
    if (Number.isFinite(Number(candidate.totalSupply)) && Number(candidate.totalSupply) > 0) {
      preferred.totalSupply = Number(candidate.totalSupply);
      preferred.totalSupplyObservedAt = Number(candidate.totalSupplyObservedAt || candidate.observedAt || 0);
      preferred.totalSupplySource = String(candidate.totalSupplySource || candidate.supplySource || '');
      preferred.totalSupplyObservationSource = String(candidate.totalSupplyObservationSource || candidate.source || '');
    }
    if (!(Number(candidate.priceUsd) > 0) && Number(candidate.marketCapUsd) > 0) {
      // A new DOM cap cannot be paired with an unrelated cached unit price.
      preferred.priceUsd = 0; preferred.priceObservedAt = 0;
      preferred.priceSource = ''; preferred.priceProvenance = '';
    }
    if (candidate.priceProvenance) preferred.priceProvenance = candidate.priceProvenance;
    preferred.observedAt = Number(candidate.observedAt || preferred.observedAt || 0);
    preferred.source = String(candidate.source || preferred.source || '');
    return preferred;
  }

  function recordQuoteRejection(stage, token, quote, attribute = 'data-tango-quote-rejection') {
    // Keep only the latest public observation, never account or trade data.
    const fields = ['source', 'priceSource', 'marketCapSource', 'supplySource',
      'totalSupplySource', 'priceProvenance', 'valuationMode', 'priceUsd',
      'marketCapUsd', 'totalSupply', 'marketCapDivisor', 'nativePriceUsd',
      'observedAt', 'priceObservedAt', 'marketCapObservedAt', 'nativeObservedAt',
      'provisional', 'syntheticTokenPrice', 'syntheticNativePrice'];
    const observation = {};
    for (const field of fields) {
      const value = quote?.[field];
      if (typeof value === 'string') observation[field] = value.slice(0, 100);
      else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) observation[field] = value;
    }
    host.setAttribute(attribute, JSON.stringify({
      stage, chain: token?.chain, address: token?.address || token?.tokenAddress,
      launchpad: String(token?.launchpad || '').slice(0, 100), quote: observation
    }));
  }

  function resolvePaperTradeQuote(token, candidate, options = {}) {
    const chain = executionChain(token);
    const address = token?.address || token?.tokenAddress;
    if (!chain || token?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, address)) return null;
    const normalizedAddress = Tango.Chains.normalizeAddress(chain.id, address);
    const position = options?.position === undefined ? persistedQuoteContext(token) : options.position;
    const persistenceOnly = options?.persistenceOnly === true;
    const exact = (persistenceOnly ? runtime.persistentGmgnQuotes : runtime.gmgnQuotes)
      .get(gmgnQuoteKey(chain.id, normalizedAddress)) || null;
    const candidateSource = String(candidate?.source || '').toUpperCase();
    const candidateAddresses = [candidate?.address, candidate?.tokenAddress]
      .filter((value) => value != null);
    const candidateIdentityMatches = (candidate?.chain == null || candidate.chain === chain.id)
      && candidateAddresses.every((value) => Tango.Chains.validateAddress(chain.id, value)
        && Tango.Chains.normalizeAddress(chain.id, value) === normalizedAddress);
    const candidateObservedAt = Number(candidate?.observedAt || 0);
    const candidateFresh = Number.isSafeInteger(candidateObservedAt)
      && candidateObservedAt > 0
      && candidateObservedAt - Date.now() <= 5_000
      && Date.now() - candidateObservedAt <= Number(Tango.QUOTE_STALE_MS || 15_000);
    const candidateIsTrusted = candidateIdentityMatches && candidateFresh
      && Boolean(factualObservationSource(candidateSource));
    const normalizedCandidate = candidateIsTrusted && !persistenceOnly
      ? normalizeObservationDimensions(candidate, Number(Tango.QUOTE_STALE_MS || 15_000)) : null;
    const candidateHasFactualPrice = Number(normalizedCandidate?.priceUsd || 0) > 0;
    const candidateSyntheticTokenPrice = Boolean(normalizedCandidate)
      && candidate?.syntheticTokenPrice === true;
    const candidateProvisionalSupply = candidateSyntheticTokenPrice
      && Number(candidate?.provisionalSupply) === 1_000_000_000 ? 1_000_000_000 : 0;
    const candidateSupplySource = String(
      normalizedCandidate?.supplySource || normalizedCandidate?.totalSupplySource || ''
    );
    const candidateExactSupply = Boolean(normalizedCandidate) && candidateSource.startsWith('GMGN')
      && ['GMGN_EXACT', 'GMGN_NETWORK_EXACT'].includes(candidateSupplySource)
      && Number.isFinite(Number(normalizedCandidate?.totalSupply))
      && Number(normalizedCandidate.totalSupply) > 0;
    const boundCandidate = normalizedCandidate ? {
      ...normalizedCandidate, chain: chain.id, address: normalizedAddress,
      priceUsd: candidateHasFactualPrice ? Number(normalizedCandidate.priceUsd) : 0,
      totalSupply: candidateExactSupply ? Number(normalizedCandidate.totalSupply) : 0,
      totalSupplySource: candidateExactSupply ? 'GMGN_EXACT' : '',
      supplySource: candidateExactSupply ? 'GMGN_EXACT' : ''
    } : null;
    const normalizedExact = normalizeObservationDimensions(
      exact, Number(Tango.QUOTE_STALE_MS || 15_000)
    );
    const freshExact = trustedCachedObservation(
      normalizedExact, chain.id, normalizedAddress, Number(Tango.QUOTE_STALE_MS || 15_000)
    ) ? normalizedExact : null;
    const cardRuleSupply = token?.metadataVerified === true && token?.metadataSource === 'GMGN_TRENCH'
      ? Number(Tango.Supply.ruleSupply(chain.id, token.launchpad, token.launchMode)) : 0;
    const conflictingExactSupply = [position, freshExact].some(observation =>
      ['GMGN_EXACT', 'GMGN_NETWORK_EXACT'].includes(String(observation?.supplySource || observation?.totalSupplySource || ''))
      && Number(observation.totalSupply) > 0 && Number(observation.totalSupply) !== cardRuleSupply);
    const preferTrenchMarketCap = candidateSource === 'GMGN_TRENCH' && cardRuleSupply > 0
      && Number(boundCandidate?.marketCapUsd) > 0 && !candidateHasFactualPrice && !conflictingExactSupply;
    const normallyMerged = freshExact && boundCandidate
      ? Tango.GMGNQuotes.mergeObservation(freshExact, boundCandidate)
      : boundCandidate || freshExact;
    const merged = preferTrenchMarketCap ? boundCandidate
      : options.preferCandidate === true && boundCandidate
        ? preferObservationDimensions(normallyMerged, boundCandidate)
        : normallyMerged;
    const mergedHasFactualPrice = Tango.GMGNQuotes.isFactualPriceObservation(merged)
      && Number.isFinite(Number(merged?.priceUsd)) && Number(merged.priceUsd) > 0;
    const positionAddress = position?.tokenAddress || position?.address;
    const boundPosition = position?.chain === chain.id
      && Tango.Chains.validateAddress(chain.id, positionAddress)
      && Tango.Chains.normalizeAddress(chain.id, positionAddress) === normalizedAddress
      ? position : null;
    const historicalLocal = positionQuote(boundPosition) || {};
    const mergedMarketCapUsd = Number(merged?.marketCapUsd);
    const mergedHasFactualMarketCap = Number.isFinite(mergedMarketCapUsd) && mergedMarketCapUsd > 0;
    const historicalMarketCapUsd = Number(historicalLocal.marketCapUsd);
    const usesHistoricalMarketCap = Boolean(merged) && !mergedHasFactualMarketCap
      && Number.isFinite(historicalMarketCapUsd) && historicalMarketCapUsd > 0;
    const local = merged ? {
      ...historicalLocal,
      ...merged,
      marketCapUsd: mergedHasFactualMarketCap ? mergedMarketCapUsd : Number(historicalLocal.marketCapUsd || 0),
      ...(usesHistoricalMarketCap ? {
        marketCapObservedAt: Number(historicalLocal.observedAt || 0),
        marketCapSource: 'TANGO_POSITION_HISTORY'
      } : {}),
      provisionalSupply: !mergedHasFactualPrice && candidateProvisionalSupply,
      syntheticTokenPrice: mergedHasFactualPrice
        ? false : candidateSyntheticTokenPrice || historicalLocal.syntheticTokenPrice === true,
      provisionalTokenPrice: mergedHasFactualPrice ? false : historicalLocal.provisionalTokenPrice === true,
      syntheticNativePrice: Number(merged.nativePriceUsd) > 0
        ? false : historicalLocal.syntheticNativePrice === true
    } : historicalLocal;
    const marketCapUsd = Number(local.marketCapUsd);
    const safeMarketCapUsd = Number.isFinite(marketCapUsd) && marketCapUsd > 0 ? marketCapUsd : 0;
    const observedPrice = Number(local.priceUsd);
    const safeObservedPrice = mergedHasFactualPrice && Tango.GMGNQuotes.isFactualPriceObservation(local)
      && Number.isFinite(observedPrice) && observedPrice > 0 ? observedPrice : 0;
    const legacyPumpSupply = chain.id === 'sol' && /pump$/i.test(normalizedAddress)
      && boundPosition?.marketCapProvenance === 'SOLANA_PUMP_TRENCH_V1'
      && boundPosition?.valuationMode === 'MARKET_CAP'
      && Number(boundPosition?.marketCapDivisor) === 1_000_000_000
      ? 1_000_000_000 : 0;
    const localSupplySource = String(local.supplySource || local.totalSupplySource || '');
    const localSupplyObservationSource = String(
      local.totalSupplyObservationSource || local.source || ''
    ).toUpperCase();
    const localExactSupply = localSupplyObservationSource.startsWith('GMGN')
      && ['GMGN_EXACT', 'GMGN_NETWORK_EXACT'].includes(localSupplySource)
      && Number.isFinite(Number(local.totalSupply)) && Number(local.totalSupply) > 0
      ? Number(local.totalSupply) : 0;
    const positionExactSupply = boundPosition?.supplySource === 'GMGN_EXACT'
      && Number.isFinite(Number(boundPosition?.totalSupply)) && Number(boundPosition.totalSupply) > 0
      ? Number(boundPosition.totalSupply) : 0;
    // Independently fresh fields can come from different GMGN responses. Never
    // execute a mixed price/MC pair that contradicts an exact token supply.
    // A small tolerance allows rounded DOM numbers, not a different price unit.
    const verifiedRuleSupply = token?.metadataVerified === true
      && ['GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'].includes(String(token.metadataSource || '').toUpperCase())
      ? Number(Tango.Supply.ruleSupply(chain.id, token.launchpad, token.launchMode)) : 0;
    const positionRuleCoherenceSupply = boundPosition?.supplySource === 'LAUNCHPAD_RULE'
      && Number(boundPosition.totalSupply) === Number(Tango.Supply.ruleSupply(
        chain.id, boundPosition.launchpad, boundPosition.launchMode))
      ? Number(boundPosition.totalSupply) : 0;
    const sameRuleObservation = Number(local.priceObservedAt || local.observedAt) > 0
      && Number(local.priceObservedAt || local.observedAt) === Number(local.marketCapObservedAt || local.observedAt)
      && String(local.priceSource || local.source) === String(local.marketCapSource || local.source);
    const exactCoherenceSupply = localExactSupply || positionExactSupply
      || (sameRuleObservation ? verifiedRuleSupply || positionRuleCoherenceSupply : 0);
    if (safeObservedPrice > 0 && mergedHasFactualMarketCap && exactCoherenceSupply > 0
      && factualObservationSource(local.marketCapSource || local.source)
      && Math.abs(safeObservedPrice * exactCoherenceSupply - safeMarketCapUsd)
        > safeMarketCapUsd * .02) {
      recordQuoteRejection('coherence', token, { ...local, totalSupply: exactCoherenceSupply });
      return null;
    }
    const trustedMetadataSources = ['GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'];
    const tokenMetadataVerified = token?.metadataVerified === true
      && trustedMetadataSources.includes(String(token?.metadataSource || '').toUpperCase());
    const localLaunchpadSource = String(local.launchpadSource || local.source || '').toUpperCase();
    const localMetadataVerified = trustedMetadataSources.includes(localLaunchpadSource)
      && (Boolean(freshExact) || (candidate?.chain === chain.id && candidateAddresses.length > 0));
    const positionRuleSupply = Number(Tango.Supply.ruleSupply(
      chain.id, boundPosition?.launchpad, boundPosition?.launchMode
    ));
    const positionLaunchpadVerified = boundPosition?.supplySource === 'LAUNCHPAD_RULE'
      && Number(boundPosition?.totalSupply) === positionRuleSupply && positionRuleSupply > 0;
    const launchContext = tokenMetadataVerified ? token
      : localMetadataVerified ? local
        : positionLaunchpadVerified ? boundPosition : {};
    const resolvedLaunchpad = launchContext?.launchpad || '';
    const resolvedLaunchMode = launchContext?.launchMode || '';
    // Legacy canonical supply is only a compatibility fallback. A verified
    // current launch rule (including Mayhem) must retain its own supply.
    const legacyFallbackSupply = Tango.Supply.ruleSupply(chain.id, resolvedLaunchpad, resolvedLaunchMode)
      ? 0 : legacyPumpSupply;
    const marketCapObservationSource = factualObservationSource(
      local.marketCapSource || local.source
    );
    const totalSupplyObservationSource = factualObservationSource(
      localExactSupply
        ? local.totalSupplyObservationSource || local.source
        : positionExactSupply ? boundPosition?.totalSupplyObservationSource : ''
    );
    const commonObservationId = String(local.observationId || '');
    const marketCapObservationId = String(local.marketCapObservationId || commonObservationId);
    const totalSupplyObservationId = String(
      localExactSupply
        ? local.totalSupplyObservationId || commonObservationId
        : positionExactSupply ? boundPosition?.totalSupplyObservationId || '' : ''
    );
    const marketCapObservationTime = Number(
      local.marketCapObservedAt || local.originalObservedAt || local.observedAt || 0
    );
    const totalSupplyObservationTime = Number(
      localExactSupply
        ? local.totalSupplyObservedAt || local.originalObservedAt || local.observedAt || 0
        : positionExactSupply ? boundPosition?.totalSupplyObservedAt || 0 : 0
    );
    const sameValuationObservation = marketCapObservationSource
      && marketCapObservationSource === totalSupplyObservationSource
      && (marketCapObservationId || totalSupplyObservationId
        ? Boolean(marketCapObservationId && marketCapObservationId === totalSupplyObservationId)
        : marketCapObservationTime > 0 && marketCapObservationTime === totalSupplyObservationTime);
    // A supply-only observation cannot change the units of a historical price.
    // Keep the held supply until a factual price or a coherent MC/supply pair
    // can support a neutral calibration.
    const heldSupply = boundPosition && Tango.Supply.resolve({
      ...boundPosition, address: normalizedAddress,
      priceUsd: boundPosition.lastPriceUsd, marketCapUsd: boundPosition.lastMarketCapUsd
    });
    const deferSupplyUpgrade = !safeObservedPrice && !sameValuationObservation
      && localExactSupply > 0 && heldSupply?.totalSupply > 0
      && Number(heldSupply.totalSupply) !== localExactSupply
      && boundPosition?.syntheticTokenPrice !== true
      && boundPosition?.provisionalTokenPrice !== true;
    const supply = Tango.Supply.resolve({
      chain: chain.id,
      totalSupply: deferSupplyUpgrade ? heldSupply.totalSupply
        : localExactSupply || positionExactSupply || legacyFallbackSupply,
      supplySource: deferSupplyUpgrade ? heldSupply.source
        : localExactSupply || positionExactSupply ? 'GMGN_EXACT'
        : legacyFallbackSupply ? 'LEGACY_PUMP_RULE' : '',
      priceUsd: safeObservedPrice,
      marketCapUsd: safeMarketCapUsd,
      address: normalizedAddress,
      observationId: local.observationId,
      priceObservationId: local.priceObservationId,
      marketCapObservationId: local.marketCapObservationId,
      priceObservedAt: local.priceObservedAt || local.originalObservedAt || local.observedAt,
      marketCapObservedAt: local.marketCapObservedAt || local.originalObservedAt || local.observedAt,
      priceSource: local.priceSource || local.source,
      marketCapSource: local.marketCapSource || local.source,
      priceProvenance: local.priceProvenance,
      launchpad: resolvedLaunchpad,
      launchMode: resolvedLaunchMode
    });
    const factualDerivedPrice = mergedHasFactualMarketCap
      && (supply?.source !== 'GMGN_EXACT' || sameValuationObservation
        || (preferTrenchMarketCap && Number(supply?.totalSupply) === cardRuleSupply));
    const calculatedPrice = !safeObservedPrice && safeMarketCapUsd > 0 && supply && factualDerivedPrice
      ? safeMarketCapUsd / supply.totalSupply
      : 0;
    const derivedPrice = Number.isFinite(calculatedPrice) && calculatedPrice > 0 ? calculatedPrice : 0;
    const historicalValue = Number(boundPosition?.lastPriceUsd || boundPosition?.averageEntryPriceUsd || 0);
    // A provisional paper entry is still the account's historical valuation.
    // Missing observations must never reset a held token to the initial fallback
    // market cap. Keep this explicitly provisional; it is not a chart quote.
    const historicalSupplyUnchanged = !Number(supply?.totalSupply)
      || Number(supply.totalSupply) === Number(boundPosition?.totalSupply || boundPosition?.marketCapDivisor);
    const historicalPrice = ((boundPosition?.syntheticTokenPrice !== true
      && boundPosition?.provisionalTokenPrice !== true) || (historicalSupplyUnchanged && !mergedHasFactualMarketCap))
      && Number.isFinite(historicalValue) && historicalValue > 0 ? historicalValue : 0;
    const fallback = Tango.Supply.fallbackValuation({
      chain: chain.id, launchpad: resolvedLaunchpad, launchMode: resolvedLaunchMode
    });
    const preservePositionMarketCap = mergedHasFactualMarketCap && !safeObservedPrice
      && supply?.source === 'GMGN_EXACT' && positionExactSupply > 0 && !localExactSupply
      && !sameValuationObservation && !preferTrenchMarketCap
      && Number.isFinite(historicalMarketCapUsd) && historicalMarketCapUsd > 0;
    const executionMarketCap = preservePositionMarketCap
      ? historicalMarketCapUsd : safeMarketCapUsd || fallback.marketCapUsd;
    const syntheticMarketCap = !preservePositionMarketCap && !(safeMarketCapUsd > 0);
    const executionSupply = supply?.totalSupply || fallback.totalSupply;
    const fallbackPrice = executionMarketCap / executionSupply;
    const priceUsd = safeObservedPrice || derivedPrice || historicalPrice || fallbackPrice;
    const native = lastKnownNativeObservation(chain.id, local, boundPosition, persistenceOnly);
    const nativePriceUsd = Number(native.price || 1);
    const now = Date.now();
    // Position history is a paper execution fallback, not a fresh observation.
    // In particular, a no-chart detail snapshot may carry priceObservedAt: 0.
    // Do not validate that missing timestamp as the time of the historical price,
    // or publish the historical fallback as a factual chart coordinate.
    const syntheticTokenPrice = !(safeObservedPrice > 0 || derivedPrice > 0);
    const usesPositionHistory = syntheticTokenPrice && historicalPrice > 0;
    const syntheticNativePrice = !(native.price > 0);
    const fallbackSupply = derivedPrice > 0 && supply?.confidence === 'fallback';
    const provisionalSupply = !usesPositionHistory
      && (syntheticTokenPrice || (syntheticMarketCap && safeObservedPrice > 0))
      && !['GMGN_EXACT', 'GMGN_RATIO'].includes(String(supply?.source || ''))
      ? Number(executionSupply) : 0;
    const internalUnknownFallbackSupply = (syntheticTokenPrice || (syntheticMarketCap && safeObservedPrice > 0))
      && String(fallback.supplySource || '') === 'UNKNOWN_FALLBACK'
      && Number(executionSupply) === 1_000_000_000
      && provisionalSupply === 1_000_000_000
      && (syntheticMarketCap || Math.abs(executionMarketCap / priceUsd - executionSupply)
        <= executionSupply * 0.001);
    const executionSupplySource = String(
      supply?.source || (internalUnknownFallbackSupply ? fallback.supplySource : '')
    );
    const valuationSource = safeObservedPrice > 0 ? 'OBSERVED_PRICE'
      : derivedPrice > 0 ? 'OBSERVED_MARKET_CAP'
        : historicalPrice > 0 ? 'POSITION_HISTORY'
          : preservePositionMarketCap ? 'POSITION_HISTORY'
          : safeMarketCapUsd > 0 ? 'CARD_MARKET_CAP_FALLBACK_SUPPLY'
            : fallback.valuationSource;
    return {
      ...fallback,
      ...local,
      chain: chain.id,
      address: normalizedAddress,
      launchpad: resolvedLaunchpad,
      launchMode: resolvedLaunchMode,
      provisionalSupply,
      priceUsd,
      marketCapUsd: executionMarketCap,
      marketCapSource: syntheticMarketCap || (historicalPrice > 0 && syntheticTokenPrice)
        ? 'TANGO_FALLBACK' : String(local.marketCapSource || local.source || ''),
      marketCapObservedAt: syntheticMarketCap ? 0 : marketCapObservationTime,
      marketCapObservationId: syntheticMarketCap ? '' : marketCapObservationId,
      liquidityUsd: Number.isFinite(Number(local.liquidityUsd)) && Number(local.liquidityUsd) > 0
        ? Number(local.liquidityUsd) : 0,
      nativePriceUsd,
      observedAt: now,
      nativePriceObservedAt: now,
      originalObservedAt: Number(local.observedAt || 0),
      nativeOriginalObservedAt: Number(native.observedAt || 0),
      source: syntheticTokenPrice
        ? historicalPrice > 0 ? 'TANGO_POSITION_HISTORY' : 'TANGO_FALLBACK'
        : supply?.source === 'LEGACY_PUMP_RULE' && String(local.source || '') === 'GMGN_TRENCH'
          ? 'GMGN_TRENCH_MC' : String(local.source || 'GMGN_LAST_KNOWN'),
      valuationMode: safeObservedPrice > 0 || usesPositionHistory ? 'PRICE'
        : derivedPrice > 0 || internalUnknownFallbackSupply
        ? 'MARKET_CAP' : 'PRICE',
      priceProvenance: usesPositionHistory ? 'POSITION_HISTORY'
        : syntheticTokenPrice ? 'FALLBACK_INITIAL_MARKET_CAP'
        : derivedPrice > 0 ? 'MARKET_CAP_DERIVED' : 'OBSERVED_PRICE',
      totalSupply: Number(executionSupply),
      marketCapDivisor: Number(executionSupply),
      supplySource: executionSupplySource,
      supplyConfidence: supply?.confidence || '',
      valuationSource,
      syntheticTokenPrice,
      syntheticNativePrice,
      provisional: syntheticTokenPrice || syntheticNativePrice || fallbackSupply,
      paperFallback: true
    };
  }

  function supplyQuality(source) {
    return ({
      LEGACY_PUMP_RULE: 1,
      LAUNCHPAD_RULE: 1,
      GMGN_RATIO: 2,
      GMGN_EXACT: 3,
      GMGN_NETWORK_EXACT: 3
    })[String(source || '').toUpperCase()] || 0;
  }

  function positionCalibrationUpgrade(position, quote) {
    if (!position || !quote) return false;
    if (supplyQuality(quote.supplySource) > supplyQuality(position.supplySource)) return true;
    const lateLaunchModeCorrection = String(position.supplySource || '').toUpperCase() === 'LAUNCHPAD_RULE'
      && String(quote.supplySource || '').toUpperCase() === 'LAUNCHPAD_RULE'
      && !String(position.launchMode || '').trim()
      && Boolean(String(quote.launchMode || '').trim())
      && Number.isFinite(Number(position.totalSupply)) && Number(position.totalSupply) > 0
      && Number.isFinite(Number(quote.totalSupply)) && Number(quote.totalSupply) > 0
      && Math.abs(Number(quote.totalSupply) - Number(position.totalSupply))
        > Number(position.totalSupply) * Number.EPSILON;
    if (lateLaunchModeCorrection) return true;
    if (position.initialMarketCapPending === true
      && (quote.syntheticTokenPrice !== true || quote.valuationSource === 'CARD_MARKET_CAP_FALLBACK_SUPPLY')) return true;
    if (position.syntheticTokenPrice === true && quote.syntheticTokenPrice !== true) return true;
    if (position.syntheticNativePrice === true && quote.syntheticNativePrice !== true) return true;
    return (position.needsCalibration === true || position.provisional === true)
      && position.provisional === true && quote.provisional !== true;
  }

  function queueImmediateCurrentCalibration(routeCapture = captureRoute()) {
    if (!routeCaptureIsCurrent(routeCapture)) return null;
    const chain = activeChain();
    const context = runtime.current;
    const position = currentPosition();
    if (!chain || !context?.token || context.token.chain !== chain.id || !position) return null;
    const quote = resolvePaperTradeQuote(context.token, context.quote, {
      position, persistenceOnly: true
    });
    if (!positionCalibrationUpgrade(position, quote)) return null;
    const key = Tango.Engine.positionKey(context.token.chain, context.token.address);
    if (runtime.positionCalibrationPromises.has(key)) {
      const pendingTarget = runtime.positionCalibrationTargets.get(key);
      if (!pendingTarget || positionCalibrationUpgrade(pendingTarget, quote)) {
        runtime.positionCalibrationTargets.set(key, quote);
        runtime.positionCalibrationDirty.add(key);
      }
      return runtime.positionCalibrationPromises.get(key);
    }
    const token = { ...context.token };
    const request = Tango.Store.updatePositionQuote(token, quote)
      .then((state) => {
        if (!routeCaptureIsCurrent(routeCapture) || activeChain()?.id !== token.chain
          || runtime.current?.token?.chain !== token.chain
          || Tango.Chains.normalizeAddress(token.chain, runtime.current.token.address)
            !== Tango.Chains.normalizeAddress(token.chain, token.address)) return runtime.state;
        runtime.state = state;
        runtime.lastQuoteWriteAt = Date.now();
        runtime.lastQuoteWriteKey = key;
        queueRender();
        return runtime.state;
      })
      .catch(() => runtime.state)
      .finally(() => {
        if (runtime.positionCalibrationPromises.get(key) === request) {
          runtime.positionCalibrationPromises.delete(key);
          runtime.positionCalibrationTargets.delete(key);
          const rerun = runtime.positionCalibrationDirty.delete(key);
          if (rerun && routeCaptureIsCurrent(routeCapture)) {
            const nextRequest = queueImmediateCurrentCalibration(captureRoute());
            if (nextRequest) nextRequest.catch(() => null);
          }
        }
      });
    runtime.positionCalibrationPromises.set(key, request);
    runtime.positionCalibrationTargets.set(key, quote);
    return request;
  }

  function requireExecutableQuote(token, candidate, options = {}) {
    const chain = activeChain();
    if (!chain || token?.chain !== chain.id) throw new Error('unsupportedChain');
    const source = String(candidate?.source || '').toUpperCase();
    if (!(source === 'DEXSCREENER' || source.startsWith('GMGN'))) throw new Error('invalidQuote');
    const nativePriceUsd = options?.persistenceOnly === true
      ? freshPersistentNativePrice(chain.id) : freshNativePrice(chain.id);
    if (!(nativePriceUsd > 0)) throw new Error('nativePriceUnavailable');
    const quote = {
      ...candidate,
      nativePriceUsd,
      nativePriceObservedAt: (options?.persistenceOnly === true
        ? runtime.persistentNativePriceObservedAt : runtime.nativePriceObservedAt).get(chain.id)
    };
    const baseContext = executionValidationBaseContext(token);
    const validation = Tango.Engine.validateQuote(
      quote, Date.now(), undefined, baseContext,
      executionValidationTrustContext(baseContext, token)
    );
    if (!validation.ok) throw new Error(validation.reason);
    return quote;
  }

  function executableQuote(token, candidate, options = {}) {
    try { return requireExecutableQuote(token, candidate, options); }
    catch { return null; }
  }

  function persistedQuoteContext(token) {
    const chain = token?.chain;
    const address = token?.tokenAddress || token?.address;
    if (!chain || !address) return token;
    return runtime.state?.positions?.[Tango.Engine.positionKey(chain, address)] || token;
  }

  function executionValidationBaseContext(token) {
    const chain = Tango.Chains.get(token?.chain)?.id;
    const address = token?.tokenAddress || token?.address;
    if (!chain || !Tango.Chains.validateAddress(chain, address)) return null;
    const normalizedAddress = Tango.Chains.normalizeAddress(chain, address);
    const position = runtime.state?.positions?.[Tango.Engine.positionKey(chain, normalizedAddress)];
    return position || { chain, address: normalizedAddress, tokenAddress: normalizedAddress };
  }

  function executionValidationTrustContext(baseContext, token) {
    const chain = Tango.Chains.get(baseContext?.chain)?.id;
    const baseAddress = baseContext?.tokenAddress || baseContext?.address;
    const tokenAddress = token?.tokenAddress || token?.address;
    const trustedSource = ['GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK']
      .includes(String(token?.metadataSource || '').toUpperCase());
    const sameToken = chain && token?.chain === chain
      && Tango.Chains.validateAddress(chain, baseAddress)
      && Tango.Chains.validateAddress(chain, tokenAddress)
      && Tango.Chains.normalizeAddress(chain, baseAddress) === Tango.Chains.normalizeAddress(chain, tokenAddress);
    if (token?.metadataVerified !== true || !trustedSource || !sameToken) return baseContext;
    return { ...baseContext, launchpad: token?.launchpad, launchMode: token?.launchMode };
  }

  function freshExecutableQuoteResult(position) {
    const chain = activeChain();
    if (!chain || position?.chain !== chain.id) return { quote: null, reason: 'unsupportedChain' };
    const address = Tango.Chains.normalizeAddress(chain.id, position.tokenAddress);
    const currentMatches = runtime.current?.token?.chain === chain.id
      && Tango.Chains.normalizeAddress(chain.id, runtime.current.token.address) === address;
    const candidate = currentMatches ? runtime.current.quote : freshGmgnQuote(chain.id, address);
    try { return { quote: requireExecutableQuote(position, candidate), reason: null }; }
    catch (error) {
      // A fresh observed cap can value a paper position while exact token supply
      // is still unknown. Use the same resolved observation as detail execution,
      // rather than silently waiting for the ten-second durable quote write.
      const normalized = normalizeObservationDimensions(candidate);
      if (trustedCachedObservation(normalized, chain.id, address, Number(Tango.QUOTE_STALE_MS || 15_000))) {
        const token = currentMatches ? runtime.current.token : { ...position, address };
        const resolved = resolvePaperTradeQuote(token, normalized, { position });
        const observedCap = resolved?.valuationSource === 'CARD_MARKET_CAP_FALLBACK_SUPPLY'
          && ['GMGN', 'GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'].includes(String(resolved.marketCapSource || '').toUpperCase())
          && Number(resolved.marketCapObservedAt) > 0;
        if (observedCap && Tango.Engine.validateQuote(resolved, Date.now(), undefined, position,
          executionValidationTrustContext(position, token)).ok) return { quote: resolved, reason: null };
      }
      return { quote: null, reason: error?.message || 'invalidQuote' };
    }
  }

  function freshExecutableQuote(position) {
    const chain = activeChain();
    const currentMatches = runtime.current?.token?.chain === position.chain
      && Tango.Chains.normalizeAddress(position.chain, runtime.current.token.address) === position.tokenAddress;
    if (chain?.id === position.chain && !currentMatches) {
      const snapshot = Tango.GMGN.readTrenchSnapshot?.(position.chain, position.tokenAddress);
      const age = Date.now() - Number(snapshot?.quote?.observedAt || 0);
      const sameToken = snapshot?.token?.chain === position.chain
        && Tango.Chains.validateAddress(position.chain, snapshot.token.address)
        && Tango.Chains.normalizeAddress(position.chain, snapshot.token.address) === position.tokenAddress;
      if (sameToken && age >= 0 && age <= Number(Tango.QUOTE_STALE_MS || 15_000)) {
        const quote = resolvePaperTradeQuote(snapshot.token, snapshot.quote, { position });
        if (quote) return quote;
      }
    }
    return freshExecutableQuoteResult(position).quote;
  }

  function positionUrl(position) {
    return Tango.Chains.tokenUrl(position.chain, position.tokenAddress);
  }

  async function openPosition(position) {
    host.setAttribute('data-tango-token-open-status', 'requested');
    host.setAttribute('data-tango-token-open-result', '');
    try {
      const response = await sendContentMessage({ type: 'TANGO_OPEN_TOKEN', url: positionUrl(position) });
      if (response?.opening && typeof response.opening === 'object') {
        const opening = Object.fromEntries(['sourceWindowKnown', 'returnedWindowKnown', 'returnedTab', 'hasTabId', 'sameWindow', 'active'].map((key) => [
          key, typeof response.opening[key] === 'boolean' ? response.opening[key] : null
        ]));
        host.setAttribute('data-tango-token-open-result', JSON.stringify(opening));
      }
      if (!response?.ok) throw new Error(response?.error || '');
      host.setAttribute('data-tango-token-open-status', 'accepted');
    } catch (error) {
      host.setAttribute('data-tango-token-open-status', 'failed');
      const detail = String(error?.message || '').trim().slice(0, 300);
      showToast(detail ? `${t('openTokenFailed')}: ${detail}` : t('openTokenFailed'), 'error');
    }
  }

  async function handleQuickBuy(context) {
    if (paperExecutionDisabled()) return;
    const clickContext = {
      ...(context || {}),
      token: context?.token ? { ...context.token } : context?.token,
      quote: context?.quote ? { ...context.quote } : context?.quote
    };
    const routeCapture = captureRoute();
    const chain = executionChain(clickContext.token);
    if (!chain || clickContext.token?.chain !== chain.id) return showToast(t('unsupportedChain'), 'error');
    let amountNative = Number(clickContext.amountNative ?? clickContext.amountSol);
    if (combinedTrench() && clickContext.side !== 'SELL') {
      if (typeof clickContext.validate === 'function' && clickContext.validate() !== true) return showToast(t('invalidQuote'), 'error');
      // Mixed GMGN amounts are not silently reinterpreted or converted.
      if (clickContext.amountChain !== chain.id) return showToast(t('invalidQuote'), 'error');
    }
    const lockKey = clickContext.actionId
      ? `action:${clickContext.actionId}`
      : `${gmgnQuoteKey(chain.id, clickContext.token.address)}:${amountNative}`;
    // Deduplicate only while this action is in flight. Distinct trusted clicks
    // after settlement must not disappear inside a fixed one-second window.
    if (runtime.quickBuyLocks.has(lockKey)) return;
    runtime.quickBuyLocks.set(lockKey, true);
    try {
      if (clickContext.side === 'SELL') {
        const key = Tango.Engine.positionKey(chain.id, clickContext.token.address);
        const position = runtime.state.positions[key];
        if (!position) return showToast(t('noPosition'), 'error');
        const quote = resolvePaperTradeQuote(clickContext.token, clickContext.quote, { position });
        if (!quote) return showToast(t('invalidQuote'), 'error');
        const percent = clickContext.breakeven === true
          ? Tango.Engine.breakevenSellPercent(position, quote, runtime.settings)
          : Number(clickContext.sellPercent);
        if (!(percent > 0 && percent <= 100)) {
          return showToast(t(clickContext.breakeven === true ? 'breakevenUnavailable' : 'invalidAmount'), 'error');
        }
        return await sell(percent, { token: clickContext.token, quote, validate: clickContext.validate,
          ...(clickContext.breakeven === true ? { breakeven: true } : {}) }, routeCapture);
      }
      if (clickContext.side && clickContext.side !== 'BUY') return showToast(t('invalidAmount'), 'error');
      const afterBuyDetailMode = synchronizeAfterBuyDetailPreference();
      await buy(amountNative, { ...clickContext, amountNative, afterBuyDetailMode }, routeCapture);
    } finally { runtime.quickBuyLocks.delete(lockKey); }
  }

  async function buy(amountNative, context = runtime.current, routeCapture = captureRoute()) {
    if (paperExecutionDisabled()) return;
    primeTradeAudio();
    if (!routeCaptureIsCurrent(routeCapture)) return;
    if (!runtime.state.initialized) return showToast(t('startPaperTrading'), 'error');
    const chain = executionChain(context?.token);
    const order = {
      token: context?.token,
      quote: null,
      amountNative: Number(amountNative),
      sourceUrl: context?.sourceUrl || location.href
    };
    try {
      if (validAfterBuyDetailMode(context?.afterBuyDetailMode)) {
        quickBuyDetailIntents.set(order, context.afterBuyDetailMode);
      }
      if (typeof context?.validate === 'function') quickBuyOrderValidators.set(order, context.validate);
      validateQuickBuyOrder(order);
      if (!chain || order.token?.chain !== chain.id) throw new Error('unsupportedChain');
      if (!(order.amountNative > 0)) throw new Error('invalidAmount');
      if (order.amountNative > Number(runtime.state.accounts[chain.id]?.cashBalanceNative || 0)) throw new Error('insufficientBalance');
      order.quote = resolvePaperTradeQuote(context?.token, context?.quote);
      if (requiresConfirmation() && routeMatchesDetailToken(order.token)) {
        order.quote = resolveCommitPaperTradeQuote(order, null, routeCapture);
      }
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

  function routeMatchesDetailToken(token) {
    if (!Tango.GMGN._isTokenDetailPage?.()) return false;
    const chain = activeChain();
    if (!chain || token?.chain !== chain.id) return false;
    let routeAddress;
    try { routeAddress = Tango.GMGN.tokenAddressFromUrl(); } catch { return false; }
    const address = token?.address || token?.tokenAddress;
    return Tango.Chains.validateAddress(chain.id, address)
      && Tango.Chains.validateAddress(chain.id, routeAddress)
      && Tango.Chains.normalizeAddress(chain.id, address)
        === Tango.Chains.normalizeAddress(chain.id, routeAddress);
  }

  function resolveCommitPaperTradeQuote(order, position, routeCapture) {
    if (!routeCaptureIsCurrent(routeCapture)) return null;
    if (position && !Tango.GMGN._isTokenDetailPage?.()) {
      const token = order?.token;
      const snapshot = Tango.GMGN.readTrenchSnapshot?.(token?.chain, token?.address);
      const address = snapshot?.token?.address;
      const observedAt = Number(snapshot?.quote?.observedAt || 0);
      if (token && snapshot?.token?.chain === token.chain
        && snapshot.token.metadataVerified === true && snapshot.token.metadataSource === 'GMGN_TRENCH'
        && Tango.Chains.validateAddress(token.chain, address)
        && Tango.Chains.normalizeAddress(token.chain, address) === Tango.Chains.normalizeAddress(token.chain, token.address)
        && observedAt > 0 && observedAt <= Date.now() + 5000
        && Date.now() - observedAt <= Number(Tango.QUOTE_STALE_MS || 15000)) {
        return resolvePaperTradeQuote(snapshot.token, snapshot.quote, { position });
      }
    }
    // A sell confirmation can outlive or lag a factual quote. Resolve the
    // position's paper exit again instead of pinning its preview. Buys retain their
    // existing stale-preview protection; provisional estimates keep their value.
    const fallback = position
      ? resolvePaperTradeQuote(order?.token, order?.quote, { position })
      : order?.quote || resolvePaperTradeQuote(order?.token, order?.quote, { position });
    if (!routeMatchesDetailToken(order?.token)) return fallback;
    const snapshot = Tango.GMGN.readVerifiedCurrentTokenSnapshot?.(order.token, { allowMarketCapOnly: true });
    if (!routeCaptureIsCurrent(routeCapture)) return null;
    const address = snapshot?.token?.address || snapshot?.token?.tokenAddress;
    const quoteAddress = snapshot?.quote?.address || snapshot?.quote?.tokenAddress;
    if (snapshot?.token?.chain !== order.token.chain
      || !Tango.Chains.validateAddress(order.token.chain, address)
      || Tango.Chains.normalizeAddress(order.token.chain, address)
        !== Tango.Chains.normalizeAddress(order.token.chain, order.token.address)) return fallback;
    const maxAgeMs = Number(Tango.QUOTE_STALE_MS || 15_000);
    const normalizedQuote = normalizeObservationDimensions(snapshot.quote, maxAgeMs);
    const expectedAddress = Tango.Chains.normalizeAddress(order.token.chain, order.token.address);
    const boundMarketCapOnly = snapshot.token.metadataVerified === true
      && snapshot.token.metadataSource === 'GMGN_DETAIL'
      && snapshot.quote.source === 'GMGN' && snapshot.quote.marketCapSource === 'GMGN'
      && Number(snapshot.quote.priceUsd) === 0 && snapshot.quote.priceProvenance === ''
      && Number(normalizedQuote?.marketCapUsd) > 0
      && freshObservationTime(snapshot.quote.marketCapObservedAt, maxAgeMs);
    if (snapshot.quote?.chain !== order.token.chain
      || !Tango.Chains.validateAddress(order.token.chain, quoteAddress)
      || Tango.Chains.normalizeAddress(order.token.chain, quoteAddress) !== expectedAddress
      || !trustedCachedObservation(
        normalizedQuote, order.token.chain, expectedAddress, maxAgeMs
      )
      || (!boundMarketCapOnly && !acceptedTokenObservation(normalizedQuote, snapshot.token, maxAgeMs))) return fallback;
    // A verified, current, same-token observation that fails coherence is an
    // execution veto. Falling back here would silently undo quote validation.
    return resolvePaperTradeQuote(order.token, normalizedQuote, { position, preferCandidate: true });
  }

  function previewBuy(order, routeCapture) {
    if (!routeCaptureIsCurrent(routeCapture)) return;
    const chain = executionChain(order.token);
    const account = chain && runtime.state.accounts[chain.id];
    const settings = chain && (runtime.settings.chainSettings?.[chain.id] || runtime.settings.chains?.[chain.id]);
    if (!chain || order.token?.chain !== chain.id || !account || !settings) throw new Error('unsupportedChain');
    const baseContext = executionValidationBaseContext(order.token);
    const validation = Tango.Engine.validateQuote(
      order.quote, Date.now(), undefined, baseContext,
      executionValidationTrustContext(baseContext, order.token)
    );
    if (!validation.ok) {
      recordQuoteRejection(`buy-preview:${validation.reason}`, order.token, order.quote);
      throw new Error(validation.reason);
    }
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
    if (paperExecutionDisabled() || !routeCaptureIsCurrent(routeCapture)) return;
    if (runtime.tradePending) return;
    runtime.tradePending = true;
    let committed = false;
    try {
      if (!routeCaptureIsCurrent(routeCapture) || !executionChain(order.token)) throw new Error('unsupportedChain');
      validateQuickBuyOrder(order);
      const finalQuote = resolveCommitPaperTradeQuote(order, null, routeCapture);
      if (!finalQuote) throw new Error('invalidQuote');
      const quote = paperExecutableQuote(order.token, finalQuote);
      if (!quote) throw new Error('invalidQuote');
      const executableOrder = { ...order, quote };
      const result = await Tango.Store.executeBuy(executableOrder);
      runtime.state = result.state;
      publishChartMarkers(true);
      committed = true;
      runtime.modal = null;
      playTradeSound('BUY');
      const chain = Tango.Chains.require(order.token.chain);
      showToast(`${t('buySuccess')} · ${Tango.Format.native(order.amountNative, chain.nativeSymbol, language())} ${order.token.symbol}`, 'success');
    } catch (error) { runtime.modal = null; showToast(t(error.message), 'error'); }
    finally { runtime.tradePending = false; }
    // Navigation failure cannot turn a settled buy into a failed-trade report.
    if (committed) {
      followQuickBuyDetail(order, routeCapture).catch(() => showToast(t('openTokenFailed'), 'error'));
    }
  }

  function entryDetailNeedsRead(context) {
    return routeMatchesDetailToken(context?.token)
      && (context.token.metadataVerified === false
        || (context.token.metadataSource && context.token.metadataSource !== 'GMGN_DETAIL'));
  }

  async function readEntryDetailContext(context, routeCapture) {
    // This is the adapter's bounded DOM identity read, never a network wait.
    const observed = await Tango.GMGN.readCurrentToken();
    if (!routeCaptureIsCurrent(routeCapture)) return null;
    const resolved = Tango.GMGN.resolveCurrentTokenRead(context, observed);
    if (resolved?.token?.chain !== context.token.chain
      || Tango.Chains.normalizeAddress(context.token.chain, resolved.token.address)
        !== Tango.Chains.normalizeAddress(context.token.chain, context.token.address)) return context;
    runtime.current = resolved;
    queueRender();
    return resolved;
  }

  async function sell(percent, context = runtime.current, routeCapture = captureRoute()) {
    if (paperExecutionDisabled()) return;
    primeTradeAudio();
    if (!routeCaptureIsCurrent(routeCapture)) return;
    const order = { token: context?.token, quote: null, percent: Number(percent), sourceUrl: location.href };
    if (typeof context?.validate === 'function') quickBuyOrderValidators.set(order, context.validate);
    if (context?.breakeven === true) order.breakeven = true;
    try {
      if (!executionChain(order.token)) throw new Error('unsupportedChain');
      const key = Tango.Engine.positionKey(order.token?.chain, order.token?.address);
      const position = runtime.state.positions[key];
      if (!position) throw new Error('noPosition');
      if (!(order.percent > 0 && order.percent <= 100)) throw new Error('invalidAmount');
      if (entryDetailNeedsRead(context)) {
        context = await readEntryDetailContext(context, routeCapture);
        if (!context) return;
      }
      // Preview and commit both consult the verified header. A stale mixed
      // cached quote must not reject the action before the fresh DOM is read.
      order.quote = resolveCommitPaperTradeQuote({ ...order, quote: context?.quote }, position, routeCapture);
      if (!order.quote) throw new Error('invalidQuote');
      refreshPaperQuoteInBackground(order.token);
      const baseContext = executionValidationBaseContext(order.token);
      const validation = Tango.Engine.validateQuote(
        order.quote, Date.now(), undefined, baseContext,
        executionValidationTrustContext(baseContext, order.token)
      );
      if (!validation.ok) throw new Error(validation.reason);
      if (requiresConfirmation()) {
        const valuationRow = displaysMarketCapValuation(order.quote)
          ? [t('marketCap'), Tango.Format.usd(order.quote.marketCapUsd, language(), true)]
          : [t('observedPrice'), Tango.Format.usd(order.quote.priceUsd, language())];
        const provisionalNote = order.quote.provisional === true ? t('provisionalQuote') : undefined;
        runtime.modal = {
          type: 'confirm', title: t('simulatedSell'),
          rows: [[t('token'), order.token.symbol], [t('amount'), `${order.breakeven ? Tango.Format.number(percent, language(), 2) : percent}%`], valuationRow],
          note: [provisionalNote,
            order.breakeven ? t('breakevenRecalculated') : ''].filter(Boolean).join(' ') || undefined,
          allowSessionSuppress: true,
          action: () => commitSell(order, routeCapture)
        };
        return render();
      }
      await commitSell(order, routeCapture);
    } catch (error) {
      recoverRejectedSellQuote('sell-preview', order.token, order.quote || context?.quote, error);
      showToast(t(error.message), 'error');
    }
  }

  async function sellPosition(position, percent) {
    if (paperExecutionDisabled()) return;
    if (activeChain()?.id !== position.chain) return showToast(t('unsupportedChain'), 'error');
    const routeCapture = captureRoute();
    const token = { chain: position.chain, address: position.tokenAddress, symbol: position.symbol };
    const quote = resolveCommitPaperTradeQuote({ token, quote: positionQuote(position) }, position, routeCapture);
    if (!quote) {
      recoverRejectedSellQuote('sell-position', token, positionQuote(position), new Error('invalidQuote'));
      return showToast(t('invalidQuote'), 'error');
    }
    refreshPaperQuoteInBackground(token);
    await sell(percent, { token, quote }, routeCapture);
  }

  async function commitSell(order, routeCapture = captureRoute()) {
    if (paperExecutionDisabled() || !routeCaptureIsCurrent(routeCapture)) return;
    if (runtime.tradePending) return;
    runtime.tradePending = true;
    try {
      if (!routeCaptureIsCurrent(routeCapture) || !executionChain(order.token)) throw new Error('unsupportedChain');
      validateQuickBuyOrder(order);
      const position = persistedQuoteContext(order.token);
      const finalQuote = resolveCommitPaperTradeQuote(order, position, routeCapture);
      if (!finalQuote) throw new Error('invalidQuote');
      const quote = paperExecutableQuote(order.token, finalQuote, position);
      if (!quote) throw new Error('invalidQuote');
      const executableOrder = { ...order, quote };
      const result = await Tango.Store.executeSell(executableOrder);
      runtime.state = result.state;
      publishChartMarkers(true);
      runtime.modal = null;
      playTradeSound('SELL');
      const displayedPercent = order.breakeven && Number.isFinite(result.executedPercent)
        ? Tango.Format.number(result.executedPercent, language(), 2) : order.percent;
      showToast(`${t('sellSuccess')} · ${displayedPercent}% ${order.token.symbol}`, 'success');
    } catch (error) {
      recoverRejectedSellQuote('sell-commit', order.token, order.quote, error);
      runtime.modal = null; showToast(t(error.message), 'error');
    }
    finally { runtime.tradePending = false; }
  }

  function requestCloseAll() {
    if (paperExecutionDisabled()) return;
    const routeCapture = captureRoute();
    const chain = activeChain();
    if (!chain) return showToast(t('unsupportedChain'), 'error');
    const positions = Tango.ChainView.positions(runtime.state, chain.id);
    if (!positions.length) return showToast(t('noPositions'), 'error');
    const summary = Tango.Engine.portfolioSummary(runtime.state, chain.id, currentNativePriceUsd(), freshExecutableQuote);
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
    if (paperExecutionDisabled() || !routeCaptureIsCurrent(routeCapture)) return;
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
    if (paperExecutionDisabled()) return;
    const routeCapture = captureRoute();
    if (entryDetailNeedsRead(runtime.current)) {
      if (!await readEntryDetailContext(runtime.current, routeCapture)) return;
    }
    const position = currentPosition();
    if (!position) return showToast(t('noPosition'), 'error');
    if (Tango.Engine.breakevenTargetNative?.(position) === 0) return showToast(t('breakevenRecovered'), 'success');
    const quote = resolveCommitPaperTradeQuote({ token: runtime.current?.token, quote: runtime.current?.quote }, position, routeCapture);
    if (!quote) return showToast(t('invalidQuote'), 'error');
    refreshPaperQuoteInBackground(runtime.current.token);
    const percent = Tango.Engine.breakevenSellPercent(position, quote, runtime.settings);
    if (!(percent > 0 && percent <= 100)) return showToast(t('breakevenUnavailable'), 'error');
    await sell(percent, { ...runtime.current, breakeven: true }, routeCapture);
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
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return null;
      if (!runtime.audioContext || runtime.audioContext.state === 'closed') runtime.audioContext = new AudioContext();
      if (runtime.audioContext.state === 'suspended') runtime.audioContext.resume().catch(() => {});
      return runtime.audioContext;
    } catch { return null; }
  }

  function playTradeSound(side) {
    if (!runtime.settings?.soundEnabled) return;
    const context = primeTradeAudio();
    if (!runtime.tradeSounds && global.Audio) {
      try {
        runtime.tradeSounds = {
          BUY: new global.Audio('https://gmgn.ai/static/sounds/Handgun.mp3'),
          SELL: new global.Audio('https://gmgn.ai/static/sounds/Kaching.mp3')
        };
        Object.values(runtime.tradeSounds).forEach((audio) => { audio.volume = 0.55; });
      } catch { return; }
    }
    const template = runtime.tradeSounds?.[side];
    const sound = template?.cloneNode?.(true) || template;
    if (sound) {
      let settled = false;
      let watchdog;
      const fallback = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        sound.pause?.();
        if (runtime.settings?.soundEnabled) playFallbackTradeSound(side, context);
      };
      try {
        sound.volume = 0.55;
        sound.currentTime = 0;
        // play() may remain pending on a stalled media resource, without rejecting.
        watchdog = setTimeout(fallback, 800);
        const playback = sound.play();
        const started = () => {
          if (settled) { sound.pause?.(); return; }
          settled = true;
          clearTimeout(watchdog);
          if (!runtime.settings?.soundEnabled) sound.pause?.();
        };
        if (playback?.then) playback.then(started, fallback);
        else started();
        return;
      } catch { fallback(); return; }
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

  function currentPnlDateKey() {
    const date = new Date();
    return calendarDateKey(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function refreshDailyPnl() {
    if (runtime.extensionInvalidated || !runtime.settings?.enabled || !runtime.state?.initialized) return;
    const key = currentPnlDateKey();
    if (runtime.pnlDateKey === key) return;
    runtime.pnlDateKey = key;
    queueRender();
  }

  function renderBar(summary) {
    const collapsed = runtime.settings.barCollapsed;
    const key = currentPnlDateKey();
    runtime.pnlDateKey = key;
    // Read the durable daily ledger directly: cached portfolio totals can span midnight.
    // Use the same native/USD formatting as the calendar's day cells.
    const pnl = Number(Tango.ChainView.daily(runtime.state, activeChain()?.id)[key]?.native || 0);
    const pnlMoney = accountMoney(pnl, true);
    return `<div class="tango-bar tango-card ${esc(runtime.settings.pnlBarPosition)} ${collapsed ? 'collapsed' : ''}" style="${floatingLayoutStyle('bar')}">
      <div class="tango-bar-main" data-action="toggle-drawer">
        ${collapsed ? `<strong class="${pnlClass(pnl)}">${pnlMoney}</strong>` : `
          <span class="tango-paper-badge tango-bar-paper">${t('paper')}</span>
          <div class="tango-stat tango-pnl-hero"><strong class="${pnlClass(pnl)}">${pnlMoney}</strong><span>${t('todayPnl')}${esc(accountChainLabel())}</span></div>`}
        <span class="tango-bar-hint">${t('clickForPositions')} · ${summary.positionCount}</span>
      </div>
      <button class="tango-icon-button" data-action="reset-bar-size" title="${t('resetSize')}" aria-label="${t('resetSize')}">↺</button>
      <button class="tango-icon-button" data-action="collapse-bar">${collapsed ? '＋' : '－'}</button>
      ${floatingResizeHandles('bar')}
    </div>`;
  }

  function calendarDateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function renderTutorialLink() {
    return '<a class="tango-button tango-tutorial-link" href="https://t.co/H2RSVQV4sX" target="_blank" rel="noopener noreferrer">' + esc(t('chainTutorial')) + '</a>';
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
      cells.push(`<button type="button" data-action="daily-report" data-date="${key}" title="${esc(Tango.DailyReport.labels(language()).title)}" class="tango-calendar-day ${pnl > 0 ? 'win' : pnl < 0 ? 'loss' : ''} ${isToday ? 'today' : ''}"><span>${day}</span><strong class="${pnlClass(pnl)}">${pnl ? accountMoney(pnl, true) : '—'}</strong></button>`);
    }
    return `<div class="tango-calendar tango-card">
      <div class="tango-calendar-header"><div><span class="tango-paper-badge">${t('paper')}</span><strong>${t('pnlCalendar')}${esc(accountChainLabel())}</strong></div><button class="tango-icon-button" data-action="close-calendar">×</button></div>
      <div class="tango-calendar-summary"><div><span>${t('totalPnl')}</span><strong class="${pnlClass(monthPnl)}">${accountMoney(monthPnl, true)}</strong></div><div><span>${t('date')}</span><strong>${activeDays}</strong></div></div>
      <div class="tango-calendar-nav"><button class="tango-icon-button" data-action="calendar-prev">‹</button><strong>${date.toLocaleDateString(language(), { year: 'numeric', month: 'long' })}</strong><button class="tango-icon-button" data-action="calendar-next">›</button></div>
      <div class="tango-calendar-grid">${labels.map((label) => `<span class="tango-calendar-label">${esc(label)}</span>`).join('')}${cells.join('')}</div>
      <div class="tango-calendar-actions">
        <button type="button" class="tango-button tango-calendar-dashboard" data-action="daily-review">${language()==='zh-CN'?'每日复盘':'Daily review'}</button>
        <button class="tango-button tango-calendar-dashboard" data-action="dashboard-history">${t('currentChainTrades')} ↗</button>
        ${renderTutorialLink()}
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
        align-items: center; background: rgba(16,19,17,.96); border: 1px solid rgba(198,250,116,.34);
        border-radius: 8px; color: #a5afa4; cursor: pointer; display: flex; font: 650 12px/24px Inter,ui-sans-serif,system-ui,sans-serif;
        gap: 8px; padding: 4px 9px; pointer-events: auto; position: absolute; right: 0;
        top: calc(100% + 2px); white-space: nowrap; width: max-content; z-index: 80;
      }
      #tango-header-account-summary:hover { background: rgba(34,43,32,.98); border-color: rgba(198,250,116,.65); }
      #tango-header-account-summary strong { color: #72f0bd; font-size: 14px; font-weight: 900; }
      #tango-header-account-summary i { background: rgba(255,255,255,.12); height: 13px; width: 1px; }
      #tango-header-account-summary .tango-header-paper-badge { color: #c6fa74; font-size: 10px; font-weight: 850; letter-spacing: .04em; }
      #tango-header-account-summary .tango-header-calendar-link { color: #d4f2ad; font-size: 11px; font-weight: 800; }
      #tango-header-account-summary[data-theme="light"] { background: rgba(255,255,255,.98); color: #1b2030; border-color: rgba(26,31,48,.18); }
      #tango-header-account-summary[data-theme="light"]:hover { background: #f0f2f8; }
      #tango-header-account-summary[data-theme="light"] strong { color: #08794e; }
      #tango-header-account-summary[data-theme="light"] i { background: rgba(26,31,48,.18); }
      #tango-header-account-summary[data-theme="light"] .tango-header-paper-badge,
      #tango-header-account-summary[data-theme="light"] .tango-header-calendar-link { color: #355811; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function renderHeaderAccountSummary(summary) {
    const anchor = document.querySelector('[data-testid="wallet-connected"]')
      || document.querySelector('[data-testid="header-actions"]')
      || document.querySelector('[data-sentry-component="Connect"]')
      || document.querySelector('header')
      || document.querySelector('[role="banner"]')
      || document.querySelector('[data-sentry-component="Header"]');
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
      node.onclick = (event) => {
        if (!requireTrustedUserEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        runtime.calendarOpen = !runtime.calendarOpen;
        render();
      };
      node.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!requireTrustedUserEvent(event)) return;
        event.preventDefault();
        runtime.calendarOpen = !runtime.calendarOpen;
        render();
      };
    }
    if (node.parentElement !== anchor) {
      node.parentElement?.classList.remove('tango-header-summary-anchor', 'tango-wallet-summary-anchor');
      anchor.appendChild(node);
    }
    setContentClass(anchor, 'tango-header-summary-anchor', true);
    applyContentTheme();
    const cash = Tango.Format.native(account.cashBalanceNative, chain.nativeSymbol, language());
    const markup = `<span class="tango-header-paper-badge">${esc(t('paper'))}</span><span>${esc(t('paperBalance'))}${esc(accountChainLabel())} <strong>${esc(cash)}</strong></span><i></i><span class="tango-header-calendar-link">▦ ${esc(t('pnlCalendar'))}</span>`;
    if (node.innerHTML !== markup) node.innerHTML = markup;
    node.title = t('pnlCalendar');
  }

  function capturePresetDraft() {
    if (runtime.presetEditing !== 'all') return;
    const chain = activeChain()?.id;
    if (runtime.presetDraft && runtime.presetDraft.chain !== chain) {
      runtime.presetDraft = { chain };
      return;
    }
    if (!runtime.presetDraft) runtime.presetDraft = { chain };
    for (const side of ['buy', 'sell']) {
      const inputs = [...shadow.querySelectorAll(`[data-preset-side="${side}"]`)];
      if (inputs.length) runtime.presetDraft[side] = inputs.map((input) => String(input.value));
    }
  }

  function renderPresetGrid(side, values) {
    if (runtime.presetEditing === 'all') {
      const draft = runtime.presetDraft?.chain === activeChain()?.id ? runtime.presetDraft[side] : null;
      return (draft || values).map((value, index) => `<input class="tango-preset-editor ${side}" data-preset-side="${side}" data-preset-index="${index}" type="number" min="0.0001" ${side === 'sell' ? 'max="100"' : ''} step="any" value="${esc(value)}">`).join('');
    }
    const attribute = side === 'buy' ? 'data-buy' : 'data-sell';
    return values.map((value) => `<button class="tango-button tango-preset ${side}-preset" ${attribute}="${value}">${value}${side === 'sell' ? '%' : ''}</button>`).join('');
  }

  async function savePresetEdits() {
    capturePresetDraft();
    const readValues = (side) => [...shadow.querySelectorAll(`[data-preset-side="${side}"]`)].map((input) => Number(input.value));
    const buyValues = readValues('buy');
    const sellValues = readValues('sell');
    const validBuy = buyValues.length === 8 && buyValues.every((value) => Number.isFinite(value) && value > 0);
    const validSell = sellValues.length === 8 && sellValues.every((value) => Number.isFinite(value) && value > 0 && value <= 100);
    if (!validBuy || !validSell) return showToast(t('invalidPresets'), 'error');
    const chain = activeChain();
    if (!chain || !chainSettings()) return showToast(t('unsupportedChain'), 'error');
    const savingDraft = runtime.presetDraft;
    const savingValues = JSON.stringify(savingDraft);
    try {
      runtime.settings = await Tango.Store.patchSettings({
        chains: { [chain.id]: { buyPresets: buyValues } },
        sellPresets: sellValues
      });
      capturePresetDraft();
      if (runtime.presetEditing === 'all' && activeChain()?.id === chain.id
        && runtime.presetDraft === savingDraft && JSON.stringify(runtime.presetDraft) === savingValues) {
        runtime.presetEditing = null;
        runtime.presetDraft = null;
      }
      showToast(t('presetsSaved'), 'success');
    } catch {
      showToast(t('settingsSaveFailed'), 'error');
    }
  }

  function tokenTradeTotals(chain, address, trades) {
    const normalizedAddress = Tango.Chains.normalizeAddress(chain, address);
    let totalBuy = 0; let totalSell = 0; let realizedPnl = 0;
    (trades || []).forEach((trade) => {
      if (trade.chain !== chain
        || Tango.Chains.normalizeAddress(trade.chain, trade.tokenAddress) !== normalizedAddress) return;
      if (trade.side === 'BUY') totalBuy += Number(trade.amountNative || 0);
      else if (trade.side === 'SELL') {
        totalSell += Number(trade.amountNative || 0);
        realizedPnl += Number(trade.realizedPnlNative || 0);
      }
    });
    return { totalBuy, totalSell, realizedPnl };
  }

  function refreshDetailDisplayQuote() {
    if (!runtime.settings?.enabled || !runtime.state?.initialized) return false;
    const context = runtime.current;
    if (!context?.token || !routeMatchesDetailToken(context.token)) return false;
    const routeCapture = captureRoute();
    const snapshot = Tango.GMGN.readVerifiedCurrentTokenSnapshot?.(context.token);
    const address = snapshot?.token?.address || snapshot?.token?.tokenAddress;
    const chain = context.token.chain;
    if (!routeCaptureIsCurrent(routeCapture) || snapshot?.token?.chain !== chain
      || !Tango.Chains.validateAddress(chain, address)
      || Tango.Chains.normalizeAddress(chain, address)
        !== Tango.Chains.normalizeAddress(chain, context.token.address)) return false;
    const quote = normalizeObservationDimensions(snapshot.quote);
    if (!trustedCachedObservation(quote, chain, context.token.address, Number(Tango.QUOTE_STALE_MS || 15_000))
      || !acceptedTokenObservation(quote, snapshot.token)
      || !resolvePaperTradeQuote(snapshot.token, quote, { position: currentPosition(), preferCandidate: true })) return false;
    const changed = ['priceUsd', 'marketCapUsd', 'totalSupply', 'liquidityUsd', 'source']
      .some(field => context.quote?.[field] !== quote[field]);
    runtime.current = Tango.GMGN.resolveCurrentTokenRead(context, snapshot);
    mergeQuote(runtime.current, quote);
    rememberPersistentGmgnQuote(quote);
    if (changed) {
      queueImmediateCurrentCalibration(routeCapture);
      queueRender();
    }
    return true;
  }

  let reviewJournal = null;
  function ensureReviewJournal() {
    if (!reviewJournal && Tango.ReviewJournal && Tango.Store.getReviewNotes) {
      reviewJournal = Tango.ReviewJournal.create({
        store:Tango.Store,document,language:()=>language(),theme:()=>host.getAttribute('data-theme'),
        openToken:note=>openPosition({chain:note.chain,tokenAddress:note.address}),onChange:()=>queueRender()
      });
      reviewJournal.refresh().catch(()=>null);
    }
    return reviewJournal;
  }

  function renderPanel() {
    if (combinedTrench()) return '';
    if (!runtime.state.initialized || !runtime.settings.enabled) return '';
    const chain = activeChain();
    const account = activeAccount();
    const settings = chainSettings();
    if (!chain || !account || !settings) return '';
    const current = runtime.current;
    if (!current?.token || current.token.chain !== chain.id) return '';
    const position = currentPosition();
    const liveQuote = position ? freshExecutableQuote(position) : executableQuote(current.token, current.quote);
    const paperQuote = liveQuote || resolvePaperTradeQuote(current.token, current.quote, { position });
    // A startup/no-chart fallback is an execution estimate, not a new market
    // observation. Keep the position's last mark until factual data arrives.
    const waitingForMarket = Boolean(position && !liveQuote && paperQuote?.syntheticTokenPrice);
    const mark = position ? Tango.Engine.markPosition(position,
      waitingForMarket ? undefined : paperQuote, currentNativePriceUsd()) : null;
    const holdingNativeText = !position
      ? Tango.Format.native(0, chain.nativeSymbol, language())
      : !waitingForMarket && Number(mark?.priceUsd) > 0 && Number(mark?.nativePriceUsd) > 0
        && Number.isFinite(mark?.valueNative) && mark.valueNative >= 0
        ? Tango.Format.native(mark.valueNative, chain.nativeSymbol, language()) : null;
    const displayMarketCap = Number(current.quote?.marketCapUsd) > 0
      ? Number(current.quote.marketCapUsd) : Number(position?.lastMarketCapUsd || 0);
    const displayMarketCapText = displayMarketCap > 0
      ? Tango.Format.usd(displayMarketCap, language(), true) : '--';
    const quoteValid = Boolean(paperQuote);
    const symbol = current?.token?.symbol || 'GMGN';
    const { totalBuy, totalSell, realizedPnl } = tokenTradeTotals(
      chain.id, current.token.address, runtime.state.trades
    );
    const totalProfit = realizedPnl + Number(mark?.unrealizedPnlNative || 0);
    const feePercent = Number(runtime.settings.platformFeeBps || 0) / 100;
    const breakevenRecovered = position && Tango.Engine.breakevenTargetNative?.(position) === 0;
    const breakevenPercent = breakevenRecovered ? null : Tango.Engine.breakevenSellPercent(position, paperQuote, runtime.settings);
    const breakevenLabel = breakevenRecovered ? t('breakevenRecovered')
      : breakevenPercent ? `${t('breakeven')} ${Tango.Format.number(breakevenPercent, language(), 2)}%` : t('breakeven');
    const reviewRecorded = ensureReviewJournal()?.status(current.token);
    const reviewEntry = `<div class="tango-review-entry-row"><button type="button" class="tango-review-entry" data-action="token-review"><span class="tango-review-entry-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8M8 16l1-4L18 3a2.1 2.1 0 0 1 3 3l-9 9-4 1ZM16 5l3 3"/></svg></span><span class="tango-review-entry-label">${language()==='zh-CN'?'代币复盘':'Token review'}</span><span class="tango-review-entry-state">${reviewRecorded?(language()==='zh-CN'?'已记录':'Recorded'):(language()==='zh-CN'?'写复盘':'Write review')}<span aria-hidden="true"> ›</span></span></button></div>`;
    return `<div class="tango-panel tango-card ${runtime.settings.panelCollapsed ? 'collapsed' : ''}" style="${panelStyle()}">
      <div class="tango-header" data-drag-handle>
        <div class="tango-token-strip"><span class="tango-paper-logo">T</span><strong>TANGO</strong><span class="tango-paper-badge">${t('paper')}</span><span>${esc(symbol)}</span></div>
        <div class="tango-header-actions"><button class="tango-icon-button" data-action="reset-panel-size" title="${t('resetSize')}" aria-label="${t('resetSize')}">↺</button><button class="tango-icon-button tango-edit-all" data-action="${runtime.presetEditing === 'all' ? 'save-presets' : 'edit-presets'}" title="${t(runtime.presetEditing === 'all' ? 'savePresets' : 'editPresets')}">${runtime.presetEditing === 'all' ? '✓' : '✎'}</button>${runtime.presetEditing === 'all' ? `<button class="tango-icon-button" data-action="cancel-presets" title="${t('cancel')}">↶</button>` : ''}<button class="tango-icon-button" data-action="toggle-sound" title="${t('sound')}">${runtime.settings.soundEnabled ? '🔊' : '🔇'}</button><button class="tango-icon-button" data-action="dashboard">⚙</button><button class="tango-icon-button" data-action="collapse-panel">${runtime.settings.panelCollapsed ? '＋' : '×'}</button></div>
      </div>
      ${runtime.settings.panelCollapsed ? reviewEntry : ''}
      ${runtime.settings.panelCollapsed ? '' : `<div class="tango-trade-body">
        <section class="tango-trade-block">
          <div class="tango-trade-title buy-title"><span>${t('buy')}</span><div class="tango-buy-account">${reviewEntry}<span class="tango-title-balance">◎ ${Tango.Format.native(account.cashBalanceNative, chain.nativeSymbol, language())}</span></div></div>
          <div class="tango-preset-grid">${renderPresetGrid('buy', settings.buyPresets)}</div>
          <div class="tango-trade-meta"><span>⌁ ${Tango.Format.percent(runtime.settings.slippageBps / 100, language())}</span><span>♜ ${Tango.Format.native(settings.networkFeeNative, chain.nativeSymbol, language())}</span><span>♙ ${feePercent}%</span><span class="safe">${t('entryMc')} ${position ? Tango.Format.usd(position.averageEntryMarketCap, language(), true) : '--'}</span></div>
        </section>
        <section class="tango-trade-block">
          <div class="tango-trade-title sell-title"><span>${t('sell')} %</span><span class="tango-title-balance tango-position-holding"><span class="tango-held-quantity">${position ? `${Tango.Format.compact(position.quantity, language(), 2)} ${esc(symbol)}` : `0 ${esc(symbol)}`}</span><span class="tango-held-native">· ${holdingNativeText === null ? '—' : `≈${esc(holdingNativeText)}`}</span></span></div>
          <div class="tango-preset-grid">${renderPresetGrid('sell', runtime.settings.sellPresets)}</div>
          <div class="tango-trade-meta"><span>⌁ ${runtime.settings.fastMode ? 'FAST' : t('auto')}</span><span>♜ ${Tango.Format.native(settings.networkFeeNative, chain.nativeSymbol, language())}</span><div class="tango-sell-market-actions"><span class="safe">${t('currentMc')} ${displayMarketCapText}</span><button class="tango-breakeven-link" data-action="breakeven" ${breakevenPercent ? '' : 'disabled'} title="${esc(breakevenRecovered ? t('breakevenRecovered') : breakevenPercent ? breakevenLabel : t('breakevenUnavailable'))}">${esc(breakevenLabel)}</button></div></div>
        </section>
        <div class="tango-summary-grid">
          <div class="tango-summary-item tango-paper-balance-summary"><span>${t('paperBalance')}</span><strong>${accountMoney(account.cashBalanceNative)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalBuy')}</span><strong>${accountMoney(totalBuy)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalSell')}</span><strong>${accountMoney(totalSell)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalProfit')}</span><strong class="${pnlClass(totalProfit)}">${accountMoney(totalProfit, true)}</strong></div>
        </div>
        <div class="tango-bottom-details">
          <span>${t('entryMc')} <strong>${position ? Tango.Format.usd(position.averageEntryMarketCap, language(), true) : '--'}</strong></span>
          <span>${t('currentMc')} <strong>${displayMarketCapText}</strong></span>
          <span>${t('pnl')} <strong class="${pnlClass(mark?.unrealizedPnlNative)}">${position ? Tango.Format.percent(mark.roi, language(), true) : '--'}</strong></span>
          <span>${t('pnlAmount')} <strong class="${pnlClass(totalProfit)}">${accountMoney(totalProfit, true)}</strong></span>
        </div>
        <button type="button" class="tango-button" data-action="trade-replay" style="width:100%;margin-top:10px">${language()==='zh-CN'?'查看买卖记录 · 走势图':'View trades · chart'}</button>
        ${waitingForMarket ? `<div class="tango-warning">${t('quoteLoading')}</div>` : paperQuote?.provisional === true
          ? `<div class="tango-warning">${t('provisionalQuote')}</div>`
          : quoteValid ? '' : `<div class="tango-warning">${t('quoteLoading')}</div>`}
      </div>`}
      ${floatingResizeHandles('panel')}
    </div>`;
  }

  function floatingScale(kind) {
    const value = runtime.settings?.[`${kind}Scale`];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(1.5, Math.max(.75, value)) : 1;
  }

  function floatingResizeHandles(kind) {
    return ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map(edge =>
      `<span class="tango-resize-handle tango-resize-${edge}" data-resize-kind="${kind}" data-resize-edge="${edge}" aria-hidden="true"></span>`).join('');
  }

  function floatingLayoutStyle(kind) {
    const scale = floatingScale(kind);
    const position = runtime.settings?.[`${kind}Position`];
    const maxWidth = Math.max(1, innerWidth - 16) / scale;
    const maxHeight = Math.max(1, innerHeight - (kind === 'panel' ? 40 : 16)) / scale;
    const positionStyle = position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? `left:${Math.max(0, position.x) / scale}px;top:${Math.max(0, position.y) / scale}px;right:auto;bottom:auto;transform:none;` : '';
    const minWidth = kind === 'bar' ? `min-width:${Math.min(runtime.settings?.barCollapsed ? 220 : 268, maxWidth)}px;` : '';
    return `${positionStyle}zoom:${scale};max-width:${maxWidth}px;max-height:${maxHeight}px;${minWidth}`;
  }

  function applyFloatingLayout(element, kind) {
    const scale = floatingScale(kind);
    element.style.zoom = String(scale);
    element.style.maxWidth = `${Math.max(1, innerWidth - 16) / scale}px`;
    element.style.maxHeight = `${Math.max(1, innerHeight - (kind === 'panel' ? 40 : 16)) / scale}px`;
    if (kind === 'bar') element.style.minWidth = `${Math.min(runtime.settings?.barCollapsed ? 220 : 268, Math.max(1, innerWidth - 16) / scale)}px`;
  }

  async function resetFloatingScale(kind) {
    if (!['bar', 'panel'].includes(kind)) return;
    await patchRuntimeSettings({ [`${kind}Scale`]: 1 });
  }

  function panelStyle() { return floatingLayoutStyle('panel'); }

  function floatingStyle(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return '';
    return `left:${Math.max(0, position.x)}px;top:${Math.max(0, position.y)}px;right:auto;bottom:auto;transform:none;`;
  }

  function constrainFloatingElements() {
    if (!runtime.settings?.enabled || !runtime.state?.initialized) return;
    const measurements = [];
    for (const [selector, settingKey] of [
      ['.tango-bar', 'barPosition'], ['.tango-panel', 'panelPosition'], ['.tango-drawer', 'drawerPosition']
    ]) {
      const kind = selector === '.tango-bar' ? 'bar' : selector === '.tango-panel' ? 'panel' : null;
      const element = shadow.querySelector(selector);
      const position = runtime.settings[settingKey];
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      if (!element?.getBoundingClientRect) continue;
      const rect = element.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) continue;
      measurements.push({ element, position, rect, scale: kind ? floatingScale(kind) : 1 });
    }
    for (const { element, position, rect, scale } of measurements) {
      const styles = {
        left: `${Math.min(Math.max(0, innerWidth - rect.width), Math.max(0, position.x)) / scale}px`,
        top: `${Math.min(Math.max(0, innerHeight - rect.height), Math.max(0, position.y)) / scale}px`,
        right: 'auto', bottom: 'auto', transform: 'none'
      };
      for (const [key, value] of Object.entries(styles)) {
        if (element.style[key] !== value) element.style[key] = value;
      }
    }
  }
  window.addEventListener('resize', () => { runtime.cancelFloatingResize?.(); queueRender(); constrainFloatingElements(); });
  stylesheet.addEventListener('load', constrainFloatingElements);

  function renderDrawer(summary) {
    if (!runtime.drawerOpen) return '';
    const positions = Tango.ChainView.positions(runtime.state, activeChain().id);
    const usdMode = runtime.settings?.displayCurrency === 'USD';
    return `<div class="tango-drawer tango-card" style="${floatingStyle(runtime.settings.drawerPosition)}">
      <div class="tango-drawer-header" data-drawer-drag><div class="tango-brand"><span class="tango-dot"></span>${t('openPositions')}${esc(accountChainLabel())}</div><div class="tango-drawer-actions"><button class="tango-button tango-close-all" data-action="close-all" ${positions.length ? '' : 'disabled'}>${t('closeAll')}</button><button class="tango-icon-button" data-action="toggle-drawer">✕</button></div></div>
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
    if (!runtime.settings?.enabled || !runtime.state?.initialized
      || !chain || !runtime.current?.token || runtime.current.token.chain !== chain.id) return { markers: [] };
    return Tango.Markers.buildPayload({
      current: runtime.current,
      position: currentPosition(),
      trades: runtime.state.trades,
      labels: { entry: t('paperBuy'), exit: t('paperSell'), hide: t('hideChartLine') }
    });
  }

  function chartFrames() {
    return document.querySelectorAll('iframe[title="Financial Chart"], iframe[title="TradingView"], [data-sentry-component="TradingView"] iframe');
  }

  function chartReadyIdentity(value) {
    const chain = Tango.Chains.get(String(value?.chain || '').trim().toLowerCase());
    const address = String(value?.address || value?.tokenAddress || '').trim();
    if (!chain || !Tango.Chains.validateAddress(chain.id, address)) return null;
    return { chain: chain.id, address: Tango.Chains.normalizeAddress(chain.id, address) };
  }

  const CHART_WIDGET_OPTIONS_MAX_CHARS = 8_192;
  const CHART_SYMBOL_MAX_CHARS = 512;
  const CHART_PROBE_ID_MAX_CHARS = 128;

  function beginChartFrameGeneration(frame) {
    runtime.chartFrameGenerationSequence += 1;
    const generation = runtime.chartFrameGenerationSequence;
    runtime.chartFrameGenerations.set(frame, generation);
    runtime.chartFrameProbeIds.delete(frame);
    runtime.chartFrameReadyProbeIds.delete(frame);
    runtime.markerPayloads.delete(frame);
    return generation;
  }

  function chartLiveChoice(frame, component) {
    const scope = frame?.closest?.('.chart-anchor-scope');
    const controls = Array.from(scope?.querySelectorAll?.(`[data-sentry-component="${component}"]`) || []);
    if (!controls.length) return null;
    if (controls.length !== 1) return '';
    const selected = Array.from(controls[0].children || []).filter((node) =>
      node.classList?.contains('text-text-100'));
    return selected.length === 1 ? String(selected[0].textContent || '').trim() : '';
  }

  function chartAxisHint(frame) {
    try {
      if (!frame || frame.isConnected === false || ![...chartFrames()].includes(frame)) return 'UNKNOWN';
      if (!routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame))) return 'UNKNOWN';
      const routeToken = detailRouteToken();
      if (!routeToken) return 'UNKNOWN';
      const raw = frame.getAttribute?.('data-widget-options');
      if (typeof raw !== 'string' || !raw.length || raw.length > CHART_WIDGET_OPTIONS_MAX_CHARS) {
        return 'UNKNOWN';
      }
      const params = new URLSearchParams(raw);
      const symbols = params.getAll('symbol');
      if (symbols.length !== 1) return 'UNKNOWN';
      const symbol = symbols[0];
      if (!symbol || symbol.length > CHART_SYMBOL_MAX_CHARS || symbol.includes('\uFFFD')) return 'UNKNOWN';
      const parts = symbol.split('/');
      if (parts.length !== 3 && parts.length !== 4) return 'UNKNOWN';
      const identity = chartReadyIdentity({ chain: parts[0], address: parts[1] });
      if (!identity || identity.chain !== routeToken.chain || identity.address !== routeToken.address) {
        return 'UNKNOWN';
      }
      const initialCurrency = String(parts[2]).toUpperCase();
      if (initialCurrency !== 'USD' && (initialCurrency !== activeChain()?.nativeSymbol?.toUpperCase()
        || chartLiveChoice(frame, 'QuoteSelect') === null)) return 'UNKNOWN';
      const liveType = chartLiveChoice(frame, 'PriceType');
      if (liveType !== null) {
        if (/^(price|价格)$/i.test(liveType)) return 'PRICE';
        if (/^(market cap|mcap|市值)$/i.test(liveType)) return 'MARKET_CAP';
        return 'UNKNOWN';
      }
      if (parts.length === 3) return 'PRICE';
      return String(parts[3]).toUpperCase() === 'MCAP' ? 'MARKET_CAP' : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  function chartQuoteConversion(frame) {
    const choice = chartLiveChoice(frame, 'QuoteSelect');
    if (choice === null) {
      const raw = frame?.getAttribute?.('data-widget-options');
      if (typeof raw === 'string' && raw.length <= CHART_WIDGET_OPTIONS_MAX_CHARS) {
        const symbols = new URLSearchParams(raw).getAll('symbol');
        if (symbols.length === 1 && String(symbols[0].split('/')[2]).toUpperCase() !== 'USD') {
          return { quoteUsd: 0, quoteCurrency: 'UNKNOWN' };
        }
      }
      return {};
    }
    if (choice.toUpperCase() === 'USD') return { quoteUsd: 1, quoteCurrency: 'USD' };
    const chain = activeChain();
    const native = choice.toUpperCase() === chain?.nativeSymbol?.toUpperCase();
    return { quoteUsd: native ? freshNativePrice(chain.id) : 0,
      quoteCurrency: native ? chain.nativeSymbol.toUpperCase() : 'UNKNOWN' };
  }

  function chartDeliveryContext(frame) {
    const generation = runtime.chartFrameGenerations.get(frame);
    const probeId = runtime.chartFrameReadyProbeIds.get(frame)
      || runtime.chartFrameProbeIds.get(frame)
      || '';
    return {
      axisHint: chartAxisHint(frame),
      ...chartQuoteConversion(frame),
      frameGeneration: Number.isSafeInteger(generation) && generation > 0 ? generation : 0,
      probeId: typeof probeId === 'string' && probeId.length <= CHART_PROBE_ID_MAX_CHARS
        ? probeId
        : ''
    };
  }

  function probeChartFrameReady(frame) {
    const target = frame?.contentWindow;
    if (!target || !routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame))) return false;
    let frameGeneration = runtime.chartFrameGenerations.get(frame);
    if (!Number.isSafeInteger(frameGeneration) || frameGeneration <= 0) {
      frameGeneration = beginChartFrameGeneration(frame);
    }
    runtime.chartProbeSequence += 1;
    const probeId = `${runtime.routeEpoch}:${runtime.chartProbeSequence}`;
    runtime.chartFrameProbeIds.set(frame, probeId);
    target.postMessage({
      source: 'TANGO_PAPER_PARENT', type: 'CHART_READY_PROBE', probeId, frameGeneration
    }, '*');
    return true;
  }

  function registerChartFrame(frame, routeEligible = true) {
    const firstSeen = !runtime.markerFrameListeners.has(frame);
    if (!firstSeen) {
      if (!routeEligible || routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame))) return false;
      runtime.chartFrameRoutes.set(frame, captureRoute());
      beginChartFrameGeneration(frame);
      runtime.chartFrameTentative.add(frame);
      runtime.chartFrameReadyBeforeLoad.delete(frame);
      runtime.chartFrameAwaitingReady.delete(frame);
      probeChartFrameReady(frame);
      return true;
    }
    runtime.markerFrameListeners.add(frame);
    if (routeEligible) {
      runtime.chartFrameRoutes.set(frame, captureRoute());
      beginChartFrameGeneration(frame);
    }
    const transitionPending = location.href !== runtime.lastUrl
      || currentRouteIdentity() !== runtime.routeIdentity;
    if (!routeEligible || transitionPending || runtime.routeEpoch > 0) {
      runtime.chartFrameTentative.add(frame);
    }
    frame.addEventListener?.('load', () => {
      let routeCurrent = routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame));
      if (!routeCurrent && [...chartFrames()].includes(frame)) {
        runtime.chartFrameRoutes.set(frame, captureRoute());
        runtime.chartFrameTentative.add(frame);
        routeCurrent = routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame));
      }
      const readyBeforeLoad = runtime.chartFrameReadyBeforeLoad.delete(frame);
      if (!routeCurrent || !readyBeforeLoad) {
        Tango.GMGN._invalidateChartFrame?.(frame);
        runtime.chartFrameTentative.add(frame);
        runtime.chartFrameAwaitingReady.delete(frame);
        if (routeCurrent) runtime.chartFrameAwaitingReady.add(frame);
        beginChartFrameGeneration(frame);
      } else {
        runtime.chartFrameAwaitingReady.delete(frame);
      }
      runtime.markerPayloads.delete(frame);
      probeChartFrameReady(frame);
      deliverChartMarkers([frame], runtime.latestMarkerPayload, true);
    });
    probeChartFrameReady(frame);
    return true;
  }

  function chartMarkerDeliveryAllowed(frame, payload) {
    const unscopedClear = Array.isArray(payload?.markers) && payload.markers.length === 0
      && !payload?.chain && !payload?.tokenAddress;
    if (unscopedClear) return true;
    if (!routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame))) return false;
    const routeToken = detailRouteToken();
    if (!routeToken || payload?.chain !== routeToken.chain
      || !Tango.Chains.validateAddress(routeToken.chain, payload?.tokenAddress)) return false;
    return Tango.Chains.normalizeAddress(routeToken.chain, payload.tokenAddress) === routeToken.address;
  }

  function deliverChartMarkers(frames, payload, force = false) {
    frames.forEach((frame) => {
      const registrationChanged = registerChartFrame(frame);
      const tentative = runtime.chartFrameTentative.has(frame);
      const deliveredPayload = tentative ? { markers: [] }
        : chartMarkerDeliveryAllowed(frame, payload) ? payload : null;
      if (!deliveredPayload) return;
      const context = chartDeliveryContext(frame);
      const signature = JSON.stringify({ context, payload: deliveredPayload });
      if ((!force || tentative) && !registrationChanged
        && runtime.markerPayloads.get(frame) === signature) return;
      runtime.markerPayloads.set(frame, signature);
      frame.contentWindow?.postMessage({
        source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', context, payload: deliveredPayload
      }, '*');
    });
  }

  function publishChartMarkers(force = false) {
    runtime.latestMarkerPayload = chartMarkerPayload();
    deliverChartMarkers(chartFrames(), runtime.latestMarkerPayload, force);
  }

  function replayChartMarkers(frame = null) {
    const frames = frame ? [frame] : chartFrames();
    if (frame) runtime.markerPayloads.delete(frame);
    deliverChartMarkers(frames, runtime.latestMarkerPayload);
  }

  function clearChartMarkers() {
    runtime.latestMarkerPayload = { markers: [] };
    runtime.markerPayloads = new WeakMap();
    deliverChartMarkers(chartFrames(), runtime.latestMarkerPayload, true);
  }

  function syncChartMarkers(force = false) {
    const frames = chartFrames();
    runtime.latestMarkerPayload = chartMarkerPayload();
    if (!frames.length) return;
    deliverChartMarkers(frames, runtime.latestMarkerPayload, force);
  }

  async function openDashboard(route = {}) {
    try {
      const response = await sendContentMessage({ type: 'TANGO_OPEN_DASHBOARD', ...route });
      if (response?.ok) return;
      throw new Error(response?.error || t('openDashboardFailed'));
    } catch (error) {
      runtime.modal = { type: 'dashboard-error', title: t('openDashboardFailed'),
        rows: [], note: String(error?.message || t('openDashboardFailed')).slice(0, 300) };
      render();
    }
  }

  function showRecoveryError(message) {
    if (runtime.modal?.type === 'dashboard-error') {
      runtime.modal = { ...runtime.modal, note: message };
    }
    showToast(message, 'error');
  }

  async function exportPageBackup() {
    try {
      const data = await Tango.Store.exportData();
      if(runtime.modal?.type==='dashboard-error'){
        runtime.modal.backupJson=JSON.stringify(data,null,2);
        runtime.renderedRecoveryDialog=null;
        render();
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tango-backup-${new Date().toISOString().slice(0, 10)}.json`;
      // A detached download link keeps the backup Blob URL out of the page DOM.
      try { anchor.click(); } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { showRecoveryError(t(error.message || 'storageFailed')); }
  }

  async function previewBackupImport(input) {
    const dialog = runtime.modal;
    const file = input.files?.[0];
    if (!file || dialog?.type !== 'dashboard-error') return;
    try {
      const payload = JSON.parse(await file.text());
      if (runtime.modal !== dialog) return;
      if (payload?.product !== 'Tango Paper Trader' || !payload.state?.accounts
        || !payload.settings || !Array.isArray(payload.state.trades)
        || !payload.state.positions || typeof payload.state.positions !== 'object') throw new Error('importFailed');
      runtime.modal = { type: 'confirm', title: t('importJson'),
        rows: [[t('importJson'), file.name], [t('positions'), Object.keys(payload.state.positions).length]],
        note: language().toLowerCase().startsWith('zh')
          ? '确认后将替换全部六条链的模拟账户、设置和历史记录；备份含复盘笔记时也会替换笔记，旧备份不含笔记则保留。请先导出备份；取消不会更改数据。'
          : 'Confirmation replaces paper accounts, settings and history on all six chains, plus review notes if included. Legacy backups without notes preserve existing notes. Export a backup first; cancel changes nothing.',
        action: async () => {
          if (runtime.tradePending) return;
          runtime.tradePending = true;
          try {
            const data = await Tango.Store.importData(payload);
            runtime.state = data.state;
            runtime.settings = data.settings;
            runtime.modal = null;
            await refresh();
            showToast(t('dataImported'), 'success');
          } catch (error) { runtime.modal = null; showToast(t(error.message || 'importFailed'), 'error'); }
          finally { runtime.tradePending = false; }
        }
      };
      render();
    } catch {
      if (runtime.modal === dialog) showRecoveryError(t('importFailed'));
    }
    finally { input.value = ''; }
  }

  function openDailyReport(date) {
    const chain=activeChain();
    if(!chain) return;
    try { runtime.modal={type:'daily-report',report:Tango.DailyReport.summarize(runtime.state,chain.id,date),currency:'NATIVE'}; render(); }
    catch { showToast(t('imageExportFailed'),'error'); }
  }
  async function reportAction(action) {
    const modal=runtime.modal;
    if(modal?.type!=='daily-report' || modal.busy) return;
    if(action==='close'){runtime.modal=null;render();return;}
    if(action==='native'||action==='usd'){modal.currency=action==='usd'?'USD':'NATIVE';render();return;}
    if(action==='history'){runtime.modal=null;render();await openDashboard({tab:'history',chain:modal.report.chain,date:modal.report.date});return;}
    if(action!=='download'&&action!=='copy')return;
    modal.busy=true;render();
    try {const result=await Tango.DailyReport.exportImage(modal.report,modal.currency,language(),action);showToast(t(result==='copied'?'copyImage':result==='fallback'?'imageCopyFallback':'downloadPng'),'success');}
    catch {showToast(t('imageExportFailed'),'error');}
    finally {modal.busy=false;render();}
  }

  function renderModal() {
    if (!runtime.modal) return '';
    if(runtime.modal.type==='daily-report') return Tango.DailyReport.dialog(runtime.modal.report,runtime.modal.currency,language(),runtime.modal.busy);
    if (runtime.modal.type === 'dashboard-error') {
      return `<div class="tango-modal-backdrop"><div class="tango-modal tango-card"><h3>${esc(runtime.modal.title)}</h3><div class="tango-warning">${esc(runtime.modal.note)}</div>${runtime.modal.backupJson?`<p>${language().toLowerCase().startsWith('zh')?'若浏览器未下载，可全选下方 JSON 文本，复制并保存为 .json 文件。':'If the browser did not download, select all JSON below, copy and save as a .json file.'}</p><div id="tango-backup-json-fallback" data-readonly="true"></div>`:''}<div class="tango-modal-actions"><button class="tango-button" data-action="cancel-modal">${t('cancel')}</button><button class="tango-button primary" data-action="export-backup">${t('exportJson')}</button><label>${t('importJson')}<input id="tango-import-backup" type="file" accept=".json,application/json" style="display:block;max-width:100%"></label></div></div></div>`;
    }
    return `<div class="tango-modal-backdrop"><div class="tango-modal tango-card"><h3>${esc(runtime.modal.title)}</h3>
      <div class="tango-confirm-list">${runtime.modal.rows.map(([label,value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      ${runtime.modal.note ? `<div class="tango-warning">${esc(runtime.modal.note)}</div>` : ''}
      ${runtime.modal.allowSessionSuppress ? `<label class="tango-session-confirm"><input id="tango-skip-session-confirm" type="checkbox"><span>${t('skipConfirmSession')}</span></label>` : ''}
      <div class="tango-modal-actions"><button class="tango-button" data-action="cancel-modal">${t('cancel')}</button><button class="tango-button primary" data-action="confirm-modal">${t('confirm')}</button></div>
    </div></div>`;
  }

  function patchShellText(markup, prepared = null) {
    const template = prepared || document.createElement('template');
    if (!template.content || !shell.childNodes) return false;
    if (!prepared) template.innerHTML = markup;
    const changes = [];
    const structuralClasses = value => String(value || '').split(/\s+/)
      .filter(name => name && !['tango-up', 'tango-down', 'tango-flat'].includes(name)).join(' ');
    const equalShape = (before, after) => {
      if (before.length !== after.length) return false;
      for (let index = 0; index < before.length; index += 1) {
        const left = before[index]; const right = after[index];
        if (left.nodeType !== right.nodeType) return false;
        if (left.nodeType === 3) {
          if (left.nodeValue !== right.nodeValue) changes.push(() => { left.nodeValue = right.nodeValue; });
        } else if (left.nodeType === 1) {
          if (left.nodeName !== right.nodeName || left.attributes.length !== right.attributes.length) return false;
          for (const attr of right.attributes) {
            const old = left.getAttribute(attr.name);
            if (old === attr.value) continue;
            if (attr.name !== 'class' || structuralClasses(old) !== structuralClasses(attr.value)) return false;
            changes.push(() => left.setAttribute('class', attr.value));
          }
          if (!equalShape(left.childNodes, right.childNodes)) return false;
        } else if (left.nodeValue !== right.nodeValue) return false;
      }
      return true;
    };
    if (!equalShape(shell.childNodes, template.content.childNodes)) return false;
    changes.forEach(change => change());
    return true;
  }

  function render() {
    reviewJournal?.setEnabled(Boolean(runtime.settings?.enabled && runtime.state?.initialized));
    if (runtime.cancelFloatingResize && (!runtime.settings?.enabled || runtime.extensionInvalidated || !activeChain())) runtime.cancelFloatingResize();
    if (runtime.floatingGesture) return;
    capturePresetDraft();
    const chain = activeChain();
    const chartRecoveryActive = String(Boolean(chain && !combinedTrench() && runtime.settings?.enabled && runtime.state?.initialized));
    if (host.getAttribute('data-tango-active') !== chartRecoveryActive) host.setAttribute('data-tango-active', chartRecoveryActive);
    if (!chain && !combinedTrench()) {
      clearChainContext();
      return;
    }
    if (!runtime.state || !runtime.settings) return;
    applyContentTheme();
    if (!runtime.settings.enabled || !runtime.state.initialized) {
      if (runtime.latestMarkerPayload?.chain || runtime.latestMarkerPayload?.markers?.length) clearChartMarkers();
      clearQuickBuyButtons();
      clearShellMarkup();
      clearHeaderAccountSummary();
      return;
    }
    syncTrenchPositionBadges();
    const summary = chain ? Tango.Engine.portfolioSummary(runtime.state, chain.id, currentNativePriceUsd(), freshExecutableQuote) : null;
    if (chain) renderHeaderAccountSummary(summary); else clearHeaderAccountSummary();
    // Preserve the native file input while its dialog is open. Replacing it
    // during a quote tick detaches an in-progress browser file chooser.
    if (runtime.modal?.type === 'dashboard-error'
      && runtime.renderedRecoveryDialog === runtime.modal
      && shadow.querySelector('#tango-import-backup')) {
      constrainFloatingElements();
      syncChartMarkers();
      return;
    }
    const markup = `${chain ? renderBar(summary) + renderPanel() + renderDrawer(summary) + renderPnlCalendar() : ''}${renderModal()}${runtime.toast ? `<div class="tango-toast ${esc(runtime.toast.type)}">${esc(runtime.toast.message)}</div>` : ''}`;
    if (runtime.renderedMarkup !== markup) {
      const template = document.createElement('template');
      if (template.content) template.innerHTML = markup;
      const patched = template.content && (!runtime.modal || runtime.modal.type === 'daily-report') && !runtime.presetEditing
        && patchShellText(markup, template);
      if (!patched) {
        if (template.content && shell.replaceChildren) shell.replaceChildren(template.content);
        else shell.innerHTML = markup;
        runtime.renderedRecoveryDialog = runtime.modal?.type === 'dashboard-error' ? runtime.modal : null;
        bindEvents();
      }
      runtime.renderedMarkup = markup;
    }
    constrainFloatingElements();
    syncChartMarkers();
  }

  function bindEvents() {
    if(runtime.modal?.backupJson) Tango.ReviewJournal?.privateBackup(shadow.querySelector('#tango-backup-json-fallback'),runtime.modal.backupJson);
    shell.querySelectorAll('[data-report-action]').forEach(button=>button.addEventListener('click',async event=>{if(!requireTrustedUserEvent(event))return;event.stopPropagation();await reportAction(button.dataset.reportAction);}));
    shell.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', (event) => {
      if (!requireTrustedUserEvent(event)) return;
      return buy(Number(button.dataset.buy));
    }));
    shell.querySelectorAll('[data-sell]').forEach((button) => button.addEventListener('click', (event) => {
      if (!requireTrustedUserEvent(event)) return;
      return sell(Number(button.dataset.sell));
    }));
    shell.querySelectorAll('[data-position-open]').forEach((button) => button.addEventListener('click', (event) => {
      if (!requireTrustedUserEvent(event)) return;
      const position = runtime.state.positions[button.dataset.key];
      if (position) return openPosition(position);
      host.setAttribute('data-tango-token-open-status', 'missing-position');
      showToast(t('noPosition'), 'error');
    }));
    shell.querySelectorAll('[data-position-sell]').forEach((button) => button.addEventListener('click', (event) => {
      if (!requireTrustedUserEvent(event)) return;
      const position = runtime.state.positions[button.dataset.key];
      if (position) return sellPosition(position, Number(button.dataset.positionSell));
    }));
    shell.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', async (event) => {
      if (!requireTrustedUserEvent(event)) return;
      event.stopPropagation();
      const action = element.dataset.action;
      if (action === 'toggle-drawer') { runtime.drawerOpen = !runtime.drawerOpen; render(); }
      if (action === 'collapse-bar') {
        const barCollapsed = !runtime.settings.barCollapsed;
        await patchRuntimeSettings({ barCollapsed });
      }
      if (action === 'reset-bar-size') await resetFloatingScale('bar');
      if (action === 'reset-panel-size') await resetFloatingScale('panel');
      if (action === 'collapse-panel') {
        const panelCollapsed = !runtime.settings.panelCollapsed;
        await patchRuntimeSettings({ panelCollapsed });
      }
      if (action === 'dashboard') await openDashboard();
      if (action === 'dashboard-calendar') await openDashboard({ tab: 'calendar', chain: activeChain()?.id });
      if (action === 'dashboard-history') await openDashboard({ tab: 'history', chain: activeChain()?.id });
      if (action === 'export-backup') await exportPageBackup();
      if (action === 'toggle-sound') {
        const soundEnabled = !runtime.settings.soundEnabled;
        await patchRuntimeSettings({ soundEnabled });
      }
      if (action === 'token-review' && runtime.current?.token) await ensureReviewJournal()?.openEditor({ ...runtime.current.token });
      if (action === 'daily-review') await ensureReviewJournal()?.openDaily();
      if (action === 'trade-replay' && runtime.current?.token) {
        const token=runtime.current.token;
        await Tango.TradeReplay?.open(shadow,runtime.state,token.chain,token.address,language());
      }
      if (action === 'breakeven') await sellBreakeven();
      if (action === 'close-all') requestCloseAll();
      if (action === 'daily-report') openDailyReport(element.dataset.date);
      if (action === 'close-calendar') { runtime.calendarOpen = false; render(); }
      if (action === 'calendar-prev') { runtime.calendarMonth = new Date(runtime.calendarMonth.getFullYear(), runtime.calendarMonth.getMonth() - 1, 1); render(); }
      if (action === 'calendar-next') { runtime.calendarMonth = new Date(runtime.calendarMonth.getFullYear(), runtime.calendarMonth.getMonth() + 1, 1); render(); }
      if (action === 'edit-presets') { runtime.presetDraft = null; runtime.presetEditing = 'all'; render(); }
      if (action === 'save-presets') await savePresetEdits();
      if (action === 'cancel-presets') { runtime.presetEditing = null; runtime.presetDraft = null; render(); }
      if (action === 'cancel-modal') { runtime.modal = null; render(); }
      if (action === 'confirm-modal') {
        if (paperExecutionDisabled()) return;
        primeTradeAudio();
        const sessionSuppressInput = shadow.querySelector('#tango-skip-session-confirm');
        const suppressForSession = Boolean(
          runtime.modal?.allowSessionSuppress
          && sessionSuppressInput?.checked
          && trustedSessionSuppressInputs.has(sessionSuppressInput)
        );
        const callback = runtime.modal?.action;
        if (callback) await callback();
        if (suppressForSession) {
          runtime.suppressConfirmForSession = true;
          await sendContentMessage({ type: 'TANGO_SET_SESSION_CONFIRM', suppressed: true }).catch(() => null);
        }
      }
    }));
    const backupInput = shadow.querySelector('#tango-import-backup');
    backupInput?.addEventListener('change', async (event) => {
      if (!requireTrustedUserEvent(event)) return;
      await previewBackupImport(backupInput);
    });
    const sessionSuppressInput = shadow.querySelector('#tango-skip-session-confirm');
    sessionSuppressInput?.addEventListener('change', (event) => {
      if (!requireTrustedUserEvent(event)) {
        sessionSuppressInput.checked = false;
        trustedSessionSuppressInputs.delete(sessionSuppressInput);
        return;
      }
      if (sessionSuppressInput.checked) trustedSessionSuppressInputs.add(sessionSuppressInput);
      else trustedSessionSuppressInputs.delete(sessionSuppressInput);
    });
    shell.querySelectorAll('.tango-preset-editor').forEach((input) => input.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape' && requireTrustedUserEvent(event)) {
        runtime.presetEditing = null;
        runtime.presetDraft = null;
        render();
        return;
      }
      if (event.key !== 'Enter' || !requireTrustedUserEvent(event)) return;
      await savePresetEdits();
    }));
    bindDrag();
  }

  function bindDrag() {
    bindDraggable('[data-drag-handle]', '.tango-panel', 'panelPosition');
    bindDraggable('[data-drawer-drag]', '.tango-drawer', 'drawerPosition');
    bindDraggable('.tango-bar', '.tango-bar', 'barPosition');
    bindResizable('bar');
    bindResizable('panel');
  }

  function bindDraggable(handleSelector, elementSelector, settingKey) {
    const handle = shadow.querySelector(handleSelector);
    const element = shadow.querySelector(elementSelector);
    if (!handle || !element) return;
    handle.addEventListener('pointerdown', (event) => {
      if (!requireTrustedUserEvent(event) || runtime.floatingGesture || event.target.closest('button, [data-resize-edge]')) return;
      const rect = element.getBoundingClientRect();
      const startX = event.clientX; const startY = event.clientY;
      const fallbackSettings = { ...runtime.settings, [settingKey]: runtime.settings[settingKey] };
      let dragged = false;
      const onMove = (move) => {
        if (move?.isTrusted !== true) return;
        if (!dragged && Math.hypot(move.clientX - startX, move.clientY - startY) < 5) return;
        dragged = true;
        move.preventDefault();
        const position = {
          x: Math.min(Math.max(0, innerWidth - rect.width), Math.max(0, rect.left + move.clientX - startX)),
          y: Math.min(Math.max(0, innerHeight - rect.height), Math.max(0, rect.top + move.clientY - startY))
        };
        runtime.settings = { ...runtime.settings, [settingKey]: position };
        const scale = settingKey === 'panelPosition' ? floatingScale('panel') : settingKey === 'barPosition' ? floatingScale('bar') : 1;
        element.style.left = `${position.x / scale}px`;
        element.style.top = `${position.y / scale}px`;
        element.style.right = 'auto'; element.style.bottom = 'auto'; element.style.transform = 'none';
      };
      const onUp = async (up) => {
        if (up?.isTrusted !== true) return;
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

  function bindResizable(kind) {
    const element = shadow.querySelector(`.tango-${kind}`);
    if (!element) return;
    shadow.querySelectorAll(`[data-resize-kind="${kind}"]`).forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        if (!requireTrustedUserEvent(event) || runtime.floatingGesture || runtime.extensionInvalidated
          || !runtime.settings?.enabled || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
        const edge = handle.dataset.resizeEdge;
        if (!['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].includes(edge)) return;
        const rect = element.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return;
        event.preventDefault(); event.stopPropagation();
        const scaleKey = `${kind}Scale`, positionKey = `${kind}Position`;
        const original = { [scaleKey]: runtime.settings[scaleKey] ?? 1, [positionKey]: runtime.settings[positionKey] ?? null };
        const startScale = floatingScale(kind), startX = event.clientX, startY = event.clientY;
        const baseWidth = rect.width / startScale, baseHeight = rect.height / startScale;
        let moved = false;
        runtime.floatingGesture = true;
        const samePointer = e => e?.isTrusted === true && (event.pointerId == null || e.pointerId === event.pointerId);
        const suppressResizeClick = click => { click.preventDefault(); click.stopImmediatePropagation(); };
        const cleanup = (keepClickGuard = false) => {
          if (!keepClickGuard) global.removeEventListener('click', suppressResizeClick, true);
          global.removeEventListener('pointermove', onMove); global.removeEventListener('pointerup', onUp);
          global.removeEventListener('pointercancel', onCancel); global.removeEventListener('blur', onCancel);
          runtime.floatingGesture = false; runtime.cancelFloatingResize = null;
        };
        const cancel = () => {
          cleanup();
          runtime.settings = { ...runtime.settings, ...original };
          applyFloatingLayout(element, kind);
          queueRender();
        };
        const onCancel = e => { if (e?.type === 'blur' || samePointer(e)) cancel(); };
        const onMove = move => {
          if (!samePointer(move)) return;
          const dx = move.clientX - startX, dy = move.clientY - startY;
          if (!moved && Math.hypot(dx, dy) < 3) return;
          move.preventDefault(); moved = true;
          const horizontal = /[ew]/.test(edge), vertical = /[ns]/.test(edge);
          const wDelta = horizontal ? (edge.includes('w') ? -dx : dx) : 0;
          const hDelta = vertical ? (edge.includes('n') ? -dy : dy) : 0;
          const ratio = 1 + (wDelta * rect.width + hDelta * rect.height)
            / ((horizontal ? rect.width ** 2 : 0) + (vertical ? rect.height ** 2 : 0));
          const maxWidth = edge.includes('w') ? rect.right : innerWidth - rect.left;
          const maxHeight = edge.includes('n') ? rect.bottom : innerHeight - rect.top;
          const limit = Math.max(.75, Math.min(1.5, maxWidth / baseWidth, maxHeight / baseHeight));
          const scale = Math.round(Math.min(limit, Math.max(.75, startScale * ratio)) * 1000) / 1000;
          const width = baseWidth * scale, height = baseHeight * scale;
          const position = {
            x: Math.max(0, Math.min(Math.max(0, innerWidth - width), edge.includes('w') ? rect.right - width : rect.left)),
            y: Math.max(0, Math.min(Math.max(0, innerHeight - height), edge.includes('n') ? rect.bottom - height : rect.top))
          };
          runtime.settings = { ...runtime.settings, [scaleKey]: scale, [positionKey]: position };
          applyFloatingLayout(element, kind);
          element.style.left = `${position.x / scale}px`; element.style.top = `${position.y / scale}px`;
          element.style.right = 'auto'; element.style.bottom = 'auto'; element.style.transform = 'none';
        };
        const onUp = async up => {
          if (!samePointer(up)) return;
          cleanup(true);
          // Keep the release click inside the UI gesture even if a quote/settings
          // update replaces this node before the browser dispatches that click.
          setTimeout(() => global.removeEventListener('click', suppressResizeClick, true), 0);
          if (moved) {
            await patchRuntimeSettings({ [scaleKey]: runtime.settings[scaleKey], [positionKey]: runtime.settings[positionKey] }, { ...runtime.settings, ...original });
          }
          queueRender();
        };
        runtime.cancelFloatingResize = cancel;
        global.addEventListener('click', suppressResizeClick, true);
        global.addEventListener('pointermove', onMove); global.addEventListener('pointerup', onUp);
        global.addEventListener('pointercancel', onCancel); global.addEventListener('blur', onCancel);
      });
    });
  }

  function handleRouteChange() {
    if (location.href === runtime.lastUrl && currentRouteIdentity() === runtime.routeIdentity) return;
    runtime.cancelFloatingResize?.();
    const lastSingle = Tango.Chains.fromUrl(location.href) || Tango.Chains.fromUrl(runtime.lastUrl);
    if (lastSingle) runtime.lastSingleChainId = lastSingle.id;
    const previousRouteIdentity = runtime.routeIdentity ?? currentRouteIdentity(runtime.lastUrl);
    runtime.lastUrl = location.href;
    advanceRouteEpoch();
    runtime.pendingMutationRoots.clear();
    const nextChainId = activeChain()?.id || null;
    const currentNoLongerMatches = runtime.current
      && Tango.GMGN.resolveCurrentTokenRead(runtime.current, null) !== runtime.current;
    if (nextChainId !== runtime.activeChainId || runtime.routeIdentity !== previousRouteIdentity
      || currentNoLongerMatches) {
      clearChainContext();
    } else runtime.modal = null;
    runtime.activeChainId = nextChainId;
    if (!nextChainId && !combinedTrench()) {
      clearChainContext();
      return;
    }
    ensureRouteTokenContext();
    publishChartMarkers(true);
    queueRender();
    window.postMessage({ source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' }, '*');
    syncQuickBuyButtons();
    tickQuote();
  }

  async function start() {
    loadAfterBuyDetailPreference();
    runtime.routeIdentity = currentRouteIdentity();
    chartFrames().forEach((frame) => registerChartFrame(frame));
    let mutationTimer;
    let detailQuoteMutation = false;
    let detailMetadataMutation = false;
    const heldQuoteRoots = new Set();
    runtime.observer = new MutationObserver((records) => {
      if (location.href !== runtime.lastUrl || currentRouteIdentity() !== runtime.routeIdentity) {
        handleRouteChange();
      }
      const fastRoots = [];
      const addedRoots = [];
      const removedRoots = [];
      const hrefMutations = [];
      let chartMutation = false;
      let headerMutation = false;
      const detailPage = Boolean(detailRouteToken());
      const detailPending = Tango.GMGN.needsCurrentTokenRead(runtime.current);
      for (const record of records) {
        const target = record.target?.nodeType === 3 ? record.target.parentElement : record.target;
        const preferenceRow = target?.closest?.('[data-sentry-component="SelectButton"]');
        if (preferenceRow) synchronizeAfterBuyDetailPreference(preferenceRow);
        if (record.type === 'childList') {
          for (const node of record.addedNodes || []) {
            if (node?.nodeType !== 1 || node.closest?.('[class~="group/a"]') || paperQuickBuyMutationNode(node)) continue;
            if (node.matches?.('[data-sentry-component="SelectButton"]')
              || node.querySelector?.('[data-sentry-component="SelectButton"]')) synchronizeAfterBuyDetailPreference(node);
          }
        }
        const heldCard = target?.closest?.('[data-icon="MC"]')?.closest?.('[data-tango-position-card="1"]');
        if (heldCard && (record.type === 'characterData' || record.type === 'childList')) heldQuoteRoots.add(heldCard);
        if (detailPage && detailHeaderMutationNode(target)) {
          detailQuoteMutation = true;
          if (detailPending) headerMutation = true;
        }
        if (record.type === 'attributes') {
          if (record.attributeName !== 'href' && typeof record.oldValue === 'string'
            && target?.getAttribute?.(record.attributeName) === record.oldValue) continue;
          if (detailPage && detailHeaderMutationNode(target)
            && ['data-addr', 'data-address', 'data-token-address', 'data-symbol'].includes(record.attributeName)) {
            detailMetadataMutation = true;
          }
          const roots = quickBuyMutationRoots(target);
          if (roots.length) {
            roots.forEach((root) => runtime.pendingMutationRoots.add(root));
            if (record.attributeName === 'href') {
              fastRoots.push(...roots);
              hrefMutations.push({ target, oldValue: record.oldValue });
            }
          }
        }
        if (record.type === 'characterData') {
          quickBuyMutationRoots(target).forEach((root) => runtime.pendingMutationRoots.add(root));
        }
        if (record.type === 'childList') {
          const paperReplacement = [...(record.addedNodes || [])].some(containsPaperQuickBuyMutationNode);
          for (const node of record.addedNodes || []) {
            if (detailPage && detailHeaderMutationNode(node, true)) {
              detailQuoteMutation = true;
              detailMetadataMutation = true;
            }
            if (chartMutationNode(node)) chartMutation = true;
            if (headerMutationNode(node)
              || (detailPending && detailHeaderMutationNode(node, true))) headerMutation = true;
            const structuralRoots = quickBuyMutationRoots(node, {
              includeAncestors: false, includeDescendants: true
            });
            const roots = [...new Set([...structuralRoots, ...nativeQuickBuyMutationRoots(node, target)])];
            if (!roots.length) continue;
            fastRoots.push(...roots);
            roots.forEach((root) => runtime.pendingMutationRoots.add(root));
            if (structuralRoots.length) addedRoots.push(node);
          }
          for (const node of record.removedNodes || []) {
            if (chartMutationNode(node)) chartMutation = true;
            if (headerMutationNode(node)
              || (detailPending && detailHeaderMutationNode(node, true))) headerMutation = true;
            const structuralRoots = quickBuyMutationRoots(node, {
              includeAncestors: false, includeDescendants: true
            });
            const nativeRoots = paperReplacement ? [] : nativeQuickBuyMutationRoots(node, target);
            const roots = [...new Set([...structuralRoots, ...nativeRoots])];
            if (!roots.length) continue;
            fastRoots.push(...roots);
            roots.forEach((root) => runtime.pendingMutationRoots.add(root));
            if (structuralRoots.length) removedRoots.push(node);
          }
        }
      }
      if (chartMutation) chartFrames().forEach((frame) => registerChartFrame(frame));
      if (fastRoots.length && runtime.settings?.enabled
        && runtime.state?.initialized && runtime.settings?.showListQuickBuy
        && !runtime.quickBuySettingsPending && !runtime.quickBuyAuthoritativelyDisabled) {
        syncQuickBuyButtons([...new Set(fastRoots)], {
          fast: true, addedRoots: [...new Set(addedRoots)], removedRoots: [...new Set(removedRoots)],
          hrefMutations, policyKey: quickBuyPolicyKey()
        });
      }
      if (mutationTimer || (!runtime.pendingMutationRoots.size && !chartMutation && !headerMutation && !detailQuoteMutation && !heldQuoteRoots.size)) return;
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        const heldRoots = [...heldQuoteRoots];
        heldQuoteRoots.clear();
        if (heldRoots.length) syncTrenchPositionBadges(heldRoots);
        const roots = [...runtime.pendingMutationRoots];
        runtime.pendingMutationRoots.clear();
        if (roots.length) syncQuickBuyButtons(roots, {
          fast: false, addedRoots: [], removedRoots: [], policyKey: quickBuyPolicyKey()
        });
        if (runtime.settings?.enabled && runtime.state?.initialized) {
          if (detailQuoteMutation) {
            detailQuoteMutation = false;
            refreshDetailDisplayQuote();
          }
          renderHeaderAccountSummary({});
          const rereadDetail = detailMetadataMutation;
          detailMetadataMutation = false;
          if (rereadDetail || Tango.GMGN.needsCurrentTokenRead(runtime.current)) tickQuote();
        }
        if (document.querySelector('iframe[title="Financial Chart"], iframe[title="TradingView"], [data-sentry-component="TradingView"] iframe')) replayChartMarkers();
      }, 160);
    });
    runtime.observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['href', 'class', 'style', 'data-testid', 'data-addr', 'data-address', 'data-token-address', 'data-symbol'], attributeOldValue: true,
      characterData: true
    });
    Tango.Store.subscribe(refreshRecoverably);
    const session = await sendContentMessage({ type: 'TANGO_GET_SESSION_CONFIRM' }).catch(() => null);
    runtime.suppressConfirmForSession = Boolean(session?.suppressed);
    runtime.activeChainId = Tango.Chains.fromUrl(location.href)?.id || null;
    runtime.lastSingleChainId = runtime.activeChainId;
    await refreshRecoverably();
    ensureRouteTokenContext();
    const handleQuickBuyAmountChange = (event) => {
      if (event.target?.closest?.('[data-sentry-component="BuyAmountInput"]')) {
        const root = event.target.closest('[data-sentry-component="TrenchColumn"], [class~="group/a"]') || event.target;
        queueQuickBuySync(root);
      }
    };
    document.addEventListener('input', handleQuickBuyAmountChange, true);
    document.addEventListener('change', handleQuickBuyAmountChange, true);
    await tickQuote();
    if (!runtime.extensionInvalidated) runtime.quoteTimer = setInterval(tickQuote, 3000);
    runtime.markerTimer = setInterval(() => { if (!document.hidden) { refreshDailyPnl(); syncChartMarkers(); } }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshDailyPnl(); syncChartMarkers(); } });
    runtime.routeTimer = setInterval(handleRouteChange, 150);
    runtime.quickBuyProbeTimer = setInterval(probeQuickBuyHealth, 750);
  }

  start().catch((error) => console.error('[Tango Paper Trader]', error));
})(globalThis);
