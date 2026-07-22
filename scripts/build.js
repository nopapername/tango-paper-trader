const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const output = path.join(dist, 'tango-paper-trader');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const include = ['manifest.json', 'popup.html', 'dashboard.html', 'README.md', 'PRIVACY.md', 'src'];
for (const entry of include) {
  const source = path.join(root, entry);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(output, entry), { recursive: true });
}
const smokeChecklist = 'docs/multichain-smoke-test.md';
const smokeSource = path.join(root, smokeChecklist);
const smokeOutput = path.join(output, smokeChecklist);
fs.mkdirSync(path.dirname(smokeOutput), { recursive: true });
fs.cpSync(smokeSource, smokeOutput);
console.log(`Built unpacked extension at ${output}`);
