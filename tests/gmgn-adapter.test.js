const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
const GMGN = require('../src/adapters/gmgn.js');

const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const EVM_ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const PUMP_ADDRESS = '11111111111111111111111111111111pump';

function quickBuyHarness({ chain = 'sol', address = PUMP_ADDRESS, marketCap = '$10K' } = {}) {
  const href = chain === 'sol'
    ? `https://pump.fun/coin/${address}`
    : `https://gmgn.ai/${chain}/token/${address}`;
  const card = {
    innerText: `${address}\nTEST Test Token\nMC\n${marketCap}`,
    getAttribute: (name) => name === 'href' ? href : null,
    querySelectorAll: () => [],
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
  const nativeControl = {
    isConnected: true,
    textContent: '0.1 SOL',
    getBoundingClientRect: () => ({ height: 24 }),
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
    getBoundingClientRect: () => ({ height: 24, width: 80 }),
    querySelector(selector) {
      if (selector === '.tango-list-quick-buy') return replacement;
      if (selector === '[data-testid="quickbuy"]') return nativeControl.isConnected ? nativeControl : null;
      return null;
    }
  };
  const makeElement = () => ({
    dataset: {}, style: {}, className: '', disabled: false, isConnected: false,
    setAttribute() {}, append() {}, remove() { this.isConnected = false; }
  });
  const document = {
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll(selector) { return selector === '.BuyButton-continer' ? [slot] : []; },
    createElement: makeElement
  };
  return { card, slot, document, get replacement() { return replacement; } };
}

function detailDocument({ chain, address, priceUsd, marketCapUsd, liquidityUsd, linked = true }) {
  const infoItem = (title, value) => ({
    querySelector(selector) {
      if (selector === '.info-item-title') return title == null ? null : { textContent: title };
      if (selector === '.info-item-value') return { textContent: String(value) };
      return null;
    }
  });
  const priceView = {
    querySelectorAll: () => [
      infoItem('Price', priceUsd), infoItem(null, marketCapUsd), infoItem('Liquidity', liquidityUsd)
    ]
  };
  const link = { href: `https://gmgn.ai/${chain}/token/${address}`, getAttribute: () => null };
  const symbolNode = { textContent: 'TEST', getAttribute: () => 'TEST', parentElement: null };
  const header = {
    textContent: `Test Token TEST ${address}`,
    parentElement: null,
    querySelector(selector) {
      if (selector === '[data-testid="token-detail-symbol"]') return symbolNode;
      return null;
    },
    querySelectorAll(selector) { return linked && selector.includes('a[href') ? [link] : []; }
  };
  const bar = {
    tagName: 'DIV', textContent: header.textContent, parentElement: {},
    getAttribute: (name) => name === 'data-sentry-component' ? 'BaseInfoBar' : null,
    querySelector(selector) {
      return selector === '[data-sentry-component="BaseInfoPriceView"]' ? priceView : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="TokenHeader"]') return [header];
      if (linked && selector.includes('a[href')) return [link];
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

test('quick-buy rejects an undated cached market cap after the live card value disappears', async () => {
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
    assert.equal(orders.length, 0);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.setTimeout = original.timeout;
  }
});

test('quick-buy executes a fresh Solana Pump market cap without promoting that divisor to EVM', async () => {
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
    assert.equal(pumpOrders[0].quote.marketCapDivisor, 1_000_000_000);
    assert.ok(pumpOrders[0].quote.observedAt > 0);

    const evm = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
    const evmOrders = [];
    global.document = evm.document;
    global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
    assert.equal(GMGN.discoverTokenCards((order) => evmOrders.push(order)), 1);
    await evm.slot.__tangoQuickBuyHandler();
    assert.equal(evmOrders.length, 0);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
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
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});
