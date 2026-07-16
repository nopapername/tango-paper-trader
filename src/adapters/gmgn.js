(function initGmgnAdapter(global) {
  const Tango = global.Tango = global.Tango || {};

  const SUBSCRIPT_DIGITS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

  function chainFromUrl(url = location.href) {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/(sol|bsc|base|eth)(?:\/|$)/i);
    const chain = (match?.[1] || parsed.searchParams.get('chain') || '').toLowerCase();
    return chain === 'sol' ? 'sol' : chain || null;
  }

  function tokenAddressFromUrl(url = location.href) {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname === 'pump.fun' && parts[0]?.toLowerCase() === 'coin' && parts[1]) {
      return decodeURIComponent(parts[1]).split('?')[0];
    }
    const tokenIndex = parts.findIndex((part) => part.toLowerCase() === 'token');
    if (tokenIndex >= 0 && parts[tokenIndex + 1]) return decodeURIComponent(parts[tokenIndex + 1]).split('?')[0];
    for (const key of ['address', 'token', 'ca']) {
      const value = parsed.searchParams.get(key);
      if (value) return value;
    }
    return null;
  }

  function parseSubscriptPrice(text) {
    const match = String(text || '').match(/0\.0([\u2080-\u2089])(\d+)/);
    if (!match) return null;
    const zeroCount = Number(SUBSCRIPT_DIGITS[match[1]] || 0);
    return Number(`0.${'0'.repeat(zeroCount)}${match[2]}`);
  }

  function parseMoney(text) {
    if (text == null) return 0;
    const subscript = parseSubscriptPrice(text);
    if (subscript) return subscript;
    const cleaned = String(text).replaceAll(',', '').replace(/[^0-9eE.+\-KMBTkmbt]/g, '');
    const match = cleaned.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (!match) return 0;
    let value = Number(match[0]);
    if (!Number.isFinite(value)) return 0;
    const suffix = cleaned.trim().slice(-1).toUpperCase();
    if (suffix === 'K') value *= 1e3;
    if (suffix === 'M') value *= 1e6;
    if (suffix === 'B') value *= 1e9;
    if (suffix === 'T') value *= 1e12;
    return Number(value.toPrecision(15));
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) return { text, element };
    }
    return null;
  }

  function scanLabeledValue(labels) {
    const normalized = labels.map((label) => label.toLowerCase());
    const nodes = document.querySelectorAll('span,div,p');
    const limit = Math.min(nodes.length, 2500);
    for (let index = 0; index < limit; index += 1) {
      const element = nodes[index];
      const ownText = element.childElementCount === 0 ? element.textContent?.trim() : '';
      if (!ownText || ownText.length > 28) continue;
      const lower = ownText.toLowerCase();
      if (!normalized.some((label) => lower === label || lower.startsWith(`${label}:`))) continue;
      const candidates = [element.nextElementSibling, ...Array.from(element.parentElement?.children || [])];
      for (const candidate of candidates) {
        if (!candidate || candidate === element) continue;
        const value = parseMoney(candidate.textContent);
        if (value > 0) return value;
      }
      const inline = parseMoney(ownText.replace(/^[^:$]*:?/, ''));
      if (inline > 0) return inline;
    }
    return 0;
  }

  function findPrice() {
    const baseInfo = document.querySelector('[data-sentry-component="BaseInfoPriceView"]');
    if (baseInfo) {
      const priceItem = Array.from(baseInfo.querySelectorAll('[data-sentry-component="InfoItem"]')).find((item) =>
        /^(价格|price)$/i.test(item.querySelector('.info-item-title')?.textContent?.trim() || '')
      );
      const value = parseMoney(priceItem?.querySelector('.info-item-value')?.textContent);
      if (value > 0) return value;
    }
    const direct = firstText([
      '[data-testid="token-price"]', '[data-testid*="price"]', '[data-token-price]',
      '[class*="token-price"]', '[class*="TokenPrice"]', '[class*="price_usd"]'
    ]);
    const directValue = parseMoney(direct?.text);
    if (directValue > 0) return directValue;

    const description = document.querySelector('meta[property="og:description"]')?.content || '';
    const descriptionPrice = description.match(/(?:price|价格)\s*[:：]?\s*\$?([0-9.,eE+\-]+)/i);
    if (descriptionPrice) return parseMoney(descriptionPrice[1]);

    const candidates = Array.from(document.querySelectorAll('span,div'))
      .filter((element) => element.childElementCount === 0)
      .map((element) => element.textContent?.trim() || '')
      .filter((text) => /^\$?0(?:\.\d+|\.0[\u2080-\u2089]\d+)$/.test(text) || /^\$\d+\.\d{3,}$/.test(text))
      .slice(0, 100)
      .map(parseMoney)
      .filter((value) => value > 0);
    return candidates.length ? candidates[0] : 0;
  }

  function tokenSymbol() {
    const direct = firstText([
      '[data-testid="token-symbol"]', '[data-token-symbol]', '[class*="token-symbol"]',
      '[class*="TokenSymbol"]', '[class*="text-xl"][class*="font-semibold"]', 'h1'
    ]);
    if (direct?.text) {
      const symbol = direct.text.replace(/^\$/, '').split(/[\s/|]/)[0];
      if (symbol && symbol.length <= 20) return symbol;
    }
    const title = document.title.split(/[|·\-]/)[0].trim();
    return title.split(/\s+/)[0].replace(/^\$/, '').slice(0, 20) || 'TOKEN';
  }

  function tokenName(symbol) {
    const heading = document.querySelector('h1')?.textContent?.trim();
    return heading && heading.length < 80 ? heading : symbol;
  }

  function tokenLogo() {
    const image = document.querySelector('[data-testid*="token"] img, [class*="token"] img, h1 img');
    return image?.src || document.querySelector('meta[property="og:image"]')?.content || '';
  }

  async function readCurrentToken() {
    if (!isTokenDetailPage()) return null;
    const address = tokenAddressFromUrl();
    const chain = chainFromUrl();
    if (!address || chain !== 'sol') return null;
    const symbol = tokenSymbol();
    const priceUsd = findPrice();
    const baseInfo = document.querySelector('[data-sentry-component="BaseInfoPriceView"]');
    const baseItems = baseInfo ? Array.from(baseInfo.querySelectorAll('[data-sentry-component="InfoItem"]')) : [];
    const unlabeledMarketCap = parseMoney(baseItems.find((item) => !item.querySelector('.info-item-title'))?.querySelector('.info-item-value')?.textContent);
    const labeledLiquidity = baseItems.find((item) => /^(池子|pool|liquidity)$/i.test(item.querySelector('.info-item-title')?.textContent?.trim() || ''));
    const marketCapUsd = unlabeledMarketCap || scanLabeledValue(['mc', 'market cap', 'mcap', '市值']) || (/pump$/i.test(address) ? priceUsd * 1_000_000_000 : 0);
    const liquidityUsd = parseMoney(labeledLiquidity?.querySelector('.info-item-value')?.textContent) || scanLabeledValue(['liq', 'liquidity', '流动性', '池子', 'pool']);
    return {
      token: { chain, address, symbol, name: tokenName(symbol), logoUrl: tokenLogo() },
      quote: {
        priceUsd,
        marketCapUsd,
        liquidityUsd,
        solPriceUsd: 0,
        source: 'GMGN',
        observedAt: priceUsd > 0 ? Date.now() : 0
      }
    };
  }

  function isTrenchPage(url = location.href) {
    const parsed = new URL(url);
    return parsed.hostname === 'gmgn.ai' && (parsed.pathname === '/' || parsed.pathname === '') && chainFromUrl(url) === 'sol';
  }

  function isTokenDetailPage(url = location.href) {
    const parsed = new URL(url);
    return parsed.hostname === 'gmgn.ai' && /^\/sol\/token\/[^/]+\/?$/i.test(parsed.pathname);
  }

  function trenchColumn(card) {
    const headings = ['新创建', '即将打满', '已开盘', 'new creation', 'about to graduate', 'launched'];
    let candidate = card?.parentElement;
    for (let depth = 0; depth < 8 && candidate; depth += 1, candidate = candidate.parentElement) {
      const text = (candidate.textContent || '').trim().toLowerCase();
      const hasHeading = headings.some((heading) => text.startsWith(heading) || text.includes(`${heading}\n`));
      if (hasHeading && candidate.querySelectorAll('[class~="group/a"]').length > 0) return candidate;
    }
    return null;
  }

  function cardSymbol(text) {
    const reserved = new Set(['MC', 'V', 'F', 'N', 'TX', 'DS', 'SOL', 'USD', 'P1', 'P2', 'P3']);
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.find((line) => /^[A-Za-z][A-Za-z0-9_$]{1,14}$/.test(line) && !reserved.has(line.toUpperCase())) || 'TOKEN';
  }

  function cardMarketCap(text) {
    const match = String(text || '').match(/\bMC\s*:?\s*\$?\s*([0-9.,]+\s*[KMBT]?)/i);
    return match ? parseMoney(match[1]) : 0;
  }

  function ensureQuickBuyStyle() {
    if (document.querySelector('#tango-trench-buy-style')) return;
    const style = document.createElement('style');
    style.id = 'tango-trench-buy-style';
    style.textContent = `
      .BuyButton-continer.tango-native-buy-overridden { position: relative !important; }
      .tango-list-quick-buy {
        align-items: flex-end; appearance: none; background: color-mix(in srgb, var(--customize-button-ultra-color, #00ffee) 10%, transparent);
        border: 0; border-radius: 6px; bottom: 0; box-sizing: border-box; color: var(--customize-button-ultra-color, #00ffee);
        cursor: pointer; display: flex; font: 600 12px/12px Inter, ui-sans-serif, system-ui, sans-serif; gap: 4px; inset: 0;
        justify-content: flex-end; padding: 0 10px 32px 8px; position: absolute; white-space: nowrap; width: 100%; z-index: 50;
      }
      .tango-list-quick-buy:hover { background: color-mix(in srgb, var(--customize-button-ultra-color, #00ffee) 20%, transparent); filter: brightness(1.12); }
      .tango-list-quick-buy:active { opacity: .55; }
      .tango-list-quick-buy svg { flex: 0 0 12px; height: 12px; width: 12px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function discoverTokenCards(onQuickBuy, defaultAmountSol = 0.1) {
    if (!isTrenchPage()) {
      clearQuickBuy();
      return 0;
    }
    ensureQuickBuyStyle();
    const nativeSlots = document.querySelectorAll('.BuyButton-continer');
    let injected = 0;
    for (const slot of nativeSlots) {
      if (injected >= 80) break;
      const card = slot.closest('[class~="group/a"]');
      if (!card || !trenchColumn(card)) continue;
      const tokenLinkSelector = 'a[href*="pump.fun/coin/"], a[href*="/sol/token/"]';
      const anchor = card.querySelector(tokenLinkSelector);
      const cardHref = card.getAttribute('href');
      const href = cardHref?.includes('/sol/token/') ? new URL(cardHref, location.origin).href : anchor?.href;
      if (!href) continue;
      const address = tokenAddressFromUrl(href);
      const nativeControl = slot.querySelector('[data-testid="quickbuy"]');
      const amountSol = parseMoney(nativeControl?.textContent || slot.textContent) || Number(defaultAmountSol);
      if (!address || !nativeControl || !(amountSol > 0)) continue;
      if (slot.dataset.tangoQuickBuy === '1' && slot.querySelector('.tango-list-quick-buy') &&
        slot.dataset.tangoTokenAddress === address && Number(slot.dataset.tangoAmountSol) === amountSol) continue;
      if (slot.dataset.tangoQuickBuy === '1') restoreQuickBuySlot(slot);
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.className = 'tango-list-quick-buy';
      replacement.dataset.tangoQuickBuy = '1';
      replacement.title = `Tango Paper Buy ${amountSol} SOL`;
      replacement.setAttribute('aria-label', `Tango Paper Buy ${amountSol} SOL`);
      replacement.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m13.688 8.12-6.471 7.705c-.206.245-.604.061-.55-.255l1.007-5.843-4.617-.061c-.88-.012-1.352-1.038-.79-1.714L8.723.191c.205-.247.605-.063.55.253L8.247 6.399l4.641.003c.888.001 1.371 1.038.8 1.718Z"/></svg><span>' + amountSol + ' SOL</span>';
      const blockNativePointer = (event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      };
      const handleClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const text = card.textContent || '';
        const symbol = cardSymbol(text);
        const prices = text.match(/\$[0-9.,eE+\-]+/g) || [];
        const marketCapUsd = cardMarketCap(text);
        const isPumpToken = /pump$/i.test(address);
        const visiblePrice = prices.map(parseMoney).find((value) => value > 0 && value < 1) || 0;
        const priceUsd = visiblePrice || (marketCapUsd > 0 ? marketCapUsd / 1_000_000_000 : 0);
        const logoUrl = card.querySelector('img[alt="logo"]')?.src || '';
        onQuickBuy({
          token: { chain: chainFromUrl(href) || 'sol', address, symbol, name: symbol, logoUrl },
          quote: {
            priceUsd, marketCapUsd, liquidityUsd: 0, solPriceUsd: 0,
            source: isPumpToken ? 'GMGN_TRENCH_MC' : 'GMGN_LIST_MC',
            valuationMode: visiblePrice > 0 ? 'PRICE' : 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
            observedAt: priceUsd > 0 || marketCapUsd > 0 ? Date.now() : 0
          },
          amountSol,
          sourceUrl: href
        });
      };
      slot.classList.add('tango-native-buy-overridden');
      slot.dataset.tangoQuickBuy = '1';
      slot.dataset.tangoTokenAddress = address;
      slot.dataset.tangoAmountSol = String(amountSol);
      slot.__tangoOriginalQuickBuy = nativeControl;
      slot.__tangoReplacementQuickBuy = replacement;
      slot.__tangoQuickBuyHandler = handleClick;
      slot.__tangoPointerBlocker = blockNativePointer;
      slot.__tangoNativeStyle = {
        pointerEvents: nativeControl.style.pointerEvents,
        visibility: nativeControl.style.visibility,
        ariaHidden: nativeControl.getAttribute('aria-hidden')
      };
      nativeControl.style.pointerEvents = 'none';
      nativeControl.style.visibility = 'hidden';
      nativeControl.setAttribute('aria-hidden', 'true');
      replacement.addEventListener('pointerdown', blockNativePointer, true);
      replacement.addEventListener('mousedown', blockNativePointer, true);
      replacement.addEventListener('click', handleClick, true);
      slot.appendChild(replacement);
      injected += 1;
    }
    return injected;
  }

  function clearQuickBuy() {
    document.querySelectorAll('.tango-native-buy-overridden').forEach((slot) => {
      restoreQuickBuySlot(slot);
    });
    document.querySelectorAll('.tango-list-quick-buy').forEach((element) => element.remove());
  }

  function restoreQuickBuySlot(slot) {
    const replacement = slot.__tangoReplacementQuickBuy;
    const original = slot.__tangoOriginalQuickBuy;
    if (replacement && slot.__tangoPointerBlocker) {
      replacement.removeEventListener('pointerdown', slot.__tangoPointerBlocker, true);
      replacement.removeEventListener('mousedown', slot.__tangoPointerBlocker, true);
    }
    if (replacement && slot.__tangoQuickBuyHandler) replacement.removeEventListener('click', slot.__tangoQuickBuyHandler, true);
    if (replacement?.isConnected) replacement.remove();
    if (original && slot.__tangoNativeStyle) {
      original.style.pointerEvents = slot.__tangoNativeStyle.pointerEvents;
      original.style.visibility = slot.__tangoNativeStyle.visibility;
      if (slot.__tangoNativeStyle.ariaHidden == null) original.removeAttribute('aria-hidden');
      else original.setAttribute('aria-hidden', slot.__tangoNativeStyle.ariaHidden);
    }
    delete slot.__tangoOriginalQuickBuy;
    delete slot.__tangoReplacementQuickBuy;
    delete slot.__tangoQuickBuyHandler;
    delete slot.__tangoPointerBlocker;
    delete slot.__tangoNativeStyle;
    slot.classList.remove('tango-native-buy-overridden');
    delete slot.dataset.tangoQuickBuy;
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoAmountSol;
  }

  Tango.GMGN = {
    chainFromUrl, tokenAddressFromUrl, parseMoney, readCurrentToken, discoverTokenCards, clearQuickBuy,
    _cardMarketCap: cardMarketCap, _cardSymbol: cardSymbol, _isTrenchPage: isTrenchPage,
    _isTokenDetailPage: isTokenDetailPage
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGN;
})(globalThis);
