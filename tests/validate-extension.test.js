const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  validateExtension,
  versionConsistencyErrors,
  contentScriptOrderErrors,
  htmlScriptOrderErrors,
  javascriptSyntaxErrors,
  REQUIRED_ISOLATED_ORDER
} = require('../scripts/validate-extension.js');

test('the current extension satisfies all static contracts', () => {
  const result = validateExtension(path.resolve(__dirname, '..'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifest.version, '0.2.17');
});

test('version consistency reports a mismatch', () => {
  const errors = versionConsistencyErrors({
    packageVersion: '0.2.17',
    manifestVersion: '0.2.18',
    constantsSource: "Tango.VERSION = '0.2.17';"
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Version mismatch/);
});

test('content script order reports a swapped marker dependency', () => {
  const scripts = [...REQUIRED_ISOLATED_ORDER];
  const markerIndex = scripts.indexOf('src/content/markers.js');
  [scripts[markerIndex], scripts[markerIndex + 1]] = [scripts[markerIndex + 1], scripts[markerIndex]];
  const errors = contentScriptOrderErrors([{ js: scripts }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /dependency order/);
});

test('content script order requires the chain registry before every isolated consumer', () => {
  const scripts = REQUIRED_ISOLATED_ORDER.filter((file) => file !== 'src/core/chains.js');
  const errors = contentScriptOrderErrors([{ js: scripts }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /src\/core\/chains\.js/);
});

test('content script order requires state after constants and before helpers', () => {
  const scripts = REQUIRED_ISOLATED_ORDER.filter((file) => file !== 'src/core/state.js');
  const errors = contentScriptOrderErrors([{ js: scripts }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /src\/core\/state\.js/);
});

test('page script order requires state after constants and before the engine', () => {
  const html = '<script src="src/core/chains.js"></script><script src="src/shared/constants.js"></script><script src="src/shared/i18n.js"></script><script src="src/shared/format.js"></script><script src="src/core/engine.js"></script><script src="src/core/storage.js"></script>';
  const errors = htmlScriptOrderErrors(html, 'popup.html');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /src\/core\/state\.js/);
});

test('JavaScript syntax validation reports the exact broken file', () => {
  const errors = javascriptSyntaxErrors([
    { file: 'valid.js', source: 'const value = 1;' },
    { file: 'broken.js', source: 'function {' }
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /broken\.js/);
});
