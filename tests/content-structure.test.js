const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');

function between(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, `missing ${startText}`);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test('chart frames are checked before a marker payload scans trades', () => {
  const block = between('function syncChartMarkers(', 'function renderModal(');
  const query = block.indexOf('document.querySelectorAll(');
  const guard = block.indexOf('if (!frames.length) return;');
  const payload = block.indexOf('chartMarkerPayload()');
  assert.ok(query >= 0 && guard > query && payload > guard);
});

test('render computes one portfolio summary and passes it to the drawer', () => {
  const drawer = between('function renderDrawer(', 'function chartMarkerPayload(');
  const render = between('function render()', 'function bindEvents()');
  assert.match(drawer, /^function renderDrawer\(summary\)/);
  assert.doesNotMatch(drawer, /portfolioSummary/);
  assert.match(render, /const summary = Tango\.Engine\.portfolioSummary\(runtime\.state\)/);
  assert.equal([...render.matchAll(/Tango\.Engine\.portfolioSummary\(runtime\.state\)/g)].length, 1);
  assert.match(render, /renderDrawer\(summary\)/);
});
