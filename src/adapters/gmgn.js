(function initGmgnAdapter(global) {
  const Tango = global.Tango = global.Tango || {};
  const quickBuyActions = new Map();

  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.source !== 'TANGO_GMGN_PAGE' || event.data?.type !== 'PAPER_QUICK_BUY_CLICK') return;
      quickBuyActions.get(String(event.data.actionId || ''))?.();
    });
  }

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
        observedAt: priceUsd > 0 || marketCapUsd > 0 ? Date.now() : 0
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

  function tokenIdentityFromText(text) {
    const reserved = new Set([
      'MC', 'V', 'F', 'N', 'TX', 'DS', 'SOL', 'USD', 'P1', 'P2', 'P3', 'LIVE', 'OG',
      'TANGO', 'PAPER', 'TOKEN', 'BUY', 'SELL', '模拟盘', '虚拟买入'
    ]);
    const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^\$?([\p{L}\p{N}_][\p{L}\p{N}_.$-]{0,19})(?:\s+(.+))?$/u);
      if (!match) continue;
      const symbol = match[1].replace(/^\$/, '');
      if (reserved.has(symbol.toUpperCase()) || /^\d+(?:s|m|h|d|w|mo|y)$/i.test(symbol) || symbol.includes('...')) continue;
      const rawName = String(match[2] || '').replace(/\s+(?:MC|V|TX|DS|P[123])\b.*$/i, '').trim();
      return { symbol, name: rawName && rawName.length <= 80 ? rawName : symbol };
    }
    return { symbol: 'TOKEN', name: 'Token' };
  }

  function cardTokenIdentity(card) {
    const selectors = [
      '[data-testid="token-symbol"]', '[data-token-symbol]', '[class*="token-symbol"]',
      'a[href*="/sol/token/"]', 'a[href*="pump.fun/coin/"]'
    ];
    for (const selector of selectors) {
      for (const element of card?.querySelectorAll?.(selector) || []) {
        const identity = tokenIdentityFromText(element.innerText || element.textContent || '');
        if (identity.symbol !== 'TOKEN') return identity;
      }
    }
    return tokenIdentityFromText(card?.innerText || card?.textContent || '');
  }

  function cardSymbol(text) {
    return tokenIdentityFromText(text).symbol;
  }

  function cardMarketCap(text) {
    const match = String(text || '').match(/\bMC\s*:?\s*\$?\s*([0-9.,]+\s*[KMBT]?)/i);
    return match ? parseMoney(match[1]) : 0;
  }

  function cardTokenHref(card) {
    const directHref = card?.getAttribute?.('href');
    if (directHref?.includes('/sol/token/')) return new URL(directHref, location.origin).href;
    return card?.querySelector?.('a[href*="pump.fun/coin/"], a[href*="/sol/token/"]')?.href || '';
  }

  async function latestCardMarketCap(card, slot) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const value = cardMarketCap(card?.innerText || card?.textContent || '');
      if (value > 0) {
        slot.dataset.tangoMarketCapUsd = String(value);
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return Number(slot.dataset.tangoMarketCapUsd || 0);
  }

  function updateQuickBuySizeClass(slot) {
    const rect = slot.getBoundingClientRect();
    slot.classList.toggle('tango-quick-expanded', rect.height >= 36);
    slot.classList.toggle('tango-quick-narrow', rect.width <= 72);
  }

  function ensureQuickBuyStyle() {
    if (document.querySelector('#tango-trench-buy-style')) return;
    const style = document.createElement('style');
    style.id = 'tango-trench-buy-style';
    style.textContent = `
      .BuyButton-continer.tango-native-buy-overridden { isolation: isolate; min-width: 58px; position: relative !important; }
      .tango-list-quick-buy {
        align-items: center;
        appearance: none; background: color-mix(in srgb, var(--customize-button-ultra-color, #00ffee) 10%, transparent);
        border: 0; border-radius: 6px; box-sizing: border-box; color: var(--customize-button-ultra-color, #00ffee);
        cursor: pointer; display: flex; font: 700 12px/12px Inter, ui-sans-serif, system-ui, sans-serif;
        justify-content: center; min-height: 22px; overflow: hidden; padding: 2px 3px; position: relative; white-space: nowrap; width: 100%; z-index: 50;
      }
      .tango-list-quick-buy:hover { background: color-mix(in srgb, var(--customize-button-ultra-color, #00ffee) 20%, transparent); filter: brightness(1.12); }
      .tango-list-quick-buy:active { opacity: .55; }
      .tango-list-quick-buy:disabled { cursor: wait; opacity: .65; }
      .tango-paper-hint { background: #7756e8; border: 1px solid #ad9aff; border-radius: 3px; color: #fff; font-size: 8px; font-weight: 950; left: 2px; line-height: 10px; max-width: 30px; overflow: hidden; padding: 0 2px; position: absolute; text-overflow: clip; top: 1px; }
      .tango-buy-amount { align-items: center; display: flex; font-size: 14px; font-weight: 950; gap: 2px; letter-spacing: -.02em; padding-top: 7px; text-shadow: 0 0 9px color-mix(in srgb, var(--customize-button-ultra-color, #00ffee) 45%, transparent); }
      .tango-buy-amount svg { flex: 0 0 14px; height: 14px; width: 14px; }
      .tango-native-buy-overridden.tango-quick-expanded .tango-paper-hint {
        font-size: 10px; left: 5px; line-height: 13px; max-width: none; padding: 0 3px; top: 4px;
      }
      .tango-native-buy-overridden.tango-quick-expanded .tango-buy-amount {
        bottom: 6px; font-size: 15px; padding-top: 0; position: absolute; right: 8px;
      }
      .tango-native-buy-overridden.tango-quick-expanded .tango-buy-amount svg { height: 15px; width: 15px; }
      .tango-native-buy-overridden.tango-quick-narrow .tango-list-quick-buy { padding-inline: 2px; }
      .tango-native-buy-overridden.tango-quick-narrow .tango-buy-amount { font-size: 13px; gap: 1px; }
      .tango-native-buy-overridden.tango-quick-narrow .tango-buy-amount svg { height: 12px; width: 12px; }
      .tango-native-buy-overridden.tango-quick-narrow.tango-quick-expanded .tango-buy-amount {
        bottom: 5px; font-size: 14px; right: 5px;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function discoverTokenCards(onQuickBuy, defaultAmountSol = 0.1, paperLabel = 'PAPER') {
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
      const href = cardTokenHref(card);
      if (!href) continue;
      const address = tokenAddressFromUrl(href);
      const existingReplacement = slot.querySelector('.tango-list-quick-buy');
      let nativeControl = slot.querySelector('[data-testid="quickbuy"]');
      const amountSol = parseMoney(nativeControl?.textContent || '') || Number(slot.dataset.tangoAmountSol) || Number(defaultAmountSol);
      if (!address || !(amountSol > 0)) continue;
      const currentMarketCap = cardMarketCap(card.innerText || card.textContent || '');
      if (currentMarketCap > 0) slot.dataset.tangoMarketCapUsd = String(currentMarketCap);
      updateQuickBuySizeClass(slot);
      if (slot.dataset.tangoQuickBuy === '1' && existingReplacement &&
        slot.dataset.tangoTokenAddress === address && Number(slot.dataset.tangoAmountSol) === amountSol &&
        slot.dataset.tangoPaperLabel === paperLabel) {
        // GMGN can reconcile the original control back into the slot. Remove it again fail-closed.
        if (nativeControl) nativeControl.remove();
        continue;
      }
      if (slot.dataset.tangoQuickBuy === '1') {
        restoreQuickBuySlot(slot);
        nativeControl = slot.querySelector('[data-testid="quickbuy"]');
      }
      if (!nativeControl) continue;
      if (currentMarketCap > 0) slot.dataset.tangoMarketCapUsd = String(currentMarketCap);
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.className = 'tango-list-quick-buy';
      replacement.dataset.tangoQuickBuy = '1';
      replacement.dataset.tangoPaperAction = 'quick-buy';
      const actionId = `tango-paper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      replacement.dataset.tangoActionId = actionId;
      replacement.title = `Tango Paper Buy ${amountSol} SOL`;
      replacement.setAttribute('aria-label', `Tango Paper Buy ${amountSol} SOL`);
      const nativeRect = nativeControl.getBoundingClientRect();
      replacement.style.height = `${Math.max(22, Math.round(nativeRect.height || 0))}px`;
      const hint = document.createElement('span');
      hint.className = 'tango-paper-hint';
      hint.textContent = paperLabel;
      const amount = document.createElement('span');
      amount.className = 'tango-buy-amount';
      amount.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m13.688 8.12-6.471 7.705c-.206.245-.604.061-.55-.255l1.007-5.843-4.617-.061c-.88-.012-1.352-1.038-.79-1.714L8.723.191c.205-.247.605-.063.55.253L8.247 6.399l4.641.003c.888.001 1.371 1.038.8 1.718Z"/></svg><span>' + amountSol + ' SOL</span>';
      replacement.append(hint, amount);
      const handleClick = async () => {
        const now = Date.now();
        if (replacement.disabled || now - Number(replacement.dataset.tangoLastClickAt || 0) < 900) return;
        replacement.dataset.tangoLastClickAt = String(now);
        replacement.disabled = true;
        try {
          const activeHref = cardTokenHref(card);
          const activeAddress = activeHref ? tokenAddressFromUrl(activeHref) : null;
          if (activeAddress !== address) return;
          const marketCapUsd = await latestCardMarketCap(card, slot);
          const latestHref = cardTokenHref(card);
          const latestAddress = latestHref ? tokenAddressFromUrl(latestHref) : null;
          if (latestAddress !== address) return;
          const identity = cardTokenIdentity(card);
          const symbol = identity.symbol;
          const isPumpToken = /pump$/i.test(address);
          const priceUsd = marketCapUsd > 0 ? marketCapUsd / 1_000_000_000 : 0;
          const logoUrl = card.querySelector('img[alt="logo"]')?.src || '';
          await onQuickBuy({
            token: { chain: chainFromUrl(href) || 'sol', address, symbol, name: identity.name, logoUrl },
            quote: {
              priceUsd, marketCapUsd, liquidityUsd: 0, solPriceUsd: 0,
              source: isPumpToken ? 'GMGN_TRENCH_MC' : 'GMGN_LIST_MC',
              valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
              observedAt: marketCapUsd > 0 ? Date.now() : 0
            },
            amountSol,
            sourceUrl: href
          });
        } finally {
          replacement.disabled = false;
        }
      };
      slot.classList.add('tango-native-buy-overridden');
      slot.dataset.tangoQuickBuy = '1';
      slot.dataset.tangoTokenAddress = address;
      slot.dataset.tangoAmountSol = String(amountSol);
      slot.dataset.tangoPaperLabel = paperLabel;
      slot.dataset.tangoActionId = actionId;
      slot.__tangoOriginalQuickBuy = nativeControl;
      slot.__tangoReplacementQuickBuy = replacement;
      slot.__tangoQuickBuyHandler = handleClick;
      quickBuyActions.set(actionId, handleClick);
      nativeControl.replaceWith(replacement);
      requestAnimationFrame(() => updateQuickBuySizeClass(slot));
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
    quickBuyActions.delete(String(slot.dataset.tangoActionId || ''));
    if (replacement?.isConnected && original) replacement.replaceWith(original);
    else if (replacement?.isConnected) replacement.remove();
    else if (original && !original.isConnected && slot.isConnected && !slot.querySelector('[data-testid="quickbuy"]')) slot.appendChild(original);
    delete slot.__tangoOriginalQuickBuy;
    delete slot.__tangoReplacementQuickBuy;
    delete slot.__tangoQuickBuyHandler;
    slot.classList.remove('tango-native-buy-overridden', 'tango-quick-expanded', 'tango-quick-narrow');
    delete slot.dataset.tangoQuickBuy;
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoAmountSol;
    delete slot.dataset.tangoPaperLabel;
    delete slot.dataset.tangoActionId;
    delete slot.dataset.tangoMarketCapUsd;
  }

  Tango.GMGN = {
    chainFromUrl, tokenAddressFromUrl, parseMoney, readCurrentToken, discoverTokenCards, clearQuickBuy,
    _cardMarketCap: cardMarketCap, _cardSymbol: cardSymbol, _tokenIdentityFromText: tokenIdentityFromText,
    _isTrenchPage: isTrenchPage,
    _isTokenDetailPage: isTokenDetailPage
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGN;
})(globalThis);
