'use strict';

// After dot-sourcing scripts/dev-env.ps1, run with the project Electron:
// electron scripts/mouse-effects-performance-smoke.js --baseline=F:\\...\\mouse-effects.js
// This is an engine comparison, not a navigation/UI test. The separate runtime
// smoke test checks navigation, clipping and the actual application's overlay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow } = require('electron');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');

const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const baselineFile = resolveFPath(argument('baseline'), '旧动效基线');
const currentFile = path.resolve(__dirname, '../src/renderer/mouse-effects.js');
const rounds = Number(argument('rounds', '2'));
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 4, '--rounds must be between 1 and 4');
const engines = { baseline: fs.readFileSync(baselineFile, 'utf8'), current: fs.readFileSync(currentFile, 'utf8') };
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
assert.notEqual(digest(engines.baseline), digest(engines.current), 'Baseline and current source must differ');
const profile = makeSmokeDirectory('gaia-mouse-performance-');
configureSmokePaths(app, { userData: profile });
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const reportFile = path.join(profile, 'report.json');
const report = {
  profile, reportFile, baselineFile, currentFile,
  sourceSha256: Object.fromEntries(Object.entries(engines).map(([name, code]) => [name, digest(code)])),
  settings: { preset: 2, intensity: 1, scale: 1.5, requestedDpr: 2, rounds,
    naturalWarmupMs: 1500, naturalMeasureMs: 4000, fixedWarmupFrames: 120, fixedMeasureFrames: 180 },
  methodology: [
    'Both sources run sequentially in fresh pages of the same visible Electron window; round order alternates.',
    'Natural RAF measures frame intervals and JavaScript drawing submission time without pixel readback.',
    'Fixed-step replay uses identical time, input and random seeds; each frame reads one pixel to force canvas raster completion.',
    'Fixed-step readback includes synchronization and readback overhead and may change Chromium canvas acceleration. It is not display FPS.',
    'Canvas operations are instrumented equally. Particle parity is exact; cached shadows and dirty-region work are counted directly.',
    'An engine-only harness cannot measure application navigation or operating-system input latency.',
  ],
  samples: [], checks: [], errors: [],
};
let win;
let finished = false;
const started = Date.now();
const timeout = setTimeout(() => finish(new Error('Mouse performance comparison timed out after 150 seconds')), 150000);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  report.elapsedMs = Date.now() - started;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, reportFile, elapsedMs: report.elapsedMs,
    checks: report.checks, comparison: report.comparison, error: report.error }, null, 2));
  if (win && !win.isDestroyed()) win.destroy();
  process.exitCode = error ? 1 : 0;
  app.quit();
}

