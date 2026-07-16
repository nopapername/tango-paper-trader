const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const referenced = new Set();

function add(value) { if (typeof value === 'string') referenced.add(value); }
add(manifest.action?.default_popup);
add(manifest.options_page);
add(manifest.background?.service_worker);
for (const script of manifest.content_scripts || []) {
  (script.js || []).forEach(add); (script.css || []).forEach(add);
}
for (const block of manifest.web_accessible_resources || []) (block.resources || []).forEach(add);

const missing = [...referenced].filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error('Missing manifest files:', missing.join(', '));
  process.exit(1);
}

for (const htmlFile of ['dashboard.html', 'popup.html']) {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((item) => !item.startsWith('http'));
  const missingAssets = assets.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missingAssets.length) {
    console.error(`${htmlFile} references missing files:`, missingAssets.join(', '));
    process.exit(1);
  }
}

console.log(`Manifest ${manifest.version} valid; ${referenced.size} referenced files found.`);
