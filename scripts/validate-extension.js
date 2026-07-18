const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REQUIRED_ISOLATED_ORDER = [
  'src/core/chains.js',
  'src/shared/constants.js',
  'src/shared/i18n.js',
  'src/shared/format.js',
  'src/core/engine.js',
  'src/core/storage.js',
  'src/adapters/gmgn.js',
  'src/content/markers.js',
  'src/content/content.js'
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

function javascriptSyntaxErrors(sources) {
  const errors = [];
  for (const { file, source } of sources) {
    try { new vm.Script(source, { filename: file }); }
    catch (error) { errors.push(`Invalid JavaScript ${file}: ${error.message}`); }
  }
  return errors;
}

function collectJavaScriptSources(root) {
  const sources = [];
  for (const directory of ['src', 'tests', 'scripts']) {
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
  }

  errors.push(...versionConsistencyErrors({
    packageVersion: packageJson.version,
    manifestVersion: manifest.version,
    constantsSource
  }));
  errors.push(...contentScriptOrderErrors(manifest.content_scripts));
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
  validateExtension,
  versionConsistencyErrors,
  contentScriptOrderErrors,
  javascriptSyntaxErrors
};
