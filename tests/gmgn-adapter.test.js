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

test('paper quick-buy owns one centered wrapper with canonical four-size profiles', () => {
  const profiles = [
    [LIVE_QUICK_BUY_SMALL, 'small', '24px', '12px'],
    [LIVE_QUICK_BUY_LARGE, 'large', '28px', '13px'],
    [LIVE_QUICK_BUY_XL, 'extra-large', '32px', '14px'],
    [LIVE_QUICK_BUY_GIANT, 'giant', '36px', '16px']
  ];
  for (const [className, id, height, text] of profiles) {
    const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
    harness.setNativePresentation(className, 'color: rgb(1, 2, 3);');
    withQuickBuyGlobals(harness, {}, () => {
      assert.equal(GMGN.discoverTokenCards(() => {}), 1);
      const wrapper = harness.replacement.children[0];
      assert.ok(wrapper, 'paper button should render an owned content wrapper');
      assert.equal(wrapper.className, 'tango-quick-buy-content');
      assert.deepEqual(wrapper.children.map((child) => child.className), [
        'tango-paper-hint', 'tango-buy-amount'
      ]);
      assert.equal(harness.replacement.dataset.tangoQuickBuySize, id);
      assert.equal(harness.replacement.style.getPropertyValue('--tango-quick-buy-height'), height);
      assert.equal(harness.replacement.style.getPropertyValue('--tango-quick-buy-text'), text);
    });
  }
});

test('unchanged binding reconciliation does not rewrite its quick-buy CSS variables', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  withQuickBuyGlobals(harness, {}, () => {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    const setProperty = replacement.style.setProperty;
    let profileWrites = 0;
    replacement.style.setProperty = (...args) => {
      profileWrites += 1;
      return setProperty.apply(replacement.style, args);
    };

    assert.equal(GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [harness.card]), 0);
    assert.equal(profileWrites, 0);
  });
});

test('quick-buy profile accepts exact pairs only and nearest-maps one-dimensional signals', () => {
  assert.equal(GMGN._quickBuyProfileFromPresentation('!h-[24px] !text-[12px]', '').id, 'small');
  assert.equal(GMGN._quickBuyProfileFromPresentation('!h-[100px] !text-[64px]', '').id, 'large');
  assert.equal(GMGN._quickBuyProfileFromPresentation('!h-[24px] !text-[16px]', '').id, 'large');
  assert.equal(GMGN._quickBuyProfileFromPresentation('!h-[35px]', '').id, 'giant');
  assert.equal(GMGN._quickBuyProfileFromPresentation('!text-[16px]', '').id, 'giant');
});

