'use strict';

// Run with: npx electron scripts/non-reading-smoke.js
// All test books, preferences and screenshots live in a new temporary directory.
// GAIA_UI_OUTPUT_DIR may point to another screenshot/report directory.
const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { dateKey } = require('../src/shared/reading-stats');

// Install before loading the main process so link checks never open the real browser.
const externalRequests = [];
shell.openExternal = async (url) => { externalRequests.push(url); };
let windowsCreated = 0;
app.on('browser-window-created', () => { windowsCreated += 1; });

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
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light' }, pet: { auto: false, autoSpeech: false, autoSleep: false }, progress, readingStats: { version: 1, goalMinutes: 30, days, completedBooks } }));

const report = { userData: sandbox, outputDir, checks: [], screenshots: [], consoleErrors: [], externalRequests };
let finished = false;
const timeout = setTimeout(() => finish(new Error('UI smoke timed out after 210 seconds')), 210000);
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
  win.webContents.setAudioMuted(true);
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
        if (view === 'library' && root.querySelector('.book-card')) {
          const first = root.querySelector('.book-card').getBoundingClientRect();
          requireTrue(first.bottom <= innerHeight, `the first book does not fit below the shelf header (${first.bottom}/${innerHeight})`);
        }
        return { view, width: innerWidth, height: innerHeight, cards: root.querySelectorAll('.book-card').length };
      },
      async controls(view) {
        const root = document.getElementById(view + '-view');
        const scrollPositions = [root, ...root.querySelectorAll('*')]
          .filter((el) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
          .map((el) => [el, el.scrollLeft, el.scrollTop]);
        const controls = [...root.querySelectorAll('button, [role="button"], a[href]')].filter(visible);
        try {
          for (const el of controls) {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rect = el.getBoundingClientRect();
            let left = Math.max(0, rect.left);
            let right = Math.min(innerWidth, rect.right);
            let top = Math.max(0, rect.top);
            let bottom = Math.min(innerHeight, rect.bottom);
            for (let parent = el.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              const clip = parent.getBoundingClientRect();
              if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
              if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
            }
            const label = el.id || el.textContent.trim();
            // Home targets share the canvas scale; other views retain their original sizing.
            const homeScale = view === 'home' ? root.querySelector('.home-surface').getBoundingClientRect().width / 1100 : 1;
            const minimumSize = view === 'home' ? 24 * homeScale : el.closest('.bgm-capsule') ? 1 : 24;
            requireTrue(right - left >= minimumSize && bottom - top >= minimumSize, `${view} control ${label} has no reachable ${minimumSize}px target`);
            const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
            requireTrue(hit === el || el.contains(hit), `${view} control ${label} is covered by ${hit && (hit.id || hit.className)}`);
          }
        } finally {
          for (const [el, x, y] of scrollPositions) { el.scrollLeft = x; el.scrollTop = y; }
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return { view, reachableControls: controls.length };
      },
      contrast(view) {
        // Test resolved text colors over the painted background-color layers.
        // Artwork, gradients and pseudo-elements still require screenshot review.
        const root = document.getElementById(view + '-view');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = (value) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          const pixel = [...context.getImageData(0, 0, 1, 1).data];
          return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
        };
        const over = (foreground, background) => foreground.slice(0, 3).map((channel, i) => channel * foreground[3] + background[i] * (1 - foreground[3]));
        const luminance = (color) => color.map((channel) => {
          const value = channel / 255;
          return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        }).reduce((total, channel, i) => total + channel * [.2126, .7152, .0722][i], 0);
        const selector = {
          home: '#home-title, button',
          library: '.page-title, .library-heading h1, .library-status > span, button, .book-title, .book-author, .book-format, .book-progress-label, .hint > strong, .hint > span:not([aria-hidden]), .hint > small, .library-footer > span',
          stats: '.page-title, .stats-page-heading, button, .stats-eyebrow, .stats-today, .stats-secondary, .stats-companion-copy > span, .stats-alice-line, .stats-ring-center strong, .stats-section-head h2, .stats-section-head > strong, .stats-section-head > span, .stats-streak strong, .stats-streak small, .stats-day-label, .stats-day-minutes, .stats-finished-title, .stats-empty, .stats-footer > span',
        }[view];
        // Shared music controls are outside the palette redesign; they retain baseline layout checks.
        const nodes = [...root.querySelectorAll(selector)].filter((el) => visible(el) && el.textContent.trim() && !el.closest('.bgm-capsule'));
        let lowestRatio = Infinity;
        for (const el of nodes) {
          const ancestors = [];
          for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
          let background = [255, 255, 255];
          let opacity = 1;
          for (const node of ancestors) {
            const style = getComputedStyle(node);
            background = over(rgba(style.backgroundColor), background);
            opacity *= Number(style.opacity);
          }
          const style = getComputedStyle(el);
          const foreground = rgba(style.color);
          foreground[3] *= opacity;
          const text = luminance(over(foreground, background));
          const surface = luminance(background);
          const ratio = (Math.max(text, surface) + .05) / (Math.min(text, surface) + .05);
          const fontSize = parseFloat(style.fontSize);
          const large = fontSize >= 24 || (fontSize >= 18.66 && Number(style.fontWeight) >= 700);
          const minimum = large ? 3 : 4.5;
          requireTrue(ratio >= minimum, `${view} text ${el.id || el.className} contrasts ${ratio.toFixed(2)}:1; needs ${minimum}:1 (${style.color} on ${background.map(Math.round).join(',')})`);
          lowestRatio = Math.min(lowestRatio, ratio);
        }
        requireTrue(nodes.length > 0, `${view} has no readable text to check`);
        return { view, contrastSamples: nodes.length, minimumBaseContrast: Number(lowestRatio.toFixed(2)) };
      },
      assertStyleIsolation(view) {
        const sheets = [...document.styleSheets].filter((sheet) => /\/(non-reading|library-stats|home)\.css$/.test(sheet.href || ''));
        requireTrue(sheets.length === 3, 'All UI stylesheets must be loaded');
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

  if (process.env.GAIA_UI_SETTINGS_ONLY === '1') {
    await require('./settings-runtime-checks')({ win, report, check, capture, book: books[0] });
    check('no renderer exceptions', report.consoleErrors.filter((message) => /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/.test(message)).length === 0);
    return;
  }
  check('browser parses only scoped UI rules', await evaluate(() => {
    const sheets = [...document.styleSheets].filter((sheet) => /\/(non-reading|library-stats|home)\.css$/.test(sheet.href || ''));
    if (sheets.length !== 3) return false;
    let count = 0;
    function walk(rules) {
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          count += 1;
          if (!rule.selectorText.split(',').every((selector) => /^(?:body(?:\.[\w-]+)*\s+)?#(?:home-view|library-view|stats-view)(?=$|[\s.#:[>])/.test(selector.trim()))) return false;
        } else if (rule.type === CSSRule.FONT_FACE_RULE) {
          if (!/^"?Gaia (Home Noto|Wordmark)"?$/.test(rule.style.fontFamily)) return false;
        } else if (!rule.cssRules || !walk(rule.cssRules)) return false;
      }
      return true;
    }
    return sheets.every((sheet) => walk(sheet.cssRules)) && count > 20;
  }));
  await evaluate(async () => { await __uiSmoke.wait(500); });
  await require('./home-runtime-checks')({ win, report, check, capture });
  check('no renderer exceptions during live homepage checks', report.consoleErrors.filter((message) => /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/.test(message)).length === 0);
  if (process.env.GAIA_UI_HOME_ONLY === '1') return;
  await capture(win, 'home-light-1100x760');
  check('initial home', await evaluate(() => __gaiaDebug.getView() === 'home'));
  check('no third-party promotional branding or links on any application page', await evaluate(() =>
    !/deerflow/i.test(document.body.innerHTML) && !document.querySelector('.design-credit')
  ));
  check('homepage has not requested an external website or child window', externalRequests.length === 0 && windowsCreated === 1);
  await evaluate(async () => { await __uiSmoke.click('#btn-home-add-books'); });
  check('home import dialog opens', await evaluate(() => !document.getElementById('book-import-overlay').hidden));
  await evaluate(async () => { await __uiSmoke.click('#btn-book-import-close'); await __uiSmoke.click('#btn-home-settings'); });
  check('home settings opens', await evaluate(() => __gaiaDebug.isSettingsOpen()));
  await evaluate(async () => { await __uiSmoke.click('#btn-settings-close'); await __uiSmoke.click('#btn-home-shelf'); });
  check('empty shelf and hint', await evaluate(() => __gaiaDebug.getView() === 'library' && !document.getElementById('library-hint').hidden && !document.querySelector('.book-card')));
  for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000]]) {
    win.setContentSize(width, height);
    await evaluate(async () => { await __uiSmoke.wait(180); });
    report.checks.push({ state: 'empty', ...await evaluate(() => __uiSmoke.layout('library')) });
    report.checks.push({ state: 'empty', ...await evaluate(() => __uiSmoke.controls('library')) });
    report.checks.push({ state: 'empty', ...await evaluate(() => __uiSmoke.contrast('library')) });
    await capture(win, `library-empty-${width}x${height}`);
  }
  win.setContentSize(1100, 760);
  await evaluate(async () => { await __uiSmoke.wait(180); });
  await evaluate(async () => { await __uiSmoke.click('#btn-add-books'); });
  check('library import dialog opens', await evaluate(() => !document.getElementById('book-import-overlay').hidden));
  await evaluate(async () => { await __uiSmoke.click('#btn-book-import-close'); });
  const imported = await evaluate(async (bookPath) => { await __gaiaDebug.importPaths([bookPath]); return __gaiaDebug.getLibraryCount(); }, books[0].path);
  check('real TXT import renders a card', imported === 1);
  await evaluate(async (items) => { for (const book of items) await __gaiaDebug.addToLibrary(book); }, books.slice(1));
  check('24 books render, empty hint hides, unsafe title remains text', await evaluate(() => __gaiaDebug.getLibraryCount() === 24 && document.querySelectorAll('.book-card').length === 24 && document.getElementById('library-hint').hidden && !window.__uiTitleUnsafe && [...document.querySelectorAll('.book-title')].some((el) => el.textContent.startsWith('<img') && !el.children.length)));
  await evaluate(async () => { await __uiSmoke.click('#btn-manage'); await __uiSmoke.click('#btn-select-all'); });
  check('bulk management selects every book', await evaluate(() => __gaiaDebug.getSelectedCount() === 24 && document.getElementById('manage-count').textContent === '24' && document.querySelectorAll('.book-card.selected').length === 24));
  report.checks.push(await evaluate(() => __uiSmoke.controls('library')));
  report.checks.push(await evaluate(() => __uiSmoke.contrast('library')));
  await capture(win, 'library-manage-1100x760');
  await evaluate(async () => { await __uiSmoke.click('#btn-exit-manage'); });
  check('leaving bulk mode clears selection', await evaluate(() => __gaiaDebug.getSelectedCount() === 0 && document.getElementById('manage-bar').hidden));

  for (const theme of ['light', 'dark', 'eye']) {
    await evaluate(async (name) => { await __gaiaDebug.setTheme(name); await __uiSmoke.wait(300); }, theme);
    for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000]]) {
      win.setContentSize(width, height);
      await evaluate(async () => { await __uiSmoke.wait(180); __gaiaDebug.showView('home'); await __uiSmoke.wait(350); });
      report.checks.push(await evaluate(() => __uiSmoke.layout('home')));
      report.checks.push(await evaluate(() => __uiSmoke.controls('home')));
      report.checks.push(await evaluate(() => __uiSmoke.contrast('home')));
      const takeShot = theme === 'light' || (theme === 'dark' && width === 1600);
      if (takeShot) await capture(win, `home-${theme}-${width}x${height}`);
      await evaluate(async () => { await __uiSmoke.click('#btn-home-shelf'); await __uiSmoke.wait(300); });
      report.checks.push(await evaluate(() => __uiSmoke.layout('library')));
      report.checks.push(await evaluate(() => __uiSmoke.controls('library')));
      report.checks.push(await evaluate(() => __uiSmoke.contrast('library')));
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
      report.checks.push(await evaluate(() => __uiSmoke.controls('stats')));
      report.checks.push(await evaluate(() => __uiSmoke.contrast('stats')));
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
  await require('./settings-runtime-checks')({ win, report, check, capture, book: books[0] });
  check('no renderer exceptions', report.consoleErrors.filter((message) => /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/.test(message)).length === 0);
}

async function capture(win, name, clip) {
  await win.webContents.executeJavaScript(`(async () => {
    const scroller = document.querySelector('#stats-view:not([hidden]) .stats-scroll');
    if (scroller) scroller.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const image = await win.webContents.capturePage(clip);
  const target = path.join(outputDir, name + '.png');
  fs.writeFileSync(target, image.toPNG());
  if (!report.screenshots.includes(target)) report.screenshots.push(target);
}

require('../src/main');
