'use strict';

const assert = require('node:assert/strict');

module.exports = async ({ win, report, check, capture }) => {
  const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = async () => {
    await wait(220);
    await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const playback = await evaluate(() => GaiaBgm.getState());
  const snapshot = () => evaluate(() => {
    const player = document.getElementById('bgm-capsule');
    const rect = player.getBoundingClientRect();
    const style = getComputedStyle(player);
    const scale = player.dataset.view === 'reader' ? 1 : Math.min(innerWidth / 1100, innerHeight / 760);
    const fail = (ok, message) => { if (!ok) throw new Error(`${player.dataset.view} ${innerWidth}×${innerHeight}: ${message}`); };
    fail(style.transform === 'none' && style.filter === 'none' && style.backdropFilter === 'none', 'music must paint at native resolution');
    fail(player.scrollWidth <= player.clientWidth + 1 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, 'capsule must fit on screen');
    fail(Math.abs(rect.width - 336 * scale) < .1, 'capsule width must follow its view scale');
    fail(Math.abs(rect.height - 52 * scale) < 1.1, 'capsule height must follow its view scale');
    if (player.dataset.view === 'reader') {
      const title = player.querySelector('.bgm-title');
      const cover = player.querySelector('.bgm-cover').getBoundingClientRect();
      const original = player.querySelector('.bgm-title-text');
      fail(title.clientWidth >= 96 && (original.offsetWidth <= title.clientWidth || title.dataset.scrolling === 'true'), 'reader title must fit or scroll in its compact viewport');
      fail(cover.width === 32 && cover.height === 32, 'reader cover must remain a visible square');
    }
    const text = getComputedStyle(player.querySelector('.bgm-title'));
    const icon = getComputedStyle(player.querySelector('.bgm-btn'), '::before');
    // Layout widths are quantized to 1/64 CSS px; font-size is not.
    fail(Math.abs(parseFloat(text.fontSize) - 12 * scale) < .01 && Math.abs(parseFloat(icon.width) - 17 * scale) < .02, `text and icons must redraw at the same scale: ${text.fontSize}/${icon.width} at ${scale}`);
    if (player.dataset.settingsOpen !== '1') {
      for (const control of player.querySelectorAll('button, input')) {
        const r = control.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        fail(r.width >= 24 * scale && r.height >= 24 * scale && (hit === control || control.contains(hit)), 'music controls must stay reachable');
      }
    } else {
      fail(rect.right <= document.getElementById('settings-drawer').getBoundingClientRect().left - 16, 'music must clear the settings drawer');
    }
    return { width: rect.width, height: rect.height, title: text.fontSize, icon: icon.width, radius: style.borderRadius, padding: style.padding, gap: style.gap, scale };
  });
  let readerReference;
  for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000], [1440, 600], [800, 1000], [1920, 1080], [2560, 1080]]) {
    win.setContentSize(width, height);
    await settle();
    let home;
    for (const view of ['home', 'library', 'stats', 'ai', 'reader']) {
      await evaluate((view) => __gaiaDebug.showView(view), view);
      await settle();
      const metrics = await snapshot();
      if (view === 'home') home = metrics;
      else if (view === 'reader') {
        readerReference ||= metrics;
        assert.deepEqual(metrics, readerReference, 'Reader capsule size stays fixed across window sizes');
      } else assert.deepEqual(metrics, home, `${view} uses the same geometry as home at ${width}×${height}`);
      report.checks.push({ name: 'music follows home scale except in reader', view, viewport: [width, height], ...metrics });
      if (width === 800 && height === 600 || width === 1600) await capture(win, `music-responsive-${view}-${width}x${height}`);
      if (width === 800 && height === 600 || width === 1600) {
        await evaluate(() => __gaiaDebug.openSettings());
        await wait(350);
        assert.deepEqual(await snapshot(), metrics, `${view} opening settings does not resize the capsule`);
        await evaluate(() => __gaiaDebug.closeSettings());
        await wait(350);
        assert.deepEqual(await snapshot(), metrics, `${view} closing settings restores the same size`);
      }
    }
  }
  assert.deepEqual(await evaluate(() => GaiaBgm.getState()), playback, 'Resizing and switching pages keep music state');
  check('all music views preserve scale, settings clearance and playback state', true);
  win.setContentSize(1100, 760);
  await evaluate(() => __gaiaDebug.showView('library'));
  await settle();
};
