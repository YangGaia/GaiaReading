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
  const search = (value) => evaluate((query) => {
    const input = document.getElementById('shelf-search-input');
    input.value = query;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, value);
  const searchState = () => evaluate(() => ({
    paths: [...document.querySelectorAll('.book-card:not([hidden])')].map((card) => card.dataset.path),
    selected: __gaiaDebug.getSelectedCount(),
    count: document.getElementById('shelf-search-status').textContent,
    empty: !document.getElementById('shelf-search-empty').hidden,
    libraryHint: !document.getElementById('library-hint').hidden,
    query: document.getElementById('shelf-search-input').value,
  }));
  await search('ＢＯＯＫ.txt 小川');
  const groupedPaths = new Set(books.filter((book) => book.author.startsWith('小川')).map((book) => book.path));
  const sortedMatches = (await evaluate(() => __gaiaDebug.getSortedLibrary())).filter((file) => groupedPaths.has(file));
  let found = await searchState();
  check('shelf search matches filename and author, handles full-width Latin and preserves reading order',
    found.paths.length === 3 && found.paths.join('\n') === sortedMatches.join('\n') && found.count === '找到 3 本');
  await search('小川');
  await settle();
  await capture(win, 'shelf-search-results');
  await resize(800, 600);
  await capture(win, 'shelf-search-800x600');
  await resize(1100, 760);
  await evaluate(() => {
    const input = document.getElementById('shelf-search-input');
    input.value = '未完成的输入';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  check('candidate text during IME composition leaves the visible results unchanged', (await searchState()).paths.length === 3);
  await evaluate(() => {
    const input = document.getElementById('shelf-search-input');
    input.value = '長日將盡 石黑';
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  found = await searchState();
  check('committed traditional Chinese matches title and author in simplified Chinese', found.paths.length === 1 && found.paths[0] === books[3].path);
  await evaluate(() => document.querySelector('.book-card:not([hidden])').click());
  await settle();
  check('a filtered book opens from its shelf card', await evaluate(() => __gaiaDebug.getView() === 'reader'));
  await evaluate(() => __gaiaDebug.backToLibrary());
  found = await searchState();
  check('returning from the reader keeps the query and the filtered book', found.query === '長日將盡 石黑' && found.paths.length === 1 && found.paths[0] === books[3].path);

  await evaluate(() => document.getElementById('btn-manage').click());
  await search('ＢＯＯＫ.txt');
  await evaluate(() => document.getElementById('btn-select-all').click());
  found = await searchState();
  check('select all applies to visible books only', found.selected === books.length - 1 && found.selected === found.paths.length && !found.paths.includes(books[0].path));
  await search('ＢＯＯＫ.txt 小川');
  found = await searchState();
  const removalPrompt = await evaluate(() => {
    const originalConfirm = window.confirm;
    let message = '';
    window.confirm = (text) => { message = text; return false; };
    try { document.getElementById('btn-remove-selected').click(); }
    finally { window.confirm = originalConfirm; }
    return message;
  });
  check('narrowing the search keeps visible selections, and removal lists exactly those books', found.selected === 3 &&
    removalPrompt.includes('移除选中的 3 本书') && books.every((book) => removalPrompt.includes(book.title) === groupedPaths.has(book.path)));
  await search('書架沒有的書名');
  found = await searchState();
  check('no results have a distinct empty state and clear the hidden selection', found.selected === 0 && found.paths.length === 0 && found.empty && !found.libraryHint);
  check('select all is unavailable when there are no matches', await evaluate(() => document.getElementById('btn-select-all').disabled));
  await evaluate(() => document.getElementById('btn-exit-manage').click());
  await settle();
  await capture(win, 'shelf-search-empty');
  await evaluate(() => document.getElementById('btn-shelf-search-clear').click());
  found = await searchState();
  check('the clear button restores the shelf and returns focus to search', found.paths.length === books.length && !found.query &&
    await evaluate(() => document.activeElement.id === 'shelf-search-input' && document.getElementById('btn-shelf-search-clear').hidden));
  await search('夜航');
  await evaluate(() => document.getElementById('btn-manage').focus());
  await key('F', ['control']);
  check('Ctrl+F focuses the search field and selects the existing query', await evaluate(() => {
    const input = document.getElementById('shelf-search-input');
    return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
  }));
  await key('Escape');
  check('Escape clears the focused shelf search', (await searchState()).paths.length === books.length);

  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  for (const [width, height, zoom] of [[800, 600, 1], [1100, 760, 1], [1600, 1000, 1], [1440, 600, 1], [800, 1000, 1], [1920, 1080, 1], [2560, 1080, 1], [800, 600, 1.25]]) {
    await resize(width, height, zoom);
    const layout = await evaluate(() => {
      const requireTrue = (ok, message) => { if (!ok) throw new Error(message); };
      const cards = [...document.querySelectorAll('.book-card')];
      const content = document.querySelector('.library-content').getBoundingClientRect();
      const screen = document.getElementById('library-view');
      requireTrue(screen.scrollWidth <= screen.clientWidth, 'Library must not overflow horizontally');
      requireTrue(Math.abs(content.left - (innerWidth - content.right)) < 2, 'Library content must stay centered between ornaments');
      const search = document.querySelector('.shelf-search').getBoundingClientRect();
      const addBooks = document.getElementById('btn-add-books').getBoundingClientRect();
      requireTrue(search.left >= content.left && search.right <= content.right && search.height >= 32, 'Shelf search must stay within the library toolbar');
      requireTrue(search.right <= addBooks.left || search.bottom <= addBooks.top, 'Shelf search must leave room for the import button');
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
      const scale = Math.min(innerWidth / 1100, innerHeight / 760);
      const bird = document.querySelector('.library-robin').getBoundingClientRect();
      const moon = document.querySelector('.library-moon').getBoundingClientRect();
      const leftLine = document.querySelector('.library-ornament-left .library-side-rule').getBoundingClientRect();
      const rightLine = document.querySelector('.library-ornament-right .library-side-rule').getBoundingClientRect();
      const birdGap = (leftLine.left - bird.right) / scale;
      const moonGap = (moon.left - rightLine.right) / scale;
      requireTrue(birdGap >= 28 && moonGap >= 32, `Rotated ornaments need visible space from shelf lines: ${birdGap}/${moonGap}`);
      const body = document.querySelector('.library-body').getBoundingClientRect();
      requireTrue((moon.top - body.top) / scale >= 55, 'Moon should sit below the heading level');
      requireTrue(Math.abs(parseFloat(getComputedStyle(document.querySelector('.library-robin')).width) / scale - 64) < .1 && Math.abs(parseFloat(getComputedStyle(document.querySelector('.library-moon')).width) / scale - 50) < .1, 'Ornaments must scale smoothly with the homepage reference');
      return { width: innerWidth, height: innerHeight, columns: getComputedStyle(document.getElementById('bookshelf')).gridTemplateColumns.split(' ').length, covers: cards.length, birdGap, moonGap };
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
  await require('./music-responsive-checks')({ win, report, check, capture });
};
