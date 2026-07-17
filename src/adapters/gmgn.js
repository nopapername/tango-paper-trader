(function initGmgnAdapter(global) {
  const Tango = global.Tango = global.Tango || {};
  const quickBuyActions = new Map();
  const trenchColumns = new WeakMap();
  const quickBuyResizeObserver = typeof global.ResizeObserver === 'function'
    ? new global.ResizeObserver((entries) => entries.forEach((entry) => updateQuickBuySizeClass(entry.target)))
    : null;

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

  function firstText(selectors, root = document) {
    for (const selector of selectors) {
      const element = root?.querySelector?.(selector);
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

  function addressHintMatches(text, address) {
    const source = String(text || '').replace(/\s+/g, '');
    const target = String(address || '').trim();
    if (!source || target.length < 8) return false;
    if (source.toLowerCase().includes(target.toLowerCase())) return true;
    const prefix = target.slice(0, 4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffix = target.slice(-4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${prefix}.{0,8}${suffix}`, 'i').test(source);
  }

  function elementHasTokenAddress(element, address) {
    if (!element) return false;
    const text = String(element.textContent || '');
    // Avoid accepting a page-wide ancestor merely because another widget happens
    // to contain the new route address while GMGN is still rendering the old header.
    if (text.length <= 4_000 && addressHintMatches(text, address)) return true;
    const nodes = [element, ...Array.from(element.querySelectorAll?.('a[href], [title], [data-address], [data-token-address], [data-mint], [data-ca]') || []).slice(0, 80)];
    return nodes.some((node) => ['href', 'title', 'data-address', 'data-token-address', 'data-mint', 'data-ca']
      .some((attribute) => String(node.getAttribute?.(attribute) || '').toLowerCase().includes(String(address).toLowerCase())));
  }

  function visibleSolAddressHint(value) {
    const text = String(value || '').replace(/\s+/g, '').trim();
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return text;
    if (/^[1-9A-HJ-NP-Za-km-z]{3,8}(?:\.{3}|…)[1-9A-HJ-NP-Za-km-z]{3,8}$/.test(text)) return text;
    return '';
  }

  function distanceToAncestor(node, ancestor) {
    let current = node;
    for (let distance = 0; distance <= 8 && current; distance += 1, current = current.parentElement) {
      if (current === ancestor) return distance;
    }
    return Infinity;
  }

  function localDetailAddressEvidence(header, scope, address) {
    if (!scope || /^(?:HTML|BODY|MAIN)$/.test(String(scope.tagName || '').toUpperCase())) return null;
    const headers = Array.from(scope.querySelectorAll?.('[data-sentry-component="TokenHeader"]') || []);
    if (headers.length !== 1 || headers[0] !== header) return null;
    const descendants = Array.from(scope.querySelectorAll?.('*') || []);
    if (descendants.length > 600 || String(scope.textContent || '').length > 6_000) return null;

    const leafNodes = Array.from(scope.querySelectorAll?.('span,div,p,a,button') || [])
      .filter((node) => Number(node.childElementCount || 0) === 0 && String(node.textContent || '').length <= 128);
    const attributeNodes = Array.from(scope.querySelectorAll?.('[data-address], [data-token-address], [data-mint], [data-ca]') || []);
    const evidence = [];
    leafNodes.forEach((node) => {
      const hint = visibleSolAddressHint(node.textContent);
      if (hint) evidence.push({ node, hint });
    });
    attributeNodes.forEach((node) => {
      ['data-address', 'data-token-address', 'data-mint', 'data-ca'].forEach((attribute) => {
        const hint = visibleSolAddressHint(node.getAttribute?.(attribute));
        if (hint) evidence.push({ node, hint });
      });
    });
    if (!evidence.length || evidence.some((item) => !addressHintMatches(item.hint, address))) return null;

    const addressNode = evidence.find((item) => addressHintMatches(item.hint, address))?.node;
    const distance = distanceToAncestor(header, scope) + distanceToAncestor(addressNode, scope);
    if (!addressNode || distance > 8) return null;

    const linkedAddresses = Array.from(scope.querySelectorAll?.('a[href*="/token/"], a[href*="pump.fun/coin/"]') || [])
      .map((link) => {
        try { return tokenAddressFromUrl(new URL(link.href || link.getAttribute?.('href') || '', location.origin).href); }
        catch { return ''; }
      })
      .filter(Boolean);
    if (linkedAddresses.some((linkedAddress) => String(linkedAddress).toLowerCase() !== String(address).toLowerCase())) return null;
    return addressNode;
  }

  function findTokenDetailScope(address) {
    const findMatches = (headers) => {
      const directMatches = headers.filter((header) => elementHasTokenAddress(header, address));
      if (directMatches.length === 1) {
        return [{
          header: directMatches[0],
          scope: directMatches[0],
          identityScope: directMatches[0],
          bindingScope: directMatches[0]
        }];
      }
      if (directMatches.length > 1) return [];

      const localMatches = [];
      for (const header of headers) {
        let bindingScope = header.parentElement;
        for (let depth = 1; depth <= 5 && bindingScope; depth += 1, bindingScope = bindingScope.parentElement) {
          const addressNode = localDetailAddressEvidence(header, bindingScope, address);
          if (!addressNode) continue;
          localMatches.push({ header, scope: header, identityScope: bindingScope, bindingScope, addressNode });
          break;
        }
      }
      return localMatches;
    };

    const baseInfoBars = Array.from(document.querySelectorAll('[data-sentry-component="BaseInfoBar"]'))
      .filter((bar) => bar.getAttribute?.('data-sentry-component') === 'BaseInfoBar');
    if (baseInfoBars.length) {
      const anchoredMatches = baseInfoBars.flatMap((bar) => findMatches(
        Array.from(bar.querySelectorAll?.('[data-sentry-component="TokenHeader"]') || [])
      ));
      return anchoredMatches.length === 1 ? anchoredMatches[0] : null;
    }

    const headers = Array.from(document.querySelectorAll('[data-sentry-component="TokenHeader"]'));
    const localMatches = findMatches(headers);
    return localMatches.length === 1 ? localMatches[0] : null;
  }

  function resolveCurrentTokenRead(previous, next, url = location.href) {
    if (next) return next;
    if (!isTokenDetailPage(url)) return null;
    const address = tokenAddressFromUrl(url).toLowerCase();
    const previousAddress = String(previous?.token?.address || '').toLowerCase();
    return address && previousAddress === address ? previous : null;
  }

  function needsCurrentTokenRead(current, url = location.href) {
    if (!isTokenDetailPage(url)) return false;
    const address = tokenAddressFromUrl(url).toLowerCase();
    return !address || String(current?.token?.address || '').toLowerCase() !== address;
  }

  function detailTokenIdentity(scope, address) {
    const gmgnSymbolNode = scope?.querySelector?.('[data-testid="token-detail-symbol"]')
      || scope?.querySelector?.('#token-base-symbol[data-symbol]');
    const directSymbol = String(
      gmgnSymbolNode?.getAttribute?.('data-symbol')
      || gmgnSymbolNode?.textContent
      || firstText([
      '[data-testid="token-symbol"]', '[data-token-symbol]', '[class*="token-symbol"]',
      '[class*="TokenSymbol"]'
      ], scope)?.text
      || ''
    ).trim();
    const heading = firstText(['h1', 'h2'], scope)?.text;
    const title = String(directSymbol || heading || '').replace(/\s+/g, ' ').trim();
    if (!title || addressHintMatches(title, address)) return { symbol: 'TOKEN', name: 'Token' };
    let identity;
    if (/^\$?\d+(?:\.\d+)?$/.test(title)) {
      const numeric = title.replace(/^\$/, '');
      identity = { symbol: numeric, name: numeric };
    } else {
      identity = tokenIdentityFromText(title);
      if (identity.symbol === 'TOKEN') {
        const fallback = title.replace(/^\$/, '').slice(0, 32);
        identity = { symbol: fallback || 'TOKEN', name: fallback || 'Token' };
      }
    }

    const symbolRow = gmgnSymbolNode?.parentElement?.parentElement;
    const originalName = firstText(['[translate="yes"]'], symbolRow)?.text;
    const explicitName = originalName || firstText([
      '[data-testid="token-detail-name"]', '[data-testid="token-name"]', '[data-token-name]',
      '[class*="token-name"]', '[class*="TokenName"]'
    ], scope)?.text;
    const nameCandidate = String(explicitName || '').replace(/\s+/g, ' ').trim();
    if (nameCandidate && nameCandidate.length <= 100 && !addressHintMatches(nameCandidate, address)) {
      identity.name = nameCandidate;
    } else if (heading && heading !== title) {
      const headingIdentity = tokenIdentityFromText(heading);
      if (headingIdentity.symbol === identity.symbol && headingIdentity.name !== headingIdentity.symbol) identity.name = headingIdentity.name;
    }
    return identity;
  }

  function tokenLogo(header) {
    const selectors = [
      '[data-testid="token-logo"] img', 'img[data-testid="token-logo"]',
      '[data-token-logo] img', 'img[data-token-logo]', 'img[alt="logo"]'
    ];
    for (const selector of selectors) {
      const source = header?.querySelector?.(selector)?.src;
      if (source) return source;
    }
    const images = Array.from(header?.querySelectorAll?.('img') || []);
    return images.length === 1 ? images[0].src || '' : '';
  }

  async function readCurrentToken() {
    if (!isTokenDetailPage()) return null;
    const address = tokenAddressFromUrl();
    const chain = chainFromUrl();
    if (!address || chain !== 'sol') return null;
    let detail = findTokenDetailScope(address);
    if (!detail) return null;
    if (detail.bindingScope !== detail.header) {
      const firstIdentity = detailTokenIdentity(detail.identityScope || detail.scope, address);
      const firstFingerprint = `${firstIdentity.symbol}\u0000${firstIdentity.name}\u0000${tokenLogo(detail.header)}`;
      await new Promise((resolve) => setTimeout(resolve, 48));
      if (tokenAddressFromUrl() !== address || chainFromUrl() !== chain) return null;
      const confirmed = findTokenDetailScope(address);
      if (!confirmed) return null;
      const confirmedIdentity = detailTokenIdentity(confirmed.identityScope || confirmed.scope, address);
      const confirmedFingerprint = `${confirmedIdentity.symbol}\u0000${confirmedIdentity.name}\u0000${tokenLogo(confirmed.header)}`;
      if (confirmedFingerprint !== firstFingerprint) return null;
      detail = confirmed;
    }
    const identity = detailTokenIdentity(detail.identityScope || detail.scope, address);
    const priceUsd = findPrice();
    const baseInfo = document.querySelector('[data-sentry-component="BaseInfoPriceView"]');
    const baseItems = baseInfo ? Array.from(baseInfo.querySelectorAll('[data-sentry-component="InfoItem"]')) : [];
    const unlabeledMarketCap = parseMoney(baseItems.find((item) => !item.querySelector('.info-item-title'))?.querySelector('.info-item-value')?.textContent);
    const labeledLiquidity = baseItems.find((item) => /^(池子|pool|liquidity)$/i.test(item.querySelector('.info-item-title')?.textContent?.trim() || ''));
    const marketCapUsd = unlabeledMarketCap || scanLabeledValue(['mc', 'market cap', 'mcap', '市值']) || (/pump$/i.test(address) ? priceUsd * 1_000_000_000 : 0);
    const liquidityUsd = parseMoney(labeledLiquidity?.querySelector('.info-item-value')?.textContent) || scanLabeledValue(['liq', 'liquidity', '流动性', '池子', 'pool']);
    return {
      token: {
        chain, address, symbol: identity.symbol, name: identity.name, logoUrl: tokenLogo(detail.header),
        metadataVerified: true, metadataSource: 'GMGN_DETAIL'
      },
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
    const cached = trenchColumns.get(card);
    if (cached?.isConnected && cached.contains(card)) return cached;
    const headings = ['新创建', '即将打满', '已开盘', 'new creation', 'about to graduate', 'launched'];
    let candidate = card?.parentElement;
    for (let depth = 0; depth < 8 && candidate; depth += 1, candidate = candidate.parentElement) {
      const text = (candidate.textContent || '').trim().toLowerCase();
      const hasHeading = headings.some((heading) => text.startsWith(heading) || text.includes(`${heading}\n`));
      if (hasHeading && candidate.querySelector('[class~="group/a"]')) {
        trenchColumns.set(card, candidate);
        return candidate;
      }
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
      if (reserved.has(symbol.toUpperCase()) || /^\d+(?:\.\d+)?(?:s|m|h|d|w|mo|y)?$/i.test(symbol) || symbol.includes('...')) continue;
      const rawName = String(match[2] || '').replace(/\s+(?:MC|V|TX|DS|P[123])\b.*$/i, '').trim();
      return { symbol, name: rawName && rawName.length <= 80 ? rawName : symbol };
    }
    return { symbol: 'TOKEN', name: 'Token' };
  }

  function tokenAddressLine(line) {
    const text = String(line || '').trim();
    return /(?:\.{3}|…)/.test(text) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
  }

  function validCardMetadataLine(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 100 || tokenAddressLine(text)) return false;
    if (/^(?:MC|V|F|N|TX|DS|SOL|USD|P[123]|LIVE|OG|TANGO|PAPER|BUY|SELL|模拟盘|虚拟买入)$/i.test(text)) return false;
    if (/^(?:[+\-$]\d[\d,.]*(?:[%KMBT])?|\d[\d,.]*[%KMBT]|\d{1,3}(?:,\d{3})+)$/i.test(text)) return false;
    if (/^\d+(?:\.\d+)?(?:ms|s|m|h|d|w|mo|y)$/i.test(text)) return false;
    if (/^(?:MC|V|F|N|TX|DS)\s*[:：]?/i.test(text)) return false;
    return /[\p{L}\p{N}]/u.test(text);
  }

  function cardIdentityFromText(text, expectedAddress = '') {
    const lines = String(text || '').split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const addressIndex = expectedAddress
      ? lines.findIndex((line) => addressHintMatches(line, expectedAddress))
      : lines.findIndex(tokenAddressLine);
    if (addressIndex < 0) return expectedAddress ? null : tokenIdentityFromText(text);
    const candidates = lines.slice(addressIndex + 1, addressIndex + 14).filter(validCardMetadataLine);
    if (!candidates.length) return { symbol: 'TOKEN', name: 'Token' };

    const first = candidates[0].replace(/^\$/, '');
    if (/^\d+(?:\.\d+)?$/.test(first)) {
      const numericName = candidates.find((line, index) => index > 0 && line !== first) || first;
      return { symbol: first, name: numericName };
    }
    const parsed = tokenIdentityFromText(first);
    if (parsed.symbol === 'TOKEN') return { symbol: first.slice(0, 32), name: first.slice(0, 100) };
    const separateName = candidates.find((line, index) => index > 0 && line !== first);
    return {
      symbol: parsed.symbol,
      name: parsed.name !== parsed.symbol ? parsed.name : (separateName || parsed.symbol)
    };
  }

  function cardTokenIdentity(card, expectedAddress = '') {
    const fromCard = cardIdentityFromText(card?.innerText || card?.textContent || '', expectedAddress);
    if (!fromCard) return null;
    if (fromCard.symbol !== 'TOKEN') return fromCard;
    const selectors = ['[data-testid="token-symbol"]', '[data-token-symbol]', '[class*="token-symbol"]'];
    for (const selector of selectors) {
      for (const element of card?.querySelectorAll?.(selector) || []) {
        const identity = tokenIdentityFromText(element.innerText || element.textContent || '');
        if (identity.symbol !== 'TOKEN') return identity;
      }
    }
    return fromCard;
  }

  function verifiedCardMetadata(card, address) {
    const identity = cardTokenIdentity(card, address);
    if (!identity) return null;
    return { ...identity, logoUrl: cardTokenLogo(card) };
  }

  function cardTokenLogo(card) {
    const avatarRoot = card?.firstElementChild;
    const selectors = [
      '[data-testid="token-logo"] img', 'img[data-testid="token-logo"]',
      '[data-token-logo] img', 'img[data-token-logo]', 'img[alt="logo"]'
    ];
    let avatarLogo = '';
    for (const selector of selectors) {
      avatarLogo = avatarRoot?.querySelector?.(selector)?.src || '';
      if (avatarLogo) break;
    }
    if (avatarLogo) return avatarLogo;
    const logos = Array.from(card?.querySelectorAll?.('img[alt="logo"]') || []);
    return logos.length === 1 ? logos[0].src || '' : '';
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
    const lines = String(card?.innerText || card?.textContent || '').split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const candidates = Array.from(card?.querySelectorAll?.('a[href*="pump.fun/coin/"], a[href*="/sol/token/"]') || [])
      .map((link) => {
        const href = link.href || link.getAttribute?.('href') || '';
        const address = href ? tokenAddressFromUrl(new URL(href, location.origin).href) : '';
        return { href, address, addressIndex: lines.findIndex((line) => addressHintMatches(line, address)) };
      })
      .filter((candidate) => candidate.address && candidate.addressIndex >= 0)
      .sort((left, right) => left.addressIndex - right.addressIndex);
    return candidates[0]?.href || '';
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

  function selectQuickBuyAmount(columnValue, nativeText, previousAmount, defaultAmount) {
    return parseMoney(columnValue) || parseMoney(nativeText) || Number(previousAmount) || Number(defaultAmount);
  }

  function cardQuickBuyAmount(card, nativeControl, slot, defaultAmountSol) {
    const columnInput = trenchColumn(card)?.querySelector('[data-sentry-component="BuyAmountInput"] input');
    return selectQuickBuyAmount(columnInput?.value, nativeControl?.textContent, slot.dataset.tangoAmountSol, defaultAmountSol);
  }

  function readVisibleTokenMetadata(addresses) {
    if (!isTrenchPage()) return [];
    const requested = new Set((addresses || []).map((address) => String(address || '').toLowerCase()).filter(Boolean));
    if (!requested.size) return [];
    const found = new Map();
    const cards = document.querySelectorAll('[class~="group/a"]');
    for (const card of cards) {
      if (found.size >= requested.size) break;
      const href = cardTokenHref(card);
      if (!href) continue;
      const address = tokenAddressFromUrl(href);
      const normalized = String(address || '').toLowerCase();
      if (!requested.has(normalized) || found.has(normalized)) continue;
      if (!trenchColumn(card)) continue;
      const metadata = verifiedCardMetadata(card, address);
      if (!metadata) continue;
      found.set(normalized, {
        chain: 'sol', address,
        symbol: metadata.symbol, name: metadata.name, logoUrl: metadata.logoUrl,
        metadataVerified: true, metadataSource: 'GMGN_TRENCH'
      });
    }
    return [...found.values()];
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
      const amountSol = cardQuickBuyAmount(card, nativeControl, slot, defaultAmountSol);
      if (!address || !(amountSol > 0) || !verifiedCardMetadata(card, address)) continue;
      const currentMarketCap = cardMarketCap(card.innerText || card.textContent || '');
      if (currentMarketCap > 0) slot.dataset.tangoMarketCapUsd = String(currentMarketCap);
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
          if (activeAddress !== address || !verifiedCardMetadata(card, address)) return;
          const marketCapUsd = await latestCardMarketCap(card, slot);
          const latestHref = cardTokenHref(card);
          const latestAddress = latestHref ? tokenAddressFromUrl(latestHref) : null;
          if (latestAddress !== address) return;
          const metadata = verifiedCardMetadata(card, address);
          if (!metadata) return;
          const symbol = metadata.symbol;
          const isPumpToken = /pump$/i.test(address);
          const priceUsd = marketCapUsd > 0 ? marketCapUsd / 1_000_000_000 : 0;
          await onQuickBuy({
            token: {
              chain: chainFromUrl(href) || 'sol', address, symbol, name: metadata.name, logoUrl: metadata.logoUrl,
              metadataVerified: true, metadataSource: 'GMGN_TRENCH'
            },
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
      if (quickBuyResizeObserver) quickBuyResizeObserver.observe(slot);
      else requestAnimationFrame(() => updateQuickBuySizeClass(slot));
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
    quickBuyResizeObserver?.unobserve(slot);
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
    chainFromUrl, tokenAddressFromUrl, parseMoney, readCurrentToken, readVisibleTokenMetadata, discoverTokenCards, clearQuickBuy,
    resolveCurrentTokenRead, needsCurrentTokenRead,
    _cardMarketCap: cardMarketCap, _cardSymbol: cardSymbol, _tokenIdentityFromText: tokenIdentityFromText,
    _cardIdentityFromText: cardIdentityFromText, _addressHintMatches: addressHintMatches,
    _cardTokenLogo: cardTokenLogo, _verifiedCardMetadata: verifiedCardMetadata, _detailTokenIdentity: detailTokenIdentity,
    _findTokenDetailScope: findTokenDetailScope, _tokenLogo: tokenLogo,
    _resolveCurrentTokenRead: resolveCurrentTokenRead, _needsCurrentTokenRead: needsCurrentTokenRead,
    _selectQuickBuyAmount: selectQuickBuyAmount,
    _isTrenchPage: isTrenchPage,
    _isTokenDetailPage: isTokenDetailPage
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGN;
})(globalThis);
