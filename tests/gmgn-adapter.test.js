const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');
const GMGN = require('../src/adapters/gmgn.js');

const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const EVM_ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const PUMP_ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';

function quickBuyHarness({
  chain = 'sol', address = PUMP_ADDRESS, marketCap = '$10K', launchpadHref = '', launchMode = '',
  identityText = 'TEST Test Token', unrelatedText = ''
} = {}) {
  const href = chain === 'sol'
    ? `https://pump.fun/coin/${address}`
    : `https://gmgn.ai/${chain}/token/${address}`;
  const launchpadLink = launchpadHref
    ? { href: launchpadHref, getAttribute: () => launchpadHref }
    : null;
  const launchModeBadge = launchMode ? {
    textContent: launchMode,
    getAttribute: (name) => name === 'data-launch-mode' ? launchMode : null
  } : null;
  const card = {
    isConnected: true,
    innerText: `${address}\n${identityText}\n${unrelatedText}\nMC\n${marketCap}`,
    getAttribute: (name) => name === 'href' ? href : null,
    querySelectorAll(selector) {
      if (selector === 'a[href]' && launchpadLink) return [launchpadLink];
      if (selector.includes('[data-launch-mode]') && launchModeBadge) return [launchModeBadge];
      return [];
    },
    firstElementChild: { querySelector: () => null }
  };
  const column = {
    isConnected: true,
    textContent: 'new creation\n',
    parentElement: null,
    contains: (node) => node === card,
    querySelector(selector) {
      if (selector === '[class~="group/a"]') return card;
      return null;
    }
  };
  card.parentElement = column;
  let replacement = null;
  let slotRect = { height: 24, width: 80 };
  let nativeRect = { height: 24, width: 80 };
  const nativeControl = {
    isConnected: true, reparented: 0,
    textContent: '0.1 SOL',
    getBoundingClientRect: () => ({ ...nativeRect }),
    replaceWith(node) { this.isConnected = false; node.isConnected = true; replacement = node; },
    remove() { this.isConnected = false; }
  };
  const classes = new Set();
  const slot = {
    isConnected: true,
    dataset: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    closest: () => card,
    contains: (node) => node === card,
    getBoundingClientRect: () => ({ ...slotRect }),
    appendChild(node) { node.isConnected = true; replacement = node === nativeControl ? null : node; return node; },
    querySelector(selector) {
      if (selector === '.tango-list-quick-buy') return replacement;
      if (selector === '[data-testid="quickbuy"]') return nativeControl.isConnected ? nativeControl : null;
      return null;
    }
  };
  const makeElement = () => ({
    dataset: {}, style: {}, className: '', disabled: false, isConnected: false,
    setAttribute() {}, append() {}, remove() { this.isConnected = false; },
    replaceWith(node) {
      this.isConnected = false;
      if (node === nativeControl && nativeControl.isConnected) nativeControl.reparented += 1;
      node.isConnected = true;
      replacement = node === nativeControl ? null : node;
    }
  });
  let visibleSlots = [slot];
  const document = {
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return visibleSlots;
      if (selector === '.tango-native-buy-overridden') return classes.has('tango-native-buy-overridden') ? [slot] : [];
      return [];
    },
    createElement: makeElement
  };
  return {
    card, slot, document, nativeControl, classes,
    setVisibleSlots(slots) { visibleSlots = slots; },
    setSlotRect(rect) { slotRect = { ...slotRect, ...rect }; },
    setNativeRect(rect) { nativeRect = { ...nativeRect, ...rect }; },
    get replacement() { return replacement; }
  };
}

function detailDocument({
  chain, address, priceUsd, marketCapUsd, liquidityUsd,
  totalSupply = '0', launchpad = '', launchMode = '', linked = true,
  launchpadAddress = address, launchpadHref = '', tokenName = 'Test Token'
}) {
  const infoItem = (title, value) => ({
    querySelector(selector) {
      if (selector === '.info-item-title') return title == null ? null : { textContent: title };
      if (selector === '.info-item-value') return { textContent: String(value) };
      return null;
    }
  });
  const priceView = {
    querySelectorAll: () => [
      infoItem('Price', priceUsd), infoItem(null, marketCapUsd),
      infoItem('Liquidity', liquidityUsd), infoItem('Total Supply', totalSupply)
    ]
  };
  const link = { href: `https://gmgn.ai/${chain}/token/${address}`, getAttribute: () => null };
  const launchpadLink = {
    href: launchpadHref || (launchpad
      ? `https://${({ zora: 'zora.co' }[launchpad.toLowerCase()] || `${launchpad.toLowerCase()}.fun`)}/token/${launchpadAddress}`
      : ''),
    getAttribute: () => null
  };
  const launchModeBadge = launchMode ? {
    textContent: launchMode,
    getAttribute: (name) => name === 'data-launch-mode' ? launchMode : null
  } : null;
  const scopedLinks = linked ? [link, ...(launchpad ? [launchpadLink] : [])] : [];
  const symbolNode = { textContent: 'TEST', getAttribute: () => 'TEST', parentElement: null };
  const header = {
    textContent: `${tokenName} TEST ${address}`,
    parentElement: null,
    querySelector(selector) {
      if (selector === '[data-testid="token-detail-symbol"]') return symbolNode;
      return null;
    },
    querySelectorAll(selector) { return selector.includes('a[href') ? scopedLinks : []; }
  };
  const bar = {
    tagName: 'DIV', textContent: header.textContent, parentElement: {},
    getAttribute: (name) => name === 'data-sentry-component' ? 'BaseInfoBar' : null,
    querySelector(selector) {
      return selector === '[data-sentry-component="BaseInfoPriceView"]' ? priceView : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="TokenHeader"]') return [header];
      if (selector.includes('a[href')) return scopedLinks;
      if (selector.includes('[data-launch-mode]') && launchModeBadge) return [launchModeBadge];
      return [];
    }
  };
  header.parentElement = bar;
  const stalePriceView = {
    querySelectorAll: () => [
      infoItem('Price', 99), infoItem(null, 99_000), infoItem('Liquidity', 9_900)
    ]
  };
  return {
    header, bar,
    document: {
      querySelector(selector) {
        if (selector === '[data-sentry-component="BaseInfoPriceView"]') return stalePriceView;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-sentry-component="BaseInfoBar"]') return [bar];
        if (selector === '[data-sentry-component="TokenHeader"]') return [header];
        return [];
      }
    }
  };
}

