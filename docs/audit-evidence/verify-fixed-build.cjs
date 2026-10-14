const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'dist/tango-paper-trader');
const relative = (file, base = root) => path.relative(base, file).replaceAll('\\', '/');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = ['manifest.json', 'popup.html', 'dashboard.html', 'README.md', 'PRIVACY.md',
  'SECURITY.md', 'docs/multichain-smoke-test.md', ...walk(path.join(root, 'src')).map((file) => relative(file))];
const parity = required.map((file) => {
  const sourceHash = hash(path.join(root, file));
  const packageFile = path.join(output, file);
  const packageHash = fs.existsSync(packageFile) ? hash(packageFile) : null;
  return { file, sourceHash, packageHash, equal: sourceHash === packageHash };
});
const extras = walk(output).map((file) => relative(file, output)).filter((file) => !required.includes(file));
const baselineManifest = JSON.parse(execFileSync('git', ['show', 'HEAD:manifest.json'], { cwd: root, encoding: 'utf8' }));
const currentManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.deepEqual(currentManifest.permissions, baselineManifest.permissions);
assert.deepEqual(currentManifest.host_permissions, baselineManifest.host_permissions);
assert.ok(parity.every((entry) => entry.equal), 'Packaged files must match source');
assert.deepEqual(extras, [], 'Package should contain only declared source assets');
const result = {
  date: '2026-10-13', timezone: 'Asia/Shanghai', version: currentManifest.version,
  runtime: { node: process.version, platform: process.platform },
  requiredFiles: required.length, matchingFiles: parity.filter((entry) => entry.equal).length,
  extras, permissionsUnchanged: true, parity
};
fs.writeFileSync(path.join(__dirname, 'fixed-build-parity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ requiredFiles: result.requiredFiles, matchingFiles: result.matchingFiles,
  extras, permissionsUnchanged: true }, null, 2));
