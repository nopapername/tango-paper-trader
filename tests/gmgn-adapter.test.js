const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');

global.Tango = {};
require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
global.Tango.NativeQuickBuyGuard = guardHarness();
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');
const GMGN = require('../src/adapters/gmgn.js');

const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const EVM_ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const PUMP_ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
const LIVE_QUICK_BUY_SMALL = 'inline-flex items-center justify-center !h-[24px] !px-[6px] !leading-[12px] !text-[12px] !rounded-[4px] !bg-transparent';
const LIVE_QUICK_BUY_LARGE = 'inline-flex items-center justify-center !h-[28px] !px-[8px] !leading-[14px] !text-[13px] !rounded-[6px] !bg-transparent';
const LIVE_QUICK_BUY_XL = 'inline-flex items-center justify-center !h-[32px] !px-[10px] !leading-[16px] !text-[14px] !rounded-[8px] !bg-transparent';
const LIVE_QUICK_BUY_GIANT = 'inline-flex items-center justify-center !h-[36px] !px-[12px] !leading-[18px] !text-[16px] !rounded-[10px] !bg-transparent';

function quickBuySafetyCascade(published) {
  const source = fs.readFileSync(path.join(__dirname, '../src/content/quick-buy-safety.css'), 'utf8');
  const html = { tagName: 'HTML', classes: new Set(), attributes: {}, parent: null };
  const group = {
    tagName: 'DIV', classes: new Set(),
    attributes: { 'data-sentry-component': 'BuyButtons' }, parent: html
  };
  const slot = {
    tagName: 'DIV', classes: new Set(['BuyButton-continer']),
    attributes: { 'data-tango-quick-buy': '1' }, parent: group
  };
  const paper = {
    tagName: 'BUTTON', classes: new Set(['tango-list-quick-buy']),
    attributes: { 'data-tango-published': published }, parent: slot
  };
  const matchesCompound = (node, compound) => {
    if (!node || /:where\(/.test(compound)) return false;
    for (const name of [...compound.matchAll(/:not\(\.([\w-]+)\)/g)].map((match) => match[1])) {
      if (node.classes.has(name)) return false;
    }
    const type = compound.match(/^[a-z][\w-]*/i)?.[0];
    if (type && node.tagName !== type.toUpperCase()) return false;
    for (const name of [...compound.matchAll(/\.([\w-]+)/g)].map((match) => match[1])) {
      if (!node.classes.has(name) && !compound.includes(`:not(.${name})`)) return false;
    }
    for (const match of compound.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
      if (!(match[1] in node.attributes)) return false;
      if (match[2] !== undefined && node.attributes[match[1]] !== match[2]) return false;
    }
    return true;
  };
  const matchesSelector = (selector) => {
    const compounds = selector.trim().split(/\s+/);
    let node = paper;
    if (!matchesCompound(node, compounds.at(-1))) return false;
    for (let index = compounds.length - 2; index >= 0; index -= 1) {
      do { node = node?.parent; } while (node && !matchesCompound(node, compounds[index]));
      if (!node) return false;
    }
    return true;
  };
  const specificity = (selector) => [
    (selector.match(/#[\w-]+/g) || []).length,
    (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length,
    (selector.match(/(?:^|\s)[a-z][\w-]*/gi) || []).length
  ];
  const wins = (candidate, current) => {
    if (!current || candidate.important !== current.important) return candidate.important;
    for (let index = 0; index < 3; index += 1) {
      if (candidate.specificity[index] !== current.specificity[index]) {
        return candidate.specificity[index] > current.specificity[index];
      }
    }
    return candidate.order > current.order;
  };
  const computed = {};
  let order = 0;
  for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of rule[1].split(',')) {
      order += 1;
      if (!matchesSelector(selector)) continue;
      for (const declaration of rule[2].matchAll(/([\w-]+)\s*:\s*([^;!]+)\s*(!important)?\s*;?/g)) {
        const property = declaration[1];
        if (!['visibility', 'pointer-events'].includes(property)) continue;
        const candidate = {
          value: declaration[2].trim(), important: Boolean(declaration[3]),
          specificity: specificity(selector), order
        };
        if (wins(candidate, computed[property])) computed[property] = candidate;
      }
    }
  }
  return Object.fromEntries(Object.entries(computed).map(([name, result]) => [name, result.value]));
}

test('all native presentations produce one locked Tango giant control', () => {
  const profiles = [
    [LIVE_QUICK_BUY_SMALL, 'height:24px;color:red;border-radius:2px;--customize-button-ultra-color:#f00;'],
    [LIVE_QUICK_BUY_LARGE, 'height:28px;color:green;border-radius:4px;--customize-button-ultra-color:#0f0;'],
    [LIVE_QUICK_BUY_XL, 'height:32px;color:blue;border-radius:12px;--customize-button-ultra-color:#00f;'],
    [LIVE_QUICK_BUY_GIANT, 'height:36px;color:white;border-radius:20px;--customize-button-ultra-color:#fff;'],
    ['hidden pointer-events-none !h-[100px] !text-[64px] rounded-full text-red-500',
      'height:100px;font-size:64px;color:red;border-radius:9999px;--customize-button-ultra-color:#f00;']
  ];
  for (const [className, styleText] of profiles) {
    const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
    harness.setNativePresentation(className, styleText);
    withQuickBuyGlobals(harness, {}, () => {
      assert.equal(GMGN.discoverTokenCards(() => {}), 1);
      assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
      assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');
      assert.equal(harness.replacement.className, 'tango-list-quick-buy');
      assert.equal(harness.replacement.style.cssText, '');
      assert.deepEqual(harness.replacement.children.map((child) => child.className), [
        'tango-quick-buy-content'
      ]);
      assert.deepEqual(harness.replacement.children[0].children.map((child) => child.className), [
        'tango-paper-hint', 'tango-buy-amount'
      ]);
    });
  }
});

test('native presentation mutation preserves giant geometry and action identity', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness();
  withQuickBuyGlobals(harness, { guard }, () => {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const binding = harness.slot.__tangoQuickBuyBinding;
    const initial = {
      replacement: binding.replacement,
      binding,
      action: binding.action,
      generation: binding.generation,
      actionId: binding.actionId,
      nonce: binding.bindingNonce
    };

    harness.setNativePresentation(LIVE_QUICK_BUY_SMALL, 'color:red;border-radius:2px;');
    assert.equal(GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [harness.card]), 0);
    assert.equal(harness.slot.__tangoQuickBuyBinding, initial.binding);
    assert.equal(binding.replacement, initial.replacement);
    assert.equal(binding.action, initial.action);
    assert.equal(binding.generation, initial.generation);
    assert.equal(binding.actionId, initial.actionId);
    assert.equal(binding.bindingNonce, initial.nonce);
    assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(binding.replacement.className, 'tango-list-quick-buy');
    assert.equal(binding.replacement.style.cssText, '');
  });
});

test('two verified slots keep independent Giant Guard callbacks', async () => {
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  const guard = guardHarness();
  const orders = [];
  const originalQuerySelectorAll = first.document.querySelectorAll.bind(first.document);
  first.document.querySelectorAll = (selector) => {
    if (selector === '.BuyButton-continer') return [first.slot, second.slot];
    if (selector === '.tango-native-buy-overridden') {
      return [first.slot, second.slot].filter((slot) => slot.classes?.has?.('tango-native-buy-overridden'));
    }
    return originalQuerySelectorAll(selector);
  };
  return withQuickBuyGlobals(first, { guard }, async () => {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 2);
    for (const harness of [first, second]) {
      assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
      assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');
    }
    await guard.invokeRegistered(first.replacement);
    assert.deepEqual(orders.map((order) => order.token.address), [EVM_ADDRESS]);
    await guard.invokeRegistered(second.replacement);
    assert.deepEqual(orders.map((order) => order.token.address), [EVM_ADDRESS, EVM_ADDRESS_2]);
    assert.equal(first.nativeControl.realHandlerCalls, 0);
    assert.equal(second.nativeControl.realHandlerCalls, 0);
  });
});


function localChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform !== 'win32' && '/usr/bin/google-chrome',
    process.platform !== 'win32' && '/usr/bin/chromium',
    process.platform !== 'win32' && '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(executable,
    `Headless Chrome is required for the quick-buy layout gate; checked: ${candidates.join(', ')}`);
  return executable;
}

function decodeRgbaPng(buffer) {
  let offset = 8; let width; let height; let depth; let colorType;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset); offset += 4;
    const type = buffer.toString('ascii', offset, offset + 4); offset += 4;
    const data = buffer.subarray(offset, offset + length); offset += length + 4;
    if (type === 'IHDR') [width, height, depth, colorType] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9]];
    if (type === 'IDAT') compressed.push(data);
  }
  assert.equal(depth, 8, 'pixel gate requires 8-bit Chrome screenshots');
  assert.ok(colorType === 2 || colorType === 6, 'pixel gate requires RGB(A) Chrome screenshots');
  const packed = zlib.inflateSync(Buffer.concat(compressed));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = Buffer.alloc(stride * height);
  const pixels = Buffer.alloc(width * height * 4);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[source++];
    for (let x = 0; x < stride; x += 1) {
      const value = packed[source++];
      const left = x >= channels ? filtered[y * stride + x - channels] : 0;
      const up = y ? filtered[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= channels ? filtered[(y - 1) * stride + x - channels] : 0;
      const p = left + up - upLeft;
      const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2)
        : filter === 4 ? (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft) : 0;
      filtered[y * stride + x] = (value + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const sourcePixel = y * stride + x * channels;
      const targetPixel = (y * width + x) * 4;
      filtered.copy(pixels, targetPixel, sourcePixel, sourcePixel + channels);
      pixels[targetPixel + 3] = 0xff;
    }
  }
  return { width, height, pixels };
}

function missingColoredInk(clipped, oracle) {
  assert.equal(clipped.width, oracle.width, 'pixel renders share a viewport');
  assert.equal(clipped.height, oracle.height, 'pixel renders share a viewport');
  let missing = 0;
  for (let index = 0; index < oracle.pixels.length; index += 4) {
    const [r, g, b] = oracle.pixels.subarray(index, index + 3);
    const label = r > 180 && g < 100 && b > 180;
    const amount = g > 140 && r < 100 && b < 100;
    if (!label && !amount) continue;
    const [actualR, actualG, actualB] = clipped.pixels.subarray(index, index + 3);
    const retained = label ? actualR > 180 && actualG < 100 && actualB > 180
      : actualG > 140 && actualR < 100 && actualB < 100;
    if (!retained) missing += 1;
  }
  return missing;
}

function overlappingColoredInk(labelImage, amountImage) {
  assert.equal(labelImage.width, amountImage.width, 'ink layers share a viewport');
  assert.equal(labelImage.height, amountImage.height, 'ink layers share a viewport');
  let overlap = 0;
  for (let index = 0; index < labelImage.pixels.length; index += 4) {
    const [labelR, labelG, labelB] = labelImage.pixels.subarray(index, index + 3);
    const [amountR, amountG, amountB] = amountImage.pixels.subarray(index, index + 3);
    const labelInk = labelR > 180 && labelG < 100 && labelB > 180;
    const amountInk = amountG > 140 && amountR < 100 && amountB < 100;
    if (labelInk && amountInk) overlap += 1;
  }
  return overlap;
}


