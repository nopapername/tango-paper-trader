if (typeof importScripts === 'function') {
  importScripts(
    'core/chains.js',
    'core/supply.js',
    'shared/constants.js',
    'core/state.js',
    'core/engine.js',
    'core/state-coordinator.js'
  );
}
const Chains = globalThis.Tango?.Chains || (typeof require === 'function' ? require('./core/chains.js') : null);
const stateCoordinator = globalThis.Tango?.StateCoordinator?.create({
  readRaw: (keys) => chrome.storage.local.get(keys),
  writeRaw: (values) => chrome.storage.local.set(values)
});

const nativePriceCache = new Map();
const nativePriceRequests = new Map();
const tokenQuoteCache = new Map();
const tokenQuoteRequests = new Map();
const NATIVE_PRICE_CACHE_MS = Number(globalThis.Tango?.QUOTE_STALE_MS || 15_000);
const TOKEN_QUOTE_CACHE_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 6_000;
const positiveFinite = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const nonnegativeFiniteOrZero = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
let onboardingOpened = false;
let commandTail = Promise.resolve();

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
  if (command !== 'toggle-paper-trading') return Promise.resolve();
  const toggle = commandTail.then(async () => {
    const snapshot = await stateCoordinator.getAll();
    await stateCoordinator.mutate({
      type: 'PATCH_SETTINGS',
      patch: { enabled: !snapshot.settings.enabled }
    });
  });
  commandTail = toggle.catch((error) => {
    console.error('[Tango Paper Trader] shortcut toggle failed', error);
  });
  return toggle;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    if ((requestedTab && !allowedTabs.has(requestedTab)) || (requestedChain && !Chains.get(requestedChain))) {
      sendResponse({ ok: false, error: 'Invalid Dashboard route' });
      return false;
    }
    const hasDeepLink = Boolean(requestedTab || requestedChain);
    const baseUrl = chrome.runtime.getURL('dashboard.html');
    const dashboardUrl = `${baseUrl}${requestedChain ? `?chain=${encodeURIComponent(requestedChain)}` : ''}${requestedTab ? `#${encodeURIComponent(requestedTab)}` : ''}`;
    const openDashboard = hasDeepLink ? chrome.tabs.create({ url: dashboardUrl }) : chrome.runtime.openOptionsPage();
    openDashboard
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
    chrome.tabs.create({ url: url.href })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
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
  tokenQuoteCache.forEach((entry, cachedKey) => {
    if (now - entry.fetchedAt >= TOKEN_QUOTE_CACHE_MS) tokenQuoteCache.delete(cachedKey);
  });
  const cached = tokenQuoteCache.get(key);
  if (cached) return cached.quote;
  if (tokenQuoteRequests.has(key)) return tokenQuoteRequests.get(key);
  const request = fetchTokenQuote(chain, normalizedAddress, key).finally(() => tokenQuoteRequests.delete(key));
  tokenQuoteRequests.set(key, request);
  return request;
}

async function fetchTokenQuote(chain, address, key) {
  const pairs = await fetchProviderJson(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain.dexScreenerChain)}/${encodeURIComponent(address)}`);
  const matching = Array.isArray(pairs) ? pairs.filter((pair) =>
    Chains.validateAddress(chain.id, pair?.baseToken?.address)
      && Chains.normalizeAddress(chain.id, pair.baseToken.address) === address
      && positiveFinite(pair?.priceUsd)
  ) : [];
  matching.sort((a, b) => nonnegativeFiniteOrZero(b?.liquidity?.usd) - nonnegativeFiniteOrZero(a?.liquidity?.usd));
  const pair = matching[0];
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
