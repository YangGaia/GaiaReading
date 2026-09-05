'use strict';

const assert = require('node:assert/strict');

// Uses only the isolated library and preferences created by non-reading-smoke.
module.exports = async ({ win, report, check, capture, books }) => {
  const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = async () => { await wait(320); await evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await settle();
  };
  const resize = async (width, height, zoom = 1) => {
    win.setContentSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await settle();
  };
  await evaluate(async () => {
    await document.querySelector('.library-robin').decode();
    await document.fonts.ready;
    document.getElementById('bookshelf').scrollTop = 0;
  });
  check('library uses the user illustration, non-intercepting ornaments and native card semantics', await evaluate(() => {
    const bird = document.querySelector('.library-robin');
    return bird.naturalWidth > 800 && bird.src.endsWith('/images/library/robin.png') &&
      [...document.querySelectorAll('.library-ornament')].every((el) => el.getAttribute('aria-hidden') === 'true' && getComputedStyle(el).pointerEvents === 'none') &&
      [...document.querySelectorAll('.book-card')].every((el) => el.tabIndex === 0 && el.getAttribute('role') === 'button' && el.getAttribute('aria-label'));
  }));
  for (const [width, height, zoom] of [[800, 600, 1], [1100, 760, 1], [1600, 1000, 1], [1920, 1080, 1], [2560, 1080, 1], [800, 600, 1.25]]) {
    await resize(width, height, zoom);
    const layout = await evaluate(() => {
      const requireTrue = (ok, message) => { if (!ok) throw new Error(message); };
      const cards = [...document.querySelectorAll('.book-card')];
      const content = document.querySelector('.library-content').getBoundingClientRect();
      const screen = document.getElementById('library-view');
      requireTrue(screen.scrollWidth <= screen.clientWidth, 'Library must not overflow horizontally');
      requireTrue(Math.abs(content.left - (innerWidth - content.right)) < 2, 'Library content must stay centered between ornaments');
      for (const card of cards) {
        const jacket = card.querySelector('.book-jacket').getBoundingClientRect();
        const cover = card.querySelector('.book-cover').getBoundingClientRect();
        requireTrue(cover.left >= jacket.left + 8 && cover.right <= jacket.right - 8 && cover.top >= jacket.top + 8 && cover.bottom <= jacket.bottom - 8, 'Cover must fit inside its display mount with breathing room');
        requireTrue(Math.abs(cover.width / cover.height - 2 / 3) < .015, 'Image and placeholder covers must keep their book proportions');
        requireTrue(getComputedStyle(card.querySelector('.book-title')).fontSize === '13px', 'Shelf labels must remain readable as column count changes');
      }
      for (const selector of ['.library-robin', '.library-moon']) {
        const r = document.querySelector(selector).getBoundingClientRect();
        requireTrue(r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, `${selector} must remain on screen`);
        requireTrue(r.right <= content.left || r.left >= content.right, `${selector} must remain outside the books at ${innerWidth}: [${r.left}, ${r.right}] / [${content.left}, ${content.right}]`);
      }
      return { width: innerWidth, height: innerHeight, columns: getComputedStyle(document.getElementById('bookshelf')).gridTemplateColumns.split(' ').length, covers: cards.length };
    });
    report.checks.push({ name: 'library display mounts and ornaments fit', ...layout });
    await capture(win, `library-detail-${width}x${height}-${zoom}`);
  }
  await resize(1100, 760);
  const before = await evaluate(() => document.querySelector('.book-card').getBoundingClientRect().toJSON());
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(before.left + before.width / 2), y: Math.round(before.top + 60) });
  await settle();
  check('book hover lifts the mount without resizing content and reveals its reading arrow', await evaluate((before) => {
    const card = document.querySelector('.book-card');
    const r = card.getBoundingClientRect();
    return Math.abs(r.top - before.top + 3) < .1 && r.width === before.width && r.height === before.height && getComputedStyle(card.querySelector('.book-open-mark')).opacity === '1';
  }, before));
  await capture(win, 'library-book-hover');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await evaluate(() => document.getElementById('btn-manage').click());
  await settle();
  win.webContents.focus();
  await evaluate(() => document.querySelector('.book-card').focus());
  await key('Tab');
  await key('Tab', ['shift']);
  check('book cards expose a visible keyboard focus', await evaluate(() => document.activeElement === document.querySelector('.book-card') && document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2));
  await key('Space');
  check('Space selects exactly one book without opening it in management mode', await evaluate(() => __gaiaDebug.getView() === 'library' && __gaiaDebug.getSelectedCount() === 1 && document.querySelector('.book-card').getAttribute('aria-pressed') === 'true'));
  await key('Enter');
  check('Enter deselects the same book in management mode', await evaluate(() => __gaiaDebug.getSelectedCount() === 0 && document.querySelector('.book-card').getAttribute('aria-pressed') === 'false'));
  await evaluate(() => document.getElementById('btn-exit-manage').click());
  await settle();
  await evaluate(() => document.querySelector('.book-card').focus());
  await key('Enter');
  check('Enter opens the focused book through the existing reader', await evaluate(() => __gaiaDebug.getView() === 'reader'));
  await evaluate(async () => __gaiaDebug.backToLibrary());
  await evaluate(async (book) => __gaiaDebug.openBook(book), books[0]);
  const playback = await evaluate(() => GaiaBgm.getState());
  let reference;
  for (const view of ['home', 'library', 'stats', 'ai', 'reader']) {
    await evaluate((view) => __gaiaDebug.showView(view), view);
    await settle();
    await capture(win, `music-shared-${view}`);
    const paint = await evaluate(() => {
      const player = document.getElementById('bgm-capsule');
      window.__sharedMusicNode ||= player;
      if (player !== __sharedMusicNode || document.querySelectorAll('#bgm-capsule').length !== 1) throw new Error('Pages must share the same music instance');
      const p = getComputedStyle(player);
      const title = getComputedStyle(player.querySelector('.bgm-title'));
      if (p.backdropFilter !== 'none' || p.transform !== 'none' || player.scrollWidth > player.clientWidth) throw new Error('Music must render sharply and fit its capsule');
      for (const el of player.querySelectorAll('button, input')) {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (r.width < 24 || r.height < 24 || r.right > innerWidth || !(hit === el || el.contains(hit))) throw new Error(`Music ${player.dataset.view}/${el.dataset.action || 'volume'} at ${JSON.stringify(r.toJSON())} is clipped or covered by ${hit && (hit.id || hit.className)}`);
      }
      return [p.backgroundImage, p.backgroundColor, p.borderRadius, p.borderColor, title.color, title.fontSize, title.fontFamily, getComputedStyle(player.querySelector('.bgm-btn'), '::before').maskImage];
    });
    reference ||= paint;
    assert.deepEqual(paint, reference, `${view} music matches the approved home material`);
    assert.deepEqual(await evaluate(() => GaiaBgm.getState()), playback, `${view} navigation keeps playback preferences`);
    check(`${view} keeps the same sharp music surface and reachable controls`, true);
  }
  await evaluate(() => __gaiaDebug.openSettings());
  await settle();
  const settingsPaint = await evaluate(() => {
    const player = document.getElementById('bgm-capsule');
    const p = getComputedStyle(player);
    const title = getComputedStyle(player.querySelector('.bgm-title'));
    return [p.backgroundImage, p.backgroundColor, p.borderRadius, p.borderColor, title.color, title.fontSize, title.fontFamily, getComputedStyle(player.querySelector('.bgm-btn'), '::before').maskImage];
  });
  assert.deepEqual(settingsPaint, reference, 'Opening settings retains the shared music material');
  check('settings keeps the same music surface beside the drawer', true);
  await evaluate(() => __gaiaDebug.closeSettings());
  await settle();
  await resize(800, 600);
  check('compact reader keeps all four music buttons and volume reachable', await evaluate(() => {
    const player = document.getElementById('bgm-capsule');
    return player.getBoundingClientRect().height === 52 && player.scrollWidth <= player.clientWidth && [...player.querySelectorAll('button, input')].every((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.width >= 24 && r.height >= 24 && r.left >= 0 && r.right <= innerWidth && (hit === el || el.contains(hit));
    });
  }));
  await capture(win, 'music-reader-800x600');
  await resize(1100, 760);
  await evaluate(async () => __gaiaDebug.backToLibrary());
};