function headlessLockedGiantQuickBuyLayoutReport() {
  const contentCss = fs.readFileSync(path.join(__dirname, '../src/content/content.css'), 'utf8');
  const safetyCss = fs.readFileSync(path.join(__dirname, '../src/content/quick-buy-safety.css'), 'utf8');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tango-locked-giant-layout-'));
  const pagePath = path.join(tempRoot, 'layout.html');
  const userDataDir = path.join(tempRoot, 'chrome-profile');
  try {
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>pending</title><style>
${safetyCss}
${contentCss}
html, body { margin: 0; padding: 0; }
body { background: #0c0d12; font: 13px/1 Arial, sans-serif; }
#cases { display: flex; flex-wrap: wrap; gap: 16px; padding: 12px; }
.fixture { width: 160px; }
.host { background: red; display: flex; height: var(--requested-height); width: 120px; }
.BuyButton-continer { width: 120px; }
.BuyButton-continer > [class~="group/btn"] { height: var(--requested-height); }
.host [data-testid="quickbuy"] { border-radius: 9999px; color: red; font-size: 64px; height: 100px; }
</style></head><body><main id="cases"></main><script>
(() => {
  const heights = [24, 36, 48];
  const rect = (element) => {
    const value = element.getBoundingClientRect();
    return { top: value.top, height: value.height, width: value.width };
  };
  const build = (id, nested, requestedHostHeight) => {
    const fixture = document.createElement('section');
    fixture.className = 'fixture';
    fixture.id = id + '-' + requestedHostHeight;
    fixture.style.setProperty('--requested-height', requestedHostHeight + 'px');
    const slot = document.createElement('div');
    slot.className = 'BuyButton-continer tango-native-buy-overridden';
    slot.dataset.tangoQuickBuy = '1';
    const host = nested ? document.createElement('div') : slot;
    host.classList.add('host', 'tango-quick-buy-action-host');
    if (nested) host.classList.add('group/btn');
    const native = document.createElement('button');
    native.dataset.testid = 'quickbuy';
    native.textContent = 'REAL';
    const paper = document.createElement('button');
    paper.className = 'tango-list-quick-buy';
    paper.dataset.tangoQuickBuySize = 'giant';
    const wrapper = document.createElement('span');
    wrapper.className = 'tango-quick-buy-content';
    const hint = document.createElement('span');
    hint.className = 'tango-paper-hint';
    hint.textContent = 'PAPER';
    const amount = document.createElement('span');
    amount.className = 'tango-buy-amount';
    amount.textContent = '0.1 ETH';
    wrapper.append(hint, amount);
    paper.append(wrapper);
    host.append(native, paper);
    if (nested) slot.append(host);
    fixture.append(slot);
    document.querySelector('#cases').append(fixture);
    return { fixture, slot, host, paper, wrapper, hint, amount, requestedHostHeight };
  };
  const controls = heights.flatMap((height) => [
    build('direct', false, height), build('nested', true, height)
  ]);
  document.body.offsetHeight;
  const states = controls.map(({ fixture, slot, host, paper, wrapper, hint, amount, requestedHostHeight }) => ({
    fixture: fixture.id.split('-')[0],
    requestedHostHeight,
    hostHeight: host.getBoundingClientRect().height,
    slotHeight: slot.getBoundingClientRect().height,
    paper: rect(paper),
    wrapper: rect(wrapper),
    amountFont: Number.parseFloat(getComputedStyle(amount).fontSize),
    hintFont: Number.parseFloat(getComputedStyle(hint).fontSize),
    paperRadius: getComputedStyle(paper).borderRadius,
    paperColor: getComputedStyle(paper).color,
    wrapperBackground: getComputedStyle(wrapper).backgroundColor,
    centeredOffset: Math.abs(
      (paper.getBoundingClientRect().top + paper.getBoundingClientRect().height / 2)
        - (host.getBoundingClientRect().top + host.getBoundingClientRect().height / 2)
    )
  }));
  const focusPaper = controls[0].paper;
  focusPaper.focus({ focusVisible: true });
  const writeFocusTelemetry = (attempt = 0) => {
    const focusWrapperStyle = getComputedStyle(controls[0].wrapper);
    const focus = {
      active: document.activeElement === focusPaper,
      focusVisible: focusPaper.matches(':focus-visible'),
      wrapperOutlineWidth: Number.parseFloat(focusWrapperStyle.outlineWidth),
      wrapperOutlineStyle: focusWrapperStyle.outlineStyle,
      attempts: attempt
    };
    if ((!focus.active || !focus.focusVisible || focus.wrapperOutlineStyle !== 'solid'
      || focus.wrapperOutlineWidth < 1) && attempt < 30) {
      focusPaper.focus({ focusVisible: true });
      requestAnimationFrame(() => writeFocusTelemetry(attempt + 1));
      return;
    }
    document.title = btoa(JSON.stringify({ states, focus }));
  };
  requestAnimationFrame(() => writeFocusTelemetry(1));
})();
</script></body></html>`;
    fs.writeFileSync(pagePath, page, 'utf8');
    const result = spawnSync(localChromeExecutable(), [
      '--headless', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--no-sandbox',
      '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost', '--virtual-time-budget=1000', '--dump-dom',
      `--user-data-dir=${userDataDir}`, pathToFileURL(pagePath).href
    ], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(result.error, undefined, `Headless Chrome failed to start: ${result.error?.message || ''}`);
    assert.equal(result.status, 0, `Headless Chrome exited ${result.status}: ${result.stderr || result.stdout}`);
    const title = result.stdout.match(/<title>([^<]+)<\/title>/i)?.[1];
    assert.ok(title, `Headless Chrome did not return locked Giant telemetry: ${result.stderr || result.stdout}`);
    return JSON.parse(Buffer.from(title, 'base64').toString('utf8'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('headless Chrome centers an exact 36px Tango control in short equal and tall hosts', () => {
  const report = headlessLockedGiantQuickBuyLayoutReport();
  assert.equal(report.states.length, 6, 'direct and nested fixtures x three host heights');
  for (const state of report.states) {
    assert.equal(state.paper.height, 36, `${state.fixture}:${state.requestedHostHeight}: paper height`);
    assert.ok(state.slotHeight >= 36, `${state.fixture}:${state.requestedHostHeight}: slot minimum`);
    assert.ok(state.hostHeight >= 36, `${state.fixture}:${state.requestedHostHeight}: host minimum`);
    assert.ok(state.centeredOffset <= 0.5, `${state.fixture}:${state.requestedHostHeight}: vertical center`);
    assert.equal(state.amountFont, 14, `${state.fixture}: amount font`);
    assert.equal(state.hintFont, 10, `${state.fixture}: hint font`);
    assert.equal(state.paperRadius, '6px', `${state.fixture}: Tango radius`);
    assert.equal(state.paperColor, 'rgb(125, 211, 252)', `${state.fixture}: Tango accent`);
    assert.notEqual(state.wrapperBackground, 'rgba(0, 0, 0, 0)', `${state.fixture}: painted surface`);
  }
  assert.equal(report.focus.active, true);
  assert.equal(report.focus.focusVisible, true);
  assert.ok(Number.isInteger(report.focus.attempts) && report.focus.attempts >= 1
    && report.focus.attempts <= 30, 'focus telemetry must come from the bounded frame condition');
  assert.equal(report.focus.wrapperOutlineStyle, 'solid');
  assert.ok(report.focus.wrapperOutlineWidth >= 1);
});

function quickBuyHarness({
  chain = 'sol', address = PUMP_ADDRESS, marketCap = '$10K', launchpadHref = '', launchMode = '',
  identityText = 'TEST Test Token', unrelatedText = '', tokenItem = false, tokenItemAncestor = false,
  extraTokenHrefs = []
} = {}) {
  let href = address && (chain === 'sol'
    ? `https://pump.fun/coin/${address}`
    : `https://gmgn.ai/${chain}/token/${address}`);
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
    matches(selector) {
      return selector === '[class~="group/a"]'
        || (tokenItem && selector === '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]');
    },
    closest(selector) {
      if (selector === '[class~="group/a"]') return card;
      if (tokenItemAncestor && selector === '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]') return tokenRoot;
      if (selector === '[data-sentry-component="TrenchColumn"]') return column;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return typeof slot === 'undefined' ? [] : [slot];
      if (selector === 'a[href]') return [
        ...extraTokenHrefs.map((value) => ({ href: value, getAttribute: () => value })),
        ...[launchpadLink].filter(Boolean)
      ];
      if (selector === 'a[href]' && launchpadLink) return [launchpadLink];
      if (selector.includes('[data-launch-mode]') && launchModeBadge) return [launchModeBadge];
      return [];
    },
    firstElementChild: { querySelector: () => null }
  };
  let columnAmount = '';
  const column = {
    isConnected: true,
    textContent: 'new creation\n',
    parentElement: null,
    contains: (node) => node === card,
    querySelector(selector) {
      if (selector === '[class~="group/a"]') return card;
      if (selector === '[data-sentry-component="BuyAmountInput"] input' && columnAmount !== '') {
        return { value: columnAmount };
      }
      return null;
    }
  };
  card.parentElement = column;
  let replacement = null;
  let elsewhereReplacement = null;
  let slotRect = { height: 24, width: 80 };
  let nativeRect = { height: 24, width: 80 };
  const nativeAttributes = new Map([
    ['data-testid', 'quickbuy'], ['href', 'https://gmgn.ai/real-buy'],
    ['target', '_blank'], ['formaction', '/real-buy'], ['onclick', 'realBuy()'], ['id', 'native-buy']
  ]);
  const nativeControl = {
    isConnected: true, connectedElsewhere: false, reparented: 0, restored: 0, realHandlerCalls: 0,
    tagName: 'BUTTON', dataset: {},
    className: 'gmgn-small rounded-sm',
    style: { cssText: 'padding: 2px 4px; border-radius: 4px;' },
    textContent: '0.1 SOL',
    closest: (selector) => selector === '.BuyButton-continer' ? slot : null,
    getAttributeNames: () => [...nativeAttributes.keys()],
    getAttribute: (name) => nativeAttributes.get(name) ?? null,
    getBoundingClientRect: () => ({ ...nativeRect }),
    replaceWith(node) {
      this.isConnected = false;
      node.isConnected = true;
      if (this.connectedElsewhere) elsewhereReplacement = node;
      else replacement = node;
    },
    remove() { this.isConnected = false; }
  };
  let liveNativeControl = nativeControl;
  const classes = new Set();
  const slot = {
    isConnected: true,
    dataset: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    matches: (selector) => selector === '.BuyButton-continer',
    closest: (selector) => selector === '.BuyButton-continer' ? slot : card,
    contains: (node) => node === card,
    getBoundingClientRect: () => ({ ...slotRect }),
    appendChild(node) { node.isConnected = true; replacement = node === nativeControl ? null : node; return node; },
    querySelector(selector) {
      if (selector === '.tango-list-quick-buy') {
        return replacement?.isConnected
          && String(replacement.className || '').split(/\s+/).includes('tango-list-quick-buy')
          ? replacement : null;
      }
      if (selector === '[data-testid="quickbuy"]') {
        return liveNativeControl.isConnected && !liveNativeControl.connectedElsewhere
          && liveNativeControl.getAttribute?.('data-testid') === 'quickbuy'
          ? liveNativeControl : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.tango-list-quick-buy') {
        return replacement?.isConnected
          && String(replacement.className || '').split(/\s+/).includes('tango-list-quick-buy')
          ? [replacement] : [];
      }
      if (selector === 'button, [role="button"], a[href], [data-testid="quickbuy"]') {
        return [replacement, liveNativeControl].filter((control) => control?.isConnected
          && !control.connectedElsewhere
          && (
            String(control.className || '').split(/\s+/).includes('tango-list-quick-buy')
            || String(control.tagName || '').toUpperCase() === 'BUTTON'
            || control.getAttribute?.('role') === 'button'
            || Boolean(control.getAttribute?.('href'))
            || control.getAttribute?.('data-testid') === 'quickbuy'
          ));
      }
      return [];
    }
  };
  const tokenRoot = tokenItemAncestor ? {
    isConnected: true,
    matches: (selector) => selector === '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]',
    querySelector(selector) { return selector === '[class~="group/a"]' ? card : null; },
    querySelectorAll(selector) { return selector === '.BuyButton-continer' ? [slot] : []; },
    parentElement: column
  } : null;
  if (tokenRoot) card.parentElement = tokenRoot;
  slot.__testChain = chain;
  const makeElement = () => {
    const attributes = new Map();
    const variables = new Map();
    return {
    dataset: {},
    style: {
      cssText: '',
      setProperty(name, value) { variables.set(name, String(value)); },
      getPropertyValue(name) { return variables.get(name) || ''; }
    },
    children: [], className: '', disabled: false, isConnected: false,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    getAttributeNames() { return [...attributes.keys()]; },
    append(...nodes) { this.children.push(...nodes); }, remove() { this.isConnected = false; },
    getBoundingClientRect() {
      const classes = String(this.className || '').split(/\s+/).filter(Boolean);
      const styleText = String(this.style?.cssText || '');
      const collapsedByClass = classes.some((name) => /^(?:!?hidden|!?invisible|!?opacity-0|!?pointer-events-none|!?[hw]-0|!?[hw]-\[(?:0|0(?:\.0+)?(?:px|rem|em|%))\])$/.test(name));
      const collapsedByStyle = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|(?:width|height)\s*:\s*0(?:\D|$))/i.test(styleText);
      return collapsedByClass || collapsedByStyle
        ? { height: 0, width: 0 }
        : { height: slotRect.height, width: slotRect.width };
    },
    replaceWith(node) {
      this.isConnected = false;
      if (node === nativeControl) {
        nativeControl.restored += 1;
        if (nativeControl.isConnected) nativeControl.reparented += 1;
      }
      node.isConnected = true;
      replacement = node === nativeControl ? null : node;
    }
  }; };
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
  const harness = {
    card, column, slot, tokenRoot, document, nativeControl, classes,
    connectNativeElsewhere() { nativeControl.connectedElsewhere = true; nativeControl.isConnected = true; },
    setLiveNativeControl(control) { liveNativeControl = control; },
    setVisibleSlots(slots) { visibleSlots = slots; },
    setColumnAmount(value) { columnAmount = String(value); },
    replaceExtraTokenHrefs(values) {
      extraTokenHrefs.splice(0, extraTokenHrefs.length, ...values);
    },
    setSlotRect(rect) { slotRect = { ...slotRect, ...rect }; },
    setNativeRect(rect) { nativeRect = { ...nativeRect, ...rect }; },
    setNativePresentation(className, cssText) {
      nativeControl.className = className;
      nativeControl.style.cssText = cssText;
      nativeControl.isConnected = true;
    },
    get replacement() { return replacement; },
    get elsewhereReplacement() { return elsewhereReplacement; },
    get paperControlCount() { return replacement?.isConnected ? 1 : 0; }
  };
  Object.defineProperties(harness, {
    intentCount: { get: () => GMGN._quickBuyIntentCount() },
    visibleTrustedPaperCount: { get: () =>
      replacement?.isConnected && replacement.dataset.tangoPublished === '1' ? 1 : 0 }
  });
  harness.invokePaperAction = () => global.Tango.NativeQuickBuyGuard?.invokeRegistered?.(replacement);
  harness.exposeCardHref = (nextHref) => {
    href = nextHref;
  };
  harness.flushPaperActions = () => new Promise((resolve) => setImmediate(resolve));
  return harness;
}

function guardHarness({ registerResult = true } = {}) {
  const actions = new WeakMap();
  const descriptors = new WeakMap();
  const trustedActions = new WeakSet();
  return {
    registerResult,
    failNext: false,
    failRegistrations: 0,
    trusted: false,
    descriptor: null,
    registrations: [],
    registerPaperAction(element, descriptor, activate) {
      this.descriptor = { element, ...descriptor, activate };
      this.registrations.push(this.descriptor);
      const result = typeof activate === 'function'
        && !(this.failNext || this.failRegistrations > 0)
        && this.registerResult;
      this.failNext = false;
      if (this.failRegistrations > 0) this.failRegistrations -= 1;
      this.trusted = result;
      if (result) {
        actions.set(element, activate);
        descriptors.set(element, this.descriptor);
        trustedActions.add(element);
        descriptor.slot.__tangoQuickBuyHandler = activate;
      } else {
        actions.delete(element);
        trustedActions.delete(element);
        delete descriptor.slot.__tangoQuickBuyHandler;
      }
      return result;
    },
    isPaperActionTrusted(element, descriptor) {
      const registered = descriptors.get(element);
      return trustedActions.has(element) && descriptor.actionId === registered?.actionId
        && descriptor.bindingNonce === registered?.bindingNonce;
    },
    revokePaperAction(element) {
      this.trusted = false;
      actions.delete(element);
      trustedActions.delete(element);
      const descriptor = descriptors.get(element);
      if (descriptor?.slot) delete descriptor.slot.__tangoQuickBuyHandler;
      return true;
    },
    invokeRegistered(element) {
      return actions.get(element)?.();
    }
  };
}

