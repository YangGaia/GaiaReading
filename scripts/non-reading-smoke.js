'use strict';

// Run with: npx electron scripts/non-reading-smoke.js
// All test books, preferences and screenshots live in a new temporary directory.
// GAIA_UI_OUTPUT_DIR may point to another screenshot/report directory.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { dateKey } = require('../src/shared/reading-stats');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-ui-smoke-'));
const outputDir = path.resolve(process.env.GAIA_UI_OUTPUT_DIR || path.join(sandbox, 'screenshots'));
fs.mkdirSync(outputDir, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(path.join(__dirname, '..'));

const titles = ['夜航西飞', '月亮与六便士', '山茶文具店', '长日将尽', '瓦尔登湖', '小王子', '人间草木', '古都', '海边的卡夫卡', '看不见的城市', '雪国', '漫长的告别', '银河铁道之夜', '克拉拉与太阳', '局外人', '浮生六记', '山月记', '霍乱时期的爱情', '时间的秩序', '一个人的好天气', 'The Collected Stories of a Quiet Library and the Longest UnbrokenTitleWithoutAnySpaces', '春天与阿修罗', '当我们谈论爱情时我们在谈论什么：短篇小说集与作者访谈', '<img src=x onerror="window.__uiTitleUnsafe=true"> 长书名安全测试'];
const authors = ['柏瑞尔·马卡姆', '毛姆', '小川糸', '石黑一雄', '梭罗', '圣埃克苏佩里', '汪曾祺', '川端康成'];
const colors = [['#343a50', '#e8d8af'], ['#d6bc95', '#48433a'], ['#79938a', '#faf3dc'], ['#7d5961', '#f4dcb4'], ['#d9d7ca', '#3e5b56'], ['#4a596c', '#e9dec3']];
function coverSvg(title, author, index) {
  const [bg, fg] = colors[index % colors.length];
  const shortTitle = title.slice(0, 9).replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520"><rect width="360" height="520" fill="${bg}"/><rect x="21" y="21" width="318" height="478" fill="none" stroke="${fg}" stroke-opacity=".5"/><circle cx="180" cy="190" r="95" fill="none" stroke="${fg}" stroke-opacity=".4"/><path d="M70 260 L180 90 L290 260 Z" fill="${fg}" fill-opacity=".12"/><text x="180" y="330" text-anchor="middle" font-family="SimSun,serif" font-size="31" fill="${fg}">${shortTitle}</text><text x="180" y="378" text-anchor="middle" font-family="Microsoft YaHei,sans-serif" font-size="16" fill="${fg}">${author}</text><text x="180" y="460" text-anchor="middle" font-family="Georgia,serif" font-size="10" letter-spacing="4" fill="${fg}">GAIA · TEST EDITION</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const booksDir = path.join(sandbox, 'books');
fs.mkdirSync(booksDir);
const books = titles.map((title, i) => {
  const bookPath = path.join(booksDir, `${i + 1}-${i === 0 ? title : 'book'}.txt`);
  fs.writeFileSync(bookPath, `${title}\n\n第一章 安静的书房\n\n` + '窗外的月光落在书页上，阅读仍会继续。 '.repeat(1800), 'utf8');
  return { path: bookPath, title, author: authors[i % authors.length], format: 'txt', cover: i % 3 === 0 || i === titles.length - 1 ? '' : coverSvg(title, authors[i % authors.length], i) };
});
const now = Date.now();
const days = {};
for (let i = 0; i < 8; i += 1) {
  const date = new Date(now);
  date.setDate(date.getDate() - i);
  days[dateKey(date)] = { ms: (i === 0 ? 38 : 18 + i * 9) * 60000, byBook: {}, lastReadAt: date.getTime() };
}
const progress = Object.fromEntries(books.slice(0, 9).map((book, i) => [book.path, { percent: 10 + i * 9, updatedAt: now - i * 1000 }]));
const completedBooks = Object.fromEntries(books.slice(0, 7).map((book, i) => [book.path, { ...book, finishedAt: now - i * 86400000 }]));
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light' }, progress, readingStats: { version: 1, goalMinutes: 30, days, completedBooks } }));

const report = { userData: sandbox, outputDir, checks: [], screenshots: [], consoleErrors: [] };
let finished = false;
const timeout = setTimeout(() => finish(new Error('UI smoke timed out after 150 seconds')), 150000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, outputDir, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}

// Show without activation so Chromium paints animations but does not steal focus.
BrowserWindow.prototype.show = function () { this.showInactive(); };
let runStarted = false;
function attachWindow(win) {
  if (runStarted) return;
  runStarted = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) { report.consoleErrors.push(message); console.error('UI_RENDERER:', message); }
  });
  const start = () => run(win).then(() => finish(), finish);
  start();
}
app.whenReady().then(() => {
  setTimeout(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) finish(new Error('Application window was not created'));
    else attachWindow(win);
  }, 300);
});

