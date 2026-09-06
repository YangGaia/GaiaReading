'use strict';

// Real compositor screenshots plus every requestAnimationFrame, using only the
// disposable userData and fixture books provided by non-reading-smoke.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, report, check, books }) => {
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const routes = [
    ['library', { click: 'btn-home-shelf' }], ['stats', { click: 'btn-reading-stats' }],
    ['ai', { ai: 'stats' }], ['stats', { click: 'btn-ai-back' }], ['library', { click: 'btn-stats-back' }],
    ['ai', { ai: 'library' }], ['library', { click: 'btn-ai-back' }],
    ['reader', { book: books[0] }], ['stats', { stats: 'reader' }], ['reader', { click: 'btn-stats-back' }],
    ['ai', { ai: 'reader' }], ['reader', { click: 'btn-ai-back' }], ['library', { back: true }],
    ['home', { click: 'btn-back-home' }], ['ai', { click: 'btn-home-ai' }], ['home', { click: 'btn-ai-back' }],
  ];
  report.transitions = [];
  await evaluate(async (items) => {
    await GaiaPet.whenReady();
    await document.fonts.ready;
    await document.getElementById('home-img').decode();
    for (const book of items) await __gaiaDebug.addToLibrary(book);
    await document.querySelector('.library-robin').decode();
    await Promise.all([...document.querySelectorAll('.book-cover[src]')].map((image) => image.decode()));
    await __uiSmoke.wait(550);
    window.__transitionMusic = document.getElementById('bgm-capsule');
    window.__transitionPet = document.getElementById('gaia-pet');
    window.__transitionNavigate = (action) => {
      if (action.click) return document.getElementById(action.click).click();
      if (action.book) return __gaiaDebug.openBook(action.book);
      if (action.back) return __gaiaDebug.backToLibrary();
      if (action.ai) return __gaiaDebug.openAiCenter(action.ai);
      if (action.stats) return __gaiaDebug.openReadingStats(action.stats);
    };
    window.__transitionSnapshot = () => {
      const name = __gaiaDebug.getView();
      const root = document.getElementById(name + '-view');
      const content = root.querySelector({ home: '.study-layout', library: '.library-body', ai: '.ai-center-layout', stats: '.stats-scroll', reader: '#reader-body' }[name]);
      const style = getComputedStyle(content);
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      const music = document.getElementById('bgm-capsule');
      const pet = document.getElementById('gaia-pet');
      const rect = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
      const fullyVisible = (el) => {
        for (let node = el; node; node = node.parentElement) {
          const s = getComputedStyle(node);
          if (!node.getClientRects().length || s.visibility === 'hidden' || Number(s.opacity) < .9) return false;
        }
        return true;
      };
      const animations = document.getAnimations().filter((animation) => animation.id === 'view-content-enter');
      return { at: performance.now(), view: name, rootOpacity: getComputedStyle(root).opacity,
        rootRect: rect(root), viewport: [innerWidth, innerHeight], rootTransform: getComputedStyle(root).transform,
        contentOpacity: Number(style.opacity), y: matrix.m42, scale: [matrix.m11, matrix.m22], filter: style.filter,
        effects: animations.length, progress: animations[0]?.effect.getComputedTiming().progress,
        stacked: document.getAnimations().some((animation) => animation.id.startsWith('home-entry-')),
        overflow: document.documentElement.scrollWidth > innerWidth,
        music: rect(music), pet: rect(pet), petHidden: pet.hidden,
        sharedVisible: fullyVisible(music) && (name === 'stats' ? pet.hidden : fullyVisible(pet)),
        sharedIntact: music === __transitionMusic && pet === __transitionPet && !content.contains(music) && !content.contains(pet) };
    };
  }, books.slice(0, 8));

  // Compare painted pixels with both real endpoints. Light/eye reading paper
  // is allowed; an intervening white frame brighter than either page is not.
  const cornerBrightness = (screen) => {
    const { width, height } = screen.getSize();
    const bytes = screen.toBitmap();
    const samples = [];
    // Stay inside the page padding, away from the native vertical scrollbar.
    for (const [x, y] of [[16, 3], [width - 17, 3], [16, height - 4], [width - 17, height - 4]]) {
      const i = (y * width + x) * 4;
      samples.push(Math.max(bytes[i], bytes[i + 1], bytes[i + 2]));
    }
    return samples;
  };

  async function record(label, name, action, saveFrames = false) {
    const before = await evaluate(() => ({ music: GaiaBgm.getState(), pet: GaiaPet.getState(), rect: __transitionSnapshot().pet }));
    const sourcePixels = cornerBrightness(await win.webContents.capturePage());
    await evaluate(async (action) => {
      window.__transitionFrames = [];
      window.__transitionDone = false;
      window.__transitionError = '';
      const sample = () => { __transitionFrames.push(__transitionSnapshot()); window.__transitionRaf = requestAnimationFrame(sample); };
      Promise.resolve(__transitionNavigate(action)).catch((error) => { __transitionError = error.stack || String(error); }).finally(() => { __transitionDone = true; });
      await Promise.resolve();
      __transitionFrames.push(__transitionSnapshot());
      window.__transitionRaf = requestAnimationFrame(sample);
    }, action);
    const started = Date.now();
    const pixels = [];
    const screenshots = [];
    let done = false;
    do {
      const screen = await win.webContents.capturePage();
      const at = Date.now() - started;
      pixels.push({ at, corners: cornerBrightness(screen) });
      if (saveFrames && screenshots.length < 12) {
        const target = path.join(report.outputDir, `${label}-${String(screenshots.length).padStart(2, '0')}.png`);
        fs.writeFileSync(target, screen.toPNG());
        report.screenshots.push(target);
        screenshots.push({ path: target, at });
      }
      await wait(16);
      done = await evaluate(() => __transitionDone);
      assert.ok(Date.now() - started < 45000, `${label}: navigation timed out`);
    } while (!done || Date.now() - started < 340);
    const destinationPixels = cornerBrightness(await win.webContents.capturePage());
    const result = await evaluate(() => {
      cancelAnimationFrame(__transitionRaf);
      return { frames: __transitionFrames, final: __transitionSnapshot(), music: GaiaBgm.getState(), pet: GaiaPet.getState(), error: __transitionError };
    });
    report.transitions.push({ label, sourcePixels, destinationPixels, pixels, screenshots, ...result });
    assert.equal(result.error, '', `${label}: navigation failed`);
    const frames = result.frames.filter((f) => f.view === name);
    check(`${label}: destination appears without fading its root`, frames.length > 0 && result.final.view === name && frames[0].effects === 1);
    check(`${label}: actual pixels contain no extra white background frame`, pixels.length >= 3 && pixels.every((frame) =>
      frame.corners.every((value, i) => value <= Math.max(sourcePixels[i], destinationPixels[i]) + 4)));
    check(`${label}: every animation frame keeps the page opaque and full sized`, frames.every((f) =>
      f.rootOpacity === '1' && f.rootTransform === 'none' && f.rootRect.join() === [0, 0, ...f.viewport].join() && !f.overflow));
    check(`${label}: short entrance moves and fades without scale, blur or stacked reveals`,
      frames.some((f) => f.contentOpacity > .05 && f.contentOpacity < .98 && f.y > 0) &&
      frames.every((f) => f.scale.join() === '1,1' && f.filter === 'none' && !f.stacked && f.effects <= 1));
    check(`${label}: music and pet keep their own presentation during the entrance`, frames.every((f) =>
      f.sharedVisible && f.sharedIntact && f.music.every((v, i) => Math.abs(v - result.final.music[i]) < 1) &&
      f.pet.every((v, i) => Math.abs(v - result.final.pet[i]) < 1)));
    check(`${label}: no lingering animation or transform`, result.final.effects === 0 && result.final.contentOpacity === 1 && result.final.y === 0);
    assert.deepEqual(result.music, before.music, `${label}: playback state preserved`);
    assert.deepEqual(result.pet, before.pet, `${label}: saved pet size and position preserved`);
  }

  for (const theme of ['light', 'dark', 'eye']) {
    await evaluate((theme) => __gaiaDebug.setTheme(theme), theme);
    for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000], [1920, 800]]) {
      win.setContentSize(width, height);
      await wait(180);
      for (const [index, [name, action]] of routes.entries()) {
        await record(`${theme}-${width}x${height}-${index}-${name}`, name, action, theme === 'dark' && width === 1100);
      }
    }
  }

  // Exercise each document engine on the actual library → reader → library
  // path. Optional local Kindle fixtures are read only, never modified.
  const project = path.join(__dirname, '..');
  const documents = ['epub', 'pdf'].map((format) => ({ format, title: `Navigation ${format}`, path: path.join(project, 'tests/fixtures', `sample.${format}`) }));
  for (const format of ['mobi', 'azw3']) {
    const filename = fs.readdirSync(project).find((name) => name.includes('乔布斯') && name.endsWith('.' + format));
    if (filename) documents.push({ format, title: `Navigation ${format}`, path: path.join(project, filename) });
    else (report.skipped ||= []).push(`${format}: optional local fixture unavailable`);
  }
  win.setContentSize(1100, 760);
  await evaluate(() => document.getElementById('btn-home-shelf').click());
  await wait(260);
  for (const theme of ['light', 'dark', 'eye']) {
    await evaluate((theme) => __gaiaDebug.setTheme(theme), theme);
    for (const book of documents) {
      await record(`${theme}-${book.format}-open`, 'reader', { book }, theme === 'dark');
      check(`${theme}-${book.format}: document loaded with the chosen reading background`, await evaluate((theme) => {
        const root = document.getElementById('reader-view');
        const expected = { light: 'rgb(255, 255, 255)', dark: 'rgb(0, 0, 0)', eye: 'rgb(245, 236, 217)' }[theme];
        return !!document.querySelector('#reader-content iframe, #reader-content canvas') &&
          !document.getElementById('reader-status').textContent.includes('打开失败') && getComputedStyle(root).backgroundColor === expected;
      }, theme));
      await record(`${theme}-${book.format}-exit`, 'library', { back: true }, theme === 'dark');
    }
  }
  await evaluate(() => document.getElementById('btn-back-home').click());
  await wait(260);

  // Real rapid clicks are deliberately delivered while the preceding effect is
  // running. A stale completion must never change the latest destination.
  check('rapid forward/back clicks cancel old effects without delaying navigation', await evaluate(async () => {
    const sequence = ['library', 'stats', 'ai', 'reader', 'library', 'home'];
    for (let n = 0; n < 6; n += 1) for (const view of sequence) {
      const old = document.getAnimations().find((animation) => animation.id === 'view-content-enter');
      __gaiaDebug.showView(view);
      if (__gaiaDebug.getView() !== view || (old && old.playState !== 'idle')) return false;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (document.getAnimations().filter((animation) => animation.id === 'view-content-enter').length !== 1) return false;
    }
    await __uiSmoke.wait(260);
    return __gaiaDebug.getView() === 'home' && !document.getAnimations().some((animation) => animation.id === 'view-content-enter' || animation.id.startsWith('home-entry-'));
  }));

  // Resize while the content is moving; verify the page itself never leaves a gap.
  await evaluate(() => document.getElementById('btn-home-shelf').click());
  win.setContentSize(800, 600);
  await wait(40);
  check('resizing during entry keeps the background and shared UI intact', await evaluate(() => {
    const f = __transitionSnapshot();
    return f.rootOpacity === '1' && f.rootRect.join() === [0, 0, ...f.viewport].join() && f.sharedVisible && !f.overflow;
  }));
  await evaluate(() => document.getElementById('btn-back-home').click());
  await wait(260);

  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await wait(50);
    for (const [name, action] of routes) {
      const frame = await evaluate(async (action) => {
        await __transitionNavigate(action);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return __transitionSnapshot();
      }, action);
      check(`reduced motion: ${name} stays opaque without any reveal`, frame.view === name && frame.rootOpacity === '1' && frame.effects === 0 && !frame.stacked && frame.contentOpacity === 1 && frame.y === 0 && frame.sharedVisible);
    }
  } finally {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    win.webContents.debugger.detach();
    await evaluate(() => { cancelAnimationFrame(window.__transitionRaf); });
  }
};
