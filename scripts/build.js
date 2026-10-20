const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const output = path.join(dist, 'tango-paper-trader');
const include = ['manifest.json', 'popup.html', 'dashboard.html', 'README.md', 'PRIVACY.md', 'privacy.html', 'assets', 'src', '_locales'];
const smokeChecklist = 'docs/multichain-smoke-test.md';

function requiredInput(entry, directory = false) {
  const source = path.resolve(root, entry);
  const relative = path.relative(root, source);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid build input path: ${entry}`);
  }
  if (!fs.existsSync(source) || (directory ? !fs.statSync(source).isDirectory() : !fs.statSync(source).isFile())) {
    throw new Error(`Missing required build input: ${entry}`);
  }
  return source;
}

// Validate every declared local asset before removing the previous package.
for (const entry of [...include, smokeChecklist]) requiredInput(entry, entry === 'src' || entry === 'assets' || entry === '_locales');
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); }
catch (error) { throw new Error(`Invalid build manifest: ${error.message}`); }
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid build manifest: expected an object');
const manifestAssets = [
  manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_page,
  ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
  ...Object.values(manifest.icons || {}),
  ...(typeof manifest.action?.default_icon === 'string' ? [manifest.action.default_icon] : Object.values(manifest.action?.default_icon || {})),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => (entry.resources || []).filter((file) => !file.includes('*')))
].filter(Boolean);
for (const entry of manifestAssets) requiredInput(entry);
for (const html of ['popup.html', 'dashboard.html']) {
  const source = fs.readFileSync(path.join(root, html), 'utf8');
  for (const [, asset] of source.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(asset)) requiredInput(asset.split(/[?#]/)[0]);
  }
}

const securityDocument = path.join(root, 'SECURITY.md');
if (fs.existsSync(securityDocument)) {
  requiredInput('SECURITY.md');
  include.push('SECURITY.md');
}

// A junction or symlink at dist could redirect cleanup outside this project.
if (fs.existsSync(dist) && (fs.lstatSync(dist).isSymbolicLink() || !fs.lstatSync(dist).isDirectory())) {
  throw new Error('Invalid build output directory: dist must be a local directory');
}
const outputRelative = path.relative(dist, output);
if (outputRelative !== 'tango-paper-trader') throw new Error('Invalid build output path');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const entry of include) {
  const source = path.join(root, entry);
  fs.cpSync(source, path.join(output, entry), { recursive: true });
}
const smokeSource = path.join(root, smokeChecklist);
const smokeOutput = path.join(output, smokeChecklist);
fs.mkdirSync(path.dirname(smokeOutput), { recursive: true });
fs.cpSync(smokeSource, smokeOutput);
console.log(`Built unpacked extension at ${output}`);
