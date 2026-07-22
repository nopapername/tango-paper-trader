const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'docs/multichain-smoke-test.md'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'scripts/build.js'), 'utf8');
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

test('README describes first-run principal as fixed per chain rather than user-entered', () => {
  assert.doesNotMatch(readme, /First-run language and paper balance setup/i);
  assert.match(readme, /First-run setup selects the language; each chain starts with 10 native units/i);
  assert.match(readme, /principal can be changed later through a selected-chain reset/i);
});

test('release documentation covers resilient paper-trading behavior and its paper-only boundary', () => {
  assert.match(readme, /first install opens the onboarding dashboard once; extension updates do not reopen onboarding/i);
  assert.match(readme, /same numeric native capital: 10 native units on each of the six independent chains/i);
  assert.match(readme, /only the active chain supplies the balance, positions, history, and header asset/i);
  assert.match(readme, /GMGN live data takes precedence.*K-line.*market-cap/i);
  assert.match(readme, /fallback opens at \$3,200 market cap with a provisional 1B supply divisor/i);
  assert.match(readme, /all-chain reset requires confirmation and resets every chain/i);
  assert.match(readme, /no wallet connection, signature, approval, swap, transaction broadcast, RPC broadcast, or real funds/i);

  assert.match(smoke, /four GMGN sizes in each of the two trench columns/i);
  assert.match(smoke, /virtual-scroll.*preserv/i);
  assert.match(smoke, /quick buy.*without a chart or detail page/i);
  assert.match(smoke, /large fallback quantity/i);
  assert.match(smoke, /100% sell closes the exact remaining quantity/i);
  assert.match(smoke, /live mark.*upgrade/i);
  assert.match(smoke, /immediately.*marker/i);
  assert.match(smoke, /delayed or replaced.*iframe.*replay/i);
  assert.match(smoke, /disabl.*clear.*marker/i);
  assert.match(smoke, /Do not click GMGN.*real.*buy.*sell.*wallet.*approval.*sign/i);
  assert.match(smoke, /Load unpacked.*dist\/tango-paper-trader/i);
  assert.match(buildScript, /docs[\\/]multichain-smoke-test\.md/, 'unpacked release must include only the paper-only smoke checklist');
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
