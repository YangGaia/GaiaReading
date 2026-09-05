'use strict';

// Standalone design verification. Never loads src/main.js or the app preload.
// Run: .\node_modules\.bin\electron.cmd scripts/home-preview-smoke.js
const { app, BrowserWindow, nativeImage } = require('electron');
const { makeMatte } = require('./home-preview-matte');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'docs/design/home/index.html');
const output = path.resolve(process.env.GAIA_HOME_PREVIEW_OUTPUT || path.join(root, 'dist/home-preview'));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-home-preview-'));
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
fs.mkdirSync(output, { recursive: true });

const report = { entry, output, sandbox, checks: [], screenshots: [], fonts: [], errors: [], blockedRequests: [] };
let win;
let finished = false;
const timeout = setTimeout(() => finish(new Error('Home preview check timed out')), 120000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, output, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}
function check(name, result) { assert.ok(result, name); report.checks.push(name); }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = async (fn, ...args) => {
  const result = await win.webContents.executeJavaScript(`(async () => {
    try { return { value: await (${fn.toString()})(...${JSON.stringify(args)}) }; }
    catch (error) { return { error: error.stack || String(error) }; }
  })()`);
  if (result.error) throw new Error(result.error);
  return result.value;
};
async function settle() {
  await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function capture(name, fullPage = false) {
  await settle();
  const target = path.join(output, name + '.png');
  if (fullPage) {
    const { contentSize } = await win.webContents.debugger.sendCommand('Page.getLayoutMetrics');
    const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 },
    });
    fs.writeFileSync(target, Buffer.from(data, 'base64'));
  } else fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
  report.screenshots.push(target);
}

async function validatePlatformFont(selector) {
  const { root: document } = await win.webContents.debugger.sendCommand('DOM.getDocument');
  const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.nodeId, selector });
  assert.ok(nodeId, `Font sample ${selector} exists`);
  const { fonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
  const used = fonts.filter((font) => font.glyphCount > 0);
  check(`${selector} actually renders with Noto Sans SC`, used.length > 0 && used.every((font) => /Noto Sans SC/i.test(font.familyName)));
  report.fonts.push({ selector, fonts: used });
}

async function resize(width, height, zoom = 1) {
  win.setContentSize(width, height);
  win.webContents.setZoomFactor(zoom);
  await pause(30);
  await settle();
  const actual = await evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(Math.abs(actual.width - width / zoom) <= 1 && Math.abs(actual.height - height / zoom) <= 1,
    `Viewport did not resize to ${width}x${height} at ${zoom}: ${JSON.stringify(actual)}`);
}

