'use strict';

const assert = require('node:assert/strict');

module.exports = async ({ win, evaluate, resize, check, capture }) => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  const key = async (keyCode) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    // Electron exposes the character/keypress stage separately from raw keydown.
    if (keyCode === 'Enter' || keyCode === 'Space') win.webContents.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : ' ' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await wait(80);
  };
  const point = (selector, xRatio = .5) => evaluate((selector, ratio) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.left + r.width * ratio, y: r.top + r.height / 2 };
  }, selector, xRatio);
  const until = async (fn, ...args) => {
    for (let i = 0; i < 80; i += 1) { if (await evaluate(fn, ...args)) return; await wait(25); }
    throw new Error(`Home interaction did not settle: ${fn}`);
  };
  await evaluate(() => {
    window.__homeActionClicks = {};
    document.querySelector('.home-actions').addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button) __homeActionClicks[button.id] = (__homeActionClicks[button.id] || 0) + 1;
    });
  });
  try {
    for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000]]) {
      await resize(width, height);
      mouse('mouseMove', 1, 1);
      await wait(350);
      const labelBefore = await evaluate(() => document.querySelector('#btn-home-shelf > span').getBoundingClientRect().toJSON());
      for (const ratio of [.25, .75]) {
        const p = await point('#btn-home-shelf', ratio);
        mouse('mouseMove', p.x, p.y);
        await until((expected) => Math.abs(parseFloat(document.getElementById('btn-home-shelf').style.getPropertyValue('--hover-x')) - expected) < 1, ratio * 100);
      }
      await wait(320);
      check(`pointer light follows the same relative position at ${width}`, await evaluate(() => {
        const button = document.getElementById('btn-home-shelf');
        return getComputedStyle(button, '::after').opacity === '1' && getComputedStyle(button, '::after').pointerEvents === 'none' && getComputedStyle(button).transform === 'none';
      }));
      const labelAfter = await evaluate(() => document.querySelector('#btn-home-shelf > span').getBoundingClientRect().toJSON());
      assert.deepEqual(labelAfter, labelBefore, 'Hover light and shadow must not move or scale the label');
      await capture(win, `home-primary-hover-${width}x${height}`);
      const p = await point('#btn-home-shelf');
      mouse('mouseMove', p.x, p.y);
      mouse('mouseDown', p.x, p.y);
      await until(() => document.getElementById('btn-home-shelf').matches(':active'));
      await wait(120);
      check(`pressed surface has a recessed shadow at ${width}`, await evaluate(() => {
        const style = getComputedStyle(document.getElementById('btn-home-shelf'));
        return style.boxShadow.includes('inset') && new DOMMatrix(style.transform).m42 > 0 && style.backgroundColor === 'rgb(40, 51, 68)';
      }));
      await capture(win, `home-primary-pressed-${width}x${height}`);
      // Releasing away cancels activation just like a native button should.
      mouse('mouseMove', 1, 1);
      mouse('mouseUp', 1, 1);
      await wait(300);
      check(`cancelled press preserves home navigation at ${width}`, await evaluate(() => __gaiaDebug.getView() === 'home' && !document.getElementById('btn-home-shelf').style.getPropertyValue('--hover-x')));
      for (const selector of ['#btn-home-add-books', '#btn-home-ai']) {
        const p = await point(selector);
        mouse('mouseMove', p.x, p.y);
        await until((selector) => document.querySelector(selector).matches(':hover'), selector);
        await wait(340);
        check(`secondary line and icon respond at ${width} ${selector}`, await evaluate((selector) => {
          const button = document.querySelector(selector);
          const scale = parseFloat(getComputedStyle(document.getElementById('home-view')).getPropertyValue('--home-unit'));
          const hit = document.elementFromPoint(button.getBoundingClientRect().x + button.offsetWidth / 2, button.getBoundingClientRect().y + button.offsetHeight / 2);
          return parseFloat(getComputedStyle(button, '::before').width) >= 37 * scale && getComputedStyle(button.querySelector('.action-icon')).transform !== 'none' && (button === hit || button.contains(hit));
        }, selector));
        if (width === 1100) await capture(win, `home-${selector.slice(10)}-hover-${width}x${height}`);
      }
    }
    mouse('mouseMove', 1, 1);
    await resize(1100, 760);
    win.webContents.focus();
    // Existing business handlers still receive one native activation per keypress.
    await evaluate(() => document.getElementById('btn-home-shelf').focus());
    await key('Enter');
    await until(() => __gaiaDebug.getView() === 'library');
    check('Enter activates the original shelf handler exactly once', await evaluate(() => __homeActionClicks['btn-home-shelf'] === 1));
    await evaluate(() => document.getElementById('btn-back-home').click());
    await wait(500);
    await evaluate(() => document.getElementById('btn-home-add-books').focus());
    await key('Space');
    await until(() => !document.getElementById('book-import-overlay').hidden);
    check('Space activates the original import dialog exactly once', await evaluate(() => __homeActionClicks['btn-home-add-books'] === 1));
    await evaluate(() => document.getElementById('btn-book-import-close').click());
    await evaluate(() => document.getElementById('btn-home-ai').focus());
    await key('Enter');
    await until(() => __gaiaDebug.getView() === 'ai');
    check('Enter activates the original AI page exactly once', await evaluate(() => __homeActionClicks['btn-home-ai'] === 1));
    await evaluate(() => document.getElementById('btn-ai-back').click());
    await wait(500);

    const entry = await evaluate(async () => {
      __gaiaDebug.showView('library');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const hiddenClean = !document.getAnimations().some((animation) => animation.id.startsWith('home-entry-'));
      __gaiaDebug.showView('home');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const animations = document.getAnimations().filter((animation) => animation.id === 'view-content-enter');
      const noStagger = !document.getAnimations().some((animation) => animation.id.startsWith('home-entry-'));
      const shortEntrance = animations.length === 1 && animations[0].effect.getTiming().duration === 200 &&
        animations[0].effect.target === document.querySelector('.study-layout');
      for (const animation of animations) { animation.pause(); animation.currentTime = 70; }
      return { hiddenClean, noStagger, shortEntrance };
    });
    check('returning home uses one short entrance without stacked staggered reveals', entry.hiddenClean && entry.noStagger && entry.shortEntrance);
    await capture(win, 'home-entry-feedback-1100x760');
    await evaluate(() => { for (const animation of document.getAnimations().filter((animation) => animation.id === 'view-content-enter')) animation.finish(); });
    await until(() => !document.getAnimations().some((animation) => animation.id === 'view-content-enter'));

    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await until(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    const p = await point('#btn-home-ai');
    mouse('mouseMove', p.x, p.y);
    await wait(100);
    check('reduced motion disables moving light and icon motion', await evaluate(() => {
      const button = document.getElementById('btn-home-ai');
      return !button.style.getPropertyValue('--hover-x') && getComputedStyle(button.querySelector('.action-icon')).transform === 'none' && getComputedStyle(button).transitionDuration === '0s';
    }));
    await evaluate(async () => {
      __gaiaDebug.showView('library');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      __gaiaDebug.showView('home');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    check('reduced motion skips entry animations and keeps controls visible', await evaluate(() => !document.getAnimations().some((animation) => animation.id.startsWith('home-entry-') || animation.id === 'view-content-enter') && getComputedStyle(document.querySelector('.study-layout')).opacity === '1' && getComputedStyle(document.getElementById('btn-home-shelf')).opacity === '1'));
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    win.webContents.debugger.detach();
    mouse('mouseMove', 1, 1);
    await evaluate(() => document.getElementById('btn-home-shelf').focus());
    await key('Tab');
    check('keyboard focus has an explicit high-contrast outline', await evaluate(() => document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2));
    await capture(win, 'home-keyboard-focus-1100x760');
    await evaluate(() => document.activeElement.blur());
    await wait(350);
  } finally {
    if (win.webContents.debugger.isAttached()) {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      win.webContents.debugger.detach();
    }
  }
};
