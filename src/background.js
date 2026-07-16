let solPriceCache = { price: 0, fetchedAt: 0 };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'TANGO_GET_SOL_PRICE') return false;
  getSolPrice().then((price) => sendResponse({ ok: true, price }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
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
