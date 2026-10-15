const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REQUIRED_ISOLATED_ORDER = [
  'src/core/chains.js',
  'src/core/supply.js',
  'src/shared/constants.js',
  'src/core/state.js',
  'src/shared/i18n.js',
  'src/shared/format.js',
  'src/core/engine.js',
  'src/core/state-coordinator.js',
  'src/core/storage.js',
  'src/adapters/gmgn-quotes.js',
  'src/adapters/gmgn.js',
  'src/content/chain-view.js',
  'src/content/markers.js',
  'src/content/content.js'
];
const REQUIRED_MAIN_ORDER = [
  'src/core/chains.js',
  'src/core/supply.js',
  'src/adapters/gmgn-quotes.js',
  'src/content/page-main.js'
];
const REQUIRED_NATIVE_GUARD_ORDER = [
  'src/shared/constants.js',
  'src/content/native-quick-buy-guard.js'
];
const REQUIRED_PAGE_ORDER = REQUIRED_ISOLATED_ORDER.slice(0, 9);
const REQUIRED_POPUP_ORDER = [...REQUIRED_PAGE_ORDER, 'src/content/chain-view.js', 'src/popup/model.js', 'src/popup/popup.js'];
const REQUIRED_DASHBOARD_ORDER = [...REQUIRED_PAGE_ORDER, 'src/content/chain-view.js', 'src/dashboard/model.js', 'src/dashboard/dashboard.js'];
const REQUIRED_WORKER_IMPORT_ORDER = [
  'core/chains.js',
  'core/supply.js',
  'shared/constants.js',
  'core/state.js',
  'core/engine.js',
  'core/state-coordinator.js'
];
const PAPER_ONLY_SAFETY_RULES = [
  ['wallet RPC transport', /(?:\b(?:window|globalThis)\s*(?:\.\s*(?:ethereum|provider|wallet)\b|\[\s*['"](?:ethereum|provider|wallet)['"]\s*\])|\b(?:ethereum|provider|wallet)\b)\s*(?:(?:\.|\?\.)\s*(?:request|send|sendAsync)\b|(?:\?\.\s*)?\[\s*['"](?:request|send|sendAsync)['"]\s*\])/],
  ['wallet signing or transaction RPC', /\b(?:personal_sign|eth_sign(?:TypedData(?:_[A-Za-z0-9]+)?)?|eth_send(?:Raw)?Transaction|wallet_requestPermissions|wallet_switchEthereumChain|wallet_addEthereumChain)\b/],
  ['wallet transaction helper', /\b(?:connectWallet|requestSignature|signTransaction|sendTransaction|broadcastTransaction)\b/],
  ['token approval', /\b(?:approve|approveToken|approveTransaction)\b/],
  ['strategy order', /\bstrategy_order\b/],
  ['swap route', /\bswap\s*\/\s*route\b/],
  ['WebSocket transport', /\bnew\s+WebSocket\s*\(/]
];

function versionConsistencyErrors({ packageVersion, manifestVersion, constantsSource }) {
  const constantsVersion = String(constantsSource || '').match(/Tango\.VERSION\s*=\s*['\"]([^'\"]+)['\"]/)?.[1] || '';
  const versions = [packageVersion, manifestVersion, constantsVersion];
  return versions.every((version) => version && version === versions[0])
    ? []
    : [`Version mismatch: package=${packageVersion || 'missing'}, manifest=${manifestVersion || 'missing'}, constants=${constantsVersion || 'missing'}`];
}

function contentScriptOrderErrors(contentScripts) {
  const script = (contentScripts || []).find((entry) => entry.js?.includes('src/content/content.js'));
  if (!script) return ['Missing isolated content script entry for src/content/content.js'];
  const missing = REQUIRED_ISOLATED_ORDER.filter((file) => !script.js.includes(file));
  if (missing.length) return [`Missing isolated content script dependencies: ${missing.join(', ')}`];
  const indexes = REQUIRED_ISOLATED_ORDER.map((file) => script.js.indexOf(file));
  const ordered = indexes.every((index, position) => position === 0 || indexes[position - 1] < index);
  return ordered ? [] : [`Invalid isolated content script dependency order: ${REQUIRED_ISOLATED_ORDER.join(' -> ')}`];
}

function mainWorldScriptOrderErrors(contentScripts) {
  const script = (contentScripts || []).find((entry) => entry.world === 'MAIN' && entry.js?.includes('src/content/page-main.js'));
  if (!script) return ['Missing MAIN-world content script entry for src/content/page-main.js'];
  const missing = REQUIRED_MAIN_ORDER.filter((file) => !script.js.includes(file));
  if (missing.length) return [`Missing MAIN-world script dependencies: ${missing.join(', ')}`];
  const exact = script.js.length === REQUIRED_MAIN_ORDER.length
    && REQUIRED_MAIN_ORDER.every((file, index) => script.js[index] === file);
  return exact ? [] : [`Invalid MAIN-world script order: ${REQUIRED_MAIN_ORDER.join(' -> ')}`];
}

function htmlScriptOrderErrors(html, file) {
  const scripts = [...String(html || '').matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map((match) => match[1]);
  const missing = REQUIRED_PAGE_ORDER.filter((script) => !scripts.includes(script));
  if (missing.length) return [`Missing ${file} script dependencies: ${missing.join(', ')}`];
  const indexes = REQUIRED_PAGE_ORDER.map((script) => scripts.indexOf(script));
  const ordered = indexes.every((index, position) => position === 0 || indexes[position - 1] < index);
  return ordered ? [] : [`Invalid ${file} script dependency order: ${REQUIRED_PAGE_ORDER.join(' -> ')}`];
}

function popupScriptOrderErrors(html) {
  const scripts = [...String(html || '').matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map((match) => match[1]);
  const missing = REQUIRED_POPUP_ORDER.filter((script) => !scripts.includes(script));
  if (missing.length) return [`Missing popup script dependencies: ${missing.join(', ')}`];
  const indexes = REQUIRED_POPUP_ORDER.map((script) => scripts.indexOf(script));
  const ordered = indexes.every((index, position) => position === 0 || indexes[position - 1] < index);
  return ordered ? [] : [`Invalid popup script dependency order: ${REQUIRED_POPUP_ORDER.join(' -> ')}`];
}

function dashboardScriptOrderErrors(html) {
  const scripts = [...String(html || '').matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map((match) => match[1]);
  const missing = REQUIRED_DASHBOARD_ORDER.filter((script) => !scripts.includes(script));
  if (missing.length) return [`Missing dashboard script dependencies: ${missing.join(', ')}`];
  const indexes = REQUIRED_DASHBOARD_ORDER.map((script) => scripts.indexOf(script));
  const ordered = indexes.every((index, position) => position === 0 || indexes[position - 1] < index);
  return ordered ? [] : [`Invalid dashboard script dependency order: ${REQUIRED_DASHBOARD_ORDER.join(' -> ')}`];
}

function workerImportErrors(workerFile, source) {
  const match = String(source || '').match(/importScripts\s*\(([\s\S]*?)\)\s*;/);
  const imports = match
    ? [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1])
    : [];
  const exact = imports.length === REQUIRED_WORKER_IMPORT_ORDER.length
    && REQUIRED_WORKER_IMPORT_ORDER.every((file, index) => imports[index] === file);
  return exact ? [] : [
    `Invalid ${workerFile || 'service worker'} worker-relative import sequence: ${REQUIRED_WORKER_IMPORT_ORDER.join(' -> ')}`
  ];
}

function javascriptSyntaxErrors(sources) {
  const errors = [];
  for (const { file, source } of sources) {
    try { new vm.Script(source, { filename: file }); }
    catch (error) { errors.push(`Invalid JavaScript ${file}: ${error.message}`); }
  }
  return errors;
}

function paperOnlySafetyErrors(sources) {
  const errors = [];
  for (const { file, source } of sources || []) {
    for (const [name, pattern] of PAPER_ONLY_SAFETY_RULES) {
      if (pattern.test(String(source || ''))) errors.push(`Paper-only violation in ${file}: ${name}`);
    }
  }
  return errors;
}

function nativeQuickBuyGuardErrors(contentScripts) {
  const scripts = contentScripts || [];
  const guardIndex = scripts.findIndex((entry) =>
    entry.js?.includes('src/content/native-quick-buy-guard.js')
  );
  if (guardIndex < 0) return ['Missing isolated native quick-buy guard'];
  const guard = scripts[guardIndex];
  if (guard.world != null && guard.world !== 'ISOLATED') {
    return ['Native quick-buy guard must run in an isolated world'];
  }
  if (guard.run_at !== 'document_start') return ['Native quick-buy guard must run at document_start'];
  if (guard.matches?.length !== 1 || guard.matches[0] !== 'https://gmgn.ai/*') {
    return ['Native quick-buy guard must match only https://gmgn.ai/*'];
  }
  const exactOrder = guard.js?.length === REQUIRED_NATIVE_GUARD_ORDER.length
    && REQUIRED_NATIVE_GUARD_ORDER.every((file, index) => guard.js[index] === file);
  if (!exactOrder) {
    return [`Invalid native quick-buy guard script order: ${REQUIRED_NATIVE_GUARD_ORDER.join(' -> ')}`];
  }
  const mainIndex = scripts.findIndex((entry) =>
    entry.world === 'MAIN' && entry.js?.includes('src/content/page-main.js')
  );
  if (mainIndex >= 0 && guardIndex > mainIndex) {
    return ['Native quick-buy guard must be declared before MAIN-world quick-buy handling'];
  }
  return [];
}

function releaseContractErrors({ manifest, constantsSource, backgroundSource, adapterSource } = {}) {
  const errors = [];
  if (manifest?.commands?.['toggle-paper-trading-master']?.suggested_key?.default !== 'Alt+Shift+Y') {
    errors.push('Master shortcut must be Alt+Shift+Y');
  }
  if (!String(constantsSource || '').includes(
    "Tango.GMGN_ENTRY_URL = 'https://gmgn.ai/r/X9cuc5jd?chain=bsc'"
  )) errors.push('Missing exact GMGN referral entry constant');
  if (!/TANGO_OPEN_GMGN/.test(String(backgroundSource || ''))
    || !/Tango\.GMGN_ENTRY_URL/.test(String(backgroundSource || ''))) {
    errors.push('Background must own the TANGO_OPEN_GMGN referral action');
  }
  if (!/removeAttribute/.test(String(adapterSource || ''))
    || !/\.type\s*=\s*['"]button['"]/.test(String(adapterSource || ''))) {
    errors.push('Quick buy replacement must be an inert sanitized button');
  }
  return errors;
}

function collectJavaScriptSources(root, directories = ['src', 'tests', 'scripts']) {
  const sources = [];
  for (const directory of directories) {
    const start = path.join(root, directory);
    if (!fs.existsSync(start)) continue;
    const pending = [start];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (entry.isFile() && entry.name.endsWith('.js')) {
          sources.push({ file: path.relative(root, absolute), source: fs.readFileSync(absolute, 'utf8') });
        }
      }
    }
  }
  return sources;
}

function collectProductionJavaScriptSources(root) {
  return collectJavaScriptSources(root, ['src']);
}

function validateExtension(root = path.resolve(__dirname, '..')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const constantsSource = fs.readFileSync(path.join(root, 'src/shared/constants.js'), 'utf8');
  const referenced = new Set();
  const errors = [];
  const add = (value) => { if (typeof value === 'string') referenced.add(value); };

  add(manifest.action?.default_popup);
  add(manifest.options_page);
  add(manifest.background?.service_worker);
  for (const script of manifest.content_scripts || []) {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  }
  for (const block of manifest.web_accessible_resources || []) (block.resources || []).forEach(add);

  const missing = [...referenced].filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) errors.push(`Missing manifest files: ${missing.join(', ')}`);

  for (const htmlFile of ['dashboard.html', 'popup.html']) {
    const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1]).filter((item) => !item.startsWith('http'));
    const missingAssets = assets.filter((file) => !fs.existsSync(path.join(root, file)));
    if (missingAssets.length) errors.push(`${htmlFile} references missing files: ${missingAssets.join(', ')}`);
    errors.push(...htmlScriptOrderErrors(html, htmlFile));
    if (htmlFile === 'popup.html') errors.push(...popupScriptOrderErrors(html));
    if (htmlFile === 'dashboard.html') errors.push(...dashboardScriptOrderErrors(html));
  }

  errors.push(...versionConsistencyErrors({
    packageVersion: packageJson.version,
    manifestVersion: manifest.version,
    constantsSource
  }));
  errors.push(...contentScriptOrderErrors(manifest.content_scripts));
  errors.push(...mainWorldScriptOrderErrors(manifest.content_scripts));
  errors.push(...nativeQuickBuyGuardErrors(manifest.content_scripts));
  errors.push(...releaseContractErrors({
    manifest,
    constantsSource,
    backgroundSource: fs.readFileSync(path.join(root, 'src/background.js'), 'utf8'),
    adapterSource: fs.readFileSync(path.join(root, 'src/adapters/gmgn.js'), 'utf8')
  }));
  const workerFile = manifest.background?.service_worker;
  if (workerFile && fs.existsSync(path.join(root, workerFile))) {
    errors.push(...workerImportErrors(workerFile, fs.readFileSync(path.join(root, workerFile), 'utf8')));
  }
  errors.push(...paperOnlySafetyErrors(collectProductionJavaScriptSources(root)));
  errors.push(...javascriptSyntaxErrors(collectJavaScriptSources(root)));
  return { errors, manifest, referenced };
}

if (require.main === module) {
  const result = validateExtension();
  if (result.errors.length) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log(`Manifest ${result.manifest.version} valid; ${result.referenced.size} referenced files found.`);
  }
}

module.exports = {
  REQUIRED_ISOLATED_ORDER,
  REQUIRED_MAIN_ORDER,
  REQUIRED_NATIVE_GUARD_ORDER,
  REQUIRED_DASHBOARD_ORDER,
  REQUIRED_WORKER_IMPORT_ORDER,
  validateExtension,
  versionConsistencyErrors,
  contentScriptOrderErrors,
  mainWorldScriptOrderErrors,
  nativeQuickBuyGuardErrors,
  htmlScriptOrderErrors,
  popupScriptOrderErrors,
  dashboardScriptOrderErrors,
  workerImportErrors,
  javascriptSyntaxErrors,
  paperOnlySafetyErrors,
  releaseContractErrors,
  collectProductionJavaScriptSources
};
