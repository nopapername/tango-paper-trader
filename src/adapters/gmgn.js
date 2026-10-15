(function initGmgnAdapter(global) {
  const Tango = global.Tango = global.Tango || {};
  const quickBuyIntents = new Map();
  const quickBuyCardGenerations = new WeakMap();
  let quickBuyCardBirths = new WeakMap();
  let quickBuySeenTokenRoots = new WeakSet();
  const quickBuyOperations = new Map();
  const quickBuySlotIdentities = new WeakMap();
  const trackedQuickBuySlots = new Set();
  const trenchColumns = new WeakMap();
  const trenchSnapshots = new Map();
  const MAX_TRENCH_SNAPSHOTS = 200;
  const QUICK_BUY_IDENTITY_INTENT_TTL_MS = 300;
  const FDV_MARKET_CAP_TOLERANCE = 2;
  let lastVerifiedDetail = null;
  let quickBuyProbeCursor = 0;
  let quickBuyGenerationSequence = 0;
  let quickBuyNonceSequence = 0;
  let quickBuySlotIdentitySequence = 0;
  const TOKEN_ITEM_ROOT_SELECTOR =
    '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]';
  const FAST_QUICK_BUY_SLOT_LIMIT = 24;
  let chartTrustByFrame = new WeakMap();
  const CHART_FRAME_SELECTOR = 'iframe[title="Financial Chart"], iframe[title="TradingView"], [data-sentry-component="TradingView"] iframe';

  function cardGeneration(card) {
    if (!quickBuyCardGenerations.has(card)) {
      quickBuyCardGenerations.set(card, ++quickBuyGenerationSequence);
    }
    return quickBuyCardGenerations.get(card);
  }

  function advanceCardGeneration(card) {
    const generation = ++quickBuyGenerationSequence;
    if (card) quickBuyCardGenerations.set(card, generation);
    return generation;
  }

  function nextBindingNonce(generation) {
    return `${generation}-${++quickBuyNonceSequence}`;
  }

  function createQuickBuyGeneration({ card }) {
    const generation = cardGeneration(card);
    return { generation, bindingNonce: nextBindingNonce(generation) };
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

  function chartRouteKey(chain, address) {
    if (!chain || !Tango.Chains.validateAddress(chain, address)) return '';
    return `${chain}:${Tango.Chains.normalizeAddress(chain, address)}`;
  }

  function currentChartRouteKey() {
    const chain = chainFromUrl();
    let address = '';
    try { address = tokenAddressFromUrl(); } catch { return ''; }
    return chartRouteKey(chain, address);
  }

  function liveChartFrames() {
    return Array.from(global.document?.querySelectorAll?.(CHART_FRAME_SELECTOR) || []);
  }

  function markChartFrameReady(frame, token) {
    const key = chartRouteKey(token?.chain, token?.address || token?.tokenAddress);
    if (!frame || frame.isConnected === false || !key || key !== currentChartRouteKey()
      || !liveChartFrames().includes(frame)) return false;
    chartTrustByFrame.set(frame, { key });
    return true;
  }

  function invalidateChartFrame(frame) {
    if (frame) chartTrustByFrame.delete(frame);
  }

  function clearChartTrust() {
    chartTrustByFrame = new WeakMap();
  }

  function hasTrustedChart(chain, address) {
    const key = chartRouteKey(chain, address);
    if (!key || key !== currentChartRouteKey()) return false;
    return liveChartFrames().some((frame) => frame?.isConnected !== false
      && chartTrustByFrame.get(frame)?.key === key);
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

  function parseUsdMoney(text) {
    const match = String(text || '').match(/(?:US)?\$[ \t]{0,3}(0\.0[\u2080-\u2089]\d+|[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?\s*[KMBT]?)/i);
    return match ? parseMoney(match[1]) : 0;
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

  function scanLabeledUsdValue(labels, root) {
    const normalized = labels.map((label) => label.toLowerCase());
    const nodes = root?.querySelectorAll?.('span,div,p') || [];
    const limit = Math.min(nodes.length, 2500);
    for (let index = 0; index < limit; index += 1) {
      const element = nodes[index];
      const ownText = element.childElementCount === 0 ? element.textContent?.trim() : '';
      if (!ownText || ownText.length > 28) continue;
      const lower = ownText.toLowerCase();
      if (!normalized.some((label) => lower === label || lower.startsWith(`${label}:`))) continue;
      const inline = parseUsdMoney(ownText.replace(/^[^:$]*:?/, ''));
      if (inline > 0) return inline;
      const adjacent = parseUsdMoney(element.nextElementSibling?.textContent);
      if (adjacent > 0) return adjacent;
    }
    return 0;
  }

  function baseInfoPriceView(root) {
    if (root?.getAttribute?.('data-sentry-component') === 'BaseInfoPriceView') return root;
    return root?.querySelector?.('[data-sentry-component="BaseInfoPriceView"]') || null;
  }

  function usdPriceValue(text) {
    const value = String(text || '').trim();
    // Older verified headers omit the dollar sign. A native-unit suffix is
    // never a USD observation, including while GMGN changes quote selection.
    if (/^(?:0\.0[₀-₉]\d+|[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?)$/.test(value)) {
      return parseMoney(value);
    }
    return /^(?:US)?\$/.test(value) ? parseUsdMoney(value) : 0;
  }

  function findPrice(root) {
    const baseInfo = baseInfoPriceView(root);
    if (baseInfo) {
      const priceItem = Array.from(baseInfo.querySelectorAll('[data-sentry-component="InfoItem"]')).find((item) =>
        /^(价格|price)$/i.test(item.querySelector('.info-item-title')?.textContent?.trim() || '')
      );
      if (priceItem) return usdPriceValue(priceItem.querySelector('.info-item-value')?.textContent);
    }
    const direct = firstText([
      '[data-testid="token-price"]', '[data-testid*="price"]', '[data-token-price]',
      '[class*="token-price"]', '[class*="TokenPrice"]', '[class*="price_usd"]'
    ], root);
    const directValue = usdPriceValue(direct?.text);
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

  function isQuoteTokenIdentityNode(node) {
    let current = node;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      if (current.getAttribute?.('data-testid') === 'quote-token-tag') return true;
      if (String(current.tagName || '').toUpperCase() === 'A'
        && current.querySelector?.('[data-testid="quote-token-tag"]')) return true;
    }
    return false;
  }

  function detailIdentityText(element) {
    const quoteLinks = Array.from(element?.querySelectorAll?.('a[href]') || [])
      .filter(isQuoteTokenIdentityNode);
    let text = String(element?.textContent || '');
    quoteLinks.forEach((link) => {
      const quoteText = String(link.textContent || '');
      if (quoteText) text = text.split(quoteText).join('');
    });
    return text;
  }

  function elementHasTokenAddress(element, address, chainId = null) {
    if (!element) return false;
    const text = detailIdentityText(element);
    // Avoid accepting a page-wide ancestor merely because another widget happens
    // to contain the new route address while GMGN is still rendering the old header.
    if (text.length <= 4_000 && addressHintMatches(text, address, chainId)) return true;
    const nodes = [element, ...Array.from(element.querySelectorAll?.('a[href], [title], [data-addr], [data-address], [data-token-address], [data-mint], [data-ca]') || []).slice(0, 80)];
    const caseInsensitive = !chainId || Tango.Chains.get(chainId)?.addressFamily === 'EVM';
    return nodes.filter((node) => !isQuoteTokenIdentityNode(node)).some((node) => ['href', 'title', 'data-addr', 'data-address', 'data-token-address', 'data-mint', 'data-ca']
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
    const attributeNodes = Array.from(scope.querySelectorAll?.('[data-addr], [data-address], [data-token-address], [data-mint], [data-ca]') || []);
    const evidence = [];
    leafNodes.forEach((node) => {
      if (isQuoteTokenIdentityNode(node)) return;
      const hint = visibleAddressHint(node.textContent, chainId);
      if (hint) evidence.push({ node, hint });
    });
    attributeNodes.forEach((node) => {
      if (isQuoteTokenIdentityNode(node)) return;
      ['data-addr', 'data-address', 'data-token-address', 'data-mint', 'data-ca'].forEach((attribute) => {
        const hint = visibleAddressHint(node.getAttribute?.(attribute), chainId);
        if (hint) evidence.push({ node, hint });
      });
    });
    if (!evidence.length || evidence.some((item) => !addressHintMatches(item.hint, address, chainId))) return null;

    const addressNode = evidence.find((item) => addressHintMatches(item.hint, address, chainId))?.node;
    const distance = distanceToAncestor(header, scope) + distanceToAncestor(addressNode, scope);
    if (!addressNode || distance > 8) return null;

    const linkedAddresses = Array.from(scope.querySelectorAll?.('a[href*="/token/"], a[href*="pump.fun/coin/"]') || [])
      .filter((node) => !isQuoteTokenIdentityNode(node))
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
      .filter((node) => !isQuoteTokenIdentityNode(node))
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
    if (nextMetadataQuality < previousMetadataQuality && !nextHasQuote) return previous;

    const metadataCompleteness = (field, value) => {
      if (value == null || String(value).trim() === '') return 0;
      const placeholder = ['TOKEN', 'UNKNOWN', 'N/A', 'NA', '-', '--'].includes(String(value).trim().toUpperCase());
      return ['symbol', 'name'].includes(field) && placeholder ? 0 : 1;
    };
    const token = nextMetadataQuality >= previousMetadataQuality
      ? Object.entries(next.token || {}).reduce((merged, [field, value]) => {
        const nextCompleteness = metadataCompleteness(field, value);
        const shouldUpgrade = nextMetadataQuality > previousMetadataQuality
          ? nextCompleteness > 0
          : nextCompleteness > metadataCompleteness(field, previous.token?.[field]);
        if (['chain', 'address'].includes(field) || shouldUpgrade) merged[field] = value;
        return merged;
      }, { ...previous.token })
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

  function coherentCanonicalUsdQuote(detail, chain, address, items) {
    const scope = detail?.quoteScope;
    if (detail?.chainBound !== true
      || scope?.getAttribute?.('data-sentry-component') !== 'BaseInfoBar') return null;
    if (Array.from(scope.querySelectorAll?.('[data-sentry-component="BaseInfoPriceView"]') || []).length !== 1) return null;
    const canonical = Array.from(scope.querySelectorAll?.('#token-base-address[data-addr]') || []);
    const fullAddress = canonical.length === 1 && !isQuoteTokenIdentityNode(canonical[0])
      ? canonical[0].getAttribute('data-addr') : '';
    if (!Tango.Chains.validateAddress(chain, fullAddress)
      || Tango.Chains.normalizeAddress(chain, fullAddress) !== address) return null;
    const title = (item) => item.querySelector('.info-item-title')?.textContent?.trim() || '';
    const value = (item) => String(item.querySelector('.info-item-value')?.textContent || '').trim();
    const prices = items.filter((item) => /^(价格|price)$/i.test(title(item)));
    const supplies = items.filter((item) => /^(total supply|总供应量)$/i.test(title(item)));
    const caps = items.filter((item) => /^(mc|mcap|market cap|市值)$/i.test(title(item)));
    const unlabeled = items.filter((item) => !title(item));
    // The live BaseInfoPriceView renders its primary MC item without a title.
    // Accept that specific slot only when it is the sole unlabeled item.
    const cap = caps.length === 1 && unlabeled.length === 0 ? caps[0]
      : caps.length === 0 && unlabeled.length === 1 && items[0] === unlabeled[0] ? unlabeled[0] : null;
    if (prices.length !== 1 || supplies.length !== 1 || !cap) return null;
    const numeric = '(?:0\\.0[\u2080-\u2089]\\d+|(?:(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d+)?|\\.\\d+)(?:[eE][-+]?\\d+)?\\s*[KMBT]?)';
    const usdPattern = new RegExp(`^(?:US)?\\$\\s*${numeric}$`, 'i');
    const supplyPattern = new RegExp(`^${numeric}$`, 'i');
    if (!usdPattern.test(value(prices[0])) || !usdPattern.test(value(cap))
      || !supplyPattern.test(value(supplies[0]))) return null;
    const priceUsd = parseUsdMoney(value(prices[0]));
    const totalSupply = parseMoney(value(supplies[0]));
    const marketCapUsd = parseUsdMoney(value(cap));
    const impliedMarketCap = priceUsd * totalSupply;
    if (![priceUsd, totalSupply, marketCapUsd, impliedMarketCap].every((number) => Number.isFinite(number) && number > 0)
      || Math.abs(impliedMarketCap - marketCapUsd) > Math.min(impliedMarketCap, marketCapUsd) * 0.01) return null;
    return { priceUsd, totalSupply };
  }

  function detailQuote(detail, chain, address) {
    const quoteScope = detail?.quoteScope || detail?.bindingScope || detail?.scope;
    if (!quoteScope) return null;
    const hasKline = hasTrustedChart(chain, address);
    const baseInfo = baseInfoPriceView(quoteScope);
    const baseItems = baseInfo ? Array.from(baseInfo.querySelectorAll('[data-sentry-component="InfoItem"]')) : [];
    const canonicalUsd = !hasKline ? coherentCanonicalUsdQuote(detail, chain, address, baseItems) : null;
    const priceUsd = hasKline ? findPrice(quoteScope) : Number(canonicalUsd?.priceUsd || 0);
    const itemTitle = (item) => item?.querySelector('.info-item-title')?.textContent?.trim() || '';
    const itemValue = (item) => item?.querySelector('.info-item-value')?.textContent || '';
    const explicitMarketCap = parseUsdMoney(itemValue(baseItems.find((item) =>
      /^(mc|mcap|market cap|市值)$/i.test(itemTitle(item))
    )));
    const legacyMarketCap = parseUsdMoney(itemValue(baseItems.find((item) => !itemTitle(item))));
    const labeledLiquidity = baseItems.find((item) => /^(池子|pool|liquidity)$/i.test(item.querySelector('.info-item-title')?.textContent?.trim() || ''));
    const marketCapCandidate = explicitMarketCap
      || legacyMarketCap
      || (!baseInfo ? scanLabeledUsdValue(['mc', 'mcap', 'market cap', '市值'], quoteScope) : 0);
    const liquidityUsd = parseMoney(labeledLiquidity?.querySelector('.info-item-value')?.textContent)
      || scanLabeledValue(['liq', 'liquidity', '流动性', '池子', 'pool'], quoteScope);
    const declaredSupply = parseMoney(itemValue(baseItems.find((item) => /^(total supply|\u603b\u4f9b\u5e94\u91cf)$/i
      .test(itemTitle(item)))));
    const exactSupply = hasKline ? declaredSupply : Number(canonicalUsd?.totalSupply || 0);
    const fullyDilutedValue = priceUsd > 0 && exactSupply > 0 ? priceUsd * exactSupply : 0;
    const marketCapUsd = fullyDilutedValue > 0 && marketCapCandidate > fullyDilutedValue * FDV_MARKET_CAP_TOLERANCE
      ? 0 : marketCapCandidate;
    const launchpad = detailLaunchpad(quoteScope, address, chain);
    const launchMode = launchModeFromScope(quoteScope, launchpad);
    const observedAt = priceUsd > 0 || marketCapUsd > 0 || liquidityUsd > 0 || exactSupply > 0
      ? Date.now() : 0;
    const supply = Tango.Supply?.resolve?.({
      chain, address, launchpad, launchMode, marketCapUsd, priceUsd, totalSupply: exactSupply,
      observedAt, source: 'GMGN', priceProvenance: priceUsd > 0 ? 'OBSERVED_PRICE' : '',
      supplySource: exactSupply > 0 ? 'GMGN_EXACT' : ''
    }) || null;
    const marketCapDerived = !(priceUsd > 0) && Boolean(supply) && marketCapUsd > 0;
    const resolvedPriceUsd = marketCapDerived ? marketCapUsd / supply.totalSupply : priceUsd;
    return {
      priceUsd: resolvedPriceUsd, marketCapUsd, liquidityUsd, nativePriceUsd: 0,
      totalSupply: Number(supply?.totalSupply || 0), supplySource: supply?.source || '', launchpad, launchMode,
      priceObservedAt: priceUsd > 0 ? observedAt : 0,
      priceSource: priceUsd > 0 ? 'GMGN' : '',
      marketCapObservedAt: marketCapUsd > 0 ? observedAt : 0,
      marketCapSource: marketCapUsd > 0 ? 'GMGN' : '',
      liquidityObservedAt: liquidityUsd > 0 ? observedAt : 0,
      liquiditySource: liquidityUsd > 0 ? 'GMGN' : '',
      totalSupplyObservedAt: exactSupply > 0 ? observedAt : 0,
      totalSupplyObservationSource: exactSupply > 0 ? 'GMGN' : '',
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
    lastVerifiedDetail = {
      chain,
      address,
      routeKey: chartRouteKey(chain, address),
      fingerprint,
      chainBound: confirmed.chainBound === true,
      header: confirmed.header,
      identityScope: confirmed.identityScope,
      bindingScope: confirmed.bindingScope,
      quoteScope: confirmed.quoteScope
    };
    return result;
  }

  function readVerifiedCurrentTokenSnapshot(expectedToken) {
    if (!isTokenDetailPage()) return null;
    const chain = chainFromUrl();
    const rawAddress = tokenAddressFromUrl();
    const expectedAddress = expectedToken?.address || expectedToken?.tokenAddress;
    if (!chain || expectedToken?.chain !== chain
      || !Tango.Chains.validateAddress(chain, rawAddress)
      || !Tango.Chains.validateAddress(chain, expectedAddress)) return null;
    const address = Tango.Chains.normalizeAddress(chain, rawAddress);
    if (Tango.Chains.normalizeAddress(chain, expectedAddress) !== address) return null;

    const verified = lastVerifiedDetail;
    if (!verified || verified.chain !== chain || verified.address !== address
      || verified.routeKey !== chartRouteKey(chain, address) || verified.chainBound !== true) return null;

    const detail = findTokenDetailScope(address, chain, false);
    if (!detail || detail.chainBound !== true) return null;
    for (const key of ['header', 'identityScope', 'bindingScope', 'quoteScope']) {
      if (!verified[key] || detail[key] !== verified[key] || detail[key].isConnected === false) return null;
    }
    const identity = detailTokenIdentity(detail.identityScope || detail.scope, address, chain);
    const fingerprint = `${identity.symbol}\u0000${identity.name}\u0000${tokenLogo(detail.header)}`;
    if (fingerprint !== verified.fingerprint) return null;
    const quote = detailQuote(detail, chain, address);
    if (!(Number.isFinite(Number(quote?.priceUsd)) && Number(quote.priceUsd) > 0)
      || quote?.source !== 'GMGN' || quote?.priceProvenance !== 'OBSERVED_PRICE') return null;
    return {
      token: {
        chain, address, symbol: identity.symbol, name: identity.name, logoUrl: tokenLogo(detail.header),
        launchpad: quote.launchpad, launchMode: quote.launchMode,
        metadataVerified: true, metadataSource: 'GMGN_DETAIL'
      },
      quote: { ...quote, chain, address }
    };
  }

  function isTrenchPage(url = global.location?.href || '') {
    const parsed = new URL(url);
    const chain = Tango.Chains.fromUrl(url);
    const trenchRoute = parsed.pathname === '' || parsed.pathname === '/'
      || /^\/r\/[^/]+\/?$/.test(parsed.pathname);
    return parsed.hostname === 'gmgn.ai' && trenchRoute && Boolean(chain?.capabilities.trench);
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
    const symbolNode = card?.querySelector?.('[data-sentry-component="TooltipCopy"]');
    const structuredSymbol = String(symbolNode?.textContent || '').trim();
    const structuredName = String(symbolNode?.nextElementSibling?.textContent || '').trim();
    // Explicit symbol/name fields need no heuristic metric-prefix filtering:
    // legitimate symbols such as FOUR CATS would otherwise be rejected as F.
    if (structuredSymbol && structuredSymbol.length <= 32 && !tokenAddressLine(structuredSymbol)) {
      return { symbol: structuredSymbol,
        name: structuredName && structuredName.length <= 100 && !tokenAddressLine(structuredName)
          ? structuredName : structuredSymbol };
    }
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

  function cardGenerationIdentity(card) {
    const identity = cardTokenIdentity(card);
    return `${identity?.symbol || ''}\u0000${identity?.name || ''}\u0000${cardTokenLogo(card) || ''}`;
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
    const lines = String(text || '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^\s*(?:MC|MCap|Market\s+Cap|市值)\s*[:：]?\s*(.*)$/i);
      if (!match) continue;
      const value = match[1].trim() || String(lines[index + 1] || '').trim();
      const explicitUsd = parseUsdMoney(value);
      if (explicitUsd > 0) return explicitUsd;
      if (/^[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*[KM]$/i.test(value)) {
        return parseMoney(value);
      }
      return 0;
    }
    return 0;
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

  function tokenItemRootsInAddedNode(node) {
    const found = [];
    if (node?.matches?.(TOKEN_ITEM_ROOT_SELECTOR)) found.push(node);
    node?.querySelectorAll?.(TOKEN_ITEM_ROOT_SELECTOR).forEach((root) => found.push(root));
    return [...new Set(found)];
  }

  function uniqueCardAddressHref(card, chain) {
    const hrefs = [card?.getAttribute?.('href'), ...Array.from(card?.querySelectorAll?.('a[href]') || [])
      .map((link) => link.href || link.getAttribute?.('href'))];
    const byAddress = new Map();
    for (const value of hrefs) {
      const href = normalizedCardHref(value, chain);
      if (!href) continue;
      const address = tokenAddressFromUrl(href);
      if (!Tango.Chains.validateAddress(chain, address)) continue;
      byAddress.set(Tango.Chains.normalizeAddress(chain, address), href);
    }
    if (byAddress.size > 1) return { href: '', unambiguous: false };
    return { href: byAddress.values().next().value || '', unambiguous: true };
  }

  function invalidateQuickBuyBirth(birth) {
    if (birth) {
      birth.eligible = false;
      if (birth.slot) quickBuyIntents.delete(birth.slot);
    }
    return false;
  }

  function quickBuyBirthIsEligible(birth, chain = chainFromUrl()) {
    if (!birth?.eligible || !birth.root?.isConnected || !birth.card?.isConnected || !birth.slot?.isConnected
      || birth.chain !== chain || cardGeneration(birth.card) !== birth.generation) {
      return invalidateQuickBuyBirth(birth);
    }
    const identity = uniqueCardAddressHref(birth.card, chain);
    if (!identity.unambiguous || (birth.firstAddressHref && identity.href !== birth.firstAddressHref)) {
      return invalidateQuickBuyBirth(birth);
    }
    if (!birth.firstAddressHref && identity.href) birth.firstAddressHref = identity.href;
    return true;
  }

  function recordQuickBuyCardBirths(addedRoots, chain, now = Date.now(), ineligibleRoots = new Set()) {
    const births = [];
    if (!chain) return births;
    for (const addedRoot of addedRoots || []) {
      for (const root of tokenItemRootsInAddedNode(addedRoot)) {
        const existing = quickBuyCardBirths.get(root);
        if (quickBuySeenTokenRoots.has(root)) {
          quickBuyBirthIsEligible(existing, chain);
          continue;
        }
        quickBuySeenTokenRoots.add(root);
        const card = root.matches?.('[class~="group/a"]') ? root
          : root.querySelector?.('[class~="group/a"]');
        const slots = Array.from(card?.querySelectorAll?.('.BuyButton-continer') || [])
          .filter((slot) => slot?.isConnected);
        const slot = slots.length === 1 ? slots[0] : null;
        const identity = uniqueCardAddressHref(card, chain);
        const birth = {
          card: card || null, slot, root, generation: card ? cardGeneration(card) : 0, chain, bornAt: now,
          firstAddressHref: identity.href,
          eligible: Boolean(root?.isConnected && card?.isConnected && slot?.isConnected
            && identity.unambiguous && !ineligibleRoots.has(root))
        };
        quickBuyCardBirths.set(root, birth);
        births.push(birth);
      }
    }
    return births;
  }

  function invalidateQuickBuyBirthsInRoots(roots, chain) {
    for (const root of roots || []) {
      for (const tokenRoot of tokenItemRootsInAddedNode(root)) {
        quickBuyBirthIsEligible(quickBuyCardBirths.get(tokenRoot), chain);
      }
    }
  }

  function invalidateRemovedQuickBuyBirths(removedRoots) {
    for (const root of removedRoots || []) {
      for (const tokenRoot of tokenItemRootsInAddedNode(root)) {
        invalidateQuickBuyBirth(quickBuyCardBirths.get(tokenRoot));
      }
    }
  }

  function tokenItemRootsForCard(card) {
    const roots = tokenItemRootsInAddedNode(card);
    const ancestor = card?.closest?.(TOKEN_ITEM_ROOT_SELECTOR);
    if (ancestor) roots.unshift(ancestor);
    return [...new Set(roots)];
  }

  function tokenItemRootsInMutationRoots(roots) {
    const tokenRoots = new Set();
    for (const root of roots || []) {
      tokenItemRootsInAddedNode(root).forEach((tokenRoot) => tokenRoots.add(tokenRoot));
    }
    return tokenRoots;
  }

  function hrefDiscontinuityTokenRoots(records, chain) {
    const tokenRoots = new Set();
    const mutations = Array.from(records || []);
    for (let index = 0; index < mutations.length; index += 1) {
      const mutation = mutations[index];
      const oldHref = normalizedCardHref(mutation?.oldValue, chain);
      const oldAddress = oldHref ? tokenAddressFromUrl(oldHref) : '';
      if (!oldHref || !Tango.Chains.validateAddress(chain, oldAddress)) continue;
      const nextMutation = mutations.slice(index + 1)
        .find((candidate) => candidate?.target === mutation?.target);
      const nextValue = nextMutation
        ? nextMutation.oldValue : mutation?.target?.getAttribute?.('href');
      const nextHref = normalizedCardHref(nextValue, chain);
      if (nextHref === oldHref) continue;
      tokenItemRootsForCard(mutation?.target)
        .forEach((tokenRoot) => tokenRoots.add(tokenRoot));
    }
    return tokenRoots;
  }

  function quickBuyBirthForSlot(births, card, slot, chain) {
    return births.find((birth) => (
      birth.card === card && birth.slot === slot && birth.chain === chain
        && birth.generation === cardGeneration(card)
    )) || tokenItemRootsForCard(card).map((root) => quickBuyCardBirths.get(root)).find((birth) => (
      birth?.card === card && birth.slot === slot && birth.chain === chain
        && birth.generation === cardGeneration(card)
    )) || null;
  }

  function cardMarketSnapshot(card, chain, address, token = {}) {
    // New trenches render the MC prefix through CSS/icon content, so it is
    // absent from innerText. Read the explicitly identified field, never V/N.
    const marketCapField = card?.querySelector?.('[data-icon="MC"]');
    const marketCapUsd = marketCapField
      ? parseUsdMoney(marketCapField.textContent)
      : cardMarketCap(card?.innerText || card?.textContent || '');
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

  const QUICK_BUY_ACTION_ATTRIBUTES = new Set(['id', 'data-testid', 'href', 'target', 'formaction']);
  const QUICK_BUY_NATIVE_CONTROL_SELECTOR = 'button, [role="button"], a[href], [data-testid="quickbuy"]';

  function isPaperQuickBuyControl(control) {
    const classes = String(control?.className || '').split(/\s+/);
    return classes.includes('tango-list-quick-buy')
      || control?.dataset?.tangoPaperAction === 'quick-buy';
  }

  function containsPaperQuickBuyControl(control) {
    return isPaperQuickBuyControl(control) || Boolean(control?.querySelector?.(
      '.tango-list-quick-buy, [data-tango-paper-action="quick-buy"]'
    ));
  }

  function nativeQuickBuyControls(slot) {
    if (!slot) return [];
    const candidates = [
      slot.querySelector?.('[data-testid="quickbuy"]'),
      ...Array.from(slot.querySelectorAll?.(QUICK_BUY_NATIVE_CONTROL_SELECTOR) || [])
    ];
    const found = [];
    const seen = new Set();
    for (const control of candidates) {
      if (!control || seen.has(control) || control.isConnected === false
        || containsPaperQuickBuyControl(control)) continue;
      // Keep the authored sell label as live evidence for the bound percentage
      // or recover-cost action. The paper host hides it and Guard blocks it.
      if (control.matches?.('[data-testid="quicksell"]')
        || control.closest?.('[data-testid="quicksell"]')?.matches?.('[data-testid="quicksell"]')) continue;
      const closestSlot = control.closest?.('.BuyButton-continer');
      if (closestSlot && closestSlot !== slot) continue;
      seen.add(control);
      found.push(control);
    }
    return found;
  }

  function nativeQuickBuyControl(slot) {
    return nativeQuickBuyControls(slot)[0] || null;
  }

  function removeNativeQuickBuyControls(slot) {
    nativeQuickBuyControls(slot).forEach((control) => control.remove?.());
  }

  function replaceAdditionalNativeQuickBuyControls(slot, binding) {
    const controls = nativeQuickBuyControls(slot);
    const topLevelControls = controls.filter((control) =>
      !controls.some((candidate) => candidate !== control && candidate.contains?.(control))
    );
    const existing = binding.additionalNativeControls || [];
    const additions = topLevelControls.map((control) => ({
      control,
      parent: control.parentNode || slot,
      nextSibling: control.nextSibling || null
    }));
    binding.additionalNativeControls = [
      ...existing,
      ...additions.filter(({ control }) => !existing.some((record) => record.control === control))
    ];
    topLevelControls.forEach((control) => control.remove?.());
    removeNativeQuickBuyControls(slot);
  }

  function restoreAdditionalNativeQuickBuyControls(slot, binding) {
    const records = binding?.additionalNativeControls || [];
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const { control, parent, nextSibling } = records[index];
      if (!control || control.isConnected || control.parentNode != null
        || !parent || parent.isConnected === false) continue;
      if (parent !== slot && !slot.contains?.(parent)) continue;
      const restoredPrimary = nextSibling === binding.replacement ? binding.nativeControl : null;
      const reference = restoredPrimary || (nextSibling?.parentNode === parent ? nextSibling : null);
      if (typeof parent.insertBefore === 'function') parent.insertBefore(control, reference);
      else if (parent === slot) parent.appendChild?.(control);
    }
  }


  const LOCKED_QUICK_BUY_PROFILE = Object.freeze({
    id: 'giant',
    heightPx: 36,
    amountTextPx: 14,
    hintTextPx: 10
  });

  function stripQuickBuyActionAttributes(control) {
    for (const name of control?.getAttributeNames?.() || []) {
      const normalized = String(name).toLowerCase();
      if (QUICK_BUY_ACTION_ATTRIBUTES.has(normalized) || normalized.startsWith('on')) {
        control.removeAttribute?.(name);
      }
    }
  }

  function ensureInertQuickBuy(replacement) {
    if (!replacement) return;
    const classes = String(replacement.className || '').split(/\s+/).filter(Boolean);
    if (!classes.includes('tango-list-quick-buy')) {
      replacement.className = [...classes, 'tango-list-quick-buy'].join(' ');
    }
    stripQuickBuyActionAttributes(replacement);
    if (replacement.type !== 'button') replacement.type = 'button';
    if (replacement.dataset.tangoQuickBuy !== '1') replacement.dataset.tangoQuickBuy = '1';
    if (replacement.dataset.tangoPaperAction !== 'quick-buy') replacement.dataset.tangoPaperAction = 'quick-buy';
  }

  function registerPaperQuickBuy(slot, binding, actionId = binding?.actionId) {
    const replacement = binding?.replacement;
    const expectedActionId = String(actionId || '').trim();
    const card = binding?.card;
    const bindingNonce = String(binding?.bindingNonce || '');
    const generation = binding?.generation;
    const state = String(binding?.state || '');
    const chain = binding?.chain;
    const address = binding?.address;
    const href = binding?.href;
    const amountNative = binding?.amountNative;
    if (binding?.invalidAmount || !replacement || !expectedActionId || !card || !bindingNonce
      || !Number.isInteger(generation) || generation <= 0
      || !['resolving-identity', 'ready', 'in-flight'].includes(state)) {
      Tango.NativeQuickBuyGuard?.revokePaperAction?.(replacement);
      return false;
    }
    Object.assign(replacement.dataset, {
      tangoPaperAction: 'quick-buy', tangoActionId: expectedActionId,
      tangoBindingNonce: bindingNonce, tangoCardGeneration: String(generation), tangoPaperState: state
    });
    Object.assign(slot.dataset, {
      tangoQuickBuy: '1', tangoActionId: expectedActionId,
      tangoBindingNonce: bindingNonce, tangoCardGeneration: String(generation), tangoPaperState: state
    });
    return Tango.NativeQuickBuyGuard?.registerPaperAction?.(replacement, {
      slot, card, binding, actionId: expectedActionId, bindingNonce, generation, state,
      chain, address, href, amountNative, validate: binding.validate
    }, binding.action?.invoke) === true;
  }

  function paperGuardIdentity(binding) {
    return binding ? { ...binding, binding } : binding;
  }

  function trustedPaperBinding(binding) {
    return Boolean(binding?.replacement
      && Tango.NativeQuickBuyGuard?.isPaperActionTrusted?.(
        binding.replacement, paperGuardIdentity(binding)
      ) === true);
  }

  function replaceDataset(target, values) {
    if (!target) return;
    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, values || {});
  }

  function publicationSnapshot(slot) {
    const binding = slot?.__tangoQuickBuyBinding || null;
    return {
      binding,
      slotDataset: { ...(slot?.dataset || {}) },
      replacementDataset: { ...(binding?.replacement?.dataset || {}) },
      original: slot?.__tangoOriginalQuickBuy,
      replacement: slot?.__tangoReplacementQuickBuy,
      card: slot?.__tangoQuickBuyCard
    };
  }

  function restorePublicationSnapshot(slot, snapshot) {
    replaceDataset(slot?.dataset, snapshot.slotDataset);
    if (snapshot.binding?.replacement) {
      replaceDataset(snapshot.binding.replacement.dataset, snapshot.replacementDataset);
    }
    if (snapshot.binding) slot.__tangoQuickBuyBinding = snapshot.binding;
    else delete slot.__tangoQuickBuyBinding;
    if (snapshot.original !== undefined) slot.__tangoOriginalQuickBuy = snapshot.original;
    else delete slot.__tangoOriginalQuickBuy;
    if (snapshot.replacement !== undefined) slot.__tangoReplacementQuickBuy = snapshot.replacement;
    else delete slot.__tangoReplacementQuickBuy;
    if (snapshot.card !== undefined) slot.__tangoQuickBuyCard = snapshot.card;
    else delete slot.__tangoQuickBuyCard;
  }

  function stagePaperBinding(slot, binding) {
    binding.slot = slot;
    binding.pendingOnly = false;
    binding.replacement.disabled = false;
    binding.replacement.removeAttribute?.('aria-disabled');
    binding.replacement.dataset.tangoPublished = '0';
    slot.__tangoQuickBuyBinding = binding;
    slot.__tangoReplacementQuickBuy = binding.replacement;
    slot.__tangoQuickBuyCard = binding.card;
    if (!binding.replacement.isConnected) mountQuickBuyReplacement(slot, null, binding.replacement);
  }

  function retirePreviousPaperBinding(previous, nextBinding) {
    const binding = previous.binding;
    if (!binding || binding === nextBinding) return;
    cancelQuickBuyIdentityIntent(binding, 'superseded');
    binding.actionHost?.classList?.remove?.('tango-quick-buy-action-host');
    clearLockedQuickBuyStructuralHosts(binding);
    if (binding.replacement !== nextBinding.replacement) {
      Tango.NativeQuickBuyGuard?.revokePaperAction?.(binding.replacement);
      binding.replacement?.remove?.();
    }
  }

  function commitPaperQuickBuy(slot, nextBinding, action) {
    if (!slot || !nextBinding?.replacement || !action?.invoke) return false;
    const previous = publicationSnapshot(slot);
    nextBinding.action = action;
    stagePaperBinding(slot, nextBinding);
    const registered = registerPaperQuickBuy(slot, nextBinding);
    const trusted = registered && trustedPaperBinding(nextBinding);
    if (!trusted) {
      restorePublicationSnapshot(slot, previous);
      let predecessorRestored = false;
      if (previous.binding) {
        predecessorRestored = registerPaperQuickBuy(slot, previous.binding)
          && trustedPaperBinding(previous.binding);
        if (predecessorRestored) {
          previous.binding.replacement.dataset.tangoPublished = '1';
        } else {
          Tango.NativeQuickBuyGuard?.revokePaperAction?.(previous.binding.replacement);
          previous.binding.replacement.dataset.tangoPublished = '0';
        }
      }
      if (!predecessorRestored || previous.binding?.replacement !== nextBinding.replacement) {
        nextBinding.replacement.dataset.tangoPublished = '0';
      }
      if (previous.binding?.replacement !== nextBinding.replacement) {
        nextBinding.replacement.remove?.();
      }
      return false;
    }
    nextBinding.replacement.dataset.tangoPublished = '1';
    retirePreviousPaperBinding(previous, nextBinding);
    mountQuickBuyReplacement(slot, nextBinding.nativeControl, nextBinding.replacement);
    replaceAdditionalNativeQuickBuyControls(slot, nextBinding);
    return true;
  }

  function pruneExpiredQuickBuyIdentityIntents(now = Date.now()) {
    for (const [slot, intent] of quickBuyIntents) {
      if (intent.expiresAt < now || !intent.slot?.isConnected || !intent.card?.isConnected
        || !intent.root?.isConnected) quickBuyIntents.delete(slot);
    }
  }

  function recordQuickBuyIdentityIntent(binding, context = {}, now = Date.now()) {
    pruneExpiredQuickBuyIdentityIntents(now);
    if (!binding?.slot || binding.slot.__tangoQuickBuyBinding !== binding
      || binding.state !== 'resolving-identity' || !binding.replacement?.isConnected
      || !(Number(binding.amountNative) > 0) || !liveQuickBuyIdentityMatches(binding)
      || typeof context.onQuickBuy !== 'function'
      || binding.paperLabel !== context.paperLabel || binding.policyKey !== context.policyKey
      || !quickBuyBirthMatchesBinding(binding.birth, binding)) return null;
    const existing = quickBuyIntents.get(binding.slot);
    if (existing?.actionId === binding.actionId
      && existing.bindingNonce === binding.bindingNonce && existing.birth === binding.birth
      && now <= existing.expiresAt) return existing;
    const intent = Object.freeze({
      slot: binding.slot,
      card: binding.card,
      root: binding.birth.root,
      birth: binding.birth,
      generation: binding.generation,
      actionId: binding.actionId,
      bindingNonce: binding.bindingNonce,
      chain: binding.chain,
      amountNative: binding.amountNative,
      tradeActionKey: binding.tradeAction?.key || 'BUY',
      paperLabel: binding.paperLabel,
      policyKey: binding.policyKey,
      routeHref: global.location?.href || '',
      createdAt: now,
      expiresAt: now + QUICK_BUY_IDENTITY_INTENT_TTL_MS
    });
    quickBuyIntents.set(binding.slot, intent);
    return intent;
  }

  function quickBuyBirthMatchesBinding(birth, binding) {
    return Boolean(birth && binding && birth.card === binding.card && birth.slot === binding.slot
      && birth.generation === binding.generation && birth.chain === binding.chain
      && Number(binding.birthAmountNative) === Number(binding.amountNative)
      && quickBuyBirthIsEligible(birth, binding.chain));
  }

  function cancelQuickBuyIdentityIntent(binding, _reason) {
    const slot = binding?.slot || binding;
    if (slot) quickBuyIntents.delete(slot);
  }

  function cardAddressEvidence(card, chain) {
    const identity = uniqueCardAddressHref(card, chain);
    if (!identity.unambiguous) return null;
    const href = identity.href;
    if (!href) return null;
    const rawAddress = tokenAddressFromUrl(href);
    if (!Tango.Chains.validateAddress(chain, rawAddress)) return null;
    return {
      address: Tango.Chains.normalizeAddress(chain, rawAddress),
      href,
      source: /(?:^|\.)pump\.fun$/i.test(new URL(href).hostname) ? 'launchpad' : 'gmgn'
    };
  }

  function quickBuyOperationKey(bindingKey, slot) {
    if (!quickBuySlotIdentities.has(slot)) {
      quickBuySlotIdentities.set(slot, ++quickBuySlotIdentitySequence);
    }
    return `${bindingKey}:slot:${quickBuySlotIdentities.get(slot)}`;
  }

  function liveQuickBuyIdentityMatches(binding) {
    const slot = binding?.slot;
    const card = binding?.card;
    if (!binding || binding.invalidAmount || !slot?.isConnected || !card?.isConnected || !binding.replacement?.isConnected
      || slot.__tangoQuickBuyBinding !== binding
      || slot.__tangoReplacementQuickBuy !== binding.replacement
      || slot.__tangoQuickBuyCard !== card
      || slot.matches?.('.BuyButton-continer') !== true
      || slot.closest?.('[class~="group/a"]') !== card
      || !isTrenchPage() || chainFromUrl() !== binding.chain
      || cardGeneration(card) !== binding.generation
      || (binding.tradeAction?.key || 'BUY') !== quickBuyTradeAction(slot).key) return false;
    if (Number(cardQuickBuyAmount(card, nativeQuickBuyControl(slot), slot, binding.amountNative)) !== Number(binding.amountNative)) return false;
    if (binding.state === 'resolving-identity') {
      return !binding.birth || quickBuyBirthMatchesBinding(binding.birth, binding);
    }
    const evidence = cardAddressEvidence(card, binding.chain);
    return Boolean(evidence && evidence.address === binding.address
      && evidence.href === binding.href
      && binding.key === `${binding.chain}:${binding.address}`);
  }

  function claimQuickBuyIdentityIntent(binding, evidence, now = Date.now()) {
    const intent = quickBuyIntents.get(binding?.slot);
    const valid = Boolean(intent && evidence
      && intent.birth === binding.birth
      && intent.root === binding.birth?.root
      && binding?.slot?.__tangoQuickBuyBinding === binding
      && binding.state === 'resolving-identity'
      && binding.card === intent.card
      && binding.generation === intent.generation
      && binding.actionId === intent.actionId
      && binding.bindingNonce === intent.bindingNonce
      && binding.chain === intent.chain
      && Number(binding.amountNative) === Number(intent.amountNative)
      && (binding.tradeAction?.key || 'BUY') === intent.tradeActionKey
      && quickBuyTradeAction(binding.slot).key === intent.tradeActionKey
      && binding.paperLabel === intent.paperLabel
      && binding.policyKey === intent.policyKey
      && quickBuyBirthMatchesBinding(binding.birth, binding)
      && global.location?.href === intent.routeHref
      && chainFromUrl() === intent.chain
      && now <= intent.createdAt + QUICK_BUY_IDENTITY_INTENT_TTL_MS
      && evidence.href === intent.birth.firstAddressHref
      && intent.root?.isConnected && intent.card?.isConnected && intent.slot?.isConnected);
    quickBuyIntents.delete(binding?.slot);
    return valid ? intent : null;
  }

  function quickBuyActivationContext(binding) {
    return {
      onQuickBuy: binding?.onQuickBuy,
      chainDefinition: binding?.chainDefinition,
      paperLabel: binding?.paperLabel,
      policyKey: binding?.policyKey
    };
  }

  function acceptQuickBuyIdentityActivation(binding, context, now = Date.now()) {
    pruneExpiredQuickBuyIdentityIntents(now);
    const intent = recordQuickBuyIdentityIntent(binding, context, now);
    if (!intent) return { status: 'REJECTED' };
    const evidence = cardAddressEvidence(binding.card, binding.chain);
    if (!evidence) return { status: 'RECORDED', intent };
    const promoted = activatePendingQuickBuy(binding.slot, binding, {
      card: binding.card,
      nativeControl: nativeQuickBuyControl(binding.slot),
      chain: binding.chain,
      chainDefinition: context.chainDefinition,
      address: evidence.address,
      bindingKey: `${binding.chain}:${evidence.address}`,
      href: evidence.href,
      amountNative: binding.amountNative,
      paperLabel: context.paperLabel,
      policyKey: context.policyKey,
      onQuickBuy: context.onQuickBuy,
      now
    });
    return promoted ? { status: 'PROMOTED', intent } : { status: 'REJECTED' };
  }

  function activeQuickBuyOperation(bindingKey, slot) {
    const operation = quickBuyOperations.get(quickBuyOperationKey(bindingKey, slot));
    return operation?.inFlight ? operation : null;
  }

  function applyPaperStateCopy(binding, state) {
    const nativeSymbol = Tango.Chains.get(binding.chain)?.nativeSymbol || '';
    const tradeAction = binding.tradeAction || { side: 'BUY' };
    const readyCopy = tradeAction.side === 'SELL'
      ? `Tango Paper Sell ${tradeAction.breakeven ? 'Recover Cost' : tradeAction.valid ? tradeAction.sellPercent + '%' : 'unavailable'}`
      : `Tango Paper Buy ${binding.amountNative} ${nativeSymbol}`.trim();
    const copy = state === 'resolving-identity'
      ? 'Tango paper click accepted — confirming token identity'
      : (state === 'in-flight'
        ? 'Tango paper order is processing'
        : readyCopy);
    binding.replacement.title = copy;
    binding.replacement.setAttribute?.('aria-label', copy);
  }

  function setPaperState(slot, binding, state) {
    if (!slot || slot.__tangoQuickBuyBinding !== binding || !binding?.replacement) return false;
    if (binding.invalidAmount) {
      binding.replacement.disabled = true;
      Tango.NativeQuickBuyGuard?.revokePaperAction?.(binding.replacement);
      return false;
    }
    binding.state = state;
    binding.pendingOnly = false;
    binding.replacement.disabled = false;
    binding.replacement.removeAttribute?.('aria-disabled');
    delete binding.replacement.dataset.tangoPending;
    binding.replacement.dataset.tangoPaperState = state;
    slot.dataset.tangoPaperState = state;
    applyPaperStateCopy(binding, state);
    return registerPaperQuickBuy(slot, binding)
      && Tango.NativeQuickBuyGuard?.isPaperActionTrusted?.(
        binding.replacement, paperGuardIdentity(binding)
      ) === true;
  }

  function releaseQuickBuyOperation(operation) {
    if (!operation) return;
    operation.inFlight = false;
    if (quickBuyOperations.get(operation.key) === operation) {
      quickBuyOperations.delete(operation.key);
    }
    for (const slot of trackedQuickBuySlots) {
      const binding = slot?.__tangoQuickBuyBinding;
      if (binding?.operation !== operation) continue;
      binding.operation = null;
      const replacement = binding.replacement;
      if (replacement?.isConnected && binding.state === 'in-flight') setPaperState(slot, binding, 'ready');
    }
  }


  function lockedQuickBuyActionHost(slot, replacement = null) {
    const parent = replacement?.parentElement;
    if (parent?.matches?.('[class~="group/btn"]')
      && parent.closest?.('.BuyButton-continer') === slot) return parent;
    return slot?.querySelector?.('[class~="group/btn"]') || null;
  }

  function lockedQuickBuyStructuralHosts(slot, actionHost) {
    const hosts = [];
    for (let node = actionHost; node && node !== slot; node = node.parentElement) {
      hosts.push(node);
    }
    return hosts.at(-1)?.parentElement === slot ? hosts : [];
  }

  function clearLockedQuickBuyStructuralHosts(binding) {
    for (const host of binding?.structuralHosts || []) {
      setQuickBuyClass(host, 'tango-quick-buy-structural-host', false);
    }
    if (binding) binding.structuralHosts = [];
  }

  function setQuickBuyClass(element, name, enabled) {
    if (!element?.classList) return;
    if (typeof element.classList.contains !== 'function' && typeof element.className !== 'string') {
      element.classList[enabled ? 'add' : 'remove']?.(name);
      return;
    }
    const hasClass = element.classList.contains?.(name)
      ?? String(element.className || '').split(/\s+/).includes(name);
    if (enabled && !hasClass) element.classList.add?.(name);
    if (!enabled && hasClass) element.classList.remove?.(name);
  }

  // Read GMGN's authored sizing signals. Computed geometry already includes
  // our overrides after mounting, so it cannot identify a later native setting.
  function nativeQuickBuyProfile(slot, replacement, knownNativeControl) {
    if (slot?.matches?.('[data-sentry-component="SellButton"]')) {
      const group = slot.closest?.('[data-sentry-component="BuyButtons"]');
      const peers = Array.from(group?.querySelectorAll?.('.BuyButton-continer') || [])
        .filter((peer) => peer !== slot && peer.closest?.('[data-sentry-component="BuyButtons"]') === group
          && quickBuyTradeAction(peer).side === 'BUY');
      if (peers.length === 1) {
        const pairedProfile = nativeQuickBuyProfile(peers[0], peers[0].__tangoReplacementQuickBuy);
        if (pairedProfile !== LOCKED_QUICK_BUY_PROFILE) return pairedProfile;
      }
    }
    const binding = slot?.__tangoQuickBuyBinding;
    const host = lockedQuickBuyActionHost(slot, replacement);
    const native = (knownNativeControl === undefined ? nativeQuickBuyControl(slot) : knownNativeControl) || binding?.nativeControl;
    const sources = [...new Set([host, slot, native].filter(Boolean))];
    const inline = (node, name) => node.style?.getPropertyValue?.(name)
      || String(node.style?.cssText || '').match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'))?.[1] || '';
    const px = (value) => /^\s*\d+(?:\.\d+)?px\s*$/.test(value)
      ? Math.min(240, Math.max(16, Number.parseFloat(value))) : null;
    for (const node of sources) {
      const classes = String(node.className || '');
      const pointerHeight = sources.map((item) => px(inline(item, '--quick-buy-pointer-height'))).find(Boolean);
      if (/(?:^|\s)!?h-full(?:\s|$)/.test(classes) && pointerHeight) {
        return { id: 'giant', heightPx: pointerHeight, heightCss: '100%', widthPx: null,
          amountTextPx: 14, hintTextPx: 10 };
      }
      const authoredHeight = classes.match(/(?:^|\s)!?h-\[(\d+(?:\.\d+)?)px\]/)?.[1];
      const height = authoredHeight ? px(authoredHeight + 'px') : px(inline(node, 'height'));
      if (!height) continue;
      const id = height <= 24 ? 'small' : height <= 32 ? 'large' : height === 44 ? 'ultra' : 'giant';
      return { id, heightPx: height, widthPx: null,
        amountTextPx: height <= 32 ? 12 : height === 44 ? 13 : 14,
        hintTextPx: height <= 24 ? 9 : 10 };
    }
    return LOCKED_QUICK_BUY_PROFILE;
  }

  function quickBuyGeometryValues(profile) {
    return {
      '--tango-quick-buy-height': profile.heightCss || profile.heightPx + 'px',
      '--tango-quick-buy-width': profile.widthPx ? profile.widthPx + 'px' : '100%',
      '--tango-quick-buy-display-text': profile.amountTextPx + 'px',
      '--tango-quick-buy-label-text': profile.hintTextPx + 'px'
    };
  }

  function applyQuickBuyGeometry(slot, profile) {
    if (!slot?.style?.setProperty) return;
    const values = quickBuyGeometryValues(profile);
    slot.__tangoQuickBuyOriginalGeometry ||= new Map();
    for (const [name, value] of Object.entries(values)) {
      if (!slot.__tangoQuickBuyOriginalGeometry.has(name)) {
        slot.__tangoQuickBuyOriginalGeometry.set(name, [slot.style.getPropertyValue?.(name) || '',
          slot.style.getPropertyPriority?.(name) || '']);
      }
      if (slot.style.getPropertyValue?.(name) !== value) slot.style.setProperty(name, value);
    }
  }

  function applyLockedQuickBuyPresentation(replacement, slot = null) {
    if (!replacement) return LOCKED_QUICK_BUY_PROFILE;
    const profile = nativeQuickBuyProfile(slot, replacement);
    applyQuickBuyGeometry(slot, profile);
    if (replacement.className !== 'tango-list-quick-buy') replacement.className = 'tango-list-quick-buy';
    if (replacement.style && replacement.style.cssText !== '') replacement.style.cssText = '';
    ensureInertQuickBuy(replacement);
    if (replacement.dataset.tangoQuickBuySize !== profile.id) {
      replacement.dataset.tangoQuickBuySize = profile.id;
    }
    if (slot?.dataset && slot.dataset.tangoQuickBuySize !== profile.id) {
      slot.dataset.tangoQuickBuySize = profile.id;
    }
    const binding = slot?.__tangoQuickBuyBinding;
    const actionHost = lockedQuickBuyActionHost(slot, replacement);
    if (binding?.actionHost && binding.actionHost !== actionHost) {
      setQuickBuyClass(binding.actionHost, 'tango-quick-buy-action-host', false);
    }
    const structuralHosts = lockedQuickBuyStructuralHosts(slot, actionHost);
    const nextHosts = new Set(structuralHosts);
    for (const previous of binding?.structuralHosts || []) {
      if (!nextHosts.has(previous)) setQuickBuyClass(previous, 'tango-quick-buy-structural-host', false);
    }
    structuralHosts.forEach((host) => setQuickBuyClass(host, 'tango-quick-buy-structural-host', true));
    setQuickBuyClass(actionHost, 'tango-quick-buy-action-host', true);
    if (binding) {
      binding.actionHost = actionHost;
      binding.structuralHosts = structuralHosts;
      binding.quickBuyProfile = profile;
    }
    return profile;
  }

  function syncQuickBuyPresentation(slot) {
    const binding = slot?.__tangoQuickBuyBinding;
    const replacement = binding?.replacement || slot?.__tangoReplacementQuickBuy
      || slot?.querySelector?.('.tango-list-quick-buy');
    if (!slot || !replacement?.isConnected) {
      Tango.NativeQuickBuyGuard?.revokePaperAction?.(replacement);
      return false;
    }
    applyLockedQuickBuyPresentation(replacement, slot);
    if (binding) registerPaperQuickBuy(slot, binding, binding.actionId);
    return true;
  }

  function parseQuickBuyAmount(value) {
    const normalized = String(value || '').replaceAll(',', '').trim();
    const match = normalized.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
    const amount = Number(match?.[0] || 0);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function selectQuickBuyAmount(columnValue, nativeText, previousAmount, defaultAmount) {
    if (columnValue != null) {
      const value = String(columnValue).replaceAll(',', '').trim();
      if (value) {
        if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) return 0;
        const amount = Number(value);
        return Number.isFinite(amount) && amount > 0 ? amount : 0;
      }
      // An empty column uses GMGN's preset amount; only an explicit invalid
      // value overrides that evidence and must fail closed.
    }
    if (/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.test(String(nativeText || ''))) return parseQuickBuyAmount(nativeText);
    return Number(previousAmount) || Number(defaultAmount);
  }

  function quickBuyTradeAction(slot) {
    const sell = slot?.querySelector?.('[data-testid="quicksell"]');
    if (!sell && !slot?.matches?.('[data-sentry-component="SellButton"]')) {
      return { side: 'BUY', key: 'BUY', valid: true };
    }
    const text = String(sell?.textContent || '').replace(/[\uE000-\uF8FF\s]/g, '');
    if (/^(回本|一键回本|RecoverCost|Breakeven)$/i.test(text)) {
      return { side: 'SELL', key: 'SELL:BREAKEVEN', sellPercent: 0, breakeven: true, valid: true };
    }
    const percent = text.match(/^(?:卖出|Sell)?(\d+(?:\.\d+)?)%$/i);
    const sellPercent = Number(percent?.[1] || 0);
    const valid = sellPercent > 0 && sellPercent <= 100;
    return { side: 'SELL', key: valid ? `SELL:${sellPercent}` : 'SELL:UNSUPPORTED', sellPercent, breakeven: false, valid };
  }

  function cardQuickBuyAmount(card, nativeControl, slot, defaultAmountSol) {
    const action = quickBuyTradeAction(slot);
    if (action.side === 'SELL') return action.valid ? action.sellPercent || 1 : 0;
    const columnInput = trenchColumn(card)?.querySelector('[data-sentry-component="BuyAmountInput"] input');
    // The secondary preset is independent of the primary column input. The
    // current native action can also be the slot itself rather than a child.
    const slots = Array.from(card?.querySelectorAll?.('.BuyButton-continer') || []);
    const secondary = slots.length > 1 && slots.includes(slot) && slots.at(-1) !== slot;
    const rootText = Array.from(slot?.childNodes || [])
      .filter((node) => node.nodeType === 3).map((node) => node.textContent || '').join(' ');
    const nativeText = nativeControl?.textContent || rootText;
    return selectQuickBuyAmount(secondary ? undefined : columnInput?.value,
      nativeText, slot.dataset.tangoAmountSol, defaultAmountSol);
  }

  function renderQuickBuyContent(replacement, paperLabel, amountNative, nativeSymbol, tradeAction = { side: 'BUY' }) {
    replacement.textContent = '';
    replacement.dataset.tangoSide = tradeAction.side;
    const wrapper = document.createElement('span');
    wrapper.className = 'tango-quick-buy-content';
    const hint = document.createElement('span');
    hint.className = 'tango-paper-hint';
    hint.textContent = paperLabel;
    const amount = document.createElement('span');
    amount.className = 'tango-buy-amount';
    amount.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m13.688 8.12-6.471 7.705c-.206.245-.604.061-.55-.255l1.007-5.843-4.617-.061c-.88-.012-1.352-1.038-.79-1.714L8.723.191c.205-.247.605-.063.55.253L8.247 6.399l4.641.003c.888.001 1.371 1.038.8 1.718Z"/></svg><span>'
      + (tradeAction.side === 'SELL'
        ? tradeAction.breakeven ? (paperLabel === '模拟盘' ? '回本' : 'Recover Cost') : tradeAction.valid ? tradeAction.sellPercent + '%' : '—'
        : amountNative + ' ' + nativeSymbol) + '</span>';
    wrapper.append(hint, amount);
    replacement.append(wrapper);
  }

  function createQuickBuyReplacement(
    slot, _card, _chain, _nativeControl, amountNative, paperLabel, chainDefinition
  ) {
    const replacement = document.createElement('button');
    replacement.type = 'button';
    const quickBuyProfile = applyLockedQuickBuyPresentation(replacement, slot);
    renderQuickBuyContent(replacement, paperLabel, amountNative, chainDefinition.nativeSymbol, quickBuyTradeAction(slot));
    return { replacement, quickBuyProfile };
  }

  function createQuickBuyHandler({
    slot, card, replacement, bindingKey, chain, address, actionId, onQuickBuy, amountNative
  }) {
    const operationKey = quickBuyOperationKey(bindingKey, slot);
    return async () => {
      const binding = slot.__tangoQuickBuyBinding;
      if (!slot.isConnected || !card.isConnected || !replacement.isConnected
        || binding?.actionId !== actionId || binding?.key !== bindingKey
        || binding?.state === 'resolving-identity'
        || liveQuickBuyIdentityMatches(binding) !== true
        || binding.tradeAction?.valid === false) return;
      const activeOperation = activeQuickBuyOperation(bindingKey, slot);
      if (activeOperation) {
        binding.operation = activeOperation;
        setPaperState(slot, binding, 'in-flight');
        return;
      }
      const now = Date.now();
      if (now - Number(replacement.dataset.tangoLastClickAt || 0) < 900) return;
      replacement.dataset.tangoLastClickAt = String(now);
      const operation = { key: operationKey, inFlight: true };
      quickBuyOperations.set(operationKey, operation);
      binding.operation = operation;
      if (!setPaperState(slot, binding, 'in-flight')) {
        releaseQuickBuyOperation(operation);
        return;
      }
      try {
        if (chainFromUrl() !== chain) return;
        const evidence = cardAddressEvidence(card, chain);
        if (!evidence || evidence.address !== address) return;
        const clickMetadata = verifiedCardMetadata(card, address, chain);
        if (chainFromUrl() !== chain) return;
        const token = {
          chain,
          address,
          symbol: clickMetadata?.symbol || 'TOKEN',
          name: clickMetadata?.name || clickMetadata?.symbol || 'Token',
          logoUrl: clickMetadata?.logoUrl || '',
          launchpad: clickMetadata?.launchpad || (chain === 'sol' && /pump$/i.test(address) ? 'Pump.fun' : ''),
          launchMode: clickMetadata?.launchMode || '',
          metadataVerified: Boolean(clickMetadata),
          metadataSource: clickMetadata ? 'GMGN_TRENCH' : ''
        };
        const quote = cardMarketSnapshot(card, chain, address, token);
        rememberTrenchSnapshot({ token, quote });
        await onQuickBuy({
          actionId, token: { ...token }, quote: { ...quote },
          amountNative, amountSol: amountNative, sourceUrl: evidence.href,
          ...(binding.tradeAction?.side === 'SELL' ? {
            side: 'SELL', sellPercent: binding.tradeAction.sellPercent, breakeven: binding.tradeAction.breakeven
          } : {})
        });
      } finally {
        releaseQuickBuyOperation(operation);
      }
    };
  }

  function mountQuickBuyReplacement(slot, nativeControl, replacement) {
    if (nativeControl?.isConnected) {
      nativeControl.replaceWith(replacement);
      return;
    }
    const preservedActionHost = slot?.querySelector?.('[class~="group/btn"]');
    if (preservedActionHost && typeof preservedActionHost.appendChild === 'function') {
      if (replacement?.parentNode !== preservedActionHost) {
        preservedActionHost.appendChild(replacement);
      }
      return;
    }
    if (!replacement?.isConnected) slot?.appendChild?.(replacement);
  }

  function createPendingQuickBuy(
    slot, card, nativeControl, chain, chainDefinition, amountNative, paperLabel,
    birth = null, onQuickBuy = null, policyKey = ''
  ) {
    if (!slot?.isConnected || !card?.isConnected) return false;
    const { replacement, quickBuyProfile } = createQuickBuyReplacement(
      slot, card, chain, nativeControl, amountNative, paperLabel, chainDefinition
    );
    const { generation, bindingNonce } = createQuickBuyGeneration({
      slot, card, chain, address: '', href: '', amountNative
    });
    const actionId = `tango-paper-${bindingNonce}`;
    const binding = {
      slot, key: '', chain, address: '', href: '', card, nativeControl: nativeControl || null,
      replacement, actionId, bindingNonce, generation, state: 'resolving-identity',
      amountNative, paperLabel, policyKey, birth, birthAmountNative: amountNative, pendingOnly: false,
      tradeAction: quickBuyTradeAction(slot),
      onQuickBuy, chainDefinition, quickBuyProfile,
      cardGenerationIdentity: cardGenerationIdentity(card),
      actionHost: null, operation: null, additionalNativeControls: []
    };
    binding.validate = () => liveQuickBuyIdentityMatches(binding);
    const action = {
      bindingNonce,
      kind: 'intent',
      invoke: () => acceptQuickBuyIdentityActivation(binding, quickBuyActivationContext(binding))
    };
    applyPaperStateCopy(binding, 'resolving-identity');
    setQuickBuyClass(slot, 'tango-native-buy-overridden', true);
    if (!commitPaperQuickBuy(slot, binding, action)) return false;
    slot.dataset.tangoAmountSol = String(amountNative);
    slot.dataset.tangoPaperLabel = paperLabel;
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoBindingKey;
    slot.__tangoOriginalQuickBuy = nativeControl || null;
    trackedQuickBuySlots.add(slot);
    removeDuplicatePaperControls(slot, replacement);
    syncQuickBuyPresentation(slot);
    return true;
  }

  function activatePendingQuickBuy(slot, binding, {
    card, nativeControl, chain, chainDefinition, address, bindingKey, href,
    amountNative, paperLabel, policyKey, onQuickBuy, now = Date.now()
  }) {
    if (binding?.state !== 'resolving-identity' || binding.card !== card
      || !binding.replacement?.isConnected) return false;
    const replacement = binding.replacement;
    const liveNativeControl = nativeControl?.isConnected ? nativeControl : null;
    const preservedNativeControl = !liveNativeControl && binding.chain === chain
      && binding.address === address && binding.key === bindingKey
      && binding.nativeControl && !binding.nativeControl.isConnected
      ? binding.nativeControl : null;
    const verifiedNativeControl = liveNativeControl || preservedNativeControl;
    const evidence = cardAddressEvidence(card, chain);
    const claimedIntent = claimQuickBuyIdentityIntent(binding, evidence, now);
    // Another slot on this card may have advanced the shared generation while
    // its address was absent. Only the newly verified action adopts it; old
    // callbacks and pending intents keep their original generation and expire.
    const generation = cardGeneration(card);
    const bindingNonce = nextBindingNonce(generation);
    const actionId = `tango-paper-${bindingNonce}`;
    const handleClick = createQuickBuyHandler({
      slot, card, replacement, bindingKey, chain, address, actionId, onQuickBuy, amountNative
    });
    const nextBinding = Object.assign({}, binding, {
      slot, key: bindingKey, chain, address, href, card, actionId, bindingNonce, generation,
      amountNative, paperLabel, state: 'ready', invalidAmount: false,
      tradeAction: quickBuyTradeAction(slot),
      policyKey, onQuickBuy, chainDefinition,
      cardGenerationIdentity: cardGenerationIdentity(card),
      nativeControl: verifiedNativeControl, pendingOnly: false,
      operation: activeQuickBuyOperation(bindingKey, slot),
      actionHost: binding.actionHost || null
    });
    nextBinding.validate = () => liveQuickBuyIdentityMatches(nextBinding);
    const action = { bindingNonce, kind: 'execute', invoke: handleClick };
    if (!commitPaperQuickBuy(slot, nextBinding, action)) {
      if (claimedIntent && claimedIntent.expiresAt >= Date.now()
        && binding.slot.__tangoQuickBuyBinding === binding) {
        quickBuyIntents.set(binding.slot, claimedIntent);
      }
      return false;
    }
    renderQuickBuyContent(replacement, paperLabel, amountNative, chainDefinition.nativeSymbol, nextBinding.tradeAction);
    applyPaperStateCopy(nextBinding, 'ready');
    slot.dataset.tangoQuickBuy = '1';
    slot.dataset.tangoTokenAddress = address;
    slot.dataset.tangoAmountSol = String(amountNative);
    slot.dataset.tangoPaperLabel = paperLabel;
    slot.dataset.tangoActionId = actionId;
    slot.dataset.tangoBindingKey = bindingKey;
    slot.__tangoOriginalQuickBuy = verifiedNativeControl;
    if (liveNativeControl) {
      syncQuickBuyPresentation(slot);
      mountQuickBuyReplacement(slot, liveNativeControl, replacement);
      if (liveNativeControl.isConnected) liveNativeControl.remove();
      replaceAdditionalNativeQuickBuyControls(slot, nextBinding);
    } else {
      syncQuickBuyPresentation(slot);
      mountQuickBuyReplacement(slot, null, replacement);
    }
    removeDuplicatePaperControls(slot, replacement);
    if (claimedIntent) Promise.resolve().then(() => handleClick());
    return true;
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

  function quickBuySlots(roots, limit = Infinity) {
    if (!Array.isArray(roots) || !roots.length) {
      return Array.from(document.querySelectorAll('.BuyButton-continer'));
    }
    const slots = new Set();
    const add = (slot) => {
      if (slot) slots.add(slot);
      return slots.size >= limit;
    };
    for (const root of roots) {
      if (root?.matches?.('.BuyButton-continer') && add(root)) break;
      for (const slot of root?.querySelectorAll?.('.BuyButton-continer') || []) {
        if (add(slot)) break;
      }
      if (slots.size >= limit) break;
      const closest = root?.closest?.('.BuyButton-continer');
      if (closest && add(closest)) break;
      const card = root?.closest?.('[class~="group/a"]');
      const scope = card || root?.closest?.('[data-sentry-component="TrenchColumn"]');
      for (const slot of scope?.querySelectorAll?.('.BuyButton-continer') || []) {
        if (add(slot)) break;
      }
      if (slots.size >= limit) break;
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
      if (!slot?.isConnected || !binding?.card?.isConnected) {
        restoreQuickBuySlot(slot, false);
      }
    }
  }

  function quickBuyBindingMatches(slot, binding, chain = chainFromUrl()) {
    if (!binding || !slot?.isConnected || !binding.card?.isConnected || chain !== binding.chain) return false;
    if (slot.closest?.('[class~="group/a"]') !== binding.card) return false;
    if (!trenchColumn(binding.card)) return false;
    const href = cardTokenHref(binding.card, chain);
    const address = href ? Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(href)) : '';
    if (address !== binding.address || binding.key !== `${chain}:${address}`) return false;
    const nativeControl = nativeQuickBuyControl(slot);
    const amountNative = cardQuickBuyAmount(binding.card, nativeControl, slot, binding.amountNative);
    return Number(amountNative) === Number(binding.amountNative);
  }

  function quickBuyBindingIdentityDrifted(slot, binding, chain = chainFromUrl()) {
    if (!binding || !slot?.isConnected || !binding.card?.isConnected || chain !== binding.chain) return true;
    if (slot.closest?.('[class~="group/a"]') !== binding.card) return true;
    const href = cardTokenHref(binding.card, chain);
    if (!href) return false;
    const address = Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(href));
    return address !== binding.address;
  }

  function removeDuplicatePaperControls(slot, replacement) {
    for (const control of slot.querySelectorAll?.('.tango-list-quick-buy') || []) {
      if (control !== replacement) control.remove?.();
    }
  }

  function holdQuickBuyPending(
    slot, binding, nativeControl = null, trustedNativePresentation = false
  ) {
    const replacement = binding?.replacement;
    if (!slot?.isConnected || !binding?.card?.isConnected || !replacement?.isConnected) return false;
    if (binding.state === 'resolving-identity') {
      if (!setPaperState(slot, binding, 'resolving-identity')) return false;
      if (nativeControl?.isConnected) syncQuickBuyPresentation(slot);
      removeNativeQuickBuyControls(slot);
      removeDuplicatePaperControls(slot, replacement);
      return true;
    }
    if (binding.state !== 'resolving-identity') advanceCardGeneration(binding.card);
    const generation = cardGeneration(binding.card);
    const bindingNonce = nextBindingNonce(generation);
    const actionId = `tango-paper-${bindingNonce}`;
    const nextBinding = Object.assign({}, binding, {
      slot, key: '', address: '', href: '', actionId, bindingNonce, generation,
      state: 'resolving-identity', pendingOnly: false, operation: null,
      cardGenerationIdentity: cardGenerationIdentity(binding.card)
    });
    nextBinding.validate = () => liveQuickBuyIdentityMatches(nextBinding);
    const action = {
      bindingNonce,
      kind: 'intent',
      invoke: () => acceptQuickBuyIdentityActivation(
        nextBinding, quickBuyActivationContext(nextBinding)
      )
    };
    applyPaperStateCopy(nextBinding, 'resolving-identity');
    if (!commitPaperQuickBuy(slot, nextBinding, action)) return false;
    setQuickBuyClass(slot, 'tango-native-buy-overridden', true);
    slot.dataset.tangoQuickBuy = '1';
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoBindingKey;
    syncQuickBuyPresentation(slot);
    removeNativeQuickBuyControls(slot);
    removeDuplicatePaperControls(slot, replacement);
    return true;
  }

  function unboundQuickBuySlotEligible(slot, chain, nativeControl = null) {
    if (!slot?.isConnected || !chain) return false;
    if (slot.dataset?.tangoQuickBuy === '1') return false;
    const rect = nativeControl?.getBoundingClientRect?.() || slot.getBoundingClientRect?.() || {};
    if (!(Number(rect.width) > 0) || !(Number(rect.height) > 0)) return false;
    const card = slot.closest?.('[class~="group/a"]');
    return Boolean(card?.isConnected);
  }

  function pendingQuickBuyReady(slot, chain, nativeControl = null) {
    if (!slot?.isConnected || !chain) return false;
    const card = slot.closest?.('[class~="group/a"]');
    if (!card?.isConnected || !trenchColumn(card)) return false;
    const href = cardTokenHref(card, chain);
    const address = href ? Tango.Chains.normalizeAddress(chain, tokenAddressFromUrl(href)) : '';
    const amountNative = cardQuickBuyAmount(card, nativeControl, slot, slot.dataset.tangoAmountSol);
    return amountNative > 0 && Tango.Chains.validateAddress(chain, address);
  }

  function quickBuyNeedsReconcile() {
    pruneExpiredQuickBuyIdentityIntents();
    if (!isTrenchPage()) return false;
    const chain = chainFromUrl();
    const probeSlots = [];
    for (const slot of trackedQuickBuySlots) {
      const binding = slot?.__tangoQuickBuyBinding;
      const replacement = binding?.replacement;
      if (!slot?.isConnected || !binding?.card?.isConnected || !replacement?.isConnected) return true;
      const nativeControl = nativeQuickBuyControl(slot);
      if (nativeControl) return true;
      if (binding.chain !== chain || slot.closest?.('[class~="group/a"]') !== binding.card) return true;
      if (replacement.dataset?.tangoPublished !== '1'
        || !Tango.NativeQuickBuyGuard?.isPaperActionTrusted?.(
          replacement, paperGuardIdentity(binding)
        )) return true;
      const profile = nativeQuickBuyProfile(slot, replacement, nativeControl);
      if (replacement.className !== 'tango-list-quick-buy'
        || replacement.style?.cssText
        || replacement.dataset?.tangoQuickBuySize !== profile.id
        || slot.dataset?.tangoQuickBuySize !== profile.id
        || ['heightPx', 'heightCss', 'widthPx', 'amountTextPx', 'hintTextPx'].some(
          (key) => binding.quickBuyProfile?.[key] !== profile[key]
        )
        || (slot.style?.getPropertyValue && Object.entries(quickBuyGeometryValues(profile)).some(
          ([name, value]) => slot.style.getPropertyValue(name) !== value
        ))) return true;
      if (replacement.dataset?.tangoPaperAction !== 'quick-buy'
        || replacement.dataset?.tangoActionId !== binding.actionId
        || replacement.dataset?.tangoBindingNonce !== binding.bindingNonce
        || replacement.dataset?.tangoPaperState !== binding.state) return true;
      probeSlots.push({ kind: binding.state === 'resolving-identity' ? 'pending' : 'identity', slot, nativeControl });
    }
    const unboundSlots = Array.from(document.querySelectorAll?.(
      '.BuyButton-continer:not([data-tango-quick-buy="1"])'
    ) || []);
    unboundSlots.forEach((slot) => probeSlots.push({ kind: 'unbound', slot }));
    if (!probeSlots.length) {
      quickBuyProbeCursor = 0;
      return false;
    }
    const budget = Math.min(24, probeSlots.length);
    const start = quickBuyProbeCursor % probeSlots.length;
    quickBuyProbeCursor = (start + budget) % probeSlots.length;
    for (let offset = 0; offset < budget; offset += 1) {
      const probe = probeSlots[(start + offset) % probeSlots.length];
      if (probe.kind === 'identity') {
        const binding = probe.slot?.__tangoQuickBuyBinding;
        if (quickBuyBindingIdentityDrifted(probe.slot, binding, chain)) return true;
        continue;
      }
      const nativeControl = probe.nativeControl || nativeQuickBuyControl(probe.slot);
      if (probe.kind === 'pending'
        ? pendingQuickBuyReady(probe.slot, chain, nativeControl)
        : unboundQuickBuySlotEligible(probe.slot, chain, nativeControl)) return true;
    }
    return false;
  }

  function discoverTokenCards(
    onQuickBuy, defaultAmountSol = 0.1, paperLabel = 'PAPER', roots,
    { fast = false, addedRoots = [], removedRoots = [], hrefMutations = [], policyKey = '' } = {}
  ) {
    pruneExpiredQuickBuyIdentityIntents();
    const incremental = Array.isArray(roots) && roots.length > 0;
    const chain = chainFromUrl();
    const ineligibleBirthRoots = tokenItemRootsInMutationRoots(removedRoots);
    const hrefDiscontinuityRoots = hrefDiscontinuityTokenRoots(hrefMutations, chain);
    hrefDiscontinuityRoots.forEach((root) => {
      ineligibleBirthRoots.add(root);
      invalidateQuickBuyBirth(quickBuyCardBirths.get(root));
    });
    invalidateRemovedQuickBuyBirths(removedRoots);
    invalidateQuickBuyBirthsInRoots(roots, chain);
    cleanupDisconnectedQuickBuySlots(roots);
    if (!isTrenchPage()) {
      if (!incremental) clearQuickBuy(false);
      return 0;
    }
    const chainDefinition = Tango.Chains.get(chain);
    if (!chainDefinition) return 0;
    const births = recordQuickBuyCardBirths(addedRoots, chain, Date.now(), ineligibleBirthRoots);
    const nativeSlots = quickBuySlots(roots, fast ? FAST_QUICK_BUY_SLOT_LIMIT : Infinity);
    if (!incremental) {
      const candidateSlots = new Set(nativeSlots);
      document.querySelectorAll('.tango-native-buy-overridden').forEach((slot) => {
        if (!candidateSlots.has(slot)) restoreQuickBuySlot(slot, false);
      });
    }
    let injected = 0;
    for (const slot of nativeSlots) {
      if (!slot?.isConnected) {
        restoreQuickBuySlot(slot, false);
        continue;
      }
      let existingBinding = slot.__tangoQuickBuyBinding;
      let nativeControl = nativeQuickBuyControl(slot);
      const card = slot.closest?.('[class~="group/a"]');
      if (!card?.isConnected) {
        if (!holdQuickBuyPending(slot, existingBinding, nativeControl)
          && slot.dataset.tangoQuickBuy === '1') {
          restoreQuickBuySlot(slot, false);
        }
        continue;
      }
      const birth = quickBuyBirthForSlot(births, card, slot, chain);
      if (existingBinding && existingBinding.card !== card) {
        advanceCardGeneration(existingBinding.card);
        restoreQuickBuySlot(slot, false);
        existingBinding = null;
        nativeControl = nativeQuickBuyControl(slot);
      }
      if (existingBinding?.state === 'resolving-identity'
        && !quickBuyBirthMatchesBinding(existingBinding.birth, existingBinding)) {
        cancelQuickBuyIdentityIntent(existingBinding, 'birth-drift');
      }
      const amountSol = cardQuickBuyAmount(card, nativeControl, slot, defaultAmountSol);
      const pendingAmount = amountSol > 0 ? amountSol : (Number(defaultAmountSol) || 0.1);
      if (!(amountSol > 0) && quickBuyTradeAction(slot).side === 'BUY') {
        if (holdQuickBuyPending(slot, existingBinding, nativeControl)
          || createPendingQuickBuy(slot, card, nativeControl, chain, chainDefinition, 0, paperLabel, birth, onQuickBuy, policyKey)) {
          const invalid = slot.__tangoQuickBuyBinding;
          cancelQuickBuyIdentityIntent(invalid, 'invalid-amount');
          invalid.invalidAmount = true;
          invalid.replacement.disabled = true;
          invalid.replacement.setAttribute?.('aria-disabled', 'true');
          invalid.replacement.title = 'Tango Paper Buy — enter a positive amount';
          invalid.replacement.setAttribute?.('aria-label', invalid.replacement.title);
          invalid.replacement.dataset.tangoPaperState = 'invalid-amount';
          slot.dataset.tangoPaperState = 'invalid-amount';
          slot.dataset.tangoAmountSol = '0';
          renderQuickBuyContent(invalid.replacement, paperLabel, '—', chainDefinition.nativeSymbol);
          Tango.NativeQuickBuyGuard?.revokePaperAction?.(invalid.replacement);
        }
        continue;
      }
      if (existingBinding?.state === 'resolving-identity'
        && (existingBinding.chain !== chain
          || Number(existingBinding.amountNative) !== Number(pendingAmount)
          || (existingBinding.tradeAction?.key || 'BUY') !== quickBuyTradeAction(slot).key
          || existingBinding.paperLabel !== paperLabel
          || existingBinding.policyKey !== policyKey)) {
        cancelQuickBuyIdentityIntent(existingBinding, 'binding-drift');
        advanceCardGeneration(card);
        existingBinding = null;
        nativeControl = nativeQuickBuyControl(slot);
      }
      if (!trenchColumn(card)) {
        if (!(existingBinding?.card === card && holdQuickBuyPending(slot, existingBinding, nativeControl))
          && !createPendingQuickBuy(
            slot, card, nativeControl, chain, chainDefinition, pendingAmount, paperLabel,
            birth, onQuickBuy, policyKey
          )) {
          if (slot.dataset.tangoQuickBuy === '1'
            && slot.__tangoQuickBuyBinding?.replacement?.dataset?.tangoPublished !== '1') {
            restoreQuickBuySlot(slot, false);
          }
        } else if (!existingBinding) {
          injected += 1;
        }
        continue;
      }
      const evidence = cardAddressEvidence(card, chain);
      if (!evidence) {
        if (!holdQuickBuyPending(slot, existingBinding, nativeControl)
          && !createPendingQuickBuy(
            slot, card, nativeControl, chain, chainDefinition, pendingAmount, paperLabel,
            birth, onQuickBuy, policyKey
          )) {
          if (slot.dataset.tangoQuickBuy === '1'
            && slot.__tangoQuickBuyBinding?.replacement?.dataset?.tangoPublished !== '1') {
            restoreQuickBuySlot(slot, false);
          }
        } else if (!existingBinding) {
          injected += 1;
        }
        continue;
      }
      const { address, href } = evidence;
      const metadata = verifiedCardMetadata(card, address, chain);
      if (!Tango.Chains.validateAddress(chain, address) || !(amountSol > 0)) {
        const trustedNativePresentation = Boolean(existingBinding
          && existingBinding.chain === chain && existingBinding.address === address
          && existingBinding.key === `${chain}:${address}` && existingBinding.card === card);
        if (!holdQuickBuyPending(
          slot, existingBinding, nativeControl, trustedNativePresentation
        )
          && !createPendingQuickBuy(
            slot, card, nativeControl, chain, chainDefinition, pendingAmount, paperLabel,
            birth, onQuickBuy, policyKey
          )) {
          if (slot.dataset.tangoQuickBuy === '1'
            && slot.__tangoQuickBuyBinding?.replacement?.dataset?.tangoPublished !== '1') {
            restoreQuickBuySlot(slot, false);
          }
        } else if (!existingBinding) {
          injected += 1;
        }
        continue;
      }
      const snapshotToken = {
        chain, address,
        symbol: metadata?.symbol || 'TOKEN', name: metadata?.name || metadata?.symbol || 'Token',
        logoUrl: metadata?.logoUrl || '', launchpad: metadata?.launchpad || '',
        launchMode: metadata?.launchMode || '', metadataVerified: Boolean(metadata),
        metadataSource: metadata ? 'GMGN_TRENCH' : ''
      };
      rememberTrenchSnapshot({ token: snapshotToken, quote: cardMarketSnapshot(card, chain, address, snapshotToken) });
      const bindingKey = `${chain}:${address}`;
      const liveCardGenerationIdentity = cardGenerationIdentity(card);
      if (existingBinding?.state === 'resolving-identity'
        && existingBinding.cardGenerationIdentity
        && liveCardGenerationIdentity !== existingBinding.cardGenerationIdentity) {
        cancelQuickBuyIdentityIntent(existingBinding, 'card-reuse');
        advanceCardGeneration(card);
        existingBinding = null;
      }
      if (existingBinding?.state === 'resolving-identity'
        && existingBinding.chain === chain
        && Number(existingBinding.amountNative) === Number(amountSol)) {
        activatePendingQuickBuy(slot, existingBinding, {
           card, nativeControl, chain, chainDefinition, address, bindingKey, href,
           amountNative: amountSol, paperLabel, policyKey, onQuickBuy
        });
        continue;
      }
      if (existingBinding?.replacement?.isConnected && existingBinding.key === bindingKey
        && existingBinding.generation === cardGeneration(card)
        && (existingBinding.tradeAction?.key || 'BUY') === quickBuyTradeAction(slot).key
        && Number(existingBinding.amountNative) === amountSol && existingBinding.paperLabel === paperLabel
        && existingBinding.policyKey === policyKey
        && existingBinding.card === card) {
        // GMGN can reconcile the original control back into the slot. Remove it again fail-closed.
        setQuickBuyClass(slot, 'tango-native-buy-overridden', true);
        slot.dataset.tangoQuickBuy = '1';
        slot.dataset.tangoTokenAddress = address;
        slot.dataset.tangoAmountSol = String(amountSol);
        slot.dataset.tangoPaperLabel = paperLabel;
        slot.dataset.tangoActionId = existingBinding.actionId;
        slot.dataset.tangoBindingKey = bindingKey;
        existingBinding.replacement.dataset.tangoActionId = existingBinding.actionId;
        setPaperState(slot, existingBinding, existingBinding.operation ? 'in-flight' : 'ready');
        if (nativeControl) {
          // Treat each coherent React reinsertion as the current authoritative native generation.
          // Keeping earlier detached generations would duplicate or revive stale real-money controls on master OFF.
          existingBinding.nativeControl = nativeControl;
          slot.__tangoOriginalQuickBuy = nativeControl;
          syncQuickBuyPresentation(slot);
          mountQuickBuyReplacement(slot, nativeControl, existingBinding.replacement);
          if (nativeControl.isConnected) nativeControl.remove();
          replaceAdditionalNativeQuickBuyControls(slot, existingBinding);
        } else {
          syncQuickBuyPresentation(slot);
          mountQuickBuyReplacement(slot, null, existingBinding.replacement);
        }
        removeDuplicatePaperControls(slot, existingBinding.replacement);
        continue;
      }
      if (existingBinding) {
        if (existingBinding.card === card
          && (existingBinding.chain !== chain || existingBinding.address !== address)) {
          advanceCardGeneration(card);
        }
      }
      if (!nativeControl) nativeControl = nativeQuickBuyControl(slot);
      const { replacement, quickBuyProfile } = createQuickBuyReplacement(
        slot, card, chain, nativeControl, amountSol, paperLabel, chainDefinition
      );
      const { generation, bindingNonce } = createQuickBuyGeneration({
        slot, card, chain, address, href, amountNative: amountSol
      });
      const actionId = `tango-paper-${bindingNonce}`;
      const handleClick = createQuickBuyHandler({
        slot, card, replacement, bindingKey, chain, address, actionId,
        onQuickBuy, amountNative: amountSol
      });
      setQuickBuyClass(slot, 'tango-native-buy-overridden', true);
      const existingOperation = activeQuickBuyOperation(bindingKey, slot);
      const binding = {
        slot, key: bindingKey, chain, address, href, card, nativeControl, replacement,
        actionId, bindingNonce, generation, state: existingOperation ? 'in-flight' : 'ready',
        amountNative: amountSol, paperLabel, policyKey, onQuickBuy, chainDefinition, quickBuyProfile,
        tradeAction: quickBuyTradeAction(slot),
        pendingOnly: false,
        cardGenerationIdentity: liveCardGenerationIdentity,
        actionHost: null, additionalNativeControls: [], operation: existingOperation
      };
      binding.validate = () => liveQuickBuyIdentityMatches(binding);
      const action = { bindingNonce, kind: 'execute', invoke: handleClick };
      applyPaperStateCopy(binding, binding.state);
      if (!commitPaperQuickBuy(slot, binding, action)) continue;
      slot.dataset.tangoTokenAddress = address;
      slot.dataset.tangoAmountSol = String(amountSol);
      slot.dataset.tangoPaperLabel = paperLabel;
      slot.dataset.tangoBindingKey = bindingKey;
      slot.__tangoOriginalQuickBuy = nativeControl;
      trackedQuickBuySlots.add(slot);
      mountQuickBuyReplacement(slot, nativeControl, replacement);
      if (nativeControl?.isConnected) nativeControl.remove();
      replaceAdditionalNativeQuickBuyControls(slot, binding);
      removeDuplicatePaperControls(slot, replacement);
      syncQuickBuyPresentation(slot);
      injected += 1;
    }
    return injected;
  }

  function clearQuickBuy(restoreCurrent = true) {
    [...trackedQuickBuySlots].forEach((slot) => restoreQuickBuySlot(slot, restoreCurrent));
    document.querySelectorAll('.tango-native-buy-overridden').forEach((slot) => {
      restoreQuickBuySlot(slot, restoreCurrent);
    });
    document.querySelectorAll('.tango-list-quick-buy').forEach((element) => element.remove());
    quickBuyIntents.clear();
    quickBuyCardBirths = new WeakMap();
    quickBuyProbeCursor = 0;
  }

  function restoreQuickBuySlot(slot, restoreCurrent = true) {
    const binding = slot?.__tangoQuickBuyBinding;
    const replacement = binding?.replacement || slot?.__tangoReplacementQuickBuy;
    const original = binding?.nativeControl || slot?.__tangoOriginalQuickBuy;
    Tango.NativeQuickBuyGuard?.revokePaperAction?.(replacement);
    cancelQuickBuyIdentityIntent(binding, 'restored');
    trackedQuickBuySlots.delete(slot);
    binding?.actionHost?.classList?.remove?.('tango-quick-buy-action-host');
    clearLockedQuickBuyStructuralHosts(binding);
    const canRestore = restoreCurrent && replacement?.isConnected && original && !original.isConnected
      && original.parentNode == null
      && !nativeQuickBuyControl(slot)
      && !binding?.pendingOnly && quickBuyBindingMatches(slot, binding);
    if (canRestore) replacement.replaceWith(original);
    else replacement?.remove?.();
    if (canRestore) restoreAdditionalNativeQuickBuyControls(slot, binding);
    for (const [name, [value, priority]] of slot.__tangoQuickBuyOriginalGeometry || []) {
      if (value) slot.style?.setProperty?.(name, value, priority);
      else slot.style?.removeProperty?.(name);
    }
    delete slot.__tangoQuickBuyOriginalGeometry;
    delete slot.__tangoQuickBuyBinding;
    delete slot.__tangoOriginalQuickBuy;
    delete slot.__tangoReplacementQuickBuy;
    delete slot.__tangoQuickBuyCard;
    slot.classList.remove('tango-native-buy-overridden', 'tango-quick-expanded', 'tango-quick-narrow');
    delete slot.dataset.tangoQuickBuy;
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoAmountSol;
    delete slot.dataset.tangoPaperLabel;
    delete slot.dataset.tangoActionId;
    delete slot.dataset.tangoBindingNonce;
    delete slot.dataset.tangoCardGeneration;
    delete slot.dataset.tangoPaperState;
    delete slot.dataset.tangoBindingKey;
    delete slot.dataset.tangoQuickSize;
    delete slot.dataset.tangoQuickBuySize;
  }

  Tango.GMGN = {
    chainFromUrl, tokenAddressFromUrl, parseMoney, readCurrentToken, readVerifiedCurrentTokenSnapshot, readVisibleTokenMetadata, discoverTokenCards, clearQuickBuy,
    quickBuyNeedsReconcile,
    rememberTrenchSnapshot, readTrenchSnapshot,
    resolveCurrentTokenRead, needsCurrentTokenRead,
    _cardMarketCap: cardMarketCap, _cardSymbol: cardSymbol, _tokenIdentityFromText: tokenIdentityFromText,
    _cardIdentityFromText: cardIdentityFromText, _addressHintMatches: addressHintMatches,
    _cardTokenLogo: cardTokenLogo, _cardTokenHref: cardTokenHref,
    _cardLaunchpad: cardLaunchpad, _verifiedCardMetadata: verifiedCardMetadata, _detailTokenIdentity: detailTokenIdentity,
    _findTokenDetailScope: findTokenDetailScope, _tokenLogo: tokenLogo,
    _resolveCurrentTokenRead: resolveCurrentTokenRead, _needsCurrentTokenRead: needsCurrentTokenRead,
    _selectQuickBuyAmount: selectQuickBuyAmount,
    _lockedQuickBuyProfile: LOCKED_QUICK_BUY_PROFILE,
    _applyLockedQuickBuyPresentation: applyLockedQuickBuyPresentation,
    _registerPaperQuickBuy: registerPaperQuickBuy,
    _commitPaperQuickBuy: commitPaperQuickBuy,
    _createQuickBuyGeneration: createQuickBuyGeneration,
    _recordQuickBuyIdentityIntent: recordQuickBuyIdentityIntent,
    _acceptQuickBuyIdentityActivation: acceptQuickBuyIdentityActivation,
    _activatePendingQuickBuy: activatePendingQuickBuy,
    _claimQuickBuyIdentityIntent: claimQuickBuyIdentityIntent,
    _cancelQuickBuyIdentityIntent: cancelQuickBuyIdentityIntent,
    _pruneExpiredQuickBuyIdentityIntents: pruneExpiredQuickBuyIdentityIntents,
    _quickBuyIdentityIntentTtlMs: QUICK_BUY_IDENTITY_INTENT_TTL_MS,
    _cardAddressEvidence: cardAddressEvidence,
    _quickBuyBirthForRoot: (root) => quickBuyCardBirths.get(root) || null,
    _quickBuyIntentCount: () => quickBuyIntents.size,
    _markChartFrameReady: markChartFrameReady, _invalidateChartFrame: invalidateChartFrame,
    _clearChartTrust: clearChartTrust, _hasTrustedChart: hasTrustedChart,
    _isTrenchPage: isTrenchPage,
    _isTokenDetailPage: isTokenDetailPage,
    _clearTrenchSnapshots: () => trenchSnapshots.clear()
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGN;
})(globalThis);