async function run(win) {
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const check = (name, result) => { assert.ok(result, name); report.checks.push(name); };
  win.setContentSize(1100, 760);
  await evaluate(async () => { await window.__gaiaDebug.waitHome(); });
  await evaluate(() => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const requireTrue = (value, message) => { if (!value) throw new Error(message); };
    const visible = (el) => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    window.__uiSmoke = {
      wait,
      async click(selector) {
        const el = document.querySelector(selector);
        requireTrue(visible(el), `${selector} is not visible`);
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await wait(40);
        const r = el.getBoundingClientRect();
        const x = (r.left + r.right) / 2;
        const y = (r.top + r.bottom) / 2;
        const hit = document.elementFromPoint(x, y);
        requireTrue(x >= 0 && x < innerWidth && y >= 0 && y < innerHeight, `${selector} is outside viewport (${x}, ${y} within ${innerWidth}x${innerHeight})`);
        requireTrue(hit === el || el.contains(hit), `${selector} is covered by ${hit && (hit.id || hit.className)}`);
        el.click();
        await wait(320);
      },
      layout(view) {
        const root = document.getElementById(view + '-view');
        requireTrue(visible(root), `${view} is hidden`);
        requireTrue(root.scrollWidth <= root.clientWidth + 1, `${view} horizontally overflows (${root.scrollWidth}/${root.clientWidth})`);
        const bad = [...root.querySelectorAll('button, .book-card, .stats-card, .stats-goal-options, .stats-finished-book')].filter(visible).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1;
        }).map((el) => el.id || el.className);
        requireTrue(!bad.length, `${view} content clips horizontally: ${bad.join(', ')}`);
        for (const id of ['home', 'library', 'stats', 'reader', 'ai']) {
          if (id !== view) requireTrue(!visible(document.getElementById(id + '-view')), `${id} leaks through hidden state`);
        }
        if (view === 'home') {
          for (const el of root.querySelectorAll('button')) {
            const r = el.getBoundingClientRect();
            requireTrue(r.top >= 0 && r.bottom <= innerHeight, `${el.id} clips vertically`);
          }
        }
        return { view, width: innerWidth, height: innerHeight, cards: root.querySelectorAll('.book-card').length };
      },
      assertStyleIsolation(view) {
        const sheets = [...document.styleSheets].filter((sheet) => /\/(non-reading|library-stats)\.css$/.test(sheet.href || ''));
        requireTrue(sheets.length === 2, 'Both UI stylesheets must be loaded');
        const root = document.getElementById(view + '-view');
        const nodes = [root, ...root.querySelectorAll('*')];
        const snapshot = () => nodes.map((el) => {
          const style = getComputedStyle(el);
          return [...style].map((name) => [name, style.getPropertyValue(name)]);
        });
        const before = snapshot();
        sheets.forEach((sheet) => { sheet.disabled = true; });
        let differences;
        try {
          const after = snapshot();
          differences = before.flatMap((props, i) => props.filter(([name, value], j) => value !== after[i][j][1]).map(([name]) => `${nodes[i].id || nodes[i].className || nodes[i].tagName}:${name}`));
        } finally { sheets.forEach((sheet) => { sheet.disabled = false; }); }
        requireTrue(!differences.length, `UI styles change ${view}: ${differences.slice(0, 12).join(', ')}`);
        return { view, elements: nodes.length };
      },
    };
  });

  check('browser parses only scoped UI rules', await evaluate(() => {
    const sheets = [...document.styleSheets].filter((sheet) => /\/(non-reading|library-stats)\.css$/.test(sheet.href || ''));
    if (sheets.length !== 2) return false;
    let count = 0;
    function walk(rules) {
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          count += 1;
          if (!rule.selectorText.split(',').every((selector) => /^(?:body(?:\.[\w-]+)*\s+)?#(?:home-view|library-view|stats-view)(?=$|[\s.#:[>])/.test(selector.trim()))) return false;
        } else if (!rule.cssRules || !walk(rule.cssRules)) return false;
      }
      return true;
    }
    return sheets.every((sheet) => walk(sheet.cssRules)) && count > 20;
  }));
  await evaluate(async () => { await __uiSmoke.wait(500); });
  await capture(win, 'home-light-1100x760');
  check('initial home', await evaluate(() => __gaiaDebug.getView() === 'home'));
  await evaluate(async () => { await __uiSmoke.click('#btn-home-add-books'); });
  check('home import dialog opens', await evaluate(() => !document.getElementById('book-import-overlay').hidden));
  await evaluate(async () => { await __uiSmoke.click('#btn-book-import-close'); await __uiSmoke.click('#btn-home-settings'); });
  check('home settings opens', await evaluate(() => __gaiaDebug.isSettingsOpen()));
  await evaluate(async () => { await __uiSmoke.click('#btn-settings-close'); await __uiSmoke.click('#btn-home-shelf'); });
  check('empty shelf and hint', await evaluate(() => __gaiaDebug.getView() === 'library' && !document.getElementById('library-hint').hidden && !document.querySelector('.book-card')));
  await capture(win, 'library-empty-1100x760');
  await evaluate(async () => { await __uiSmoke.click('#btn-add-books'); });
  check('library import dialog opens', await evaluate(() => !document.getElementById('book-import-overlay').hidden));
  await evaluate(async () => { await __uiSmoke.click('#btn-book-import-close'); });
  const imported = await evaluate(async (bookPath) => { await __gaiaDebug.importPaths([bookPath]); return __gaiaDebug.getLibraryCount(); }, books[0].path);
  check('real TXT import renders a card', imported === 1);
  await evaluate(async (items) => { for (const book of items) await __gaiaDebug.addToLibrary(book); }, books.slice(1));
  check('24 books render, empty hint hides, unsafe title remains text', await evaluate(() => __gaiaDebug.getLibraryCount() === 24 && document.querySelectorAll('.book-card').length === 24 && document.getElementById('library-hint').hidden && !window.__uiTitleUnsafe && [...document.querySelectorAll('.book-title')].some((el) => el.textContent.startsWith('<img') && !el.children.length)));
  await evaluate(async () => { await __uiSmoke.click('#btn-manage'); await __uiSmoke.click('#btn-select-all'); });
  check('bulk management selects every book', await evaluate(() => __gaiaDebug.getSelectedCount() === 24 && document.getElementById('manage-count').textContent === '24' && document.querySelectorAll('.book-card.selected').length === 24));
  await capture(win, 'library-manage-1100x760');
  await evaluate(async () => { await __uiSmoke.click('#btn-exit-manage'); });
  check('leaving bulk mode clears selection', await evaluate(() => __gaiaDebug.getSelectedCount() === 0 && document.getElementById('manage-bar').hidden));

  for (const theme of ['light', 'dark', 'eye']) {
    await evaluate(async (name) => { await __gaiaDebug.setTheme(name); await __uiSmoke.wait(300); }, theme);
    for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000]]) {
      win.setContentSize(width, height);
      await evaluate(async () => { await __uiSmoke.wait(180); __gaiaDebug.showView('home'); await __uiSmoke.wait(350); });
      report.checks.push(await evaluate(() => __uiSmoke.layout('home')));
      const takeShot = theme === 'light' || (theme === 'dark' && width === 1600);
      if (takeShot) await capture(win, `home-${theme}-${width}x${height}`);
      await evaluate(async () => { await __uiSmoke.click('#btn-home-shelf'); await __uiSmoke.wait(300); });
      report.checks.push(await evaluate(() => __uiSmoke.layout('library')));
      check(`long titles fit within two lines and card width ${theme} ${width}`, await evaluate(() => [...document.querySelectorAll('.book-title')].every((el) => {
        const r = el.getBoundingClientRect();
        return r.width <= el.closest('.book-card').getBoundingClientRect().width && r.height <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 1;
      })));
      check(`fallback cover text stays inside cover ${theme} ${width}`, await evaluate(() => [...document.querySelectorAll('.book-cover-placeholder')].every((cover) => {
        const outer = cover.getBoundingClientRect();
        return [...cover.querySelectorAll('.book-cover-name, .book-cover-type')].every((el) => { const r = el.getBoundingClientRect(); return r.left >= outer.left && r.right <= outer.right && r.top >= outer.top && r.bottom <= outer.bottom; });
      })));
      if (takeShot) await capture(win, `library-${theme}-${width}x${height}`);
      await evaluate(async () => { await __uiSmoke.click('#btn-reading-stats'); await __uiSmoke.wait(300); });
      report.checks.push(await evaluate(() => __uiSmoke.layout('stats')));
      check(`weekly chart and finished books ${theme} ${width}`, await evaluate(() => document.querySelectorAll('.stats-day').length === 7 && document.querySelectorAll('.stats-finished-book').length === 7));
      if (takeShot) await capture(win, `stats-${theme}-${width}x${height}`);
      await evaluate(async () => { await __uiSmoke.click('[data-goal-minutes="45"]'); });
      check(`goal persists ${theme} ${width}`, await evaluate(async () => __gaiaDebug.getReadingStats().goalMinutes === 45 && (await window.api.stateGet('readingStats')).goalMinutes === 45 && document.querySelector('[data-goal-minutes="45"]').classList.contains('active')));
      await evaluate(async () => { await __uiSmoke.click('[data-goal-minutes="30"]'); await __uiSmoke.click('#btn-stats-back'); });
      check(`stats return navigation ${theme} ${width}`, await evaluate(() => __gaiaDebug.getView() === 'library'));
    }
    await evaluate(async () => { __gaiaDebug.showView('home'); await __uiSmoke.wait(320); await __uiSmoke.click('#btn-home-ai'); await __uiSmoke.wait(350); });
    check(`AI page CSS remains identical ${theme}`, await evaluate(() => __uiSmoke.assertStyleIsolation('ai')));
    await evaluate(async () => { await __uiSmoke.click('#btn-ai-back'); });
    check(`AI back returns home ${theme}`, await evaluate(() => __gaiaDebug.getView() === 'home'));
    await evaluate(async (book) => { await __gaiaDebug.openBook(book); await __uiSmoke.wait(400); }, books[0]);
    check(`reader CSS remains identical ${theme}`, await evaluate(() => __uiSmoke.assertStyleIsolation('reader')));
    const pageMoved = await evaluate(async () => { const before = __gaiaDebug.getPaginatorPage(); await __gaiaDebug.nextPage(); await __uiSmoke.wait(200); return __gaiaDebug.getPaginatorPage() > before; });
    check(`reading still turns a page ${theme}`, pageMoved);
    await evaluate(async () => { await __gaiaDebug.backToLibrary(); });
  }
  check('no renderer exceptions', report.consoleErrors.filter((message) => /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/.test(message)).length === 0);
}

async function capture(win, name) {
  await win.webContents.executeJavaScript(`(async () => {
    const scroller = document.querySelector('#stats-view:not([hidden]) .stats-scroll');
    if (scroller) scroller.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const image = await win.webContents.capturePage();
  const target = path.join(outputDir, name + '.png');
  fs.writeFileSync(target, image.toPNG());
  if (!report.screenshots.includes(target)) report.screenshots.push(target);
}

require('../src/main');