async function verifyKeyboard(name) {
  win.webContents.focus();
  const expected = await evaluate(() => {
    scrollTo(0, 0);
    document.body.tabIndex = -1;
    document.body.focus();
    return [...document.querySelectorAll('button, input, a')].map((el) => el.id || el.getAttribute('aria-label') || el.textContent.trim());
  });
  const seen = [];
  for (const label of expected) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await pause(20);
    const result = await evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        label: el.id || el.getAttribute('aria-label') || el.textContent.trim(),
        focus: el.matches(':focus-visible') && parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none',
        exposed: r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit)),
      };
    });
    assert.equal(result.label, label, `Tab order in ${name}`);
    assert.ok(result.focus && result.exposed, `Focus must be visible for ${label} in ${name}`);
    seen.push(label);
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] });
  await pause(20);
  check(`forward and reverse keyboard navigation ${name}`, await evaluate(() => document.activeElement.id === 'preview-settings'));
  report.checks.push({ name: `all controls have visible keyboard focus ${name}`, controls: seen });
  await evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1100, height: 760, useContentSize: true, show: false,
    autoHideMenuBar: true, backgroundColor: '#111419',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith('file://');
    if (!allowed) report.blockedRequests.push(details.url);
    callback({ cancel: !allowed });
  });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  await win.loadFile(entry);
  win.showInactive();
  await evaluate(async () => {
    await document.fonts.load('500 36px "Gaia Noto"', 'Gaia Reading 进入书架');
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
  });
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('DOM.enable');
  await win.webContents.debugger.sendCommand('CSS.enable');
  await validatePlatformFont('#home-title');
  await validatePlatformFont('#preview-shelf > span');

  check('preview has no production runtime, preload, audio or form actions', await evaluate(() =>
    typeof window.api === 'undefined' && typeof window.__gaiaDebug === 'undefined' &&
    !document.querySelector('script, audio, video, iframe, form') && document.forms.length === 0
  ));
  check('all three character images decode successfully', await evaluate(() => document.images.length === 3 && [...document.images].every((img) => img.complete && img.naturalWidth > 0)));
  check('existing portrait source and original dimensions are preserved', await evaluate(() => {
    const img = document.getElementById('alice-art');
    return img.src.endsWith('/src/renderer/images/1.jpg') && img.naturalWidth === 1200 && img.naturalHeight === 1200;
  }));
  const source = nativeImage.createFromPath(path.join(root, 'src/renderer/images/1.jpg'));
  const matte = nativeImage.createFromPath(path.join(root, 'docs/design/home/assets/alice-matte.png'));
  check('silhouette matte is reproducible from the homepage image',
    !matte.isEmpty() && matte.toBitmap().equals(makeMatte(source).toBitmap()));
  const mattePixels = matte.toBitmap();
  const alpha = (x, y) => mattePixels[(y * 1200 + x) * 4 + 3];
  check('only outer white is removed; face, hat, dress and teal field remain opaque',
    [[0, 0], [50, 500], [1150, 500], [1150, 1150]].every(([x, y]) => alpha(x, y) === 0) &&
    [[620, 500], [760, 450], [600, 30], [600, 1000], [200, 200]].every(([x, y]) => alpha(x, y) === 255));
  check('portrait uses the silhouette matte without elliptical fading or dimming', await evaluate(async () => {
    const style = getComputedStyle(document.getElementById('alice-art'));
    const url = style.maskImage.match(/^url\("?([^"\)]+)"?\)$/)?.[1];
    if (!url || !url.endsWith('/assets/alice-matte.png')) return false;
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth === 1200 && img.naturalHeight === 1200 &&
      style.filter === 'none' && style.opacity === '1' && style.clipPath === 'none';
  }));
  check('artwork frame keeps a constant stroke width while the illustration scales', await evaluate(() =>
    getComputedStyle(document.querySelector('.portrait-lines path')).vectorEffect === 'non-scaling-stroke'
  ));
  check('design credit has its own safe browser target', await evaluate(() => {
    const link = document.querySelector('.design-credit');
    return link.href === 'https://deerflow.tech/' && link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer');
  }));

  await evaluate(() => {
    const fail = (condition, message) => { if (!condition) throw new Error(message); };
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const box = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data];
      return [channels[0], channels[1], channels[2], channels[3] / 255];
    };
    const composite = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = (color) => color.map((c) => {
      const v = c / 255;
      return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    window.__previewChecks = {
      layout(requireFit = false) {
        scrollTo(0, 0);
        const root = document.documentElement;
        fail(root.scrollWidth <= root.clientWidth, `Horizontal overflow: viewport ${root.clientWidth}, document ${root.scrollWidth}`);
        if (requireFit) fail(root.scrollHeight <= innerHeight, `Unexpected vertical scrollbar at ${innerWidth}x${innerHeight}: ${root.scrollHeight}`);
        const copy = box('.home-copy');
        const portrait = box('.portrait');
        const art = box('#alice-art');
        const companion = box('#alice-companion');
        const music = box('.music-player');
        fail(!overlaps(copy, portrait), 'Controls and portrait must occupy separate regions');
        fail(!overlaps(portrait, companion), 'Desktop pet must have its own space');
        fail(!overlaps(portrait, music), 'Music controls must not cover the portrait');
        fail(art.width > 0 && Math.abs(art.width - art.height) < 1, 'Square original must retain its aspect ratio');
        fail(art.left >= 0 && art.right <= root.clientWidth && art.top >= 0 && art.bottom <= root.scrollHeight, 'Portrait must fit in the document');
        fail(getComputedStyle(document.querySelector('.home-preview')).overflowY !== 'hidden', 'Short layouts must allow scrolling');
        const all = [...document.querySelectorAll('button, input, a')].filter(visible);
        fail(all.length === 9, 'All four entries, music controls, volume and credit must remain available');
        for (const el of all) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r = el.getBoundingClientRect();
          const name = el.id || el.getAttribute('aria-label') || el.textContent.trim();
          fail(r.width >= 24 && r.height >= 24, `Small pointer target: ${name}`);
          fail(r.left >= 6 && r.right <= root.clientWidth - 6 && r.top >= 0 && r.bottom <= innerHeight, `Control cannot be brought into view: ${name}`);
          // Sample inside the rounded corners, as well as at the center.
          for (const [x, y] of [[r.left + 8, r.top + 8], [r.right - 8, r.bottom - 8], [r.left + r.width / 2, r.top + r.height / 2]]) {
            const hit = document.elementFromPoint(x, y);
            fail(hit === el || el.contains(hit), `Control covered: ${name}`);
          }
          fail(el.tagName === 'INPUT' || !!(el.textContent.trim() || el.getAttribute('aria-label')), 'Control needs an accessible name');
        }
        const measured = [...document.querySelectorAll('h1, button > span, .track-copy span, .design-credit')].filter(visible);
        for (const el of measured) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const r = range.getBoundingClientRect();
          const parent = el.getBoundingClientRect();
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
          fail(r.width <= parent.width + 1 && lines.size <= 1, `Text clipped or unexpectedly wrapped: ${el.textContent}`);
        }
        const rules = [...document.querySelectorAll('.header-rule, .copy-rule, .study-divider, .footer-rule')];
        fail(rules.every((el) => visible(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0), 'Structural lines remain visible');
        scrollTo(0, 0);
        return { width: innerWidth, height: innerHeight, documentHeight: root.scrollHeight, devicePixelRatio, targets: all.length, copy, portrait, companion };
      },
      contrast() {
        const samples = [...document.querySelectorAll('h1, button > span, .track-copy span, .design-credit')].filter(visible);
        const ratios = [];
        for (const el of samples) {
          let background = [17, 20, 25];
          const ancestors = [];
          for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
          for (const node of ancestors) {
            const style = getComputedStyle(node);
            background = composite(rgba(style.backgroundColor), background);
            // Test the brightest resolved gradient stop as a conservative dark-UI background.
            const stops = [...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((match) => composite(rgba(match[0]), background));
            for (const stop of stops) if (luminance(stop) > luminance(background)) background = stop;
          }
          const style = getComputedStyle(el);
          const fg = luminance(composite(rgba(style.color), background));
          const bg = luminance(background);
          const ratio = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
          const min = parseFloat(style.fontSize) >= 24 ? 3 : 4.5;
          fail(ratio >= min, `Text contrast ${ratio.toFixed(2)}:1 is below ${min}:1 for ${el.textContent}`);
          ratios.push({ text: el.textContent.trim(), ratio: Number(ratio.toFixed(2)) });
        }
        return ratios;
      },
    };
  });

  for (const [width, height] of [[1100, 760], [800, 600], [1600, 1000], [1920, 800], [1440, 600], [800, 1000], [640, 900], [400, 800], [1100, 400]]) {
    await resize(width, height);
    const layout = await evaluate((fit) => __previewChecks.layout(fit), width >= 800 && height >= 600);
    report.checks.push({ name: `layout and target visibility ${width}x${height}`, ...layout });
    const contrast = await evaluate(() => __previewChecks.contrast());
    report.checks.push({ name: `text contrast ${width}x${height}`, samples: contrast });
    await capture(`home-${width}x${height}`);
    if (layout.documentHeight > layout.height) await capture(`home-${width}x${height}-full`, true);
  }

  // Exercise intermediate sizes and both sides of each breakpoint, without reloading.
  const sizes = [[280, 800], [349, 800], [350, 800], [351, 800], [539, 800], [540, 800], [541, 800], [739, 800], [740, 800], [741, 800]];
  for (let width = 800; width <= 1800; width += 23) sizes.push([width, 600]);
  for (let width = 320; width <= 800; width += 17) sizes.push([width, 760]);
  for (let height = 320; height <= 1000; height += 37) sizes.push([1100, height]);
  report.resizeSweep = [];
  for (const [width, height] of sizes) {
    await resize(width, height);
    const result = await evaluate((fit) => __previewChecks.layout(fit), width >= 800 && height >= 600);
    report.resizeSweep.push({ width, height, documentHeight: result.documentHeight });
  }
  check(`${sizes.length} intermediate window sizes preserve artwork, labels and control access`, report.resizeSweep.length === sizes.length);

  for (const [width, height] of [[1100, 760], [800, 600]]) {
    for (const zoom of [1.25, 1.5, 2]) {
      await resize(width, height, zoom);
      const layout = await evaluate(() => __previewChecks.layout());
      report.checks.push({ name: `page zoom ${zoom * 100}% at ${width}x${height}`, ...layout });
      report.checks.push({ name: `zoomed text contrast ${zoom * 100}% at ${width}x${height}`, samples: await evaluate(() => __previewChecks.contrast()) });
      await capture(`home-${width}x${height}-zoom-${zoom * 100}`);
      if (layout.documentHeight > layout.height) await capture(`home-${width}x${height}-zoom-${zoom * 100}-full`, true);
      if (zoom === 2) await verifyKeyboard(`${width}x${height} at 200%`);
    }
  }

  await resize(1100, 760);
  for (const density of [1.25, 1.5, 2]) {
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: density, mobile: false });
    await settle();
    const layout = await evaluate(() => __previewChecks.layout(true));
    check(`emulated display density ${density * 100}% is applied`, layout.devicePixelRatio === density);
    report.checks.push({ name: `layout at display density ${density * 100}%`, ...layout });
    // capturePage is limited to the native window surface; CDP captures the full
    // emulated high-density surface, including the right and bottom edges.
    await capture(`home-1100x760-density-${density * 100}`, true);
  }
  await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
  await resize(1100, 760);
  await verifyKeyboard('1100x760 at 100%');

  await settle();
  const neutral = await evaluate(() => {
    const el = document.getElementById('preview-shelf');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), image: getComputedStyle(el).backgroundImage };
  });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: neutral.x, y: neutral.y });
  await pause(240);
  check('primary button has a visible hover state', await evaluate((image) => getComputedStyle(document.getElementById('preview-shelf')).backgroundImage !== image, neutral.image));
  report.checks.push({ name: 'hover text contrast', samples: await evaluate(() => __previewChecks.contrast()) });
  await capture('home-hover-1100x760');
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: neutral.x, y: neutral.y });
  await pause(160);
  check('primary button has a visible pressed state', await evaluate(() => getComputedStyle(document.getElementById('preview-shelf')).transform !== 'none'));
  await capture('home-pressed-1100x760');
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: neutral.x, y: neutral.y });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
  await pause(220);

  win.webContents.focus();
  await evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
  let focusReached = false;
  for (let i = 0; i < 12; i++) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await pause(25);
    if (await evaluate(() => document.activeElement.id === 'preview-shelf')) { focusReached = true; break; }
  }
  check('keyboard Tab reaches the primary entry with visible focus', focusReached && await evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return el.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  }));
  await capture('home-focus-1100x760');
  const entryUrl = win.webContents.getURL();
  await evaluate(() => [...document.querySelectorAll('button')].forEach((button) => button.click()));
  check('preview buttons do not navigate or load application state', win.webContents.getURL() === entryUrl && await evaluate(() => localStorage.length === 0 && typeof window.api === 'undefined'));

  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  check('reduced motion removes hover/press transitions', await evaluate(() => [...document.querySelectorAll('button, .forward-icon')].every((el) => getComputedStyle(el).transitionDuration.split(',').every((duration) => parseFloat(duration) === 0))));
  check('no external network resources requested', report.blockedRequests.length === 0);
  check('no renderer errors', report.errors.length === 0);
  finish();
}).catch(finish);
