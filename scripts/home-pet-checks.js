'use strict';

const assert = require('node:assert/strict');

// Exercise the real pointer-capture handlers at the window edges, including
// the margins outside the centered homepage. No direct position setters.
async function checkPet({ win, evaluate, resize, setPetScale, check, capture }) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const snapshot = () => evaluate(() => {
    const pet = document.getElementById('gaia-pet');
    const r = pet.getBoundingClientRect();
    return { ...GaiaPet.getState(), left: r.left, top: r.top, width: r.width, height: r.height,
      maxX: innerWidth - pet.offsetWidth, maxY: innerHeight - pet.offsetHeight,
      transform: getComputedStyle(pet).transform, dragging: pet.classList.contains('dragging') };
  });
  const mouse = (type, x, y, held = false) => win.webContents.sendInputEvent({
    type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
    modifiers: held ? ['leftButtonDown'] : [],
  });
  async function dragTo(x, y) {
    const start = await snapshot();
    mouse('mouseMove', start.left + start.width / 2, start.top + start.height / 2);
    mouse('mouseDown', start.left + start.width / 2, start.top + start.height / 2);
    await wait(15);
    mouse('mouseMove', x, y, true);
    await wait(20);
    mouse('mouseUp', x, y);
    await wait(25);
    const end = await snapshot();
    assert.equal(end.dragging, false, 'Releasing the pointer must end dragging');
    return end;
  }
  const original = await snapshot();
  const controls = await evaluate(() => {
    GaiaPet.openConsole();
    const panel = document.querySelector('.gaia-pet-console');
    const groupDimensions = (selector) => [...panel.querySelectorAll(selector)].map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight };
    });
    const groups = [groupDimensions('[data-emotion]'), groupDimensions('[data-action]'), groupDimensions('select'), groupDimensions('input[type="checkbox"]')];
    const close = panel.querySelector('.gaia-pet-console-close');
    const icon = close.querySelector('svg');
    GaiaPet.closeConsole();
    return { groups, closeLabel: close.getAttribute('aria-label'), closeIcon: !!icon && icon.getAttribute('aria-hidden') === 'true' };
  });
  for (const group of controls.groups) {
    assert.ok(group.length > 1 && group.every((item) => Math.abs(item.width - group[0].width) < .1 && item.height === group[0].height), 'Controls in each pet console group must use matching dimensions');
    assert.ok(group.every((item) => !item.clipped), 'Pet console labels must fit their controls');
  }
  assert.ok(controls.closeLabel && controls.closeIcon, 'The console close icon must retain an accessible label');
  check('pet console groups use matching control dimensions without clipped labels', true);
  for (const scale of [0.75, 1, 1.5]) {
    await setPetScale(scale);
    for (const [width, height] of [[800, 600], [1600, 1000], [2560, 1080], [800, 1000]]) {
      await resize(width, height);
      const fixed = await snapshot();
      assert.equal(fixed.width, Math.round(150 * scale), 'Only the user setting may change pet size');
      assert.equal(fixed.transform, 'none', 'The homepage must not transform the pet');
      for (const [x, y, right, bottom] of [[0, 0, false, false], [width - 1, 0, true, false], [width - 1, height - 1, true, true], [0, height - 1, false, true]]) {
        const pet = await dragTo(x, y);
        assert.ok(Math.abs(pet.left - (right ? pet.maxX : 0)) < .1, `Horizontal air wall at ${width}×${height}, size ${scale}: ${JSON.stringify(pet)}`);
        assert.ok(Math.abs(pet.top - (bottom ? pet.maxY : 0)) < .1, `Vertical air wall at ${width}×${height}, size ${scale}: ${JSON.stringify(pet)}`);
        assert.equal(pet.width, fixed.width);
        assert.equal(pet.height, fixed.height);
        const persisted = await evaluate(() => window.api.stateGet('pet'));
        assert.equal(persisted.xRatio, right ? 1 : 0);
        assert.equal(persisted.yRatio, bottom ? 1 : 0);
        assert.equal(persisted.scale, scale);
        const overlay = await evaluate(() => {
          GaiaPet.speak('有珠的台词与控制台会分别显示，不遮挡彼此。', 4000);
          const bubble = document.querySelector('.gaia-pet-bubble');
          const natural = bubble.getBoundingClientRect();
          GaiaPet.openConsole();
          const panel = document.querySelector('.gaia-pet-console').getBoundingClientRect();
          const speech = bubble.getBoundingClientRect();
          const separate = panel.right <= speech.left || speech.right <= panel.left || panel.bottom <= speech.top || speech.bottom <= panel.top;
          const visible = [panel, speech].every((r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight);
          GaiaPet.closeConsole();
          const closed = bubble.getBoundingClientRect();
          const speechUnchanged = ['left', 'top', 'width', 'height'].every((key) => Math.abs(natural[key] - speech[key]) < .1 && Math.abs(natural[key] - closed[key]) < .1);
          return { separate, visible, speechUnchanged };
        });
        assert.ok(overlay.separate && overlay.visible, 'Pet console and speech must remain visible without overlap');
        assert.ok(overlay.speechUnchanged, 'Opening or closing the console must not move speech from its natural position');
        if (capture && scale === 1 && width === 800 && height === 600 && !right && !bottom) {
          await evaluate(() => GaiaPet.openConsole());
          await wait(220);
          await capture(win, 'pet-console-speech-800x600');
          await evaluate(() => {
            const panel = document.querySelector('.gaia-pet-console');
            panel.scrollTop = panel.scrollHeight;
          });
          await capture(win, 'pet-console-display-controls-800x600');
          await evaluate(() => {
            document.querySelector('.gaia-pet-console').scrollTop = 0;
            GaiaPet.closeConsole();
          });
        }
      }
      // Outward keys clamp at the real window edge; inward keys still move 8px.
      await evaluate(() => document.querySelector('#gaia-pet .gaia-pet-hitbox').focus());
      for (const [key, expected] of [['Left', 0], ['Right', 8], ['Left', 0]]) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
        let after;
        for (let i = 0; i < 40; i += 1) {
          await wait(25);
          after = await snapshot();
          if (after.left === expected) break;
        }
        assert.equal(after.left, expected, `${key} must move the pet to ${expected}px at ${width}×${height}`);
      }
      check(`pet reaches all four window corners at ${width}×${height}, user size ${scale * 100}%`, true);
    }
  }
  await setPetScale(original.scale);
  await resize(1100, 760);
  const pet = await snapshot();
  await dragTo(original.xRatio * pet.maxX + pet.width / 2, original.yRatio * pet.maxY + pet.height / 2);
  await evaluate(() => document.activeElement.blur());
}

module.exports = async (options) => {
  // Keep the real desktop cursor from injecting extra events during resize;
  // sendInputEvent still exercises Chromium's pointer-capture handlers.
  options.win.setIgnoreMouseEvents(true);
  try { await checkPet(options); }
  finally { options.win.setIgnoreMouseEvents(false); }
};
