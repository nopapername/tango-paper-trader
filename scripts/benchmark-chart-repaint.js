const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const harnessPath = path.resolve(__dirname, '../tests/markers.test.js');
const baselinePath = process.argv[2];
if (!baselinePath) throw new Error('Pass the baseline chart-main.js path');
const requireHarness = createRequire(harnessPath);
const harnessSource = fs.readFileSync(harnessPath, 'utf8') + '\nmodule.exports = { seedRepaintingChart };';
function run(chartPath) {
  const chartSource = fs.readFileSync(chartPath, 'utf8');
  const exports = {};
  const context = {
    module: { exports }, exports, global, URL, structuredClone, __dirname: path.dirname(harnessPath), console,
    require(name) {
      if (name === 'node:test') return () => {};
      if (name === 'node:fs') return { ...fs, readFileSync(file, ...args) {
        return String(file).endsWith('chart-main.js') ? chartSource : fs.readFileSync(file, ...args);
      } };
      return requireHarness(name);
    }
  };
  vm.runInNewContext(harnessSource, context, { filename: harnessPath });
  const { chart, paint } = context.module.exports.seedRepaintingChart();
  const startCreates = chart.domStats.creates;
  const startReplacements = chart.domStats.replacements;
  let emptyDuringPaint = 0;
  const completedFrames = [];
  const started = performance.now();
  for (let index = 0; index < 100; index += 1) {
    chart.clear();
    if (!chart.api.snapshot().overlayChildren) emptyDuringPaint += 1;
    paint(index % 8);
    if (chart.pendingFrames.length) chart.flushAnimationFrame();
    else chart.api.render();
    completedFrames.push(JSON.stringify(chart.api.overlayNodes().map((line) => ({
      style: line.style, label: line.children[0].children[0].textContent, closeTitle: line.children[0].children[1].title
    }))));
  }
  const elapsedMs = performance.now() - started;
  const createdElements = chart.domStats.creates - startCreates;
  const replacedChildLists = chart.domStats.replacements - startReplacements;
  for (let index = 0; index < 50; index += 1) chart.api.record(chart.canvasContext, `$${5000 + index * 40}`, 950, 400 - index * 4);
  let geometryReads = 0;
  const canvas = chart.canvasContext.canvas;
  const original = canvas.getBoundingClientRect.bind(canvas);
  canvas.getBoundingClientRect = () => { geometryReads += 1; return original(); };
  chart.api.render();
  return { completedFrames, metrics: { repaintCycles: 100, emptyDuringPaint, createdElements,
    replacedChildLists, geometryReadsFor50Ticks: geometryReads,
    elapsedMs: Number(elapsedMs.toFixed(2)) } };
}
const baseline = run(path.resolve(baselinePath));
const optimized = run(path.resolve(__dirname, '../src/content/chart-main.js'));
assert.deepEqual(optimized.completedFrames, baseline.completedFrames, 'completed paint output must remain identical');
console.log(JSON.stringify({ baseline: baseline.metrics, optimized: optimized.metrics, equivalentCompletedFrames: baseline.completedFrames.length }, null, 2));
