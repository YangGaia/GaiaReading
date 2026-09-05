'use strict';

// Electron integration test: records pixels during rendering, not only the final page.
// Uses isolated preferences and generated books; optional local MOBI/AZW3 files are read only.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-page-turn-'));
const output = path.resolve(process.env.GAIA_PAGE_TURN_OUTPUT || path.join(project, 'dist/page-turn-smoke'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light' }, pet: { auto: false, autoSpeech: false, autoSleep: false } }));
BrowserWindow.prototype.show = function () { this.showInactive(); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { checks: [], recordings: [], keyboard: [], holdCancellation: [], consoleErrors: [], skipped: [], output, sandbox };
let finished = false;
const timeout = setTimeout(() => finish(new Error('Page-turn smoke timed out')), 240000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, recordings: report.recordings.length, error: report.error, output }, null, 2));
  app.exit(error ? 1 : 0);
}
function check(name, value) { assert.ok(value, name); report.checks.push(name); }

const epubVariants = [];
const fixtures = (async () => {
  const text = '月光落在书页上，阅读继续。页面始终保持清晰，翻页时纸面的亮度保持稳定。 ';
  const txt = path.join(sandbox, 'page-turn.txt');
  fs.writeFileSync(txt, Array.from({ length: 240 }, (_, i) => `第 ${i + 1} 段 ${text.repeat(5)}`).join('\n\n'));
  const epub = path.join(sandbox, 'page-turn.epub');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">gaia-page-turn-test</dc:identifier><dc:title>翻页验证</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' + [0, 1, 2].map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join('') + '</manifest><spine>' + [0, 1, 2].map((n) => `<itemref idref="c${n}"/>`).join('') + '</spine></package>');
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="c0.xhtml">第一章</a></li><li><a href="c1.xhtml">第二章</a></li><li><a href="c2.xhtml">第三章</a></li></ol></nav></body></html>');
  for (let n = 0; n < 3; n += 1) zip.file(`OEBPS/c${n}.xhtml`, '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章节</title></head><body>' + Array.from({ length: 40 }, (_, i) => `<p>第 ${n + 1} 章 · ${i + 1} ${text.repeat(5)}</p>`).join('') + '</body></html>');
  fs.writeFileSync(epub, await zip.generateAsync({ type: 'nodebuffer' }));
  for (const variant of ['rtl', 'fixed']) {
    const clone = await JSZip.loadAsync(fs.readFileSync(epub));
    let opf = await clone.file('OEBPS/content.opf').async('string');
    if (variant === 'rtl') opf = opf.replace('<spine>', '<spine page-progression-direction="rtl">');
    else opf = opf.replace('</metadata>', '<meta property="rendition:layout">pre-paginated</meta></metadata>');
    clone.file('OEBPS/content.opf', opf);
    if (variant === 'fixed') for (let i = 0; i < 3; i += 1) {
      const html = await clone.file(`OEBPS/c${i}.xhtml`).async('string');
      clone.file(`OEBPS/c${i}.xhtml`, html.replace('<head>', '<head><meta name="viewport" content="width=600,height=800"/>'));
    }
    const file = path.join(sandbox, `page-turn-${variant}.epub`);
    fs.writeFileSync(file, await clone.generateAsync({ type: 'nodebuffer' }));
    epubVariants.push({ path: file, format: 'epub', label: variant });
  }
  const books = [{ path: txt, format: 'txt' }, { path: epub, format: 'epub' }, { path: path.join(project, 'tests/fixtures/sample.pdf'), format: 'pdf' }];
  for (const format of ['mobi', 'azw3']) {
    const file = fs.readdirSync(project).find((name) => name.includes('乔布斯') && name.endsWith('.' + format));
    if (file) books.push({ path: path.join(project, file), format });
    else report.skipped.push(`${format}: no optional local fixture`);
  }
  return books;
})();

function pixels(image, theme) {
  const bytes = image.toBitmap();
  let light = 0, ink = 0, bright = 0, count = 0;
  // BGRA; sample in two dimensions without resizing away the thin text strokes.
  const { width, height } = image.getSize();
  for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) {
    const i = (y * width + x) * 4;
    const l = (bytes[i] + bytes[i + 1] + bytes[i + 2]) / 3;
    light += l;
    if (theme === 'dark' ? l > 65 : l < 150) ink += 1;
    if (l > 220) bright += 1;
    count += 1;
  }
  return { light: light / count, ink: ink / count, bright: bright / count };
}