test('paper quick-buy retains only positive visual tokens from hostile native presentation', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.setNativePresentation(
    `${LIVE_QUICK_BUY_LARGE} bg-red-500 from-red-500 via-green-500 to-blue-500 rounded-lg shadow-lg text-white`,
    '--customize-button-ultra-color: #7dd3fc; background: red !important; background-color: blue !important; background-image: linear-gradient(red, blue) !important; border-radius: 8px; color: white;'
  );
  withQuickBuyGlobals(harness, {}, () => {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const classes = harness.replacement.className;
    for (const token of ['text-white', 'rounded-lg', 'shadow-lg']) {
      assert.match(classes, new RegExp(`(?:^|\\s)${token}(?:\\s|$)`));
    }
    assert.doesNotMatch(harness.replacement.className, /(?:^|\s)(?:bg-|from-|via-|to-)/);
    assert.doesNotMatch(harness.replacement.style.cssText, /background(?:-color|-image)?\s*:/i);
    assert.match(harness.replacement.style.cssText, /--customize-button-ultra-color:\s*#7dd3fc/i);
    assert.match(harness.replacement.style.cssText, /border-radius:\s*8px/i);
    assert.match(harness.replacement.style.cssText, /color:\s*white/i);
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

function headlessGmgnOwnedQuickBuyLayoutReport({ paintMode = '', paintProfile = '' } = {}) {
  const contentCss = fs.readFileSync(path.join(__dirname, '../src/content/content.css'), 'utf8');
  const safetyCss = fs.readFileSync(path.join(__dirname, '../src/content/quick-buy-safety.css'), 'utf8');
  const profiles = paintProfile ? [[paintProfile, { small: 24, large: 28, 'extra-large': 32, giant: 36 }[paintProfile],
    { small: 12, large: 13, 'extra-large': 14, giant: 16 }[paintProfile]]] : [
    ['small', 24, 12], ['large', 28, 13], ['extra-large', 32, 14], ['giant', 36, 16]
  ];
  const paintCss = paintMode ? `
.tango-quick-buy-content { background: transparent !important; outline: 0 !important; }
.tango-paper-hint { background: transparent !important; color: rgb(255, 0, 255) !important; text-shadow: none !important; }
.tango-buy-amount, .tango-buy-amount > span { color: rgb(0, 255, 0) !important; text-shadow: none !important; }
body.tango-pixel-inner-positive .tango-buy-amount > span {
  height: .45em !important;
  overflow: hidden !important;
}
body.tango-pixel-outer-positive .tango-list-quick-buy { clip-path: inset(50% 0 0 0) !important; }
body.tango-pixel-oracle .tango-list-quick-buy,
body.tango-pixel-oracle .tango-quick-buy-content,
body.tango-pixel-oracle .tango-buy-amount,
body.tango-pixel-oracle .tango-buy-amount > span { overflow: visible !important; }
body.tango-pixel-oracle .tango-buy-amount { min-height: 0 !important; }
body.tango-pixel-label-ink .tango-buy-amount { visibility: hidden !important; }
body.tango-pixel-amount-ink .tango-paper-hint,
body.tango-pixel-amount-overlap .tango-paper-hint { visibility: hidden !important; }
body.tango-pixel-amount-overlap .tango-buy-amount {
  transform: translateY(calc(-.45em - 4px)) !important;
}
` : '';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tango-gmgn-owned-layout-'));
  const pagePath = path.join(tempRoot, 'layout.html');
  const userDataDir = path.join(tempRoot, 'chrome-profile');
  const screenshotPath = path.join(tempRoot, 'layout.png');
  try {
    const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>pending</title>
<style>
${safetyCss}
${contentCss}
${paintCss}
html, body { margin: 0; padding: 0; }
body { background: #0c0d12; color: white; font: 13px/1 Arial, sans-serif; }
#cases { display: flex; gap: 16px; padding: 12px; }
.fixture { --gmgn-action-height: 22px; width: 340px; }
.fixture[data-gmgn-profile="small"] { --gmgn-action-height: 18px; }
.fixture[data-gmgn-profile="large"] { --gmgn-action-height: 20px; }
.fixture[data-gmgn-profile="extra-large"] { --gmgn-action-height: 21px; }
.fixture[data-gmgn-profile="giant"] { --gmgn-action-height: 22px; }
.gmgn-card {
  background: linear-gradient(90deg, #171923, #251b45);
  box-sizing: border-box;
  display: grid;
  grid-template-rows: 88px var(--gmgn-action-height);
  height: calc(88px + var(--gmgn-action-height));
  overflow: visible;
  width: 340px;
}
.gmgn-info { min-height: 0; }
.gmgn-actions {
  align-items: stretch;
  display: flex;
  gap: 4px;
  height: var(--gmgn-action-height);
  justify-content: flex-end;
  min-height: 0;
  overflow: visible;
}
.layout-slot, .gmgn-native-slot { flex: 0 0 96px; height: 100%; min-height: 0; width: 96px; }
.layout-slot > [class~="group/btn"], .gmgn-native-slot > [class~="group/btn"] {
  align-items: stretch;
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  position: relative;
  width: 100%;
}
.layout-slot button { font: inherit; margin: 0; }
.gmgn-native-surface { border: 0; height: 100%; margin: 0; padding: 0; width: 100%; }
.native-real-quick-buy { inset: 0; position: absolute; }
.next-card { margin-top: 4px; }
.paper-card { margin-top: 12px; }
</style></head><body><main id="cases"></main><script>
(() => {
  const profiles = ${JSON.stringify(profiles)};
  document.body.className = ${JSON.stringify(paintMode ? paintMode.split(/\s+/).map((mode) => 'tango-pixel-' + mode).join(' ') : '')};
  const rect = (element) => {
    const value = element.getBoundingClientRect();
    return { left: value.left, top: value.top, right: value.right, bottom: value.bottom,
      width: value.width, height: value.height,
      centerX: value.left + value.width / 2, centerY: value.top + value.height / 2 };
  };
  const textRect = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return rect(range);
  };
  const contains = (outer, inner) => inner.left >= outer.left - 0.5
    && inner.top >= outer.top - 0.5 && inner.right <= outer.right + 0.5
    && inner.bottom <= outer.bottom + 0.5;
  const overlaps = (left, right) => Math.min(left.right, right.right) - Math.max(left.left, right.left) > 0.5
    && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0.5;
  const hasVisibleBackground = (element) => {
    const value = getComputedStyle(element).backgroundColor;
    return value !== 'transparent'
      && !/(?:rgba|hsla)\\([^)]*[,/]\\s*0(?:\\.0+)?\\s*\\)$/i.test(value)
      && !/\\/\\s*0(?:\\.0+)?\\s*\\)/.test(value);
  };
  const buildPaperControl = (slot, nested) => {
    const host = nested ? document.createElement('div') : slot;
    if (nested) host.className = 'group/btn';
    const native = document.createElement('button');
    native.className = 'native-real-quick-buy';
    native.dataset.testid = 'quickbuy';
    native.textContent = 'REAL';
    const paper = document.createElement('button');
    paper.className = 'tango-list-quick-buy tango-quick-buy-fallback';
    paper.dataset.tangoPublished = '1';
    paper.style.cssText = 'border:3px solid rgb(255,0,0);outline:2px solid rgb(255,0,0);box-shadow:0 0 8px rgb(255,0,0)';
    const wrapper = document.createElement('span');
    wrapper.className = 'tango-quick-buy-content';
    const hint = document.createElement('span');
    hint.className = 'tango-paper-hint';
    hint.textContent = '模拟盘';
    const amount = document.createElement('span');
    amount.className = 'tango-buy-amount';
    amount.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m13.688 8.12-6.471 7.705c-.206.245-.604.061-.55-.255l1.007-5.843-4.617-.061c-.88-.012-1.352-1.038-.79-1.714L8.723.191c.205-.247.605-.063.55.253L8.247 6.399l4.641.003c.888.001 1.371 1.038.8 1.718Z"></path></svg><span>2.5 BNB</span>';
    wrapper.append(hint, amount);
    paper.append(wrapper);
    host.append(native, paper);
    if (nested) slot.append(host);
    const reinserted = paper.cloneNode(true);
    paper.replaceWith(reinserted);
    return { slot, host, native, paper: reinserted };
  };
  const buildNativeBaseline = (nested) => {
    const card = document.createElement('article');
    card.className = 'gmgn-card';
    const info = document.createElement('div');
    info.className = 'gmgn-info';
    const row = document.createElement('div');
    row.className = 'gmgn-actions';
    const controls = [];
    for (let index = 0; index < 2; index += 1) {
      const slot = document.createElement('div');
      slot.className = 'gmgn-native-slot';
      const host = nested ? document.createElement('div') : slot;
      if (nested) host.className = 'group/btn';
      const surface = document.createElement('button');
      surface.className = 'gmgn-native-surface';
      host.append(surface);
      if (nested) slot.append(host);
      row.append(slot);
      controls.push({ slot, host, surface });
    }
    card.append(info, row);
    const next = document.createElement('article');
    next.className = 'gmgn-card next-card';
    return { card, row, next, controls };
  };
  const buildFixture = (id, nested) => {
    const fixture = document.createElement('section');
    fixture.className = 'fixture';
    fixture.id = id;
    const baseline = buildNativeBaseline(nested);
    const card = document.createElement('article');
    card.className = 'gmgn-card paper-card';
    const info = document.createElement('div');
    info.className = 'gmgn-info';
    const row = document.createElement('div');
    row.className = 'gmgn-actions';
    row.dataset.sentryComponent = 'BuyButtons';
    const controls = [];
    for (let index = 0; index < 2; index += 1) {
      const slot = document.createElement('div');
      slot.className = 'BuyButton-continer tango-native-buy-overridden layout-slot';
      slot.dataset.tangoQuickBuy = '1';
      row.append(slot);
      controls.push(buildPaperControl(slot, nested));
    }
    card.append(info, row);
    const next = document.createElement('article');
    next.className = 'gmgn-card next-card';
    fixture.append(baseline.card, baseline.next, card, next);
    document.querySelector('#cases').append(fixture);
    return { id, nested, baseline, card, row, next, controls };
  };
  const fixtures = [buildFixture('direct', false), buildFixture('nested', true)];
  const states = [];
  for (const [profile, profileHeight, profileText] of profiles) {
    for (const fixture of fixtures) {
      fixture.baseline.card.parentElement.dataset.gmgnProfile = profile;
      for (const control of fixture.baseline.controls) {
        control.host.dataset.gmgnQuickBuySize = profile;
      }
      for (const control of fixture.controls) {
        control.host.dataset.gmgnQuickBuySize = profile;
        control.slot.style.setProperty('--tango-quick-buy-height', profileHeight + 'px');
        control.paper.dataset.tangoQuickBuySize = profile;
        control.paper.style.setProperty('--tango-quick-buy-height', profileHeight + 'px');
        control.paper.style.setProperty('--tango-quick-buy-text', profileText + 'px');
      }
    }
    document.body.offsetHeight;
    for (const fixture of fixtures) {
      const baselineControlStates = fixture.baseline.controls.map((control) => ({
        slot: rect(control.slot), host: rect(control.host), surface: rect(control.surface)
      }));
      const baseline = {
        card: rect(fixture.baseline.card),
        row: rect(fixture.baseline.row),
        next: rect(fixture.baseline.next),
        controls: baselineControlStates
      };
      const rowRect = rect(fixture.row);
      const controlStates = fixture.controls.map((control) => {
        const slotRect = rect(control.slot);
        const hostRect = rect(control.host);
        const paperRect = rect(control.paper);
        const wrapper = control.paper.querySelector('.tango-quick-buy-content');
        const hint = wrapper.querySelector('.tango-paper-hint');
        const amount = wrapper.querySelector('.tango-buy-amount');
        const amountIcon = amount.querySelector('svg');
        const amountLabel = amount.querySelector('span');
        const wrapperRect = rect(wrapper);
        const hintRect = rect(hint);
        const amountRect = rect(amount);
        const wrapperStyle = getComputedStyle(wrapper);
        const hintStyle = getComputedStyle(hint);
        const amountStyle = getComputedStyle(amount);
        const paperStyle = getComputedStyle(control.paper);
        return {
          slot: slotRect, host: hostRect, paper: paperRect, wrapper: wrapperRect, hint: hintRect, amount: amountRect,
          amountLabel: rect(amountLabel),
          rowContainsSlot: contains(rowRect, slotRect),
          slotContainsHost: contains(slotRect, hostRect),
          slotContainsPaper: contains(slotRect, paperRect),
          slotContainsWrapper: contains(slotRect, wrapperRect),
          pointerEvents: paperStyle.pointerEvents,
          paperOverflow: paperStyle.overflow,
          visibility: paperStyle.visibility,
          nativePointerEvents: getComputedStyle(control.native).pointerEvents,
          nativeVisibility: getComputedStyle(control.native).visibility,
          fontSize: Number.parseFloat(wrapperStyle.fontSize),
          hintFontSize: Number.parseFloat(hintStyle.fontSize),
          amountFontSize: Number.parseFloat(amountStyle.fontSize),
          hintLineHeight: Number.parseFloat(hintStyle.lineHeight),
          amountLineHeight: Number.parseFloat(amountStyle.lineHeight),
          wrapperPadding: [
            Number.parseFloat(wrapperStyle.paddingTop),
            Number.parseFloat(wrapperStyle.paddingRight),
            Number.parseFloat(wrapperStyle.paddingBottom),
            Number.parseFloat(wrapperStyle.paddingLeft)
          ],
          rowsDoNotOverlap: hintRect.bottom <= amountRect.top + 0.5,
          textLayerPointerEvents: getComputedStyle(wrapper).pointerEvents,
          paperHasVisibleBackground: hasVisibleBackground(control.paper),
          paperBorderWidth: Number.parseFloat(paperStyle.borderTopWidth),
          paperOutlineWidth: Number.parseFloat(paperStyle.outlineWidth),
          paperBoxShadow: paperStyle.boxShadow,
          wrapperHasVisibleBackground: hasVisibleBackground(wrapper),
          wrapperContainsHint: contains(wrapperRect, hintRect),
          wrapperContainsAmount: contains(wrapperRect, amountRect),
          hintTextFitsHorizontally: (() => { const value = textRect(hint); return value.left >= wrapperRect.left - 0.5 && value.right <= wrapperRect.right + 0.5; })(),
          amountTextFitsHorizontally: (() => { const value = textRect(amountLabel); return value.left >= wrapperRect.left - 0.5 && value.right <= wrapperRect.right + 0.5; })(),
          amountContainsIcon: contains(amountRect, rect(amountIcon)),
          amountContainsLabel: contains(amountRect, rect(amountLabel)),
          contentOverflow: {
            wrapper: [wrapper.scrollWidth, wrapper.clientWidth, wrapper.scrollHeight, wrapper.clientHeight],
            hint: [hint.scrollWidth, hint.clientWidth, hint.scrollHeight, hint.clientHeight],
            amount: [amount.scrollWidth, amount.clientWidth, amount.scrollHeight, amount.clientHeight]
          }
        };
      });
      states.push({
        fixture: fixture.id, nested: fixture.nested, profile, profileHeight, profileText,
        baseline, card: rect(fixture.card), row: rowRect, next: rect(fixture.next), controls: controlStates,
        siblingSlotsOverlap: overlaps(controlStates[0].slot, controlStates[1].slot),
        siblingSurfacesOverlap: overlaps(controlStates[0].wrapper, controlStates[1].wrapper)
      });
    }
  }
  const focusPaper = fixtures[0].controls[0].paper;
  focusPaper.focus({ focusVisible: true });
  const focusWrapperStyle = getComputedStyle(focusPaper.querySelector('.tango-quick-buy-content'));
  const focusPaperStyle = getComputedStyle(focusPaper);
  const focus = {
    active: document.activeElement === focusPaper,
    paperOutlineWidth: Number.parseFloat(focusPaperStyle.outlineWidth),
    wrapperOutlineWidth: Number.parseFloat(focusWrapperStyle.outlineWidth),
    wrapperOutlineStyle: focusWrapperStyle.outlineStyle
  };
  document.title = btoa(JSON.stringify({ states, focus }));
})();
</script></body></html>`;
    fs.writeFileSync(pagePath, page, 'utf8');
    const executable = localChromeExecutable();
    const result = spawnSync(executable, [
      '--headless', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--no-sandbox',
      '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1000', '--dump-dom', `--user-data-dir=${userDataDir}`,
      ...(paintMode ? ['--window-size=800,800', `--screenshot=${screenshotPath}`] : []),
      pathToFileURL(pagePath).href
    ], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(result.error, undefined, `Headless Chrome failed to start: ${result.error?.message || ''}`);
    assert.equal(result.status, 0, `Headless Chrome exited ${result.status}: ${result.stderr || result.stdout}`);
    const title = result.stdout.match(/<title>([^<]+)<\/title>/i)?.[1];
    assert.ok(title, `Headless Chrome did not return GMGN-owned layout telemetry: ${result.stderr || result.stdout}`);
    const layout = JSON.parse(Buffer.from(title, 'base64').toString('utf8'));
    return paintMode ? { layout, image: decodeRgbaPng(fs.readFileSync(screenshotPath)) } : layout;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('headless Chrome matches each GMGN-owned size profile while Tango changes only inner presentation', () => {
  const report = headlessGmgnOwnedQuickBuyLayoutReport();
  assert.equal(report.states.length, 8, 'direct/nested x four profiles must be measured against native baselines');
  const expectedAmountFont = { small: 11, large: 12, 'extra-large': 13, giant: 14 };
  const expectedHintFont = { small: 8, large: 9, 'extra-large': 9, giant: 10 };
  const expectedRowHeight = { small: 18, large: 20, 'extra-large': 21, giant: 22 };
  const closeTo = (actual, expected) => Math.abs(actual - expected) <= 0.01;
  assert.equal(report.focus.active, true, 'paper quick-buy accepts keyboard focus');
  assert.equal(report.focus.paperOutlineWidth, 0, 'full-slot outer outline remains visually transparent');
  assert.ok(report.focus.wrapperOutlineWidth >= 1, 'keyboard focus is repainted on the compact inner surface');
  assert.equal(report.focus.wrapperOutlineStyle, 'solid', 'compact focus indicator is visible');
  const clippedContent = report.states.flatMap((state) => state.controls.flatMap((control, index) => {
    const overflow = Object.entries(control.contentOverflow).filter(([, dimensions]) => {
      const [scrollWidth, clientWidth] = dimensions;
      return scrollWidth > clientWidth;
    });
    return control.hintTextFitsHorizontally && control.amountTextFitsHorizontally
      && control.amountContainsLabel && !overflow.length ? [] : [{
      fixture: state.fixture, profile: state.profile, control: index,
      hintTextFitsHorizontally: control.hintTextFitsHorizontally,
      amountTextFitsHorizontally: control.amountTextFitsHorizontally,
      amountContainsLabel: control.amountContainsLabel, overflow: Object.fromEntries(overflow),
    }];
  }));
  assert.deepEqual(clippedContent, [],
    `real paper label, lightning icon and amount must remain complete: ${JSON.stringify(clippedContent)}`);
  for (const state of report.states) {
    const baseline = state.baseline;
    assert.equal(baseline.row.height, expectedRowHeight[state.profile],
      `${state.fixture}/${state.profile}: fixture exposes the current GMGN-owned row height`);
    assert.equal(baseline.card.height, 88 + expectedRowHeight[state.profile],
      `${state.fixture}/${state.profile}: native card follows its GMGN profile`);
    assert.equal(state.card.width, baseline.card.width, `${state.fixture}/${state.profile}: paper card width matches native`);
    assert.equal(state.card.height, baseline.card.height, `${state.fixture}/${state.profile}: paper card height matches native`);
    assert.equal(state.row.width, baseline.row.width, `${state.fixture}/${state.profile}: paper row width matches native`);
    assert.equal(state.row.height, baseline.row.height, `${state.fixture}/${state.profile}: paper row height matches native`);
    assert.equal(state.next.top - state.card.bottom, 4, `${state.fixture}/${state.profile}: next-card position`);
    assert.equal(baseline.next.top - baseline.card.bottom, 4,
      `${state.fixture}/${state.profile}: native next-card baseline`);
    assert.equal(state.siblingSlotsOverlap, false, `${state.fixture}/${state.profile}: sibling slots do not overlap`);
    assert.equal(state.siblingSurfacesOverlap, false, `${state.fixture}/${state.profile}: visible surfaces do not overlap`);
    for (const [index, control] of state.controls.entries()) {
      const nativeControl = baseline.controls[index];
      assert.equal(control.slot.width, nativeControl.slot.width,
        `${state.fixture}/${state.profile}: slot width remains GMGN-owned`);
      assert.equal(control.slot.height, nativeControl.slot.height,
        `${state.fixture}/${state.profile}: slot height remains GMGN-owned`);
      assert.equal(control.host.width, nativeControl.host.width,
        `${state.fixture}/${state.profile}: action-host width remains GMGN-owned`);
      assert.equal(control.host.height, nativeControl.host.height,
        `${state.fixture}/${state.profile}: action-host height remains GMGN-owned`);
      assert.equal(control.paper.width, nativeControl.surface.width,
        `${state.fixture}/${state.profile}: transparent paper hit area fills native width`);
      assert.equal(control.paper.height, nativeControl.surface.height,
        `${state.fixture}/${state.profile}: transparent paper hit area fills native height`);
      assert.equal(control.wrapper.width, control.paper.width,
        `${state.fixture}/${state.profile}: visible text layer fills the paper-button width`);
      assert.equal(control.wrapper.height, control.paper.height,
        `${state.fixture}/${state.profile}: visible text layer fills the paper-button height`);
      assert.equal(control.rowContainsSlot, true, `${state.fixture}/${state.profile}: slot stays inside the row`);
      assert.equal(control.slotContainsHost, true, `${state.fixture}/${state.profile}: host stays inside the slot`);
      assert.equal(control.slotContainsPaper, true, `${state.fixture}/${state.profile}: hit area stays inside the slot`);
      assert.equal(control.slotContainsWrapper, true, `${state.fixture}/${state.profile}: visible surface stays inside the slot`);
      assert.equal(control.pointerEvents, 'auto', `${state.fixture}/${state.profile}: paper control stays clickable`);
      assert.equal(control.visibility, 'visible', `${state.fixture}/${state.profile}: paper control stays visible`);
      assert.equal(control.nativePointerEvents, 'none', `${state.fixture}/${state.profile}: real control stays inert`);
      assert.equal(control.nativeVisibility, 'hidden', `${state.fixture}/${state.profile}: real control stays hidden`);
      assert.equal(control.fontSize, expectedAmountFont[state.profile], `${state.fixture}/${state.profile}: profile typography`);
      assert.equal(control.amountFontSize, expectedAmountFont[state.profile]);
      assert.equal(control.hintFontSize, expectedHintFont[state.profile]);
      assert.equal(closeTo(control.amountLineHeight, expectedAmountFont[state.profile] * 0.9), true);
      assert.equal(closeTo(control.hintLineHeight, expectedHintFont[state.profile] * 0.9), true);
      assert.deepEqual(control.wrapperPadding, [0, 2, 0, 2]);
      assert.equal(control.rowsDoNotOverlap, true,
        `${state.fixture}/${state.profile}: paper label and amount use separate rows`);
      assert.equal(control.textLayerPointerEvents, 'none',
        `${state.fixture}/${state.profile}: inner text cannot steal the outer paper click`);
      assert.equal(control.paperHasVisibleBackground, false, `${state.fixture}/${state.profile}: full hit area stays transparent`);
      assert.equal(control.paperBorderWidth, 0, `${state.fixture}/${state.profile}: full hit area has no painted border`);
      assert.equal(control.paperOutlineWidth, 0, `${state.fixture}/${state.profile}: full hit area has no painted outline`);
      assert.equal(control.paperBoxShadow, 'none', `${state.fixture}/${state.profile}: full hit area has no painted shadow`);
      assert.equal(control.wrapperHasVisibleBackground, true, `${state.fixture}/${state.profile}: only inner surface is painted`);
      assert.equal(control.wrapperContainsHint, true, `${state.fixture}/${state.profile}: full paper label remains visible`);
      assert.equal(control.wrapperContainsAmount, true, `${state.fixture}/${state.profile}: full amount group remains visible`);
      assert.equal(control.hintTextFitsHorizontally, true, `${state.fixture}/${state.profile}: paper-label glyphs remain horizontally visible`);
      assert.equal(control.amountTextFitsHorizontally, true, `${state.fixture}/${state.profile}: amount glyphs remain horizontally visible`);
      assert.equal(control.amountContainsIcon, true, `${state.fixture}/${state.profile}: lightning icon remains visible`);
      assert.equal(control.amountContainsLabel, true, `${state.fixture}/${state.profile}: full amount text remains visible`);
      for (const [part, [scrollWidth, clientWidth]] of Object.entries(control.contentOverflow)) {
        assert.ok(scrollWidth <= clientWidth,
          `${state.fixture}/${state.profile}: ${part} must not clip real quick-buy text horizontally; `
          + `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
      }
    }
  }
  for (const fixture of ['direct', 'nested']) {
    const states = report.states.filter((state) => state.fixture === fixture);
    assert.deepEqual(states.map((state) => state.baseline.row.height), [18, 20, 21, 22],
      `${fixture}: GMGN remains free to change its own row geometry across profiles`);
    assert.deepEqual(states.map((state) => state.controls[0].wrapper.height), [18, 20, 21, 22],
      `${fixture}: the visible text layer follows GMGN's outer control height`);
  }
});

