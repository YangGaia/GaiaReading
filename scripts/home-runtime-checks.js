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
  const mouse = (type, x, y, button = 'left', held = false) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button, clickCount: 1, modifiers: held ? [button === 'right' ? 'rightButtonDown' : 'leftButtonDown'] : [] });
  const click = async (selector) => {
    const point = await evaluate((selector) => {
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      if (hit !== el && !el.contains(hit)) throw new Error(`${selector} is covered`);
      return { x, y };
    }, selector);
    mouse('mouseMove', point.x, point.y);
    mouse('mouseDown', point.x, point.y);
    mouse('mouseUp', point.x, point.y);
    await wait(40);
  };
  const resize = async (width, height, zoom = 1) => {
    win.setContentSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await wait(60);
    await settle();
    const size = await evaluate(() => [innerWidth, innerHeight]);
    assert.ok(Math.abs(size[0] - width / zoom) <= 1 && Math.abs(size[1] - height / zoom) <= 1, 'Actual application viewport must resize');
  };
  const captureMusic = async (name) => {
    const clip = await evaluate(() => {
      const r = document.getElementById('bgm-capsule').getBoundingClientRect();
      return { x: Math.floor(r.left - 4), y: Math.floor(r.top - 4), width: Math.ceil(r.width + 8), height: Math.ceil(r.height + 8) };
    });
    await capture(win, `home-music-${name}-native-pixels`, clip);
    (report.musicDetails ||= []).push({ name, clip });
  };
  const movePetToRatio = async (xRatio) => {
    const point = await evaluate((ratio) => {
      const el = document.getElementById('gaia-pet');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, destination: ratio * (innerWidth - el.offsetWidth) + r.width / 2 };
    }, xRatio);
    mouse('mouseMove', point.x, point.y);
    mouse('mouseDown', point.x, point.y);
    await wait(20);
    mouse('mouseMove', point.destination, point.y, 'left', true);
    await wait(20);
    mouse('mouseUp', point.destination, point.y);
    mouse('mouseMove', 0, 0);
    // Input delivery and JS evaluation use different Chromium queues. Drain the
    // pointer events before dismissing the hover bubble they may have opened.
    await wait(80);
    await settle();
    await evaluate(async () => {
      const bubble = document.querySelector('.gaia-pet-bubble');
      bubble.click();
      for (let i = 0; i < 40; i += 1) {
        if (bubble.hidden && !bubble.getClientRects().length) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Dismissed pet bubble still blocks input: ${bubble.outerHTML}`);
    });
  };
  try {
    await evaluate(async () => {
      await GaiaPet.whenReady();
      await document.fonts.load('500 36px "Gaia Home Noto"', 'Gaia Reading 进入书架');
      await document.fonts.load('500 46px "Gaia Wordmark"', 'Gaia Reading');
      await document.fonts.ready;
      await document.getElementById('home-img').decode();
      await Promise.allSettled(document.getAnimations().filter((animation) => animation.id.startsWith('home-entry-')).map((animation) => animation.finished));
    });
    await settle();
    if (process.env.GAIA_UI_HOME_INTERACTIONS_ONLY === '1') {
      await require('./home-interaction-checks')({ win, evaluate, resize, check, capture });
      return;
    }
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
    for (const [selector, family] of [['#home-title', 'Cormorant Garamond'], ['#btn-home-shelf > span', 'Noto Sans SC']]) {
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
      const used = fonts.filter((font) => font.glyphCount > 0);
      check(`runtime ${selector} actually renders ${family}`, used.length > 0 && used.every((font) => font.familyName.includes(family)));
    }
    win.webContents.debugger.detach();

    await evaluate(() => {
      const fail = (ok, message) => { if (!ok) throw new Error(message); };
      const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
      let reference;
      window.__homeRuntimeLayout = () => {
        const home = document.getElementById('home-view');
        const viewport = home.getBoundingClientRect();
        const canvas = home.querySelector('.home-surface').getBoundingClientRect();
        const scale = Math.min(viewport.width / 1100, viewport.height / 760);
        fail(Math.abs(canvas.width - 1100 * scale) < .1 && Math.abs(canvas.height - 760 * scale) < .1, 'The entire 1100×760 canvas must fit with one scale');
        const snapTolerance = .5 / devicePixelRatio + .02;
        fail(Math.abs(canvas.left - (viewport.width - canvas.width) / 2) < snapTolerance && Math.abs(canvas.top - (viewport.height - canvas.height) / 2) < snapTolerance, `The complete composition must stay centered on device pixels: ${JSON.stringify(canvas.toJSON())}`);
        fail(home.scrollWidth <= home.clientWidth, `Home horizontal overflow at ${innerWidth}x${innerHeight}: ${home.scrollWidth}/${home.clientWidth}`);
        fail(home.scrollHeight <= home.clientHeight, `Home unexpectedly scrolls at ${innerWidth}x${innerHeight}: ${home.scrollHeight}/${home.clientHeight}`);
        const art = document.getElementById('home-img').getBoundingClientRect();
        const copy = home.querySelector('.home-copy').getBoundingClientRect();
        const pet = document.getElementById('gaia-pet').getBoundingClientRect();
        fail(art.width > 0 && Math.abs(art.width - art.height) < 1, 'Home art must retain its original aspect ratio');
        fail(!overlaps(art, copy), 'Home art must not cover the entry controls');
        fail(pet.width === 150 * GaiaPet.getState().scale, 'Pet size must be independent of the home scale');
        for (const [selector, base] of [['#home-title', 46], ['#btn-home-shelf', 14], ['#home-bgm-slot .bgm-title', 12]]) {
          const el = document.querySelector(selector);
          fail(Math.abs(parseFloat(getComputedStyle(el).fontSize) - base * scale) < .01, `${selector} must paint text at its final font size`);
          for (let node = el; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            fail(style.transform === 'none' && style.zoom === '1' && style.filter === 'none' && style.backdropFilter === 'none', `${selector} is raster-scaled or filtered by ${node.id || node.className}`);
          }
        }
        const selectors = ['#home-title', '.app-mark', '.header-rule', '.copy-rule', '#btn-home-shelf', '#btn-home-add-books', '#btn-home-ai', '.study-divider', '.portrait-lines', '#home-img', '#home-bgm-slot', '.bgm-cover', '.bgm-volume', '#btn-home-settings', '.footer-rule', '.design-credit'];
        const normalized = selectors.map((selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return [(r.left - canvas.left) / scale, (r.top - canvas.top) / scale, r.width / scale, r.height / scale];
        });
        if (!reference) reference = normalized;
        // Chromium snaps CSS borders to device pixels when page zoom changes.
        normalized.forEach((rect, i) => rect.forEach((value, axis) => fail(Math.abs(value - reference[i][axis]) < 1.5, `${selectors[i]} changes composition at ${innerWidth}×${innerHeight}: ${rect} vs ${reference[i]}`)));
        const controls = [...home.querySelectorAll('button, input, a')];
        fail(controls.length === 10, 'All original entries, live music buttons and volume must remain present');
        for (const el of controls) {
          const r = el.getBoundingClientRect();
          const name = el.id || el.getAttribute('aria-label') || el.textContent.trim();
          fail(r.width / scale >= 24 && r.height / scale >= 24, `Small or hidden home target in design coordinates: ${name}`);
          fail(r.left >= 0 && r.right <= home.clientWidth && r.top >= 0 && r.bottom <= innerHeight, `Home target cannot be reached: ${name}`);
          for (const [x, y] of [[r.left + 8 * scale, r.top + 8 * scale], [r.right - 8 * scale, r.bottom - 8 * scale], [r.left + r.width / 2, r.top + r.height / 2]]) {
            const hit = document.elementFromPoint(x, y);
            fail(hit === el || el.contains(hit), `Home target ${name} is covered by ${hit && (hit.id || hit.className)}`);
          }
        }
        for (const el of home.querySelectorAll('#home-title, .home-actions button > span, .settings-button > span')) {
          const range = document.createRange();
          range.selectNodeContents(el);
          fail(range.getBoundingClientRect().width <= el.getBoundingClientRect().width + 1, `Home label is clipped: ${el.textContent}`);
        }
        fail(home.scrollTop === 0 && home.scrollLeft === 0, 'Home must never scroll to reveal a control');
        return { width: innerWidth, height: innerHeight, scale, comparedElements: selectors.length, documentHeight: home.scrollHeight, petWidth: pet.width, controls: controls.length, nativeTextRendering: true };
      };
    });

    let storedPet = await evaluate(() => window.api.stateGet('pet'));
    const originalPetRatio = storedPet.xRatio;
    for (const [width, height] of [[1100, 760], [800, 600], [1600, 1000], [1440, 600], [800, 1000], [1920, 1080], [2560, 1080]]) {
      await resize(width, height);
      report.checks.push({ name: 'runtime home layout', ...await evaluate(() => __homeRuntimeLayout(true)) });
      await capture(win, `home-runtime-${width}x${height}`);
      if (width === 1100 || width === 1600) await captureMusic(`${width}x${height}`);
    }
    const samples = [];
    for (let width = 800; width <= 1600; width += 31) samples.push([width, 600]);
    for (let height = 600; height <= 1000; height += 29) samples.push([1100, height]);
    for (const [width, height] of samples) {
      await resize(width, height);
      await evaluate(() => __homeRuntimeLayout(true));
    }
    check(`${samples.length} real-app sizes retain the composition, paint native text and keep the pet at its original size`, true);

    for (const mode of ['maximize', 'fullscreen']) {
      if (mode === 'maximize') win.maximize();
      else win.setFullScreen(true);
      await wait(400);
      await settle();
      check(`native ${mode} is active`, mode === 'maximize' ? win.isMaximized() : win.isFullScreen());
      report.checks.push({ name: `native ${mode} composition`, ...await evaluate(() => __homeRuntimeLayout()) });
      await capture(win, `home-runtime-${mode}`);
      await captureMusic(mode);
      if (mode === 'maximize') win.unmaximize();
      else win.setFullScreen(false);
      await wait(400);
    }

    assert.deepEqual(await evaluate(() => window.api.stateGet('pet')), storedPet, 'Window resizing must not change saved pet preferences');
    // A freely positioned pet can overlap content. At 200% browser zoom, park
    // her in the center gap using a real drag before checking all home targets.
    await resize(1100, 760);
    await movePetToRatio(.5);
    storedPet = await evaluate(() => window.api.stateGet('pet'));
    for (const [width, height] of [[1100, 760], [800, 600]]) {
      for (const zoom of [1.25, 1.5, 2]) {
        await resize(width, height, zoom);
        report.checks.push({ name: `runtime home zoom ${zoom * 100}%`, ...await evaluate(() => __homeRuntimeLayout(false)) });
        await capture(win, `home-runtime-${width}x${height}-zoom-${zoom * 100}`);
      }
    }
    assert.deepEqual(await evaluate(() => window.api.stateGet('pet')), storedPet, 'Window resizing must not overwrite pet preferences or its saved position');
    check('resizing, maximizing, fullscreen and app zoom preserve saved pet data', true);
    // Real Tab input reaches every entry even at the smallest scaled composition.
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
        return { name: el.id || el.getAttribute('aria-label') || el.textContent.trim(), visible: el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) > 0 && r.top >= 0 && r.bottom <= innerHeight };
      });
      assert.equal(focus.name, label, 'Runtime Tab order');
      assert.ok(focus.visible, `Runtime focus must be visible: ${label}`);
    }
    check('all live homepage controls have visible keyboard focus at 200% zoom', true);
    await evaluate(() => document.activeElement.blur());
    await resize(1100, 760);
    await movePetToRatio(originalPetRatio);
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

    const petSnapshot = () => evaluate(() => {
      const r = document.getElementById('gaia-pet').getBoundingClientRect();
      const c = document.querySelector('#home-view .home-surface').getBoundingClientRect();
      return { ...GaiaPet.getState(), left: r.left, top: r.top, width: r.width, height: r.height, canvasScale: c.width / 1100 };
    });
    for (const [width, height] of [[800, 600], [1600, 1000], [800, 1000]]) {
      await resize(width, height);
      const before = await petSnapshot();
      const drag = async (dx, dy) => {
        const pet = await petSnapshot();
        const x = Math.round(pet.left + pet.width / 2);
        const y = Math.round(pet.top + pet.height / 2);
        mouse('mouseMove', x, y);
        mouse('mouseDown', x, y);
        await wait(20);
        mouse('mouseMove', x + dx, y + dy, 'left', true);
        await wait(20);
        mouse('mouseUp', x + dx, y + dy);
        await wait(40);
        assert.equal(await evaluate(() => document.getElementById('gaia-pet').classList.contains('dragging')), false, 'Pet must release pointer capture');
      };
      await drag(-36, -24);
      const moved = await petSnapshot();
      assert.ok(Math.abs(moved.left - before.left + 36) < .1 && Math.abs(moved.top - before.top + 24) < .1, `Pet must follow the pointer at ${width}×${height}: ${JSON.stringify({ before, moved })}`);
      assert.ok(Math.abs(moved.x - before.x + 36) < .1, 'Drag must keep unscaled viewport coordinates');
      await drag(36, 24);
      const restored = await petSnapshot();
      assert.ok(Math.abs(restored.x - before.x) < .1 && Math.abs(restored.y - before.y) < .1, 'Scaled pet drag must be reversible');
      await evaluate(() => document.querySelector('#gaia-pet .gaia-pet-hitbox').focus());
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
      await settle();
      const shifted = await petSnapshot();
      assert.ok(Math.abs(shifted.left - restored.left + 8) < .1, 'Keyboard movement must remain eight viewport pixels');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
      await settle();
      const playing = await evaluate(() => GaiaBgm.getState().on);
      await click('#home-bgm-slot [data-action="play"]');
      assert.equal(await evaluate(() => GaiaBgm.getState().on), !playing, 'Scaled music button must respond to actual mouse input');
      await click('#home-bgm-slot [data-action="play"]');
      const pet = await petSnapshot();
      mouse('mouseDown', pet.left + pet.width / 2, pet.top + pet.height / 2, 'right');
      mouse('mouseUp', pet.left + pet.width / 2, pet.top + pet.height / 2, 'right');
      await wait(30);
      check(`pet context menu fits the window at ${width}×${height}`, await evaluate(() => {
        const panel = document.querySelector('.gaia-pet-console');
        const r = panel.getBoundingClientRect();
        return !panel.hidden && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      }));
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait(50);
      check(`real drag, keyboard and music clicks work at ${width}×${height}`, true);
    }
    await resize(1100, 760);
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

    for (const [width, height] of [[800, 600], [1600, 1000], [800, 1000]]) {
      await resize(width, height);
      // Inspect the real animation at time zero to catch a scaled FLIP jump.
      const animation = await evaluate(async () => {
        const rect = () => {
          const r = document.getElementById('bgm-capsule').getBoundingClientRect();
          return [r.left, r.top, r.width, r.height];
        };
        const start = rect();
        document.getElementById('btn-home-settings').click();
        const entry = document.getElementById('bgm-capsule').getAnimations().find((a) => a.id === 'bgm-settings-entry-flip');
        if (!entry) throw new Error('Missing settings entry animation');
        entry.pause(); entry.currentTime = 0;
        const entryStart = rect();
        entry.finish();
        await __uiSmoke.wait(320);
        const away = rect();
        document.getElementById('btn-settings-close').click();
        const restore = document.getElementById('bgm-capsule').getAnimations().find((a) => a.id === 'bgm-settings-restore-flip');
        if (!restore) throw new Error('Missing settings return animation');
        restore.pause(); restore.currentTime = 0;
        const returnStart = rect();
        const stage = document.querySelector('#home-view .home-stage');
        const unclipped = getComputedStyle(stage).overflow === 'visible';
        restore.finish();
        await __uiSmoke.wait(320);
        return { start, entryStart, away, returnStart, end: rect(), unclipped, cleaned: stage.style.overflow === '' };
      });
      for (const [a, b] of [[animation.start, animation.entryStart], [animation.away, animation.returnStart], [animation.start, animation.end]]) {
        a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1, `Scaled music animation jumps at ${width}×${height}: ${a} vs ${b}`));
      }
      check(`settings music animation keeps its position and size at ${width}×${height}`, animation.unclipped && animation.cleaned);
      const state = await evaluate(() => GaiaPet.getState());
      await click('#btn-home-shelf');
      await wait(320);
      check(`leaving home removes pet presentation scaling at ${width}×${height}`, await evaluate(() => {
        const pet = document.getElementById('gaia-pet');
        return __gaiaDebug.getView() === 'library' && pet.style.transform === '' && pet.getBoundingClientRect().width === pet.offsetWidth;
      }));
      await click('#btn-back-home');
      await wait(320);
      assert.equal((await petSnapshot()).width, 150 * petScale, 'Returning home must retain the original pet size');
      const after = await evaluate(() => GaiaPet.getState());
      assert.equal(after.scale, state.scale);
      assert.equal(after.xRatio, state.xRatio);
      assert.equal(after.yRatio, state.yRatio);
      check(`real shelf navigation returns to the same home composition at ${width}×${height}`, true);
    }

    const setPetScale = (value) => evaluate((value) => {
      const select = [...document.querySelectorAll('.gaia-pet-console select')].find((el) => el.querySelector('option[value="1.5"]'));
      select.value = String(value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await setPetScale(1.5);
    const customPet = await petSnapshot();
    await evaluate(() => GaiaPet.setEnabled(false));
    await resize(1600, 1000);
    await evaluate(() => GaiaPet.setEnabled(true));
    await settle();
    const shown = await petSnapshot();
    assert.equal(shown.scale, 1.5, 'Home fitting must preserve the user-selected pet size');
    assert.equal(shown.xRatio, customPet.xRatio);
    assert.equal(shown.yRatio, customPet.yRatio);
    assert.ok(shown.width === 225 && shown.left + shown.width <= 1600 && shown.top + shown.height <= 1000, 'Re-enabled pet must retain its user-selected size and stay reachable');
    check('hiding and re-enabling a custom-sized pet after resize preserves its preferences and position', true);
    await setPetScale(petScale);
    await resize(1100, 760);
    await evaluate(() => document.activeElement.blur());
    await require('./home-pet-checks')({ win, evaluate, resize, setPetScale, check });
    await require('./home-interaction-checks')({ win, evaluate, resize, check, capture });
  } catch (error) {
    await capture(win, 'home-runtime-failure');
    throw error;
  }
};
