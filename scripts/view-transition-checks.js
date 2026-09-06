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
    ['library', 'btn-home-shelf'], ['home', 'btn-back-home'],
    ['ai', 'btn-home-ai'], ['home', 'btn-ai-back'],
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
    window.__transitionSnapshot = () => {
      const name = __gaiaDebug.getView();
      const root = document.getElementById(name + '-view');
      const content = root.querySelector({ home: '.study-layout', library: '.library-body', ai: '.ai-center-layout' }[name]);
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
        music: rect(music), pet: rect(pet), sharedVisible: fullyVisible(music) && fullyVisible(pet),
        sharedIntact: music === __transitionMusic && pet === __transitionPet && !content.contains(music) && !content.contains(pet) };
    };
  }, books.slice(0, 8));

  // The corners contain only the opaque graphite page, never art or controls.
  // A whole-page opacity animation exposes the light body here immediately.
  const cornerBrightness = (screen) => {
    const { width, height } = screen.getSize();
    const bytes = screen.toBitmap();
    const samples = [];
    for (const [x, y] of [[3, 3], [width - 4, 3], [3, height - 4], [width - 4, height - 4]]) {
      const i = (y * width + x) * 4;
      samples.push(Math.max(bytes[i], bytes[i + 1], bytes[i + 2]));
    }
    return samples;
  };

  async function record(label, name, button, saveFrames = false) {
    const before = await evaluate(() => ({ music: GaiaBgm.getState(), pet: GaiaPet.getState(), rect: __transitionSnapshot().pet }));
    const first = await evaluate((button) => {
      window.__transitionFrames = [];
      const sample = () => { __transitionFrames.push(__transitionSnapshot()); window.__transitionRaf = requestAnimationFrame(sample); };
      document.getElementById(button).click();
      __transitionFrames.push(__transitionSnapshot());
      window.__transitionRaf = requestAnimationFrame(sample);
      return __transitionFrames[0];
    }, button);
    check(`${label}: destination is synchronous, root stays opaque`, first.view === name && first.rootOpacity === '1' && first.effects === 1);
    const started = Date.now();
    const pixels = [];
    const screenshots = [];
    do {
      const screen = await win.webContents.capturePage();
      const at = Date.now() - started;
      pixels.push({ at, corners: cornerBrightness(screen) });
      if (saveFrames) {
        const target = path.join(report.outputDir, `${label}-${String(screenshots.length).padStart(2, '0')}.png`);
        fs.writeFileSync(target, screen.toPNG());
        report.screenshots.push(target);
        screenshots.push({ path: target, at });
      }
      await wait(16);
    } while (Date.now() - started < 300);
    const result = await evaluate(() => {
      cancelAnimationFrame(__transitionRaf);
      return { frames: __transitionFrames, final: __transitionSnapshot(), music: GaiaBgm.getState(), pet: GaiaPet.getState() };
    });
    report.transitions.push({ label, pixels, screenshots, ...result });
    const frames = result.frames;
    check(`${label}: actual pixels contain no white background frame`, pixels.length >= 3 && pixels.every((frame) => frame.corners.every((value) => value < 80)));
    check(`${label}: every animation frame keeps the page opaque and full sized`, frames.every((f) =>
      f.rootOpacity === '1' && f.rootTransform === 'none' && f.rootRect.join() === [0, 0, ...f.viewport].join() && !f.overflow));
    check(`${label}: short entrance moves and fades without scale, blur or stacked reveals`,
      frames.some((f) => f.contentOpacity > .05 && f.contentOpacity < .98 && f.y > 0) &&
      frames.every((f) => f.scale.join() === '1,1' && f.filter === 'none' && !f.stacked && f.effects <= 1));
    check(`${label}: music and pet remain visible, separate and stationary during the entrance`, frames.every((f) =>
      f.sharedVisible && f.sharedIntact && f.music.every((v, i) => Math.abs(v - result.final.music[i]) < 1) &&
      f.pet.every((v, i) => Math.abs(v - before.rect[i]) < 1)));
    check(`${label}: no lingering animation or transform`, result.final.effects === 0 && result.final.contentOpacity === 1 && result.final.y === 0);
    assert.deepEqual(result.music, before.music, `${label}: playback state preserved`);
    assert.deepEqual(result.pet, before.pet, `${label}: saved pet size and position preserved`);
  }

  for (const theme of ['light', 'dark', 'eye']) {
    await evaluate((theme) => __gaiaDebug.setTheme(theme), theme);
    for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000], [1920, 800]]) {
      win.setContentSize(width, height);
      await wait(180);
      for (const [name, button] of routes) {
        await record(`${theme}-${width}x${height}-${button}`, name, button, theme === 'light' && width === 1100);
      }
    }
  }

  // Real rapid clicks are deliberately delivered while the preceding effect is
  // running. A stale completion must never change the latest destination.
  check('rapid forward/back clicks cancel old effects without delaying navigation', await evaluate(async () => {
    const sequence = [['btn-home-shelf', 'library'], ['btn-back-home', 'home'], ['btn-home-ai', 'ai'], ['btn-ai-back', 'home']];
    for (let n = 0; n < 6; n += 1) for (const [button, view] of sequence) {
      const old = document.getAnimations().find((animation) => animation.id === 'view-content-enter');
      document.getElementById(button).click();
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
    for (const [name, button] of routes) {
      const frame = await evaluate(async (button) => {
        document.getElementById(button).click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return __transitionSnapshot();
      }, button);
      check(`reduced motion: ${button} stays opaque without any reveal`, frame.view === name && frame.rootOpacity === '1' && frame.effects === 0 && !frame.stacked && frame.contentOpacity === 1 && frame.y === 0 && frame.sharedVisible);
    }
  } finally {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    win.webContents.debugger.detach();
    await evaluate(() => { cancelAnimationFrame(window.__transitionRaf); });
  }
};