test('extracts GMGN and Pump.fun token addresses', () => {
  assert.equal(GMGN.tokenAddressFromUrl('https://gmgn.ai/sol/token/AbC123pump?tab=holders'), 'AbC123pump');
  assert.equal(GMGN.tokenAddressFromUrl('https://pump.fun/coin/AbC123pump'), 'AbC123pump');
});

test('parses compact money and GMGN subscript prices', () => {
  assert.equal(GMGN.parseMoney('$16.03K'), 16030);
  assert.equal(GMGN.parseMoney('$1.82M'), 1_820_000);
  assert.equal(GMGN.parseMoney('$0.0₄160'), 0.000016);
});

test('extracts trench market cap and symbol from card text', () => {
  const text = '68gi...pump\nHIMA\nhimalayancatcoin\n44s\nMC\n$2.6K\nV\n$820.8';
  assert.equal(GMGN._cardSymbol(text), 'HIMA');
  assert.equal(GMGN._cardMarketCap(text), 2600);
});

test('extracts symbol and name from a trench title without opening token detail', () => {
  const text = '4RY...pump\nCogito 我认为 ITS LITERALLY FINE\n20s\nMC\n$4.2K\n模拟盘\n0.5 SOL';
  assert.deepEqual(GMGN._tokenIdentityFromText(text), { symbol: 'Cogito', name: '我认为 ITS LITERALLY FINE' });
});

test('trench identity starts after the card address instead of avatar badge counts', () => {
  const gayCard = '3\n3\n9W2o...pump\nC GAY\nC GAY\n47m\nMC\n$24.5K';
  const rumpCard = '4\n4\nDgMN...pump\nRUMP Official Rump Coin\n5m\nMC\n$18K';
  assert.deepEqual(GMGN._cardIdentityFromText(gayCard), { symbol: 'C', name: 'GAY' });
  assert.deepEqual(GMGN._cardIdentityFromText(rumpCard), { symbol: 'RUMP', name: 'Official Rump Coin' });
});

test('a numeric token name remains valid when it appears after the card address', () => {
  const text = '6\n6\nAbCd...pump\n80\n80\n1m\nMC\n$8K';
  assert.deepEqual(GMGN._cardIdentityFromText(text), { symbol: '80', name: '80' });
});

test('detail address hints accept the matching abbreviated CA only', () => {
  const address = '5eAHabcdefghijkmnopqrstuvwxyz123456789pump';
  assert.equal(GMGN._addressHintMatches('5eAH...pump', address), true);
  assert.equal(GMGN._addressHintMatches('9W2o...pump', address), false);
});

test('trench identity is bound to the expected CA when another truncated value appears first', () => {
  const address = '5eAHabcdefghijkmnopqrstuvwxyz123456789pump';
  const text = 'description...\n9W2o...pump\nWRONG Wrong Token\n5eAH...pump\nBULLTABLE 可抵御 The Bull Table 牛市\n19m\nMC\n$11.4K';
  assert.deepEqual(GMGN._cardIdentityFromText(text, address), {
    symbol: 'BULLTABLE', name: '可抵御 The Bull Table 牛市'
  });
});

test('a card whose href CA is ahead of its visible DOM fails closed without reading its old logo', () => {
  const newAddress = '5eAHabcdefghijkmnopqrstuvwxyz123456789pump';
  let logoReads = 0;
  const staleCard = {
    innerText: '9W2o...pump\nWRONG Wrong Token\n19m\nMC\n$11.4K',
    firstElementChild: {
      querySelector() { logoReads += 1; return { src: 'https://gmgn.ai/external-res/old-token.webp' }; }
    },
    querySelectorAll: () => []
  };
  assert.equal(GMGN._cardIdentityFromText(staleCard.innerText, newAddress), null);
  assert.equal(GMGN._verifiedCardMetadata(staleCard, newAddress), null);
  assert.equal(logoReads, 0);
});

test('trench logo comes from the card avatar group rather than nested token images', () => {
  const avatarLogo = { src: 'https://gmgn.ai/external-res/avatar.webp' };
  const unrelatedLogo = { src: 'https://gmgn.ai/external-res/unrelated.webp' };
  const card = {
    firstElementChild: {
      querySelector(selector) { return selector === 'img[alt="logo"]' ? avatarLogo : null; }
    },
    querySelectorAll: () => [avatarLogo, unrelatedLogo]
  };
  assert.equal(GMGN._cardTokenLogo(card), avatarLogo.src);
});

