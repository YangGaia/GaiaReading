'use strict';

// Real rendering and native pointer/keyboard input in the smoke runner's
// disposable profile. Only the Alice response is stubbed at the IPC boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');
const { BGM_TRACKS } = require('../src/shared/bgm');

module.exports = async ({ win, report, check, capture }) => {
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, arg) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(fn, arg)) return; await wait(75); }
    throw new Error(`Timed out: ${fn}`);
  };
  const moveTo = async selector => {
    const point = await evaluate(selector => {
      const el = document.querySelector(selector);
      if (!el || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') throw new Error(`${selector} is hidden`);
      const r = el.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      if (!el.contains(document.elementFromPoint(x, y))) throw new Error(`${selector} cannot receive pointer input`);
      return { x, y };
    }, selector);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    return point;
  };
  const click = async selector => {
    const point = await moveTo(selector);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await wait(330);
  };
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await wait(180);
  };
  const book = { path: path.join(report.userData, 'reader-preview.txt'), title: '书页之间', format: 'txt' };
  const paragraphs = [
    '傍晚，窗外的光线慢慢柔和下来。桌上还放着一杯温热的茶，书签停在昨天读到的地方。翻开书页，熟悉的文字又把人带回那个尚未结束的故事。',
    '读书有时像一次缓慢的散步。我们并不急着抵达终点，只是在一段话里停留片刻，听一听作者的声音，也听一听自己的想法。那些没有立刻明白的句子，可以留到下一次再见。',
    '书房很安静，只有偶尔经过的风翻动窗帘。纸上的山川、街道和远方，却在这样的安静里渐渐清晰起来。一个人的夜晚，也可以有许多不同的人生经过。',
    '我喜欢把有意思的段落记下来。有时是一个恰到好处的比喻，有时只是朴素的一句话。过了很久再读，文字仍在原处，我们却已经带着新的经历回来了。',
    '阅读的节奏不必总是相同。有的故事适合一口气读完，有的书则值得一页一页慢慢翻。重要的是，在忙碌的一天里，仍然有这样一段可以安心停留的时间。',
    '灯光亮起的时候，我又往后翻了一页。故事还很长，今晚也还没有结束。',
  ];
  fs.writeFileSync(book.path, Array.from({ length: 3 }, (_, i) => `第${['一', '二', '三'][i]}章 ${['灯下的书页', '沿途的风景', '故事还在继续'][i]}\n\n` + Array.from({ length: 8 }, () => paragraphs.join('\n\n')).join('\n\n')).join('\n\n'));
  await evaluate(book => __gaiaDebug.openBook(book), book);
  await until(() => __gaiaDebug.getPaginatorTotal() > 2);

  await evaluate(() => {
    window.__checkReaderChrome = () => {
      const fail = message => { throw new Error(message); };
      const bars = [...document.querySelectorAll('#reader-view > .reader-topbar, #reader-view > .statusbar')];
      let count = 0, minContrast = Infinity;
      const luminance = color => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
      };
      const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      for (const bar of bars) {
        const br = bar.getBoundingClientRect();
        if (bar.scrollWidth > bar.clientWidth + 1) fail('toolbar overflows');
        const tools = [...bar.querySelectorAll('button, input[type="range"]')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        for (const el of tools) {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          if (r.left < 0 || r.right > innerWidth + 1 || r.top < br.top || r.bottom > br.bottom + 1) fail(`clipped control: ${el.id || el.className}`);
          if (r.width < 27 || r.height < 27) fail(`small pointer target: ${el.id}`);
          if (!el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) fail(`covered control: ${el.id || el.className}`);
          if (!(el.getAttribute('aria-label') || el.title || el.textContent.trim())) fail(`unnamed control: ${el.id}`);
          if (el.scrollWidth > el.clientWidth + 1) fail(`clipped button label: ${el.id}`);
          if (el.matches('.reader-tool') && !el.disabled) {
            const ratio = contrast(s.color, s.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(bar).backgroundColor : s.backgroundColor);
            minContrast = Math.min(minContrast, ratio);
            if (ratio < 4.5) fail(`low contrast: ${el.id}: ${ratio}`);
            if (getComputedStyle(el, '::after').animationName !== 'none') fail(`continuous shine: ${el.id}`);
          }
          count++;
        }
        for (let i = 0; i < tools.length; i++) for (let j = i + 1; j < tools.length; j++) {
          const a = tools[i].getBoundingClientRect(), b = tools[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1.1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1.1) fail('toolbar controls overlap');
        }
      }
      const nav = document.getElementById('page-nav').getBoundingClientRect();
      if (nav.width && Math.abs(nav.x + nav.width / 2 - innerWidth / 2) > 1) fail('page navigation is not centered');
      const status = document.getElementById('reader-status');
      if (contrast(getComputedStyle(status).color, getComputedStyle(bars[1]).backgroundColor) < 4.5) fail('progress text contrast');
      const player = document.getElementById('bgm-capsule');
      const title = player.querySelector('.bgm-title');
      const cover = player.querySelector('.bgm-cover').getBoundingClientRect();
      const pr = player.getBoundingClientRect();
      if (pr.width !== 396 || pr.height !== 56 || getComputedStyle(player).transform !== 'none') fail('reader music proportions changed');
      if (title.clientWidth < 156 || title.scrollWidth > title.clientWidth) fail(`music title is truncated: ${title.textContent} (${title.scrollWidth}/${title.clientWidth})`);
      if (cover.width !== 32 || cover.height !== 32) fail('music cover is hidden or distorted');
      for (const b of player.querySelectorAll('button')) {
        const r = b.getBoundingClientRect();
        if (r.width !== 28 || r.height !== 28) fail('music button proportions changed');
      }
      return { viewport: [innerWidth, innerHeight], controls: count, minContrast, musicTitleWidth: title.clientWidth, paint: bars.map(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]) };
    };
  });

  // Verify the real four-track cycle and each visible name before keeping the
  // longest title selected for all subsequent format/viewport checks.
  const initialMusic = await evaluate(() => GaiaBgm.getState());
  for (let i = 0; i < BGM_TRACKS.length; i++) {
    const current = await evaluate(() => ({ state: GaiaBgm.getState(), title: document.querySelector('#bgm-capsule .bgm-title').textContent, layout: __checkReaderChrome() }));
    check(`music ${current.state.trackId}: full title and normal proportions`, current.title === BGM_TRACKS.find(t => t.id === current.state.trackId).title);
    await click('#bgm-capsule [data-action="next"]');
  }
  assert.deepEqual(await evaluate(() => GaiaBgm.getState()), initialMusic, 'Full track cycle preserves playback and volume');
  for (let i = 0; i < BGM_TRACKS.length && (await evaluate(() => GaiaBgm.getState().trackId)) !== 'main-theme'; i++) await click('#bgm-capsule [data-action="next"]');

  let palette;
  for (const theme of ['light', 'eye', 'dark']) {
    await evaluate(theme => __gaiaDebug.setTheme(theme), theme);
    for (const [width, height] of [[800, 600], [1040, 760], [1100, 760], [1600, 1000]]) {
      win.setContentSize(width, height);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 400, y: 300 });
      await wait(400);
      const layout = await evaluate(() => __checkReaderChrome());
      palette ||= layout.paint;
      assert.deepEqual(layout.paint, palette);
      report.checks.push({ theme, ...layout });
      check(`TXT ${theme} ${width}: book theme remains independent`, await evaluate(theme => {
        const doc = state.current.paginator.doc;
        return doc.defaultView.getComputedStyle(doc.body).backgroundColor === ({ light: 'rgb(255, 253, 247)', eye: 'rgb(245, 236, 217)', dark: 'rgb(0, 0, 0)' })[theme];
      }, theme));
      if (width === 1100 || (theme === 'light' && width === 800)) await capture(win, `reader-${theme}-${width}x${height}`);
    }
  }
  win.setContentSize(1100, 760);
  await evaluate(() => __gaiaDebug.setTheme('light'));
  await wait(350);
  await evaluate(() => { document.getElementById('reader-title').textContent = '这是用于验证超长书名仍然能够让出按钮空间的标题'.repeat(12); });
  report.checks.push(await evaluate(() => __checkReaderChrome()));
  check('long book titles truncate without displacing controls', await evaluate(() => { const title = document.getElementById('reader-title'); return title.scrollWidth > title.clientWidth && getComputedStyle(title).textOverflow === 'ellipsis'; }));
  await evaluate(title => { document.getElementById('reader-title').textContent = title; }, book.title);

  await click('#btn-reader-toc');
  check('TOC pointer button opens the existing drawer and active state', await evaluate(() => !els.tocPanel.hidden && els.readerTocButton.getAttribute('aria-expanded') === 'true'));
  await capture(win, 'reader-toc-open');
  await click('#btn-reader-toc');
  check('TOC button closes its drawer', await evaluate(() => els.tocPanel.hidden && els.readerTocButton.getAttribute('aria-expanded') === 'false'));
  const page = await evaluate(() => __gaiaDebug.getPaginatorPage());
  await click('#btn-next-page');
  await until(page => __gaiaDebug.getPaginatorPage() > page, page);
  await click('#btn-prev-page');
  await until(page => __gaiaDebug.getPaginatorPage() === page, page);
  check('TXT previous and next buttons preserve page navigation', true);
  await click('#btn-book-search');
  check('search button opens and focuses full-text search', await evaluate(() => __gaiaDebug.getBookSearchState().focused && document.getElementById('btn-book-search').getAttribute('aria-expanded') === 'true'));
  await evaluate(() => { els.bookSearchInput.value = '安静'; els.bookSearchInput.dispatchEvent(new Event('input', { bubbles: true })); });
  await until(() => __gaiaDebug.getBookSearchState().results > 0);
  check('search still finds actual book text', true);
  await click('#btn-book-search-close');
  await click('#btn-ai-reader');
  check('dialog button opens AI assistant with active styling', await evaluate(() => !els.aiSummaryPanel.hidden && document.getElementById('btn-ai-reader').classList.contains('open')));
  await click('#btn-ai-summary-close');
  check('dialog active state clears on close', await evaluate(() => !document.getElementById('btn-ai-reader').classList.contains('open')));

  const music = await evaluate(() => GaiaBgm.getState());
  await click('#bgm-capsule [data-action="next"]');
  check('music next button keeps working', (await evaluate(() => GaiaBgm.getState())).trackId !== music.trackId);
  await click('#bgm-capsule [data-action="prev"]');
  const beforeMuted = await evaluate(() => GaiaBgm.getState().muted);
  await click('#bgm-capsule [data-action="mute"]');
  check('music mute button keeps working', (await evaluate(() => GaiaBgm.getState().muted)) !== beforeMuted);
  await click('#bgm-capsule [data-action="mute"]');
  const playing = await evaluate(() => GaiaBgm.getState().on);
  await click('#bgm-capsule [data-action="play"]');
  check('resized music play button toggles playback', (await evaluate(() => GaiaBgm.getState().on)) !== playing);
  await click('#bgm-capsule [data-action="play"]');
  const volume = await evaluate(() => GaiaBgm.getState().volume);
  await click('#bgm-capsule .bgm-volume');
  win.webContents.focus();
  await key('Right');
  check('resized music volume slider remains adjustable', (await evaluate(() => GaiaBgm.getState().volume)) !== volume);
  await evaluate(volume => GaiaBgm.setVolume(volume), volume);
  await click('#btn-settings-reader');
  check('settings button opens its drawer and relocates the player', await evaluate(() => __gaiaDebug.isSettingsOpen() && document.getElementById('bgm-capsule').dataset.settingsOpen === '1'));
  check('settings keeps the full music title and native capsule size', await evaluate(() => {
    const player = document.getElementById('bgm-capsule'), title = player.querySelector('.bgm-title'), r = player.getBoundingClientRect();
    return r.width === 396 && r.height === 56 && title.clientWidth >= 156 && title.scrollWidth <= title.clientWidth;
  }));
  await click('#btn-settings-close');
  check('closing settings restores every toolbar control', (await evaluate(() => __checkReaderChrome())).controls > 10);

  // Keyboard focus, hover and pressed feedback on an actual pointer target.
  win.webContents.focus();
  await evaluate(() => document.getElementById('btn-reader-toc').focus());
  await key('Tab');
  const focus = await evaluate(() => ({ id: document.activeElement.id, outline: getComputedStyle(document.activeElement).outlineStyle, focused: document.hasFocus() }));
  report.keyboardFocus = focus;
  check('keyboard focus reaches previous page with a visible ring: ' + JSON.stringify(focus), focus.id === 'btn-prev-page' && focus.outline === 'solid');
  const rest = await evaluate(() => getComputedStyle(document.getElementById('btn-next-page')).backgroundColor);
  const point = await moveTo('#btn-next-page');
  await wait(200);
  const hover = await evaluate(() => getComputedStyle(document.getElementById('btn-next-page')).backgroundColor);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  await wait(200);
  const pressed = await evaluate(() => getComputedStyle(document.getElementById('btn-next-page')).backgroundColor);
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  check('hover and pressed feedback are distinct', rest !== hover && hover !== pressed);
  await wait(350);

  // Keep real button handlers and chapter extraction, without model/network use.
  const requests = [];
  let resolveAlice;
  ipcMain.removeHandler('ai:alice-comment');
  ipcMain.handle('ai:alice-comment', (_event, payload) => { requests.push(payload); return new Promise(resolve => { resolveAlice = resolve; }); });
  await evaluate(() => acceptAiProfiles({ activeId: 'toolbar-fixture', items: [{ id: 'toolbar-fixture', name: '离线验证', provider: 'ollama', model: 'fixture', baseUrl: 'http://127.0.0.1' }] }));
  for (const kind of ['summary', 'comment']) {
    await click(`#btn-alice-${kind}`);
    await until(() => state.aiAliceLoading);
    check(`Alice ${kind}: click carries the current chapter to IPC`, requests.at(-1).kind === kind && requests.at(-1).source.content.includes('书页'));
    check(`Alice ${kind}: busy text, accessible state and icons survive`, await evaluate(kind => {
      const b = document.getElementById(`btn-alice-${kind}`);
      return b.disabled && b.getAttribute('aria-busy') === 'true' && !!b.querySelector('svg') && b.querySelector('.alice-action-text').textContent.includes('中');
    }, kind));
    report.checks.push(await evaluate(() => __checkReaderChrome()));
    resolveAlice({ comment: '书页之间，还有许多值得慢慢读的故事。' });
    await until(() => !state.aiAliceLoading);
    check(`Alice ${kind}: controls recover after completion`, await evaluate(() => [...document.querySelectorAll('[data-ai-alice]')].every(b => !b.disabled && b.getAttribute('aria-busy') === 'false')));
    await evaluate(() => document.querySelector('.gaia-pet-bubble.show')?.click());
    await wait(250);
  }

  for (const format of ['epub', 'pdf']) {
    await evaluate(book => __gaiaDebug.openBook(book), { path: path.resolve(__dirname, `../tests/fixtures/sample.${format}`), title: `${format.toUpperCase()} 阅读验证`, format });
    await wait(450);
    for (const spread of [false, true]) {
      await evaluate(async spread => { if ((state.readMode === 'spread') !== spread) await __gaiaDebug.toggleSpread(); }, spread);
      for (const [width, height] of [[800, 600], [960, 700], [1041, 760], [1100, 760], [1101, 760], [1181, 760], [1281, 760], [1600, 1000]]) {
        win.setContentSize(width, height);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 400, y: 300 });
        await wait(500);
        report.checks.push({ format, spread, ...await evaluate(() => __checkReaderChrome()) });
        if (format === 'pdf' && spread && [800, 1100].includes(width)) await capture(win, `reader-pdf-spread-${width}x${height}`);
      }
    }
    win.setContentSize(1100, 760);
    await wait(400);
    const position = () => evaluate(() => state.current.format === 'pdf' ? state.current.page : state.current.rendition.currentLocation().start.cfi);
    const before = await position();
    await click('#btn-next-page');
    check(`${format}: next-page button moves the actual renderer`, await position() !== before);
    await click('#btn-prev-page');
    check(`${format}: previous-page button returns`, await position() === before);
    if (format === 'pdf') {
      const zoom = await evaluate(() => document.getElementById('pdf-zoom-value').textContent);
      await click('#btn-pdf-zoom-in');
      check('PDF zoom in changes the displayed scale', await evaluate(() => document.getElementById('pdf-zoom-value').textContent) !== zoom);
      const larger = await evaluate(() => state.current.zoom);
      await click('#btn-pdf-zoom-out');
      check('PDF zoom out reduces scale', await evaluate(() => state.current.zoom) < larger);
      await click('#btn-pdf-zoom-reset');
      check('PDF fit control restores an automatic mode', await evaluate(() => state.current.pdfZoomMode !== 'manual'));
      const pairing = await evaluate(() => state.current.pdfPairing);
      await click('#btn-pdf-pairing');
      check('PDF pairing control switches spreads', await evaluate(() => state.current.pdfPairing) !== pairing);
    }
  }

  // Disabling the new sheet must not change paint/typography on other surfaces.
  check('toolbar stylesheet cannot recolor reader content or unrelated views', await evaluate(() => {
    const sheet = [...document.styleSheets].find(s => s.href?.endsWith('/reader-chrome.css'));
    const roots = ['#reader-body', '#settings-overlay', '#home-view', '#library-view', '#stats-view', '#ai-view'];
    const nodes = roots.flatMap(selector => { const el = document.querySelector(selector); return [el, ...el.querySelectorAll('*')]; });
    const snapshot = () => JSON.stringify(nodes.map(el => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.fontSize, s.fontFamily, s.lineHeight, s.borderColor]; }));
    const before = snapshot();
    sheet.disabled = true;
    try { return before === snapshot(); } finally { sheet.disabled = false; }
  }));
  await click('#btn-back');
  check('back button returns to the library', await evaluate(() => __gaiaDebug.getView() === 'library'));
};
