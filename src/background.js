if (typeof importScripts === 'function') {
  importScripts(
    'core/chains.js',
    'core/supply.js',
    'shared/constants.js',
    'core/state.js',
    'core/engine.js',
    'core/review-notes.js',
    'core/state-coordinator.js',
    'shared/trade-replay.js'
  );
}
const Chains = globalThis.Tango?.Chains || (typeof require === 'function' ? require('./core/chains.js') : null);
const stateCoordinator = globalThis.Tango?.StateCoordinator?.create({
  readRaw: (keys) => chrome.storage.local.get(keys),
  writeRaw: (values) => chrome.storage.local.set(values)
});

globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'local' && (changes[globalThis.Tango.STORAGE_KEY] || changes[globalThis.Tango.SETTINGS_KEY])) {
    stateCoordinator?.invalidateReads();
  }
});

const nativePriceCache = new Map();
const nativePriceRequests = new Map();
const tokenQuoteCache = new Map();
const tokenQuoteRequests = new Map();
let nextTokenQuoteSweepAt = 0;
const NATIVE_PRICE_CACHE_MS = Number(globalThis.Tango?.QUOTE_STALE_MS || 15_000);
const TOKEN_QUOTE_CACHE_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 6_000;
const positiveFinite = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const nonnegativeFiniteOrZero = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
let onboardingOpened = false;
let commandTail = Promise.resolve();
let shortcutNotifications = [];

function toggleFromShortcut(source) {
  const now = Date.now();
  // A browser may deliver both its extension command and the page keydown.
  // Pair opposite-source notifications without suppressing repeated presses
  // from the same source (including browsers that deliver only one source).
  shortcutNotifications = shortcutNotifications.filter(entry => now - entry.at >= 0 && now - entry.at <= 250);
  const duplicate = shortcutNotifications.findIndex(entry => entry.source !== source);
  if (duplicate >= 0) {
    shortcutNotifications.splice(duplicate, 1);
    return commandTail;
  }
  shortcutNotifications.push({ source, at: now });
  shortcutNotifications = shortcutNotifications.slice(-32);
  const toggle = commandTail.then(async () => {
    const snapshot = await stateCoordinator.getAll();
    await stateCoordinator.mutate({ type: 'PATCH_SETTINGS', patch: { enabled: !snapshot.settings.enabled } });
  });
  commandTail = toggle.catch(error => console.error('[Tango Paper Trader] shortcut toggle failed', error));
  return toggle;
}

function coordinatorFailureResponse(error) {
  const response = {
    ok: false,
    error: error?.message || 'storageFailed'
  };
  if (['storageFull', 'importTooLarge'].includes(error?.code)
    && error?.message === error.code
    && Number.isSafeInteger(error?.measuredBytes)
    && error.measuredBytes >= 0
    && Number.isSafeInteger(error?.budgetBytes)
    && error.budgetBytes > 0
    && (error.code !== 'importTooLarge' || error.measuredBytes > error.budgetBytes)) {
    response.errorDetails = {
      code: error.code,
      measuredBytes: error.measuredBytes,
      budgetBytes: error.budgetBytes
    };
  }
  return response;
}

