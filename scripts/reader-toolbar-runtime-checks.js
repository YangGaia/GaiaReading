'use strict';

// Real rendering and native pointer/keyboard input in the smoke runner's
// disposable profile. Only the Alice response is stubbed at the IPC boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');
const { BGM_TRACKS } = require('../src/shared/bgm');
const makeEpubPositionFixture = require('../tests/fixtures/epub-font-fixture');
const makeEpubPageBoundaryFixture = require('../tests/fixtures/epub-page-boundary-fixture');

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
      const hit = document.elementFromPoint(x, y);
      if (!el.contains(hit)) throw new Error(`${selector} cannot receive pointer input; hit=${hit && (hit.id || hit.className || hit.tagName)}; rect=${JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height })}`);
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
      if (pr.width !== 336 || pr.height !== 52 || getComputedStyle(player).transform !== 'none') fail('reader music proportions changed');
      const original = player.querySelector('.bgm-title-text');
      if (title.clientWidth < 96 || (original.offsetWidth > title.clientWidth && title.dataset.scrolling !== 'true')) fail('long music title must scroll inside its compact viewport');
      if (state.current.format !== 'pdf' && innerWidth >= 800 && bars[0].getBoundingClientRect().height > 72) fail('ordinary reader toolbar must stay in one row');
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
    const current = await evaluate(() => ({ state: GaiaBgm.getState(), title: document.querySelector('#bgm-capsule .bgm-title-text').textContent, layout: __checkReaderChrome() }));
    check(`music ${current.state.trackId}: original title and normal proportions`, current.title === BGM_TRACKS.find(t => t.id === current.state.trackId).title);
    await click('#bgm-capsule [data-action="next"]');
  }
  assert.deepEqual(await evaluate(() => GaiaBgm.getState()), initialMusic, 'Full track cycle preserves playback and volume');
  for (let i = 0; i < BGM_TRACKS.length && (await evaluate(() => GaiaBgm.getState().trackId)) !== 'main-theme'; i++) await click('#bgm-capsule [data-action="next"]');

  const readerPosition = () => evaluate(() => {
    const c = state.current;
    if (c.format === 'pdf') return { format: c.format, page: c.page };
    return { format: c.format, chapter: c.flow ? c.flow.chapter : 0, anchor: sourcePaginatorAnchor(c) };
  });
  const preservesPosition = position => evaluate(position => {
    const c = state.current;
    if (!c || c.format !== position.format) return false;
    if (c.format === 'pdf') return c.page === position.page;
    if ((c.flow ? c.flow.chapter : 0) !== position.chapter || !position.anchor) return false;
    const offset = window.GaiaReaderChinese.displayOffset(c.paginator.doc.body, position.anchor.off);
    return c.paginator.anchorInView(offset);
  }, position);
  const settleFullscreen = async active => {
    await until(active
      ? () => document.getElementById('reader-view').classList.contains('reader-fullscreen')
      : () => !document.getElementById('reader-view').classList.contains('reader-fullscreen'));
    await until(() => !readerFullscreenAnchor);
    await wait(500);
  };
  const visibleEpubPage = () => evaluate(() => {
    const { manager } = state.current.rendition;
    const viewport = manager.container.getBoundingClientRect();
    const lines = new Map();
    for (const view of manager.views.displayed()) {
      const frame = view.iframe.getBoundingClientRect();
      const dx = frame.left - viewport.left;
      const dy = frame.top - viewport.top;
      const doc = view.contents.document;
      const range = doc.createRange();
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const visible = rect => rect.width > 0 && rect.height > 0 &&
        rect.right + dx > 0 && rect.left + dx < viewport.width && rect.bottom + dy > 0 && rect.top + dy < viewport.height;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data.trim()) continue;
        range.selectNodeContents(node);
        if (!Array.from(range.getClientRects()).some(visible)) continue;
        let offset = 0;
        for (const character of node.data) {
          range.setStart(node, offset);
          offset += character.length;
          range.setEnd(node, offset);
          const rect = range.getBoundingClientRect();
          if (!visible(rect)) continue;
          const column = Math.floor((rect.left + dx) / manager.layout.pageWidth);
          const key = `${column}:${Math.round(rect.top + dy)}`;
          lines.set(key, (lines.get(key) || '') + character);
        }
      }
    }
    return { width: viewport.width, height: viewport.height, columns: manager.layout.divisor, lines: [...lines] };
  });

  if (!process.argv.includes('--epub-only')) {
  const firstTxtPage = await evaluate(() => __gaiaDebug.getPaginatorPage());
  await click('#btn-next-page');
  await until(page => __gaiaDebug.getPaginatorPage() > page, firstTxtPage);
  const txtPosition = await readerPosition();
  await click('#btn-reader-fullscreen');
  await settleFullscreen(true);
  check('TXT fullscreen entry keeps the current text anchor visible', await preservesPosition(txtPosition));
  check('fullscreen button enters native fullscreen reading', await evaluate(() =>
    document.getElementById('btn-reader-fullscreen').getAttribute('aria-pressed') === 'true' &&
    document.getElementById('reader-view').classList.contains('reader-fullscreen')));
  await evaluate(() => document.activeElement.blur());
  win.focus();
  win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 550, y: Math.floor(win.getContentSize()[1] / 2) });
  await wait(2050);
  check('fullscreen toolbars hide after inactivity', await evaluate(() =>
    !document.getElementById('reader-view').classList.contains('top-chrome-visible') &&
    !document.getElementById('reader-view').classList.contains('bottom-chrome-visible') &&
    Number(getComputedStyle(document.querySelector('#reader-view > .reader-topbar')).opacity) === 0));
  const [fullscreenWidth, fullscreenHeight] = win.getContentSize();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.floor(fullscreenWidth / 2), y: 24 });
  await until(() => document.getElementById('reader-view').classList.contains('top-chrome-visible'));
  check('real pointer at the top edge reveals only the top toolbar', await evaluate(() =>
    !document.getElementById('reader-view').classList.contains('bottom-chrome-visible')));
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.floor(fullscreenWidth / 2), y: fullscreenHeight - 24 });
  await until(() => document.getElementById('reader-view').classList.contains('bottom-chrome-visible'));
  check('real pointer at the bottom edge reveals only the bottom toolbar', await evaluate(() =>
    !document.getElementById('reader-view').classList.contains('top-chrome-visible')));
  const fullscreenTxtPosition = await readerPosition();
  const fullscreenTxtPage = await evaluate(() => __gaiaDebug.getPaginatorPage());
  await click('#btn-next-page');
  await until(page => __gaiaDebug.getPaginatorPage() > page, fullscreenTxtPage);
  const advancedTxtPosition = await readerPosition();
  check('fullscreen page navigation advances the text anchor', advancedTxtPosition.anchor.off > fullscreenTxtPosition.anchor.off);
  await capture(win, 'reader-fullscreen');
  await key('Escape');
  await settleFullscreen(false);
  check('TXT fullscreen exit keeps the advanced text anchor visible', await preservesPosition(advancedTxtPosition));
  check('Escape exits fullscreen and restores the normal reader layout', await evaluate(() =>
    document.getElementById('btn-reader-fullscreen').getAttribute('aria-pressed') === 'false'));
  await key('F11');
  await settleFullscreen(true);
  await key('F11');
  await settleFullscreen(false);
  check('F11 enters and exits fullscreen reading', true);
  }

  if (!process.argv.includes('--skip-marquee') && !process.argv.includes('--epub-only')) {
    await require('./music-marquee-runtime-checks')({ win, report, check, capture, click });
  }

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
  check('settings keeps the scrolling title and native capsule size', await evaluate(() => {
    const player = document.getElementById('bgm-capsule'), title = player.querySelector('.bgm-title'), r = player.getBoundingClientRect();
    return r.width === 336 && r.height === 52 && title.clientWidth >= 96 && title.dataset.scrolling === 'true';
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

  const boundaryEpub = await makeEpubPageBoundaryFixture(report.userData);
  win.setContentSize(1100, 760);
  const currentEpubParagraph = () => evaluate(() => {
    const rendition = state.current.rendition;
    const start = rendition.currentLocation()?.start;
    const contents = rendition.getContents().find(item => item.sectionIndex === start?.index);
    return contents && new ePub.CFI(start.cfi).toRange(contents.document)?.startContainer.parentElement?.id;
  });
  const epubParagraphVisible = id => evaluate(id => {
    const rendition = state.current.rendition;
    const contents = rendition.getContents().find(item => item.document.getElementById(id));
    if (!contents) return false;
    const text = contents.document.getElementById(id).firstChild;
    const range = contents.document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const letter = range.getBoundingClientRect();
    const frame = contents.window.frameElement.getBoundingClientRect();
    const viewport = rendition.manager.container.getBoundingClientRect();
    return letter.width > 0 && letter.height > 0 && frame.left + letter.left >= viewport.left - 1 &&
      frame.left + letter.right <= viewport.right + 1 && frame.top + letter.top >= viewport.top - 1 &&
      frame.top + letter.bottom <= viewport.bottom + 1;
  }, id);
  for (const spread of [false, true]) {
    const mode = spread ? 'spread' : 'single';
    await evaluate(async ({ book, spread }) => {
      await __gaiaDebug.openBook(book);
      if ((state.readMode === 'spread') !== spread) await __gaiaDebug.toggleSpread();
      await state.current.rendition.display(0);
    }, { book: boundaryEpub, spread });
    await click('#btn-next-page');
    const paragraph = await currentEpubParagraph();
    check(`EPUB ${mode}: starts on a later page at a visible paragraph boundary`,
      /^page-[2-9]$/.test(paragraph) && await epubParagraphVisible(paragraph));
    await click('#btn-reader-fullscreen');
    await settleFullscreen(true);
    await evaluate(() => document.activeElement.blur());
    const [width, height] = win.getContentSize();
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.floor(width / 2), y: Math.floor(height / 2) });
    await until(() => Number(getComputedStyle(document.querySelector('#reader-view > .reader-topbar')).opacity) === 0);
    check(`EPUB ${mode}: entering fullscreen keeps ${paragraph} visible`, await epubParagraphVisible(paragraph));

    await key('Escape');
    await settleFullscreen(false);
    check(`EPUB ${mode}: leaving fullscreen keeps ${paragraph} visible`, await epubParagraphVisible(paragraph));

    await key('F11');
    await settleFullscreen(true);
    await key('Right');
    const advancedParagraph = await currentEpubParagraph();
    check(`EPUB ${mode}: advances to a different paragraph in fullscreen`,
      advancedParagraph !== paragraph && await epubParagraphVisible(advancedParagraph));
    await key('Escape');
    await settleFullscreen(false);
    check(`EPUB ${mode}: leaving fullscreen keeps the advanced paragraph visible`, await epubParagraphVisible(advancedParagraph));
    await evaluate(async book => { await __gaiaDebug.backToLibrary(); await __gaiaDebug.openBook(book); }, boundaryEpub);
    check(`EPUB ${mode}: reopening keeps the advanced paragraph visible`, await epubParagraphVisible(advancedParagraph));
  }

  const positionEpub = await makeEpubPositionFixture(report.userData);
  for (const format of ['epub', 'pdf']) {
    const book = format === 'epub' ? positionEpub : { path: path.resolve(__dirname, '../tests/fixtures/sample.pdf'), title: 'PDF 阅读验证', format };
    await evaluate(book => __gaiaDebug.openBook(book), book);
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
    if (format === 'epub') {
      for (const spread of [true, false]) {
        const mode = spread ? 'spread' : 'single';
        await evaluate(async spread => {
          if ((state.readMode === 'spread') !== spread) await __gaiaDebug.toggleSpread();
          await state.current.rendition.display(0);
        }, spread);
        await click('#btn-next-page');
        await click('#btn-next-page');
        const before = await visibleEpubPage();
        check(`EPUB ${mode}: test page contains multiple lines of reflowable text`, before.lines.length > 8 && before.columns === (spread ? 2 : 1));
        await evaluate(() => { window.fullscreenTestEpubFrame = state.current.rendition.getContents()[0].window.frameElement; });
        await capture(win, `reader-epub-${mode}-windowed`);
        await click('#btn-reader-fullscreen');
        await settleFullscreen(true);
        assert.deepEqual(await visibleEpubPage(), before, `EPUB ${mode}: fullscreen changes the visible lines or page geometry`);
        check(`EPUB ${mode}: fullscreen preserves each visible line and the original iframe`, await evaluate(() => {
          const container = state.current.rendition.manager.container;
          const page = container.getBoundingClientRect();
          const host = container.parentElement.getBoundingClientRect();
          return container.contains(window.fullscreenTestEpubFrame) &&
            Math.abs(page.left - host.left - Math.max(0, (host.width - page.width) / 2)) <= 1 &&
            Math.abs(page.top - host.top - Math.max(0, (host.height - page.height) / 2)) <= 1;
        }));
        await evaluate(() => document.activeElement.blur());
        const [width, height] = win.getContentSize();
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.floor(width / 2), y: Math.floor(height / 2) });
        await until(() => Number(getComputedStyle(document.querySelector('#reader-view > .reader-topbar')).opacity) === 0);
        await capture(win, `reader-epub-${mode}-fullscreen`);

        await key('Right');
        const advanced = await visibleEpubPage();
        check(`EPUB ${mode}: turns a page without changing the pagination size`,
          advanced.width === before.width && advanced.height === before.height &&
          advanced.columns === before.columns && JSON.stringify(advanced.lines) !== JSON.stringify(before.lines));
        await key('Escape');
        await settleFullscreen(false);
        assert.deepEqual(await visibleEpubPage(), advanced, `EPUB ${mode}: leaving fullscreen changes the page reached in fullscreen`);
        check(`EPUB ${mode}: leaving fullscreen preserves the page reached in fullscreen`, true);
      }
      const windowedWidth = (await visibleEpubPage()).width;
      win.setContentSize(1040, 710);
      await until(width => {
        const container = state.current.rendition.manager.container;
        return container.offsetWidth !== width && container.offsetWidth === container.parentElement.clientWidth;
      }, windowedWidth);
      check('EPUB adapts to a regular window resize after leaving fullscreen', true);
    } else {
      const positionBeforeFullscreen = await readerPosition();
      await evaluate(() => setReaderFullscreen(true));
      await settleFullscreen(true);
      check('PDF: fullscreen entry keeps the current reading position', await preservesPosition(positionBeforeFullscreen));
      await evaluate(() => setReaderFullscreen(false));
      await settleFullscreen(false);
      check('PDF: fullscreen exit keeps the current reading position', await preservesPosition(positionBeforeFullscreen));
    }
    if (format === 'epub' || await evaluate(() => state.current.pages > 1)) {
      const position = () => evaluate(() => state.current.format === 'pdf' ? state.current.page : state.current.rendition.currentLocation().start.displayed.page);
      const before = await position();
      await click('#btn-next-page');
      check(`${format}: next-page button moves the actual renderer`, await position() !== before);
      await click('#btn-prev-page');
      check(`${format}: previous-page button returns`, await position() === before);
    }
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