function withQuickBuyGlobals(harness, { guard = global.Tango.NativeQuickBuyGuard, clock } = {}, callback) {
  const original = {
    document: global.document,
    location: global.location,
    raf: global.requestAnimationFrame,
    guard: global.Tango.NativeQuickBuyGuard,
    dateNow: Date.now
  };
  global.document = harness.document;
  global.location = { href: `https://gmgn.ai/?chain=${harness.slot.__testChain || 'base'}`, origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (fn) => fn();
  global.Tango.NativeQuickBuyGuard = guard;
  if (clock) Date.now = () => clock.now;
  const restore = () => {
    GMGN.clearQuickBuy(false);
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.NativeQuickBuyGuard = original.guard;
    Date.now = original.dateNow;
  };
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function addresslessIntentScenario(cancellation, { born = true } = {}) {
  const clock = { now: 1_000 };
  const harness = quickBuyHarness({ chain: 'base', address: '', tokenItemAncestor: true });
  const orders = [];
  const paperAssets = {
    cash: 4_242,
    positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
    trades: [{ id: 'sentinel-trade', side: 'BUY' }],
    markers: [{ id: 'sentinel-marker', price: 11 }]
  };
  const commitPaperOrder = (order) => {
    orders.push(order);
    paperAssets.cash -= Number(order?.amountNative || 0);
    paperAssets.positions.push({
      chain: order?.token?.chain, address: order?.token?.address, quantity: 1
    });
    paperAssets.trades.push({ id: order?.actionId, side: 'BUY' });
    paperAssets.markers.push({ id: order?.actionId, price: order?.quote?.priceUsd || 0 });
  };
  const policyKey = 'policy:enabled';
  const birthRoot = harness.tokenRoot || harness.card;
  const discover = (options = {}) => GMGN.discoverTokenCards(
    commitPaperOrder, 1, 'PAPER', [harness.card], {
      fast: true, addedRoots: [], policyKey, ...options
    }
  );
  return {
    harness, clock, orders, paperAssets, policyKey,
    run(callback) {
      return withQuickBuyGlobals(harness, { clock }, async () => {
        discover({ addedRoots: born ? [birthRoot] : [] });
        return callback();
      });
    },
    runWithoutInitialDiscovery(callback) {
      return withQuickBuyGlobals(harness, { clock }, callback);
    },
    async clickTwentyTimes() {
      for (let index = 0; index < 20; index += 1) await harness.invokePaperAction();
    },
    async clickTwice() {
      await harness.invokePaperAction();
      await harness.invokePaperAction();
    },
    applyCancellation() {
      if (cancellation === 'amount') harness.setColumnAmount('2');
      if (cancellation === 'chain') global.location.href = 'https://gmgn.ai/?chain=eth';
      if (cancellation === 'disconnect') harness.card.isConnected = false;
      if (cancellation === 'card-reuse') {
        harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS_2}`);
        GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card]);
      }
      if (cancellation === 'expiry') clock.now = 3_001;
    },
    exposeApprovedHref() {
      harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
    },
    publishNetworkQuote(quote) {
      GMGN.rememberTrenchSnapshot({
        token: { chain: quote.chain, address: quote.address, symbol: 'NETWORK' },
        quote
      });
    },
    get binding() { return harness.slot.__tangoQuickBuyBinding; },
    get birth() { return GMGN._quickBuyBirthForRoot(birthRoot); },
    reconcileNow(options = {}) { return discover(options); },
    async reconcile(options = {}) {
      discover({ fast: false, ...options });
      await harness.flushPaperActions();
    },
    async reconcileFastHrefMutation() {
      discover();
      await harness.flushPaperActions();
    }
  };
}

function quickBuyFleet(count, chain = 'base') {
  const harnesses = Array.from({ length: count }, (_, index) => quickBuyHarness({
    chain,
    address: `0x${String(index + 1).padStart(40, '0')}`
  }));
  const document = {
    ...harnesses[0].document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return harnesses.map((harness) => harness.slot);
      if (selector === '.tango-native-buy-overridden') {
        return harnesses
          .filter((harness) => harness.classes.has('tango-native-buy-overridden'))
          .map((harness) => harness.slot);
      }
      if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') {
        return harnesses
          .filter((harness) => harness.slot.dataset.tangoQuickBuy !== '1')
          .map((harness) => harness.slot);
      }
      if (selector === '.tango-list-quick-buy') {
        return harnesses.map((harness) => harness.replacement).filter((control) =>
          control?.isConnected
          && String(control.className || '').split(/\s+/).includes('tango-list-quick-buy')
        );
      }
      return [];
    }
  };
  return { harnesses, document };
}

function detailDocument({
  chain, address, priceUsd, marketCapUsd, liquidityUsd,
  totalSupply = '0', launchpad = '', launchMode = '', linked = true,
  launchpadAddress = address, launchpadHref = '', tokenName = 'Test Token',
  marketCapTitle = null, infoItems = null, baseInfo = true, unstructuredItems = [], chart = true,
  chartFrame = null
}) {
  const infoItem = (title, value) => ({
    querySelector(selector) {
      if (selector === '.info-item-title') return title == null ? null : { textContent: title };
      if (selector === '.info-item-value') return { textContent: String(value) };
      return null;
    }
  });
  let currentQuote = { priceUsd, marketCapUsd, liquidityUsd, totalSupply };
  const detailItems = () => infoItems || [
    { title: 'Price', value: currentQuote.priceUsd },
    {
      title: marketCapTitle,
      value: typeof currentQuote.marketCapUsd === 'number'
        ? `$${currentQuote.marketCapUsd}` : currentQuote.marketCapUsd
    },
    { title: 'Liquidity', value: currentQuote.liquidityUsd },
    { title: 'Total Supply', value: currentQuote.totalSupply }
  ];
  const priceView = {
    querySelectorAll: () => detailItems().map(({ title, value }) => infoItem(title, value))
  };
  const unstructuredNodes = unstructuredItems.flatMap(({ title, value }) => {
    const row = { children: [] };
    const valueNode = { childElementCount: 0, textContent: String(value), parentElement: row };
    const titleNode = {
      childElementCount: 0, textContent: String(title), nextElementSibling: valueNode, parentElement: row
    };
    row.children = [titleNode, valueNode];
    return [titleNode, valueNode];
  });
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
      return selector === '[data-sentry-component="BaseInfoPriceView"]' && baseInfo ? priceView : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-sentry-component="TokenHeader"]') return [header];
      if (selector.includes('a[href')) return scopedLinks;
      if (selector.includes('[data-launch-mode]') && launchModeBadge) return [launchModeBadge];
      if (selector === 'span,div,p' || selector === 'span,div') return unstructuredNodes;
      return [];
    }
  };
  header.parentElement = bar;
  const stalePriceView = {
    querySelectorAll: () => [
      infoItem('Price', 99), infoItem(null, 99_000), infoItem('Liquidity', 9_900)
    ]
  };
  const frame = chartFrame || {
    title: 'Financial Chart', isConnected: true, contentWindow: {}
  };
  const chartSelectorMatchesFixture = (selector) => {
    const branches = String(selector || '').split(',').map((branch) => branch.trim());
    return branches.includes(`iframe[title="${frame.title}"]`)
      || (frame.inTradingViewContainer === true
        && branches.includes('[data-sentry-component="TradingView"] iframe'));
  };
  return {
    header, bar, chartFrame: frame,
    setQuote(next) { currentQuote = { ...currentQuote, ...next }; },
    document: {
      querySelector(selector) {
        if (selector === '[data-sentry-component="BaseInfoPriceView"]') return stalePriceView;
        if (chartSelectorMatchesFixture(selector)) return chart ? frame : null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-sentry-component="BaseInfoBar"]') return [bar];
        if (selector === '[data-sentry-component="TokenHeader"]') return [header];
        if (chartSelectorMatchesFixture(selector)) return chart ? [frame] : [];
        return [];
      }
    }
  };
}

function markDetailChartReady(detail, chain, address) {
  assert.equal(GMGN._markChartFrameReady(detail.chartFrame, { chain, address }), true);
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
  assert.equal(GMGN._cardMarketCap('MC\n100B\nTotal Supply\n100B'), 0);
  assert.equal(GMGN._cardMarketCap('MC\n$12.15K\nTotal Supply\n100B'), 12_150);
  assert.equal(GMGN._cardMarketCap('MC\nTotal Supply\n$12.15K'), 0);
  assert.equal(GMGN._cardMarketCap('MC\n100B (USD $)'), 0);
  assert.equal(GMGN._cardMarketCap('MC\n$ 12.15K'), 12_150);
  assert.equal(GMGN._cardMarketCap('MC\nUS$1.2e3'), 1200);
  assert.equal(GMGN._cardMarketCap('MC\n$0.0₄160'), 0.000016);
  assert.equal(GMGN._cardMarketCap('MC 80K'), 80_000);
  assert.equal(GMGN._cardMarketCap('MC：80K'), 80_000);
  assert.equal(GMGN._cardMarketCap('Market Cap\n$80K'), 80_000);
  assert.equal(GMGN._cardMarketCap('市值\n$80K'), 80_000);
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

test('periodic reads keep richer exact-route metadata and quote fields over an address-only placeholder', () => {
  const url = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
  const previous = {
    token: {
      chain: 'base', address: EVM_ADDRESS, symbol: 'RICH', name: 'Rich Token', logoUrl: 'rich.png',
      launchpad: 'Clanker', launchMode: 'MIGRATED', metadataVerified: true, metadataSource: 'GMGN_NETWORK'
    },
    quote: { priceUsd: 2, marketCapUsd: 200_000, observedAt: 1_000, source: 'GMGN_NETWORK' }
  };
  const placeholder = {
    token: {
      chain: 'base', address: EVM_ADDRESS, symbol: 'ROUTE', name: 'ROUTE', logoUrl: '',
      metadataVerified: false, metadataSource: ''
    },
    quote: {}
  };

  assert.deepEqual(GMGN.resolveCurrentTokenRead(previous, placeholder, url), previous);
});

test('verified exact-route detail metadata upgrades identity without discarding the richer quote', () => {
  const url = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
  const previous = {
    token: {
      chain: 'base', address: EVM_ADDRESS, symbol: 'OLD', name: 'Old Token', logoUrl: 'old.png',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: { priceUsd: 2, marketCapUsd: 200_000, observedAt: 1_000, source: 'GMGN_NETWORK' }
  };
  const detail = {
    token: {
      chain: 'base', address: EVM_ADDRESS, symbol: 'DETAIL', name: 'Detail Token', logoUrl: 'detail.png',
      launchpad: 'Clanker', launchMode: 'MIGRATED', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: {}
  };

  assert.deepEqual(GMGN.resolveCurrentTokenRead(previous, detail, url), {
    token: detail.token,
    quote: previous.quote
  });
});

test('equal-rank detail reads fill placeholder metadata without downgrading rich exact-route fields', () => {
  const url = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
  const previous = {
    token: {
      chain: 'base', address: EVM_ADDRESS, symbol: 'TOKEN', name: 'Token', logoUrl: '',
      launchpad: '', launchMode: 'MIGRATED', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: { priceUsd: 2, marketCapUsd: 200_000, observedAt: 1_000, source: 'GMGN_NETWORK' }
  };
  const completeDetail = {
    token: {
      chain: 'base', address: EVM_ADDRESS, symbol: 'REAL', name: 'Real Token', logoUrl: 'real.png',
      launchpad: 'Clanker', launchMode: '', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: {}
  };

  const upgraded = GMGN.resolveCurrentTokenRead(previous, completeDetail, url);
  assert.deepEqual(upgraded, {
    token: {
      ...completeDetail.token,
      launchMode: 'MIGRATED'
    },
    quote: previous.quote
  });

  const genericDetail = {
    token: {
      chain: 'base', address: EVM_ADDRESS, symbol: 'TOKEN', name: 'Token', logoUrl: '',
      launchpad: '', launchMode: '', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: {}
  };
  assert.deepEqual(GMGN.resolveCurrentTokenRead(upgraded, genericDetail, url), upgraded);

  const wrongIdentity = {
    token: {
      ...completeDetail.token, address: EVM_ADDRESS_2, symbol: 'WRONG', name: 'Wrong Token'
    },
    quote: {}
  };
  assert.deepEqual(GMGN.resolveCurrentTokenRead(upgraded, wrongIdentity, url), upgraded);
});

test('current-token reads reject a verified context for the wrong route identity', () => {
  const wrongAddress = {
    token: { chain: 'base', address: EVM_ADDRESS_2, symbol: 'WRONG', metadataVerified: true, metadataSource: 'GMGN_DETAIL' },
    quote: { priceUsd: 9, observedAt: 1_000, source: 'GMGN' }
  };
  const wrongChain = {
    token: { chain: 'eth', address: EVM_ADDRESS, symbol: 'WRONG', metadataVerified: true, metadataSource: 'GMGN_DETAIL' },
    quote: { priceUsd: 9, observedAt: 1_000, source: 'GMGN' }
  };
  const url = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;

  assert.equal(GMGN.resolveCurrentTokenRead(null, wrongAddress, url), null);
  assert.equal(GMGN.resolveCurrentTokenRead(null, wrongChain, url), null);
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
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/r/X9cuc5jd?chain=bsc'), true);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/r/X9cuc5jd/?chain=base'), true);
  assert.equal(GMGN._isTrenchPage(`https://gmgn.ai/sol/token/${SOL_ADDRESS}`), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/monitor?chain=sol'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/trend?chain=sol'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/r?chain=bsc'), false);
  assert.equal(GMGN._isTrenchPage('https://gmgn.ai/r/X9cuc5jd/extra?chain=bsc'), false);
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
  assert.equal(GMGN._selectQuickBuyAmount('', '0.5 ETH', '1', 0.1), 0.5);
  assert.equal(GMGN._selectQuickBuyAmount('', '0.5 BNB', '1', 0.1), 0.5);
  assert.equal(GMGN._selectQuickBuyAmount('', '0.5 OKB', '1', 0.1), 0.5);
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
    const publicFallback = Object.fromEntries(Object.entries(
      Tango.Supply.fallbackValuation({
        chain: orders[0].token.chain, launchpad: orders[0].token.launchpad
      })
    ));
    assert.deepEqual(publicFallback, {
      totalSupply: 1_000_000_000,
      marketCapUsd: 3_200,
      priceUsd: 0.0000032,
      supplySource: 'UNKNOWN_FALLBACK',
      valuationSource: 'UNKNOWN_INITIAL_MARKET_CAP'
    });
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

test('authoritative discovery removes omitted overrides without restoring a native real-buy leaf', () => {
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
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
    assert.equal(harness.slot.dataset.tangoQuickBuy, undefined);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('explicit quick-buy clear still restores a current identity-matched native control', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness();
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);

    GMGN.clearQuickBuy();

    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(harness.nativeControl.restored, 1);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
    assert.equal(harness.slot.dataset.tangoQuickBuy, undefined);
  } finally {
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('leaving the trench removes paper overrides without restoring a native real-buy leaf', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness();
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    global.location = {
      href: `https://gmgn.ai/sol/token/${SOL_ADDRESS}`,
      origin: 'https://gmgn.ai'
    };

    assert.equal(GMGN.discoverTokenCards(() => {}), 0);

    assert.equal(replacement.isConnected, false);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    GMGN.clearQuickBuy();
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

test('quick-buy restoration does not move a primary control out of a detached React staging tree', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness();
  const stagingParent = { isConnected: false };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    harness.nativeControl.parentNode = stagingParent;

    GMGN.clearQuickBuy(true);

    assert.equal(replacement.isConnected, false);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.parentNode, stagingParent);
    assert.equal(harness.nativeControl.restored, 0);
  } finally {
    delete harness.nativeControl.parentNode;
    GMGN.clearQuickBuy();
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
  }
});

test('trench snapshots are bounded and isolated by exact chain and normalized address', () => {
  GMGN._clearTrenchSnapshots();
  GMGN.rememberTrenchSnapshot({
    token: {
      chain: 'eth', address: `0x${EVM_ADDRESS.slice(2).toUpperCase()}`, symbol: 'TRENCH', name: 'Trench Token',
      logoUrl: 'trench.png', launchpad: 'Clanker', launchMode: 'MIGRATED'
    },
    quote: { marketCapUsd: 9_100, source: 'GMGN_TRENCH', observedAt: 1 }
  });

  assert.deepEqual(GMGN.readTrenchSnapshot('eth', EVM_ADDRESS), {
    token: {
      chain: 'eth', address: EVM_ADDRESS, symbol: 'TRENCH', name: 'Trench Token',
      logoUrl: 'trench.png', launchpad: 'Clanker', launchMode: 'MIGRATED',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: { marketCapUsd: 9_100, source: 'GMGN_TRENCH', observedAt: 1 }
  });
  assert.equal(GMGN.readTrenchSnapshot('base', EVM_ADDRESS), null);
  assert.equal(GMGN.readTrenchSnapshot('eth', EVM_ADDRESS_2), null);
  for (let index = 0; index <= 200; index += 1) {
    const address = `0x${index.toString(16).padStart(40, '0')}`;
    GMGN.rememberTrenchSnapshot({ token: { chain: 'eth', address, symbol: String(index) } });
  }
  assert.equal(GMGN.readTrenchSnapshot('eth', `0x${'0'.repeat(40)}`), null);
  assert.equal(GMGN.readTrenchSnapshot('eth', `0x${(200).toString(16).padStart(40, '0')}`).token.symbol, '200');
  GMGN._clearTrenchSnapshots();
});

test('amount-driven paper rebind never restores a detached native control with a stale real amount', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const firstPaperControl = harness.replacement;
    harness.setColumnAmount('0.25');

    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.equal(firstPaperControl.isConnected, false);
    assert.equal(harness.slot.dataset.tangoAmountSol, '0.25');
    assert.equal(harness.nativeControl.restored, 0);

    freshGmgn.clearQuickBuy();

    assert.equal(harness.nativeControl.textContent, '0.1 SOL');
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.nativeControl.reparented, 0);
    assert.equal(harness.replacement.isConnected, false);
  } finally {
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('amount-driven rebind leaves a connected stale native control elsewhere and paper in the live slot', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const firstPaperControl = harness.replacement;
    harness.connectNativeElsewhere();
    harness.setColumnAmount('0.25');

    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.equal(firstPaperControl.isConnected, false);
    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(harness.elsewhereReplacement, null);
    assert.equal(harness.paperControlCount, 1);
    assert.equal(harness.slot.dataset.tangoAmountSol, '0.25');

    freshGmgn.clearQuickBuy();

    assert.equal(harness.paperControlCount, 0);
    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.nativeControl.reparented, 0);
  } finally {
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});


test('a native-leafless full-height GMGN slot mounts paper inside its preserved action host', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.nativeControl.isConnected = false;
  let slotAppendCalls = 0;
  let mountedReplacement = null;
  const originalQuerySelector = harness.slot.querySelector.bind(harness.slot);
  const actionHost = {
    isConnected: true,
    appendChild(node) {
      mountedReplacement = node;
      node.isConnected = true;
      node.parentNode = actionHost;
      return node;
    }
  };
  harness.slot.querySelector = (selector) => (
    selector === '[class~="group/btn"]' ? actionHost : originalQuerySelector(selector)
  );
  harness.slot.appendChild = (node) => {
    slotAppendCalls += 1;
    node.isConnected = true;
    node.parentNode = harness.slot;
    return node;
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.slot.__tangoQuickBuyBinding?.replacement;
    assert.ok(replacement);
    assert.equal(mountedReplacement, replacement);
    assert.equal(replacement.parentNode, actionHost);
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');
    assert.equal(slotAppendCalls, 0);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a late GMGN action host adopts the existing paper button without rebinding its action', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.nativeControl.isConnected = false;
  let actionHostReady = false;
  let actionHostAppendCalls = 0;
  const originalQuerySelector = harness.slot.querySelector.bind(harness.slot);
  const originalAppendChild = harness.slot.appendChild.bind(harness.slot);
  const actionHost = {
    isConnected: true,
    appendChild(node) {
      actionHostAppendCalls += 1;
      node.isConnected = true;
      node.parentNode = actionHost;
      return node;
    }
  };
  harness.slot.querySelector = (selector) => (
    selector === '[class~="group/btn"]' && actionHostReady
      ? actionHost
      : originalQuerySelector(selector)
  );
  harness.slot.appendChild = (node) => {
    const appended = originalAppendChild(node);
    node.parentNode = harness.slot;
    return appended;
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.slot.__tangoQuickBuyBinding?.replacement;
    const actionId = harness.slot.dataset.tangoActionId;
    assert.ok(replacement);
    assert.equal(replacement.parentNode, harness.slot);
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');

    actionHostReady = true;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.slot.__tangoQuickBuyBinding?.replacement, replacement);
    assert.equal(harness.slot.dataset.tangoActionId, actionId);
    assert.equal(replacement.parentNode, actionHost);
    assert.equal(actionHostAppendCalls, 1);
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');

    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(replacement.parentNode, actionHost);
    assert.equal(actionHostAppendCalls, 1);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a staged paper shell moves into a late action host when its token becomes coherent', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const coherentText = harness.card.innerText;
  harness.card.innerText = 'loading';
  harness.nativeControl.isConnected = false;
  let actionHostReady = false;
  const originalQuerySelector = harness.slot.querySelector.bind(harness.slot);
  const originalAppendChild = harness.slot.appendChild.bind(harness.slot);
  const actionHost = {
    isConnected: true,
    appendChild(node) {
      node.isConnected = true;
      node.parentNode = actionHost;
      return node;
    }
  };
  harness.slot.querySelector = (selector) => (
    selector === '[class~="group/btn"]' && actionHostReady
      ? actionHost
      : originalQuerySelector(selector)
  );
  harness.slot.appendChild = (node) => {
    const appended = originalAppendChild(node);
    node.parentNode = harness.slot;
    return appended;
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.slot.__tangoQuickBuyBinding?.replacement;
    assert.ok(replacement);
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
    assert.equal(replacement.parentNode, harness.slot);
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');

    harness.card.innerText = coherentText;
    actionHostReady = true;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.slot.__tangoQuickBuyBinding?.replacement, replacement);
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
    assert.equal(replacement.parentNode, actionHost);
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('an unbound staged card gets an inert paper shell and upgrades that same shell in place', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const coherentText = harness.card.innerText;
  const orders = [];
  harness.card.innerText = 'loading';
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards((order) => orders.push(order)), 1);
    const pending = harness.replacement;
    assert.ok(pending);
    assert.equal(pending.disabled, false);
    assert.equal(pending.dataset.tangoPaperState, 'ready');
    assert.equal(pending.getAttribute('aria-disabled'), null);
    assert.equal(typeof harness.slot.__tangoQuickBuyHandler, 'function');
    assert.ok(harness.slot.dataset.tangoActionId);
    assert.ok(pending.dataset.tangoActionId);
    assert.equal(harness.nativeControl.isConnected, false);

    harness.card.innerText = coherentText;
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(freshGmgn.discoverTokenCards((order) => orders.push(order), 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, pending);
    assert.equal(pending.dataset.tangoPaperState, 'ready');
    assert.equal(pending.getAttribute('aria-disabled'), null);
    assert.equal(pending.disabled, false);
    assert.equal(typeof harness.slot.__tangoQuickBuyHandler, 'function');
    assert.ok(harness.slot.dataset.tangoActionId);

    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].token.address, EVM_ADDRESS);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('an unverified staged native presentation cannot overwrite the trusted chain presentation', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const trusted = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const staged = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  trusted.setNativePresentation(
    LIVE_QUICK_BUY_GIANT, 'padding: 10px 14px; border-radius: 12px;'
  );
  staged.card.innerText = 'loading';
  const document = {
    ...trusted.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.tango-native-buy-overridden') {
        return [trusted, staged]
          .filter((harness) => harness.classes.has('tango-native-buy-overridden'))
          .map((harness) => harness.slot);
      }
      return [];
    }
  };
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(
      freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [trusted.slot]), 1
    );
    assert.equal(trusted.replacement.dataset.tangoQuickBuySize, 'giant');

    assert.equal(
      freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [staged.slot]), 1
    );

    assert.equal(staged.replacement.dataset.tangoPaperState, 'ready');
    assert.equal(staged.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(trusted.replacement.dataset.tangoQuickBuySize, 'giant');
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('an active card reused for an incomplete token keeps its locked Giant presentation', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const reused = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const unaffected = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  for (const harness of [reused, unaffected]) {
    harness.setNativePresentation(
      'gmgn-giant rounded-xl', 'padding: 10px 14px; border-radius: 12px;'
    );
  }
  const document = {
    ...reused.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [reused.slot, unaffected.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [reused, unaffected]
          .filter((harness) => harness.classes.has('tango-native-buy-overridden'))
          .map((harness) => harness.slot);
      }
      if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') return [];
      return [];
    }
  };
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 2);
    assert.doesNotMatch(reused.replacement.className, /(?:^|\s)gmgn-giant(?:\s|$)/);
    assert.doesNotMatch(unaffected.replacement.className, /(?:^|\s)gmgn-giant(?:\s|$)/);

    const stagedNative = {
      ...reused.nativeControl,
      isConnected: true,
      connectedElsewhere: false,
      className: 'gmgn-small staged-token',
      style: { cssText: 'padding: 2px 4px; border-radius: 4px;' },
      textContent: '0.1 ETH'
    };
    reused.card.getAttribute = (name) =>
      name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    reused.card.innerText = 'loading';
    reused.setLiveNativeControl(stagedNative);

    assert.equal(
      freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [reused.slot]), 1
    );

    assert.equal(reused.replacement.dataset.tangoPaperState, 'ready');
    assert.equal(reused.replacement.disabled, false);
    assert.equal(reused.replacement.className, 'tango-list-quick-buy');
    assert.equal(reused.replacement.style.cssText, '');
    assert.equal(reused.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.doesNotMatch(reused.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.doesNotMatch(unaffected.replacement.className, /(?:^|\s)gmgn-giant(?:\s|$)/);
    assert.doesNotMatch(unaffected.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.equal(stagedNative.isConnected, false);

    freshGmgn.clearQuickBuy();

    assert.equal(reused.nativeControl.isConnected, false);
    assert.equal(reused.nativeControl.restored, 0);
    assert.equal(reused.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('clearing an unverified staged shell never restores its native real-buy leaf', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.card.innerText = 'loading';
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const pending = harness.replacement;
    assert.equal(pending.dataset.tangoPaperState, 'ready');

    freshGmgn.clearQuickBuy();

    assert.equal(pending.isConnected, false);
    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(harness.nativeControl.restored, 1);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a staged shell activated for a reused card never restores the prior token native leaf', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.card.innerText = 'loading';
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const pending = harness.replacement;

    harness.card.getAttribute = (name) =>
      name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    assert.equal(
      freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 1
    );
    assert.equal(harness.slot.dataset.tangoTokenAddress, EVM_ADDRESS_2);

    freshGmgn.clearQuickBuy();

    assert.equal(pending.isConnected, false);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a staged shell adopts the coherent live native leaf as restore provenance', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.card.innerText = 'loading';
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const coherentNative = {
      ...harness.nativeControl,
      isConnected: true,
      connectedElsewhere: false,
      className: 'gmgn-large coherent-token',
      style: { cssText: 'padding: 4px 8px;' },
      textContent: '0.1 ETH'
    };
    harness.card.getAttribute = (name) =>
      name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    harness.setLiveNativeControl(coherentNative);

    assert.equal(
      freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 1
    );
    assert.equal(coherentNative.isConnected, false);

    freshGmgn.clearQuickBuy();

    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(coherentNative.isConnected, true);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a new token without a native leaf retains the locked Giant presentation', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.setNativePresentation(LIVE_QUICK_BUY_GIANT, 'padding: 10px 14px; border-radius: 12px;');
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.replacement.style.cssText, '');

    harness.card.getAttribute = (name) =>
      name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 1);

    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.replacement.style.cssText, '');
    assert.equal(harness.replacement.className, 'tango-list-quick-buy');
    assert.equal(harness.replacement.dataset.tangoPaperAction, 'quick-buy');
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('locked Giant paper shell drift is detected and repaired without a native leaf', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.nativeControl.isConnected = false;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    replacement.className = 'native-small-button';
    replacement.style.cssText = 'height: 24px';

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, replacement);
    assert.equal(replacement.className, 'tango-list-quick-buy');
    assert.equal(replacement.style.cssText, '');
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a disconnected paper leaf is rebuilt from its binding without waiting for a native leaf', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.setNativePresentation(LIVE_QUICK_BUY_SMALL, 'padding: 2px 4px; border-radius: 4px;');
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const firstReplacement = harness.replacement;
    const firstActionId = harness.slot.dataset.tangoActionId;
    firstReplacement.isConnected = false;

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.notEqual(harness.replacement, firstReplacement);
    assert.equal(harness.replacement.isConnected, true);
    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.replacement.style.cssText, '');
    assert.match(harness.replacement.className, /(?:^|\s)tango-list-quick-buy(?:\s|$)/);
    assert.notEqual(harness.slot.dataset.tangoActionId, firstActionId);
    assert.equal(harness.nativeControl.restored, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a bound card keeps the approved href action until virtual reuse publishes a new href', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  let paperCalls = 0;
  const onQuickBuy = () => { paperCalls += 1; };
  try {
    assert.equal(freshGmgn.discoverTokenCards(onQuickBuy), 1);
    const pendingReplacement = harness.replacement;
    const firstActionId = harness.slot.dataset.tangoActionId;
    const staleHandler = harness.slot.__tangoQuickBuyHandler;

    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    assert.equal(freshGmgn.discoverTokenCards(onQuickBuy, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, pendingReplacement);
    assert.equal(pendingReplacement.isConnected, true);
    assert.equal(pendingReplacement.disabled, false);
    assert.equal(pendingReplacement.dataset.tangoPaperState, 'ready');
    assert.equal(pendingReplacement.dataset.tangoActionId, firstActionId);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.slot.dataset.tangoActionId, firstActionId);
    assert.equal(typeof harness.slot.__tangoQuickBuyHandler, 'function');
    assert.equal(harness.slot.__tangoQuickBuyBinding.state, 'ready');
    await staleHandler();
    assert.equal(paperCalls, 1);

    harness.card.getAttribute = (name) =>
      name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    assert.equal(freshGmgn.discoverTokenCards(onQuickBuy, 0.1, 'PAPER', [harness.slot]), 1);
    assert.notEqual(harness.replacement, pendingReplacement);
    assert.equal(pendingReplacement.isConnected, false);
    assert.equal(harness.replacement.disabled, false);
    assert.notEqual(harness.slot.dataset.tangoActionId, firstActionId);
    assert.equal(typeof harness.slot.__tangoQuickBuyHandler, 'function');
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.slot.dataset.tangoTokenAddress, EVM_ADDRESS_2);
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(paperCalls, 2);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a ready quick-buy remains executable after its same-token href gains query and hash', async () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const orders = [];
  await withQuickBuyGlobals(harness, {}, async () => {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);
    const actionId = harness.slot.dataset.tangoActionId;
    const handler = harness.slot.__tangoQuickBuyHandler;
    const liveHref = `https://gmgn.ai/base/token/${EVM_ADDRESS}?ref=trench#quick-buy`;

    harness.exposeCardHref(liveHref);
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order), 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.slot.dataset.tangoActionId, actionId);
    assert.equal(harness.slot.__tangoQuickBuyHandler, handler);
    assert.equal(harness.slot.__tangoQuickBuyBinding.state, 'ready');

    await harness.slot.__tangoQuickBuyHandler();

    assert.equal(orders.length, 1);
    assert.equal(orders[0].token.chain, 'base');
    assert.equal(orders[0].token.address, EVM_ADDRESS);
    assert.equal(orders[0].sourceUrl, liveHref);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  });
});

