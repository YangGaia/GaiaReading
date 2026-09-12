'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async ({ win, report, check, capture, click }) => {
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async fn => {
    for (let i = 0; i < 80; i++) { if (await evaluate(fn)) return; await wait(50); }
    throw new Error(`Marquee state timed out: ${fn}`);
  };
  const info = () => evaluate(() => GaiaBgm.marqueeInfo());
  const moveAway = () => win.webContents.sendInputEvent({ type: 'mouseMove', x: 400, y: 300 });
  await evaluate(() => {
    window.__titleAnimation = () => document.querySelector('.bgm-title-track').getAnimations().find(a => a.id === 'bgm-title-marquee');
    window.__marqueeMeasure = () => {
      const title = document.querySelector('.bgm-title'), track = title.querySelector('.bgm-title-track');
      const controls = [...document.querySelectorAll('#bgm-capsule .bgm-cover, #bgm-capsule button, #bgm-capsule input')];
      return { ...GaiaBgm.marqueeInfo(), x: new DOMMatrixReadOnly(getComputedStyle(track).transform).m41,
        controls: controls.map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }) };
    };
  });
  moveAway();
  await until(() => !!__titleAnimation());
  const initial = await evaluate(() => __marqueeMeasure());
  check('long title initially holds its first characters for one second', initial.currentTime < 1000 && initial.x === 0);
  await wait(1250);
  const before = await evaluate(() => __marqueeMeasure());
  await wait(400);
  const after = await evaluate(() => __marqueeMeasure());
  const speed = -(after.x - before.x) / ((after.currentTime - before.currentTime) / 1000);
  check('real elapsed time moves the title left at 22 CSS pixels per second', after.x < before.x && Math.abs(speed - 22) < .1);
  assert.deepEqual(after.controls, before.controls, 'Cover and controls must not move with the title');
  check('only the title moves', true);
  check('the second copy is visually identical and hidden from assistive technology', await evaluate(() => {
    const original = document.querySelector('.bgm-title-text'), copy = document.querySelector('.bgm-title-copy');
    return original.textContent === copy.textContent && copy.getAttribute('aria-hidden') === 'true' && !copy.hidden;
  }));
  const hover = await evaluate(() => { const r = document.querySelector('.bgm-title').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  win.webContents.sendInputEvent({ type: 'mouseMove', ...hover });
  await until(() => __titleAnimation().playState === 'paused');
  const paused = (await info()).currentTime;
  await wait(250);
  check('hover freezes the animation at its current position', Math.abs((await info()).currentTime - paused) < 1);
  moveAway();
  await until(() => __titleAnimation().playState === 'running');
  await wait(150);
  check('pointer exit continues from the paused position', (await info()).currentTime > paused);

  await evaluate(() => { window.__savedTitleAnimation = __titleAnimation(); });
  const originalVolume = await evaluate(() => GaiaBgm.getState().volume);
  for (const action of ['mute', 'mute', 'play', 'play']) await click(`#bgm-capsule [data-action="${action}"]`);
  await evaluate(() => { const volume = document.querySelector('#bgm-capsule .bgm-volume'); volume.value = '37'; volume.dispatchEvent(new Event('input', { bubbles: true })); });
  check('volume, mute and play keep the same animation instance and phase', await evaluate(() => __titleAnimation() === __savedTitleAnimation && __titleAnimation().currentTime > 3000));
  await evaluate(volume => GaiaBgm.setVolume(volume), originalVolume);
  await click('#bgm-capsule [data-action="next"]');
  check('switching to a short title cancels motion and hides the duplicate', await evaluate(() => {
    const title = document.querySelector('.bgm-title');
    return GaiaBgm.getState().trackId === 'aoko' && !__titleAnimation() && document.querySelector('.bgm-title-copy').hidden && title.scrollWidth <= title.clientWidth;
  }));
  for (let i = 0; i < 3; i++) await click('#bgm-capsule [data-action="next"]');
  check('switching back to a long title starts a fresh initial hold', (await info()).currentTime < 1000);
  win.webContents.focus();
  await evaluate(() => document.querySelector('#bgm-capsule [data-action="prev"]').focus());
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] });
  await until(() => __titleAnimation().playState === 'paused');
  check('keyboard users can focus the complete title and pause it', await evaluate(() => document.activeElement.matches('.bgm-title') && getComputedStyle(document.activeElement).outlineStyle === 'solid'));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await until(() => __titleAnimation().playState === 'running');
  await evaluate(() => { window.__savedTitleAnimation = __titleAnimation(); });
  win.setContentSize(800, 600);
  await wait(300);
  report.checks.push(await evaluate(() => __checkReaderChrome()));
  check('narrow reader remains a single row without restarting the title', await evaluate(() => __titleAnimation() === __savedTitleAnimation));
  await click('#btn-settings-reader');
  check('moving beside settings retains the loop and readable viewport', await evaluate(() => __titleAnimation() === __savedTitleAnimation && document.querySelector('.bgm-title').clientWidth >= 96));
  await click('#btn-settings-close');
  await evaluate(() => __gaiaDebug.showView('home'));
  await until(() => !__titleAnimation());
  check('leaving the reader removes the animation and duplicate', await evaluate(() => document.querySelector('.bgm-title-copy').hidden));
  await evaluate(() => __gaiaDebug.showView('reader'));
  await until(() => !!__titleAnimation());
  moveAway();

  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await until(() => !__titleAnimation());
    check('reduced motion uses static text with its complete tooltip', await evaluate(() => document.querySelector('.bgm-title-copy').hidden && document.querySelector('.bgm-title').title.includes(GaiaBgm.marqueeInfo().text)));
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    await until(() => !!__titleAnimation());
  } finally { win.webContents.debugger.detach(); }
  // The smoke harness disables throttling to capture animations. Electron
  // intentionally keeps document.hidden false in that mode; restore normal
  // window visibility semantics for this lifecycle check.
  win.webContents.setBackgroundThrottling(true);
  win.hide();
  await until(() => document.hidden && __titleAnimation().playState === 'paused');
  const hiddenTime = (await info()).currentTime;
  await wait(200);
  check('hidden application pauses background animation', (await info()).currentTime === hiddenTime);
  win.showInactive();
  moveAway();
  await until(() => !document.hidden && __titleAnimation().playState === 'running');
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1100, 760);
  await wait(300);

  // Sample both sides of the actual wrap boundary. Seeking only controls the
  // test clock; all pixels still come from the real renderer and animation.
  const clip = await evaluate(() => { const r = document.getElementById('bgm-capsule').getBoundingClientRect(); return { x: Math.floor(r.x - 4), y: Math.floor(r.y - 4), width: Math.ceil(r.width + 8), height: Math.ceil(r.height + 8) }; });
  const timing = await info();
  const seek = async time => evaluate(async time => {
    const animation = __titleAnimation(); animation.pause(); animation.currentTime = time;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, time);
  await seek(timing.delay + timing.duration - .01);
  const end = await win.webContents.capturePage(clip);
  await seek(timing.delay + timing.duration);
  const start = await win.webContents.capturePage(clip);
  const left = end.toBitmap(), right = start.toBitmap();
  let difference = 0;
  assert.equal(left.length, right.length);
  for (let i = 0; i < left.length; i++) difference += Math.abs(left[i] - right[i]);
  report.marqueeSeamMeanDifference = difference / left.length;
  check('loop boundary renders the same pixels without a visible jump', report.marqueeSeamMeanDifference < .15);
  const visibleCharacters = await evaluate(async () => {
    const original = document.querySelector('.bgm-title-text');
    const viewport = document.querySelector('.bgm-title');
    const animation = __titleAnimation(), duration = animation.effect.getTiming().duration;
    const covered = new Set();
    for (let step = 0; step <= 24; step++) {
      animation.currentTime = 1000 + duration * step / 24;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const v = viewport.getBoundingClientRect();
      for (let i = 0; i < original.textContent.length; i++) {
        const r = document.createRange(); r.setStart(original.firstChild, i); r.setEnd(original.firstChild, i + 1);
        const b = r.getBoundingClientRect();
        if (b.left >= v.left - .1 && b.right <= v.right + .1) covered.add(i);
      }
    }
    return { count: covered.size, length: original.textContent.length };
  });
  check('every character becomes completely visible during a cycle', visibleCharacters.count === visibleCharacters.length);
  const framesDir = path.join(report.outputDir, 'marquee-frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const frames = Math.ceil(timing.duration / 100);
  report.marqueeRecording = { directory: framesDir, frames, duration: timing.duration, frameMs: timing.duration / frames };
  for (let i = 0; i < frames; i++) {
    await seek(timing.delay + timing.duration * i / frames);
    fs.writeFileSync(path.join(framesDir, `${String(i).padStart(3, '0')}.png`), (await win.webContents.capturePage(clip)).toPNG());
  }
  await seek(timing.delay + 2000);
  await capture(win, 'reader-marquee-1100x760');
  await evaluate(() => __titleAnimation().play());
};
