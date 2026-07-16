let solPriceCache = { price: 0, fetchedAt: 0 };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TANGO_OPEN_DASHBOARD') {
    chrome.runtime.openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'TANGO_GET_SOL_PRICE') {
    getSolPrice().then((price) => sendResponse({ ok: true, price }))
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
  if (solPriceCache.price > 0 && Date.now() - solPriceCache.fetchedAt < 30_000) {
    return solPriceCache.price;
  }
  const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`SOL price request failed: ${response.status}`);
  const body = await response.json();
  const price = Number(body?.solana?.usd);
  if (!(price > 0)) throw new Error('SOL price is unavailable');
  solPriceCache = { price, fetchedAt: Date.now() };
  return price;
}