test('a ready quick-buy rejects an href rewrite to a different address before rediscovery', async () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const orders = [];
  await withQuickBuyGlobals(harness, {}, async () => {
    assert.equal(GMGN.discoverTokenCards((order) => orders.push(order)), 1);

    harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS_2}?ref=trench#quick-buy`);
    await harness.slot.__tangoQuickBuyHandler();

    assert.equal(orders.length, 0);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  });
});

test('a bound card stays inert while its href temporarily disappears', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    const getAttribute = harness.card.getAttribute;
    harness.card.getAttribute = () => null;

    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, replacement);
    assert.equal(replacement.isConnected, true);
    assert.equal(replacement.disabled, false);
    assert.equal(replacement.dataset.tangoPaperState, 'resolving-identity');
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);

    harness.card.getAttribute = getAttribute;
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('temporary card class drift holds a connected binding behind the paper barrier until recovery', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const guard = guardHarness();
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN,
    nativeGuard: global.Tango.NativeQuickBuyGuard
  };
  global.Tango.NativeQuickBuyGuard = guard;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  let paperCalls = 0;
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => { paperCalls += 1; }), 1);
    const replacement = harness.replacement;
    const binding = harness.slot.__tangoQuickBuyBinding;
    const actionId = harness.slot.dataset.tangoActionId;
    const staleHandler = harness.slot.__tangoQuickBuyHandler;
    const originalClosest = harness.slot.closest;
    let cardMatches = true;
    harness.slot.closest = (selector) => {
      if (selector === '.BuyButton-continer') return harness.slot;
      if (selector === '[class~="group/a"]') return cardMatches ? harness.card : null;
      if (selector === '[data-sentry-component="TrenchColumn"]') return harness.column;
      return originalClosest(selector);
    };

    cardMatches = false;
    assert.equal(
      freshGmgn.discoverTokenCards(() => { paperCalls += 1; }, 0.1, 'PAPER', [harness.slot]),
      0
    );
    assert.deepEqual({
      paperControls: harness.paperControlCount,
      sameBinding: harness.slot.__tangoQuickBuyBinding === binding,
      barrierClass: harness.classes.has('tango-native-buy-overridden'),
      barrierMarker: harness.slot.dataset.tangoQuickBuy,
      state: replacement.dataset.tangoPaperState,
      disabled: replacement.disabled,
      handlerInstalled: typeof harness.slot.__tangoQuickBuyHandler === 'function'
    }, {
      paperControls: 1,
      sameBinding: false,
      barrierClass: true,
      barrierMarker: '1',
      state: 'resolving-identity',
      disabled: false,
      handlerInstalled: true
    });
    assert.equal(guard.isPaperActionTrusted(replacement, guard.descriptor), true);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);

    await guard.invokeRegistered(replacement);
    await staleHandler();
    assert.equal(paperCalls, 0);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);

    cardMatches = true;
    assert.equal(
      freshGmgn.discoverTokenCards(() => { paperCalls += 1; }, 0.1, 'PAPER', [harness.slot]),
      0
    );
    assert.equal(harness.replacement, replacement);
    assert.notEqual(harness.slot.__tangoQuickBuyBinding, binding);
    assert.equal(harness.slot.__tangoQuickBuyBinding.state, 'ready');
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
    assert.equal(replacement.disabled, false);
    assert.equal(typeof harness.slot.__tangoQuickBuyHandler, 'function');
    await guard.invokeRegistered(replacement);
    assert.equal(paperCalls, 1);

    harness.slot.isConnected = false;
    assert.equal(
      freshGmgn.discoverTokenCards(() => { paperCalls += 1; }, 0.1, 'PAPER', [harness.slot]),
      0
    );
    assert.equal(harness.slot.__tangoQuickBuyBinding, undefined);
    assert.equal(harness.slot.dataset.tangoQuickBuy, undefined);
    assert.equal(harness.classes.has('tango-native-buy-overridden'), false);
    assert.equal(replacement.isConnected, false);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
    if (original.nativeGuard === undefined) delete global.Tango.NativeQuickBuyGuard;
    else global.Tango.NativeQuickBuyGuard = original.nativeGuard;
  }
});