test('a stale detail header is rejected until its CA matches the new SPA route', () => {
  const originalDocument = global.document;
  const body = {};
  const oldAddressNode = { textContent: '9W2o...pump', childElementCount: 0, getAttribute: () => null };
  const newAddressNode = { textContent: '5eAH...pump', childElementCount: 0, getAttribute: () => null };
  const sharedContainer = {
    tagName: 'DIV',
    textContent: 'OldToken OLD 9W2o...pump New route 5eAH...pump', parentElement: body,
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="TokenHeader"]') return [oldHeader];
      if (selector === '*') return [oldHeader, oldAddressNode, newAddressNode];
      if (selector === 'span,div,p,a,button') return [oldAddressNode, newAddressNode];
      return [];
    }
  };
  const oldHeader = {
    textContent: 'OldToken OLD 9W2o...pump', parentElement: sharedContainer,
    querySelectorAll: () => []
  };
  oldAddressNode.parentElement = sharedContainer;
  newAddressNode.parentElement = sharedContainer;
  global.document = { body, querySelectorAll: () => [oldHeader] };
  try {
    assert.equal(GMGN._findTokenDetailScope('5eAHabcdefghijkmnopqrstuvwxyz123456789pump'), null);
    const matching = GMGN._findTokenDetailScope('9W2oabcdefghijkmnopqrstuvwxyz123456789pump');
    assert.equal(matching.header, oldHeader);
    assert.equal(matching.scope, oldHeader);
  } finally {
    global.document = originalDocument;
  }
});

test('detail header accepts a nearby CA leaf in its small exclusive identity container', () => {
  const originalDocument = global.document;
  const body = {};
  const address = '5eAHabcdefghijkmnopqrstuvwxyz123456789pump';
  const addressNode = { textContent: '5eAH...pump', childElementCount: 0, getAttribute: () => null };
  const header = { textContent: 'BULLTABLE 可抵御 The Bull Table 牛市', querySelectorAll: () => [] };
  const identityContainer = {
    tagName: 'DIV', textContent: `${header.textContent} ${addressNode.textContent}`, parentElement: body,
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="TokenHeader"]') return [header];
      if (selector === '*') return [header, addressNode];
      if (selector === 'span,div,p,a,button') return [addressNode];
      return [];
    }
  };
  header.parentElement = identityContainer;
  addressNode.parentElement = identityContainer;
  global.document = { body, querySelectorAll: () => [header] };
  try {
    const detail = GMGN._findTokenDetailScope(address);
    assert.equal(detail.header, header);
    assert.equal(detail.scope, header);
    assert.equal(detail.bindingScope, identityContainer);
    assert.equal(detail.addressNode, addressNode);
  } finally {
    global.document = originalDocument;
  }
});

test('detail scope prefers the current BaseInfoBar when another widget repeats the same CA', () => {
  const originalDocument = global.document;
  const body = {};
  const address = '5eAHabcdefghijkmnopqrstuvwxyz123456789pump';
  const makeIdentity = () => {
    const addressNode = { textContent: '5eAH...pump', childElementCount: 0, getAttribute: () => null };
    const header = { textContent: '', querySelectorAll: () => [] };
    const container = {
      tagName: 'DIV', textContent: `Token ${addressNode.textContent}`, parentElement: body,
      querySelectorAll(selector) {
        if (selector === '[data-sentry-component="TokenHeader"]') return [header];
        if (selector === '*') return [header, addressNode];
        if (selector === 'span,div,p,a,button') return [addressNode];
        return [];
      }
    };
    header.parentElement = container;
    addressNode.parentElement = container;
    return { header, container };
  };
  const main = makeIdentity();
  const unrelated = makeIdentity();
  const baseInfoBar = {
    tagName: 'DIV', parentElement: body,
    getAttribute(attribute) { return attribute === 'data-sentry-component' ? 'BaseInfoBar' : null; },
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="TokenHeader"]') return [main.header];
      return [];
    }
  };
  main.container.parentElement = baseInfoBar;
  global.document = {
    body,
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="BaseInfoBar"]') return [baseInfoBar];
      if (selector === '[data-sentry-component="TokenHeader"]') return [unrelated.header, main.header];
      return [];
    }
  };
  try {
    const detail = GMGN._findTokenDetailScope(address);
    assert.equal(detail.header, main.header);
    assert.equal(detail.bindingScope, main.container);
    assert.equal(detail.identityScope, main.container);
  } finally {
    global.document = originalDocument;
  }
});

test('a transient empty detail read preserves the verified context for the same route only', () => {
  const current = { token: { chain: 'sol', address: SOL_ADDRESS }, quote: { priceUsd: 1 } };
  assert.equal(GMGN._resolveCurrentTokenRead(current, null, `https://gmgn.ai/sol/token/${SOL_ADDRESS}`), current);
  assert.equal(GMGN._resolveCurrentTokenRead(current, null, 'https://gmgn.ai/sol/token/11111111111111111111111111111111'), null);
  assert.equal(GMGN._resolveCurrentTokenRead(current, null, 'https://gmgn.ai/?chain=sol'), null);
});

test('Solana detail identity remains case-sensitive while EVM identity normalizes case', () => {
  const solana = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
  assert.equal(GMGN._addressHintMatches(solana.toLowerCase(), solana, 'sol'), false);
  assert.equal(GMGN._addressHintMatches(solana, solana, 'sol'), true);
  assert.equal(
    GMGN._addressHintMatches('0xa111111111111111111111111111111111111111', '0xA111111111111111111111111111111111111111', 'eth'),
    true
  );
  const previous = { token: { chain: 'sol', address: solana } };
  assert.equal(GMGN.resolveCurrentTokenRead(previous, null, `https://gmgn.ai/sol/token/${solana.toLowerCase()}`), null);
});