test('headless Chrome pixel gate detects clipped quick-buy ink against an unchanged-geometry oracle', () => {
  for (const profile of ['small', 'large', 'extra-large', 'giant']) {
    const clipped = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'clipped', paintProfile: profile });
    const oracle = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'oracle', paintProfile: profile });
    const innerPositive = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'inner-positive', paintProfile: profile });
    const innerPositiveOracle = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'oracle inner-positive', paintProfile: profile });
    const outerPositive = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'outer-positive', paintProfile: profile });
    const clippedControls = clipped.layout.states.flatMap((state) => state.controls);
    const oracleControls = oracle.layout.states.flatMap((state) => state.controls);
    const innerPositiveControls = innerPositive.layout.states.flatMap((state) => state.controls);
    const innerPositiveOracleControls = innerPositiveOracle.layout.states.flatMap((state) => state.controls);
    const outerPositiveControls = outerPositive.layout.states.flatMap((state) => state.controls);
    const textClippingGeometry = (controls) => controls.map((control) => [
      control.paper, control.wrapper, control.hint, control.amount, control.amountLabel
    ]);
    assert.deepEqual(textClippingGeometry(oracleControls), textClippingGeometry(clippedControls),
      `${profile}: oracle changes no element geometry`);
    assert.deepEqual(textClippingGeometry(innerPositiveOracleControls), textClippingGeometry(innerPositiveControls),
      `${profile}: inner clipping oracle pins every text ancestor geometry`);
    assert.deepEqual(textClippingGeometry(outerPositiveControls), textClippingGeometry(clippedControls),
      `${profile}: outer clipping control changes no text geometry`);
    assert.deepEqual(oracleControls.map((control) => control.paperOverflow), ['visible', 'visible', 'visible', 'visible'],
      `${profile}: oracle exposes the outer paper boundary without changing geometry`);
    assert.equal(missingColoredInk(clipped.image, oracle.image), 0,
      `${profile}: production clipping must retain every oracle ink pixel`);
    assert.ok(missingColoredInk(innerPositive.image, innerPositiveOracle.image) > 0,
      `${profile}: deliberate inner clipping proves the pixel detector rejects missing ink`);
    assert.ok(missingColoredInk(outerPositive.image, oracle.image) > 0,
      `${profile}: deliberate outer clipping proves the pixel detector rejects missing ink`);
  }
});