test('an untagged native action leaf in a reused new-card slot is detected and removed fail-closed', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const paperReplacement = harness.replacement;
    const stagedNative = {
      isConnected: true, connectedElsewhere: false, tagName: 'BUTTON', dataset: {},
      className: 'gmgn-new-card-real-buy', style: { cssText: 'padding: 4px 8px;' },
      textContent: '0.1 ETH',
      getAttributeNames: () => ['class'],
      getAttribute: () => null,
      getBoundingClientRect: () => ({ width: 80, height: 24 }),
      matches: () => false,
      closest: (selector) => selector === '.BuyButton-continer' ? harness.slot : harness.card,
      querySelectorAll: () => [],
      replaceWith(node) { this.isConnected = false; node.isConnected = true; },
      remove() { this.isConnected = false; }
    };
    harness.setLiveNativeControl(stagedNative);

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(
      freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [stagedNative]), 0
    );
    assert.equal(stagedNative.isConnected, false);
    assert.equal(harness.replacement, paperReplacement);
    assert.equal(harness.paperControlCount, 1);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    freshGmgn.clearQuickBuy(true);
    assert.equal(stagedNative.isConnected, true);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('sequential same-binding React reinsertions restore only the latest coherent native generation', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const nativeGeneration = (className) => ({
    ...harness.nativeControl,
    isConnected: true,
    connectedElsewhere: false,
    parentNode: null,
    className,
    style: { cssText: 'padding: 4px 8px;' },
    textContent: '0.1 ETH'
  });
  const firstGeneration = nativeGeneration('gmgn-first-generation');
  const latestGeneration = nativeGeneration('gmgn-latest-generation');
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    harness.setLiveNativeControl(firstGeneration);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(firstGeneration.isConnected, false);

    harness.setLiveNativeControl(latestGeneration);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(latestGeneration.isConnected, false);

    freshGmgn.clearQuickBuy(true);

    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(firstGeneration.isConnected, false);
    assert.equal(latestGeneration.isConnected, true);
    assert.equal(
      [harness.nativeControl, firstGeneration, latestGeneration]
        .filter((control) => control.isConnected).length,
      1
    );
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('all sibling native action leaves survive paper mode and are restored when master is turned off', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const originalQuerySelectorAll = harness.slot.querySelectorAll.bind(harness.slot);
  let restoredSiblingReference = null;
  const siblingNative = {
    isConnected: true, tagName: 'BUTTON', dataset: {},
    className: 'gmgn-secondary-real-buy', style: { cssText: '' }, textContent: '0.1 ETH',
    parentNode: harness.slot,
    get nextSibling() { return harness.replacement || harness.nativeControl; },
    getAttribute: () => null,
    closest: (selector) => selector === '.BuyButton-continer' ? harness.slot : harness.card,
    querySelector: () => null,
    remove() { this.isConnected = false; this.parentNode = null; }
  };
  harness.slot.insertBefore = (node, reference) => {
    node.isConnected = true;
    node.parentNode = harness.slot;
    restoredSiblingReference = reference;
  };
  harness.slot.querySelectorAll = (selector) => {
    const controls = originalQuerySelectorAll(selector);
    if (selector === 'button, [role="button"], a[href], [data-testid="quickbuy"]'
      && siblingNative.isConnected) return [...controls, siblingNative];
    return controls;
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(siblingNative.isConnected, false);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);

    freshGmgn.clearQuickBuy(true);
    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(siblingNative.isConnected, true);
    assert.equal(restoredSiblingReference, harness.nativeControl);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('master OFF does not move a sibling control out of a detached React staging tree', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const originalQuerySelectorAll = harness.slot.querySelectorAll.bind(harness.slot);
  const stagingParent = { isConnected: false };
  const siblingNative = {
    isConnected: true, tagName: 'BUTTON', dataset: {},
    className: 'gmgn-secondary-real-buy', style: { cssText: '' }, textContent: '0.1 ETH',
    parentNode: harness.slot,
    get nextSibling() { return harness.replacement || harness.nativeControl; },
    getAttribute: () => null,
    closest: (selector) => selector === '.BuyButton-continer' ? harness.slot : harness.card,
    querySelector: () => null,
    remove() { this.isConnected = false; this.parentNode = null; }
  };
  harness.slot.insertBefore = (node) => {
    node.isConnected = true;
    node.parentNode = harness.slot;
  };
  harness.slot.querySelectorAll = (selector) => {
    const controls = originalQuerySelectorAll(selector);
    if (selector === 'button, [role="button"], a[href], [data-testid="quickbuy"]'
      && siblingNative.isConnected) return [...controls, siblingNative];
    return controls;
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.equal(siblingNative.isConnected, false);
    siblingNative.parentNode = stagingParent;

    freshGmgn.clearQuickBuy(true);

    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(siblingNative.isConnected, false);
    assert.equal(siblingNative.parentNode, stagingParent);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a native action wrapper is preserved after its real leaf is replaced by the paper shell', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const originalReplaceWith = harness.nativeControl.replaceWith.bind(harness.nativeControl);
  const originalQuerySelectorAll = harness.slot.querySelectorAll.bind(harness.slot);
  const wrapper = {
    isConnected: true, tagName: 'A', className: 'gmgn-real-action-wrapper', dataset: {},
    child: harness.nativeControl,
    getAttribute: (name) => name === 'href' ? '/real-buy' : null,
    closest: (selector) => selector === '.BuyButton-continer' ? harness.slot : harness.card,
    querySelector(selector) {
      if (selector === '.tango-list-quick-buy, [data-tango-paper-action="quick-buy"]') {
        return String(this.child?.className || '').split(/\s+/).includes('tango-list-quick-buy')
          ? this.child : null;
      }
      return null;
    },
    remove() {
      this.isConnected = false;
      if (this.child) this.child.isConnected = false;
    }
  };
  harness.nativeControl.replaceWith = (node) => {
    originalReplaceWith(node);
    wrapper.child = node;
  };
  harness.slot.querySelectorAll = (selector) => {
    if (selector === 'button, [role="button"], a[href], [data-testid="quickbuy"]') {
      return [wrapper, wrapper.child].filter((control) => control?.isConnected);
    }
    if (selector === '.tango-list-quick-buy') {
      return String(wrapper.child?.className || '').split(/\s+/).includes('tango-list-quick-buy')
        && wrapper.child.isConnected ? [wrapper.child] : [];
    }
    return originalQuerySelectorAll(selector);
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.equal(wrapper.isConnected, true);
    assert.equal(harness.replacement.isConnected, true);
    assert.equal(wrapper.child, harness.replacement);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a bound card stays inert while its trench column temporarily disappears', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    harness.column.isConnected = false;
    harness.card.parentElement = null;

    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, replacement);
    assert.equal(replacement.isConnected, true);
    assert.equal(replacement.disabled, false);
    assert.equal(replacement.dataset.tangoPaperState, 'resolving-identity');
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);

    harness.column.isConnected = true;
    harness.card.parentElement = harness.column;
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('clearing during a token identity transition never restores a stale native control', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    const paper = harness.replacement;

    freshGmgn.clearQuickBuy();

    assert.equal(harness.nativeControl.isConnected, true);
    assert.equal(harness.nativeControl.restored, 1);
    assert.equal(paper.isConnected, false);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('metadata enrichment never gates an address-bound paper shell', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const coherentText = harness.card.innerText;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    harness.card.innerText = 'loading';
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
    assert.equal(replacement.disabled, false);

    harness.card.innerText = coherentText;
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, replacement);
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
    assert.equal(replacement.disabled, false);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a native leaf seen only during metadata transition never replaces verified restore provenance', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const coherentText = harness.card.innerText;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    harness.card.innerText = 'loading';
    const transitionalNative = {
      ...harness.nativeControl,
      isConnected: true,
      connectedElsewhere: false,
      restored: 0,
      reparented: 0,
      className: 'gmgn-large transition-only',
      style: { cssText: 'padding: 4px 8px;' },
      textContent: '0.1 ETH'
    };
    harness.setLiveNativeControl(transitionalNative);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(transitionalNative.isConnected, false);

    harness.card.innerText = coherentText;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    freshGmgn.clearQuickBuy();

    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(transitionalNative.isConnected, true);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('an in-flight paper click stays clickable and deduplicated through metadata drift', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const gate = {};
  gate.promise = new Promise((resolve) => { gate.resolve = resolve; });
  let paperCalls = 0;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    freshGmgn._clearTrenchSnapshots();
    assert.equal(freshGmgn.discoverTokenCards(() => {
      paperCalls += 1;
      return gate.promise;
    }), 1);
    const replacement = harness.replacement;
    const clickPromise = harness.invokePaperAction();
    assert.equal(paperCalls, 1);
    assert.equal(replacement.disabled, false);
    assert.equal(replacement.dataset.tangoPaperState, 'in-flight');

    harness.card.innerText = 'loading';
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(replacement.dataset.tangoPaperState, 'in-flight');
    assert.equal(replacement.disabled, false);

    gate.resolve();
    await clickPromise;
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
    assert.equal(replacement.disabled, false);
  } finally {
    gate.resolve?.();
    freshGmgn.clearQuickBuy();
    freshGmgn._clearTrenchSnapshots();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('same-token recovery cannot reopen an in-flight paper action after the cooldown', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const coherentText = harness.card.innerText;
  const gate = {};
  gate.promise = new Promise((resolve) => { gate.resolve = resolve; });
  let paperCalls = 0;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    freshGmgn._clearTrenchSnapshots();
    assert.equal(freshGmgn.discoverTokenCards(() => {
      paperCalls += 1;
      return gate.promise;
    }), 1);
    const replacement = harness.replacement;
    const firstClick = harness.invokePaperAction();
    assert.equal(paperCalls, 1);

    harness.card.innerText = 'loading';
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(replacement.dataset.tangoPaperState, 'in-flight');

    harness.card.innerText = coherentText;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(replacement.dataset.tangoPaperState, 'in-flight');
    assert.equal(replacement.disabled, false);

    replacement.dataset.tangoLastClickAt = String(Date.now() - 1_000);
    const secondClick = harness.invokePaperAction();
    assert.equal(paperCalls, 1);

    gate.resolve();
    await Promise.all([firstClick, secondClick]);
    assert.equal(replacement.disabled, false);
  } finally {
    gate.resolve?.();
    freshGmgn.clearQuickBuy();
    freshGmgn._clearTrenchSnapshots();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('React leaf rebuild cannot reopen an in-flight paper action with a new action id', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const gate = {};
  gate.promise = new Promise((resolve) => { gate.resolve = resolve; });
  let paperCalls = 0;
  const onQuickBuy = () => {
    paperCalls += 1;
    return gate.promise;
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    freshGmgn._clearTrenchSnapshots();
    assert.equal(freshGmgn.discoverTokenCards(onQuickBuy), 1);
    const firstReplacement = harness.replacement;
    const firstActionId = harness.slot.dataset.tangoActionId;
    const firstClick = harness.invokePaperAction();
    assert.equal(paperCalls, 1);

    firstReplacement.isConnected = false;
    const rebuiltNative = {
      ...harness.nativeControl,
      isConnected: true,
      connectedElsewhere: false,
      restored: 0,
      reparented: 0,
      realHandlerCalls: 0
    };
    harness.setLiveNativeControl(rebuiltNative);
    assert.equal(freshGmgn.discoverTokenCards(onQuickBuy, 0.1, 'PAPER', [harness.slot]), 1);
    const rebuiltReplacement = harness.replacement;
    assert.notEqual(rebuiltReplacement, firstReplacement);
    assert.notEqual(harness.slot.dataset.tangoActionId, firstActionId);
    assert.equal(rebuiltReplacement.disabled, false);
    assert.equal(rebuiltReplacement.dataset.tangoPaperState, 'in-flight');

    const secondClick = harness.invokePaperAction();
    assert.equal(paperCalls, 1);
    assert.equal(rebuiltNative.realHandlerCalls, 0);

    gate.resolve();
    await Promise.all([firstClick, secondClick]);
    assert.equal(rebuiltReplacement.disabled, false);
  } finally {
    gate.resolve?.();
    freshGmgn.clearQuickBuy();
    freshGmgn._clearTrenchSnapshots();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('same-binding reconciliation repairs forbidden native disabled state', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    replacement.disabled = true;

    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, replacement);
    assert.equal(replacement.dataset.tangoPending, undefined);
    assert.equal(replacement.disabled, false);
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('health reconciliation restores a removed leaf action id without replacing or duplicating its binding', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const registrations = [];
  const revocations = [];
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN, nativeGuard: global.Tango.NativeQuickBuyGuard
  };
  global.Tango.NativeQuickBuyGuard = {
    registerPaperAction(element, identity) {
      registrations.push({ element, identity });
      return true;
    },
    isPaperActionTrusted: () => true,
    revokePaperAction(element) { revocations.push(element); return true; }
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    const actionId = harness.slot.dataset.tangoActionId;
    const initialRegistration = registrations.at(-1);
    assert.equal(initialRegistration?.element, replacement);
    assert.equal(initialRegistration?.identity?.slot, harness.slot);
    assert.equal(initialRegistration?.identity?.binding, harness.slot.__tangoQuickBuyBinding);
    assert.equal(initialRegistration?.identity?.actionId, actionId);
    const registrationCount = registrations.length;
    delete replacement.dataset.tangoActionId;

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 0);
    assert.equal(harness.replacement, replacement);
    assert.equal(replacement.dataset.tangoActionId, actionId);
    assert.ok(registrations.length > registrationCount);
    assert.equal(registrations.at(-1)?.identity?.actionId, actionId);
    assert.equal(registrations.at(-1)?.identity?.binding, harness.slot.__tangoQuickBuyBinding);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    freshGmgn.clearQuickBuy();
    assert.ok(revocations.includes(replacement));
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
    if (original.nativeGuard === undefined) delete global.Tango.NativeQuickBuyGuard;
    else global.Tango.NativeQuickBuyGuard = original.nativeGuard;
  }
});

test('quick-buy health probe ignores a permanently ineligible unbound slot', () => {
  const original = { document: global.document, location: global.location };
  global.document = { querySelectorAll: () => [] };
  GMGN.clearQuickBuy();
  const hiddenSlot = {
    isConnected: true, dataset: {},
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    querySelector: () => nativeControl,
    closest: () => null
  };
  const nativeControl = { isConnected: true, closest: () => hiddenSlot };
  global.document = {
    querySelector: () => hiddenSlot,
    querySelectorAll: (selector) => selector === '.BuyButton-continer [data-testid="quickbuy"]' ? [nativeControl] : []
  };
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  try {
    assert.equal(GMGN.quickBuyNeedsReconcile(), false);
  } finally {
    GMGN.clearQuickBuy();
    Object.assign(global, original);
  }
});

test('quick-buy health probe reports a visible identity-bound unbound native control', () => {
  const original = { document: global.document, location: global.location };
  global.document = { querySelectorAll: () => [] };
  GMGN.clearQuickBuy();
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.nativeControl.closest = (selector) => selector === '.BuyButton-continer' ? harness.slot : null;
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') return [harness.slot];
    if (selector === '.BuyButton-continer [data-testid="quickbuy"]') return [harness.nativeControl];
    return [];
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  try {
    assert.equal(GMGN.quickBuyNeedsReconcile(), true);
  } finally {
    GMGN.clearQuickBuy();
    Object.assign(global, original);
  }
});

test('quick-buy health probe round-robins bounded unbound slots and finds a coherent card without a native leaf', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.nativeControl.isConnected = false;
  const hiddenSlots = Array.from({ length: 24 }, () => ({
    isConnected: true,
    dataset: {},
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    querySelector: () => null,
    closest: () => null
  }));
  const unboundSlots = [...hiddenSlots, harness.slot];
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') return unboundSlots;
    if (selector === '.BuyButton-continer [data-testid="quickbuy"]') return [];
    if (selector === '.BuyButton-continer') return [harness.slot];
    return [];
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  try {
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.Tango.GMGN = original.gmgn;
  }
});

test('quick-buy health probe performs at most twenty-four eligibility geometry checks per pass', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  let geometryChecks = 0;
  const slots = Array.from({ length: 40 }, () => {
    const slot = {
      isConnected: true,
      dataset: {},
      getBoundingClientRect() {
        geometryChecks += 1;
        return { width: 0, height: 0 };
      },
      querySelector: () => null,
      closest: () => null
    };
    return slot;
  });
  const nativeControls = slots.map((slot) => ({
    isConnected: true,
    closest: () => slot,
    getBoundingClientRect() {
      geometryChecks += 1;
      return { width: 0, height: 0 };
    }
  }));
  global.document = {
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') return slots;
      if (selector === '.BuyButton-continer [data-testid="quickbuy"]') return nativeControls;
      return [];
    }
  };
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  try {
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(geometryChecks, 24);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.Tango.GMGN = original.gmgn;
  }
});

test('active quick-buy identity probes share the twenty-four-slot round-robin budget', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const fleet = quickBuyFleet(49);
  global.document = fleet.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 49);
    let hrefReads = 0;
    let tailDrifted = false;
    fleet.harnesses.forEach((harness, index) => {
      const stableHref = harness.card.getAttribute('href');
      harness.card.getAttribute = (name) => {
        if (name !== 'href') return null;
        hrefReads += 1;
        if (index === 48 && tailDrifted) {
          return `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
        }
        return stableHref;
      };
    });

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(hrefReads, 24);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(hrefReads, 48);
    tailDrifted = true;
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(hrefReads, 49);
  } finally {
    freshGmgn.clearQuickBuy(false);
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('active quick-buy safety scans every tracked slot before budgeted identity parsing', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const fleet = quickBuyFleet(49);
  global.document = fleet.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 49);
    let hrefReads = 0;
    fleet.harnesses.forEach((harness) => {
      const stableHref = harness.card.getAttribute('href');
      harness.card.getAttribute = (name) => {
        if (name === 'href') hrefReads += 1;
        return name === 'href' ? stableHref : null;
      };
    });
    const tailHarness = fleet.harnesses[48];
    const untaggedNative = {
      isConnected: true, connectedElsewhere: false, tagName: 'BUTTON', dataset: {},
      className: 'gmgn-live-real-buy', style: { cssText: '' }, textContent: '0.1 ETH',
      getAttribute: () => null,
      closest: (selector) => selector === '.BuyButton-continer' ? tailHarness.slot : tailHarness.card,
      querySelectorAll: () => [],
      remove() { this.isConnected = false; }
    };
    tailHarness.setLiveNativeControl(untaggedNative);

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(hrefReads, 0);
  } finally {
    freshGmgn.clearQuickBuy(false);
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('quick-buy health probe detects a tracked virtual slot whose live card address changed', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    GMGN.clearQuickBuy();
    GMGN._clearTrenchSnapshots();
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    assert.equal(GMGN.quickBuyNeedsReconcile(), false);

    harness.card.getAttribute = (name) =>
      name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(GMGN.quickBuyNeedsReconcile(), true);
  } finally {
    GMGN.clearQuickBuy();
    GMGN._clearTrenchSnapshots();
    Object.assign(global, original);
  }
});

test('quick-buy health probe detects a tracked nested-link card whose token identity changed', () => {
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame
  };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const originalQuerySelectorAll = harness.card.querySelectorAll;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    GMGN.clearQuickBuy();
    GMGN._clearTrenchSnapshots();
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    harness.card.getAttribute = () => null;
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    const nestedLink = {
      href: `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`,
      getAttribute: () => `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`
    };
    harness.card.querySelectorAll = (selector) => selector === 'a[href]'
      || selector === 'a[href*="/token/"], a[href*="pump.fun/coin/"]'
      ? [nestedLink] : originalQuerySelectorAll.call(harness.card, selector);

    assert.equal(GMGN.quickBuyNeedsReconcile(), true);
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 1);
    assert.equal(harness.slot.dataset.tangoTokenAddress, EVM_ADDRESS_2);
  } finally {
    GMGN.clearQuickBuy();
    GMGN._clearTrenchSnapshots();
    Object.assign(global, original);
  }
});

test('Guard registration failure cannot publish an active-looking successor', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness({ registerResult: false });
  withQuickBuyGlobals(harness, { guard }, () => {
    GMGN.discoverTokenCards(() => assert.fail('must not execute'), 1, 'PAPER');
    assert.equal(harness.visibleTrustedPaperCount, 0);
    assert.equal(harness.slot.dataset.tangoActionId, undefined);
    assert.equal(harness.replacement?.dataset?.tangoPublished, '0');
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  });
});

test('an unpublished mounted successor stays hidden and cannot receive pointer input', () => {
  assert.deepEqual(quickBuySafetyCascade('0'), {
    'pointer-events': 'none', visibility: 'hidden'
  });
  assert.deepEqual(quickBuySafetyCascade('1'), {
    'pointer-events': 'auto', visibility: 'visible'
  });
});

test('health reconciliation repairs a visible binding whose Guard trust was lost', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness({ registerResult: true });
  withQuickBuyGlobals(harness, { guard }, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER');
    guard.revokePaperAction(harness.replacement);
    assert.equal(GMGN.quickBuyNeedsReconcile(), true);
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER');
    assert.equal(guard.isPaperActionTrusted(harness.replacement, guard.descriptor), true);
  });
});

test('successor registration failure preserves the exact trusted predecessor publication', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness({ registerResult: true });
  withQuickBuyGlobals(harness, { guard }, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER');
    const predecessor = harness.slot.__tangoQuickBuyBinding;
    const identity = {
      actionId: predecessor.actionId,
      bindingNonce: predecessor.bindingNonce,
      generation: predecessor.generation,
      state: predecessor.state,
      published: predecessor.replacement.dataset.tangoPublished
    };
    harness.setColumnAmount('2');
    guard.failNext = true;
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [harness.slot]);
    assert.equal(harness.slot.__tangoQuickBuyBinding, predecessor);
    assert.deepEqual({
      actionId: harness.slot.dataset.tangoActionId,
      bindingNonce: harness.slot.dataset.tangoBindingNonce,
      generation: Number(harness.slot.dataset.tangoCardGeneration),
      state: harness.slot.dataset.tangoPaperState,
      published: predecessor.replacement.dataset.tangoPublished
    }, identity);
    assert.equal(predecessor.replacement.isConnected, true);
  });
});

test('ready promotion failure restores the exact resolving-identity publication', async () => {
  const harness = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  const guard = guardHarness({ registerResult: true });
  await withQuickBuyGlobals(harness, { guard }, async () => {
    GMGN.discoverTokenCards(() => assert.fail('failed promotion cannot trade'), 1, 'PAPER', [harness.card], {
      fast: true, addedRoots: [harness.card]
    });
    await harness.invokePaperAction();
    const predecessor = harness.slot.__tangoQuickBuyBinding;
    const title = predecessor.replacement.title;
    guard.failNext = true;
    harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
    GMGN.discoverTokenCards(() => assert.fail('failed promotion cannot trade'), 1, 'PAPER', [harness.card]);
    assert.equal(harness.slot.__tangoQuickBuyBinding, predecessor);
    assert.equal(predecessor.replacement.title, title);
    assert.equal(predecessor.replacement.dataset.tangoPaperState, 'resolving-identity');
    assert.equal(predecessor.replacement.dataset.tangoActionId, predecessor.actionId);
    assert.equal(harness.intentCount, 1);
  });
});

test('promotion failure may retry only inside the original inclusive 300 ms intent', async () => {
  for (const [retryAt, expectedOrders] of [[1_300, 1], [1_301, 0]]) {
    const clock = { now: 1_000 };
    const harness = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
    const guard = guardHarness({ registerResult: true });
    const orders = [];
    await withQuickBuyGlobals(harness, { guard, clock }, async () => {
      GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card], {
        fast: true, addedRoots: [harness.card], policyKey: 'policy:enabled'
      });
      await harness.invokePaperAction();
      const predecessor = harness.slot.__tangoQuickBuyBinding;
      guard.failNext = true;
      harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
      GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card], {
        fast: true, policyKey: 'policy:enabled'
      });
      assert.equal(harness.slot.__tangoQuickBuyBinding, predecessor);
      assert.equal(harness.replacement.dataset.tangoPublished, '1');
      assert.equal(GMGN._invokeQuickBuyAction, undefined);

      clock.now = retryAt;
      GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card], {
        fast: true, policyKey: 'policy:enabled'
      });
      await harness.flushPaperActions();
      assert.equal(orders.length, expectedOrders, `retry at ${retryAt}`);
    });
  }
});

test('successor and predecessor registration failure leaves both actions unpublished and inert', async () => {
  const clock = { now: 1_000 };
  const harness = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  const guard = guardHarness({ registerResult: true });
  const orders = [];
  await withQuickBuyGlobals(harness, { guard, clock }, async () => {
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card], {
      fast: true, addedRoots: [harness.card], policyKey: 'policy:enabled'
    });
    const predecessor = harness.slot.__tangoQuickBuyBinding;
    await harness.invokePaperAction();
    guard.failRegistrations = 2;
    harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card], {
      fast: true, policyKey: 'policy:enabled'
    });
    assert.equal(harness.slot.__tangoQuickBuyBinding, predecessor);
    assert.equal(harness.replacement.dataset.tangoPublished, '0');
    assert.equal(guard.trusted, false);
    assert.equal(GMGN._invokeQuickBuyAction, undefined);
    await harness.flushPaperActions();
    assert.equal(orders.length, 0);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.replacement.isConnected, true);
  });
});

test('ready promotion preserves identity and locked Giant presentation', () => {
  const harness = quickBuyHarness({ chain: 'base', address: '' });
  withQuickBuyGlobals(harness, {}, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER');
    const predecessor = harness.slot.__tangoQuickBuyBinding;
    const predecessorIdentity = {
      generation: predecessor.generation,
      actionId: predecessor.actionId,
      bindingNonce: predecessor.bindingNonce
    };
    harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [harness.card]);
    const successor = harness.slot.__tangoQuickBuyBinding;
    assert.notEqual(successor, predecessor);
    assert.equal(successor.generation, predecessorIdentity.generation);
    assert.notEqual(successor.actionId, predecessorIdentity.actionId);
    assert.notEqual(successor.bindingNonce, predecessorIdentity.bindingNonce);
    assert.equal(harness.replacement.className, 'tango-list-quick-buy');
    assert.equal(harness.replacement.style.cssText, '');
    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
  });
});

test('a staged addressless card exposes one protected resolving-identity action', () => {
  const harness = quickBuyHarness({ chain: 'base', address: '' });
  withQuickBuyGlobals(harness, {}, () => {
    GMGN.discoverTokenCards(() => assert.fail('intent cannot trade'), 1, 'PAPER');
    assert.equal(harness.replacement.disabled, false);
    assert.equal(harness.replacement.dataset.tangoPaperState, 'resolving-identity');
    assert.ok(harness.replacement.dataset.tangoActionId);
    assert.ok(harness.replacement.dataset.tangoBindingNonce);
    assert.match(harness.replacement.title, /token identity|浠ｅ竵韬唤/i);
  });
});

test('valid address executes without waiting for symbol image or launchpad enrichment', async () => {
  const harness = quickBuyHarness({
    chain: 'base', address: EVM_ADDRESS, identityText: '', marketCap: ''
  });
  const orders = [];
  await withQuickBuyGlobals(harness, {}, async () => {
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER');
    assert.doesNotMatch(harness.replacement.title, /琛屾儏|market|K[- ]?line|waiting/i);
    await harness.invokePaperAction();
  });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].token.address, EVM_ADDRESS);
  assert.equal(orders[0].token.symbol, 'TOKEN');
});

test('one addressless intent resolves only on the same card generation approved href', async () => {
  const clock = { now: 1_000 };
  const harness = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  const orders = [];
  await withQuickBuyGlobals(harness, { clock }, async () => {
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card], {
      fast: true, addedRoots: [harness.card]
    });
    const oldNonce = harness.replacement.dataset.tangoBindingNonce;
    await harness.invokePaperAction();
    await harness.invokePaperAction();
    assert.equal(harness.intentCount, 1);
    assert.equal(orders.length, 0);

    harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card]);
    await harness.flushPaperActions();
    assert.equal(orders.length, 1);
    assert.notEqual(harness.replacement.dataset.tangoBindingNonce, oldNonce);
  });
});

test('same-node virtual reuse cannot spend an addressless intent on the replacement token', async () => {
  const clock = { now: 1_000 };
  const harness = quickBuyHarness({ chain: 'base', address: '', identityText: 'ALPHA Alpha Token' });
  const orders = [];
  await withQuickBuyGlobals(harness, { clock }, async () => {
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER');
    const oldGeneration = Number(harness.replacement.dataset.tangoCardGeneration);
    const oldNonce = harness.replacement.dataset.tangoBindingNonce;
    await harness.invokePaperAction();

    harness.card.innerText = `${EVM_ADDRESS_2}\nBETA Beta Token\nMC\n$20K`;
    harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS_2}`);
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card]);
    await harness.flushPaperActions();

    assert.equal(orders.length, 0);
    assert.equal(harness.intentCount, 0);
    assert.ok(Number(harness.replacement.dataset.tangoCardGeneration) > oldGeneration);
    assert.notEqual(harness.replacement.dataset.tangoBindingNonce, oldNonce);
  });
});