test('detail context is retried while the current route has not been resolved', () => {
  const current = { token: { chain: 'sol', address: SOL_ADDRESS } };
  assert.equal(GMGN._needsCurrentTokenRead(null, `https://gmgn.ai/sol/token/${SOL_ADDRESS}`), true);
  assert.equal(GMGN._needsCurrentTokenRead(current, `https://gmgn.ai/sol/token/${SOL_ADDRESS}`), false);
  assert.equal(GMGN._needsCurrentTokenRead(current, 'https://gmgn.ai/sol/token/11111111111111111111111111111111'), true);
  assert.equal(GMGN._needsCurrentTokenRead(null, 'https://gmgn.ai/?chain=sol'), false);
});

test('quick-buy injection is restricted to the Solana trench root', () => {
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/?chain=sol'), true);
  assert.equal(GMGN._isTrenchPage(`https://gmgn.ai/sol/token/${SOL_ADDRESS}`), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/monitor?chain=sol'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/trend?chain=sol'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/?chain=bsc'), true);
});

for (const chain of ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']) {
  test(`${chain} detail route is supported`, () => {
    const address = chain === 'sol' ? SOL_ADDRESS : EVM_ADDRESS;
    assert.equal(GMGN._isTokenDetailPage(`https://gmgn.ai/${chain}/token/${address}`), true);
    assert.equal(GMGN.chainFromUrl(`https://gmgn.ai/${chain}/token/${address}`), chain);
  });
}

test('trading panel requires an exact registered token detail route and valid address', () => {
  assert.equal(GMGN._isTokenDetailPage(`https://gmgn.ai/sol/token/${SOL_ADDRESS}?tab=holders`), true);
  assert.equal(GMGN._isTokenDetailPage(`https://gmgn.ai/?chain=sol&token=${SOL_ADDRESS}`), false);
  assert.equal(GMGN._isTokenDetailPage(`https://gmgn.ai/monitor?chain=sol&token=${SOL_ADDRESS}`), false);
  assert.equal(GMGN._isTokenDetailPage('https://gmgn.ai/bsc/token/0x123'), false);
  assert.equal(GMGN._isTokenDetailPage('https://gmgn.ai/sol/token/11111111111111111111111111111111pump'), false);
});

test('Solana cards retain Pump.fun support while EVM cards reject Base58 addresses', () => {
  const pumpUrl = `https://pump.fun/coin/${SOL_ADDRESS}`;
  const card = {
    innerText: `${SOL_ADDRESS}\nSOL Solana`,
    getAttribute: (name) => name === 'href' ? pumpUrl : null,
    querySelectorAll: () => [],
    firstElementChild: { querySelector: () => null }
  };
  assert.equal(GMGN._cardTokenHref(card, 'sol'), pumpUrl);
  assert.equal(GMGN._verifiedCardMetadata(card, SOL_ADDRESS, 'base'), null);
});

test('Solana card metadata keeps address identity case-sensitive', () => {
  const address = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
  const card = {
    innerText: `${address.toLowerCase()}\nWRONG Wrong Token`,
    querySelectorAll: () => [],
    firstElementChild: { querySelector: () => null }
  };
  assert.equal(GMGN._verifiedCardMetadata(card, address, 'sol'), null);
});

test('EVM card metadata normalizes address case', () => {
  const address = '0xA111111111111111111111111111111111111111';
  const card = {
    innerText: `${address.toLowerCase()}\nRIGHT Right Token`,
    querySelectorAll: () => [],
    firstElementChild: { querySelector: () => null }
  };
  assert.deepEqual(GMGN._verifiedCardMetadata(card, address, 'eth'), {
    symbol: 'RIGHT', name: 'Right Token', logoUrl: '', launchpad: '', launchMode: ''
  });
});

test('card launchpad matches a differently cased EVM address link', () => {
  const address = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
  const card = {
    querySelectorAll(selector) {
      return selector === 'a[href]'
        ? [{ href: 'https://four.meme/token/' + address.toLowerCase(), getAttribute: () => null }]
        : [];
    }
  };
  assert.equal(GMGN._cardLaunchpad(card, address, 'bsc'), 'Four.meme');
});

test('nested Solana card links require a case-sensitive visible address match', () => {
  const address = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
  const href = `https://gmgn.ai/sol/token/${address}`;
  const link = { href };
  const card = {
    innerText: `${address.toLowerCase()}\nWRONG Wrong Token`,
    getAttribute: () => null,
    querySelectorAll: () => [link]
  };
  assert.equal(GMGN._cardTokenHref(card, 'sol'), '');
});

test('a stale detail header linked to another chain fails closed', () => {
  const originalDocument = global.document;
  const staleLink = { href: `https://gmgn.ai/eth/token/${EVM_ADDRESS}`, getAttribute: () => null };
  const staleHeader = {
    textContent: `Old token ${EVM_ADDRESS}`,
    parentElement: {},
    querySelectorAll(selector) {
      return selector.includes('a[href') ? [staleLink] : [];
    }
  };
  global.document = {
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="BaseInfoBar"]') return [];
      if (selector === '[data-sentry-component="TokenHeader"]') return [staleHeader];
      return [];
    }
  };
  try {
    assert.equal(GMGN._findTokenDetailScope(EVM_ADDRESS, 'base'), null);
  } finally {
    global.document = originalDocument;
  }
});

test('detail token logo ignores unrelated token images elsewhere on the page', () => {
  const correctLogo = 'https://gmgn.ai/external-res/correct-token.webp';
  const unrelatedLogo = { src: 'https://gmgn.ai/external-res/unrelated-token.webp' };
  const verifiedHeader = {
    querySelector(selector) {
      return selector === 'img[alt="logo"]' ? { src: correctLogo } : null;
    },
    querySelectorAll: () => [unrelatedLogo, { src: correctLogo }]
  };
  assert.equal(GMGN._tokenLogo(verifiedHeader), correctLogo);
  assert.equal(GMGN._tokenLogo(null), '');
});

