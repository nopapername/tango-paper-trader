const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'docs/multichain-smoke-test.md'), 'utf8');
const Chains = require('../src/core/chains.js');

function parseMarkdownRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function smokeTable() {
  const lines = smoke.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith('| Chain |'));
  assert.notEqual(headerIndex, -1, 'missing smoke-test table');
  const tableLines = [];
  for (const line of lines.slice(headerIndex)) {
    if (!line.startsWith('|')) break;
    tableLines.push(line);
  }
  return {
    columns: parseMarkdownRow(tableLines[0]),
    rows: tableLines.slice(2).map(parseMarkdownRow)
  };
}

test('README separates current-chain operations from full backup and reset scopes', () => {
  assert.doesNotMatch(readme, /Current-chain-only[^\n]*(?:settings|exports|resets)/i);
  assert.match(readme, /Trading and chain-scoped portfolio operations are current-chain-only/);
  assert.match(readme, /JSON import and export form a full six-chain backup/);
  assert.match(readme, /The all-chain reset is explicit and permanent, while the selected-chain reset preserves every other chain/);
});

test('README identifies per-chain and global settings', () => {
  assert.match(readme, /Buy presets, network fee, and reset principal are per-chain/);
  assert.match(readme, /Sell presets, slippage, platform fee, confirmation, fast mode, sound, language, theme, enabled state, and selected chain are global/);
});

test('smoke table has the required columns and every registered chain exactly once', () => {
  const table = smokeTable();
  assert.deepEqual(table.columns, [
    'Chain', 'Detail context', 'Buy', 'Partial sell', 'Close all isolation',
    'Header asset', 'Drawer isolation', 'Trench', 'Chart', 'Result'
  ]);
  assert.deepEqual(table.rows.map((row) => row[0]), Chains.all().map((chain) => chain.name));
  assert.equal(new Set(table.rows.map((row) => row[0])).size, Chains.all().length);
  table.rows.forEach((row) => assert.equal(row.length, table.columns.length));
});

test('smoke statuses are non-empty, use the approved grammar, and cannot synthesize an overall pass', () => {
  const table = smokeTable();
  const allowed = /^(?:Pass|Fail: .+|Unavailable: GMGN component absent|Blocked: .+)$/;
  const requiredForPass = [
    'Detail context', 'Buy', 'Partial sell', 'Close all isolation', 'Header asset', 'Drawer isolation'
  ].map((column) => table.columns.indexOf(column));
  const resultIndex = table.columns.indexOf('Result');

  for (const row of table.rows) {
    row.slice(1).forEach((status) => {
      assert.notEqual(status, '');
      assert.match(status, allowed);
    });
    if (requiredForPass.some((index) => row[index] !== 'Pass')) assert.notEqual(row[resultIndex], 'Pass');
  }
});