async function run(win) {
  win.setContentSize(1100, 760);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) report.consoleErrors.push(message);
  });
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  await evaluate(() => window.__gaiaDebug.waitHome());
  await evaluate(() => { window.__pageSnapshotCalls = 0; document.startViewTransition = () => { window.__pageSnapshotCalls += 1; throw new Error('Page turns must not capture snapshots'); }; });

  async function record(name, theme, fn) {
    const initialSize = await evaluate(() => ({ width: els.readerContent.clientWidth, height: els.readerContent.clientHeight }));
    const rect = await evaluate(() => {
      const r = document.getElementById('reader-content').getBoundingClientRect();
      return { x: Math.ceil(r.x + 48), y: Math.ceil(r.y + 30), width: Math.floor(r.width - 96), height: Math.floor(r.height - 60) };
    });
    const petProbe = await evaluate(() => {
      const pet = document.getElementById('gaia-pet');
      const face = pet.querySelector('.gaia-pet-face:not(.gaia-pet-blink-face)').getBoundingClientRect();
      const overlays = [...document.querySelectorAll('.gaia-pet-console, .gaia-pet-bubble')].filter((el) => !el.hidden && el.getClientRects().length).map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.classList[0], rect: { x: Math.max(0, Math.round(r.left + 8)), y: Math.max(0, Math.round(r.top + 8)), width: Math.max(1, Math.floor(Math.min(r.width - 16, innerWidth - r.left - 16))), height: Math.max(1, Math.floor(Math.min(r.height - 16, innerHeight - r.top - 16))) } };
      });
      return { rect: { x: Math.round(face.left + face.width * 0.2), y: Math.round(face.top + face.height * 0.25), width: Math.max(1, Math.floor(face.width * 0.6)), height: Math.max(1, Math.floor(face.height * 0.55)) }, width: pet.offsetWidth, height: pet.offsetHeight, opacity: getComputedStyle(pet).opacity, overlays };
    });
    const beforeScreen = await win.webContents.capturePage();
    const before = beforeScreen.crop(rect);
    const samples = [pixels(before, theme)];
    const petSamples = [pixels(beforeScreen.crop(petProbe.rect), theme)];
    const overlaySamples = petProbe.overlays.map((probe) => ({ name: probe.name, values: [pixels(beforeScreen.crop(probe.rect), theme).light] }));
    const reducedMotion = await evaluate(() => {
      window.__turnMotion = [];
      const sample = () => {
        for (const animation of document.getAnimations()) {
          if (animation.id !== 'reader-page-turn' || animation.playState !== 'running') continue;
          const style = getComputedStyle(animation.effect.target);
          const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
          const timing = animation.effect.getComputedTiming();
          window.__turnMotion.push({ at: performance.now(), startTime: animation.startTime, duration: timing.duration,
            progress: timing.progress, opacity: Number(style.opacity), x: matrix.m41,
            width: els.readerContent.clientWidth, height: els.readerContent.clientHeight });
        }
        window.__turnMotionFrame = requestAnimationFrame(sample);
      };
      window.__turnMotionFrame = requestAnimationFrame(sample);
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    });
    let done = false;
    let actionError;
    let actionResult;
    const action = evaluate(fn).then(async (result) => {
      actionResult = result;
      // Observe the entire visual effect; the production page promise only waits
      // for content, so it cannot accidentally make this test pass by blocking input.
      await evaluate(async () => {
        const effects = document.getAnimations().filter((animation) => animation.id === 'reader-page-turn');
        await Promise.all(effects.map((animation) => animation.finished.catch(() => {})));
      });
    }).catch((error) => { actionError = error; }).finally(() => { done = true; });
    const started = Date.now();
    const screenshots = [];
    const previewFrames = [];
    const savePreview = ['txt-light-single-next', 'pdf-dark-single-next', 'txt-dark-tap-and-release-next', 'txt-dark-rapid-taps', 'txt-dark-hold-and-reverse'].includes(name);
    if (savePreview) {
      const target = path.join(output, `${name}-frame-000.png`);
      fs.writeFileSync(target, before.toPNG());
      previewFrames.push({ path: target, at: 0 });
    }
    do {
      const screen = await win.webContents.capturePage();
      const image = screen.crop(rect);
      samples.push(pixels(image, theme));
      petSamples.push(pixels(screen.crop(petProbe.rect), theme));
      petProbe.overlays.forEach((probe, index) => overlaySamples[index].values.push(pixels(screen.crop(probe.rect), theme).light));
      if (savePreview) {
        const target = path.join(output, `${name}-frame-${String(previewFrames.length).padStart(3, '0')}.png`);
        fs.writeFileSync(target, image.toPNG());
        previewFrames.push({ path: target, at: Date.now() - started });
      }
      if (samples.length === 3 || samples.length === 7) {
        const target = path.join(output, `${name}-${samples.length}.png`);
        fs.writeFileSync(target, image.toPNG());
        screenshots.push(target);
        fs.writeFileSync(path.join(output, `${name}-pet-${samples.length}.png`), screen.crop(petProbe.rect).toPNG());
      }
      await wait(16);
      if (Date.now() - started > 12000) throw new Error(`${name}: turn never completed`);
    } while (!done || Date.now() - started < 80);
    await action;
    const motion = await evaluate(() => { cancelAnimationFrame(window.__turnMotionFrame); return window.__turnMotion; });
    if (actionError) throw actionError;
    const lastScreen = await win.webContents.capturePage();
    const last = lastScreen.crop(rect);
    samples.push(pixels(last, theme));
    petSamples.push(pixels(lastScreen.crop(petProbe.rect), theme));
    petProbe.overlays.forEach((probe, index) => overlaySamples[index].values.push(pixels(lastScreen.crop(probe.rect), theme).light));
    const baseline = Math.min(samples[0].ink, samples.at(-1).ink);
    const finalSize = await evaluate(() => ({ width: els.readerContent.clientWidth, height: els.readerContent.clientHeight }));
    report.recordings.push({ name, theme, samples, petSamples, overlaySamples, motion, screenshots, previewFrames });
    if (reducedMotion) {
      check(`${name}: reduced motion suppresses page effects`, motion.length === 0);
    } else if (actionResult !== false) {
      check(`${name}: a visible 160ms page effect actually runs`, motion.some((p) => p.duration === 160 && Math.abs(p.x) > 2 && p.progress > 0 && p.progress < 1));
      check(`${name}: every page effect stays short and within 20px`, motion.every((p) => p.duration === 160 && Math.abs(p.x) <= 20.1));
      check(`${name}: incoming text stays opaque without crossfade ghosting`, motion.every((p) => p.opacity === 1));
      check(`${name}: moving paper does not create transient scrollbars`, motion.every((p) => ['width', 'height'].every((key) => p[key] >= Math.min(initialSize[key], finalSize[key]) && p[key] <= Math.max(initialSize[key], finalSize[key]))));
      check(`${name}: animation frames continue without stalls over 50ms`, motion.every((p, i) => i === 0 || p.startTime !== motion[i - 1].startTime || p.at - motion[i - 1].at < 50));
      if (!name.includes('rapid') && /-(next|prev)$/.test(name)) {
        const direction = name.endsWith('-next') ? 1 : -1;
        check(`${name}: motion follows the page direction`, motion.every((p) => p.x * direction >= -.1));
      }

    }
    const minPetLight = Math.min(petSamples[0].light, petSamples.at(-1).light) - 25;
    const maxPetLight = Math.max(petSamples[0].light, petSamples.at(-1).light) + 25;
    check(`${name}: pet stays visible without flashing`, petSamples.every((p) => p.light >= minPetLight && p.light <= maxPetLight));
    for (const overlay of overlaySamples) {
      const low = Math.min(overlay.values[0], overlay.values.at(-1)) - 15;
      const high = Math.max(overlay.values[0], overlay.values.at(-1)) + 15;
      check(`${name}: ${overlay.name} stays visible`, overlay.values.every((light) => light >= low && light <= high));
    }
    check(`${name}: pet size and opacity are preserved`, await evaluate((probe) => {
      const pet = document.getElementById('gaia-pet');
      return !pet.hidden && pet.offsetWidth === probe.width && pet.offsetHeight === probe.height && getComputedStyle(pet).opacity === probe.opacity;
    }, petProbe));
    check(`${name}: no animation-frame deadlock`, Date.now() - started < 2500);
    check(`${name}: captured intermediate frames`, samples.length >= 4);
    if (baseline > 0.0001) check(`${name}: no empty content frame`, samples.every((p) => p.ink >= baseline * 0.35));
    if (theme === 'dark') check(`${name}: no bright flash`, samples.every((p) => p.light < Math.max(samples[0].light, samples.at(-1).light) + 20));
    if (theme === 'eye') check(`${name}: paper does not flash white`, samples.every((p) => p.bright < Math.max(samples[0].bright, samples.at(-1).bright) + 0.08));
    check(`${name}: background remains opaque and stationary`, await evaluate(() => {
      const content = document.getElementById('reader-content');
      const style = getComputedStyle(content);
      return style.opacity === '1' && style.transform === 'none';
    }));
  }

  async function checkKeyboardResponse(format) {
    const result = await evaluate(async () => {
      __gaiaDebug.setMode('single');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const position = () => {
        const c = state.current;
        if (c.format === 'pdf') return String(c.page);
        if (c.paginator) return `${c.flow ? c.flow.chapter : 0}:${c.paginator.currentPage}`;
        const manager = c.rendition.manager;
        return JSON.stringify([manager.views.all().filter((view) => !view.element.classList.contains('is-preparing')).map((view) => view.section.index), manager.container.scrollLeft, manager.container.scrollTop]);
      };
      const send = (type, key, repeat = false) => {
        // Exercise the real content-document bindings as well as the outer UI.
        const frame = document.querySelector('#reader-content iframe');
        const target = frame ? frame.contentDocument : document;
        target.dispatchEvent(new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true }));
      };
      const originalNext = advancePage, originalPrev = retreatPage;
      let calls = [];
      advancePage = async (...args) => { const before = position(); const moved = await originalNext(...args); calls.push({ direction: 'next', at: performance.now(), moved, before, after: position() }); return moved; };
      retreatPage = async (...args) => { const before = position(); const moved = await originalPrev(...args); calls.push({ direction: 'prev', at: performance.now(), moved, before, after: position() }); return moved; };
      try {
        send('keydown', 'ArrowRight');
        await pageTurnQueue;
        const tapAnimation = activePageAnimation;
        await pause(20);
        send('keyup', 'ArrowRight');
        const survivesRelease = tapAnimation === activePageAnimation && tapAnimation.playState === 'running';
        const releasedAt = tapAnimation.currentTime;
        await pause(40);
        const advancesAfterRelease = tapAnimation.currentTime > releasedAt;
        await tapAnimation.finished;
        const tap = { survivesRelease, advancesAfterRelease, duration: tapAnimation.effect.getComputedTiming().duration };
        send('keydown', 'ArrowLeft');
        send('keyup', 'ArrowLeft');
        await pageTurnQueue;
        if (activePageAnimation) await activePageAnimation.finished;
        calls = [];
        const before = position();
        const directions = Array.from({ length: 12 }, (_, i) => i % 4 < 2 ? 'next' : 'prev');
        const started = performance.now();
        for (const direction of directions) {
          const key = direction === 'next' ? 'ArrowRight' : 'ArrowLeft';
          send('keydown', key);
          await pause(18);
          send('keyup', key);
          await pause(42);
        }
        const released = performance.now();
        await pageTurnQueue;
        const rapid = { expected: directions, directions: calls.map((call) => call.direction),
          firstResponseMs: calls[0].at - started, tailMs: performance.now() - released,
          before, after: position(), trace: calls.slice() };
        calls = [];
        const holdStarted = performance.now();
        send('keydown', 'ArrowRight');
        const holdMotion = [];
        // No synthetic OS repeats: the software's hold mapping must drive this.
        for (let i = 0; i < 40; i += 1) {
          await pause(20);
          if (i > 10 && activePageAnimation && activePageAnimation.playState === 'running') {
            const style = getComputedStyle(activePageAnimation.effect.target);
            holdMotion.push({ x: new DOMMatrixReadOnly(style.transform).m41, opacity: style.opacity });
          }
        }
        send('keyup', 'ArrowRight');
        const atRelease = calls.length;
        const releasedPage = position();
        const releasedMoves = calls.filter((call) => call.moved !== false).length;
        const elapsed = performance.now() - holdStarted;
        await pageTurnQueue;
        const afterCurrentTurn = calls.length;
        const stoppedPage = position();
        await pause(300);
        const hold = { atRelease, afterCurrentTurn, releasedMoves, finalMoves: calls.filter((call) => call.moved !== false).length,
          elapsed, motion: holdMotion, finalCalls: calls.length, releasedPage, stoppedPage, finalPage: position() };
        calls = [];
        send('keydown', 'ArrowLeft');
        await pause(320);
        send('keydown', 'ArrowRight');
        send('keyup', 'ArrowLeft');
        const switchedAt = calls.length;
        await pause(320);
        send('keyup', 'ArrowRight');
        await pageTurnQueue;
        const reverse = calls.slice(switchedAt).filter((call) => call.moved !== false).map((call) => call.direction);
        return { tap, rapid, hold, reverse };
      } finally {
        stopHeldPageKey();
        advancePage = originalNext;
        retreatPage = originalPrev;
      }
    });
    report.keyboard.push({ format, ...result });
    check(`${format}: a full visible animation survives key release`, result.tap.survivesRelease && result.tap.advancesAfterRelease && result.tap.duration === 160);
    check(`${format}: rapid separate presses preserve every direction`, JSON.stringify(result.rapid.directions) === JSON.stringify(result.rapid.expected));
    check(`${format}: alternating keys return to the same page`, result.rapid.before === result.rapid.after);
    check(`${format}: first key responds within 150ms`, result.rapid.firstResponseMs < 150);
    check(`${format}: rapid input has no accumulated animation delay`, result.rapid.tailMs < 250);
    check(`${format}: holding the key continues turning`, result.hold.atRelease > 1);
    if (format === 'txt') {
      check('TXT: automatic hold runs near 30 turns/sec without OS repeats', result.hold.atRelease >= 17 && result.hold.atRelease <= Math.ceil((result.hold.elapsed - 200) / (1000 / 30)) + 2);
      check('TXT: high-speed hold retains visible opaque animation', result.hold.motion.length >= 15 && result.hold.motion.some((frame) => Math.abs(frame.x) > 2) && result.hold.motion.every((frame) => frame.opacity === '1'));
    }
    check(`${format}: key release leaves no queued repeats`, result.hold.afterCurrentTurn <= result.hold.atRelease + 1);
    check(`${format}: release prevents all uncommitted automatic moves`, result.hold.releasedMoves === result.hold.finalMoves && result.hold.releasedPage === result.hold.stoppedPage);
    check(`${format}: no autonomous turns after release`, result.hold.finalCalls === result.hold.afterCurrentTurn && result.hold.finalPage === result.hold.stoppedPage);
    check(`${format}: direction switch invalidates old holds and ignores old key release`, result.reverse.length > 1 && result.reverse.every((direction) => direction === 'next'));
  }

  async function checkHoldCancellation(format) {
    if (format === 'txt') return;
    const result = await evaluate(async () => {
      const c = state.current;
      __gaiaDebug.setMode('single');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (c.format === 'epub') {
        await c.rendition.display('c0.xhtml');
        // Let epub.js finish the resize triggered by the content/theme hooks
        // before positioning the fixture at its penultimate page.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const manager = c.rendition.manager;
        manager.scrollTo(manager.container.scrollWidth - 2 * manager.layout.delta, 0, true);
      } else if (c.paginator) {
        await loadMobiChapter(10, { page: 0 });
        c.paginator.showPage(c.paginator.totalPages - 2);
      } else {
        await renderPdfPage({ page: 1 });
      }
      const send = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: 'ArrowRight', bubbles: true }));
      send('keydown');
      await pageTurnQueue;
      if (c.rendition && c.rendition.q.running && c.rendition.q.defered) await c.rendition.q.defered.promise;
      const position = () => c.paginator ? `${c.flow.chapter}:${c.flow.page}:${c.paginator.currentPage}` :
        c.format === 'pdf' ? JSON.stringify([c.page, c.pdfVisiblePages]) :
          JSON.stringify([c.rendition.manager.views.all().filter((view) => !view.element.classList.contains('is-preparing')).map((view) => view.section.index), c.rendition.manager.container.scrollLeft, c.rendition.manager.container.scrollTop]);
      const saved = () => JSON.stringify(state.progress[c.path]);
      const before = position(), beforeSaved = saved();
      const old = els.readerContent.querySelector('iframe, .pdf-spread');
      let release, entered;
      const gate = new Promise((resolve) => { release = resolve; });
      const started = new Promise((resolve) => { entered = resolve; });
      const restore = [];
      if (c.format === 'epub') {
        const manager = c.rendition.manager, append = manager.append;
        manager.append = (...args) => {
          const displaying = append.apply(manager, args);
          entered();
          return Promise.all([displaying, gate]).then(([view]) => view);
        };
        restore.push(() => { manager.append = append; });
      } else if (c.paginator) {
        const render = c.paginator.render;
        c.paginator.render = async (...args) => { entered(); await gate; return render.apply(c.paginator, args); };
        restore.push(() => { c.paginator.render = render; });
      } else {
        const getPage = c.pdf.getPage;
        c.pdf.getPage = async (...args) => {
          const page = await getPage.apply(c.pdf, args), render = page.render;
          page.render = (...renderArgs) => {
            const task = render.apply(page, renderArgs);
            entered();
            return { promise: Promise.all([task.promise, gate]) };
          };
          restore.push(() => { page.render = render; });
          return page;
        };
        restore.push(() => { c.pdf.getPage = getPage; });
      }
      try {
        await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('Hold never started delayed preparation')), 3000))]);
        await new Promise((resolve) => setTimeout(resolve, 80));
        const retainedDuringLoad = old.isConnected;
        const during = position(), duringSaved = saved();
        send('keyup');
        release();
        await pageTurnQueue;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { before, during, after: position(), beforeSaved, duringSaved, afterSaved: saved(), retainedDuringLoad,
          oldStillVisible: old.isConnected, preparing: !!els.readerContent.querySelector('.is-preparing, .paginator-pending') };
      } finally {
        stopHeldPageKey();
        release();
        restore.forEach((fn) => fn());
      }
    });
    report.holdCancellation.push({ format, ...result });
    check(`${format}: delayed hold preserves painted page during and after release`, result.retainedDuringLoad && result.oldStillVisible);
    check(`${format}: delayed hold never changes page or progress after release`, result.before === result.during && result.before === result.after && result.beforeSaved === result.duringSaved && result.beforeSaved === result.afterSaved);
    check(`${format}: cancelled hold cleans every prepared page`, !result.preparing);
  }

  for (const book of await fixtures) {
    await evaluate((b) => __gaiaDebug.openBook({ ...b, title: '翻页验证' }), book);
    await evaluate(async () => {
      await GaiaPet.whenReady();
      const pet = document.getElementById('gaia-pet');
      pet.style.left = Math.round((innerWidth - pet.offsetWidth) / 2) + 'px';
      pet.style.top = '180px';
    });
    if (book.format === 'mobi' || book.format === 'azw3') await evaluate(() => __gaiaDebug.jumpToMobiChapter(10));
    for (const theme of ['light', 'eye', 'dark']) for (const mode of ['single', 'spread']) {
      await evaluate(async ({ theme, mode }) => {
        await __gaiaDebug.setTheme(theme);
        __gaiaDebug.setMode(mode);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }, { theme, mode });
      const prefix = `${book.format}-${theme}-${mode}`;
      await record(prefix + '-next', theme, () => __gaiaDebug.nextPage());
      await record(prefix + '-prev', theme, () => __gaiaDebug.prevPage());
    }
    console.log(`PAGE_TURN: ${book.format} theme/mode matrix passed`);

    if (book.format === 'epub') {
      await evaluate(async () => {
        __gaiaDebug.setMode('single');
        await state.current.rendition.display('c0.xhtml');
        const manager = state.current.rendition.manager;
        manager.scrollTo(manager.container.scrollWidth - manager.layout.delta, 0, true);
        const request = manager.request;
        manager.request = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 180)); return request(...args); };
      });
      await record('epub-dark-chapter-next-delayed', 'dark', () => __gaiaDebug.nextPage());
      check('EPUB forward crossed chapter', await evaluate(() => state.current.rendition.manager.views.first().section.index === 1));
      await record('epub-dark-chapter-prev-delayed', 'dark', () => __gaiaDebug.prevPage());
      check('EPUB backward crossed chapter', await evaluate(() => state.current.rendition.manager.views.first().section.index === 0));
    }
    if (book.format === 'pdf') {
      await evaluate(() => {
        const pdf = state.current.pdf;
        const getPage = pdf.getPage.bind(pdf);
        pdf.getPage = async (...args) => {
          const page = await getPage(...args);
          if (!page.__delayTest) {
            page.__delayTest = true;
            const render = page.render.bind(page);
            page.render = (options) => ({ promise: new Promise((resolve) => setTimeout(resolve, 180)).then(() => render(options).promise) });
          }
          return page;
        };
      });
      await record('pdf-dark-slow-canvas', 'dark', () => __gaiaDebug.nextPage());
      check('PDF preparation nodes removed', await evaluate(() => document.querySelectorAll('.pdf-spread').length === 1 && !document.querySelector('.is-preparing')));
      check('Preparing a larger PDF page preserves old content and scrollbars', await evaluate(async () => {
        const host = document.getElementById('reader-content');
        const old = host.querySelector('.pdf-spread');
        const width = host.scrollWidth, height = host.scrollHeight;
        state.current.zoom = 4;
        state.current.pdfZoomMode = 'manual';
        const pending = renderPdfPage();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const stable = old.isConnected && host.scrollWidth === width && host.scrollHeight === height && !!host.querySelector('.is-preparing');
        await pending;
        return stable && !old.isConnected && !host.querySelector('.is-preparing');
      }));
    }
    if (book.format === 'mobi' || book.format === 'azw3') {
      await evaluate(() => __gaiaDebug.showPaginatorLastPage());
      const chapter = await evaluate(() => __gaiaDebug.getMobiIndex());
      await record(`${book.format}-dark-chapter-next`, 'dark', () => __gaiaDebug.nextPage());
      check(`${book.format}: forward crossed chapter`, await evaluate(() => __gaiaDebug.getMobiIndex()) === chapter + 1);
      await record(`${book.format}-dark-chapter-prev`, 'dark', () => __gaiaDebug.prevPage());
      check(`${book.format}: backward crossed chapter`, await evaluate(() => __gaiaDebug.getMobiIndex()) === chapter);
    }
    if (book.format === 'txt') {
      for (const [label, input] of [
        ['button', () => { document.getElementById('btn-next-page').click(); return pageTurnQueue; }],
        ['keyboard', () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); return pageTurnQueue; }],
        ['wheel', () => { document.getElementById('reader-content').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); return pageTurnQueue; }],
      ]) {
        const before = await evaluate(() => __gaiaDebug.getPaginatorPage());
        await record(`txt-dark-${label}-next`, 'dark', input);
        check(`${label}: input turns exactly one spread`, await evaluate(() => __gaiaDebug.getPaginatorPage()) === before + 2);
      }
      const page = await evaluate(() => __gaiaDebug.getPaginatorPage());
      await record('txt-dark-rapid-next-next-prev', 'dark', () => Promise.all([__gaiaDebug.nextPage(), __gaiaDebug.nextPage(), __gaiaDebug.prevPage()]));
      check('Rapid turns preserve page order', await evaluate(() => __gaiaDebug.getPaginatorPage()) === page + 2);
      await record('txt-dark-tap-and-release-next', 'dark', async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
        await pageTurnQueue;
      });
      await record('txt-dark-rapid-taps', 'dark', async () => {
        for (let i = 0; i < 8; i += 1) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        await pageTurnQueue;
      });
      await record('txt-dark-hold-and-reverse', 'dark', async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 450));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
        await pageTurnQueue;
      });
      for (const [width, height] of [[800, 600], [1600, 1000]]) {
        win.setContentSize(width, height);
        await wait(200);
        await record(`txt-dark-${width}x${height}`, 'dark', () => __gaiaDebug.nextPage());
      }
      win.setContentSize(1100, 760);
      await wait(200);
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await record('txt-dark-reduced-motion', 'dark', () => __gaiaDebug.nextPage());
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      win.webContents.debugger.detach();
      for (const [label, value, name] of [['透明度', '0.4', 'opacity40'], ['阅读页', 'dim', 'reader-dim'], ['尺寸', '1.5', 'scale150']]) {
        await evaluate(({ label, value }) => {
          for (const [key, setting] of [['透明度', '1'], ['阅读页', 'normal'], ['尺寸', '1'], [label, value]]) {
            const row = [...document.querySelectorAll('.gaia-pet-console-select-row')].find((el) => el.querySelector('span').textContent === key);
            const select = row.querySelector('select');
            select.value = setting;
            select.dispatchEvent(new Event('change'));
          }
          const pet = document.getElementById('gaia-pet');
          pet.style.left = '450px';
          pet.style.top = '180px';
        }, { label, value });
        await wait(220);
        await record(`txt-dark-pet-${name}`, 'dark', () => __gaiaDebug.nextPage());
      }
      await evaluate(() => {
        const row = [...document.querySelectorAll('.gaia-pet-console-select-row')].find((el) => el.querySelector('span').textContent === '尺寸');
        row.querySelector('select').value = '1';
        row.querySelector('select').dispatchEvent(new Event('change'));
        GaiaPet.speak('翻页时，我仍然在这里。', 10000);
        GaiaPet.openConsole();
      });
      await wait(220);
      await record('txt-dark-pet-console-and-bubble', 'dark', () => __gaiaDebug.nextPage());
      await evaluate(() => GaiaPet.closeConsole());

      const dragProbe = await evaluate(async () => {
        const pet = document.getElementById('gaia-pet');
        pet.style.left = '350px';
        pet.style.top = '180px';
        window.__petDragTurn = __gaiaDebug.nextPage();
        while (!activePageAnimation) await new Promise((resolve) => setTimeout(resolve, 1));
        await activePageAnimation.ready;
        const r = pet.getBoundingClientRect();
        const pointer = { pointerId: 91, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: r.left + 75, clientY: r.top + 100, bubbles: true };
        pet.querySelector('.gaia-pet-hitbox').dispatchEvent(new PointerEvent('pointerdown', pointer));
        window.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: pointer.clientX + 220 }));
        const face = pet.querySelector('.gaia-pet-face:not(.gaia-pet-blink-face)').getBoundingClientRect();
        return { x: Math.round(face.left + face.width * 0.2), y: Math.round(face.top + face.height * 0.25), width: Math.floor(face.width * 0.6), height: Math.floor(face.height * 0.55) };
      });
      await wait(30);
      const dragImage = await win.webContents.capturePage(dragProbe);
      fs.writeFileSync(path.join(output, 'pet-drag-during-page-turn.png'), dragImage.toPNG());
      check('Pet visibly follows dragging during a page turn', pixels(dragImage, 'dark').light > 100);
      await evaluate(async () => {
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 91 }));
        await window.__petDragTurn;
      });
    }
    // PDF's deliberately delayed canvas fixture belongs to the separate loading
    // regression above; restore its normal renderer for keyboard latency checks.
    if (book.format === 'pdf') {
      await evaluate((b) => __gaiaDebug.openBook({ ...b, title: '翻页验证' }), book);
    }
    await checkKeyboardResponse(book.format);
    await checkHoldCancellation(book.format);
    await evaluate(() => __gaiaDebug.backToLibrary());
  }

  for (const book of epubVariants) {
    await evaluate((b) => __gaiaDebug.openBook({ ...b, title: '章节方向验证' }), book);
    await evaluate(() => __gaiaDebug.setTheme('dark'));
    for (const mode of ['single', 'spread']) {
      await evaluate(async (mode) => {
        __gaiaDebug.setMode(mode);
        await new Promise((resolve) => setTimeout(resolve, 250));
        await state.current.rendition.display('c1.xhtml');
      }, mode);
      await record(`epub-${book.label}-${mode}-chapter-prev`, 'dark', () => __gaiaDebug.prevPage());
      check(`${book.label}/${mode}: backward chapter is correct`, await evaluate(() => state.current.rendition.manager.views.first().section.index === 0));
      await record(`epub-${book.label}-${mode}-chapter-next`, 'dark', () => __gaiaDebug.nextPage());
      check(`${book.label}/${mode}: forward chapter is correct`, await evaluate(() => state.current.rendition.manager.views.first().section.index === 1));
      check(`${book.label}/${mode}: no abandoned preparing view`, await evaluate(() => !document.querySelector('.epub-view.is-preparing')));
    }
    await evaluate(() => __gaiaDebug.backToLibrary());
  }

  // Exercise a pending iframe independently, including supersession and teardown.
  check('Paginator retains old page until replacement is ready', await evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;width:800px;height:500px;visibility:hidden';
    document.body.appendChild(host);
    const p = new GaiaPaginator(host, { pageWidth: 640 });
    p.setTheme('dark');
    await p.render('<p>old chapter</p>');
    const old = p.frame;
    const next = p.render('<p>new chapter</p>');
    const retained = old.isConnected && p.frame === old && !!host.querySelector('.paginator-pending');
    await next;
    const replaced = !old.isConnected && p.doc.body.textContent === 'new chapter' && getComputedStyle(p.doc.body).backgroundColor === 'rgb(0, 0, 0)';
    const stale = p.render('<p>stale</p>');
    const latest = p.render('<p>latest</p>');
    await Promise.all([stale, latest]);
    const latestWon = p.doc.body.textContent === 'latest' && host.querySelectorAll('iframe').length === 1;
    let held = true, committed = false;
    const cancelled = p.render('<p>cancelled hold</p>', '', { isCurrent: () => held, beforeCommit: () => { committed = true; } });
    held = false;
    const cancelledResult = await cancelled;
    const heldPageRetained = cancelledResult === false && !committed && p.doc.body.textContent === 'latest' && host.querySelectorAll('iframe').length === 1 && !p._pendingFrame;
    const pending = p.render('<p>closed book</p>');
    p.destroy();
    await pending;
    const destroyed = !p.frame && !host.querySelector('iframe');
    host.remove();
    return retained && replaced && latestWon && heldPageRetained && destroyed;
  }));
  check('Page turning never uses snapshot transitions', await evaluate(() => window.__pageSnapshotCalls === 0));
  check('No renderer errors', report.consoleErrors.length === 0);
}

app.whenReady().then(async () => {
  await wait(300);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return finish(new Error('No application window'));
  run(win).then(() => finish(), finish);
});
require('../src/main');