test('headless Chrome keeps enlarged label and amount glyph ink on separate rows', () => {
  const geometry = (report) => report.layout.states.flatMap((state) => state.controls.map((control) => [
    control.paper, control.wrapper, control.hint, control.amount
  ]));
  for (const profile of ['small', 'large', 'extra-large', 'giant']) {
    const label = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'label-ink', paintProfile: profile });
    const amount = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'amount-ink', paintProfile: profile });
    const positive = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'amount-overlap', paintProfile: profile });
    assert.deepEqual(geometry(label), geometry(amount), `${profile}: ink layers use identical geometry`);
    assert.equal(overlappingColoredInk(label.image, amount.image), 0,
      `${profile}: real label and amount glyph ink must not overlap`);
    assert.ok(overlappingColoredInk(label.image, positive.image) > 0,
      `${profile}: shifted test-only amount proves the overlap detector is sensitive`);
  }
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
      if (result) actions.set(element, activate);
      else actions.delete(element);
      return result;
    },
    isPaperActionTrusted(element, descriptor) {
      return this.trusted && element === this.descriptor?.element
        && descriptor.actionId === this.descriptor?.actionId
        && descriptor.bindingNonce === this.descriptor?.bindingNonce;
    },
    revokePaperAction(element) {
      this.trusted = false;
      actions.delete(element);
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

test('quick-buy follows four native GMGN presentations without height inference or action attributes', () => {
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

    for (const { name, className, cssText, height } of [
      { name: 'small', className: 'gmgn-small rounded-sm', cssText: 'padding: 2px 4px;', height: 22 },
      { name: 'large', className: 'gmgn-large rounded-md', cssText: 'padding: 4px 8px;', height: 113 },
      { name: 'extra-large', className: 'gmgn-xl rounded-lg', cssText: 'padding: 7px 10px;', height: 22 },
      { name: 'giant', className: 'gmgn-giant rounded-xl', cssText: 'padding: 10px 14px;', height: 113 }
    ]) {
      harness.setSlotRect({ height, width: 80 });
      harness.setNativePresentation(className, cssText);
      resizeCallback([{ target: harness.slot }]);
      freshGmgn.discoverTokenCards((order) => orders.push(order));
      assert.match(replacement.className, new RegExp(`(?:^|\\s)${className.split(' ')[1]}(?:\\s|$)`), name);
      assert.doesNotMatch(replacement.className, new RegExp(`(?:^|\\s)${className.split(' ')[0]}(?:\\s|$)`), name);
      assert.doesNotMatch(replacement.style.cssText, /padding\s*:/i, name);
      assert.equal(replacement.getAttribute('data-testid'), null);
      assert.equal(replacement.getAttribute('href'), null);
      assert.equal(replacement.getAttribute('target'), null);
      assert.equal(replacement.getAttribute('formaction'), null);
      assert.equal(replacement.getAttribute('onclick'), null);
      assert.equal(replacement.getAttribute('id'), null);
      assert.equal(replacement.type, 'button');
      assert.equal(harness.slot.dataset.tangoQuickSize, undefined);
      assert.equal(harness.slot.dataset.tangoActionId, actionId);
    }
    assert.equal(orders.length, 0);

    harness.setSlotRect({ height: 24, width: 80 });
    harness.setNativeRect({ height: 32, width: 72 });
    harness.nativeControl.isConnected = true;
    assert.equal(freshGmgn.discoverTokenCards((order) => orders.push(order)), 0);
    assert.equal(harness.replacement, replacement);
    assert.match(replacement.className, /rounded-xl/);
    assert.doesNotMatch(replacement.className, /gmgn-giant/);
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

test('quick-buy remains present through zero geometry and reapplies a recreated native presentation', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver, gmgn: global.Tango.GMGN
  };
  let resizeCallback;
  class FakeResizeObserver {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() {}
  }
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness();
  harness.setSlotRect({ height: 0, width: 0 });
  harness.setNativeRect({ height: 0, width: 0 });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = () => 1;
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.doesNotMatch(harness.replacement.className, /gmgn-small/);
    assert.match(harness.replacement.className, /rounded-sm/);
    assert.equal(harness.slot.dataset.tangoQuickSize, undefined);
    harness.setNativePresentation('gmgn-large restored-by-react', 'padding: 8px 12px;');
    harness.setSlotRect({ height: 48, width: 96 });
    resizeCallback([{ target: harness.slot }]);
    freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]);
    assert.doesNotMatch(harness.replacement.className, /restored-by-react/);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.slot.dataset.tangoQuickSize, undefined);
  } finally {
    delete require.cache[modulePath];
    Object.assign(global, original);
    global.Tango.GMGN = original.gmgn;
  }
});