chrome.runtime.onInstalled.addListener(async ({ reason } = {}) => {
  if (reason !== 'install' || onboardingOpened) return;
  onboardingOpened = true;
  await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html?onboarding=1') });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-paper-trading-master') return Promise.resolve();
  return toggleFromShortcut('command');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TANGO_REPLAY_RECORD' || message?.type === 'TANGO_REPLAY_READ') {
    let origin=''; try {origin=new URL(sender?.url || sender?.tab?.url).origin;} catch {}
    const ownExtension=sender?.id===chrome.runtime.id && String(sender?.url||'').startsWith(chrome.runtime.getURL(''));
    if (origin!=='https://gmgn.ai' && !ownExtension) {sendResponse({ok:false});return false;}
    if (!globalThis.Tango?.TradeReplay) {sendResponse({ok:false});return false;}
    const request=message.type==='TANGO_REPLAY_READ'
      ? chrome.storage.local.get(Tango.TradeReplay.KEY).then(value=>({ok:true,cache:value[Tango.TradeReplay.KEY]||{}}))
      : Tango.TradeReplay.write(message.batch);
    request.then(sendResponse).catch(()=>sendResponse({ok:false}));
    return true;
  }

  if (message?.type === 'TANGO_TOGGLE_SHORTCUT') {
    let origin;
    try { origin = new URL(sender?.url || sender?.tab?.url).origin; } catch {}
    if (origin !== 'https://gmgn.ai' || !sender?.tab) {
      sendResponse({ ok: false, error: 'Invalid shortcut sender' });
      return false;
    }
    toggleFromShortcut('page')
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse(coordinatorFailureResponse(error)));
    return true;
  }
  if (message?.type === 'TANGO_STORE_GET_ALL') {
    stateCoordinator.getAll()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse(coordinatorFailureResponse(error)));
    return true;
  }
  if (message?.type === 'TANGO_STORE_MUTATE') {
    stateCoordinator.mutate(message.command)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse(coordinatorFailureResponse(error)));
    return true;
  }
  if (message?.type === 'TANGO_OPEN_DASHBOARD') {
    const allowedTabs = new Set(['overview', 'positions', 'history', 'calendar', 'settings']);
    const requestedTab = message.tab == null ? '' : String(message.tab);
    const requestedChain = message.chain == null ? '' : String(message.chain);
    const requestedDate = message.date == null ? '' : String(message.date);
    const parsedDate = new Date(requestedDate + 'T12:00:00Z');
    if(requestedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==requestedDate)){sendResponse({ok:false,error:'Invalid Dashboard route'});return false;}
    if ((requestedTab && !allowedTabs.has(requestedTab)) || (requestedChain && !Chains.get(requestedChain))) {
      sendResponse({ ok: false, error: 'Invalid Dashboard route' });
      return false;
    }
    const baseUrl = chrome.runtime.getURL('dashboard.html');
    const params = [requestedChain ? `chain=${encodeURIComponent(requestedChain)}` : '', requestedDate ? `date=${encodeURIComponent(requestedDate)}` : ''].filter(Boolean).join('&');
    const dashboardUrl = `${baseUrl}${params ? '?' + params : ''}${requestedTab ? `#${encodeURIComponent(requestedTab)}` : ''}`;
    // Use the same tab route for every entry point; embedded browsers may not
    // provide an options-page surface even when openOptionsPage resolves.
    Promise.resolve().then(() => chrome.tabs.create({ url: dashboardUrl }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_OPEN_GMGN') {
    chrome.tabs.create({ url: globalThis.Tango.GMGN_ENTRY_URL })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_OPEN_TOKEN') {
    let url;
    try { url = new URL(String(message.url || '')); } catch { url = null; }
    const chain = url ? Chains.fromUrl(url.href) : null;
    const parts = url?.pathname.split('/').filter(Boolean) || [];
    const validTokenUrl = url?.origin === 'https://gmgn.ai' && chain
      && parts.length === 3 && parts[0] === chain.gmgnSlug && parts[1].toLowerCase() === 'token'
      && Chains.validateAddress(chain.id, parts[2]);
    if (!validTokenUrl) {
      sendResponse({ ok: false, error: 'Invalid GMGN token URL' });
      return false;
    }
    const sourceWindowId = Number.isInteger(sender?.tab?.windowId) && sender.tab.windowId >= 0
      ? sender.tab.windowId : null;
    const createProperties = { url: url.href, active: true };
    if (sourceWindowId !== null) createProperties.windowId = sourceWindowId;
    Promise.resolve().then(() => chrome.tabs.create(createProperties))
      .then((tab) => {
        const opening = {
          sourceWindowKnown: sourceWindowId !== null,
          returnedWindowKnown: Number.isInteger(tab?.windowId),
          returnedTab: Boolean(tab && typeof tab === 'object'),
          hasTabId: Number.isInteger(tab?.id) && tab.id >= 0,
          sameWindow: sourceWindowId !== null && Number.isInteger(tab?.windowId)
            ? tab.windowId === sourceWindowId : null,
          active: typeof tab?.active === 'boolean' ? tab.active : null
        };
        if (!opening.hasTabId) {
          sendResponse({ ok: false, error: 'Browser did not return a created token tab', opening });
        } else if (opening.sameWindow === false) {
          sendResponse({ ok: false, error: 'Browser created the token tab in a different window', opening });
        } else {
          sendResponse({ ok: true, opening });
        }
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Browser could not create the token tab' }));
    return true;
  }
  if (message?.type === 'TANGO_GET_NATIVE_PRICE') {
    getNativePriceObservation(message.chain).then((observation) => sendResponse({ ok: true, ...observation }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_GET_SOL_PRICE') {
    getNativePriceObservation('sol').then((observation) => sendResponse({ ok: true, ...observation }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_GET_TOKEN_QUOTE') {
    getTokenQuote(message.chain, message.address)
      .then((quote) => sendResponse({ ok: true, quote }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_GET_SESSION_CONFIRM') {
    chrome.storage.session.get('tangoSkipTradeConfirmation')
      .then((session) => sendResponse({ ok: true, suppressed: Boolean(session.tangoSkipTradeConfirmation) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_SET_SESSION_CONFIRM') {
    chrome.storage.session.set({ tangoSkipTradeConfirmation: Boolean(message.suppressed) })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

async function getNativePrice(chainId) {
  return (await getNativePriceObservation(chainId)).price;
}

async function getNativePriceObservation(chainId) {
  const chain = Chains.get(chainId); if (!chain) throw new Error('unsupportedChain');
  const key = chain.nativePriceKey; const cached = nativePriceCache.get(key);
  if (positiveFinite(cached?.price) && Date.now() - cached.fetchedAt <= NATIVE_PRICE_CACHE_MS) {
    return { price: cached.price, observedAt: cached.fetchedAt };
  }
  if (nativePriceRequests.has(key)) return nativePriceRequests.get(key);
  const request = fetchNativePriceObservation(chain, key).finally(() => nativePriceRequests.delete(key));
  nativePriceRequests.set(key, request); return request;
}

async function fetchNativePriceObservation(chain, key) {
  let price = 0;
  let observedAt = 0;
  try {
    const body = await fetchProviderJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(chain.coingeckoId)}&vs_currencies=usd`);
    price = Number(body?.[key]?.usd || 0);
    if (positiveFinite(price)) observedAt = Date.now();
  } catch {}
  if (!positiveFinite(price) && chain.wrappedNativeAddress && chain.dexScreenerChain) {
    const wrappedNative = await getTokenQuote(chain.id, chain.wrappedNativeAddress);
    price = Number(wrappedNative?.priceUsd || 0);
    observedAt = Number(wrappedNative?.observedAt || 0);
  }
  if (!positiveFinite(price)) throw new Error(`${chain.nativeSymbol} price is unavailable`);
  if (!(observedAt > 0)) observedAt = Date.now();
  nativePriceCache.set(key, { price, fetchedAt: observedAt });
  return { price, observedAt };
}

async function fetchProviderJson(url) {
  const controller = new AbortController();
  let timer;
  try {
    // Bound both the connection and response body; some providers stall after headers.
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          headers: { accept: 'application/json' }, signal: controller.signal
        });
        if (!response.ok) throw new Error(`Price request failed: ${response.status}`);
        return response.json();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Price request timed out'));
          controller.abort();
        }, PROVIDER_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function quoteKey(chain, address) {
  return `${chain.id}:${Chains.normalizeAddress(chain.id, address)}`;
}

async function getTokenQuote(chainId, address) {
  const chain = Chains.get(chainId);
  if (!chain || !chain.dexScreenerChain || !Chains.validateAddress(chain.id, address)) return null;
  const normalizedAddress = Chains.normalizeAddress(chain.id, address);
  const key = quoteKey(chain, normalizedAddress);
  const now = Date.now();
  if (now >= nextTokenQuoteSweepAt || now < nextTokenQuoteSweepAt - 1_000) {
    tokenQuoteCache.forEach((entry, cachedKey) => {
      if (now - entry.fetchedAt >= TOKEN_QUOTE_CACHE_MS) tokenQuoteCache.delete(cachedKey);
    });
    nextTokenQuoteSweepAt = now + 1_000;
  }
  const cached = tokenQuoteCache.get(key);
  if (cached && now - cached.fetchedAt < TOKEN_QUOTE_CACHE_MS) return cached.quote;
  if (cached) tokenQuoteCache.delete(key);
  if (tokenQuoteRequests.has(key)) return tokenQuoteRequests.get(key);
  const request = fetchTokenQuote(chain, normalizedAddress, key).finally(() => tokenQuoteRequests.delete(key));
  tokenQuoteRequests.set(key, request);
  return request;
}

async function fetchTokenQuote(chain, address, key) {
  const pairs = await fetchProviderJson(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain.dexScreenerChain)}/${encodeURIComponent(address)}`);
  let pair = null; let deepestLiquidity = -1;
  for (const candidate of Array.isArray(pairs) ? pairs : []) {
    if (!Chains.validateAddress(chain.id, candidate?.baseToken?.address)
      || Chains.normalizeAddress(chain.id, candidate.baseToken.address) !== address
      || !positiveFinite(candidate?.priceUsd)) continue;
    const liquidity = nonnegativeFiniteOrZero(candidate?.liquidity?.usd);
    if (liquidity > deepestLiquidity) { pair = candidate; deepestLiquidity = liquidity; }
  }
  const quote = pair ? {
    priceUsd: Number(pair.priceUsd),
    marketCapUsd: nonnegativeFiniteOrZero(pair.marketCap ?? pair.fdv),
    liquidityUsd: nonnegativeFiniteOrZero(pair?.liquidity?.usd),
    source: 'DEXSCREENER',
    observedAt: Date.now()
  } : null;
  tokenQuoteCache.set(key, { quote, fetchedAt: Date.now() });
  return quote;
}

function getSolPrice() {
  return getNativePrice('sol');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getNativePrice, getSolPrice, getTokenQuote, _tokenQuoteCache: tokenQuoteCache };
}
