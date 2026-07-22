(function initGmgnAdapter(global) {
  const Tango = global.Tango = global.Tango || {};
  const quickBuyActions = new Map();
  const trackedQuickBuySlots = new Set();
  const trenchColumns = new WeakMap();
  const trenchSnapshots = new Map();
  const MAX_TRENCH_SNAPSHOTS = 200;
  let lastVerifiedDetail = null;

  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.source !== 'TANGO_GMGN_PAGE' || event.data?.type !== 'PAPER_QUICK_BUY_CLICK') return;
      quickBuyActions.get(String(event.data.actionId || ''))?.();
    });
  }

  const SUBSCRIPT_DIGITS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
  const CARD_LAUNCHPADS = Object.freeze([
    { pattern: /(?:^|\.)four\.meme$/i, name: 'Four.meme' },
    { pattern: /(?:^|\.)flap\.sh$/i, name: 'Flap' },
    { pattern: /(?:^|\.)pump\.fun$/i, name: 'Pump.fun' },
    { pattern: /(?:^|\.)zora\.co$/i, name: 'Zora' },
    { pattern: /(?:^|\.)bankr\.bot$/i, name: 'Bankr' },
    { pattern: /(?:^|\.)clanker\.world$/i, name: 'Clanker' },
    { pattern: /(?:^|\.)(?:dyor\.fun|dyor\.io|dyor\.exchange)$/i, name: 'DYOR' },
    { pattern: /(?:^|\.)bow\.fun$/i, name: 'Bow.fun' }
  ]);
  const DETAIL_LAUNCHPADS = Object.freeze([
    ...CARD_LAUNCHPADS,
    { pattern: /(?:^|\.)stroid\.xyz$/i, name: 'Stroid' },
    { pattern: /(?:^|\.)trench\.today$/i, name: 'Trench.today' }
  ]);

  function chainFromUrl(url = global.location?.href || '') {
    return Tango.Chains?.fromUrl?.(url)?.id || null;
  }

  function trenchSnapshotKey(chain, address) {
    if (!chain || !Tango.Chains.validateAddress(chain, address)) return '';
    return `${chain}:${Tango.Chains.normalizeAddress(chain, address)}`;
  }

  function readTrenchSnapshot(chain, address) {
    const snapshot = trenchSnapshots.get(trenchSnapshotKey(chain, address));
    return snapshot ? { token: { ...snapshot.token }, quote: { ...snapshot.quote } } : null;
  }

  function rememberTrenchSnapshot(context) {
    const chain = context?.token?.chain;
    const address = context?.token?.address;
    const key = trenchSnapshotKey(chain, address);
    if (!key) return null;
    const token = context.token;
    trenchSnapshots.delete(key);
    trenchSnapshots.set(key, {
      token: {
        chain, address: Tango.Chains.normalizeAddress(chain, address),
        symbol: String(token.symbol || '').trim().slice(0, 32),
        name: String(token.name || '').trim().slice(0, 100),
        logoUrl: String(token.logoUrl || '').trim().slice(0, 1000),
        launchpad: String(token.launchpad || '').trim().slice(0, 64),
        launchMode: String(token.launchMode || '').trim().slice(0, 64),
        metadataVerified: true, metadataSource: 'GMGN_TRENCH'
      },
      quote: { ...(context.quote || {}) }
    });
    while (trenchSnapshots.size > MAX_TRENCH_SNAPSHOTS) trenchSnapshots.delete(trenchSnapshots.keys().next().value);
    return readTrenchSnapshot(chain, address);
  }

  function tokenAddressFromUrl(url = global.location?.href || '') {
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

  function scanLabeledValue(labels, root) {
    const normalized = labels.map((label) => label.toLowerCase());
    const nodes = root?.querySelectorAll?.('span,div,p') || [];
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

  function baseInfoPriceView(root) {
    if (root?.getAttribute?.('data-sentry-component') === 'BaseInfoPriceView') return root;
    return root?.querySelector?.('[data-sentry-component="BaseInfoPriceView"]') || null;
  }

  function findPrice(root) {
    const baseInfo = baseInfoPriceView(root);
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
    ], root);
    const directValue = parseMoney(direct?.text);
    if (directValue > 0) return directValue;

    const candidates = Array.from(root?.querySelectorAll?.('span,div') || [])
      .filter((element) => element.childElementCount === 0)
      .map((element) => element.textContent?.trim() || '')
      .filter((text) => /^\$?0(?:\.\d+|\.0[\u2080-\u2089]\d+)$/.test(text) || /^\$\d+\.\d{3,}$/.test(text))
      .slice(0, 100)
      .map(parseMoney)
      .filter((value) => value > 0);
    return candidates.length ? candidates[0] : 0;
  }

  function addressHintMatches(text, address, chainId = null) {
    const source = String(text || '').replace(/\s+/g, '');
    const target = String(address || '').trim();
    if (!source || target.length < 8) return false;
    const caseInsensitive = !chainId || Tango.Chains.get(chainId)?.addressFamily === 'EVM';
    if ((caseInsensitive ? source.toLowerCase() : source).includes(caseInsensitive ? target.toLowerCase() : target)) return true;
    const prefix = target.slice(0, 4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffix = target.slice(-4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${prefix}.{0,8}${suffix}`, caseInsensitive ? 'i' : '').test(source);
  }

  function elementHasTokenAddress(element, address, chainId = null) {
    if (!element) return false;
    const text = String(element.textContent || '');
    // Avoid accepting a page-wide ancestor merely because another widget happens
    // to contain the new route address while GMGN is still rendering the old header.
    if (text.length <= 4_000 && addressHintMatches(text, address, chainId)) return true;
    const nodes = [element, ...Array.from(element.querySelectorAll?.('a[href], [title], [data-address], [data-token-address], [data-mint], [data-ca]') || []).slice(0, 80)];
    const caseInsensitive = !chainId || Tango.Chains.get(chainId)?.addressFamily === 'EVM';
    return nodes.some((node) => ['href', 'title', 'data-address', 'data-token-address', 'data-mint', 'data-ca']
      .some((attribute) => {
        const value = String(node.getAttribute?.(attribute) || '');
        return (caseInsensitive ? value.toLowerCase() : value).includes(caseInsensitive ? String(address).toLowerCase() : String(address));
      }));
  }

  function visibleAddressHint(value, chainId = null) {
    const text = String(value || '').replace(/\s+/g, '').trim();
    if (chainId && Tango.Chains.validateAddress(chainId, text)) return text;
    if (!chainId && Tango.Chains.all().some((chain) => Tango.Chains.validateAddress(chain.id, text))) return text;
    if (/^(?:0x[a-fA-F0-9]{3,8}|[1-9A-HJ-NP-Za-km-z]{3,8})(?:\.{3}|…)(?:[a-fA-F0-9]{3,8}|[1-9A-HJ-NP-Za-km-z]{3,8})$/.test(text)) return text;
    return '';
  }

  function distanceToAncestor(node, ancestor) {
    let current = node;
    for (let distance = 0; distance <= 8 && current; distance += 1, current = current.parentElement) {
      if (current === ancestor) return distance;
    }
    return Infinity;
  }

  function localDetailAddressEvidence(header, scope, address, chainId = null) {
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
      const hint = visibleAddressHint(node.textContent, chainId);
      if (hint) evidence.push({ node, hint });
    });
    attributeNodes.forEach((node) => {
      ['data-address', 'data-token-address', 'data-mint', 'data-ca'].forEach((attribute) => {
        const hint = visibleAddressHint(node.getAttribute?.(attribute), chainId);
        if (hint) evidence.push({ node, hint });
      });
    });
    if (!evidence.length || evidence.some((item) => !addressHintMatches(item.hint, address, chainId))) return null;

    const addressNode = evidence.find((item) => addressHintMatches(item.hint, address, chainId))?.node;
    const distance = distanceToAncestor(header, scope) + distanceToAncestor(addressNode, scope);
    if (!addressNode || distance > 8) return null;

    const linkedAddresses = Array.from(scope.querySelectorAll?.('a[href*="/token/"], a[href*="pump.fun/coin/"]') || [])
      .map((link) => {
        try { return tokenAddressFromUrl(new URL(link.href || link.getAttribute?.('href') || '', global.location?.origin || 'https://gmgn.ai').href); }
        catch { return ''; }
      })
      .filter(Boolean);
    if (linkedAddresses.some((linkedAddress) => !Tango.Chains.validateAddress(chainId, linkedAddress)
      || Tango.Chains.normalizeAddress(chainId, linkedAddress) !== Tango.Chains.normalizeAddress(chainId, address))) return null;
    return addressNode;
  }

  function elementChainBinding(element, chainId) {
    if (!chainId) return 'MATCH';
    const links = Array.from(element?.querySelectorAll?.('a[href*="/token/"], a[href*="pump.fun/coin/"]') || [])
      .filter((link) => {
        try {
          const parsed = new URL(link.href || link.getAttribute?.('href') || '', global.location?.origin || 'https://gmgn.ai');
          return parsed.hostname === 'gmgn.ai' || parsed.hostname === 'pump.fun';
        } catch { return true; }
      });
    if (!links.length) return 'UNKNOWN';
    const matches = links.every((link) => {
      let parsed;
      try { parsed = new URL(link.href || link.getAttribute?.('href') || '', global.location?.origin || 'https://gmgn.ai'); }
      catch { return false; }
      if (parsed.hostname === 'pump.fun') return chainId === 'sol';
      return chainFromUrl(parsed.href) === chainId;
    });
    return matches ? 'MATCH' : 'MISMATCH';
  }

  function findTokenDetailScope(address, chainId = null, allowUnknownChain = false) {
    const findMatches = (headers, quoteScope = null) => {
      const bindingFor = (header, scope = quoteScope) => {
        const headerBinding = elementChainBinding(header, chainId);
        if (headerBinding !== 'UNKNOWN' || !scope || scope === header) return headerBinding;
        return elementChainBinding(scope, chainId);
      };
      const directMatches = headers
        .filter((header) => elementHasTokenAddress(header, address, chainId))
        .map((header) => ({ header, chainBinding: bindingFor(header) }))
        .filter((item) => item.chainBinding === 'MATCH' || (allowUnknownChain && item.chainBinding === 'UNKNOWN'));
      if (directMatches.length === 1) {
        return [{
          header: directMatches[0].header,
          scope: directMatches[0].header,
          identityScope: directMatches[0].header,
          bindingScope: directMatches[0].header,
          quoteScope: quoteScope || directMatches[0].header,
          chainBound: directMatches[0].chainBinding === 'MATCH'
        }];
      }
      if (directMatches.length > 1) return [];

      const localMatches = [];
      for (const header of headers) {
        let bindingScope = header.parentElement;
        for (let depth = 1; depth <= 5 && bindingScope; depth += 1, bindingScope = bindingScope.parentElement) {
          const addressNode = localDetailAddressEvidence(header, bindingScope, address, chainId);
          if (!addressNode) continue;
          const chainBinding = bindingFor(header, bindingScope);
          if (chainBinding === 'MISMATCH' || (!allowUnknownChain && chainBinding === 'UNKNOWN')) continue;
          localMatches.push({
            header, scope: header, identityScope: bindingScope, bindingScope, addressNode,
            quoteScope: quoteScope || bindingScope, chainBound: chainBinding === 'MATCH'
          });
          break;
        }
      }
      return localMatches;
    };

    const baseInfoBars = Array.from(document.querySelectorAll('[data-sentry-component="BaseInfoBar"]'))
      .filter((bar) => bar.getAttribute?.('data-sentry-component') === 'BaseInfoBar');
    if (baseInfoBars.length) {
      const anchoredMatches = baseInfoBars.flatMap((bar) => findMatches(
        Array.from(bar.querySelectorAll?.('[data-sentry-component="TokenHeader"]') || []), bar
      ));
      return anchoredMatches.length === 1 ? anchoredMatches[0] : null;
    }

    const headers = Array.from(document.querySelectorAll('[data-sentry-component="TokenHeader"]'));
    const localMatches = findMatches(headers);
    return localMatches.length === 1 ? localMatches[0] : null;
  }

  function resolveCurrentTokenRead(previous, next, url = global.location?.href || '') {
    if (!isTokenDetailPage(url)) return null;
    const chain = chainFromUrl(url);
    const address = Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(url));
    const matchesRoute = (context) => context?.token?.chain === chain
      && Tango.Chains.validateAddress(chain, context?.token?.address)
      && Tango.Chains.normalizeAddress(chain, context.token.address) === address;
    const previousMatches = matchesRoute(previous);
    if (next && !matchesRoute(next)) return previousMatches ? previous : null;
    if (!next) return previousMatches ? previous : null;
    if (!previousMatches) return next;

    const metadataQuality = (token) => {
      if (token?.metadataVerified !== true) return 0;
      return ({
        GMGN_TRENCH: 2,
        GMGN_NETWORK: 3,
        GMGN_DETAIL: 4
      })[String(token.metadataSource || '').toUpperCase()] || 1;
    };
    const previousMetadataQuality = metadataQuality(previous.token);
    const nextMetadataQuality = metadataQuality(next.token);
    const nextHasQuote = Number(next.quote?.priceUsd) > 0 || Number(next.quote?.marketCapUsd) > 0;
    if (nextMetadataQuality <= previousMetadataQuality && !nextHasQuote) return previous;

    const token = nextMetadataQuality >= previousMetadataQuality
      ? {
        ...previous.token,
        ...Object.fromEntries(Object.entries(next.token || {}).filter(([field, value]) => (
          ['chain', 'address', 'metadataVerified', 'metadataSource'].includes(field)
          || (value != null && String(value).trim() !== '')
        )))
      }
      : previous.token;
    return {
      token,
      quote: nextHasQuote ? next.quote : previous.quote
    };
  }

  function needsCurrentTokenRead(current, url = global.location?.href || '') {
    if (!isTokenDetailPage(url)) return false;
    const chain = chainFromUrl(url);
    const address = Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(url));
    const currentAddress = current?.token?.chain === chain && Tango.Chains.validateAddress(chain, current?.token?.address)
      ? Tango.Chains.normalizeAddress(chain, current.token.address) : '';
    return !address || currentAddress !== address;
  }

  function detailTokenIdentity(scope, address, chainId = null) {
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
    if (!title || addressHintMatches(title, address, chainId)) return { symbol: 'TOKEN', name: 'Token' };
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
    if (nameCandidate && nameCandidate.length <= 100 && !addressHintMatches(nameCandidate, address, chainId)) {
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

  function exposedLaunchpadAddress(href, chain) {
    let parsed;
    try { parsed = new URL(href || '', global.location?.origin || 'https://gmgn.ai'); }
    catch { return ''; }
    const candidates = [
      ...parsed.pathname.split('/').filter(Boolean).reverse(),
      ...['address', 'token', 'ca'].map((key) => parsed.searchParams.get(key)).filter(Boolean)
    ];
    for (const candidate of candidates) {
      let decoded;
      try { decoded = decodeURIComponent(candidate); } catch { continue; }
      if (Tango.Chains.validateAddress(chain, decoded)) return Tango.Chains.normalizeAddress(chain, decoded);
    }
    return '';
  }

  function detailLaunchpad(scope, address, chain) {
    const normalizedAddress = Tango.Chains.normalizeAddress(chain, address);
    for (const link of scope?.querySelectorAll?.('a[href]') || []) {
      const href = link.href || link.getAttribute?.('href') || '';
      let parsed;
      try { parsed = new URL(href, global.location?.origin || 'https://gmgn.ai'); }
      catch { continue; }
      const launchpad = DETAIL_LAUNCHPADS.find((entry) => entry.pattern.test(parsed.hostname));
      if (!launchpad || exposedLaunchpadAddress(parsed.href, chain) !== normalizedAddress) continue;
      return launchpad.name;
    }
    return '';
  }

  function launchModeFromScope(scope, launchpad) {
    if (String(launchpad || '').toLowerCase().replace(/[^a-z0-9]/g, '') !== 'pumpfun') return '';
    const selector = [
      '[data-launch-mode]', '[data-token-launch-mode]',
      '[data-testid*="launch-mode" i]', '[data-testid*="mayhem" i]',
      '[data-sentry-component*="mayhem" i]', '[aria-label="Mayhem" i]',
      '[title="Mayhem" i]', '[class~="mayhem"]', '[class*="mayhem" i]'
    ].join(',');
    for (const element of scope?.querySelectorAll?.(selector) || []) {
      const value = element.getAttribute?.('data-launch-mode')
        || element.getAttribute?.('data-token-launch-mode')
        || element.getAttribute?.('aria-label')
        || element.getAttribute?.('title')
        || element.textContent
        || '';
      if (/^mayhem$/i.test(String(value).trim())) return 'Mayhem';
    }
    return '';
  }

  function detailQuote(detail, chain, address) {
    const quoteScope = detail?.quoteScope || detail?.bindingScope || detail?.scope;
    if (!quoteScope) return null;
    const priceUsd = findPrice(quoteScope);
    const baseInfo = baseInfoPriceView(quoteScope);
    const baseItems = baseInfo ? Array.from(baseInfo.querySelectorAll('[data-sentry-component="InfoItem"]')) : [];
    const unlabeledMarketCap = parseMoney(baseItems.find((item) => !item.querySelector('.info-item-title'))?.querySelector('.info-item-value')?.textContent);
    const labeledLiquidity = baseItems.find((item) => /^(池子|pool|liquidity)$/i.test(item.querySelector('.info-item-title')?.textContent?.trim() || ''));
    const marketCapUsd = unlabeledMarketCap
      || scanLabeledValue(['mc', 'market cap', 'mcap', '市值'], quoteScope)
      || (chain === 'sol' && /pump$/i.test(address) ? priceUsd * 1_000_000_000 : 0);
    const liquidityUsd = parseMoney(labeledLiquidity?.querySelector('.info-item-value')?.textContent)
      || scanLabeledValue(['liq', 'liquidity', '流动性', '池子', 'pool'], quoteScope);
    const declaredSupply = parseMoney(baseItems.find((item) => /^(total supply|\u603b\u4f9b\u5e94\u91cf)$/i
      .test(item.querySelector('.info-item-title')?.textContent?.trim() || ''))?.querySelector('.info-item-value')?.textContent)
      || scanLabeledValue(['total supply', '\u603b\u4f9b\u5e94\u91cf'], quoteScope);
    const launchpad = detailLaunchpad(quoteScope, address, chain);
    const launchMode = launchModeFromScope(quoteScope, launchpad);
    const observedAt = priceUsd > 0 || marketCapUsd > 0 || declaredSupply > 0 ? Date.now() : 0;
    const supply = Tango.Supply?.resolve?.({
      chain, address, launchpad, launchMode, marketCapUsd, priceUsd, totalSupply: declaredSupply,
      observedAt, source: 'GMGN', priceProvenance: priceUsd > 0 ? 'OBSERVED_PRICE' : '',
      supplySource: declaredSupply > 0 ? 'GMGN_EXACT' : ''
    }) || null;
    const marketCapDerived = !(priceUsd > 0) && Boolean(supply) && marketCapUsd > 0;
    const resolvedPriceUsd = marketCapDerived ? marketCapUsd / supply.totalSupply : priceUsd;
    return {
      priceUsd: resolvedPriceUsd, marketCapUsd, liquidityUsd, nativePriceUsd: 0,
      totalSupply: Number(supply?.totalSupply || 0), supplySource: supply?.source || '', launchpad, launchMode,
      valuationMode: marketCapDerived ? 'MARKET_CAP' : 'PRICE',
      priceProvenance: marketCapDerived ? 'MARKET_CAP_DERIVED' : (resolvedPriceUsd > 0 ? 'OBSERVED_PRICE' : ''),
      ...(marketCapDerived ? { marketCapDivisor: supply.totalSupply } : {}),
      source: 'GMGN', observedAt
    };
  }

  async function readCurrentToken() {
    if (!isTokenDetailPage()) return null;
    const chain = chainFromUrl();
    const rawAddress = tokenAddressFromUrl();
    if (!chain || !Tango.Chains.validateAddress(chain, rawAddress)) return null;
    const address = Tango.Chains.normalizeAddress(chain, rawAddress);
    const routeLabel = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const placeholder = readTrenchSnapshot(chain, address) || {
      token: {
        chain, address, symbol: routeLabel, name: routeLabel, logoUrl: '',
        metadataVerified: false, metadataSource: ''
      },
      quote: {}
    };
    let detail = findTokenDetailScope(address, chain, true);
    if (!detail) return placeholder;
    const firstIdentity = detailTokenIdentity(detail.identityScope || detail.scope, address, chain);
    const firstFingerprint = `${firstIdentity.symbol}\u0000${firstIdentity.name}\u0000${tokenLogo(detail.header)}`;
    await new Promise((resolve) => setTimeout(resolve, 48));
    if (chainFromUrl() !== chain || Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl()) !== address) return null;
    const confirmed = findTokenDetailScope(address, chain, true);
    if (!confirmed) return placeholder;
    const identity = detailTokenIdentity(confirmed.identityScope || confirmed.scope, address, chain);
    const fingerprint = `${identity.symbol}\u0000${identity.name}\u0000${tokenLogo(confirmed.header)}`;
    if (fingerprint !== firstFingerprint) return placeholder;
    if (lastVerifiedDetail?.address === address && lastVerifiedDetail.chain !== chain
      && !confirmed.chainBound && lastVerifiedDetail.fingerprint === fingerprint) return placeholder;
    detail = confirmed;
    const quote = detailQuote(detail, chain, address);
    if (!quote) return placeholder;
    const result = {
      token: {
        chain, address, symbol: identity.symbol, name: identity.name, logoUrl: tokenLogo(detail.header),
        launchpad: quote.launchpad, launchMode: quote.launchMode,
        metadataVerified: true, metadataSource: 'GMGN_DETAIL'
      },
      quote
    };
    lastVerifiedDetail = { chain, address, fingerprint };
    return result;
  }

  function isTrenchPage(url = global.location?.href || '') {
    const parsed = new URL(url);
    const chain = Tango.Chains.fromUrl(url);
    return parsed.hostname === 'gmgn.ai' && (parsed.pathname === '/' || parsed.pathname === '') && Boolean(chain?.capabilities.trench);
  }

  function isTokenDetailPage(url = global.location?.href || '') {
    const chain = Tango.Chains.fromUrl(url);
    if (!chain) return false;
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== chain.gmgnSlug || parts[1].toLowerCase() !== 'token') return false;
    let address;
    try { address = decodeURIComponent(parts[2]); } catch { return false; }
    return Tango.Chains.validateAddress(chain.id, address);
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
    return /(?:\.{3}|…)/.test(text) || /^0x[a-fA-F0-9]{40}$/.test(text) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
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

  function cardIdentityFromText(text, expectedAddress = '', chainId = null) {
    const lines = String(text || '').split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const addressIndex = expectedAddress
      ? lines.findIndex((line) => addressHintMatches(line, expectedAddress, chainId))
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

  function cardTokenIdentity(card, expectedAddress = '', chainId = null) {
    const fromCard = cardIdentityFromText(card?.innerText || card?.textContent || '', expectedAddress, chainId);
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

  function verifiedCardMetadata(card, address, chainId = null) {
    const chain = chainId
      ? Tango.Chains.get(chainId)
      : Tango.Chains.all().find((candidate) => Tango.Chains.validateAddress(candidate.id, address));
    if (!chain || !Tango.Chains.validateAddress(chain.id, address)) return null;
    const identity = cardTokenIdentity(card, address, chain.id);
    if (!identity) return null;
    const launchpad = cardLaunchpad(card, address, chain.id);
    return {
      ...identity, logoUrl: cardTokenLogo(card),
      launchpad, launchMode: launchModeFromScope(card, launchpad)
    };
  }

  function cardLaunchpad(card, address, chain) {
    const normalizedAddress = Tango.Chains.normalizeAddress(chain, address);
    for (const link of card?.querySelectorAll?.('a[href]') || []) {
      let parsed;
      try { parsed = new URL(link.href || link.getAttribute?.('href') || '', global.location?.origin); }
      catch { continue; }
      const match = CARD_LAUNCHPADS.find((entry) => entry.pattern.test(parsed.hostname));
      if (!match) continue;
      const exposed = exposedLaunchpadAddress(parsed.href, chain);
      if (!exposed || exposed !== normalizedAddress) continue;
      return match.name;
    }
    return '';
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

  function normalizedCardHref(value, activeChainId) {
    if (!value) return '';
    let parsed;
    try { parsed = new URL(value, global.location?.origin || 'https://gmgn.ai'); }
    catch { return ''; }
    const address = tokenAddressFromUrl(parsed.href);
    if (parsed.hostname === 'pump.fun') {
      return activeChainId === 'sol' && Tango.Chains.validateAddress('sol', address) ? parsed.href : '';
    }
    const routeChain = chainFromUrl(parsed.href);
    if (!routeChain || routeChain !== activeChainId || !isTokenDetailPage(parsed.href)) return '';
    return parsed.href;
  }

  function cardTokenHref(card, activeChainId = chainFromUrl()) {
    if (!activeChainId) return '';
    const directHref = normalizedCardHref(card?.getAttribute?.('href'), activeChainId);
    if (directHref) return directHref;
    const lines = String(card?.innerText || card?.textContent || '').split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const candidates = Array.from(card?.querySelectorAll?.('a[href*="/token/"], a[href*="pump.fun/coin/"]') || [])
      .map((link) => {
        const href = normalizedCardHref(link.href || link.getAttribute?.('href') || '', activeChainId);
        const address = href ? tokenAddressFromUrl(href) : '';
        return { href, address, addressIndex: lines.findIndex((line) => addressHintMatches(line, address, activeChainId)) };
      })
      .filter((candidate) => candidate.address && candidate.addressIndex >= 0)
      .sort((left, right) => left.addressIndex - right.addressIndex);
    return candidates[0]?.href || '';
  }

  function cardMarketSnapshot(card, chain, address, token = {}) {
    const marketCapUsd = cardMarketCap(card?.innerText || card?.textContent || '');
    const supply = Tango.Supply?.resolve?.({
      chain, launchpad: token.launchpad, launchMode: token.launchMode, marketCapUsd, priceUsd: 0
    }) || null;
    const provisionalSupply = !supply && marketCapUsd > 0 ? 1_000_000_000 : 0;
    const valuationSupply = Number(supply?.totalSupply || provisionalSupply || 0);
    const priceUsd = valuationSupply > 0 ? marketCapUsd / valuationSupply : 0;
    return {
      priceUsd,
      marketCapUsd, liquidityUsd: 0, nativePriceUsd: 0,
      totalSupply: Number(supply?.totalSupply || 0), supplySource: supply?.source || '',
      provisionalSupply,
      provisional: provisionalSupply > 0,
      syntheticTokenPrice: provisionalSupply > 0,
      valuationMode: supply ? 'MARKET_CAP' : 'PRICE',
      priceProvenance: provisionalSupply > 0 ? 'SYNTHETIC_PRICE'
        : (supply ? 'MARKET_CAP_DERIVED' : ''),
      ...(supply ? { marketCapDivisor: supply.totalSupply } : {}),
      source: 'GMGN_TRENCH', observedAt: marketCapUsd > 0 ? Date.now() : 0
    };
  }

  function quickBuySize(height) {
    if (height >= 45) return 'giant';
    if (height >= 37) return 'extra-large';
    if (height >= 29) return 'large';
    return height > 0 ? 'small' : '';
  }

  function syncQuickBuyGeometry(slot, nativeControl = null) {
    const binding = slot?.__tangoQuickBuyBinding;
    const replacement = binding?.replacement || slot?.__tangoReplacementQuickBuy
      || slot?.querySelector?.('.tango-list-quick-buy');
    if (!slot || !replacement?.isConnected) return false;
    const slotRect = slot.getBoundingClientRect?.() || {};
    const nativeRect = nativeControl?.getBoundingClientRect?.() || {};
    const height = Number(nativeRect.height || slotRect.height || 0);
    const width = Number(nativeRect.width || slotRect.width || 0);
    if (!(height > 0) || !(width > 0)) return false;
    replacement.style.height = `${Math.max(22, Math.round(height))}px`;
    replacement.style.width = '100%';
    slot.dataset.tangoQuickSize = quickBuySize(height);
    slot.classList.toggle('tango-quick-expanded', height >= 36);
    slot.classList.toggle('tango-quick-narrow', width <= 72);
    return true;
  }

  function scheduleQuickBuyGeometryRepair(slot) {
    const binding = slot?.__tangoQuickBuyBinding;
    if (!binding || binding.repairTimer || binding.repairAttempts >= 3) return;
    binding.repairAttempts += 1;
    binding.repairTimer = global.setTimeout?.(() => {
      binding.repairTimer = null;
      if (slot.__tangoQuickBuyBinding !== binding || !slot.isConnected) return;
      if (!syncQuickBuyGeometry(slot)) scheduleQuickBuyGeometryRepair(slot);
    }, 250);
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
    const chain = chainFromUrl();
    if (!chain) return [];
    const requested = new Set((addresses || [])
      .filter((address) => Tango.Chains.validateAddress(chain, address))
      .map((address) => Tango.Chains.normalizeAddress(chain, address)));
    if (!requested.size) return [];
    const found = new Map();
    const cards = document.querySelectorAll('[class~="group/a"]');
    for (const card of cards) {
      if (found.size >= requested.size) break;
      const href = cardTokenHref(card, chain);
      if (!href) continue;
      const address = tokenAddressFromUrl(href);
      const normalized = Tango.Chains.validateAddress(chain, address) ? Tango.Chains.normalizeAddress(chain, address) : '';
      if (!requested.has(normalized) || found.has(normalized)) continue;
      if (!trenchColumn(card)) continue;
      const metadata = verifiedCardMetadata(card, address, chain);
      if (!metadata) continue;
      const token = {
        chain, address: normalized,
        symbol: metadata.symbol, name: metadata.name, logoUrl: metadata.logoUrl,
        launchpad: metadata.launchpad, launchMode: metadata.launchMode,
        metadataVerified: true, metadataSource: 'GMGN_TRENCH'
      };
      rememberTrenchSnapshot({ token, quote: cardMarketSnapshot(card, chain, normalized, token) });
      found.set(normalized, token);
    }
    return [...found.values()];
  }

  function quickBuySlots(roots) {
    if (!Array.isArray(roots) || !roots.length) {
      return Array.from(document.querySelectorAll('.BuyButton-continer'));
    }
    const slots = new Set();
    for (const root of roots) {
      if (root?.matches?.('.BuyButton-continer')) slots.add(root);
      root?.querySelectorAll?.('.BuyButton-continer').forEach((slot) => slots.add(slot));
      const closest = root?.closest?.('.BuyButton-continer');
      if (closest) slots.add(closest);
      const card = root?.closest?.('[class~="group/a"]');
      const scope = card || root?.closest?.('[data-sentry-component="TrenchColumn"]');
      scope?.querySelectorAll?.('.BuyButton-continer').forEach((slot) => slots.add(slot));
    }
    return [...slots];
  }

  function cleanupDisconnectedQuickBuySlots(roots) {
    const candidates = Array.isArray(roots) && roots.length
      ? quickBuySlots(roots)
      : [...trackedQuickBuySlots];
    for (const slot of candidates) {
      if (!trackedQuickBuySlots.has(slot)) continue;
      const binding = slot?.__tangoQuickBuyBinding;
      if (!slot?.isConnected || !binding?.card?.isConnected || !binding?.replacement?.isConnected) {
        restoreQuickBuySlot(slot, false);
      }
    }
  }

  function quickBuyBindingMatches(slot, binding, chain = chainFromUrl()) {
    if (!binding || !slot?.isConnected || !binding.card?.isConnected || chain !== binding.chain) return false;
    if (slot.closest?.('[class~="group/a"]') !== binding.card) return false;
    const href = cardTokenHref(binding.card, chain);
    const address = href ? Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(href)) : '';
    return address === binding.address;
  }

  function observeQuickBuySlot(slot, binding) {
    if (typeof global.ResizeObserver === 'function') {
      binding.resizeObserver = new global.ResizeObserver(() => {
        if (slot.__tangoQuickBuyBinding !== binding) return;
        if (!syncQuickBuyGeometry(slot)) scheduleQuickBuyGeometryRepair(slot);
      });
      binding.resizeObserver.observe(slot);
    } else {
      global.requestAnimationFrame?.(() => {
        if (slot.__tangoQuickBuyBinding === binding && !syncQuickBuyGeometry(slot)) {
          scheduleQuickBuyGeometryRepair(slot);
        }
      });
    }
  }

  function removeDuplicatePaperControls(slot, replacement) {
    for (const control of slot.querySelectorAll?.('.tango-list-quick-buy') || []) {
      if (control !== replacement) control.remove?.();
    }
  }

  function discoverTokenCards(onQuickBuy, defaultAmountSol = 0.1, paperLabel = 'PAPER', roots) {
    cleanupDisconnectedQuickBuySlots(roots);
    const incremental = Array.isArray(roots) && roots.length > 0;
    if (!isTrenchPage()) {
      if (!incremental) clearQuickBuy();
      return 0;
    }
    const chain = chainFromUrl();
    const chainDefinition = Tango.Chains.get(chain);
    if (!chainDefinition) return 0;
    const nativeSlots = quickBuySlots(roots);
    if (!incremental) {
      const candidateSlots = new Set(nativeSlots);
      document.querySelectorAll('.tango-native-buy-overridden').forEach((slot) => {
        if (!candidateSlots.has(slot)) restoreQuickBuySlot(slot, true);
      });
    }
    let injected = 0;
    for (const slot of nativeSlots) {
      if (!slot?.isConnected) {
        restoreQuickBuySlot(slot, false);
        continue;
      }
      const card = slot.closest?.('[class~="group/a"]');
      if (!card?.isConnected || !trenchColumn(card)) {
        if (slot.dataset.tangoQuickBuy === '1') restoreQuickBuySlot(slot, true);
        continue;
      }
      const href = cardTokenHref(card, chain);
      if (!href) {
        if (slot.dataset.tangoQuickBuy === '1') restoreQuickBuySlot(slot, true);
        continue;
      }
      const address = Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(href));
      const existingBinding = slot.__tangoQuickBuyBinding;
      const existingReplacement = existingBinding?.replacement || slot.querySelector('.tango-list-quick-buy');
      let nativeControl = slot.querySelector('[data-testid="quickbuy"]');
      const amountSol = cardQuickBuyAmount(card, nativeControl, slot, defaultAmountSol);
      const metadata = Tango.Chains.validateAddress(chain, address)
        ? verifiedCardMetadata(card, address, chain) : null;
      if (!Tango.Chains.validateAddress(chain, address) || !(amountSol > 0)
        || !metadata) {
        if (slot.dataset.tangoQuickBuy === '1') restoreQuickBuySlot(slot, true);
        continue;
      }
      const snapshotToken = {
        chain, address, symbol: metadata.symbol, name: metadata.name, logoUrl: metadata.logoUrl,
        launchpad: metadata.launchpad || (chain === 'sol' && /pump$/i.test(address) ? 'Pump.fun' : ''),
        launchMode: metadata.launchMode || '', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
      };
      rememberTrenchSnapshot({ token: snapshotToken, quote: cardMarketSnapshot(card, chain, address, snapshotToken) });
      const bindingKey = `${chain}:${address}`;
      if (existingBinding?.replacement?.isConnected && existingBinding.key === bindingKey
        && Number(existingBinding.amountNative) === amountSol && existingBinding.paperLabel === paperLabel
        && existingBinding.card === card) {
        // GMGN can reconcile the original control back into the slot. Remove it again fail-closed.
        syncQuickBuyGeometry(slot, nativeControl);
        if (nativeControl) nativeControl.remove();
        removeDuplicatePaperControls(slot, existingBinding.replacement);
        continue;
      }
      const preservedNativeControl = existingBinding?.nativeControl
        && !existingBinding.nativeControl.isConnected
        && quickBuyBindingMatches(slot, existingBinding, chain)
        ? existingBinding.nativeControl : null;
      if (existingBinding) restoreQuickBuySlot(slot, false);
      if (!nativeControl) nativeControl = preservedNativeControl || slot.querySelector('[data-testid="quickbuy"]');
      if (!nativeControl && !existingReplacement) continue;
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.className = 'tango-list-quick-buy';
      replacement.dataset.tangoQuickBuy = '1';
      replacement.dataset.tangoPaperAction = 'quick-buy';
      const actionId = `tango-paper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      replacement.dataset.tangoActionId = actionId;
      replacement.title = `Tango Paper Buy ${amountSol} ${chainDefinition.nativeSymbol}`;
      replacement.setAttribute('aria-label', `Tango Paper Buy ${amountSol} ${chainDefinition.nativeSymbol}`);
      const hint = document.createElement('span');
      hint.className = 'tango-paper-hint';
      hint.textContent = paperLabel;
      const amount = document.createElement('span');
      amount.className = 'tango-buy-amount';
      amount.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m13.688 8.12-6.471 7.705c-.206.245-.604.061-.55-.255l1.007-5.843-4.617-.061c-.88-.012-1.352-1.038-.79-1.714L8.723.191c.205-.247.605-.063.55.253L8.247 6.399l4.641.003c.888.001 1.371 1.038.8 1.718Z"/></svg><span>' + amountSol + ' ' + chainDefinition.nativeSymbol + '</span>';
      replacement.append(hint, amount);
      const handleClick = async () => {
        const binding = slot.__tangoQuickBuyBinding;
        if (!slot.isConnected || !card.isConnected || !replacement.isConnected
          || binding?.actionId !== actionId || binding?.key !== bindingKey) return;
        const now = Date.now();
        if (replacement.disabled || now - Number(replacement.dataset.tangoLastClickAt || 0) < 900) return;
        replacement.dataset.tangoLastClickAt = String(now);
        replacement.disabled = true;
        try {
          if (chainFromUrl() !== chain) return;
          const activeHref = cardTokenHref(card, chain);
          const activeAddress = activeHref ? Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(activeHref)) : null;
          if (activeAddress !== address || !verifiedCardMetadata(card, address, chain)) return;
          const latestHref = cardTokenHref(card, chain);
          const latestAddress = latestHref ? Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(latestHref)) : null;
          if (latestAddress !== address) return;
          const clickMetadata = verifiedCardMetadata(card, address, chain);
          if (!clickMetadata) return;
          if (chainFromUrl() !== chain) return;
          const token = {
            chain, address, symbol: clickMetadata.symbol, name: clickMetadata.name, logoUrl: clickMetadata.logoUrl,
            launchpad: clickMetadata.launchpad || (chain === 'sol' && /pump$/i.test(address) ? 'Pump.fun' : ''),
            launchMode: clickMetadata.launchMode || '', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
          };
          const quote = cardMarketSnapshot(card, chain, address, token);
          rememberTrenchSnapshot({ token, quote });
          await onQuickBuy({
            actionId, token: { ...token }, quote: { ...quote }, amountNative: amountSol, amountSol,
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
      slot.dataset.tangoBindingKey = bindingKey;
      slot.__tangoOriginalQuickBuy = nativeControl;
      slot.__tangoReplacementQuickBuy = replacement;
      slot.__tangoQuickBuyCard = card;
      slot.__tangoQuickBuyHandler = handleClick;
      const binding = {
        key: bindingKey, chain, address, card, nativeControl, replacement, actionId,
        amountNative: amountSol, paperLabel, repairAttempts: 0, repairTimer: null, resizeObserver: null
      };
      slot.__tangoQuickBuyBinding = binding;
      quickBuyActions.set(actionId, handleClick);
      trackedQuickBuySlots.add(slot);
      if (existingReplacement?.isConnected) existingReplacement.replaceWith(replacement);
      else if (nativeControl?.isConnected) nativeControl.replaceWith(replacement);
      else slot.appendChild?.(replacement);
      if (nativeControl?.isConnected) nativeControl.remove();
      removeDuplicatePaperControls(slot, replacement);
      if (!syncQuickBuyGeometry(slot, nativeControl)) scheduleQuickBuyGeometryRepair(slot);
      observeQuickBuySlot(slot, binding);
      injected += 1;
    }
    return injected;
  }

  function clearQuickBuy() {
    [...trackedQuickBuySlots].forEach((slot) => restoreQuickBuySlot(slot, true));
    document.querySelectorAll('.tango-native-buy-overridden').forEach((slot) => {
      restoreQuickBuySlot(slot, true);
    });
    document.querySelectorAll('.tango-list-quick-buy').forEach((element) => element.remove());
  }

  function restoreQuickBuySlot(slot, restoreCurrent = true) {
    const binding = slot?.__tangoQuickBuyBinding;
    const replacement = binding?.replacement || slot?.__tangoReplacementQuickBuy;
    const original = binding?.nativeControl || slot?.__tangoOriginalQuickBuy;
    trackedQuickBuySlots.delete(slot);
    quickBuyActions.delete(String(binding?.actionId || slot?.dataset?.tangoActionId || ''));
    if (binding?.repairTimer) global.clearTimeout?.(binding.repairTimer);
    binding?.resizeObserver?.unobserve?.(slot);
    binding?.resizeObserver?.disconnect?.();
    const canRestore = restoreCurrent && replacement?.isConnected && original && !original.isConnected
      && !slot.querySelector?.('[data-testid="quickbuy"]') && quickBuyBindingMatches(slot, binding);
    if (canRestore) replacement.replaceWith(original);
    else replacement?.remove?.();
    delete slot.__tangoQuickBuyBinding;
    delete slot.__tangoOriginalQuickBuy;
    delete slot.__tangoReplacementQuickBuy;
    delete slot.__tangoQuickBuyCard;
    delete slot.__tangoQuickBuyHandler;
    slot.classList.remove('tango-native-buy-overridden', 'tango-quick-expanded', 'tango-quick-narrow');
    delete slot.dataset.tangoQuickBuy;
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoAmountSol;
    delete slot.dataset.tangoPaperLabel;
    delete slot.dataset.tangoActionId;
    delete slot.dataset.tangoBindingKey;
    delete slot.dataset.tangoQuickSize;
  }

  Tango.GMGN = {
    chainFromUrl, tokenAddressFromUrl, parseMoney, readCurrentToken, readVisibleTokenMetadata, discoverTokenCards, clearQuickBuy,
    rememberTrenchSnapshot, readTrenchSnapshot,
    resolveCurrentTokenRead, needsCurrentTokenRead,
    _cardMarketCap: cardMarketCap, _cardSymbol: cardSymbol, _tokenIdentityFromText: tokenIdentityFromText,
    _cardIdentityFromText: cardIdentityFromText, _addressHintMatches: addressHintMatches,
    _cardTokenLogo: cardTokenLogo, _cardTokenHref: cardTokenHref,
    _cardLaunchpad: cardLaunchpad, _verifiedCardMetadata: verifiedCardMetadata, _detailTokenIdentity: detailTokenIdentity,
    _findTokenDetailScope: findTokenDetailScope, _tokenLogo: tokenLogo,
    _resolveCurrentTokenRead: resolveCurrentTokenRead, _needsCurrentTokenRead: needsCurrentTokenRead,
    _selectQuickBuyAmount: selectQuickBuyAmount,
    _isTrenchPage: isTrenchPage,
    _isTokenDetailPage: isTokenDetailPage,
    _clearTrenchSnapshots: () => trenchSnapshots.clear()
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGN;
})(globalThis);