// Everything in this function executes in Chromium. Keep it self-contained.
async function measureInRenderer(options) {
  const canvas = document.getElementById('effect');
  const nativeNow = performance.now.bind(performance);
  const nativeRaf = requestAnimationFrame.bind(window);
  let randomState = options.seed >>> 0;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  let phase = 'warmup';
  const counter = () => ({ mainFills: 0, mainSprites: 0, spriteFills: 0, mainShadowDraws: 0,
    spriteShadowDraws: 0, shadowAssignments: 0, clearCalls: 0, clearedBackingPixels: 0 });
  const operations = { warmup: counter(), measured: counter() };
  const drawCpu = [], intervals = [], syncCpu = [], combinedCpu = [], population = [];
  let previousRafTime = null, frameCpu = 0, virtualTime = 0, nextId = 0;
  const queue = new Map();

  // OffscreenCanvas has its own prototype; include atlas creation in the work
  // counters, while distinguishing it from per-frame main-canvas shadows.
  for (const prototype of [CanvasRenderingContext2D.prototype,
    typeof OffscreenCanvasRenderingContext2D === 'undefined' ? null : OffscreenCanvasRenderingContext2D.prototype]) {
    if (!prototype) continue;
    for (const method of ['fill', 'stroke', 'drawImage', 'clearRect']) {
      const original = prototype[method];
      prototype[method] = function (...args) {
        const counts = operations[phase];
        const main = this.canvas === canvas;
        if (method === 'fill') counts[main ? 'mainFills' : 'spriteFills']++;
        if (method === 'drawImage' && main) counts.mainSprites++;
        if ((method === 'fill' || method === 'stroke') && this.shadowBlur > 0) {
          counts[main ? 'mainShadowDraws' : 'spriteShadowDraws']++;
        }
        if (method === 'clearRect' && main) {
          const transform = this.getTransform();
          counts.clearCalls++;
          counts.clearedBackingPixels += Math.abs(args[2] * args[3] *
            (transform.a * transform.d - transform.b * transform.c));
        }
        return Reflect.apply(original, this, args);
      };
    }
    const shadow = Object.getOwnPropertyDescriptor(prototype, 'shadowBlur');
    if (shadow?.set) Object.defineProperty(prototype, 'shadowBlur', {
      ...shadow,
      set(value) {
        if (Number(value) > 0) operations[phase].shadowAssignments++;
        shadow.set.call(this, value);
      },
    });
  }

  if (options.mode === 'fixed') {
    // Engine event spacing reads performance.now; the draw timer above keeps
    // the native clock so timings remain real while particle simulation is equal.
    Object.defineProperty(performance, 'now', { configurable: true, value: () => virtualTime });
  }
  window.requestAnimationFrame = callback => {
    const measuredCallback = time => {
      const before = nativeNow();
      callback(time);
      const elapsed = nativeNow() - before;
      frameCpu += elapsed;
      if (phase === 'measured') {
        drawCpu.push(elapsed);
        if (options.mode === 'natural' && previousRafTime !== null) intervals.push(time - previousRafTime);
        previousRafTime = time;
      }
    };
    if (options.mode === 'natural') return nativeRaf(measuredCallback);
    const id = ++nextId;
    queue.set(id, measuredCallback);
    return id;
  };
  const nativeCancel = cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = id => options.mode === 'natural' ? nativeCancel(id) : queue.delete(id);
  (0, eval)(options.source);
  const effect = window.MouseEffects.create(canvas, { id: 2, intensity: 1, scale: 1.5, softwareRendering: options.softwareRendering });
  const ctx = canvas.getContext('2d');
  const input = (time, click) => {
    const t = time / 1000;
    const x = innerWidth * (.5 + .36 * Math.sin(t * 8));
    const y = innerHeight * (.5 + .29 * Math.cos(t * 6.7));
    effect.move(x, y);
    if (click) effect.click(x, y);
  };
  if (options.mode === 'natural') {
    await new Promise(resolve => {
      let start, previousClick = -1;
      const step = now => {
        if (start === undefined) start = now;
        const elapsed = now - start;
        if (elapsed >= options.warmupMs) phase = 'measured';
        if (elapsed >= options.warmupMs + options.measureMs) { resolve(); return; }
        const clickNumber = Math.floor(elapsed / 300);
        input(elapsed, clickNumber !== previousClick);
        previousClick = clickNumber;
        if (phase === 'measured') population.push(effect.getState().particles);
        nativeRaf(step);
      };
      nativeRaf(step);
    });
  } else {
    for (let index = 0; index < options.warmupFrames + options.measureFrames; index++) {
      phase = index >= options.warmupFrames ? 'measured' : 'warmup';
      virtualTime = (index + 1) * 1000 / 60;
      input(virtualTime, index % 18 === 0);
      const callbacks = Array.from(queue.values());
      queue.clear();
      frameCpu = 0;
      for (const callback of callbacks) callback(virtualTime);
      const beforeReadback = nativeNow();
      // A one-pixel read must synchronize pending canvas draws, but avoids
      // copying a full high-DPI frame into JavaScript on every replay step.
      ctx.getImageData(0, 0, 1, 1);
      const synchronized = nativeNow() - beforeReadback;
      if (phase === 'measured') {
        population.push(effect.getState().particles);
        syncCpu.push(synchronized);
        combinedCpu.push(frameCpu + synchronized);
      }
      // Let window lifecycle events run without advancing the virtual clock.
      if (index % 30 === 29) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const statistics = values => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
    return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      median: percentile(.5), p95: percentile(.95), max: sorted[sorted.length - 1] };
  };
  const state = effect.getState();
  const measuredDraws = operations.measured.mainFills + operations.measured.mainSprites;
  const result = { mode: options.mode, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
    backing: [canvas.width, canvas.height], settings: { id: state.id, intensity: state.intensity, scale: state.scale },
    rafIntervalMs: statistics(intervals), rafOver25Ms: intervals.filter(value => value > 25).length,
    rafOver50Ms: intervals.filter(value => value > 50).length,
    drawSubmissionCpuMs: statistics(drawCpu), rasterSyncReadbackMs: statistics(syncCpu),
    drawingAndReadbackMs: statistics(combinedCpu), particles: statistics(population), population,
    particleDraws: measuredDraws, operations: { warmup: { ...operations.warmup }, measured: { ...operations.measured } } };
  if (options.mode === 'fixed') {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nontransparentPixels = 0, alphaSum = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]) nontransparentPixels++;
      alphaSum += pixels[i];
    }
    result.finalPixels = { nontransparentPixels, alphaSum };
  }
  effect.destroy();
  // Destroy clears the canvas, which is cleanup rather than measured work.
  return result;
}

