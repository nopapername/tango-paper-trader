const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
  const full = path.join(dir, item.name);
  return item.isDirectory() ? walk(full) : [full];
});
const rel = (file) => path.relative(root, file).replaceAll('\\', '/');
const measure = (files) => files.reduce((out, file) => {
  const source = fs.readFileSync(file, 'utf8');
  out.files += 1;
  out.bytes += fs.statSync(file).size;
  out.lines += source.split(/\r?\n/).length;
  return out;
}, { files: 0, bytes: 0, lines: 0 });
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const source = walk(path.join(root, 'src'));
const tests = walk(path.join(root, 'tests'));
const specs = walk(path.join(root, 'docs/superpowers/specs'));
const plans = walk(path.join(root, 'docs/superpowers/plans'));
const assets = ['manifest.json', 'popup.html', 'dashboard.html', 'README.md', 'PRIVACY.md', 'docs/multichain-smoke-test.md', ...source.map(rel)];
const parity = assets.map((file) => {
  const original = path.join(root, file);
  const packaged = path.join(root, 'dist/tango-paper-trader', file);
  const sourceHash = hash(original);
  const packageHash = fs.existsSync(packaged) ? hash(packaged) : null;
  return { file, sourceHash, packageHash, equal: sourceHash === packageHash };
});
const result = {
  runtime: { node: process.version, platform: process.platform },
  source: measure(source),
  javascript: measure(source.filter((file) => file.endsWith('.js'))),
  styles: measure(source.filter((file) => file.endsWith('.css'))),
  tests: measure(tests),
  specs: measure(specs),
  plans: measure(plans),
  largestSource: source.map((file) => ({ file: rel(file), ...measure([file]) })).sort((a, b) => b.lines - a.lines).slice(0, 8),
  planChecklist: plans.map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return { file: rel(file), checked: (text.match(/^- \[[xX]\]/gm) || []).length, unchecked: (text.match(/^- \[ \]/gm) || []).length };
  }),
  parity
};
const output = path.join(__dirname, process.argv[2] || 'inventory.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, ...result, parity: { total: parity.length, matching: parity.filter((item) => item.equal).length, mismatches: parity.filter((item) => !item.equal) } }, null, 2));
