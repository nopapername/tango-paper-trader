const test = require('node:test');
const assert = require('node:assert/strict');
global.Tango = {};
require('../src/core/chains.js');
require('../src/core/supply.js');
const GMGN = require('../src/adapters/gmgn.js');
test('trench position badge updates in place and disappears after close or identity loss', () => {
  let badge = null, created = 0;
  const name = { insertAdjacentElement(where, node) { assert.equal(where, 'afterend'); badge = node; } };
  const symbol = { nextElementSibling: name };
  const card = { dataset: {}, querySelector(selector) { return selector === '.tango-trench-position-badge' ? badge : symbol; } };
  const previousDocument = global.document;
  global.document = { createElement() { created++; return { textContent: '', title: '', remove() { badge = null; } }; } };
  try {
    GMGN._updatePositionBadge(card, { text: '持仓 0.12 SOL', title: '0.12345678 SOL' });
    assert.equal(badge.textContent, '持仓 0.12 SOL');
    assert.equal(badge.title, '0.12345678 SOL');
    GMGN._updatePositionBadge(card, { text: '持仓 0.13 SOL', title: '0.13 SOL' });
    assert.equal(created, 1, 'quote updates reuse the badge element');
    assert.equal(badge.textContent, '持仓 0.13 SOL');
    GMGN._updatePositionBadge(card, null);
    assert.equal(badge, null);
    assert.equal(card.dataset.tangoPositionCard, undefined);
  } finally { global.document = previousDocument; }
});

test('held card name layout can shrink around the complete value badge and restores on removal', () => {
  const classes = () => { const values = new Set(); return { add: n => values.add(n), remove: n => values.delete(n), contains: n => values.has(n) }; };
  let badge;
  const row = { classList: classes(), querySelectorAll: () => [name] };
  const name = { classList: classes(), parentElement: row, insertAdjacentElement(_where, node) { badge = node; node.parentElement = row; } };
  const symbol = { nextElementSibling: name };
  const card = { dataset: {}, querySelector: s => s === '.tango-trench-position-badge' ? badge : symbol };
  const previous = global.document;
  global.document = { createElement: () => ({ textContent: '', title: '', remove() { badge = null; } }) };
  try {
    GMGN._updatePositionBadge(card, { text: '持仓 0.1234 BNB' });
    assert.equal(row.classList.contains('tango-trench-position-row'), true);
    assert.equal(name.classList.contains('tango-trench-position-name'), true);
    GMGN._updatePositionBadge(card, null);
    assert.equal(row.classList.contains('tango-trench-position-row'), false);
    assert.equal(name.classList.contains('tango-trench-position-name'), false);
    assert.equal(badge, null);
  } finally { global.document = previous; }
});

test('holding layout repairs React class rewrites and clears when React removes the badge first', () => {
  const classes = () => { const values = new Set(); return { add: n => values.add(n), remove: n => values.delete(n), contains: n => values.has(n) }; };
  let badge;
  const row = { classList: classes(), querySelectorAll: () => [name] };
  const name = { classList: classes(), parentElement: row, insertAdjacentElement(_where, node) { badge = node; node.parentElement = row; node.previousElementSibling = name; } };
  const symbol = { nextElementSibling: name };
  const card = { dataset: {}, querySelector: s => s === '.tango-trench-position-badge' ? badge : symbol };
  const previous = global.document;
  global.document = { createElement: () => ({ textContent: '', title: '', remove() { badge = null; } }) };
  try {
    GMGN._updatePositionBadge(card, { text: '持仓 0.1234 BNB' });
    row.classList.remove('tango-trench-position-row');
    name.classList.remove('tango-trench-position-name');
    GMGN._updatePositionBadge(card, { text: '持仓 0.12 BNB' });
    assert.equal(row.classList.contains('tango-trench-position-row'), true, 'repair rewritten native row class');
    assert.equal(name.classList.contains('tango-trench-position-name'), true);
    badge = null;
    GMGN._updatePositionBadge(card, null);
    assert.equal(row.classList.contains('tango-trench-position-row'), false, 'clear layout even without badge DOM');
    assert.equal(name.classList.contains('tango-trench-position-name'), false);
  } finally { global.document = previous; }
});