test('current-card paper target rejects transient native zero geometry while retaining safe GMGN visuals', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness();
  harness.setSlotRect({ height: 24, width: 80 });
  harness.setNativeRect({ height: 0, width: 0 });
  harness.setNativePresentation(
    `${LIVE_QUICK_BUY_SMALL} gmgn-small rounded-sm hidden invisible opacity-0 pointer-events-none absolute translate-x-full !h-[0px] !w-[0px] !min-h-[0px] !max-h-[0px] hover:h-0 md:hidden data-[state=loading]:pointer-events-none group-hover:opacity-0 hover:!h-[0px] hover:[height:0px] hover:![height:0px] hover:!-translate-x-full focus:-translate-y-full active:!-scale-0 lg:!-top-full hover:!items-start hover:!justify-start focus:!flex-col active:!self-start md:!place-items-start group-hover:!text-left hover:!pt-10 focus:!leading-[100px] hover:!text-[64px] group-hover:!gap-12 hover:!h-[36px] hover:!block !pt-10 !shadow-xl pt-10! leading-[100px]! text-[64px]! gap-12! h-[36px]! block! shadow-xl! supports-[display:grid]:grid`,
    'display: none; visibility: hidden; pointer-events: none; opacity: 0; position: absolute; transform: scale(0); width: 0; height: 0; min-height: 0; max-height: 0; text-align: left !important; padding: 2px 4px; border-radius: 4px; color: rgb(1, 2, 3); background: rgb(4, 5, 6);'
  );
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.deepEqual(harness.replacement.getBoundingClientRect(), { height: 24, width: 80 });
    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(harness.replacement.style.getPropertyValue('--tango-quick-buy-height'), '24px');
    assert.equal(harness.replacement.style.getPropertyValue('--tango-quick-buy-text'), '12px');
    assert.doesNotMatch(harness.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.match(harness.replacement.className, /(?:^|\s)rounded-sm(?:\s|$)/);
    assert.doesNotMatch(
      harness.replacement.className,
      /(?:^|\s)(?:hidden|invisible|opacity-0|pointer-events-none|absolute|translate-x-full|!h-\[0px\]|!w-\[0px\]|!min-h-\[0px\]|!max-h-\[0px\]|hover:h-0|md:hidden|data-\[state=loading\]:pointer-events-none|group-hover:opacity-0|hover:!h-\[0px\]|hover:\[height:0px\]|hover:!\[height:0px\]|hover:!-translate-x-full|focus:-translate-y-full|active:!-scale-0|lg:!-top-full|hover:!items-start|hover:!justify-start|focus:!flex-col|active:!self-start|md:!place-items-start|group-hover:!text-left|hover:!pt-10|focus:!leading-\[100px\]|hover:!text-\[64px\]|group-hover:!gap-12|hover:!h-\[36px\]|hover:!block|!pt-10|!shadow-xl|pt-10!|leading-\[100px\]!|text-\[64px\]!|gap-12!|h-\[36px\]!|block!|shadow-xl!)(?:\s|$)/
    );
    assert.doesNotMatch(harness.replacement.className, /(?:^|\s)supports-\[display:grid\]:grid(?:\s|$)/);
    assert.doesNotMatch(
      harness.replacement.style.cssText,
      /(?:display|visibility|pointer-events|opacity|position|transform|text-align|(?:min-|max-)?(?:width|height))\s*:/i
    );
    assert.doesNotMatch(harness.replacement.style.cssText, /padding\s*:/i);
    assert.match(harness.replacement.style.cssText, /border-radius:\s*4px/i);
    assert.match(harness.replacement.style.cssText, /color:\s*rgb\(1, 2, 3\)/i);
    assert.doesNotMatch(harness.replacement.style.cssText, /background(?:-color|-image)?\s*:/i);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
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

test('detached native presentation mutations update the connected paper shell without resize or rediscovery', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    MutationObserver: global.MutationObserver, ResizeObserver: global.ResizeObserver,
    gmgn: global.Tango.GMGN
  };
  const mutationObservers = [];
  const resizeCallbacks = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      mutationObservers.push(this);
    }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() {}
  }
  class FakeResizeObserver {
    constructor(callback) { resizeCallbacks.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.MutationObserver = FakeMutationObserver;
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness();
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    const actionId = harness.slot.dataset.tangoActionId;
    assert.equal(harness.nativeControl.isConnected, false);
    assert.ok(resizeCallbacks.length > 0, 'fixture must confirm resize observation exists but remains idle');

    const presentationObserver = mutationObservers.find((observer) =>
      observer.targets.some(({ target }) => target === harness.nativeControl));
    assert.ok(presentationObserver, 'the detached presentation source must remain attribute-observed');
    const observation = presentationObserver.targets.find(({ target }) => target === harness.nativeControl);
    assert.deepEqual(observation.options, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    const transientAlignment = 'hover:!items-start hover:!justify-start focus:!flex-col active:!self-start md:!place-items-start group-hover:!text-left hover:!pt-10 focus:!leading-[100px] hover:!text-[64px] group-hover:!gap-12 hover:!h-[36px] hover:!block pt-10! leading-[100px]! text-[64px]! gap-12! h-[36px]! block!';
    for (const { className, cssText, expectedClass, expectedPadding } of [
      {
        className: 'gmgn-small changed-while-detached', cssText: 'padding: 2px 4px; border-radius: 4px;',
        expectedClass: 'gmgn-small', expectedPadding: /padding:\s*2px 4px/
      },
      {
        className: 'gmgn-large changed-while-detached', cssText: 'padding: 4px 8px; border-radius: 6px;',
        expectedClass: 'gmgn-large', expectedPadding: /padding:\s*4px 8px/
      },
      {
        className: 'gmgn-xl changed-while-detached', cssText: 'padding: 7px 10px; border-radius: 9px;',
        expectedClass: 'gmgn-xl', expectedPadding: /padding:\s*7px 10px/
      },
      {
        className: 'gmgn-giant changed-while-detached', cssText: 'padding: 10px 14px; border-radius: 12px;',
        expectedClass: 'gmgn-giant', expectedPadding: /padding:\s*10px 14px/
      }
    ]) {
      harness.nativeControl.className = `${className} ${transientAlignment}`;
      harness.nativeControl.style.cssText = `${cssText} text-align: left !important;`;
      presentationObserver.callback([{
        type: 'attributes', target: harness.nativeControl, attributeName: 'class'
      }]);

      assert.equal(harness.replacement, replacement);
      assert.doesNotMatch(replacement.className, new RegExp(`(?:^|\\s)${expectedClass}(?:\\s|$)`));
      assert.match(replacement.className, /(?:^|\s)tango-list-quick-buy(?:\s|$)/);
      assert.doesNotMatch(
        replacement.className,
        /(?:^|\s)(?:hover:!items-start|hover:!justify-start|focus:!flex-col|active:!self-start|md:!place-items-start|group-hover:!text-left|hover:!pt-10|focus:!leading-\[100px\]|hover:!text-\[64px\]|group-hover:!gap-12|hover:!h-\[36px\]|hover:!block|pt-10!|leading-\[100px\]!|text-\[64px\]!|gap-12!|h-\[36px\]!|block!)(?:\s|$)/
      );
      assert.doesNotMatch(replacement.style.cssText, /padding\s*:/i);
      assert.doesNotMatch(replacement.style.cssText, /text-align\s*:/i);
      assert.equal(harness.slot.dataset.tangoActionId, actionId);
      assert.equal(harness.nativeControl.isConnected, false);
    }

    harness.nativeControl.className = '';
    harness.nativeControl.style.cssText = '';
    presentationObserver.callback([{
      type: 'attributes', target: harness.nativeControl, attributeName: 'class'
    }]);
    assert.doesNotMatch(replacement.className, /(?:^|\s)gmgn-giant(?:\s|$)/);
    assert.doesNotMatch(replacement.className, /(?:^|\s)tango-quick-buy-fallback(?:\s|$)/);
    assert.equal(replacement.style.cssText, 'border-radius: 12px;');
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.MutationObserver = original.MutationObserver;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('quick-buy preserves independent native presentation snapshots for separate trench columns', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  first.setNativePresentation('gmgn-small first-column', 'padding: 2px 4px;');
  second.setNativePresentation('gmgn-large second-column', 'padding: 8px 12px;');
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
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
    assert.doesNotMatch(first.replacement.className, /(?:^|\s)first-column(?:\s|$)/);
    assert.doesNotMatch(first.replacement.className, /(?:^|\s)second-column(?:\s|$)/);
    assert.doesNotMatch(first.replacement.style.cssText, /padding\s*:/i);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)second-column(?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)first-column(?:\s|$)/);
    assert.doesNotMatch(second.replacement.style.cssText, /padding\s*:/i);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('card-local loading presentation does not propagate classes or state styles to another card', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  second.setNativePresentation(
    'gmgn-small rounded-sm second-card-visual',
    'padding: 2px 4px; border-radius: 9px; color: rgb(1, 2, 3); background: rgb(4, 5, 6);'
  );
  first.column.contains = (node) => node === first.card || node === second.card;
  second.card.parentElement = first.column;
  const secondClosest = second.card.closest.bind(second.card);
  second.card.closest = (selector) => selector === '[data-sentry-component="TrenchColumn"]'
    ? first.column : secondClosest(selector);
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
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
    assert.doesNotMatch(first.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);

    first.setNativePresentation(
      'gmgn-small rounded-sm is-loading disabled',
      'display: none; width: 0; height: 0; padding: 0; opacity: 0.4; pointer-events: none;'
    );
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
    assert.doesNotMatch(first.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.doesNotMatch(first.replacement.className, /(?:^|\s)(?:is-loading|disabled)(?:\s|$)/);
    assert.doesNotMatch(
      first.replacement.style.cssText,
      /(?:display|(?:min-|max-)?(?:width|height)|opacity|pointer-events)\s*:/i
    );
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)gmgn-giant(?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)is-loading(?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)disabled(?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)second-card-visual(?:\s|$)/);
    assert.doesNotMatch(second.replacement.style.cssText, /padding\s*:/i);
    assert.match(second.replacement.style.cssText, /border-radius:\s*9px/);
    assert.match(second.replacement.style.cssText, /color:\s*rgb\(1, 2, 3\)/);
    assert.doesNotMatch(second.replacement.style.cssText, /background(?:-color|-image)?\s*:/i);
    assert.doesNotMatch(second.replacement.style.cssText, /display:\s*none|width:\s*0|height:\s*0|opacity|pointer-events/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)tango-quick-buy-fallback(?:\s|$)/);
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), false);
    assert.equal(first.nativeControl.realHandlerCalls, 0);
    assert.equal(second.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('shared GMGN size updates merge into a peer full presentation for all four sizes', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  second.setNativePresentation(
    `${LIVE_QUICK_BUY_SMALL} rounded-peer peer-gradient peer-border`,
    'padding: 3px 5px; border-radius: 11px; color: rgb(7, 8, 9); background: linear-gradient(red, blue);'
  );
  first.column.contains = (node) => node === first.card || node === second.card;
  second.card.parentElement = first.column;
  const secondClosest = second.card.closest.bind(second.card);
  second.card.closest = (selector) => selector === '[data-sentry-component="TrenchColumn"]'
    ? first.column : secondClosest(selector);
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
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
    for (const [size, className, height, text] of [
      ['large', LIVE_QUICK_BUY_LARGE, '28px', '13px'], ['extra-large', LIVE_QUICK_BUY_XL, '32px', '14px'],
      ['giant', LIVE_QUICK_BUY_GIANT, '36px', '16px'], ['small', LIVE_QUICK_BUY_SMALL, '24px', '12px']
    ]) {
      first.setNativePresentation(`${className} size-source`, 'padding: 99px;');
      assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
      assert.equal(second.replacement.dataset.tangoQuickBuySize, size);
      assert.equal(second.replacement.style.getPropertyValue('--tango-quick-buy-height'), height);
      assert.equal(second.replacement.style.getPropertyValue('--tango-quick-buy-text'), text);
      assert.doesNotMatch(second.replacement.className, /(?:^|\s)(?:rounded-peer|peer-gradient|peer-border)(?:\s|$)/, size);
      assert.doesNotMatch(second.replacement.style.cssText, /padding\s*:/i, size);
      assert.match(second.replacement.style.cssText, /border-radius:\s*11px/, size);
      assert.match(second.replacement.style.cssText, /color:\s*rgb\(7, 8, 9\)/, size);
      assert.doesNotMatch(second.replacement.style.cssText, /background(?:-color|-image)?\s*:/i, size);
    }
    assert.equal(first.nativeControl.realHandlerCalls, 0);
    assert.equal(second.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a leafless peer shares length font size and semantic transparent border tokens only', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  first.column.contains = (node) => node === first.card || node === second.card;
  second.card.parentElement = first.column;
  second.nativeControl.isConnected = false;
  first.setNativePresentation(
    'inline-flex !h-[24px] !text-[12px] text-[#ff0000] text-[color:rgb(1,2,3)] text-[var(--brand)] text-[url(foo)] border-transparent border-[transparent] border-[var(--transparent-border)] gmgn-small',
    ''
  );
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
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
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 1);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [second.slot]), 1);
    assert.equal(second.replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(second.replacement.style.getPropertyValue('--tango-quick-buy-text'), '12px');
    assert.match(second.replacement.className, /(?:^|\s)border-transparent(?:\s|$)/);
    assert.match(second.replacement.className, /(?:^|\s)border-\[transparent\](?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a native-leaf-free card inherits only stable live GMGN Tailwind quick-buy presentation through virtual reuse', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  first.column.contains = (node) => node === first.card || node === second.card;
  second.card.parentElement = first.column;
  second.nativeControl.isConnected = false;
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
          .filter((harness) => harness.classes.has('tango-native-buy-overridden'))
          .map((harness) => harness.slot);
      }
      if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') return [];
      return [];
    }
  };
  const presentations = [
    'inline-flex items-center justify-center !h-[24px] !px-[6px] !leading-[12px] !text-[12px] !rounded-[4px] !bg-transparent',
    'inline-flex items-center justify-center !h-[28px] !px-[8px] !leading-[14px] !text-[13px] !rounded-[6px] !bg-transparent',
    'inline-flex items-center justify-center !h-[32px] !px-[10px] !leading-[16px] !text-[14px] !rounded-[8px] !bg-transparent',
    'inline-flex items-center justify-center !h-[36px] !px-[12px] !leading-[18px] !text-[16px] !rounded-[10px] !bg-transparent'
  ];
  first.setNativePresentation(
    `${presentations[0]} is-loading disabled opacity-50 pointer-events-none animate-pulse bg-gradient-to-r shadow-lg text-white`,
    'background: rgb(4, 5, 6); opacity: 0.5; pointer-events: none;'
  );
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 1);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [second.slot]), 1);
    const firstFallback = second.replacement;
    assert.ok(firstFallback);
    assert.equal(firstFallback.type, 'button');
    assert.equal(firstFallback.dataset.tangoPaperAction, 'quick-buy');
    assert.equal(firstFallback.getAttribute('data-testid'), null);
    assert.equal(firstFallback.getAttribute('href'), null);
    assert.equal(firstFallback.getAttribute('target'), null);
    assert.equal(firstFallback.getAttribute('formaction'), null);
    assert.match(firstFallback.className, /(?:^|\s)tango-list-quick-buy(?:\s|$)/);
    assert.equal(firstFallback.dataset.tangoQuickBuySize, 'small');
    assert.equal(firstFallback.style.getPropertyValue('--tango-quick-buy-height'), '24px');
    assert.doesNotMatch(firstFallback.className, /(?:^|\s)(?:is-loading|disabled|opacity-50|pointer-events-none|animate-pulse)(?:\s|$)/);
    assert.equal(firstFallback.style.cssText, '');

    for (const [presentation, size, height] of [
      [presentations[1], 'large', '28px'], [presentations[2], 'extra-large', '32px'], [presentations[3], 'giant', '36px']
    ]) {
      first.setNativePresentation(`${presentation} is-loading disabled opacity-50 pointer-events-none animate-pulse bg-gradient-to-r shadow-lg`, 'background: rgb(4, 5, 6);');
      assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
      assert.equal(second.replacement.dataset.tangoQuickBuySize, size);
      assert.equal(second.replacement.style.getPropertyValue('--tango-quick-buy-height'), height);
      assert.doesNotMatch(second.replacement.className, /(?:^|\s)(?:is-loading|disabled|opacity-50|pointer-events-none|animate-pulse)(?:\s|$)/);
      assert.equal(second.replacement.style.cssText, '');
    }

    second.card.getAttribute = (name) => name === 'href'
      ? 'https://gmgn.ai/base/token/0x3333333333333333333333333333333333333333' : null;
    second.card.innerText = '0x3333333333333333333333333333333333333333\nNEXT Next Token\nMC\n$20K';
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [second.slot]), 1);
    assert.notEqual(second.replacement, firstFallback);
    assert.equal(second.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(second.replacement.style.getPropertyValue('--tango-quick-buy-height'), '36px');
    assert.doesNotMatch(second.replacement.className, /(?:is-loading|disabled|opacity|pointer-events|animate)/);
    assert.equal(second.replacement.style.cssText, '');
    assert.equal(first.nativeControl.realHandlerCalls, 0);
    assert.equal(second.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

function connectedActionHost(className, slot) {
  const properties = new Map();
  const style = {
    cssText: '',
    getPropertyValue: (name) => properties.get(name) || '',
    setProperty(name, value) { properties.set(name, String(value)); },
    removeProperty(name) { const value = properties.get(name) || ''; properties.delete(name); return value; }
  };
  return {
    className,
    style,
    isConnected: true,
    parentElement: slot,
    children: [],
    getAttribute(name) {
      if (name === 'class') return this.className;
      if (name === 'style') return this.style.cssText;
      return null;
    },
    closest: (selector) => selector === '.BuyButton-continer' ? slot : null,
    appendChild(node) {
      this.children.push(node);
      node.parentNode = this;
      node.parentElement = this;
      node.isConnected = true;
      return node;
    }
  };
}

test('connected canonical host seeds a replacement and rejects a reparented native source', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  harness.nativeControl.isConnected = false;
  const host = connectedActionHost(
    `group/btn ${LIVE_QUICK_BUY_GIANT} absolute pointer-events-none invisible`, harness.slot
  );
  const hostAttributes = new Map([
    ['id', 'live-host'], ['href', 'https://gmgn.ai/real-buy'], ['role', 'button'],
    ['data-testid', 'quickbuy'], ['onclick', 'realBuy()']
  ]);
  const originalHostAttribute = host.getAttribute.bind(host);
  host.getAttribute = (name) => hostAttributes.get(name) ?? originalHostAttribute(name);
  host.id = 'live-host';
  host.href = 'https://gmgn.ai/real-buy';
  host.role = 'button';
  host.onclick = () => { throw new Error('native host must remain inert'); };
  let visibleHostReads = 1;
  const originalQuerySelector = harness.slot.querySelector.bind(harness.slot);
  harness.slot.querySelector = (selector) => selector === '[class~="group/btn"]'
    ? (visibleHostReads-- > 0 ? host : null)
    : originalQuerySelector(selector);
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const binding = harness.slot.__tangoQuickBuyBinding;
    const replacement = binding.replacement;
    assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
    for (const name of ['id', 'href', 'role', 'data-testid', 'onclick']) {
      assert.equal(replacement.getAttribute(name), null, `${name} stays host-local`);
    }
    assert.equal(replacement.onclick, undefined);
    assert.doesNotMatch(replacement.className, /(?:absolute|pointer-events-none|invisible)/);

    const unchanged = {
      replacement, binding, actionId: binding.actionId, bindingNonce: binding.bindingNonce,
      generation: binding.generation, handler: harness.slot.__tangoQuickBuyHandler, state: binding.state
    };
    const foreignSlot = { isConnected: true };
    const foreignNative = {
      ...harness.nativeControl,
      isConnected: true,
      className: LIVE_QUICK_BUY_GIANT,
      closest: () => foreignSlot,
      parentElement: foreignSlot
    };
    binding.nativeControl = foreignNative;
    host.className = `group/btn ${LIVE_QUICK_BUY_SMALL}`;
    visibleHostReads = 10;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(harness.slot.__tangoQuickBuyBinding, unchanged.binding);
    assert.equal(binding.replacement, unchanged.replacement);
    assert.equal(binding.actionId, unchanged.actionId);
    assert.equal(binding.bindingNonce, unchanged.bindingNonce);
    assert.equal(binding.generation, unchanged.generation);
    assert.equal(harness.slot.__tangoQuickBuyHandler, unchanged.handler);
    assert.equal(binding.state, unchanged.state);
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

test('leafless card receives latest chain size without borrowing peer presentation', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const peer = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  const seed = quickBuyHarness({ chain: 'base', address: '0x3333333333333333333333333333333333333333' });
  const leafless = quickBuyHarness({ chain: 'base', address: '0x4444444444444444444444444444444444444444' });
  first.nativeControl.isConnected = false;
  leafless.nativeControl.isConnected = false;
  const host = connectedActionHost(`group/btn ${LIVE_QUICK_BUY_GIANT}`, first.slot);
  const firstQuerySelector = first.slot.querySelector.bind(first.slot);
  first.slot.querySelector = (selector) => selector === '[class~="group/btn"]' ? host : firstQuerySelector(selector);
  peer.setNativePresentation(
    LIVE_QUICK_BUY_SMALL,
    'border-radius: 11px; color: rgb(7, 8, 9); background: rgb(10, 11, 12);'
  );
  seed.setNativePresentation(
    'rounded-local bg-local text-local',
    'border-radius: 17px; color: rgb(13, 14, 15); background: rgb(16, 17, 18);'
  );
  leafless.card.parentElement = seed.column;
  const leaflessClosest = leafless.card.closest.bind(leafless.card);
  leafless.card.closest = (selector) => selector === '[data-sentry-component="TrenchColumn"]'
    ? seed.column : leaflessClosest(selector);
  let visibleSlots = [first.slot];
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return visibleSlots;
      if (selector === '.tango-native-buy-overridden') return visibleSlots.filter((slot) =>
        slot.dataset.tangoQuickBuy === '1'
      );
      if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') {
        return visibleSlots.filter((slot) => slot.dataset.tangoQuickBuy !== '1');
      }
      return [];
    }
  };
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 1);
    visibleSlots = [first.slot, peer.slot];
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [peer.slot]), 1);
    host.className = `group/btn ${LIVE_QUICK_BUY_XL}`;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
    assert.equal(peer.replacement.dataset.tangoQuickBuySize, 'extra-large');
    assert.match(peer.replacement.style.cssText, /border-radius:\s*11px/);
    assert.match(peer.replacement.style.cssText, /color:\s*rgb\(7, 8, 9\)/);
    assert.doesNotMatch(peer.replacement.style.cssText, /background(?:-color|-image)?\s*:/i);

    visibleSlots = [first.slot, peer.slot, seed.slot];
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [seed.slot]), 1);
    visibleSlots = [first.slot, peer.slot, seed.slot, leafless.slot];
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [leafless.slot]), 1);
    assert.equal(leafless.replacement.dataset.tangoQuickBuySize, 'extra-large');
    assert.equal(leafless.replacement.style.getPropertyValue('--tango-quick-buy-height'), '32px');
    assert.equal(leafless.replacement.style.cssText, '');
    assert.doesNotMatch(leafless.replacement.style.cssText,
      /17px|rgb\(13, 14, 15\)|rgb\(16, 17, 18\)|rgb\(7, 8, 9\)|rgb\(10, 11, 12\)/);
    assert.equal(first.nativeControl.realHandlerCalls, 0);
    assert.equal(peer.nativeControl.realHandlerCalls, 0);
    assert.equal(seed.nativeControl.realHandlerCalls, 0);
    assert.equal(leafless.nativeControl.realHandlerCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('connected GMGN action host drives all four sizes after the native leaf detaches', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    MutationObserver: global.MutationObserver, ResizeObserver: global.ResizeObserver,
    gmgn: global.Tango.GMGN
  };
  const mutationObservers = [];
  const resizeObservers = [];
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; mutationObservers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  }
  class FakeResizeObserver {
    constructor() { resizeObservers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { this.disconnected = true; }
  }
  global.MutationObserver = FakeMutationObserver;
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  let paperBuyCalls = 0;
  const onPaperBuy = () => { paperBuyCalls += 1; };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const slotProperties = new Map();
  harness.slot.style = {
    getPropertyValue: (name) => slotProperties.get(name) || '',
    setProperty(name, value) { slotProperties.set(name, String(value)); },
    removeProperty(name) { const value = slotProperties.get(name) || ''; slotProperties.delete(name); return value; }
  };
  let actionHost = connectedActionHost(LIVE_QUICK_BUY_GIANT, harness.slot);
  const originalQuerySelector = harness.slot.querySelector.bind(harness.slot);
  harness.slot.querySelector = (selector) => selector === '[class~="group/btn"]'
    ? actionHost : originalQuerySelector(selector);
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(onPaperBuy), 1);
    harness.nativeControl.isConnected = false;
    const binding = harness.slot.__tangoQuickBuyBinding;
    const profileObserver = mutationObservers.find((observer) => observer.targets.includes(actionHost));
    assert.ok(profileObserver);
    const unchanged = {
      replacement: binding.replacement,
      binding,
      actionId: binding.actionId,
      bindingNonce: binding.bindingNonce,
      generation: binding.generation,
      handler: harness.slot.__tangoQuickBuyHandler,
      state: binding.state
    };

    for (const [className, id, height, text] of [
      [LIVE_QUICK_BUY_SMALL, 'small', '24px', '12px'],
      [LIVE_QUICK_BUY_LARGE, 'large', '28px', '13px'],
      [LIVE_QUICK_BUY_XL, 'extra-large', '32px', '14px'],
      [LIVE_QUICK_BUY_GIANT, 'giant', '36px', '16px']
    ]) {
      actionHost.className = `group/btn ${className}`;
      profileObserver.callback([{ type: 'attributes', target: actionHost, attributeName: 'class' }]);
      assert.equal(binding.replacement.dataset.tangoQuickBuySize, id);
      assert.equal(binding.replacement.style.getPropertyValue('--tango-quick-buy-height'), height);
      assert.equal(binding.replacement.style.getPropertyValue('--tango-quick-buy-text'), text);
      assert.equal(harness.slot.style.getPropertyValue('--tango-quick-buy-height'), height);
      assert.equal(harness.slot.__tangoQuickBuyBinding, unchanged.binding);
      assert.equal(binding.replacement, unchanged.replacement);
      assert.equal(binding.actionId, unchanged.actionId);
      assert.equal(binding.bindingNonce, unchanged.bindingNonce);
      assert.equal(binding.generation, unchanged.generation);
      assert.equal(harness.slot.__tangoQuickBuyHandler, unchanged.handler);
      assert.equal(binding.state, unchanged.state);
    }
    const liveNative = {
      ...harness.nativeControl,
      isConnected: true,
      connectedElsewhere: false,
      className: LIVE_QUICK_BUY_SMALL,
      style: { cssText: '' },
      textContent: '0.1 ETH'
    };
    harness.setLiveNativeControl(liveNative);
    actionHost.className = `group/btn ${LIVE_QUICK_BUY_XL}`;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(liveNative.isConnected, false, 'the coherent leaf is detached after safe replacement');
    profileObserver.callback([{ type: 'attributes', target: actionHost, attributeName: 'class' }]);
    assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'extra-large');

    const lastVerifiedSize = binding.quickBuyProfile.id;
    for (const hostile of ['!h-[35px]', '!text-[15px]', '!h-[100px] !text-[64px]']) {
      actionHost.className = `group/btn ${hostile}`;
      profileObserver.callback([{ type: 'attributes', target: actionHost, attributeName: 'class' }]);
      assert.equal(binding.quickBuyProfile.id, lastVerifiedSize);
      assert.doesNotMatch(binding.replacement.className, /35px|15px|100px|64px/);
    }

    actionHost.className = `group/btn ${LIVE_QUICK_BUY_GIANT}`;
    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true, 'connected canonical host profile drift is healthy');
    const oldHost = actionHost;
    actionHost = connectedActionHost(LIVE_QUICK_BUY_SMALL, harness.slot);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    const replacementHostObserver = mutationObservers.find((observer) => observer !== profileObserver
      && observer.targets.includes(actionHost));
    assert.ok(replacementHostObserver);
    oldHost.className = `group/btn ${LIVE_QUICK_BUY_GIANT}`;
    profileObserver.callback([{ type: 'attributes', target: oldHost, attributeName: 'class' }]);
    assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
    freshGmgn.clearQuickBuy(false);
    assert.equal(replacementHostObserver.disconnected, true);
    assert.equal(resizeObservers.some((observer) => observer.disconnected), true);
    assert.equal(harness.slot.style.getPropertyValue('--tango-quick-buy-height'), '');
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
    assert.equal(paperBuyCalls, 0);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.MutationObserver = original.MutationObserver;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('detached source resize retains its column presentation after another card changes', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver, gmgn: global.Tango.GMGN
  };
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      resizeObservers.push(this);
    }
    observe(target) { this.targets.push(target); }
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
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
    const secondResizeObserver = resizeObservers.find((observer) =>
      observer.targets.includes(second.slot));
    assert.ok(secondResizeObserver);

    first.setNativePresentation('gmgn-giant rounded-xl', 'padding: 10px 14px; border-radius: 12px;');
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);

    secondResizeObserver.callback([{ target: second.slot }]);

    assert.doesNotMatch(second.replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.doesNotMatch(second.replacement.className, /(?:^|\s)gmgn-giant(?:\s|$)/);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a stale peer resize retains a propagated profile until an explicit native update promotes one', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver, gmgn: global.Tango.GMGN
  };
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      resizeObservers.push(this);
    }
    observe(target) { this.targets.push(target); }
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  second.setNativePresentation(LIVE_QUICK_BUY_SMALL, 'border-radius: 11px;');
  first.column.contains = (node) => node === first.card || node === second.card;
  second.card.parentElement = first.column;
  const secondClosest = second.card.closest.bind(second.card);
  second.card.closest = (selector) => selector === '[data-sentry-component="TrenchColumn"]'
    ? first.column : secondClosest(selector);
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
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
    const secondResizeObserver = resizeObservers.find((observer) =>
      observer.targets.includes(second.slot));
    assert.ok(secondResizeObserver);

    first.setNativePresentation(LIVE_QUICK_BUY_GIANT, 'border-radius: 12px;');
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
    assert.equal(second.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(second.replacement.style.getPropertyValue('--tango-quick-buy-height'), '36px');

    const giantRevision = second.slot.__tangoQuickBuyBinding.presentationRevision;
    secondResizeObserver.callback([{ target: second.slot }]);
    assert.equal(second.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(second.slot.__tangoQuickBuyBinding.presentationRevision, giantRevision);

    second.setNativePresentation(LIVE_QUICK_BUY_XL, 'border-radius: 13px;');
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [second.slot]), 0);
    assert.equal(first.replacement.dataset.tangoQuickBuySize, 'extra-large');
    assert.equal(second.replacement.dataset.tangoQuickBuySize, 'extra-large');
    const extraLargeRevision = second.slot.__tangoQuickBuyBinding.presentationRevision;

    second.setNativePresentation(LIVE_QUICK_BUY_XL, 'border-radius: 13px;');
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [second.slot]), 0);
    assert.equal(second.slot.__tangoQuickBuyBinding.presentationRevision, extraLargeRevision);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('same quick-buy profile revision fans out across same-chain peers only once', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    MutationObserver: global.MutationObserver, ResizeObserver: global.ResizeObserver,
    gmgn: global.Tango.GMGN
  };
  const mutationObservers = [];
  const resizeObservers = [];
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; mutationObservers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  }
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = []; resizeObservers.push(this); }
    observe(target) { this.targets.push(target); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
  }
  global.MutationObserver = FakeMutationObserver;
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harnesses = [
    quickBuyHarness({ chain: 'base', address: EVM_ADDRESS }),
    quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 }),
    quickBuyHarness({ chain: 'base', address: '0x3333333333333333333333333333333333333333' }),
    quickBuyHarness({ chain: 'base', address: '0x4444444444444444444444444444444444444444' }),
    quickBuyHarness({ chain: 'base', address: '0x5555555555555555555555555555555555555555' }),
    quickBuyHarness({ chain: 'base', address: '0x6666666666666666666666666666666666666666' })
  ];
  const [first, second, peer, disconnected, invalid, otherChain] = harnesses;
  const firstHost = connectedActionHost(`group/btn ${LIVE_QUICK_BUY_SMALL}`, first.slot);
  const secondHost = connectedActionHost(`group/btn ${LIVE_QUICK_BUY_SMALL}`, second.slot);
  for (const [harness, host] of [[first, firstHost], [second, secondHost]]) {
    harness.nativeControl.isConnected = false;
    const querySelector = harness.slot.querySelector.bind(harness.slot);
    harness.slot.querySelector = (selector) => selector === '[class~="group/btn"]'
      ? host : querySelector(selector);
  }
  for (const harness of [peer, disconnected, invalid, otherChain]) {
    harness.nativeControl.isConnected = false;
  }
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return harnesses.map((harness) => harness.slot);
      if (selector === '.tango-native-buy-overridden') {
        return harnesses.filter((harness) => harness.classes.has('tango-native-buy-overridden'))
          .map((harness) => harness.slot);
      }
      if (selector === '.BuyButton-continer:not([data-tango-quick-buy="1"])') return [];
      return [];
    }
  };
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  let peerBinding = null;
  let peerChain = '';
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), harnesses.length);
    const identities = harnesses.map((harness) => {
      const binding = harness.slot.__tangoQuickBuyBinding;
      return {
        binding, replacement: binding.replacement, actionId: binding.actionId,
        bindingNonce: binding.bindingNonce, generation: binding.generation,
        handler: harness.slot.__tangoQuickBuyHandler, state: binding.state
      };
    });
    peerBinding = identities[2].binding;
    peerChain = peerBinding.chain;
    let peerFanOutScans = 0;
    Object.defineProperty(peerBinding, 'chain', {
      configurable: true,
      get() { peerFanOutScans += 1; return peerChain; },
      set(value) { peerChain = String(value); }
    });
    disconnected.slot.isConnected = false;
    invalid.replacement.isConnected = false;
    identities[5].binding.chain = 'sol';
    const firstProfileObserver = mutationObservers.find((observer) => observer.targets.includes(firstHost));
    const secondProfileObserver = mutationObservers.find((observer) => observer.targets.includes(secondHost));
    const firstResizeObserver = resizeObservers.find((observer) => observer.targets.includes(first.slot));
    const secondResizeObserver = resizeObservers.find((observer) => observer.targets.includes(second.slot));
    assert.ok(firstProfileObserver && secondProfileObserver);
    assert.ok(firstResizeObserver && secondResizeObserver);

    firstHost.className = `group/btn ${LIVE_QUICK_BUY_GIANT}`;
    secondHost.className = `group/btn ${LIVE_QUICK_BUY_GIANT}`;
    firstProfileObserver.callback([{ type: 'attributes', target: firstHost, attributeName: 'class' }]);
    assert.equal(peer.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(peerFanOutScans, 1, 'the first giant revision scans the sentinel peer once');

    for (let index = 0; index < 3; index += 1) {
      firstProfileObserver.callback([{ type: 'attributes', target: firstHost, attributeName: 'class' }]);
      secondProfileObserver.callback([{ type: 'attributes', target: secondHost, attributeName: 'class' }]);
      firstResizeObserver.callback([{ target: first.slot }]);
      secondResizeObserver.callback([{ target: second.slot }]);
    }
    assert.equal(peerFanOutScans, 1,
      'same-revision mutation and resize deliveries must not rescan the sentinel peer');

    firstHost.className = `group/btn ${LIVE_QUICK_BUY_XL}`;
    secondHost.className = `group/btn ${LIVE_QUICK_BUY_XL}`;
    secondProfileObserver.callback([{ type: 'attributes', target: secondHost, attributeName: 'class' }]);
    assert.equal(peer.replacement.dataset.tangoQuickBuySize, 'extra-large');
    assert.equal(peerFanOutScans, 2, 'the later extra-large revision scans the sentinel peer once more');
    firstProfileObserver.callback([{ type: 'attributes', target: firstHost, attributeName: 'class' }]);
    secondResizeObserver.callback([{ target: second.slot }]);
    assert.equal(peerFanOutScans, 2, 'the second revision is also gated after its first fan-out');

    assert.equal(disconnected.replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(invalid.replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(otherChain.replacement.dataset.tangoQuickBuySize, 'small');
    harnesses.forEach((harness, index) => {
      const unchanged = identities[index];
      assert.equal(harness.slot.__tangoQuickBuyBinding, unchanged.binding);
      assert.equal(unchanged.binding.replacement, unchanged.replacement);
      assert.equal(unchanged.binding.actionId, unchanged.actionId);
      assert.equal(unchanged.binding.bindingNonce, unchanged.bindingNonce);
      assert.equal(unchanged.binding.generation, unchanged.generation);
      assert.equal(harness.slot.__tangoQuickBuyHandler, unchanged.handler);
      assert.equal(unchanged.binding.state, unchanged.state);
      assert.equal(harness.nativeControl.realHandlerCalls, 0);
    });
  } finally {
    if (peerBinding) {
      Object.defineProperty(peerBinding, 'chain', {
        configurable: true, writable: true, value: peerChain
      });
    }
    disconnected.slot.isConnected = true;
    invalid.replacement.isConnected = true;
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.MutationObserver = original.MutationObserver;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('an unchanged authoritative presentation does not fan out across every bound card', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const first = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const second = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS_2 });
  const document = {
    ...first.document,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [first.slot, second.slot];
      if (selector === '.tango-native-buy-overridden') {
        return [first, second]
          .filter((harness) => harness.classes.has('tango-native-buy-overridden'))
          .map((harness) => harness.slot);
      }
      return [];
    }
  };
  let secondBinding = null;
  let secondRevision = 0;
  global.document = document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 2);
    secondBinding = second.slot.__tangoQuickBuyBinding;
    secondRevision = secondBinding.presentationRevision;
    let crossBindingRevisionReads = 0;
    Object.defineProperty(secondBinding, 'presentationRevision', {
      configurable: true,
      get() {
        crossBindingRevisionReads += 1;
        return secondRevision;
      },
      set(value) { secondRevision = Number(value); }
    });

    first.setNativePresentation('gmgn-small rounded-sm', 'padding: 2px 4px; border-radius: 4px;');
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);

    assert.equal(crossBindingRevisionReads, 0);
  } finally {
    if (secondBinding) {
      Object.defineProperty(secondBinding, 'presentationRevision', {
        configurable: true, writable: true, value: secondRevision
      });
    }
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('same-binding reconciliation repairs paper shell class and style drift', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    gmgn: global.Tango.GMGN
  };
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness();
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    const replacement = harness.replacement;
    replacement.className = 'react-drift tango-list-quick-buy';
    replacement.style.cssText = 'color: rgb(99, 0, 0);';

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, replacement);
    assert.doesNotMatch(replacement.className, /(?:^|\s)gmgn-small(?:\s|$)/);
    assert.match(replacement.className, /(?:^|\s)rounded-sm(?:\s|$)/);
    assert.doesNotMatch(replacement.className, /(?:^|\s)react-drift(?:\s|$)/);
    assert.equal(replacement.style.cssText, 'border-radius: 4px;');
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.Tango.GMGN = original.gmgn;
  }
});

