const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const current = fs.readFileSync(path.resolve(__dirname, '../src/shared/format.js'), 'utf8');
const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/format-0.3.6-baseline.js'), 'utf8');
function load(source) {
  let constructions = 0;
  const context = { Intl: { NumberFormat: function(...args) { constructions += 1; return new Intl.NumberFormat(...args); } } };
  vm.runInNewContext(source, context);
  return { format: context.Tango.Format, get constructions() { return constructions; } };
}
test('repeated UI amount formatting reuses a bounded set of formatters', () => {
  const loaded = load(current);
  for (let index = 0; index < 100; index += 1) {
    loaded.format.native(index / 100, 'BNB', 'en');
    loaded.format.usd(index / 100000, 'zh-CN');
    loaded.format.percent(index / 100, 'zh-CN', true);
    loaded.format.compact(index * 10000, 'en');
  }
  assert.ok(loaded.constructions <= 4, `expected at most4 formatters, got ${loaded.constructions}`);
});
test('all public formatters preserve baseline strings across values, languages and signs', () => {
  const original = load(baseline).format;
  const optimized = load(current).format;
  const values = [undefined, null, '', '2.33', 'invalid', 0, -0, 0.000000000001, -0.001, 0.0099999, 0.01, 1.23456, -1024.12345, 999999999, Number.MAX_VALUE, NaN, Infinity, -Infinity];
  for (const language of ['en', 'zh-CN', 'auto', undefined]) for (const value of values) {
    for (const signed of [false, true]) {
      for (const name of ['native', 'sol', 'percent']) {
        const args = name === 'native' ? [value, ' BNB ', language, signed] : [value, language, signed];
        assert.equal(optimized[name](...args), original[name](...args), `${name}:${language}:${String(value)}:${signed}`);
      }
      assert.equal(optimized.usd(value, language, signed), original.usd(value, language, signed));
    }
    assert.equal(optimized.number(value, language), original.number(value, language));
    assert.equal(optimized.compact(value, language), original.compact(value, language));
  }
});
test('precision coercion and invalid precision errors preserve the baseline behavior', () => {
  const original = load(baseline).format;
  const optimized = load(current).format;
  for (const digits of [0, -0, 1, 2, 10, 20, 21, 100, 101, '2', 'bad', null, true, 1.5, -1, NaN, Infinity, {}, Symbol('x'), 2n]) {
    for (const language of ['en', 'zh-CN']) for (const name of ['number', 'compact']) {
      let expected, failure;
      try { expected = original[name](123.456, language, digits); } catch (error) { failure = error.name; }
      if (failure) assert.throws(() => optimized[name](123.456, language, digits), (error) => error.name === failure);
      else assert.equal(optimized[name](123.456, language, digits), expected);
    }
  }
});
test('unsupported precision values cannot collide with cached valid precision', () => {
  const loaded = load(current);
  loaded.format.number(1, 'en', 0);
  assert.throws(() => loaded.format.number(1, 'en', NaN), (error) => error.name === 'RangeError');
  loaded.format.compact(1, 'en', 2);
  assert.throws(() => loaded.format.compact(1, 'en', Symbol('2')), (error) => error.name === 'TypeError');
});


test('formatter reuse stays bounded across every cacheable precision and language alias', () => {
  const loaded = load(current);
  for (let round = 0; round < 3; round += 1) for (const language of ['en', 'zh-CN', 'auto', 'fr']) {
    for (let digits = 0; digits <= 20; digits += 1) {
      loaded.format.number(12345.6789, language, digits);
      loaded.format.compact(12345.6789, language, digits);
    }
  }
  assert.equal(loaded.constructions, 84);
});
