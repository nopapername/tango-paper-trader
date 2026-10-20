const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const buildScript = path.resolve(__dirname, '../scripts/build.js');

function fixture(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'tango-build-test-'));
  // Check the absolute temporary target before registering recursive cleanup.
  const relative = path.relative(temporaryRoot, root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  write('scripts/build.js', fs.readFileSync(buildScript, 'utf8'));
  write('manifest.json', JSON.stringify({ manifest_version: 3, version: '0.3.0', permissions: ['storage'],
    host_permissions: ['https://gmgn.ai/*'], background: { service_worker: 'src/background.js' },
    action: { default_popup: 'popup.html' }, options_page: 'dashboard.html',
    content_scripts: [{ js: ['src/content.js'], css: ['src/content.css'] }] }));
  write('_locales/zh_CN/messages.json', JSON.stringify({extensionName:{message:'模拟交易'}}));
  write('_locales/en/messages.json', JSON.stringify({extensionName:{message:'Paper trading'}}));
  write('popup.html', '<script src="src/popup.js"></script>');
  write('dashboard.html', '<link rel="stylesheet" href="src/dashboard.css"><script src="src/dashboard.js"></script>');
  for (const file of ['README.md', 'PRIVACY.md', 'privacy.html', 'assets/icons/icon-128.png', 'SECURITY.md', 'docs/multichain-smoke-test.md',
    'src/background.js', 'src/content.js', 'src/content.css', 'src/popup.js', 'src/dashboard.js', 'src/dashboard.css']) write(file, `fixture ${file}`);
  write('dist/unrelated-user-file.txt', 'keep user data');
  write('dist/tango-paper-trader/old-build.txt', 'previous package');
  return { root, write, run: () => spawnSync(process.execPath, [path.join(root, 'scripts/build.js')], { encoding: 'utf8' }) };
}

test('build replaces only its own output and includes security and smoke documentation', (t) => {
  const project = fixture(t);
  const result = project.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(project.root, 'dist/unrelated-user-file.txt'), 'utf8'), 'keep user data');
  assert.equal(fs.existsSync(path.join(project.root, 'dist/tango-paper-trader/old-build.txt')), false);
  for (const file of ['manifest.json', '_locales/zh_CN/messages.json', '_locales/en/messages.json', 'privacy.html', 'assets/icons/icon-128.png', 'SECURITY.md', 'docs/multichain-smoke-test.md', 'src/popup.js']) {
    assert.equal(fs.readFileSync(path.join(project.root, 'dist/tango-paper-trader', file), 'utf8'), fs.readFileSync(path.join(project.root, file), 'utf8'));
  }
  const builtManifest = JSON.parse(fs.readFileSync(path.join(project.root, 'dist/tango-paper-trader/manifest.json'), 'utf8'));
  assert.deepEqual(builtManifest.permissions, ['storage']);
  assert.deepEqual(builtManifest.host_permissions, ['https://gmgn.ai/*']);
});

test('missing required inputs fail before deleting the previous build or unrelated dist files', (t) => {
  for (const missing of ['manifest.json', 'privacy.html', '_locales', 'assets', 'src', 'src/background.js', 'src/popup.js', 'src/dashboard.css', 'docs/multichain-smoke-test.md']) {
    const project = fixture(t);
    const target = path.resolve(project.root, missing);
    assert.ok(!path.relative(project.root, target).startsWith('..'));
    fs.rmSync(target, { recursive: ['src', 'assets', '_locales'].includes(missing), force: true });
    const result = project.run();
    assert.notEqual(result.status, 0, missing);
    assert.match(result.stderr, /Missing required build input/);
    assert.equal(fs.readFileSync(path.join(project.root, 'dist/tango-paper-trader/old-build.txt'), 'utf8'), 'previous package');
    assert.equal(fs.readFileSync(path.join(project.root, 'dist/unrelated-user-file.txt'), 'utf8'), 'keep user data');
  }
});

test('invalid manifest fails before output cleanup', (t) => {
  const project = fixture(t);
  project.write('manifest.json', '{invalid json');
  const result = project.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid build manifest/);
  assert.ok(fs.existsSync(path.join(project.root, 'dist/tango-paper-trader/old-build.txt')));
});

test('an absent optional security document does not prevent a complete build', (t) => {
  const project = fixture(t);
  fs.unlinkSync(path.join(project.root, 'SECURITY.md'));
  const result = project.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(project.root, 'dist/tango-paper-trader/SECURITY.md')), false);
});

test('a redirected dist directory cannot delete files outside the package workspace', (t) => {
  const project = fixture(t);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const external = fs.mkdtempSync(path.join(temporaryRoot, 'tango-build-external-'));
  const relative = path.relative(temporaryRoot, external);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const outputTarget = path.join(project.root, 'dist');
  assert.equal(path.dirname(outputTarget), project.root);
  fs.rmSync(outputTarget, { recursive: true, force: true });
  fs.writeFileSync(path.join(external, 'user-file.txt'), 'external data');
  try { fs.symlinkSync(external, outputTarget, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`Directory links unavailable: ${error.code}`);
    throw error;
  }
  const result = project.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid build output directory/);
  assert.equal(fs.readFileSync(path.join(external, 'user-file.txt'), 'utf8'), 'external data');
});