test('quick-buy resize observation covers the live slot, paper shell, and immediate geometry wrapper', () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver, gmgn: global.Tango.GMGN
  };
  const observed = [];
  class FakeResizeObserver {
    constructor() {}
    observe(target) { observed.push(target); }
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = FakeResizeObserver;
  delete require.cache[modulePath];
  const freshGmgn = require(modulePath);
  const harness = quickBuyHarness();
  const geometryWrapper = { isConnected: true };
  harness.slot.parentElement = geometryWrapper;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=sol', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(freshGmgn.discoverTokenCards(() => {}), 1);
    assert.equal(observed.includes(harness.slot), true);
    assert.equal(observed.includes(harness.replacement), true);
    assert.equal(observed.includes(geometryWrapper), true);
  } finally {
    freshGmgn.clearQuickBuy();
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.ResizeObserver = original.ResizeObserver;
    global.Tango.GMGN = original.gmgn;
  }
});

test('a coherent new card without a native leaf still receives an inert fallback paper shell', () => {
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
    assert.equal(harness.paperControlCount, 1);
    assert.match(harness.replacement.className, /(?:^|\s)tango-list-quick-buy(?:\s|$)/);
    assert.match(harness.replacement.className, /(?:^|\s)tango-quick-buy-fallback(?:\s|$)/);
    assert.equal(harness.replacement.dataset.tangoPaperAction, 'quick-buy');
    assert.equal(harness.replacement.type, 'button');
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

    actionHostReady = true;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.slot.__tangoQuickBuyBinding?.replacement, replacement);
    assert.equal(harness.slot.dataset.tangoActionId, actionId);
    assert.equal(replacement.parentNode, actionHost);
    assert.equal(actionHostAppendCalls, 1);

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

    harness.card.innerText = coherentText;
    actionHostReady = true;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.slot.__tangoQuickBuyBinding?.replacement, replacement);
    assert.equal(replacement.dataset.tangoPaperState, 'ready');
    assert.equal(replacement.parentNode, actionHost);
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

