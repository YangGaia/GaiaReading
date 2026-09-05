'use strict';

// Standalone design verification. Never loads src/main.js or the app preload.
// Run: .\node_modules\.bin\electron.cmd scripts/home-preview-smoke.js
const { app, BrowserWindow } = require('electron');
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
const timeout = setTimeout(() => finish(new Error('Home preview check timed out')), 90000);
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
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
async function capture(name) {
  await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const target = path.join(output, name + '.png');
  fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
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
    return img.src.endsWith('/src/renderer/images/2.jpeg') && img.naturalWidth === 1440 && img.naturalHeight === 2044;
  }));
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
      layout() {
        fail(document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight, 'Page must fit without scrollbars');
        const copy = box('.home-copy');
        const portrait = box('.portrait');
        const companion = box('#alice-companion');
        const music = box('.music-player');
        fail(!overlaps(copy, portrait), 'Controls and portrait must occupy separate regions');
        fail(!overlaps(portrait, companion), 'Desktop pet must have its own space');
        fail(!overlaps(portrait, music), 'Music controls must not cover the portrait');
        const all = [...document.querySelectorAll('button, input, a')].filter(visible);
        for (const el of all) {
          const r = el.getBoundingClientRect();
          fail(r.width >= 24 && r.height >= 24, `Small pointer target: ${el.id || el.getAttribute('aria-label')}`);
          fail(r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, 'Control is outside viewport');
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          fail(hit === el || el.contains(hit), `Control covered: ${el.id || el.getAttribute('aria-label')}`);
          fail(el.tagName === 'INPUT' || !!(el.textContent.trim() || el.getAttribute('aria-label')), 'Control needs an accessible name');
        }
        const title = document.getElementById('home-title');
        fail(title.scrollWidth <= title.clientWidth + 1, 'Product name must not overflow');
        const measured = [...document.querySelectorAll('.home-actions button > span, .track-copy span, .design-credit')];
        fail(measured.every((el) => el.scrollWidth <= el.clientWidth + 1), 'Text must not clip');
        return { width: innerWidth, height: innerHeight, targets: all.length, copy, portrait, companion };
      },
      contrast() {
        const samples = [...document.querySelectorAll('h1, .home-actions button > span, .track-copy span, .design-credit')];
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

  for (const [width, height] of [[1100, 760], [800, 600], [1600, 1000]]) {
    win.setContentSize(width, height);
    await pause(180);
    const layout = await evaluate(() => __previewChecks.layout());
    report.checks.push({ name: `layout and target visibility ${width}x${height}`, ...layout });
    const contrast = await evaluate(() => __previewChecks.contrast());
    report.checks.push({ name: `text contrast ${width}x${height}`, samples: contrast });
    await capture(`home-${width}x${height}`);
  }

  win.setContentSize(1100, 760);
  await pause(150);
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
