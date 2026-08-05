(function initGmgnAdapter(global) {
  const Tango = global.Tango = global.Tango || {};
  const quickBuyActions = new Map();
  const quickBuyIntents = new Map();
  const quickBuyCardGenerations = new WeakMap();
  let quickBuyCardBirths = new WeakMap();
  let quickBuySeenTokenRoots = new WeakSet();
  const quickBuyOperations = new Map();
  const trackedQuickBuySlots = new Set();
  const trenchColumns = new WeakMap();
  let quickBuyPresentationsByColumn = new WeakMap();
  const quickBuyPresentationsByChain = new Map();
  const trenchSnapshots = new Map();
  const MAX_TRENCH_SNAPSHOTS = 200;
  const QUICK_BUY_IDENTITY_INTENT_TTL_MS = 300;
  const FDV_MARKET_CAP_TOLERANCE = 2;
  let lastVerifiedDetail = null;
  let quickBuyProbeCursor = 0;
  let quickBuyPresentationRevision = 0;
  let quickBuyGenerationSequence = 0;
  let quickBuyNonceSequence = 0;
  const TOKEN_ITEM_ROOT_SELECTOR =
    '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]';
  const FAST_QUICK_BUY_SLOT_LIMIT = 24;
  let chartTrustByFrame = new WeakMap();
  const CHART_FRAME_SELECTOR = 'iframe[title="Financial Chart"], iframe[title="TradingView"], [data-sentry-component="TradingView"] iframe';

  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.source !== 'TANGO_GMGN_PAGE') return;
      invokeQuickBuyAction(event.data?.actionId, event.data?.bindingNonce, event.data?.type);
    });
  }

  function invokeQuickBuyAction(actionId, bindingNonce, type) {
    const action = quickBuyActions.get(String(actionId || ''));
    const expectedKind = type === 'PAPER_QUICK_BUY_INTENT' ? 'intent'
      : (type === 'PAPER_QUICK_BUY_CLICK' ? 'execute' : '');
    if (!action || !expectedKind || action.kind !== expectedKind
      || action.bindingNonce !== String(bindingNonce || '')) return undefined;
    return action.invoke();
  }

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

  function detailQuote(detail, chain, address) {
    const quoteScope = detail?.quoteScope || detail?.bindingScope || detail?.scope;
    if (!quoteScope) return null;
    const hasKline = hasTrustedChart(chain, address);
    const priceUsd = hasKline ? findPrice(quoteScope) : 0;
    const baseInfo = baseInfoPriceView(quoteScope);
    const baseItems = baseInfo ? Array.from(baseInfo.querySelectorAll('[data-sentry-component="InfoItem"]')) : [];
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
    const exactSupply = hasKline ? declaredSupply : 0;
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
      || verified.routeKey !== chartRouteKey(chain, address) || verified.chainBound !== true
      || !hasTrustedChart(chain, address)) return null;

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

  const QUICK_BUY_SIZE_PROFILES = Object.freeze({
    small: Object.freeze({ id: 'small', heightPx: 24, textPx: 12 }),
    large: Object.freeze({ id: 'large', heightPx: 28, textPx: 13 }),
    extraLarge: Object.freeze({ id: 'extra-large', heightPx: 32, textPx: 14 }),
    giant: Object.freeze({ id: 'giant', heightPx: 36, textPx: 16 })
  });
  const QUICK_BUY_SIZE_PROFILE_LIST = Object.freeze(Object.values(QUICK_BUY_SIZE_PROFILES));
  const quickBuyProfilesByChain = new Map();
  let quickBuyProfileRevision = 0;

  function rememberQuickBuyProfile(chain, profile) {
    const current = quickBuyProfilesByChain.get(chain);
    if (!chain || !profile) return current || null;
    if (current?.profile?.id === profile.id) return current;
    const next = { profile, revision: ++quickBuyProfileRevision };
    quickBuyProfilesByChain.set(chain, next);
    return next;
  }

  function quickBuyUtilityClass(name) {
    const token = String(name || '').trim();
    let bracketDepth = 0;
    let parenthesisDepth = 0;
    let escaped = false;
    let separator = -1;
    for (let index = 0; index < token.length; index += 1) {
      const character = token[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '[') bracketDepth += 1;
      else if (character === ']' && bracketDepth > 0) bracketDepth -= 1;
      else if (character === '(') parenthesisDepth += 1;
      else if (character === ')' && parenthesisDepth > 0) parenthesisDepth -= 1;
      else if (character === ':' && bracketDepth === 0 && parenthesisDepth === 0) separator = index;
    }
    return token.slice(separator + 1);
  }

  function safeQuickBuyPresentationClass(name) {
    const token = String(name || '').trim();
    const utility = quickBuyUtilityClass(token);
    const modifiers = utility.match(/^[!-]+/)?.[0] || '';
    const baseUtility = utility.slice(modifiers.length);
    if (!token || utility === 'tango-list-quick-buy' || utility === 'tango-quick-buy-fallback') return false;
    if (token.endsWith('!')) return false;
    if (token !== utility) return false;
    if (modifiers.includes('-') || baseUtility.startsWith('[')) return false;
    if (modifiers.includes('!')) return false;
    if (/^(?:h|min-h|max-h|w|min-w|max-w|size|p[trblxy]?|m[trblxy]?|gap(?:-[xy])?|space-[xy]|font|leading|tracking)-/.test(baseUtility)) return false;
    if (/^text-\[(?:length:)?[^\]]+\]$/.test(baseUtility) || /^text-(?:xs|sm|base|lg|xl|\d+xl)$/.test(baseUtility)) return false;
    if (/^(?:hidden|invisible|collapse|contents|sr-only|opacity-.+|pointer-events-.+)$/.test(baseUtility)) return false;
    if (/^(?:static|fixed|absolute|relative|sticky)$/.test(baseUtility)) return false;
    if (/^(?:transform(?:-gpu|-cpu|-none)?|translate-[xy]-.+|scale(?:-[xy])?-.+|rotate-.+|skew-[xy]-.+|origin-.+)$/.test(baseUtility)) return false;
    if (/^(?:inset(?:-[xy])?|top|right|bottom|left|z|order|float|clear)-/.test(baseUtility)) return false;
    if (/^(?:is-)?(?:loading|disabled|pending)$/.test(baseUtility) || /^animate-/.test(baseUtility)) return false;
    const layoutUtility = /^(?:flex-(?:(?:row|col)(?:-reverse)?|wrap(?:-reverse)?|nowrap)|grid-flow-.+|items-.+|content-.+|justify-.+|self-.+|place-(?:content|items|self)-.+|text-(?:left|center|right|justify|start|end)|align-.+)$/.test(baseUtility);
    if (layoutUtility || /^(?:flex|inline-flex|grid|inline-grid)$/.test(baseUtility)) return false;
    return /^(?:text|border|outline|shadow|fill|stroke)-/.test(baseUtility)
      || /^(?:rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?|border)$/.test(baseUtility);
  }

  function safeQuickBuyStyleProperty(property, value) {
    const name = String(property || '').trim().toLowerCase();
    const source = String(value || '').trim();
    if (!name || !source) return false;
    if (name === '--customize-button-ultra-color') return true;
    return /^(?:color|border(?:-(?:top|right|bottom|left))?(?:-(?:color|style|width|radius))?|border-radius|outline(?:-(?:color|style|width|offset))?|box-shadow|fill|stroke)$/.test(name);
  }

  function sanitizeQuickBuyStyleText(styleText) {
    return String(styleText || '').split(';').map((declaration) => declaration.trim()).filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator < 1) return null;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const value = declaration.slice(separator + 1).trim();
        return safeQuickBuyStyleProperty(property, value) ? `${property}: ${value};` : null;
      }).filter(Boolean).join(' ');
  }

  function quickBuyProfileSignalFromPresentation(className, styleText) {
    const classSource = String(className || '');
    const styleSource = String(styleText || '');
    const height = Number(
      classSource.match(/(?:^|\s)!?h-\[(\d+(?:\.\d+)?)px\](?=\s|$)/)?.[1]
      || styleSource.match(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px\b/i)?.[1]
      || 0
    );
    const text = Number(
      classSource.match(/(?:^|\s)!?text-\[(\d+(?:\.\d+)?)px\](?=\s|$)/)?.[1]
      || styleSource.match(/(?:^|;)\s*font-size\s*:\s*(\d+(?:\.\d+)?)px\b/i)?.[1]
      || 0
    );
    if (!height && !text) return null;
    if (height && text) return QUICK_BUY_SIZE_PROFILE_LIST.find((profile) =>
      profile.heightPx === height && profile.textPx === text) || null;
    return QUICK_BUY_SIZE_PROFILE_LIST.reduce((closest, profile) => {
      const closestDistance = Math.abs((height ? closest.heightPx : closest.textPx) - (height || text));
      const candidateDistance = Math.abs((height ? profile.heightPx : profile.textPx) - (height || text));
      return candidateDistance < closestDistance ? profile : closest;
    }, QUICK_BUY_SIZE_PROFILES.large);
  }

  function quickBuyProfileFromPresentation(className, styleText) {
    return quickBuyProfileSignalFromPresentation(className, styleText) || QUICK_BUY_SIZE_PROFILES.large;
  }

  function canonicalQuickBuyProfileFromNode(node) {
    if (!node?.isConnected) return null;
    const className = typeof node.className === 'string'
      ? node.className : String(node.className?.baseVal || '');
    const styleText = node.getAttribute?.('style') || node.style?.cssText || '';
    const height = Number(
      className.match(/(?:^|\s)!?h-\[(\d+(?:\.\d+)?)px\](?=\s|$)/)?.[1]
      || styleText.match(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px\b/i)?.[1]
      || 0
    );
    const text = Number(
      className.match(/(?:^|\s)!?text-\[(\d+(?:\.\d+)?)px\](?=\s|$)/)?.[1]
      || styleText.match(/(?:^|;)\s*font-size\s*:\s*(\d+(?:\.\d+)?)px\b/i)?.[1]
      || 0
    );
    if (!height && !text) return null;
    return QUICK_BUY_SIZE_PROFILE_LIST.find((profile) =>
      (!height || profile.heightPx === height)
      && (!text || profile.textPx === text)
    ) || null;
  }

  function quickBuyConnectedProfileSources(slot, binding, nativeControl = null) {
    if (!slot) return [];
    const replacement = binding?.replacement || slot.__tangoReplacementQuickBuy;
    const candidates = [
      nativeControl || binding?.nativeControl,
      replacement?.parentElement,
      slot.querySelector?.('[class~="group/btn"]')
    ];
    for (let node = replacement?.parentElement; node && node !== slot; node = node.parentElement) {
      candidates.push(node);
    }
    candidates.push(slot);
    return [...new Set(candidates.filter((node) => node?.isConnected))].filter((node) =>
      node.closest?.('.BuyButton-continer') === slot
    );
  }

  function readConnectedQuickBuyProfile(slot, binding, nativeControl = null) {
    for (const node of quickBuyConnectedProfileSources(slot, binding, nativeControl)) {
      const profile = canonicalQuickBuyProfileFromNode(node);
      if (profile) return { node, profile };
    }
    return null;
  }

  function readQuickBuyPresentation(control) {
    if (!control) return { className: '', styleText: '', signature: '' };
    const rawClassName = typeof control.className === 'string'
      ? control.className : String(control.className?.baseVal || '');
    const className = rawClassName.split(/\s+/)
      .filter(safeQuickBuyPresentationClass).join(' ');
    const rawStyleText = control.getAttribute?.('style') || control.style?.cssText || '';
    const styleText = sanitizeQuickBuyStyleText(rawStyleText);
    const normalizedClassName = className.trim();
    const normalizedStyleText = styleText.trim();
    return {
      className: normalizedClassName,
      styleText: normalizedStyleText,
      profile: quickBuyProfileSignalFromPresentation(rawClassName, rawStyleText),
      signature: normalizedClassName || normalizedStyleText
        ? `${normalizedClassName}\n${normalizedStyleText}` : ''
    };
  }

  function presentationSignature(control) {
    return readQuickBuyPresentation(control).signature;
  }

  function copyQuickBuyPresentation(presentation) {
    return {
      className: String(presentation?.className || ''),
      styleText: String(presentation?.styleText || ''),
      signature: String(presentation?.signature || ''),
      profile: presentation?.profile || null,
      revision: Number(presentation?.revision || 0)
    };
  }

  function isStableQuickBuyPresentationClass(name) {
    const token = String(name || '').trim();
    if (!token) return false;
    return /^(?:text|border|outline|shadow|fill|stroke)-/.test(token)
      || /^(?:rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?|border)$/.test(token);
  }

  function sharedQuickBuyPresentation(presentation) {
    const className = String(presentation?.className || '').split(/\s+/)
      .filter(isStableQuickBuyPresentationClass).join(' ');
    return {
      className,
      styleText: '',
      signature: className ? `${className}\n` : '',
      profile: presentation?.profile || null
    };
  }

  function mergeQuickBuyPresentation(localPresentation, sharedPresentation) {
    const local = copyQuickBuyPresentation(localPresentation);
    const shared = copyQuickBuyPresentation(sharedPresentation);
    if (!shared.signature) return local;
    const localClasses = local.className.split(/\s+/)
      .filter((name) => name && !isStableQuickBuyPresentationClass(name));
    const sharedClasses = shared.className.split(/\s+/).filter(Boolean);
    const className = [...localClasses, ...sharedClasses].join(' ');
    return {
      className,
      styleText: local.styleText,
      signature: className || local.styleText ? `${className}\n${local.styleText}` : '',
      profile: shared.profile || local.profile || null,
      revision: shared.revision
    };
  }

  function cachedQuickBuyPresentation(card, chain = chainFromUrl()) {
    const column = trenchColumn(card);
    const columnCached = column && quickBuyPresentationsByColumn.get(column);
    const chainCached = quickBuyPresentationsByChain.get(chain);
    const cached = columnCached || chainCached;
    return cached ? copyQuickBuyPresentation(cached) : null;
  }

  function rememberQuickBuyPresentation(card, chain, presentation) {
    if (!presentation || !chain) return cachedQuickBuyPresentation(card, chain);
    const sharedPresentation = sharedQuickBuyPresentation(presentation);
    const column = trenchColumn(card);
    const columnCached = column && quickBuyPresentationsByColumn.get(column);
    let columnRevision = Number(columnCached?.revision || 0);
    if (column && (sharedPresentation.signature || sharedPresentation.profile)) {
      const nextColumn = {
        className: sharedPresentation.signature ? sharedPresentation.className : String(columnCached?.className || ''),
        styleText: sharedPresentation.signature ? sharedPresentation.styleText : String(columnCached?.styleText || ''),
        signature: sharedPresentation.signature || String(columnCached?.signature || ''),
        profile: sharedPresentation.profile || columnCached?.profile || null
      };
      const columnChanged = !columnCached || columnCached.signature !== nextColumn.signature
        || columnCached.profile?.id !== nextColumn.profile?.id;
      columnRevision = columnChanged ? ++quickBuyPresentationRevision : columnRevision;
      quickBuyPresentationsByColumn.set(column, {
        ...nextColumn,
        revision: columnRevision
      });
    }

    const pageCached = quickBuyPresentationsByChain.get(chain);
    let pageRevision = Number(pageCached?.revision || 0);
    if (sharedPresentation.signature || sharedPresentation.profile) {
      const nextPage = {
        className: sharedPresentation.signature ? sharedPresentation.className : String(pageCached?.className || ''),
        styleText: sharedPresentation.signature ? sharedPresentation.styleText : String(pageCached?.styleText || ''),
        signature: sharedPresentation.signature || String(pageCached?.signature || ''),
        profile: sharedPresentation.profile || pageCached?.profile || null
      };
      const sharedChanged = !pageCached || pageCached.signature !== nextPage.signature
        || pageCached.profile?.id !== nextPage.profile?.id;
      pageRevision = sharedChanged ? ++quickBuyPresentationRevision : pageRevision;
      quickBuyPresentationsByChain.set(chain, {
        ...nextPage,
        revision: pageRevision
      });
    }
    return {
      ...copyQuickBuyPresentation(presentation),
      revision: Number(columnRevision || pageRevision || 0)
    };
  }

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
    replacement.type = 'button';
    replacement.dataset.tangoQuickBuy = '1';
    replacement.dataset.tangoPaperAction = 'quick-buy';
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
    if (!replacement || !expectedActionId || !card || !bindingNonce
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
      chain, address, href, amountNative
    }) === true;
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
      card: slot?.__tangoQuickBuyCard,
      handler: slot?.__tangoQuickBuyHandler
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
    if (snapshot.handler !== undefined) slot.__tangoQuickBuyHandler = snapshot.handler;
    else delete slot.__tangoQuickBuyHandler;
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
    slot.__tangoQuickBuyHandler = binding.action?.invoke;
    if (!binding.replacement.isConnected) mountQuickBuyReplacement(slot, null, binding.replacement);
  }

  function retirePreviousPaperBinding(previous, nextBinding) {
    const binding = previous.binding;
    if (!binding || binding === nextBinding) return;
    cancelQuickBuyIdentityIntent(binding, 'superseded');
    quickBuyActions.delete(String(binding.actionId || ''));
    if (binding.repairTimer) global.clearTimeout?.(binding.repairTimer);
    for (const target of binding.resizeTargets || []) binding.resizeObserver?.unobserve?.(target);
    binding.resizeObserver?.disconnect?.();
    binding.presentationObserver?.disconnect?.();
    binding.profileObserver?.disconnect?.();
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
          quickBuyActions.delete(String(previous.binding.actionId || ''));
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
    quickBuyActions.set(nextBinding.actionId, action);
    nextBinding.replacement.dataset.tangoPublished = '1';
    retirePreviousPaperBinding(previous, nextBinding);
    slot.__tangoQuickBuyHandler = action.invoke;
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

  function activeQuickBuyOperation(bindingKey) {
    const operation = quickBuyOperations.get(bindingKey);
    return operation?.inFlight ? operation : null;
  }

  function applyPaperStateCopy(binding, state) {
    const nativeSymbol = Tango.Chains.get(binding.chain)?.nativeSymbol || '';
    const copy = state === 'resolving-identity'
      ? 'Tango paper click accepted — confirming token identity'
      : (state === 'in-flight'
        ? 'Tango paper order is processing'
        : `Tango Paper Buy ${binding.amountNative} ${nativeSymbol}`.trim());
    binding.replacement.title = copy;
    binding.replacement.setAttribute?.('aria-label', copy);
  }

  function setPaperState(slot, binding, state) {
    if (!slot || slot.__tangoQuickBuyBinding !== binding || !binding?.replacement) return false;
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

  function applyInertPresentation(replacement, nativeControl, fallbackPresentation = null) {
    if (!replacement) return '';
    const livePresentation = readQuickBuyPresentation(nativeControl);
    const hasExplicitFallback = fallbackPresentation?.signature !== undefined;
    const fallback = hasExplicitFallback
      ? fallbackPresentation : readQuickBuyPresentation(fallbackPresentation);
    const currentPresentation = readQuickBuyPresentation(replacement);
    const presentation = livePresentation.signature
      ? livePresentation
      : (hasExplicitFallback ? fallback : (fallback?.signature ? fallback : currentPresentation));
    replacement.className = `${presentation.className || ''} tango-list-quick-buy`.trim();
    if (replacement.style) replacement.style.cssText = presentation.styleText || '';
    ensureInertQuickBuy(replacement);
    return presentation.signature || '';
  }

  function setStylePropertyIfChanged(style, name, value) {
    if (!style?.setProperty || style.getPropertyValue?.(name) === value) return;
    style.setProperty(name, value);
  }

  function applyQuickBuyProfile(replacement, profile, slot = null) {
    const selected = profile || QUICK_BUY_SIZE_PROFILES.large;
    const height = `${selected.heightPx}px`;
    const text = `${selected.textPx}px`;
    setStylePropertyIfChanged(replacement?.style, '--tango-quick-buy-height', height);
    setStylePropertyIfChanged(replacement?.style, '--tango-quick-buy-text', text);
    setStylePropertyIfChanged(slot?.style, '--tango-quick-buy-height', height);
    if (replacement?.dataset?.tangoQuickBuySize !== selected.id) {
      replacement.dataset.tangoQuickBuySize = selected.id;
    }
    if (slot?.dataset && slot.dataset.tangoQuickBuySize !== selected.id) {
      slot.dataset.tangoQuickBuySize = selected.id;
    }
    return selected;
  }

  function syncQuickBuyPresentation(slot, nativeControl = null) {
    const binding = slot?.__tangoQuickBuyBinding;
    const replacement = binding?.replacement || slot?.__tangoReplacementQuickBuy
      || slot?.querySelector?.('.tango-list-quick-buy');
    if (!slot || !replacement?.isConnected) {
      Tango.NativeQuickBuyGuard?.revokePaperAction?.(replacement);
      return false;
    }
    if (binding) observeQuickBuyProfileSources(slot, binding, nativeControl);
    const source = nativeControl || binding?.presentationSource;
    const connectedProfile = readConnectedQuickBuyProfile(slot, binding, nativeControl);
    const priorRememberedProfileRevision = Number(
      quickBuyProfilesByChain.get(binding?.chain)?.revision || 0
    );
    const rememberedProfile = connectedProfile?.profile
      ? rememberQuickBuyProfile(binding?.chain, connectedProfile.profile) : null;
    const connectedProfileAdvanced = Boolean(connectedProfile?.profile
      && Number(rememberedProfile?.revision || 0) > priorRememberedProfileRevision);
    const livePresentation = readQuickBuyPresentation(source);
    const cachedPresentation = cachedQuickBuyPresentation(binding?.card, binding?.chain);
    const cachedRevision = Number(cachedPresentation?.revision || 0);
    const bindingRevision = Number(binding?.presentationRevision || 0);
    const cachedIsCurrent = Boolean(cachedPresentation?.signature
      && cachedRevision > bindingRevision);
    const sourceDrifted = Boolean(source && binding
      && livePresentation.signature !== String(binding.presentationSourceSignature || ''));
    const explicitSource = nativeControl != null;
    const sourceProfileChanged = Boolean(source && livePresentation.profile
      && livePresentation.profile.id !== String(binding?.presentationSourceProfileId || ''));
    const sourceCanPromote = Boolean(explicitSource || sourceDrifted || sourceProfileChanged);
    const profileDrifted = Boolean(sourceCanPromote && livePresentation.profile
      && (livePresentation.profile.id !== cachedPresentation?.profile?.id));
    const updatedProfilePresentation = profileDrifted
      ? rememberQuickBuyPresentation(binding?.card, binding?.chain, livePresentation) : null;
    const authoritativeSource = Boolean(binding?.presentationTrusted !== false
      && (explicitSource || sourceDrifted || profileDrifted));
    const authoritativeLivePresentation = authoritativeSource
      && (livePresentation.signature || livePresentation.profile)
      ? rememberQuickBuyPresentation(binding?.card, binding?.chain, livePresentation) : null;
    const mergedCachedPresentation = cachedIsCurrent
      ? mergeQuickBuyPresentation(
        binding?.presentation || livePresentation || readQuickBuyPresentation(replacement),
        cachedPresentation
      ) : null;
    const presentation = authoritativeLivePresentation
      || mergedCachedPresentation
      || binding?.presentation
      || (livePresentation.signature ? livePresentation : null)
      || cachedPresentation || readQuickBuyPresentation(replacement);
    const profile = connectedProfile?.profile
      || updatedProfilePresentation?.profile
      || (cachedIsCurrent ? cachedPresentation?.profile : null)
      || (!sourceCanPromote ? binding?.quickBuyProfile : null)
      || (sourceCanPromote ? livePresentation.profile : null)
      || rememberedProfile?.profile
      || quickBuyProfilesByChain.get(binding?.chain)?.profile
      || cachedPresentation?.profile
      || binding?.quickBuyProfile || presentation?.profile || QUICK_BUY_SIZE_PROFILES.large;
    const currentPresentation = readQuickBuyPresentation(replacement);
    const replacementClasses = String(replacement.className || '').split(/\s+/);
    const hasTangoClass = replacementClasses.includes('tango-list-quick-buy');
    const presentationComplete = authoritativeLivePresentation
      ? true : Boolean(binding?.presentationComplete);
    const shouldUseFallback = !presentation.signature || !presentationComplete;
    const hasFallbackClass = replacementClasses.includes('tango-quick-buy-fallback');
    if (binding?.presentationSignature !== presentation.signature
      || currentPresentation.signature !== presentation.signature || !hasTangoClass
      || hasFallbackClass !== shouldUseFallback) {
      const presentationSource = authoritativeLivePresentation ? source : null;
      const applied = applyInertPresentation(replacement, presentationSource, presentation);
      if (shouldUseFallback) {
        replacement.className = `${replacement.className} tango-quick-buy-fallback`.trim();
      }
      if (binding) binding.presentationSignature = applied;
    }
    ensureInertQuickBuy(replacement);
    const appliedProfile = applyQuickBuyProfile(replacement, profile, slot);
    if (binding) {
      binding.presentation = presentation;
      binding.presentationRevision = Number(presentation?.revision || cachedPresentation?.revision || 0);
      binding.presentationComplete = presentationComplete;
      binding.quickBuyProfile = appliedProfile;
      if (source && sourceCanPromote) {
        binding.presentationSourceSignature = livePresentation.signature;
        binding.presentationSourceProfileId = livePresentation.profile?.id || '';
      }
      registerPaperQuickBuy(slot, binding, binding.actionId);
    }
    if (binding?.chain && connectedProfileAdvanced) {
      for (const otherSlot of [...trackedQuickBuySlots]) {
        if (otherSlot === slot || !otherSlot?.isConnected) continue;
        const otherBinding = otherSlot?.__tangoQuickBuyBinding;
        if (otherBinding?.slot !== otherSlot || !otherBinding.card?.isConnected
          || !otherBinding.replacement?.isConnected || otherBinding.chain !== binding.chain
          || otherBinding.quickBuyProfile?.id === connectedProfile.profile.id
          || readConnectedQuickBuyProfile(otherSlot, otherBinding)?.profile) continue;
        otherBinding.quickBuyProfile = applyQuickBuyProfile(
          otherBinding.replacement, connectedProfile.profile, otherSlot
        );
      }
    }
    const authoritativeRevision = Number(
      authoritativeLivePresentation?.revision || updatedProfilePresentation?.revision || 0
    );
    if (binding?.chain && authoritativeRevision > cachedRevision) {
      for (const otherSlot of [...trackedQuickBuySlots]) {
        if (otherSlot === slot) continue;
        const otherBinding = otherSlot?.__tangoQuickBuyBinding;
        if (otherBinding?.chain !== binding.chain
          || Number(otherBinding.presentationRevision || 0) >= authoritativeRevision) continue;
        syncQuickBuyPresentation(otherSlot);
      }
    }
    return true;
  }

  function observeQuickBuyPresentationSource(slot, binding, source) {
    binding.presentationObserver?.disconnect?.();
    binding.presentationObserver = null;
    binding.presentationSource = source || null;
    if (!source || source === binding.replacement || typeof global.MutationObserver !== 'function') return;
    const observer = new global.MutationObserver(() => {
      if (slot.__tangoQuickBuyBinding !== binding || binding.presentationSource !== source) return;
      if (!syncQuickBuyPresentation(slot, source)) scheduleQuickBuyGeometryRepair(slot);
    });
    observer.observe(source, { attributes: true, attributeFilter: ['class', 'style'] });
    binding.presentationObserver = observer;
  }

  function observeQuickBuyProfileSources(slot, binding, nativeControl = null) {
    const sources = quickBuyConnectedProfileSources(slot, binding, nativeControl);
    const unchanged = sources.length === (binding.profileSources || []).length
      && sources.every((source, index) => source === binding.profileSources[index]);
    if (unchanged) return;
    binding.profileObserver?.disconnect?.();
    binding.profileObserver = null;
    binding.profileSources = sources;
    refreshQuickBuyResizeTargets(slot, binding);
    if (!sources.length || typeof global.MutationObserver !== 'function') return;
    const observer = new global.MutationObserver((records = []) => {
      if (slot.__tangoQuickBuyBinding !== binding) return;
      if (records.length && !records.some((record) => binding.profileSources.includes(record.target))) return;
      if (!syncQuickBuyPresentation(slot)) scheduleQuickBuyGeometryRepair(slot);
    });
    sources.forEach((source) => observer.observe(source, {
      attributes: true, attributeFilter: ['class', 'style']
    }));
    binding.profileObserver = observer;
  }

  function scheduleQuickBuyGeometryRepair(slot) {
    const binding = slot?.__tangoQuickBuyBinding;
    if (!binding || binding.repairTimer || binding.repairAttempts >= 3) return;
    binding.repairAttempts += 1;
    binding.repairTimer = global.setTimeout?.(() => {
      binding.repairTimer = null;
      if (slot.__tangoQuickBuyBinding !== binding || !slot.isConnected) return;
      if (!syncQuickBuyPresentation(slot)) scheduleQuickBuyGeometryRepair(slot);
    }, 250);
  }

  function parseQuickBuyAmount(value) {
    const normalized = String(value || '').replaceAll(',', '').trim();
    const match = normalized.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
    const amount = Number(match?.[0] || 0);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function selectQuickBuyAmount(columnValue, nativeText, previousAmount, defaultAmount) {
    return parseQuickBuyAmount(columnValue) || parseQuickBuyAmount(nativeText)
      || Number(previousAmount) || Number(defaultAmount);
  }

  function cardQuickBuyAmount(card, nativeControl, slot, defaultAmountSol) {
    const columnInput = trenchColumn(card)?.querySelector('[data-sentry-component="BuyAmountInput"] input');
    return selectQuickBuyAmount(columnInput?.value, nativeControl?.textContent, slot.dataset.tangoAmountSol, defaultAmountSol);
  }

  function renderQuickBuyContent(replacement, paperLabel, amountNative, nativeSymbol) {
    replacement.textContent = '';
    const wrapper = document.createElement('span');
    wrapper.className = 'tango-quick-buy-content';
    const hint = document.createElement('span');
    hint.className = 'tango-paper-hint';
    hint.textContent = paperLabel;
    const amount = document.createElement('span');
    amount.className = 'tango-buy-amount';
    amount.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m13.688 8.12-6.471 7.705c-.206.245-.604.061-.55-.255l1.007-5.843-4.617-.061c-.88-.012-1.352-1.038-.79-1.714L8.723.191c.205-.247.605-.063.55.253L8.247 6.399l4.641.003c.888.001 1.371 1.038.8 1.718Z"/></svg><span>'
      + amountNative + ' ' + nativeSymbol + '</span>';
    wrapper.append(hint, amount);
    replacement.append(wrapper);
  }

  function createQuickBuyReplacement(
    slot, card, chain, nativeControl, amountNative, paperLabel, chainDefinition,
    trustLivePresentation = true
  ) {
    const livePresentation = readQuickBuyPresentation(nativeControl);
    const connectedProfile = readConnectedQuickBuyProfile(slot, null, nativeControl);
    const presentationComplete = Boolean(trustLivePresentation && livePresentation.signature);
    const cachedPresentation = cachedQuickBuyPresentation(card, chain);
    const initialPresentation = presentationComplete
      ? rememberQuickBuyPresentation(card, chain, livePresentation)
      : (cachedPresentation || livePresentation);
    const profile = livePresentation.profile || connectedProfile?.profile
      || quickBuyProfilesByChain.get(chain)?.profile
      || cachedPresentation?.profile
      || initialPresentation?.profile || QUICK_BUY_SIZE_PROFILES.large;
    const replacement = document.createElement('button');
    replacement.type = 'button';
    const initialPresentationSignature = applyInertPresentation(
      replacement, trustLivePresentation ? nativeControl : null, initialPresentation
    );
    const quickBuyProfile = applyQuickBuyProfile(replacement, profile);
    if (!presentationComplete) {
      replacement.className = `${replacement.className} tango-quick-buy-fallback`.trim();
    }
    renderQuickBuyContent(replacement, paperLabel, amountNative, chainDefinition.nativeSymbol);
    return {
      replacement,
      presentation: initialPresentation,
      presentationRevision: Number(initialPresentation?.revision || 0),
      presentationSignature: initialPresentationSignature,
      presentationComplete,
      quickBuyProfile
    };
  }

  function createQuickBuyHandler({
    slot, card, replacement, bindingKey, chain, address, actionId, onQuickBuy, amountNative
  }) {
    return async () => {
      const binding = slot.__tangoQuickBuyBinding;
      if (!slot.isConnected || !card.isConnected || !replacement.isConnected
        || binding?.actionId !== actionId || binding?.key !== bindingKey || binding?.state === 'resolving-identity') return;
      const activeOperation = activeQuickBuyOperation(bindingKey);
      if (activeOperation) {
        binding.operation = activeOperation;
        setPaperState(slot, binding, 'in-flight');
        return;
      }
      const now = Date.now();
      if (now - Number(replacement.dataset.tangoLastClickAt || 0) < 900) return;
      replacement.dataset.tangoLastClickAt = String(now);
      const operation = { key: bindingKey, inFlight: true };
      quickBuyOperations.set(bindingKey, operation);
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
          amountNative, amountSol: amountNative, sourceUrl: evidence.href
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
    const {
      replacement, presentation, presentationRevision, presentationSignature, presentationComplete,
      quickBuyProfile
    } = createQuickBuyReplacement(
      slot, card, chain, nativeControl, amountNative, paperLabel, chainDefinition, false
    );
    const { generation, bindingNonce } = createQuickBuyGeneration({
      slot, card, chain, address: '', href: '', amountNative
    });
    const actionId = `tango-paper-${bindingNonce}`;
    const binding = {
      slot, key: '', chain, address: '', href: '', card, nativeControl: nativeControl || null,
      replacement, actionId, bindingNonce, generation, state: 'resolving-identity',
      amountNative, paperLabel, policyKey, birth, birthAmountNative: amountNative, pendingOnly: false,
      onQuickBuy, chainDefinition,
      presentationSignature, presentation, presentationRevision, presentationComplete, quickBuyProfile,
      presentationSourceProfileId: presentation?.profile?.id || '',
      presentationTrusted: false,
      cardGenerationIdentity: cardGenerationIdentity(card),
      presentationSource: null, presentationObserver: null, profileObserver: null, profileSources: [], operation: null,
      additionalNativeControls: [],
      repairAttempts: 0, repairTimer: null, resizeObserver: null, resizeTargets: []
    };
    const action = {
      bindingNonce,
      kind: 'intent',
      invoke: () => acceptQuickBuyIdentityActivation(binding, quickBuyActivationContext(binding))
    };
    applyPaperStateCopy(binding, 'resolving-identity');
    slot.classList.add('tango-native-buy-overridden');
    if (!commitPaperQuickBuy(slot, binding, action)) return false;
    slot.dataset.tangoAmountSol = String(amountNative);
    slot.dataset.tangoPaperLabel = paperLabel;
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoBindingKey;
    slot.__tangoOriginalQuickBuy = nativeControl || null;
    trackedQuickBuySlots.add(slot);
    removeDuplicatePaperControls(slot, replacement);
    observeQuickBuyPresentationSource(slot, binding, nativeControl);
    if (!syncQuickBuyPresentation(slot, nativeControl)) scheduleQuickBuyGeometryRepair(slot);
    observeQuickBuySlot(slot, binding);
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
    const bindingNonce = nextBindingNonce(binding.generation);
    const actionId = `tango-paper-${bindingNonce}`;
    const handleClick = createQuickBuyHandler({
      slot, card, replacement, bindingKey, chain, address, actionId, onQuickBuy, amountNative
    });
    const nextBinding = Object.assign({}, binding, {
      slot, key: bindingKey, chain, address, href, card, actionId, bindingNonce,
      amountNative, paperLabel, state: 'ready',
      policyKey, onQuickBuy, chainDefinition,
      cardGenerationIdentity: cardGenerationIdentity(card),
      nativeControl: verifiedNativeControl, pendingOnly: false,
      presentationTrusted: Boolean(verifiedCardMetadata(card, address, chain)),
      operation: activeQuickBuyOperation(bindingKey),
      repairAttempts: 0, repairTimer: null, resizeObserver: null, resizeTargets: [],
      profileObserver: null, profileSources: []
    });
    const action = { bindingNonce, kind: 'execute', invoke: handleClick };
    if (!commitPaperQuickBuy(slot, nextBinding, action)) {
      if (claimedIntent && claimedIntent.expiresAt >= Date.now()
        && binding.slot.__tangoQuickBuyBinding === binding) {
        quickBuyIntents.set(binding.slot, claimedIntent);
      }
      return false;
    }
    renderQuickBuyContent(replacement, paperLabel, amountNative, chainDefinition.nativeSymbol);
    applyPaperStateCopy(nextBinding, 'ready');
    slot.dataset.tangoQuickBuy = '1';
    slot.dataset.tangoTokenAddress = address;
    slot.dataset.tangoAmountSol = String(amountNative);
    slot.dataset.tangoPaperLabel = paperLabel;
    slot.dataset.tangoActionId = actionId;
    slot.dataset.tangoBindingKey = bindingKey;
    slot.__tangoOriginalQuickBuy = verifiedNativeControl;
    if (liveNativeControl) {
      observeQuickBuyPresentationSource(slot, nextBinding, liveNativeControl);
      syncQuickBuyPresentation(slot, liveNativeControl);
      mountQuickBuyReplacement(slot, liveNativeControl, replacement);
      if (liveNativeControl.isConnected) liveNativeControl.remove();
      replaceAdditionalNativeQuickBuyControls(slot, nextBinding);
    } else {
      observeQuickBuyPresentationSource(slot, nextBinding, null);
      syncQuickBuyPresentation(slot);
      mountQuickBuyReplacement(slot, null, replacement);
    }
    removeDuplicatePaperControls(slot, replacement);
    observeQuickBuySlot(slot, nextBinding);
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

  function observeQuickBuySlot(slot, binding) {
    if (typeof global.ResizeObserver === 'function') {
      binding.resizeObserver = new global.ResizeObserver(() => {
        if (slot.__tangoQuickBuyBinding !== binding) return;
        if (!syncQuickBuyPresentation(slot)) scheduleQuickBuyGeometryRepair(slot);
      });
      refreshQuickBuyResizeTargets(slot, binding);
    } else {
      global.requestAnimationFrame?.(() => {
        if (slot.__tangoQuickBuyBinding === binding && !syncQuickBuyPresentation(slot)) {
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

  function refreshQuickBuyResizeTargets(slot, binding) {
    if (!binding?.resizeObserver) return;
    for (const target of binding.resizeTargets || []) binding.resizeObserver.unobserve?.(target);
    binding.resizeTargets = [...new Set([
      slot, binding.replacement, slot?.parentElement, ...(binding.profileSources || [])
    ].filter(Boolean))];
    binding.resizeTargets.forEach((target) => binding.resizeObserver.observe(target));
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
    const action = {
      bindingNonce,
      kind: 'intent',
      invoke: () => acceptQuickBuyIdentityActivation(
        nextBinding, quickBuyActivationContext(nextBinding)
      )
    };
    applyPaperStateCopy(nextBinding, 'resolving-identity');
    if (!commitPaperQuickBuy(slot, nextBinding, action)) return false;
    slot.classList.add('tango-native-buy-overridden');
    slot.dataset.tangoQuickBuy = '1';
    delete slot.dataset.tangoTokenAddress;
    delete slot.dataset.tangoBindingKey;
    if (nativeControl?.isConnected) {
      if (trustedNativePresentation) {
        observeQuickBuyPresentationSource(slot, nextBinding, nativeControl);
        syncQuickBuyPresentation(slot, nativeControl);
      } else {
        syncQuickBuyPresentation(slot);
      }
    } else {
      syncQuickBuyPresentation(slot);
    }
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
      if (binding.state === 'resolving-identity') {
        const cachedPresentation = cachedQuickBuyPresentation(binding.card, binding.chain);
        if (!binding.presentationSource && cachedPresentation?.signature
          && cachedPresentation.revision !== binding.presentationRevision) return true;
        probeSlots.push({ kind: 'pending', slot, nativeControl });
        continue;
      }
      if (!String(replacement.className || '').split(/\s+/).includes('tango-list-quick-buy')) return true;
      if (String(replacement.className || '').split(/\s+/).includes('tango-quick-buy-fallback')
        !== !binding.presentationComplete) return true;
      if (replacement.dataset?.tangoPaperAction !== 'quick-buy'
        || replacement.dataset?.tangoActionId !== binding.actionId
        || replacement.dataset?.tangoBindingNonce !== binding.bindingNonce
        || replacement.dataset?.tangoPaperState !== binding.state) return true;
      const connected = readConnectedQuickBuyProfile(slot, binding);
      if (connected?.profile?.id && connected.profile.id !== binding.quickBuyProfile?.id) return true;
      if (presentationSignature(replacement) !== String(binding.presentationSignature || '')) return true;
      const cachedPresentation = cachedQuickBuyPresentation(binding.card, binding.chain);
      if (Number(cachedPresentation?.revision || 0) > Number(binding.presentationRevision || 0)) return true;
      const sourceSignature = presentationSignature(binding.presentationSource);
      if (binding.presentationSource
        && sourceSignature !== String(binding.presentationSourceSignature || '')) return true;
      probeSlots.push({ kind: 'identity', slot });
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
      if (existingBinding?.state === 'resolving-identity'
        && (existingBinding.chain !== chain
          || Number(existingBinding.amountNative) !== Number(pendingAmount)
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
        && Number(existingBinding.amountNative) === amountSol && existingBinding.paperLabel === paperLabel
        && existingBinding.policyKey === policyKey
        && existingBinding.card === card) {
        // GMGN can reconcile the original control back into the slot. Remove it again fail-closed.
        slot.classList.add('tango-native-buy-overridden');
        slot.dataset.tangoQuickBuy = '1';
        slot.dataset.tangoTokenAddress = address;
        slot.dataset.tangoAmountSol = String(amountSol);
        slot.dataset.tangoPaperLabel = paperLabel;
        slot.dataset.tangoActionId = existingBinding.actionId;
        slot.dataset.tangoBindingKey = bindingKey;
        existingBinding.replacement.dataset.tangoActionId = existingBinding.actionId;
        if (metadata) existingBinding.presentationTrusted = true;
        setPaperState(slot, existingBinding, existingBinding.operation ? 'in-flight' : 'ready');
        if (nativeControl) {
          // Treat each coherent React reinsertion as the current authoritative native generation.
          // Keeping earlier detached generations would duplicate or revive stale real-money controls on master OFF.
          existingBinding.nativeControl = nativeControl;
          slot.__tangoOriginalQuickBuy = nativeControl;
          observeQuickBuyPresentationSource(slot, existingBinding, nativeControl);
          syncQuickBuyPresentation(slot, nativeControl);
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
      const presentationSource = nativeControl || null;
      const {
        replacement, presentation: initialPresentation,
        presentationRevision, presentationSignature: initialPresentationSignature,
        presentationComplete, quickBuyProfile
      } = createQuickBuyReplacement(
        slot, card, chain, nativeControl, amountSol, paperLabel, chainDefinition, Boolean(metadata)
      );
      const { generation, bindingNonce } = createQuickBuyGeneration({
        slot, card, chain, address, href, amountNative: amountSol
      });
      const actionId = `tango-paper-${bindingNonce}`;
      const handleClick = createQuickBuyHandler({
        slot, card, replacement, bindingKey, chain, address, actionId,
        onQuickBuy, amountNative: amountSol
      });
      slot.classList.add('tango-native-buy-overridden');
      const existingOperation = activeQuickBuyOperation(bindingKey);
      const binding = {
        slot, key: bindingKey, chain, address, href, card, nativeControl, replacement,
        actionId, bindingNonce, generation, state: existingOperation ? 'in-flight' : 'ready',
        amountNative: amountSol, paperLabel, policyKey, onQuickBuy, chainDefinition,
        presentationSignature: initialPresentationSignature,
        presentation: initialPresentation, presentationRevision, presentationComplete, quickBuyProfile,
        presentationSourceProfileId: initialPresentation?.profile?.id || '', pendingOnly: false,
        presentationTrusted: Boolean(metadata),
        cardGenerationIdentity: liveCardGenerationIdentity,
        presentationSource: null, presentationObserver: null, profileObserver: null, profileSources: [],
        additionalNativeControls: [],
        operation: existingOperation,
        repairAttempts: 0, repairTimer: null, resizeObserver: null, resizeTargets: []
      };
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
      observeQuickBuyPresentationSource(slot, binding, presentationSource);
      if (!syncQuickBuyPresentation(slot, presentationSource)) scheduleQuickBuyGeometryRepair(slot);
      observeQuickBuySlot(slot, binding);
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
    quickBuyPresentationsByColumn = new WeakMap();
    quickBuyPresentationsByChain.clear();
    quickBuyProfilesByChain.clear();
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
    quickBuyActions.delete(String(binding?.actionId || slot?.dataset?.tangoActionId || ''));
    if (binding?.repairTimer) global.clearTimeout?.(binding.repairTimer);
    for (const target of binding?.resizeTargets || [slot]) {
      binding?.resizeObserver?.unobserve?.(target);
    }
    binding?.resizeObserver?.disconnect?.();
    binding?.presentationObserver?.disconnect?.();
    binding?.profileObserver?.disconnect?.();
    slot?.style?.removeProperty?.('--tango-quick-buy-height');
    const canRestore = restoreCurrent && replacement?.isConnected && original && !original.isConnected
      && original.parentNode == null
      && !nativeQuickBuyControl(slot)
      && !binding?.pendingOnly && quickBuyBindingMatches(slot, binding);
    if (canRestore) replacement.replaceWith(original);
    else replacement?.remove?.();
    if (canRestore) restoreAdditionalNativeQuickBuyControls(slot, binding);
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
    _quickBuyProfileFromPresentation: quickBuyProfileFromPresentation,
    _quickBuySizeProfiles: QUICK_BUY_SIZE_PROFILES,
    _presentationSignature: presentationSignature, _applyInertPresentation: applyInertPresentation,
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
    _invokeQuickBuyAction: invokeQuickBuyAction,
    _quickBuyIntentCount: () => quickBuyIntents.size,
    _markChartFrameReady: markChartFrameReady, _invalidateChartFrame: invalidateChartFrame,
    _clearChartTrust: clearChartTrust, _hasTrustedChart: hasTrustedChart,
    _isTrenchPage: isTrenchPage,
    _isTokenDetailPage: isTokenDetailPage,
    _clearTrenchSnapshots: () => trenchSnapshots.clear()
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.GMGN;
})(globalThis);