const html = '<!doctype html><meta charset="utf-8"><title>银尘星轨性能验证</title>' +
  '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eeeaf3}' +
  '#surface{position:absolute;inset:0}canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}' +
  'p{position:absolute;left:24px;top:12px;color:#75677f;font:16px system-ui}</style>' +
  '<p>银尘星轨 · 浓度 100% · 大小 150% · 高 DPI 性能验证</p><div id="surface"><canvas id="effect"></canvas></div>';

async function run() {
  report.softwareRendering = app.getGPUFeatureStatus().gpu_compositing !== 'enabled';
  win = new BrowserWindow({ width: 1000, height: 700, useContentSize: true, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, spellcheck: false } });
  win.webContents.on('render-process-gone', (_event, details) => finish(new Error('Renderer exited: ' + JSON.stringify(details))));
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  win.showInactive();
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
    for (const mode of ['natural', 'fixed']) {
      for (const name of order) {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        const options = { source: engines[name], mode, seed: 0x52ea0917, softwareRendering: report.softwareRendering,
          warmupMs: report.settings.naturalWarmupMs, measureMs: report.settings.naturalMeasureMs,
          warmupFrames: report.settings.fixedWarmupFrames, measureFrames: report.settings.fixedMeasureFrames };
        const result = await win.webContents.executeJavaScript(`(${measureInRenderer.toString()})(${JSON.stringify(options)})`);
        report.samples.push({ name, round: round + 1, ...result });
      }
    }
  }
  const check = (label, condition) => { assert.ok(condition, label); report.checks.push(label); };
  check('No renderer errors', report.errors.length === 0);
  const first = report.samples[0];
  check('Identical high-DPI canvas and selected 100%/150% preset for every sample', report.samples.every(sample =>
    sample.dpr >= 1.9 && JSON.stringify(sample.viewport) === JSON.stringify(first.viewport) &&
    JSON.stringify(sample.backing) === JSON.stringify(first.backing) && sample.settings.id === 2 &&
    sample.settings.intensity === 1 && sample.settings.scale === 1.5));
  check('Natural samples contain at least 30 animation frames after warmup', report.samples.filter(sample => sample.mode === 'natural')
    .every(sample => sample.rafIntervalMs?.count >= 30));
  const fixed = report.samples.filter(sample => sample.mode === 'fixed');
  check('Fixed replay draws exactly the same particle population in every frame', fixed.every(sample =>
    JSON.stringify(sample.population) === JSON.stringify(fixed[0].population) && sample.particleDraws === fixed[0].particleDraws));
  check('Fixed replay produces visible star artwork', fixed.every(sample => sample.finalPixels.nontransparentPixels > 100));
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const comparison = mode => {
    const samples = name => report.samples.filter(sample => sample.mode === mode && sample.name === name);
    const metric = (name, field) => mean(samples(name).map(sample => field(sample)));
    const pair = field => {
      const baseline = metric('baseline', field), current = metric('current', field);
      return { baseline, current, reductionPercent: baseline ? (1 - current / baseline) * 100 : null };
    };
    return { drawSubmissionMeanMs: pair(sample => sample.drawSubmissionCpuMs.mean),
      ...(mode === 'natural' ? { rafP95Ms: pair(sample => sample.rafIntervalMs.p95),
        framesOver25Ms: pair(sample => sample.rafOver25Ms) } : {
        drawingAndReadbackMeanMs: pair(sample => sample.drawingAndReadbackMs.mean),
        drawingAndReadbackP95Ms: pair(sample => sample.drawingAndReadbackMs.p95) }),
      meanParticles: pair(sample => sample.particles.mean), particleDraws: pair(sample => sample.particleDraws),
      mainShadowDraws: pair(sample => sample.operations.measured.mainShadowDraws),
      totalShadowDrawsIncludingWarmup: pair(sample => Object.values(sample.operations)
        .reduce((sum, counts) => sum + counts.mainShadowDraws + counts.spriteShadowDraws, 0)),
      clearedBackingPixels: pair(sample => sample.operations.measured.clearedBackingPixels) };
  };
  report.comparison = { natural: comparison('natural'), fixed: comparison('fixed') };
  for (const sample of report.samples) {
    sample.populationSha256 = digest(JSON.stringify(sample.population));
    delete sample.population;
  }
  // Timing numbers are evidence to inspect, not a machine-dependent pass/fail
  // threshold. Correctness/parity checks above are strict on every machine.
}

app.whenReady().then(run).then(() => finish(), finish);
