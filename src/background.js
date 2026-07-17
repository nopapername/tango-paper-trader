let solPriceCache = { price: 0, fetchedAt: 0 };
let solPriceRequest = null;
const tokenQuoteCache = new Map();
const tokenQuoteRequests = new Map();
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
  if (message?.type === 'TANGO_GET_SOL_PRICE') {
    getSolPrice().then((price) => sendResponse({ ok: true, price }))
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

async function getSolPrice() {
  if (solPriceCache.price > 0 && Date.now() - solPriceCache.fetchedAt < 30_000) return solPriceCache.price;
  if (solPriceRequest) return solPriceRequest;
  solPriceRequest = fetchSolPrice().finally(() => { solPriceRequest = null; });
  return solPriceRequest;
}

async function fetchSolPrice() {
  let price = 0;
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      headers: { accept: 'application/json' }
    });
    if (response.ok) {
      const body = await response.json();
      price = Number(body?.solana?.usd || 0);
    }
  } catch {}
  if (!(price > 0)) {
    const wrappedSol = await getTokenQuote('sol', 'So11111111111111111111111111111111111111112');
    price = Number(wrappedSol?.priceUsd || 0);
  }
  if (!(price > 0)) throw new Error('SOL price is unavailable');
  solPriceCache = { price, fetchedAt: Date.now() };
  return price;
}

async function getTokenQuote(chain, address) {
  if (String(chain || '').toLowerCase() !== 'sol' || !address) return null;
  const key = String(address).toLowerCase();
  const now = Date.now();
  tokenQuoteCache.forEach((entry, cachedKey) => {
    if (now - entry.fetchedAt >= TOKEN_QUOTE_CACHE_MS) tokenQuoteCache.delete(cachedKey);
  });
  const cached = tokenQuoteCache.get(key);
  if (cached) return cached.quote;
  if (tokenQuoteRequests.has(key)) return tokenQuoteRequests.get(key);
  const request = fetchTokenQuote(address, key).finally(() => tokenQuoteRequests.delete(key));
  tokenQuoteRequests.set(key, request);
  return request;
}

async function fetchTokenQuote(address, key) {
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(address)}`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Token quote request failed: ${response.status}`);
  const pairs = await response.json();
  const matching = Array.isArray(pairs) ? pairs.filter((pair) =>
    String(pair?.baseToken?.address || '').toLowerCase() === key && Number(pair?.priceUsd || 0) > 0
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getSolPrice, getTokenQuote, _tokenQuoteCache: tokenQuoteCache };
}