for (const cancellation of ['amount', 'chain', 'disconnect', 'card-reuse', 'expiry']) {
  test(`addressless intent cancels on ${cancellation}`, async () => {
    const scenario = addresslessIntentScenario(cancellation);
    await scenario.run(async () => {
      await scenario.clickTwice();
      scenario.applyCancellation();
      scenario.exposeApprovedHref();
      await scenario.reconcile();
      assert.equal(scenario.orders.length, 0);
    });
  });
}

const identityIntentDrifts = {
  card(scenario) {
    scenario.binding.card = { ...scenario.harness.card, isConnected: true };
  },
  slot(scenario) {
    scenario.birth.slot = { isConnected: true };
  },
  root(scenario) {
    scenario.birth.root.isConnected = false;
  },
  generation(scenario) {
    scenario.binding.generation += 1;
  },
  nonce(scenario) {
    scenario.binding.bindingNonce = 'drifted-nonce';
  },
  chain() {
    global.location.href = 'https://gmgn.ai/?chain=eth';
  },
  amount(scenario) {
    scenario.harness.setColumnAmount('2');
  },
  route() {
    global.location.href = 'https://gmgn.ai/?chain=base&tab=renamed';
  },
  settings(scenario) {
    scenario.reconcileNow({ policyKey: 'policy:disabled' });
  },
  disconnect(scenario) {
    scenario.harness.card.isConnected = false;
    scenario.reconcileNow();
    scenario.harness.card.isConnected = true;
  },
  'conflicting-href'(scenario) {
    scenario.harness.replaceExtraTokenHrefs([
      `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`
    ]);
  },
  'href-removed'(scenario) {
    scenario.exposeApprovedHref();
    scenario.reconcileNow();
    scenario.harness.exposeCardHref('');
    scenario.reconcileNow();
  },
  'href-rewritten'(scenario) {
    scenario.exposeApprovedHref();
    scenario.reconcileNow();
    scenario.harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS_2}`);
    scenario.reconcileNow();
  },
  'pre-existing-attribute-hydration'() {}
};

for (const [drift, applyDrift] of Object.entries(identityIntentDrifts)) {
  test(`identity intent cancels on ${drift} drift without paper or native side effects`, async () => {
    const scenario = addresslessIntentScenario(drift, {
      born: drift !== 'pre-existing-attribute-hydration'
    });
    await scenario.run(async () => {
      await scenario.harness.invokePaperAction();
      applyDrift(scenario);
      scenario.exposeApprovedHref();
      await scenario.reconcileFastHrefMutation();

      assert.equal(scenario.orders.length, 0);
      assert.equal(scenario.harness.intentCount, 0);
      assert.equal(scenario.harness.replacement.disabled, false);
      assert.ok(['ready', 'resolving-identity'].includes(
        scenario.harness.replacement.dataset.tangoPaperState
      ));
      assert.equal(scenario.harness.slot.dataset.tangoPendingTrade, undefined);
      assert.equal(scenario.harness.slot.dataset.tangoReservedBalance, undefined);
      assert.equal(scenario.harness.slot.dataset.tangoPendingMarker, undefined);
      assert.deepEqual(scenario.paperAssets, {
        cash: 4_242,
        positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
        trades: [{ id: 'sentinel-trade', side: 'BUY' }],
        markers: [{ id: 'sentinel-marker', price: 11 }]
      });
    });
  });
}

for (const [elapsed, expectedOrders] of [[300, 1], [301, 0]]) {
  test(`first birth href at ${elapsed} ms auto-executes ${expectedOrders} order`, async () => {
    const scenario = addresslessIntentScenario(`ttl-${elapsed}`, { born: true });
    await scenario.run(async () => {
      await scenario.clickTwentyTimes();
      scenario.clock.now = 1_000 + elapsed;
      scenario.exposeApprovedHref();
      await scenario.reconcileFastHrefMutation();
      assert.equal(scenario.orders.length, expectedOrders);
    });
  });
}

test('fresh add remove reinsert provenance cannot auto-claim an addressless paper intent', async () => {
  const scenario = addresslessIntentScenario('same-batch-reinsert', { born: false });
  await scenario.runWithoutInitialDiscovery(async () => {
    const birthRoot = scenario.harness.tokenRoot || scenario.harness.card;
    scenario.reconcileNow({ addedRoots: [birthRoot], removedRoots: [birthRoot] });
    assert.equal(scenario.harness.paperControlCount, 1);
    assert.equal(scenario.harness.replacement.disabled, false);
    await scenario.clickTwice();
    scenario.exposeApprovedHref();
    await scenario.reconcile();

    assert.equal(scenario.orders.length, 0);
    assert.deepEqual(scenario.paperAssets, {
      cash: 4_242,
      positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
      trades: [{ id: 'sentinel-trade', side: 'BUY' }],
      markers: [{ id: 'sentinel-marker', price: 11 }]
    });
    assert.equal(scenario.harness.nativeControl.realHandlerCalls, 0);
  });
});

for (const [discontinuity, nextOldValue] of [
  ['removal', null],
  ['rewrite', `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`]
]) {
  test(`ordered valid href ${discontinuity} and restore oldValue provenance cannot auto-consume an intent`, async () => {
    const scenario = addresslessIntentScenario(`same-batch-href-${discontinuity}`, { born: true });
    const href = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
    await scenario.run(async () => {
      await scenario.clickTwice();
      scenario.exposeApprovedHref();
      await scenario.reconcile({ hrefMutations: [
        { target: scenario.harness.card, oldValue: null },
        { target: scenario.harness.card, oldValue: href },
        { target: scenario.harness.card, oldValue: nextOldValue }
      ] });

      assert.equal(scenario.orders.length, 0);
      assert.deepEqual(scenario.paperAssets, {
        cash: 4_242,
        positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
        trades: [{ id: 'sentinel-trade', side: 'BUY' }],
        markers: [{ id: 'sentinel-marker', price: 11 }]
      });
      assert.equal(scenario.harness.replacement.disabled, false);
      assert.equal(scenario.harness.nativeControl.realHandlerCalls, 0);
    });
  });
}

test('an href appearing immediately before resolving dispatch consumes that same click once', async () => {
  const scenario = addresslessIntentScenario('same-click', { born: true });
  await scenario.run(async () => {
    scenario.exposeApprovedHref();
    await scenario.clickTwentyTimes();
    await scenario.harness.flushPaperActions();
    assert.equal(scenario.orders.length, 1);
  });
});

test('a network quote alone cannot bind an addressless trench card', async () => {
  const scenario = addresslessIntentScenario('network-only');
  await scenario.run(async () => {
    await scenario.clickTwice();
    scenario.publishNetworkQuote({ chain: 'base', address: EVM_ADDRESS, priceUsd: 1 });
    await scenario.reconcile();
    assert.equal(scenario.orders.length, 0);
  });
});

test('benign addressless rediscovery preserves one intent and its binding nonce', async () => {
  const scenario = addresslessIntentScenario('benign');
  await scenario.run(async () => {
    await scenario.clickTwice();
    const nonce = scenario.harness.replacement.dataset.tangoBindingNonce;
    await scenario.reconcile();
    assert.equal(scenario.harness.intentCount, 1);
    assert.equal(scenario.harness.replacement.dataset.tangoBindingNonce, nonce);
  });
});

test('an addressless amount mutation permanently cancels the old intent', async () => {
  const scenario = addresslessIntentScenario('amount-then-restore');
  await scenario.run(async () => {
    await scenario.clickTwice();
    const nonce = scenario.harness.replacement.dataset.tangoBindingNonce;
    scenario.harness.setColumnAmount('2');
    await scenario.reconcile();
    scenario.harness.setColumnAmount('0.1');
    scenario.exposeApprovedHref();
    await scenario.reconcile();
    assert.equal(scenario.orders.length, 0);
    assert.notEqual(scenario.harness.replacement.dataset.tangoBindingNonce, nonce);
  });
});

test('paper quick buy remains clickable while an order is in flight', async () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await withQuickBuyGlobals(harness, {}, async () => {
    GMGN.discoverTokenCards(() => pending, 1, 'PAPER');
    const invocation = harness.invokePaperAction();
    await Promise.resolve();
    assert.equal(harness.replacement.disabled, false);
    assert.equal(harness.replacement.dataset.tangoPaperState, 'in-flight');
    assert.match(harness.replacement.title, /processing|澶勭悊/i);
    release();
    await invocation;
  });
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

test('a linkless same-address detail header falls back to the route placeholder across an EVM chain transition', async () => {
  const original = { document: global.document, location: global.location };
  GMGN._clearTrenchSnapshots();
  const detail = detailDocument({ chain: 'eth', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2000, liquidityUsd: 500, linked: false });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/eth/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    const eth = await GMGN.readCurrentToken();
    assert.equal(eth?.token.chain, 'eth');
    global.location.href = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
    assert.deepEqual(await GMGN.readCurrentToken(), {
      token: {
        chain: 'base', address: EVM_ADDRESS, symbol: '0x1111…1111', name: '0x1111…1111', logoUrl: '',
        metadataVerified: false, metadataSource: ''
      },
      quote: {}
    });
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
    markDetailChartReady(detail, 'base', EVM_ADDRESS_2);
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

test('detail without a K-line cannot promote a bare Price value over the verified Bankr 100B dimension', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 3_200,
    liquidityUsd: 0, totalSupply: '1B', launchpad: 'Bankr',
    launchpadHref: `https://bankr.bot/token/${EVM_ADDRESS}`, chart: false
  });
  global.document = detail.document;
  global.location = {
    href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai'
  };
  try {
    const current = await GMGN.readCurrentToken();
    const observedAt = current.quote.observedAt;
    const token = current.token;
    const settings = State.normalizeSettings({
      slippageBps: 0, platformFeeBps: 0,
      chains: { robinhood: { networkFeeNative: 0 } }
    });
    const initial = State.createInitialState({
      now: 1, initialBalances: { robinhood: 10 }
    });
    initial.initialized = true;
    const entry = Engine.executeBuy(initial, {
      token,
      quote: {
        chain: 'robinhood', address: EVM_ADDRESS,
        priceUsd: 3_200 / 100_000_000_000, marketCapUsd: 3_200,
        nativePriceUsd: 3_200, observedAt, nativePriceObservedAt: observedAt,
        totalSupply: 100_000_000_000, supplySource: 'GMGN_EXACT',
        source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP',
        priceProvenance: 'MARKET_CAP_DERIVED'
      },
      amountNative: 6
    }, settings, observedAt);
    const exit = Engine.executeSell(entry.state, {
      token,
      quote: {
        ...current.quote, chain: 'robinhood', address: EVM_ADDRESS,
        nativePriceUsd: 3_200, nativePriceObservedAt: observedAt
      },
      percent: 100
    }, settings, observedAt);

    assert.equal(current.quote.totalSupply, 100_000_000_000);
    assert.equal(current.quote.supplySource, 'LAUNCHPAD_RULE');
    assert.equal(current.quote.valuationMode, 'MARKET_CAP');
    assert.equal(current.quote.priceUsd, 3_200 / 100_000_000_000);
    assert.equal(entry.position.quantity, 600_000_000_000);
    assert.equal(exit.trade.amountNative, 6);
    assert.equal(exit.state.accounts.robinhood.cashBalanceNative, 10);
  } finally {
    GMGN._clearTrenchSnapshots();
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail without a K-line leaves unknown-launchpad fallback construction to the content resolver', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 3_200,
    liquidityUsd: 0, totalSupply: '100B', chart: false
  });
  global.document = detail.document;
  global.location = {
    href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai'
  };
  try {
    const current = await GMGN.readCurrentToken();
    assert.equal(current.quote.priceUsd, 0);
    assert.equal(current.quote.priceProvenance, '');
    assert.equal(current.quote.marketCapUsd, 3_200);
    assert.equal(current.quote.totalSupply, 0);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail DOM price and supply stay untrusted until the current-route chart frame is READY', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000,
    liquidityUsd: 0, totalSupply: '1000', chart: true
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  GMGN._clearChartTrust?.();
  try {
    const current = await GMGN.readCurrentToken();
    assert.equal(current.quote.priceUsd, 0);
    assert.equal(current.quote.totalSupply, 0);
    assert.equal(current.quote.priceProvenance, '');
  } finally {
    GMGN._clearChartTrust?.();
    global.document = original.document;
    global.location = original.location;
  }
});

