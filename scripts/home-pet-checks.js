'use strict';

const assert = require('node:assert/strict');

// Exercise the real pointer-capture handlers at the window edges, including
// the margins outside the centered homepage. No direct position setters.
module.exports = async ({ win, evaluate, resize, setPetScale, check }) => {
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
};