test('detail identity parses a combined title and accepts a numeric token symbol', () => {
  const scopeFor = (heading) => ({
    querySelector(selector) {
      if (selector === 'h1') return { textContent: heading };
      return null;
    }
  });
  assert.deepEqual(GMGN._detailTokenIdentity(scopeFor('BULLTABLE 可抵御 The Bull Table 牛市'), '5eAHabcdefghijkmnopqrstuvwxyz123456789pump'), {
    symbol: 'BULLTABLE', name: '可抵御 The Bull Table 牛市'
  });
  assert.deepEqual(GMGN._detailTokenIdentity(scopeFor('80'), '5eAHabcdefghijkmnopqrstuvwxyz123456789pump'), {
    symbol: '80', name: '80'
  });
});

test('detail identity reads the GMGN symbol and original name from the bound info row', () => {
  const originalName = { textContent: 'Runner Exchange' };
  const identityRow = {
    querySelector(selector) {
      return selector === '[translate="yes"]' ? originalName : null;
    }
  };
  const symbolParent = { parentElement: identityRow };
  const symbolNode = {
    textContent: 'RE', parentElement: symbolParent,
    getAttribute(attribute) { return attribute === 'data-symbol' ? 'RE' : null; }
  };
  const identityScope = {
    querySelector(selector) {
      if (selector === '[data-testid="token-detail-symbol"]') return symbolNode;
      return null;
    }
  };
  assert.deepEqual(GMGN._detailTokenIdentity(identityScope, '5eAHabcdefghijkmnopqrstuvwxyz123456789pump'), {
    symbol: 'RE', name: 'Runner Exchange'
  });
});

test('trench column amount takes priority over the replaced native button amount', () => {
  assert.equal(GMGN._selectQuickBuyAmount('0.7', '1 SOL', '1', 0.1), 0.7);
  assert.equal(GMGN._selectQuickBuyAmount('', '0.5 SOL', '1', 0.1), 0.5);
  assert.equal(GMGN._selectQuickBuyAmount('', '', '2', 0.1), 2);
});

test('quick-buy does not reuse a cached market cap after the live card value disappears', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame, timeout: global.setTimeout };
  const harness = quickBuyHarness();
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  try {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);
    harness.card.innerText = `${PUMP_ADDRESS}\nTEST Test Token`;
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].quote.marketCapUsd, 0);
    assert.equal(orders[0].quote.observedAt, 0);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.setTimeout = original.timeout;
  }
});