test('an active card reused for an incomplete token cannot publish its staged native presentation', () => {
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
    assert.match(reused.replacement.className, /(?:^|\s)tango-quick-buy-fallback(?:\s|$)/);
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

test('a new token without a native leaf inherits the last trusted GMGN presentation', () => {
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
    assert.equal(harness.replacement.style.getPropertyValue('--tango-quick-buy-height'), '36px');

    harness.card.getAttribute = (name) =>
      name === 'href' ? `https://gmgn.ai/base/token/${EVM_ADDRESS_2}` : null;
    harness.card.innerText = `${EVM_ADDRESS_2}\nNEXT Next Token\nMC\n$20K`;
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 1);

    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.replacement.style.getPropertyValue('--tango-quick-buy-height'), '36px');
    assert.match(harness.replacement.className, /(?:^|\s)tango-quick-buy-fallback(?:\s|$)/);
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

test('fallback paper shell class drift is detected and repaired without a native leaf', () => {
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
    replacement.className = 'tango-list-quick-buy';

    assert.equal(freshGmgn.quickBuyNeedsReconcile(), true);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
    assert.equal(harness.replacement, replacement);
    assert.match(replacement.className, /(?:^|\s)tango-quick-buy-fallback(?:\s|$)/);
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
    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(harness.replacement.style.getPropertyValue('--tango-quick-buy-height'), '24px');
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
  let messageListener;
  const revocations = [];
  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'message') messageListener = listener; }
  };
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    window: global.window, gmgn: global.Tango.GMGN,
    nativeGuard: global.Tango.NativeQuickBuyGuard
  };
  global.window = fakeWindow;
  global.Tango.NativeQuickBuyGuard = {
    registerPaperAction: () => true,
    isPaperActionTrusted: () => true,
    revokePaperAction(element) { revocations.push(element); return true; }
  };
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
    assert.equal(revocations.includes(replacement), false);
    assert.equal(harness.nativeControl.isConnected, false);
    assert.equal(harness.nativeControl.restored, 0);

    messageListener({
      source: fakeWindow,
      data: { source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK', actionId }
    });
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
    await harness.slot.__tangoQuickBuyHandler();
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
    global.window = original.window;
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
    guard.trusted = false;
    assert.equal(GMGN.quickBuyNeedsReconcile(), true);
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER');
    assert.equal(guard.trusted, true);
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

test('ready promotion reinstalls resize observation without inheriting a stale repair timer', () => {
  const original = {
    ResizeObserver: global.ResizeObserver,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout
  };
  const observers = [];
  const clearedTimers = new Set();
  let timerSequence = 0;
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) { this.targets.push(target); }
    unobserve(target) { this.targets = this.targets.filter((candidate) => candidate !== target); }
    disconnect() { this.disconnected = true; }
  }
  global.ResizeObserver = FakeResizeObserver;
  global.setTimeout = () => ({ id: ++timerSequence });
  global.clearTimeout = (handle) => { clearedTimers.add(handle); };
  const harness = quickBuyHarness({ chain: 'base', address: '' });
  try {
    withQuickBuyGlobals(harness, {}, () => {
      GMGN.discoverTokenCards(() => {}, 1, 'PAPER');
      const predecessor = harness.slot.__tangoQuickBuyBinding;
      const predecessorObserver = predecessor.resizeObserver;
      assert.deepEqual(predecessorObserver.targets, [harness.slot, harness.replacement]);

      harness.replacement.isConnected = false;
      predecessorObserver.callback([{ target: harness.slot }]);
      harness.replacement.isConnected = true;
      const staleTimer = predecessor.repairTimer;
      assert.ok(staleTimer);

      harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
      GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [harness.card]);
      const successor = harness.slot.__tangoQuickBuyBinding;

      assert.notEqual(successor, predecessor);
      assert.equal(predecessorObserver.disconnected, true);
      assert.equal(clearedTimers.has(staleTimer), true);
      assert.equal(successor.repairTimer, null);
      assert.notEqual(successor.resizeObserver, predecessorObserver);
      assert.equal(successor.resizeObserver.disconnected, false);
      assert.deepEqual(successor.resizeObserver.targets, [harness.slot, harness.replacement]);
    });
  } finally {
    Object.assign(global, original);
  }
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
    assert.deepEqual(observed, [first.slot, firstReplacement]);
    assert.deepEqual(unobserved, [first.slot, firstReplacement]);
    assert.equal(first.slot.__tangoQuickBuyHandler, undefined);
    assert.equal(first.slot.dataset.tangoActionId, undefined);
    assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [first.slot]), 0);
    assert.deepEqual(unobserved, [first.slot, firstReplacement]);

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
    window: global.window, gmgn: global.Tango.GMGN
  };
  let messageListener;
  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'message') messageListener = listener; }
  };
  global.window = fakeWindow;
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
    assert.equal(replacement.dataset.tangoQuickBuySize, 'small');
    assert.equal(replacement.style.getPropertyValue('--tango-quick-buy-height'), '24px');
    assert.match(replacement.className, /(?:^|\s)tango-quick-buy-fallback(?:\s|$)/);
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

    assert.equal(typeof messageListener, 'function');
    messageListener({
      source: fakeWindow,
      data: {
        source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK',
        actionId: oldActionId, bindingNonce: oldBindingNonce
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(orders.length, 0);

    messageListener({
      source: fakeWindow,
      data: {
        source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK',
        actionId: harness.slot.dataset.tangoActionId,
        bindingNonce: harness.slot.dataset.tangoBindingNonce
      }
    });
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
    global.window = original.window;
    global.Tango.GMGN = original.gmgn;
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

test('pointer and click bridge messages dispatch one paper action and never the native handler', async () => {
  const modulePath = require.resolve('../src/adapters/gmgn.js');
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    window: global.window, gmgn: global.Tango.GMGN
  };
  let messageListener;
  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'message') messageListener = listener; }
  };
  global.window = fakeWindow;
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
    const event = {
      source: fakeWindow,
      data: {
        source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK',
        actionId: harness.slot.dataset.tangoActionId,
        bindingNonce: harness.slot.dataset.tangoBindingNonce
      }
    };
    messageListener(event);
    messageListener(event);
    assert.equal(paperCalls, 1);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
    gate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    delete require.cache[modulePath];
    global.document = original.document;
    global.location = original.location;
    global.requestAnimationFrame = original.raf;
    global.window = original.window;
    global.Tango.GMGN = original.gmgn;
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
