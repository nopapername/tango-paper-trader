const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
function loadFormat(file) {
  let constructions = 0;
  const context = { Intl: { NumberFormat: function(...args) { constructions += 1; return new Intl.NumberFormat(...args); } } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return { format: context.Tango.Format, get constructions() { return constructions; } };
}
function formatRun(file) {
  const loaded = loadFormat(file);
  const output = [];
  const started = performance.now();
  for (let index = 0; index < 3000; index += 1) {
    const language = index % 2 ? 'zh-CN' : 'en';
    output.push(loaded.format.native(index / 100, 'BNB', language));
    output.push(loaded.format.usd(index / 10000000, language));
    output.push(loaded.format.percent(index / 100, language, true));
    output.push(loaded.format.compact(index * 10000, language));
  }
  return { output, metrics: { calls: output.length, formatterConstructions: loaded.constructions, elapsedMs: Number((performance.now() - started).toFixed(2)) } };
}
global.Tango = {};
const Chains = require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');
const legacySummary = require('../tests/fixtures/portfolio-summary-0.3.6-baseline.js');
const state = State.createInitialState({ now: 1 });
const chains = Chains.all();
state.trades = Array.from({ length: 5000 }, (_, index) => ({
  chain: chains[index % chains.length].id, side: index % 3 ? 'SELL' : 'BUY', realizedPnlNative: ((index % 97) - 48) / 1000
}));
for (let index = 0; index < 30; index += 1) {
  const chain = chains[index % chains.length].id;
  state.positions[`${chain}:${index}`] = { chain, quantity: index + 1, costBasisNative: 0.1, lastPriceUsd: index + 2, lastNativePriceUsd: 700 };
}
function summaryRun(build) {
  const output = [];
  const started = performance.now();
  for (let index = 0; index < 200; index += 1) for (const chain of chains) output.push(build(state, chain.id, 700));
  return { output, metrics: { calls: output.length, tradeRecords: state.trades.length, elapsedMs: Number((performance.now() - started).toFixed(2)) } };
}
const formatBaseline = formatRun(path.join(root, 'tests/fixtures/format-0.3.6-baseline.js'));
const formatOptimized = formatRun(path.join(root, 'src/shared/format.js'));
assert.deepEqual(formatOptimized.output, formatBaseline.output);
const before = structuredClone(state);
const summaryBaseline = summaryRun((state, chain, price) => legacySummary(state, chain, price, Engine.markPosition));
const summaryOptimized = summaryRun(Engine.portfolioSummary);
assert.deepEqual(summaryOptimized.output, summaryBaseline.output);
assert.deepEqual(state, before);
console.log(JSON.stringify({ format: { baseline: formatBaseline.metrics, optimized: formatOptimized.metrics, identicalOutputs: formatBaseline.output.length },
  summary: { baseline: summaryBaseline.metrics, optimized: summaryOptimized.metrics, identicalOutputs: summaryBaseline.output.length },
  timingScope: 'Isolated Node workload; timings vary and do not measure GMGN FPS or trade latency' }, null, 2));
