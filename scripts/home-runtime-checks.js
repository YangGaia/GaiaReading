'use strict';

// Runs inside the real application launched by non-reading-smoke.js.
// Its temporary userData directory isolates all playback/preferences changes.
const assert = require('node:assert/strict');

module.exports = async ({ win, report, check, capture }) => {
  const evaluate = async (fn, ...args) => {
    const result = await win.webContents.executeJavaScript(`(async () => {
      try { return { value: await (${fn.toString()})(...${JSON.stringify(args)}) }; }
      catch (error) { return { error: error.stack || String(error) }; }
    })()`);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const settle = () => evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const resize = async (width, height, zoom = 1) => {
    win.setContentSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await wait(60);
    await settle();
    const size = await evaluate(() => [innerWidth, innerHeight]);
    assert.ok(Math.abs(size[0] - width / zoom) <= 1 && Math.abs(size[1] - height / zoom) <= 1, 'Actual application viewport must resize');
  };
  try {
    await evaluate(async () => {
      await GaiaPet.whenReady();
      await document.fonts.load('500 36px "Gaia Home Noto"', 'Gaia Reading 进入书架');
      await document.fonts.ready;
      await document.getElementById('home-img').decode();
    });
    await settle();
    check('home runs in the real renderer with preload and shared music instance', await evaluate(() =>
      typeof window.api.stateGet === 'function' && __gaiaDebug.getView() === 'home' &&
      document.querySelectorAll('#bgm-capsule').length === 1 && !!document.querySelector('#home-bgm-slot #bgm-capsule')
    ));
    const petScale = await evaluate(() => GaiaPet.getState().scale);
    check('runtime home uses the original homepage art with its packaged silhouette', await evaluate(async () => {
      const art = document.getElementById('home-img');
      const style = getComputedStyle(art);
      const src = style.maskImage.match(/^url\("?([^"\)]+)"?\)$/)?.[1];
      if (!src || !src.endsWith('/images/home/alice-matte.png')) return false;
      const mask = new Image();
      mask.src = src;
      await mask.decode();
      return art.src.endsWith('/images/1.jpg') && art.naturalWidth === 1200 && mask.naturalWidth === 1200 && style.filter === 'none' && style.opacity === '1';
    }));

    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('DOM.enable');
    await win.webContents.debugger.sendCommand('CSS.enable');
    const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
    for (const selector of ['#home-title', '#btn-home-shelf > span']) {
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
      const used = fonts.filter((font) => font.glyphCount > 0);
      check(`runtime ${selector} actually renders Noto Sans SC`, used.length > 0 && used.every((font) => /Noto Sans SC/i.test(font.familyName)));
    }
    win.webContents.debugger.detach();

    await evaluate(() => {
      const fail = (ok, message) => { if (!ok) throw new Error(message); };
      const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
      window.__homeRuntimeLayout = (fit) => {
        const home = document.getElementById('home-view');
        home.scrollTop = 0;
        fail(home.scrollWidth <= home.clientWidth, `Home horizontal overflow at ${innerWidth}x${innerHeight}: ${home.scrollWidth}/${home.clientWidth}`);
        if (fit) fail(home.scrollHeight <= home.clientHeight, `Home unexpectedly scrolls at ${innerWidth}x${innerHeight}: ${home.scrollHeight}/${home.clientHeight}`);
        const art = document.getElementById('home-img').getBoundingClientRect();
        const copy = home.querySelector('.home-copy').getBoundingClientRect();
        const pet = document.getElementById('gaia-pet').getBoundingClientRect();
        fail(art.width > 0 && Math.abs(art.width - art.height) < 1, 'Home art must retain its original aspect ratio');
        fail(!overlaps(art, copy), 'Home art must not cover the entry controls');
        if (innerWidth > 740) fail(!overlaps(art, pet), 'Live desktop pet needs space beside the art');
        const controls = [...home.querySelectorAll('button, input, a')];
        fail(controls.length === 10, 'All original entries, live music buttons and volume must remain present');
        for (const el of controls) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r = el.getBoundingClientRect();
          const name = el.id || el.getAttribute('aria-label') || el.textContent.trim();
          fail(r.width >= 24 && r.height >= 24, `Small or hidden home target: ${name}`);
          fail(r.left >= 0 && r.right <= home.clientWidth && r.top >= 0 && r.bottom <= innerHeight, `Home target cannot be reached: ${name}`);
          for (const [x, y] of [[r.left + 8, r.top + 8], [r.right - 8, r.bottom - 8], [r.left + r.width / 2, r.top + r.height / 2]]) {
            const hit = document.elementFromPoint(x, y);
            fail(hit === el || el.contains(hit), `Home target ${name} is covered by ${hit && (hit.id || hit.className)}`);
          }
        }
        for (const el of home.querySelectorAll('#home-title, .home-actions button > span, .settings-button > span')) {
          const range = document.createRange();
          range.selectNodeContents(el);
          fail(range.getBoundingClientRect().width <= el.getBoundingClientRect().width + 1, `Home label is clipped: ${el.textContent}`);
        }
        home.scrollTop = 0;
        return { width: innerWidth, height: innerHeight, documentHeight: home.scrollHeight, petWidth: pet.width, controls: controls.length };
      };
    });

    for (const [width, height] of [[1100, 760], [800, 600], [1600, 1000], [1440, 600], [800, 1000]]) {
      await resize(width, height);
      report.checks.push({ name: 'runtime home layout', ...await evaluate(() => __homeRuntimeLayout(true)) });
      await capture(win, `home-runtime-${width}x${height}`);
    }
    const samples = [];
    for (let width = 800; width <= 1600; width += 31) samples.push([width, 600]);
    for (let height = 600; height <= 1000; height += 29) samples.push([1100, height]);
    for (const [width, height] of samples) {
      await resize(width, height);
      await evaluate(() => __homeRuntimeLayout(true));
    }
    check(`${samples.length} continuous real-app sizes keep controls and live pet clear`, true);

    for (const [width, height] of [[1100, 760], [800, 600]]) {
      for (const zoom of [1.25, 1.5, 2]) {
        await resize(width, height, zoom);
        report.checks.push({ name: `runtime home zoom ${zoom * 100}%`, ...await evaluate(() => __homeRuntimeLayout(false)) });
        await capture(win, `home-runtime-${width}x${height}-zoom-${zoom * 100}`);
      }
    }
    // Real Tab input must reach every entry after zoom has caused a vertical reflow.
    win.webContents.focus();
    const order = await evaluate(() => {
      const home = document.getElementById('home-view');
      home.scrollTop = 0;
      document.body.tabIndex = -1;
      document.body.focus();
      return [...home.querySelectorAll('button, input, a')].map((el) => el.id || el.getAttribute('aria-label') || el.textContent.trim());
    });
    for (const label of order) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await wait(25);
      const focus = await evaluate(() => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        return { name: el.id || el.getAttribute('aria-label') || el.textContent.trim(), visible: el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) >= 2 && r.top >= 0 && r.bottom <= innerHeight };
      });
      assert.equal(focus.name, label, 'Runtime Tab order');
      assert.ok(focus.visible, `Runtime focus must be visible: ${label}`);
    }
    check('all live homepage controls have visible keyboard focus at 200% zoom', true);
    await evaluate(() => document.activeElement.blur());
    await resize(1100, 760);
    await evaluate(() => { document.getElementById('home-view').scrollTop = 0; });
    check('responsive pet presentation preserves the saved scale', await evaluate(() => GaiaPet.getState().scale) === petScale);
    const petX = await evaluate(() => {
      document.querySelector('#gaia-pet .gaia-pet-hitbox').focus();
      return GaiaPet.getState().x;
    });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
    await wait(30);
    check('live desktop pet still responds to keyboard movement', await evaluate(() => GaiaPet.getState().x) === petX - 8);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await wait(30);
    check('desktop pet position can be restored without affecting the home layout', await evaluate(() => GaiaPet.getState().x) === petX);
    await evaluate(() => document.activeElement.blur());

    const playback = await evaluate(async () => {
      const before = GaiaBgm.getState();
      const click = (action) => document.querySelector(`#home-bgm-slot [data-action="${action}"]`).click();
      click('play');
      const toggled = GaiaBgm.getState().on !== before.on;
      click('next');
      const advanced = GaiaBgm.getState().trackId !== before.trackId;
      click('prev');
      const returned = GaiaBgm.getState().trackId === before.trackId;
      click('mute');
      const muted = GaiaBgm.getState().muted !== before.muted;
      const volume = document.querySelector('#home-bgm-slot .bgm-volume');
      volume.value = '37';
      volume.dispatchEvent(new Event('input', { bubbles: true }));
      const adjusted = GaiaBgm.getState().volume === .37 && !GaiaBgm.getState().muted;
      const persisted = await window.api.stateGet('bgm');
      const state = GaiaBgm.getState();
      return { toggled, advanced, returned, muted, adjusted, saved: persisted.volume === .37 && persisted.on === state.on && persisted.trackId === state.trackId };
    });
    check('real home music controls play/pause, change tracks, mute and persist volume', Object.values(playback).every(Boolean));
    const musicState = await evaluate(() => GaiaBgm.getState());
    await evaluate(async () => { await __uiSmoke.click('#btn-home-settings'); });
    check('home music still moves aside for the settings drawer', await evaluate(() => {
      const player = document.getElementById('bgm-capsule');
      return player.parentElement === document.body && player.dataset.settingsOpen === '1';
    }));
    await evaluate(async () => { await __uiSmoke.click('#btn-settings-close'); });
    check('closing settings restores the same music instance into the homepage', await evaluate(() => !!document.querySelector('#home-bgm-slot #bgm-capsule') && document.querySelectorAll('#bgm-capsule').length === 1));
    assert.deepEqual(await evaluate(() => GaiaBgm.getState()), musicState, 'Repositioning music must not reset playback');
  } catch (error) {
    await capture(win, 'home-runtime-failure');
    throw error;
  }
};