test('verified detail snapshot synchronously reads a newer quote from the same bound DOM nodes', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 3.75e-6,
    marketCapUsd: 3_750, liquidityUsd: 500, totalSupply: '1000000000'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  GMGN._clearChartTrust();
  try {
    markDetailChartReady(detail, 'base', EVM_ADDRESS);
    assert.equal((await GMGN.readCurrentToken()).quote.marketCapUsd, 3_750);
    detail.setQuote({ priceUsd: 4.3e-6, marketCapUsd: 4_300 });

    const snapshot = GMGN.readVerifiedCurrentTokenSnapshot({ chain: 'base', address: EVM_ADDRESS });

    assert.equal(snapshot.token.chain, 'base');
    assert.equal(snapshot.token.address, EVM_ADDRESS);
    assert.equal(snapshot.quote.priceUsd, 4.3e-6);
    assert.equal(snapshot.quote.marketCapUsd, 4_300);
    assert.equal(snapshot.quote.source, 'GMGN');
  } finally {
    GMGN._clearChartTrust();
    global.document = original.document;
    global.location = original.location;
  }
});

test('verified detail snapshot rejects a replaced DOM binding even with the same fingerprint', async () => {
  const original = { document: global.document, location: global.location };
  const first = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000, liquidityUsd: 500
  });
  const replacement = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 9, marketCapUsd: 9_000, liquidityUsd: 500
  });
  global.document = first.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  GMGN._clearChartTrust();
  try {
    markDetailChartReady(first, 'base', EVM_ADDRESS);
    await GMGN.readCurrentToken();
    global.document = replacement.document;
    markDetailChartReady(replacement, 'base', EVM_ADDRESS);
    assert.equal(GMGN.readVerifiedCurrentTokenSnapshot({ chain: 'base', address: EVM_ADDRESS }), null);
  } finally {
    GMGN._clearChartTrust();
    global.document = original.document;
    global.location = original.location;
  }
});

test('verified detail snapshot rejects mismatched, untrusted, and non-chain-bound detail contexts', async () => {
  const original = { document: global.document, location: global.location };
  const cases = [
    {
      name: 'expected-token address mismatch', expectedToken: { chain: 'base', address: EVM_ADDRESS_2 }
    },
    {
      name: 'cross-chain same address', expectedToken: { chain: 'eth', address: EVM_ADDRESS },
      moveToCrossChain: true
    },
    {
      name: 'cleared chart trust', expectedToken: { chain: 'base', address: EVM_ADDRESS },
      clearChartTrust: true
    },
    {
      name: 'linkless non-chain-bound detail scope', expectedToken: { chain: 'base', address: EVM_ADDRESS },
      linked: false
    }
  ];
  try {
    for (const scenario of cases) {
      const detail = detailDocument({
        chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000,
        liquidityUsd: 500, linked: scenario.linked !== false
      });
      global.document = detail.document;
      global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
      GMGN._clearChartTrust();
      markDetailChartReady(detail, 'base', EVM_ADDRESS);
      await GMGN.readCurrentToken();
      if (scenario.moveToCrossChain) global.location.href = `https://gmgn.ai/eth/token/${EVM_ADDRESS}`;
      if (scenario.clearChartTrust) GMGN._clearChartTrust();

      assert.equal(GMGN.readVerifiedCurrentTokenSnapshot(scenario.expectedToken), null, scenario.name);
    }
  } finally {
    GMGN._clearChartTrust();
    global.document = original.document;
    global.location = original.location;
  }
});

test('a direct TradingView-titled current-route frame can establish chart trust', async () => {
  const original = { document: global.document, location: global.location };
  const frame = { title: 'TradingView', isConnected: true, contentWindow: {} };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000,
    liquidityUsd: 0, totalSupply: '1000', chartFrame: frame
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  GMGN._clearChartTrust?.();
  try {
    assert.equal(GMGN._markChartFrameReady?.(frame, {
      chain: 'base', address: EVM_ADDRESS
    }) ?? false, true);
    assert.equal((await GMGN.readCurrentToken()).quote.priceUsd, 2);
  } finally {
    GMGN._clearChartTrust?.();
    global.document = original.document;
    global.location = original.location;
  }
});

test('token-A READY cannot authorize token-B DOM price during an overlapping SPA route transition', async () => {
  const original = { document: global.document, location: global.location };
  const sharedFrame = { title: 'Financial Chart', isConnected: true, contentWindow: {} };
  const detailA = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000,
    liquidityUsd: 0, totalSupply: '1000', chartFrame: sharedFrame
  });
  const detailB = detailDocument({
    chain: 'base', address: EVM_ADDRESS_2, priceUsd: 3, marketCapUsd: 3_000,
    liquidityUsd: 0, totalSupply: '1000', chartFrame: sharedFrame
  });
  GMGN._clearChartTrust?.();
  try {
    global.document = detailA.document;
    global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
    assert.equal(GMGN._markChartFrameReady?.(sharedFrame, {
      chain: 'base', address: EVM_ADDRESS
    }) ?? false, true);
    assert.equal((await GMGN.readCurrentToken()).quote.priceUsd, 2);

    global.document = detailB.document;
    global.location.href = `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`;
    const overlapping = await GMGN.readCurrentToken();
    assert.equal(overlapping.quote.priceUsd, 0);
    assert.equal(overlapping.quote.totalSupply, 0);

    assert.equal(GMGN._markChartFrameReady?.(sharedFrame, {
      chain: 'base', address: EVM_ADDRESS_2
    }) ?? false, true);
    assert.equal((await GMGN.readCurrentToken()).quote.priceUsd, 3);
  } finally {
    GMGN._clearChartTrust?.();
    global.document = original.document;
    global.location = original.location;
  }
});

test('chart frame load invalidates DOM quote trust until that generation sends READY again', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000,
    liquidityUsd: 0, totalSupply: '1000', chart: true
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  GMGN._clearChartTrust?.();
  try {
    assert.equal(GMGN._markChartFrameReady?.(detail.chartFrame, {
      chain: 'base', address: EVM_ADDRESS
    }) ?? false, true);
    assert.equal((await GMGN.readCurrentToken()).quote.priceUsd, 2);

    GMGN._invalidateChartFrame?.(detail.chartFrame);
    assert.equal((await GMGN.readCurrentToken()).quote.priceUsd, 0);

    assert.equal(GMGN._markChartFrameReady?.(detail.chartFrame, {
      chain: 'base', address: EVM_ADDRESS
    }) ?? false, true);
    assert.equal((await GMGN.readCurrentToken()).quote.priceUsd, 2);
  } finally {
    GMGN._clearChartTrust?.();
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail with a trusted K-line preserves the factual observed Price', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000,
    liquidityUsd: 0, totalSupply: '1000', chart: true
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    markDetailChartReady(detail, 'base', EVM_ADDRESS);
    const current = await GMGN.readCurrentToken();
    assert.equal(current.quote.priceUsd, 2);
    assert.equal(current.quote.valuationMode, 'PRICE');
    assert.equal(current.quote.priceProvenance, 'OBSERVED_PRICE');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail market cap uses an explicit MC item before Total Supply', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 0.000002, liquidityUsd: 500,
    infoItems: [
      { title: 'Price', value: '0.000002' }, { title: 'Total Supply', value: '100B' },
      { title: 'MC', value: '$12.15K' }, { title: 'Liquidity', value: '$500' }
    ]
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    markDetailChartReady(detail, 'robinhood', EVM_ADDRESS);
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.quote.marketCapUsd, 12_150);
    assert.equal(current?.quote.totalSupply, 100_000_000_000);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail market cap accepts limited whitespace after the USD marker in one InfoItem', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 0, liquidityUsd: 500,
    infoItems: [{ title: 'MC', value: '$ 12.15K' }]
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    assert.equal((await GMGN.readCurrentToken())?.quote.marketCapUsd, 12_150);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail market cap accepts the explicit Chinese 市值 title', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 0, liquidityUsd: 500,
    infoItems: [{ title: 'Price', value: '0' }, { title: '市值', value: '$12.15K' }]
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    assert.equal((await GMGN.readCurrentToken())?.quote.marketCapUsd, 12_150);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail market cap safely falls back to an unstructured labeled USD field', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 0, liquidityUsd: 0, baseInfo: false,
    unstructuredItems: [
      { title: 'Market Cap', value: '$12.15K' }, { title: 'Total Supply', value: '100B' }
    ]
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    assert.equal((await GMGN.readCurrentToken())?.quote.marketCapUsd, 12_150);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('Sol detail without explicit market cap keeps factual price and supply without a synthetic MC', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'sol', address: PUMP_ADDRESS, priceUsd: 0.000002, marketCapUsd: 0, liquidityUsd: 500,
    totalSupply: '100B'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/sol/token/${PUMP_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    markDetailChartReady(detail, 'sol', PUMP_ADDRESS);
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.quote.marketCapUsd, 0);
    assert.equal(current?.quote.priceUsd, 0.000002);
    assert.equal(current?.quote.totalSupply, 100_000_000_000);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail FDV guard discards contaminated market caps on every supported chain', async () => {
  const original = { document: global.document, location: global.location };
  const cases = ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer'];
  try {
    for (const chain of cases) {
      const address = chain === 'sol' ? PUMP_ADDRESS : EVM_ADDRESS;
      const detail = detailDocument({
        chain, address, priceUsd: 0.000002, liquidityUsd: 500,
        infoItems: [
          { title: 'Price', value: '0.000002' }, { title: 'MC', value: '$100B' },
          { title: 'Total Supply', value: '100B' }
        ]
      });
      global.document = detail.document;
      global.location = { href: `https://gmgn.ai/${chain}/token/${address}`, origin: 'https://gmgn.ai' };
      markDetailChartReady(detail, chain, address);
      const current = await GMGN.readCurrentToken();
      assert.equal(current?.quote.marketCapUsd, 0, chain);
      assert.equal(current?.quote.priceUsd, 0.000002, chain);
      assert.equal(current?.quote.totalSupply, 100_000_000_000, chain);
    }
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail FDV guard accepts exactly two times FDV and rejects values above it', async () => {
  const original = { document: global.document, location: global.location };
  try {
    for (const [marketCap, expected] of [['$400', 400], ['$400.01', 0]]) {
      const detail = detailDocument({
        chain: 'base', address: EVM_ADDRESS, priceUsd: 2, liquidityUsd: 500,
        infoItems: [
          { title: 'Price', value: '2' }, { title: 'MC', value: marketCap },
          { title: 'Total Supply', value: '100' }
        ]
      });
      global.document = detail.document;
      global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
      markDetailChartReady(detail, 'base', EVM_ADDRESS);
      assert.equal((await GMGN.readCurrentToken())?.quote.marketCapUsd, expected, marketCap);
    }
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail market cap discards a value materially above exact price times supply', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 0.000002, liquidityUsd: 500,
    infoItems: [
      { title: 'Price', value: '0.000002' }, { title: 'MC', value: '$100B' },
      { title: 'Total Supply', value: '100B' }, { title: 'Liquidity', value: '$500' }
    ]
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    markDetailChartReady(detail, 'robinhood', EVM_ADDRESS);
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.quote.marketCapUsd, 0);
    assert.equal(current?.quote.priceUsd, 0.000002);
    assert.equal(current?.quote.totalSupply, 100_000_000_000);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('unlabeled supply cannot become market cap', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 0, liquidityUsd: 500,
    infoItems: [
      { title: 'Price', value: '0' }, { title: null, value: '100B' },
      { title: 'Total Supply', value: '100B' }, { title: 'Liquidity', value: '$500' }
    ]
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    markDetailChartReady(detail, 'robinhood', EVM_ADDRESS);
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.quote.marketCapUsd, 0);
    assert.equal(current?.quote.totalSupply, 100_000_000_000);
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail market cap accepts a legacy unlabeled USD item', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'robinhood', address: EVM_ADDRESS, priceUsd: 0, liquidityUsd: 500,
    infoItems: [
      { title: 'Price', value: '0' }, { title: null, value: 'US$12.15K' },
      { title: 'Total Supply', value: '100B' }, { title: 'Liquidity', value: '$500' }
    ]
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/robinhood/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    markDetailChartReady(detail, 'robinhood', EVM_ADDRESS);
    const current = await GMGN.readCurrentToken();
    assert.equal(current?.quote.marketCapUsd, 12_150);
    assert.equal(current?.quote.totalSupply, 100_000_000_000);
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
    markDetailChartReady(detail, 'base', EVM_ADDRESS_2);
    const current = await GMGN.readCurrentToken();
    assert.equal(current.quote.totalSupply, 1_000_000_000);
    assert.equal(current.quote.supplySource, 'GMGN_EXACT');
    assert.equal(current.token.launchpad, 'Zora');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail quote timestamps and sources every positive DOM observation dimension', async () => {
  const original = { document: global.document, location: global.location, dateNow: Date.now };
  const observedAt = 1_234_567;
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2,
    marketCapUsd: 200, liquidityUsd: 50, totalSupply: '100'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  Date.now = () => observedAt;
  try {
    markDetailChartReady(detail, 'base', EVM_ADDRESS);
    const quote = (await GMGN.readCurrentToken()).quote;
    assert.deepEqual({
      price: [quote.priceObservedAt, quote.priceSource],
      marketCap: [quote.marketCapObservedAt, quote.marketCapSource],
      liquidity: [quote.liquidityObservedAt, quote.liquiditySource],
      totalSupply: [quote.totalSupplyObservedAt, quote.totalSupplyObservationSource]
    }, {
      price: [observedAt, 'GMGN'],
      marketCap: [observedAt, 'GMGN'],
      liquidity: [observedAt, 'GMGN'],
      totalSupply: [observedAt, 'GMGN']
    });
  } finally {
    Date.now = original.dateNow;
    global.document = original.document;
    global.location = original.location;
  }
});

test('detail quote leaves unobserved DOM dimensions without freshness or source metadata', async () => {
  const original = { document: global.document, location: global.location, dateNow: Date.now };
  const observedAt = 1_234_567;
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 2,
    marketCapUsd: 0, liquidityUsd: 0, totalSupply: '0'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  Date.now = () => observedAt;
  try {
    markDetailChartReady(detail, 'base', EVM_ADDRESS);
    const quote = (await GMGN.readCurrentToken()).quote;
    assert.equal(quote.priceObservedAt, observedAt);
    assert.equal(quote.priceSource, 'GMGN');
    assert.equal(quote.marketCapObservedAt, 0);
    assert.equal(quote.marketCapSource, '');
    assert.equal(quote.liquidityObservedAt, 0);
    assert.equal(quote.liquiditySource, '');
    assert.equal(quote.totalSupplyObservedAt, 0);
    assert.equal(quote.totalSupplyObservationSource, '');
  } finally {
    Date.now = original.dateNow;
    global.document = original.document;
    global.location = original.location;
  }
});

test('a liquidity-only detail observation carries aggregate and field freshness', async () => {
  const original = { document: global.document, location: global.location, dateNow: Date.now };
  const observedAt = 1_234_567;
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 0,
    marketCapUsd: 0, liquidityUsd: 50, totalSupply: '0'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  Date.now = () => observedAt;
  try {
    const quote = (await GMGN.readCurrentToken()).quote;
    assert.equal(quote.priceUsd, 0);
    assert.equal(quote.marketCapUsd, 0);
    assert.equal(quote.liquidityUsd, 50);
    assert.equal(quote.observedAt, observedAt);
    assert.equal(quote.liquidityObservedAt, observedAt);
    assert.equal(quote.liquiditySource, 'GMGN');
  } finally {
    Date.now = original.dateNow;
    global.document = original.document;
    global.location = original.location;
  }
});

test('a confirmed detail header retains exact identity metadata without factual quote fields', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 0, marketCapUsd: 0, liquidityUsd: 0
  });
  GMGN._clearTrenchSnapshots();
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  try {
    const current = await GMGN.readCurrentToken();
    assert.deepEqual(current.token, {
      chain: 'base', address: EVM_ADDRESS, symbol: 'TEST', name: 'TEST', logoUrl: '',
      launchpad: '', launchMode: '', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    });
    assert.equal(current.quote.priceUsd, 0);
    assert.equal(current.quote.marketCapUsd, 0);
    assert.equal(current.quote.observedAt, 0);
  } finally {
    GMGN._clearTrenchSnapshots();
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

test('quick-buy records the click-time trench snapshot before its callback can navigate', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({
    chain: 'base', address: EVM_ADDRESS, marketCap: '$2K', identityText: 'DISC Discover Token',
    launchpadHref: `https://clanker.world/token/${EVM_ADDRESS}`
  });
  harness.card.firstElementChild.querySelector = () => ({ src: 'discover.png' });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  GMGN._clearTrenchSnapshots();
  try {
    let snapshotAtCallback = null;
    assert.equal(GMGN.discoverTokenCards(() => {
      global.location.href = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
      snapshotAtCallback = GMGN.readTrenchSnapshot('base', EVM_ADDRESS);
    }, 0.1, 'PAPER'), 1);
    harness.card.innerText = `${EVM_ADDRESS}\nCLICK Click Token\nMC\n$7K`;
    harness.card.firstElementChild.querySelector = () => ({ src: 'click.png' });
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(snapshotAtCallback.token.symbol, 'CLICK');
    assert.equal(snapshotAtCallback.token.name, 'Click Token');
    assert.equal(snapshotAtCallback.token.logoUrl, 'click.png');
    assert.equal(snapshotAtCallback.token.launchpad, 'Clanker');
    assert.equal(snapshotAtCallback.quote.marketCapUsd, 7_000);
  } finally {
    GMGN._clearTrenchSnapshots();
    Object.assign(global, original);
  }
});

