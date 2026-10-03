'use strict';

// Real application, generated book and isolated profile; never reads the user's library.
const { app, BrowserWindow, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const path = require('node:path');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');
const sandbox = makeSmokeDirectory('gaia-reader-tools-');
const output = resolveFPath(process.env.GAIA_TOOLS_OUTPUT_DIR || path.join(sandbox, 'screenshots'));
fs.mkdirSync(output, { recursive: true });
configureSmokePaths(app, { userData: sandbox });
app.setAppPath(path.join(__dirname, '..'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const requests = [];
shell.openExternal = async url => requests.push(url);
const bookPath = path.join(sandbox, '繁體閱讀.txt');
const original = '第一章 繁體閱讀\n\n' + Array.from({ length: 150 }, (_, i) => `段落${i}：臺灣的讀者翻開這本書，風從窗邊吹過，書頁裡有乾淨的文字與著名的故事。`).join('\n\n');
fs.writeFileSync(bookPath, original);
fs.writeFileSync(path.join(sandbox, STATE_FILE_NAME), JSON.stringify({ library: [], prefs: { theme: 'light', aiWindow: { minimized: true } }, pet: { autoSleep: false } }));
const report = { sandbox, output, checks: [], screenshots: [], errors: [] };
let finished = false;
const timeout = setTimeout(() => finish(new Error('Reader tools smoke timeout')), 120000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  if (error) report.error = error.stack;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, screenshots: report.screenshots.length }, null, 2));
  app.exit(error ? 1 : 0);
}
BrowserWindow.prototype.show = function () { this.showInactive(); };
let attached = false;
app.on('browser-window-created', (_event, win) => {
  if (attached) return;
  attached = true;
  win.webContents.setAudioMuted(true);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(), finish));
});
async function run(win) {
  const evaluate = (fn, value) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (label, pass) => { assert.ok(pass, label); report.checks.push(label); };
  const equalTools = async (selector) => evaluate(selector => {
    const items = [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length);
    const first = items[0]?.getBoundingClientRect();
    return items.length > 1 && items.every(el => {
      const r = el.getBoundingClientRect();
      return Math.abs(r.width - first.width) < 1 && r.height === first.height && el.scrollWidth <= el.clientWidth + 1;
    });
  }, selector);
  const click = async selector => { await evaluate(selector => document.querySelector(selector).click(), selector); await wait(250); };
  const shot = async name => {
    win.moveTop();
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await evaluate(() => { for (const animation of document.getAnimations()) { if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish(); } });
    await wait(250);
    const target = path.join(output, name + '.png');
    fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(target);
  };
  await evaluate(() => __gaiaDebug.waitHome());
  win.setContentSize(1100, 760);
  await click('#btn-home-reading-stats');
  check('home goal opens stats', await evaluate(() => __gaiaDebug.getView() === 'stats'));
  await click('#btn-stats-back');
  check('goal returns to home', await evaluate(() => __gaiaDebug.getView() === 'home'));
  await click('#btn-home-shelf');
  await click('#btn-add-books');
  check('import dialog uses application palette', await evaluate(() => getComputedStyle(document.querySelector('.book-import-dialog')).color === 'rgb(236, 239, 244)'));
  await shot('import');
  if (process.env.GAIA_TOOLS_IMPORT_ONLY === '1') return;
  await click('#btn-book-import-close');
  await evaluate(async file => { await __gaiaDebug.importPaths([file]); await __gaiaDebug.openBook(__gaiaDebug.getLibrary()[0]); }, bookPath);
  await wait(450);
  check('reader shortcuts retain their full names after chat state initializes', await evaluate(() =>
    document.querySelector('#btn-ai-reader .reader-label-compact').textContent === 'AI对话' &&
    document.querySelector('#btn-alice-comment .alice-action-text').textContent === '有珠吐槽'));
  const originalState = await evaluate(() => ({ toc: document.getElementById('toc-panel').textContent, doc: document.querySelector('.paginator-frame').contentDocument.body.textContent, loc: __gaiaDebug.getLoc() }));
  await evaluate(() => __gaiaDebug.toggleSimplifiedBook());
  check('simplified display preserves canonical source and TOC', await evaluate(before => {
    const doc = document.querySelector('.paginator-frame').contentDocument;
    return doc.body.textContent.includes('台湾的读者') && GaiaChineseDisplay.sourceText(doc.body) === before.doc && document.getElementById('toc-panel').textContent === before.toc;
  }, originalState));
  await evaluate(() => {
    const doc = document.querySelector('.paginator-frame').contentDocument;
    const node = doc.querySelectorAll('p')[1].firstChild;
    const range = doc.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(node.length, 24));
    const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    doc.body.dispatchEvent(new doc.defaultView.MouseEvent('mouseup', { bubbles: true }));
  });
  await wait(100);
  check('selection tools match requested actions', await evaluate(() => !document.getElementById('selection-toolbar').hidden && ['ai-analyze', 'web-search', 'book-search', 'copy', 'dictionary'].every(key => document.querySelector('[data-selection-action="' + key + '"]')) && !document.querySelector('[data-selection-action="ai-ask"], [data-selection-action="note"]')));
  await shot('selection');
  check('selection actions have equal dimensions and readable labels', await equalTools('#selection-toolbar [data-selection-action]'));
  await click('[data-highlight-color="yellow"]');
  check('highlight stores original Traditional quote and opens notes tab', await evaluate(() => {
    const note = __gaiaDebug.getAnnotations()[0];
    return note && /臺灣|讀者/.test(note.text) && !document.getElementById('annotations-panel').hidden && document.querySelector('#annotations-panel [aria-selected="true"]').textContent === '笔记';
  }));
  await evaluate(() => { const input = document.querySelector('.annotation-note'); input.value = '讀者的筆記'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('#annotations-panel [role="tab"]');
  check('merged panel bookmark tab includes hint', await evaluate(() => !document.getElementById('bookmarks-panel').hidden && document.getElementById('bookmarks-panel').textContent.includes('任意位置右键')));
  await shot('bookmarks');
  await click('#bookmarks-panel .collection-head button');
  await evaluate(() => {
    const doc = document.querySelector('.paginator-frame').contentDocument;
    doc.body.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  });
  await wait(200);
  check('right click inside iframe adds current bookmark with canonical text', await evaluate(() => __gaiaDebug.getBookmarks().length === 1 && !__gaiaDebug.getBookmarks()[0].chapter.includes('读者')));
  await evaluate(() => document.querySelector('.gaia-pet-hitbox').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
  await wait(150);
  check('pet right click does not add bookmark', await evaluate(() => __gaiaDebug.getBookmarks().length === 1 && !document.querySelector('.gaia-pet-console').hidden));
  await evaluate(() => GaiaPet.closeConsole());
  await click('#btn-settings-reader');
  const margins = await evaluate(() => __gaiaDebug.getCurrentSettings());
  await click('#btn-vertical-margin');
  check('vertical margin is independent', await evaluate(previous => { const next = __gaiaDebug.getCurrentSettings(); return next.marginPct === previous.marginPct && next.verticalMarginPx !== previous.verticalMarginPx; }, margins));
  const vertical = await evaluate(() => __gaiaDebug.getCurrentSettings().verticalMarginPx);
  await click('#btn-margin');
  check('horizontal margin is independent', await evaluate(value => __gaiaDebug.getCurrentSettings().verticalMarginPx === value, vertical));
  await shot('settings');
  for (const [width, height] of [[800, 600], [1024, 720], [1100, 760]]) {
    win.setContentSize(width, height);
    await evaluate(() => document.querySelector('.drawer-tools').scrollIntoView({ block: 'center' }));
    await wait(200);
    check(`settings tools form equal cells at ${width}`, await equalTools('#settings-drawer .drawer-tools .btn'));
    check(`reading tools are exactly three full-width rows at ${width}`, await evaluate(() => {
      const group = document.querySelector('#drawer-funcs .drawer-tools');
      const buttons = [...group.querySelectorAll('button')];
      const parent = group.getBoundingClientRect();
      const boxes = buttons.map(button => button.getBoundingClientRect());
      return buttons.length === 3 && !document.getElementById('btn-ai-assistant') &&
        boxes.every((box, index) => Math.abs(box.width - parent.width) < 1 &&
          (index === 0 || box.top >= boxes[index - 1].bottom));
    }));
    await shot(`settings-tools-${width}`);
  }
  await click('#btn-settings-close');
  await evaluate(() => __gaiaDebug.toggleSimplifiedBook());
  check('original text and saved note survive conversion round trip', await evaluate(before => {
    const doc = document.querySelector('.paginator-frame').contentDocument;
    return doc.body.textContent === before.doc && __gaiaDebug.getAnnotations()[0].note === '讀者的筆記' && !!doc.querySelector('mark');
  }, originalState));
  await evaluate(() => __gaiaDebug.prepareAnnotationSelectionForTest('臺灣的讀者'));
  await click('[data-selection-action="book-search"]');
  await wait(750);
  check('selected text full search opens matching results', await evaluate(() => !document.getElementById('book-search-panel').hidden && __gaiaDebug.getBookSearchState().results > 0));
  await shot('search');
  await click('#btn-book-search-close');
  await evaluate(() => __gaiaDebug.prepareAnnotationSelectionForTest('臺灣的讀者'));
  await click('[data-selection-action="web-search"]');
  check('selected text web search reaches configured engine', requests.some(url => url.includes(encodeURIComponent('臺灣的讀者'))));
  await click('#btn-ai-reader');
  check('chat has current model and AI center without minimize or switch', await evaluate(() => !document.getElementById('ai-summary-panel').hidden && !document.getElementById('ai-summary-panel').classList.contains('minimized') && document.getElementById('ai-reader-model') && document.getElementById('btn-ai-chat-center') && !document.getElementById('btn-ai-summary-minimize') && !document.getElementById('ai-reader-profile')));
  await shot('ai');
  check('AI header actions have equal dimensions', await equalTools('#ai-summary-panel .ai-panel-head-actions .btn'));
  check('AI prompt shortcuts have equal dimensions and readable labels', await equalTools('#ai-summary-panel .ai-chat-input-shortcuts button'));
  await click('#btn-ai-chat-center');
  check('chat AI center returns to reader', await evaluate(() => __gaiaDebug.getView() === 'ai'));
  await click('#btn-ai-back');
  check('AI center return keeps book', await evaluate(() => __gaiaDebug.getView() === 'reader'));
  const saved = await evaluate(() => __gaiaDebug.getCurrentSettings());
  await evaluate(async () => { await __gaiaDebug.backToLibrary(); await __gaiaDebug.openBook(__gaiaDebug.getLibrary()[0]); });
  check('margin settings persist on reopen', await evaluate(before => { const now = __gaiaDebug.getCurrentSettings(); return now.marginPct === before.marginPct && now.verticalMarginPx === before.verticalMarginPx; }, saved));
  check('book file unchanged', fs.readFileSync(bookPath, 'utf8') === original);
  check('no renderer errors', !report.errors.length);
}
require('../src/main');