test('quick-buy preserves trusted Pump market-cap valuation and gives supplyless EVM trenches a provisional valuation', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  global.requestAnimationFrame = (callback) => callback();
  try {
    const pump = quickBuyHarness();
    const pumpOrders = [];
    global.document = pump.document;
    global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
    assert.equal(GMGN.discoverTokenCards((order) => pumpOrders.push(order)), 1);
    await pump.slot.__tangoQuickBuyHandler();
    assert.equal(pumpOrders.length, 1);
    assert.equal(pumpOrders[0].quote.priceUsd, 0.00001);
    assert.equal(pumpOrders[0].quote.priceProvenance, 'MARKET_CAP_DERIVED');
    assert.equal(pumpOrders[0].quote.marketCapDivisor, 1_000_000_000);
    assert.ok(pumpOrders[0].quote.observedAt > 0);

    for (const chain of ['eth', 'bsc', 'base', 'robinhood', 'xlayer']) {
      const evm = quickBuyHarness({ chain, address: EVM_ADDRESS });
      const evmOrders = [];
      global.document = evm.document;
      global.location = { href: `https://gmgn.ai/?chain=${chain}`, origin: 'https://gmgn.ai' };
      assert.equal(GMGN.discoverTokenCards((order) => evmOrders.push(order)), 1, chain);
      assert.ok(evm.replacement, chain);
      await evm.slot.__tangoQuickBuyHandler();
      assert.equal(evmOrders.length, 1, chain);
      assert.equal(evmOrders[0].quote.source, 'GMGN_TRENCH');
      assert.equal(evmOrders[0].quote.priceUsd, 0.00001);
      assert.equal(evmOrders[0].quote.marketCapUsd, 10_000);
      assert.equal(evmOrders[0].quote.totalSupply, 0);
      assert.equal(evmOrders[0].quote.supplySource, '');
      assert.equal(evmOrders[0].quote.provisionalSupply, 1_000_000_000);
      assert.equal(evmOrders[0].quote.syntheticTokenPrice, true);
      assert.equal(evmOrders[0].quote.provisional, true);
      assert.ok(evmOrders[0].quote.observedAt > 0);
    }
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('quick-buy binds launchpad supply rules to the same GMGN card address', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const cases = [
    ['bsc', 'https://four.meme/token/' + EVM_ADDRESS, 'Four.meme', 1_000_000_000],
    ['bsc', 'https://flap.sh/bnb/' + EVM_ADDRESS, 'Flap', 1_000_000_000],
    ['base', 'https://clanker.world/clanker/' + EVM_ADDRESS, 'Clanker', 100_000_000_000],
    ['xlayer', 'https://bow.fun/token/' + EVM_ADDRESS, 'Bow.fun', 1_000_000_000]
  ];
  global.requestAnimationFrame = (callback) => callback();
  try {
    for (const [chain, launchpadHref, expectedLaunchpad, expectedSupply] of cases) {
      const harness = quickBuyHarness({ chain, address: EVM_ADDRESS, launchpadHref });
      const orders = [];
      global.document = harness.document;
      global.location = { href: `https://gmgn.ai/?chain=${chain}`, origin: 'https://gmgn.ai' };
      assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1, expectedLaunchpad);
      await harness.slot.__tangoQuickBuyHandler();
      assert.equal(orders.length, 1, expectedLaunchpad);
      const [order] = orders;
      assert.equal(order.token.launchpad, expectedLaunchpad);
      assert.equal(order.quote.totalSupply, expectedSupply);
      assert.equal(order.quote.supplySource, 'LAUNCHPAD_RULE');
      assert.equal(order.quote.priceUsd, order.quote.marketCapUsd / expectedSupply);
    }
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('Pump Mayhem quick-buy emits a trusted 2B order and derives engine quantity from 2B', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({
    chain: 'sol', address: PUMP_ADDRESS, marketCap: '$10K', launchMode: 'Mayhem',
    launchpadHref: `https://pump.fun/coin/${PUMP_ADDRESS}`
  });
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(orders.length, 1);
    const [order] = orders;
    assert.equal(order.token.launchpad, 'Pump.fun');
    assert.equal(order.token.launchMode, 'Mayhem');
    assert.equal(order.quote.totalSupply, 2_000_000_000);
    assert.equal(order.quote.supplySource, 'LAUNCHPAD_RULE');
    assert.equal(order.quote.priceUsd, 10_000 / 2_000_000_000);

    const initial = State.createInitialState({ now: 1, initialBalances: { sol: 10 } });
    initial.initialized = true;
    const settings = State.normalizeSettings({
      slippageBps: 0, platformFeeBps: 0, chains: { sol: { networkFeeNative: 0 } }
    });
    const executed = Engine.executeBuy(initial, {
      ...order,
      quote: {
        ...order.quote, nativePriceUsd: 100,
        nativePriceObservedAt: order.quote.observedAt
      }
    }, settings, order.quote.observedAt);
    assert.ok(Math.abs(executed.position.quantity - 2_000_000) < 1e-6);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('Pump token identity or unrelated prose containing Mayhem does not select 2B mode', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({
    chain: 'sol', address: PUMP_ADDRESS, identityText: 'MAYHEM Mayhem Token',
    unrelatedText: 'Mayhem community update',
    launchpadHref: `https://pump.fun/coin/${PUMP_ADDRESS}`
  });
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(orders[0].token.launchMode, '');
    assert.equal(orders[0].quote.totalSupply, 1_000_000_000);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('quick-buy ignores a launchpad link exposing another card address', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({
    chain: 'bsc', address: EVM_ADDRESS, launchpadHref: 'https://four.meme/token/' + EVM_ADDRESS_2
  });
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=bsc', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].token.launchpad, '');
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('quick-buy emits a provisional 1B valuation for an unknown platform card', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({ chain: 'bsc', address: EVM_ADDRESS, marketCap: '$5K' });
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=bsc', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(orders.length, 1);
    const [order] = orders;
    assert.equal(order.quote.priceUsd, 5_000 / 1_000_000_000);
    assert.equal(order.quote.totalSupply, 0);
    assert.equal(order.quote.supplySource, '');
    assert.equal(order.quote.provisionalSupply, 1_000_000_000);
    assert.equal(order.quote.syntheticTokenPrice, true);
    assert.equal(order.quote.provisional, true);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('verified non-Pump Solana cards receive Tango quick-buy with a provisional market-cap quote', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    const nonPump = quickBuyHarness({ address: SOL_ADDRESS });
    const nonPumpOrders = [];
    global.document = nonPump.document;
    assert.equal(GMGN.discoverTokenCards((order) => nonPumpOrders.push(order)), 1);
    assert.ok(nonPump.replacement);
    await nonPump.slot.__tangoQuickBuyHandler();
    assert.equal(nonPumpOrders.length, 1);
    assert.equal(nonPumpOrders[0].quote.priceUsd, 0.00001);
    assert.notEqual(nonPumpOrders[0].quote.source, 'GMGN_TRENCH_MC');
    assert.notEqual(nonPumpOrders[0].quote.valuationMode, 'MARKET_CAP');
    assert.equal(nonPumpOrders[0].quote.totalSupply, 0);
    assert.equal(nonPumpOrders[0].quote.supplySource, '');
    assert.equal(nonPumpOrders[0].quote.provisionalSupply, 1_000_000_000);
    assert.equal(nonPumpOrders[0].quote.syntheticTokenPrice, true);
    assert.equal(nonPumpOrders[0].quote.provisional, true);

    const missingMarketCap = quickBuyHarness({ marketCap: '' });
    global.document = missingMarketCap.document;
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    assert.ok(missingMarketCap.replacement);

    const changed = quickBuyHarness();
    global.document = changed.document;
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const oldReplacement = changed.replacement;
    changed.card.getAttribute = (name) => name === 'href' ? `https://pump.fun/coin/${SOL_ADDRESS}` : null;
    changed.card.innerText = `${SOL_ADDRESS}\nTEST Test Token\nMC\n$10K`;
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    assert.equal(oldReplacement.isConnected, false);
    assert.ok(changed.replacement);
    assert.equal(changed.slot.dataset.tangoTokenAddress, SOL_ADDRESS);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('quick-buy restores tracked overrides omitted from the capped discovery slots', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness();
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const oldReplacement = harness.replacement;
    harness.setVisibleSlots([]);
    assert.equal(GMGN.discoverTokenCards(() => {}), 0);
    assert.equal(oldReplacement.isConnected, false);
    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(harness.slot.dataset.tangoQuickBuy, undefined);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('quick-buy restoration does not reparent an original control already connected elsewhere', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness();
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const oldReplacement = harness.replacement;
    harness.nativeControl.isConnected = true;
    harness.setVisibleSlots([]);
    GMGN.discoverTokenCards(() => {});
    assert.equal(oldReplacement.isConnected, false);
    assert.equal(harness.nativeControl.reparented, 0);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('quick-buy synchronizes four GMGN sizes and reconciled native geometry without actions', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver, gmgn: global.Tango.GMGN
  };
  let resizeCallback;
  class FakeResizeObserver {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    unobserve() {}
  }
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness();
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards((order) => orders.push(order)), 1);
    const replacement = harness.replacement;
    const actionId = harness.slot.dataset.tangoActionId;
    assert.equal(typeof resizeCallback, 'function');

    for (const { height, width, expanded, narrow } of [
      { height: 24, width: 80, expanded: false, narrow: false },
      { height: 32, width: 72, expanded: false, narrow: true },
      { height: 40, width: 80, expanded: true, narrow: false },
      { height: 48, width: 72, expanded: true, narrow: true }
    ]) {
      harness.setSlotRect({ height, width });
      resizeCallback([{ target: harness.slot }]);
      assert.equal(replacement.style.height, `${height}px`);
      assert.equal(harness.classes.has('tango-quick-expanded'), expanded);
      assert.equal(harness.classes.has('tango-quick-narrow'), narrow);
      assert.equal(harness.slot.dataset.tangoActionId, actionId);
    }
    assert.equal(orders.length, 0);

    harness.setSlotRect({ height: 24, width: 80 });
    harness.setNativeRect({ height: 32, width: 72 });
    harness.nativeControl.isConnected = true;
    assert.equal(freshGmgn.discoverTokenCards((order) => orders.push(order)), 0);
    assert.equal(harness.replacement, replacement);
    assert.equal(replacement.style.height, '32px');
    assert.equal(harness.classes.has('tango-quick-expanded'), false);
    assert.equal(harness.classes.has('tango-quick-narrow'), true);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.slot.dataset.tangoActionId, actionId);
    assert.equal(orders.length, 0);
  } finally {
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('quick-buy rechecks the active chain after injection before dispatching', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness();
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);
    global.location.href = 'https://gmgn.ai/?chain=base';
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(orders.length, 0);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('a linkless same-address detail header is rejected across an EVM chain transition', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({ chain: 'eth', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2000, liquidityUsd: 500, linked: false });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/eth/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    const eth = await GMGN.readCurrentToken();
    assert.equal(eth?.token.chain, 'eth');
    global.location.href = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
    assert.equal(await GMGN.readCurrentToken(), null);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail quote fields are read only from the verified BaseInfoBar scope', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({ chain: 'base', address: EVM_ADDRESS_2, priceUsd: 2, marketCapUsd: 2000, liquidityUsd: 500 });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`, origin: 'https://gmgn.ai' };
  try {
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.quote.priceUsd, 2);
    assert.equal(current?.quote.marketCapUsd, 2000);
    assert.equal(current?.quote.liquidityUsd, 500);
    assert.equal(current?.quote.totalSupply, 1_000);
    assert.equal(current?.quote.supplySource, 'GMGN_RATIO');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('verified Pump detail scope carries Mayhem mode into the 2B launchpad rule', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'sol', address: PUMP_ADDRESS, priceUsd: 0, marketCapUsd: 10_000, liquidityUsd: 500,
    launchpad: 'pump', launchMode: 'Mayhem'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/sol/token/${PUMP_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.token.launchpad, 'Pump.fun');
    assert.equal(current?.token.launchMode, 'Mayhem');
    assert.equal(current?.quote.totalSupply, 2_000_000_000);
    assert.equal(current?.quote.supplySource, 'LAUNCHPAD_RULE');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('Pump detail mode requires a dedicated badge and a same-address launchpad link', async () => {
  const original = { document: global.document, location: global.location };
  global.location = { href: `https://gmgn.ai/sol/token/${PUMP_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    const namedMayhem = detailDocument({
      chain: 'sol', address: PUMP_ADDRESS, priceUsd: 0, marketCapUsd: 10_000, liquidityUsd: 500,
      launchpad: 'pump', tokenName: 'Mayhem Token'
    });
    global.document = namedMayhem.document;
    const named = await GMGN.readCurrentToken();
    assert.equal(named?.token.launchMode, '');
    assert.equal(named?.quote.totalSupply, 1_000_000_000);

    const wrongAddress = detailDocument({
      chain: 'sol', address: PUMP_ADDRESS, priceUsd: 0, marketCapUsd: 10_000, liquidityUsd: 500,
      launchpad: 'pump', launchMode: 'Mayhem', launchpadAddress: SOL_ADDRESS
    });
    global.document = wrongAddress.document;
    const mismatched = await GMGN.readCurrentToken();
    assert.equal(mismatched?.token.launchpad, '');
    assert.equal(mismatched?.token.launchMode, '');

    const spoofHost = detailDocument({
      chain: 'sol', address: PUMP_ADDRESS, priceUsd: 0, marketCapUsd: 10_000, liquidityUsd: 500,
      launchpad: 'pump', launchMode: 'Mayhem',
      launchpadHref: `https://example.invalid/pump.fun/token/${PUMP_ADDRESS}`
    });
    global.document = spoofHost.document;
    const spoofed = await GMGN.readCurrentToken();
    assert.equal(spoofed?.token.launchpad, '');
    assert.equal(spoofed?.token.launchMode, '');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail launchpad metadata rejects a same-address noncanonical hostname', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 0, marketCapUsd: 200_000, liquidityUsd: 500,
    launchpad: 'clanker', launchpadHref: `https://notclanker.invalid/token/${EVM_ADDRESS}`
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.token.launchpad, '');
    assert.equal(current?.quote.totalSupply, 0);
    assert.equal(current?.quote.supplySource, '');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail quote reads price, market cap, and exact total supply from one verified scope', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS_2, priceUsd: 0.000002,
    marketCapUsd: 2000, liquidityUsd: 500, totalSupply: '1B', launchpad: 'Zora'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`, origin: 'https://gmgn.ai' };
  try {
    const current = await GMGN.readCurrentToken();
    assert.equal(current.quote.totalSupply, 1_000_000_000);
    assert.equal(current.quote.supplySource, 'GMGN_EXACT');
    assert.equal(current.token.launchpad, 'Zora');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('trench quick buy snapshots once and dispatches without polling timers', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame, timeout: global.setTimeout };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS, marketCap: '$2K' });
  const orders = [];
  let timerCalls = 0;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.setTimeout = () => { timerCalls += 1; return 1; };
  try {
    GMGN.discoverTokenCards((order) => orders.push(order));
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(timerCalls, 0);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].quote.marketCapUsd, 2_000);
  } finally {
    Object.assign(global, original);
  }
});

test('incremental discovery scans only supplied mutation roots', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const originalCardQuery = harness.card.querySelectorAll;
  harness.card.querySelectorAll = (selector) => selector === '.BuyButton-continer'
    ? [harness.slot]
    : originalCardQuery(selector);
  const originalDocumentQuery = harness.document.querySelectorAll;
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.BuyButton-continer') throw new Error('unexpected full document scan');
    return originalDocumentQuery(selector);
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.card]), 1);
    assert.ok(harness.replacement);
  } finally {
    Object.assign(global, original);
  }
});

test('detached quick-buy slots release actions and resize observations without a document rescan', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    window: global.window, ResizeObserver: global.ResizeObserver, gmgn: global.Tango.GMGN
  };
  let messageListener;
  const observed = [];
  const unobserved = [];
  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'message') messageListener = listener; }
  };
  class FakeResizeObserver {
    constructor() {}
    observe(slot) { observed.push(slot); }
    unobserve(slot) { unobserved.push(slot); }
  }
  global.window = fakeWindow;
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const firstOrders = [];
  global.document = first.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards((order) => firstOrders.push(order)), 1);
    const firstActionId = first.slot.dataset.tangoActionId;
    const detachedHandler = first.slot.__tangoQuickBuyHandler;
    first.card.isConnected = false;
    first.replacement.isConnected = false;
    first.document.querySelectorAll = (selector) => {
      if (selector === '.BuyButton-continer' || selector === '.tango-native-buy-overridden') {
        throw new Error('unexpected document rescan');
      }
      return [];
    };

    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [{}]), 0);
    assert.deepEqual(observed, [first.slot]);
    assert.deepEqual(unobserved, [first.slot]);
    assert.equal(first.slot.__tangoQuickBuyHandler, undefined);
    assert.equal(first.slot.dataset.tangoActionId, undefined);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [{}]), 0);
    assert.deepEqual(unobserved, [first.slot]);

    messageListener({
      source: fakeWindow,
      data: { source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK', actionId: firstActionId }
    });
    await detachedHandler();
    assert.equal(firstOrders.length, 0);
  } finally {
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.window = original.window;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('incremental discovery supports slot and closest roots and caps roots and slots at 80', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harnesses = Array.from({ length: 81 }, (_, index) => quickBuyHarness({
    chain: 'base',
    address: `0x${String(index + 1).padStart(40, '0')}`
  }));
  const roots = harnesses.map((harness, index) => {
    if (index % 2 !== 0) {
      return {
        querySelectorAll: () => [],
        closest: (selector) => selector === '.BuyButton-continer' ? harness.slot : null
      };
    }
    const card = harness.slot.closest();
    harness.slot.matches = (selector) => selector === '.BuyButton-continer';
    harness.slot.querySelectorAll = () => [];
    harness.slot.closest = (selector) => selector === '.BuyButton-continer' ? harness.slot : card;
    return harness.slot;
  });
  const document = {
    ...harnesses[0].document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') throw new Error('unexpected full document scan');
      return [];
    }
  };
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', roots), 80);
    assert.equal(harnesses.filter((harness) => harness.replacement).length, 80);
    assert.equal(harnesses[80].replacement, null);
  } finally {
    Object.assign(global, original);
  }
});

test('incremental discovery leaves unrelated tracked overrides intact', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const affected = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const unrelated = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  const allSlots = [affected.slot, unrelated.slot];
  const document = {
    ...affected.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return allSlots;
      if (selector === '.tango-native-buy-overridden') {
        return [affected, unrelated].flatMap((harness) => harness.document.querySelectorAll(selector));
      }
      return [];
    }
  };
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}), 2);
    const unrelatedReplacement = unrelated.replacement;
    affected.card.querySelectorAll = (selector) => selector === '.BuyButton-continer' ? [affected.slot] : [];
    affected.card.innerText = 'invalid card';
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', [affected.card]), 0);
    assert.equal(unrelated.replacement, unrelatedReplacement);
    assert.equal(unrelatedReplacement.isConnected, true);
    assert.equal(unrelated.slot.dataset.tangoQuickBuy, '1');
  } finally {
    Object.assign(global, original);
  }
});