test('only an actually added TokenItem root receives an addressless auto-claim birth', () => {
  const fresh = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  const old = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  withQuickBuyGlobals(fresh, {}, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [fresh.card], {
      fast: true, addedRoots: [fresh.card]
    });
    const birth = GMGN._quickBuyBirthForRoot?.(fresh.card);
    assert.equal(birth?.eligible, true);
  });
  withQuickBuyGlobals(old, {}, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [old.identityNode], {
      fast: true, addedRoots: []
    });
    assert.equal(GMGN._quickBuyBirthForRoot?.(old.card) || null, null);
  });
});

test('deferred overflow discovery reuses the birth recorded in the fast mutation turn', () => {
  const harnesses = Array.from({ length: 25 }, () => quickBuyHarness({
    chain: 'base', address: '', tokenItem: true
  }));
  const roots = harnesses.map((harness) => harness.card);
  const overflow = harnesses.at(-1);
  withQuickBuyGlobals(harnesses[0], {}, () => {
    assert.equal(GMGN.discoverTokenCards(() => {}, 1, 'PAPER', roots, {
      fast: true, addedRoots: roots
    }), 24);
    assert.equal(overflow.slot.__tangoQuickBuyBinding, undefined);

    assert.equal(GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [overflow.card], {
      fast: false, addedRoots: []
    }), 1);
    assert.equal(overflow.slot.__tangoQuickBuyBinding.birth, GMGN._quickBuyBirthForRoot(overflow.card));
    assert.equal(overflow.slot.__tangoQuickBuyBinding.birth?.eligible, true);
  });
});

test('deferred overflow discovery reuses a TokenItem ancestor birth', () => {
  const harnesses = Array.from({ length: 25 }, () => quickBuyHarness({
    chain: 'base', address: '', tokenItemAncestor: true
  }));
  const roots = harnesses.map((harness) => harness.tokenRoot);
  const overflow = harnesses.at(-1);
  withQuickBuyGlobals(harnesses[0], {}, () => {
    assert.equal(GMGN.discoverTokenCards(() => {}, 1, 'PAPER', roots, {
      fast: true, addedRoots: roots
    }), 24);
    assert.equal(GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [overflow.card], {
      fast: false, addedRoots: []
    }), 1);
    assert.equal(overflow.slot.__tangoQuickBuyBinding.birth, GMGN._quickBuyBirthForRoot(overflow.tokenRoot));
  });
});

test('conflicting same-chain card addresses never publish a ready quick-buy action', async () => {
  const harness = quickBuyHarness({
    chain: 'base', address: EVM_ADDRESS, tokenItem: true,
    extraTokenHrefs: [`https://gmgn.ai/base/token/${EVM_ADDRESS_2}`]
  });
  const orders = [];
  await withQuickBuyGlobals(harness, {}, async () => {
    GMGN.discoverTokenCards((order) => orders.push(order), 1, 'PAPER', [harness.card], {
      fast: true, addedRoots: [harness.card]
    });
    assert.equal(harness.slot.__tangoQuickBuyBinding?.state, 'resolving-identity');
    assert.equal(harness.slot.dataset.tangoTokenAddress, undefined);
    await harness.invokePaperAction();
    assert.equal(orders.length, 0);
  });
});

test('a detached or ambiguous TokenItem root cannot retain an eligible addressless birth', () => {
  const reinserted = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  const conflicting = quickBuyHarness({
    chain: 'base', address: EVM_ADDRESS, tokenItem: true,
    extraTokenHrefs: [`https://gmgn.ai/base/token/${EVM_ADDRESS_2}`]
  });
  const rewritten = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS, tokenItem: true });
  withQuickBuyGlobals(reinserted, {}, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [reinserted.card], {
      fast: true, addedRoots: [reinserted.card]
    });
    assert.equal(GMGN._quickBuyBirthForRoot?.(reinserted.card)?.eligible, true);
    reinserted.card.isConnected = false;
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [reinserted.card], {
      fast: true, addedRoots: [reinserted.card]
    });
    reinserted.card.isConnected = true;
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [reinserted.card], {
      fast: true, addedRoots: [reinserted.card]
    });
    assert.equal(GMGN._quickBuyBirthForRoot?.(reinserted.card)?.eligible, false);
  });
  withQuickBuyGlobals(conflicting, {}, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [conflicting.card], {
      fast: true, addedRoots: [conflicting.card]
    });
    assert.equal(GMGN._quickBuyBirthForRoot?.(conflicting.card)?.eligible, false);
  });
  withQuickBuyGlobals(rewritten, {}, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [rewritten.card], {
      fast: true, addedRoots: [rewritten.card]
    });
    assert.equal(GMGN._quickBuyBirthForRoot?.(rewritten.card)?.eligible, true);
    rewritten.exposeCardHref('');
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [rewritten.card], {
      fast: true, addedRoots: [rewritten.card]
    });
    assert.equal(GMGN._quickBuyBirthForRoot?.(rewritten.card)?.eligible, false);
  });
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
    GMGN._clearTrenchSnapshots();
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.card]), 1);
    assert.ok(harness.replacement);
    assert.equal(GMGN.readTrenchSnapshot('base', EVM_ADDRESS).token.symbol, 'TEST');
  } finally {
    GMGN._clearTrenchSnapshots();
    Object.assign(global, original);
  }
});

test('detached quick-buy slots release Guard actions without a document rescan', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN, nativeGuard: global.Tango.NativeQuickBuyGuard
  };
  const guard = guardHarness();
  global.Tango.NativeQuickBuyGuard = guard;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const firstOrders = [];
  global.document = first.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards((order) => firstOrders.push(order)), 1);
    const firstReplacement = first.replacement;
    first.card.isConnected = false;
    first.replacement.isConnected = false;
    first.document.querySelectorAll = (selector) => {
      if (selector === '.BuyButton-continer' || selector === '.tango-native-buy-overridden') {
        throw new Error('unexpected document rescan');
      }
      return [];
    };

    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
    assert.equal(first.slot.__tangoQuickBuyHandler, undefined);
    assert.equal(first.slot.dataset.tangoActionId, undefined);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
    await guard.invokeRegistered(firstReplacement);
    assert.equal(firstOrders.length, 0);
  } finally {
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
    if (original.nativeGuard === undefined) delete global.Tango.NativeQuickBuyGuard;
    else global.Tango.NativeQuickBuyGuard = original.nativeGuard;
  }
});

test('incremental discovery supports slot and closest roots beyond 80 visible controls', () => {
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
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', roots), 81);
    assert.equal(harnesses.filter((harness) => harness.replacement).length, 81);
    assert.ok(harnesses[80].replacement);
  } finally {
    Object.assign(global, original);
  }
});

test('virtual-list card reuse without a native leaf keeps one inert paper shell and dispatches only its new action', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN, nativeGuard: global.Tango.NativeQuickBuyGuard
  };
  const guard = guardHarness();
  global.Tango.NativeQuickBuyGuard = guard;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.setNativePresentation(LIVE_QUICK_BUY_SMALL, 'padding: 2px 4px; border-radius: 4px;');
  const orders = [];
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards((order) => orders.push(order)), 1);
    const oldReplacement = harness.replacement;
    const oldActionId = harness.slot.dataset.tangoActionId;
    const oldBindingNonce = harness.slot.dataset.tangoBindingNonce;
    harness.card.getAttribute = (name) => name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;

    assert.equal(freshGmgn.discoverTokenCards((order) => orders.push(order), 0.1, 'PAPER', [harness.slot]), 1);
    assert.equal(harness.nativeControl.restored, 0);
    assert.equal(harness.nativeControl.isConnected, false);
    const replacement = harness.replacement;
    assert.ok(replacement);
    assert.equal(harness.slot.querySelectorAll('.tango-list-quick-buy').length, 1);
    assert.match(replacement.className, /(?:^|\s)tango-list-quick-buy(?:\s|$)/);
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(replacement.style.cssText, '');
    assert.equal(replacement.className, 'tango-list-quick-buy');
    assert.equal(replacement.dataset.tangoQuickBuy, '1');
    assert.equal(replacement.dataset.tangoPaperAction, 'quick-buy');
    assert.equal(replacement.type, 'button');
    assert.equal(replacement.getAttribute('data-testid'), null);
    assert.equal(replacement.getAttribute('href'), null);
    assert.equal(replacement.getAttribute('target'), null);
    assert.equal(replacement.getAttribute('formaction'), null);
    assert.equal(replacement.getAttribute('onclick'), null);
    assert.equal(replacement.getAttribute('id'), null);
    assert.notEqual(harness.slot.dataset.tangoActionId, oldActionId);
    assert.equal(oldReplacement.isConnected, false);

    await guard.invokeRegistered(oldReplacement);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(orders.length, 0);

    await guard.invokeRegistered(replacement);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(orders.length, 1);
    assert.equal(orders[0].token.address, EVM_ADDRESS_2);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
    if (original.nativeGuard === undefined) delete global.Tango.NativeQuickBuyGuard;
    else global.Tango.NativeQuickBuyGuard = original.nativeGuard;
  }
});

test('whole-card and slot replacement releases old bindings and injects only the current live slot', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  let visibleSlots = [first.slot];
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return visibleSlots;
      if (selector === '.tango-native-buy-overridden') return [first, second]
        .filter((harness) => harness.classes.has('tango-native-buy-overridden')).map((harness) => harness.slot);
      return [];
    }
  };
  second.slot.matches = (selector) => selector === '.BuyButton-continer';
  second.slot.querySelectorAll = () => [];
  const secondCard = second.slot.closest();
  second.slot.closest = (selector) => selector === '.BuyButton-continer' ? second.slot : secondCard;
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const oldHandler = first.slot.__tangoQuickBuyHandler;
    first.slot.isConnected = false;
    first.card.isConnected = false;
    first.replacement.isConnected = false;
    visibleSlots = [second.slot];

    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot, second.slot]), 1);
    assert.equal(first.slot.__tangoQuickBuyHandler, undefined);
    assert.equal(first.nativeControl.restored, 0);
    assert.ok(second.replacement);
    assert.equal(typeof second.slot.__tangoQuickBuyHandler, 'function');
    assert.notEqual(second.slot.__tangoQuickBuyHandler, oldHandler);
  } finally {
    Object.assign(global, original);
  }
});

test('Guard invokes one paper action and never the native handler', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN, nativeGuard: global.Tango.NativeQuickBuyGuard
  };
  const guard = guardHarness();
  global.Tango.NativeQuickBuyGuard = guard;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const gate = {};
  gate.promise = new Promise((resolve) => { gate.resolve = resolve; });
  let paperCalls = 0;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    freshGmgn.discoverTokenCards(() => { paperCalls += 1; return gate.promise; });
    const firstInvocation = guard.invokeRegistered(harness.replacement);
    const secondInvocation = guard.invokeRegistered(harness.replacement);
    assert.equal(paperCalls, 1);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
    gate.resolve();
    await firstInvocation;
    await secondInvocation;
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
    if (original.nativeGuard === undefined) delete global.Tango.NativeQuickBuyGuard;
    else global.Tango.NativeQuickBuyGuard = original.nativeGuard;
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
    let unrelatedLifecycleChecks = 0;
    Object.defineProperty(unrelated.slot, 'isConnected', {
      configurable: true,
      get() { unrelatedLifecycleChecks += 1; return true; }
    });
    affected.card.querySelectorAll = (selector) => selector === '.BuyButton-continer' ? [affected.slot] : [];
    affected.card.innerText = 'invalid card';
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', [affected.card]), 0);
    assert.equal(unrelatedLifecycleChecks, 0);
    assert.equal(unrelated.replacement, unrelatedReplacement);
    assert.equal(unrelatedReplacement.isConnected, true);
    assert.equal(unrelated.slot.dataset.tangoQuickBuy, '1');
  } finally {
    Object.assign(global, original);
  }
});
