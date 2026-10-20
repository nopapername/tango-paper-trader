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

test('README separates current-chain operations from full backup and common-capital reset scopes', () => {
  assert.doesNotMatch(readme, /Current-chain-only[^\n]*(?:settings|exports|resets)/i);
  assert.match(readme, /Each paper order uses the token card's own chain account/);
  assert.match(readme, /retain the most recently viewed single-chain account in combined trenches/);
  assert.match(readme, /never merge native balances across chains/);
  assert.match(readme, /JSON import and export form a full six-chain backup/);
  assert.match(readme, /changing common capital requires explicit confirmation and atomically resets every chain/i);
  assert.match(readme, /balances, positions, trades, PnL\/analytics, and calibrations/i);
  assert.match(readme, /preserving other settings/i);
});

test('README identifies per-chain and global settings', () => {
  assert.match(readme, /Buy presets and network fee are per-chain/);
  assert.match(readme, /common capital is shared across all six independent chain accounts/i);
  assert.match(readme, /Sell presets, slippage, platform fee, confirmation, fast mode, sound, language, theme, enabled state, and selected chain are global/);
});

test('README describes user-chosen first-run common capital rather than a fixed or selected-chain principal', () => {
  assert.doesNotMatch(readme, /principal can be changed later through a selected-chain reset/i);
  assert.doesNotMatch(readme, /same numeric native capital: 10 native units/i);
  assert.match(readme, /First-run onboarding lets the user choose language and one common paper-capital amount, defaulting to 10/i);
  assert.match(readme, /All six independent chain accounts receive that chosen numeric amount in their own native asset/i);
});

test('release documentation covers resilient paper-trading behavior and its paper-only boundary', () => {
  assert.match(readme, /first install opens the onboarding dashboard once; extension updates do not reopen onboarding/i);
  assert.match(readme, /common paper-capital amount, defaulting to 10/i);
  assert.match(readme, /Account windows show the active single chain, or retain the most recently viewed single-chain account in combined trenches/i);
  assert.match(readme, /GMGN live data takes precedence.*K-line.*market-cap/i);
  assert.match(readme, /fallback opens at \$3,200 market cap with a provisional 1B supply divisor/i);
  assert.match(readme, /changing common capital requires explicit confirmation and atomically resets every chain/i);
  assert.match(readme, /no wallet connection, signature, approval, swap, transaction broadcast, RPC broadcast, or real funds/i);

  assert.match(smoke, /each native quick-buy slot.*exactly one Tango Paper control/i);
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
  assert.match(smoke, /default.*10/i);
  assert.match(smoke, /non-default common capital of 12\.5/i);
  assert.match(smoke, /all six.*12\.5.*own native asset/i);
  assert.match(smoke, /confirmed common-capital reset.*balances, positions, trades, PnL\/analytics, and calibrations/i);
  assert.doesNotMatch(smoke, /selected-chain reset leaves the other five unchanged/i);
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
