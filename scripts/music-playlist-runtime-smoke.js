'use strict';

// Isolated production-player check: no user profile, books or real playback.
// Run: npx electron scripts/music-playlist-runtime-smoke.js
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { BGM_TRACKS } = require('../src/shared/bgm');
const root = path.resolve(__dirname, '..');
const sandbox = makeSmokeDirectory('gaia-music-playlist-');
const output = resolveFPath(process.env.GAIA_MUSIC_OUTPUT_DIR || path.join(sandbox, 'screenshots'));
fs.mkdirSync(output, { recursive: true });
configureSmokePaths(app, { userData: sandbox });
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
protocol.registerSchemesAsPrivileged([{ scheme: 'bgm', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const report = { sandbox, output, checks: [], screenshots: [], errors: [] };
let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('Music playlist check timed out')), 120000);
app.whenReady().then(async () => {
  protocol.handle('bgm', request => {
    const file = path.basename(decodeURIComponent(new URL(request.url).pathname));
    return net.fetch(pathToFileURL(path.join(root, 'assets/bgm', file)).href);
  });
  const asset = name => pathToFileURL(path.join(root, name)).href;
  const fixture = path.join(sandbox, 'music.html');
  fs.writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="${asset('src/renderer/music.css')}">
    <style>body{margin:0;background:#131820;color:#adb5c3;font-family:sans-serif}#home-bgm-slot{position:absolute;right:28px;top:22px;width:336px}#reader-bgm-slot{position:absolute;left:24px;top:22px}#library-view .topbar{display:flex;padding:22px 28px}.note{position:absolute;left:30px;bottom:24px;font-size:13px}</style>
    <div id="home-bgm-slot"></div><div id="reader-bgm-slot"></div><div id="library-view"><div class="topbar"></div></div><div class="note">阅读音乐 · 隔离验证界面</div>
    <script>window.api={stateGet:async()=>({muted:true,on:false,trackId:'alice'}),stateSet:async()=>{}};</script><script src="${asset('src/shared/bgm.js')}"></script><script src="${asset('src/renderer/bgm.js')}"></script><script>GaiaBgm.initBgm().then(()=>{GaiaBgm.positionBgm('home');window.ready=true;});</script></html>`);
  const win = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { contextIsolation: true, backgroundThrottling: false, spellcheck: false } });
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  await win.loadFile(fixture);
  win.showInactive();
  await run(win);
  finish();
}).catch(finish);

async function run(win) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
  for (let i = 0; i < 100 && !await evaluate(() => window.ready); i++) await wait(30);
  check('Production player initializes', await evaluate(() => window.ready));
  win.webContents.debugger.attach('1.3');
  const click = async selector => {
    const point = await evaluate(selector => {
      const el = document.querySelector(selector); el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) throw new Error(selector + ' not visible');
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!el.contains(hit)) throw new Error(selector + ' obscured');
      return { x, y };
    }, selector);
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    await wait(80);
  };
  await click('.bgm-title');
  check('Title opens a list of all 59 titles, current track marked', await evaluate(() => document.getElementById('bgm-playlist').matches(':popover-open') && document.querySelectorAll('[data-track-id]').length === 59 && document.querySelector('[aria-current="true"]').dataset.trackId === 'alice'));
  await click('[data-track-id="ost-3-17"]');
  check('Choosing a song starts that title and closes the list', await evaluate(() => GaiaBgm.getState().trackId === 'ost-3-17' && GaiaBgm.getState().on && document.querySelector('.bgm-title-text').textContent === 'extra magic number?' && !document.getElementById('bgm-playlist').matches(':popover-open')));
  for (const [view, width, height] of [['home', 1100, 760], ['reader', 800, 600], ['library', 1100, 760]]) {
    win.setContentSize(width, height);
    await evaluate(view => GaiaBgm.positionBgm(view), view);
    await wait(120);
    await click('.bgm-title');
    check(`${view} playlist stays inside viewport and above underlying UI`, await evaluate(() => {
      const panel = document.getElementById('bgm-playlist'), r = panel.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && panel.contains(document.elementFromPoint(r.left + 10, r.top + 10));
    }));
    const shot = path.join(output, `playlist-${view}.png`);
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(shot);
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(60);
    check(`${view} Escape dismisses playlist`, await evaluate(() => !document.getElementById('bgm-playlist').matches(':popover-open')));
  }
  win.webContents.debugger.detach();
  // Chromium decodes the beginning and the end of every production FLAC.
  for (const track of BGM_TRACKS) {
    const decoded = await evaluate(async track => {
      const audio = new Audio();
      audio.muted = true;
      const ready = event => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${track.file}: ${event} timeout`)), 8000);
        const error = () => { clearTimeout(timer); reject(new Error(`${track.file}: ${audio.error && audio.error.message}`)); };
        audio.addEventListener('error', error, { once: true });
        audio.addEventListener(event, () => { clearTimeout(timer); audio.removeEventListener('error', error); resolve(); }, { once: true });
      });
      const loaded = ready('loadeddata');
      audio.src = 'bgm://local/' + track.file;
      await loaded;
      const duration = audio.duration;
      const sought = ready('seeked');
      audio.currentTime = duration - 1;
      await sought;
      const ok = duration > 20 && audio.readyState >= 2;
      audio.removeAttribute('src'); audio.load();
      return { file: track.file, duration, ok };
    }, track);
    check(`FLAC decodes and seeks: ${decoded.file}`, decoded.ok);
  }
}
