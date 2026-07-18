if (typeof importScripts === 'function') importScripts('src/core/chains.js');
const Chains = globalThis.Tango?.Chains || (typeof require === 'function' ? require('./core/chains.js') : null);

const nativePriceCache = new Map();
const nativePriceRequests = new Map();
const tokenQuoteCache = new Map();
const tokenQuoteRequests = new Map();
const NATIVE_PRICE_CACHE_MS = 30_000;
const TOKEN_QUOTE_CACHE_MS = 15_000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TANGO_OPEN_DASHBOARD') {
    const openDashboard = message.tab
      ? chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#${encodeURIComponent(message.tab)}`) })
      : chrome.runtime.openOptionsPage();
    openDashboard
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_OPEN_TOKEN') {
    let url;
    try { url = new URL(String(message.url || '')); } catch { url = null; }
    if (!url || url.origin !== 'https://gmgn.ai' || !/^\/sol\/token\//i.test(url.pathname)) {
      sendResponse({ ok: false, error: 'Invalid GMGN token URL' });
      return false;
    }
    chrome.tabs.create({ url: url.href })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_GET_NATIVE_PRICE') {
    getNativePrice(message.chain).then((price) => sendResponse({ ok: true, price }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_GET_SOL_PRICE') {
    getNativePrice('sol').then((price) => sendResponse({ ok: true, price }))
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
  const chain = Chains.get(chainId); if (!chain) throw new Error('unsupportedChain');
  const key = chain.nativePriceKey; const cached = nativePriceCache.get(key);
  if (cached?.price > 0 && Date.now() - cached.fetchedAt < NATIVE_PRICE_CACHE_MS) return cached.price;
  if (nativePriceRequests.has(key)) return nativePriceRequests.get(key);
  const request = fetchNativePrice(chain, key).finally(() => nativePriceRequests.delete(key));
  nativePriceRequests.set(key, request); return request;
}

async function fetchNativePrice(chain, key) {
  let price = 0;
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(chain.coingeckoId)}&vs_currencies=usd`, {
      headers: { accept: 'application/json' }
    });
    if (response.ok) {
      const body = await response.json();
      price = Number(body?.[key]?.usd || 0);
    }
  } catch {}
  if (!(price > 0) && chain.wrappedNativeAddress && chain.dexScreenerChain) {
    const wrappedNative = await getTokenQuote(chain.id, chain.wrappedNativeAddress);
    price = Number(wrappedNative?.priceUsd || 0);
  }
  if (!(price > 0)) throw new Error(`${chain.nativeSymbol} price is unavailable`);
  nativePriceCache.set(key, { price, fetchedAt: Date.now() });
  return price;
}

function quoteKey(chain, address) {
  return `${chain.id}:${Chains.normalizeAddress(chain.id, address)}`;
}

async function getTokenQuote(chainId, address) {
  const chain = Chains.get(chainId);
  if (!chain || !address || !chain.dexScreenerChain) return null;
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
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain.dexScreenerChain)}/${encodeURIComponent(address)}`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Token quote request failed: ${response.status}`);
  const pairs = await response.json();
  const matching = Array.isArray(pairs) ? pairs.filter((pair) =>
    Chains.normalizeAddress(chain.id, pair?.baseToken?.address) === address && Number(pair?.priceUsd || 0) > 0
  ) : [];
  matching.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  const pair = matching[0];
  const quote = pair ? {
    priceUsd: Number(pair.priceUsd || 0),
    marketCapUsd: Number(pair.marketCap || pair.fdv || 0),
    liquidityUsd: Number(pair?.liquidity?.usd || 0),
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
