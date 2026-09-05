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
const report = { checks: [], recordings: [], consoleErrors: [], skipped: [], output, sandbox };
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
  check('Chromium supports retaining old page snapshots', await evaluate(() => typeof document.startViewTransition === 'function'));

  async function record(name, theme, fn) {
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
          if (!/^(readerPageEnter|pageSlideNext|pageSlidePrev)$/.test(animation.animationName) || animation.playState !== 'running') continue;
          const native = animation.animationName === 'readerPageEnter';
          const style = native ? getComputedStyle(document.documentElement, '::view-transition-new(reader-page)') : getComputedStyle(animation.effect.target);
          const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
          const timing = animation.effect.getComputedTiming();
          window.__turnMotion.push({ name: animation.animationName, duration: timing.duration, progress: timing.progress, opacity: Number(style.opacity), x: matrix.m41,
            oldOpacity: native ? Number(getComputedStyle(document.documentElement, '::view-transition-old(reader-page)').opacity) : null });
        }
        window.__turnMotionFrame = requestAnimationFrame(sample);
      };
      window.__turnMotionFrame = requestAnimationFrame(sample);
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    });
    let done = false;
    let actionError;
    let actionResult;
    const action = evaluate(fn).then((result) => { actionResult = result; }).catch((error) => { actionError = error; }).finally(() => { done = true; });
    const started = Date.now();
    const screenshots = [];
    const previewFrames = [];
    const savePreview = ['txt-light-single-next', 'pdf-dark-single-next'].includes(name);
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
    report.recordings.push({ name, theme, samples, petSamples, overlaySamples, motion, screenshots, previewFrames });
    if (reducedMotion) {
      check(`${name}: reduced motion suppresses page effects`, motion.length === 0);
    } else if (actionResult !== false) {
      check(`${name}: a visible 320ms page effect actually runs`, motion.some((p) => p.duration === 320 && Math.abs(p.x) > 2 && p.progress > 0 && p.progress < 1));
      if (!name.includes('rapid') && /-(next|prev)$/.test(name)) {
        const direction = name.endsWith('-next') ? 1 : -1;
        check(`${name}: motion follows the page direction`, motion.every((p) => p.x * direction >= -.1));
      }
      const entering = motion.filter((p) => p.name === 'readerPageEnter');
      if (entering.length) {
        check(`${name}: new page fades in over opaque old paper`, entering.some((p) => p.opacity > .25 && p.opacity < .98) && entering.every((p) => p.oldOpacity === 1));
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
      return style.opacity === '1' && style.transform === 'none' && !document.documentElement.classList.contains('reader-page-turn');
    }));
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
        ['keyboard', () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return pageTurnQueue; }],
        ['wheel', () => { document.getElementById('reader-content').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); return pageTurnQueue; }],
      ]) {
        const before = await evaluate(() => __gaiaDebug.getPaginatorPage());
        await record(`txt-dark-${label}-next`, 'dark', input);
        check(`${label}: input turns exactly one spread`, await evaluate(() => __gaiaDebug.getPaginatorPage()) === before + 2);
      }
      const page = await evaluate(() => __gaiaDebug.getPaginatorPage());
      await record('txt-dark-rapid-next-next-prev', 'dark', () => Promise.all([__gaiaDebug.nextPage(), __gaiaDebug.nextPage(), __gaiaDebug.prevPage()]));
      check('Rapid turns preserve page order', await evaluate(() => __gaiaDebug.getPaginatorPage()) === page + 2);
      await evaluate(() => {
        window.__nativePageTransition = document.startViewTransition;
        document.startViewTransition = undefined;
      });
      await record('txt-dark-fallback', 'dark', () => __gaiaDebug.nextPage());
      const fallbackPage = await evaluate(() => __gaiaDebug.getPaginatorPage());
      await record('txt-dark-fallback-rapid', 'dark', () => Promise.all([__gaiaDebug.nextPage(), __gaiaDebug.nextPage(), __gaiaDebug.prevPage()]));
      check('Fallback rapid turns preserve order and complete their motion', await evaluate(() => __gaiaDebug.getPaginatorPage()) === fallbackPage + 2);
      await evaluate(() => {
        document.startViewTransition = (update) => {
          const transition = window.__nativePageTransition.call(document, update);
          transition.skipTransition();
          return transition;
        };
      });
      const skippedPage = await evaluate(() => __gaiaDebug.getPaginatorPage());
      await record('txt-dark-skipped-transition', 'dark', () => __gaiaDebug.nextPage());
      check('Skipped snapshots still animate without turning twice', await evaluate(() => __gaiaDebug.getPaginatorPage()) === skippedPage + 2);
      await evaluate(() => { document.startViewTransition = window.__nativePageTransition; });
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
        while (!activePageTransition) await new Promise((resolve) => setTimeout(resolve, 1));
        await activePageTransition.ready;
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
    const pending = p.render('<p>closed book</p>');
    p.destroy();
    await pending;
    const destroyed = !p.frame && !host.querySelector('iframe');
    host.remove();
    return retained && replaced && latestWon && destroyed;
  }));
  check('No renderer errors', report.consoleErrors.length === 0);
}

app.whenReady().then(async () => {
  await wait(300);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return finish(new Error('No application window'));
  run(win).then(() => finish(), finish);
});
require('../src/main');
