'use strict';

// Real app + EPUB renderer; checks image decoding, footnote hover, and source glyphs.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const makeFixture = require('../tests/fixtures/epub-image-fixture');
const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-epub-image-'));
const output = path.resolve(process.env.GAIA_EPUB_IMAGE_OUTPUT || path.join(project, 'dist/epub-image-smoke'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { fontSize: 100, theme: 'light', marginPct: 8 }, pet: { auto: false, autoSpeech: false, autoSleep: false } }));
BrowserWindow.prototype.show = function () { this.showInactive(); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], measurements: [], screenshots: [], errors: [], sandbox, output };
let finished = false;
const deadline = setTimeout(() => finish(new Error('EPUB image validation timed out')), 90000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}
function check(name, value) { assert.ok(value, name); report.checks.push(name); }

require(path.join(project, 'src/main'));

async function run(win) {
  win.setContentSize(1100, 760);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const shot = async name => {
    await wait(200);
    const file = path.join(output, name + '.png');
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(file);
  };

  await evaluate(() => __gaiaDebug.waitHome());
  const book = await makeFixture(sandbox);
  await evaluate(book => __gaiaDebug.openBook(book), book);
  await wait(1500);

  const inspect = () => evaluate(() => {
    const c = state.current.rendition.getContents();
    const all = [];
    for (let i = 0; i < c.length; i++) {
      const doc = c[i].document;
      const bodyRect = doc.body.getBoundingClientRect();
      const columnWidth = parseFloat(getComputedStyle(doc.body).columnWidth) || bodyRect.width;
      const paddingTop = parseFloat(getComputedStyle(doc.body).paddingTop) || 0;
      const paddingBottom = parseFloat(getComputedStyle(doc.body).paddingBottom) || 0;
      const columnHeight = bodyRect.height - paddingTop - paddingBottom;
      const imgs = doc.querySelectorAll('img, svg');
      for (let j = 0; j < imgs.length; j++) {
        const img = imgs[j];
        const r = img.getBoundingClientRect();
        const figcaption = img.closest('figure') && img.closest('figure').querySelector('figcaption');
        const cs = getComputedStyle(img);
        all.push({
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt'),
          renderedWidth: r.width,
          renderedHeight: r.height,
          top: r.top,
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          columnIndex: Math.floor(r.left / columnWidth),
          columnWidth,
          columnHeight,
          display: cs.display,
          csMaxWidth: cs.maxWidth,
          csMaxHeight: cs.maxHeight,
          loaded: img.localName === 'img' ? img.complete && img.naturalWidth > 0 : true,
          inFigure: !!img.closest('figure'),
          inLink: !!img.closest('a'),
          inDiv: !!img.closest('div'),
          figcaption: figcaption ? { text: figcaption.textContent.trim(), display: getComputedStyle(figcaption).display } : null
        });
      }
    }
    return all;
  });

  const imgs = await inspect();
  report.measurements = imgs;
  check('载入样书后渲染出 4 张图', imgs.length === 4);
  check('EPUB 中含中文和空格的图片路径已成功解码', imgs.some(img => img.alt === '肖像图' && img.loaded && img.renderedWidth > 0));
  check('所有 EPUB 位图均已加载并解码', imgs.filter(img => img.src && !img.src.startsWith('data:image/svg')).every(img => img.loaded));
  check('所有图片均为块级', imgs.every(img => img.display === 'block'));
  for (const img of imgs) {
    const leftBound = img.columnIndex * img.columnWidth + img.columnWidth * 0.08;
    const rightBound = (img.columnIndex + 1) * img.columnWidth - img.columnWidth * 0.08;
    check(`${img.src} 宽度不超过列右边界(right=${img.right.toFixed(1)} <= ${rightBound.toFixed(1)})`, img.right <= rightBound + 1);
    check(`${img.src} 起点不早于列左边界(left=${img.left.toFixed(1)} >= ${leftBound.toFixed(1)})`, img.left >= leftBound - 1);
    check(`${img.src} 高度不超出列底(bottom=${img.bottom.toFixed(1)} <= ${(img.top + img.columnHeight + 1).toFixed(1)})`, img.bottom <= img.top + img.columnHeight + 1);
  }
  await shot('epub-image-default-1100x760');

  const sourceContent = await evaluate(async () => {
    const contents = state.current.rendition.getContents();
    const owner = contents.find(item => item.document.body.textContent.includes('原文脚注说明'));
    if (!owner) return null;
    let doc = owner.document;
    const ref = Array.from(doc.querySelectorAll('a[href]')).find(link => link.textContent.includes('注'));
    if (!ref) return null;
    const range = doc.createRange();
    range.selectNodeContents(ref);
    await state.current.rendition.display(owner.cfiFromRange(range));
    doc = state.current.rendition.getContents().map(item => item.document).find(item => item.body.textContent.includes('原文脚注说明'));
    const visibleRef = Array.from(doc.querySelectorAll('a[href]')).find(link => link.textContent.includes('注'));
    const tooltip = doc.querySelector('.gaia-footnote-tooltip');
    const before = !!tooltip && tooltip.hidden;
    visibleRef.dispatchEvent(new doc.defaultView.MouseEvent('mouseenter', { clientX: 300, clientY: 300 }));
    const after = !!tooltip && !tooltip.hidden && tooltip.textContent.includes('原文脚注说明');
    const sourceText = doc.body.textContent;
    const tooltipRect = tooltip.getBoundingClientRect();
    return { before, after, tooltipFits: tooltipRect.left >= 0 && tooltipRect.right <= doc.defaultView.innerWidth && tooltipRect.top >= 0 && tooltipRect.bottom <= doc.defaultView.innerHeight, glyphs: ['※', '†', '‡', '①', '㊟'].every(glyph => sourceText.includes(glyph)), ruby: !!doc.querySelector('ruby rt') };
  });
  check('注释默认隐藏，悬停注释标记后显示原文内容', !!sourceContent && sourceContent.before && sourceContent.after);
  check('悬停提示完整显示在阅读页内', !!sourceContent && sourceContent.tooltipFits);
  check('原文特殊符号与 ruby 注音元素均保留', !!sourceContent && sourceContent.glyphs && sourceContent.ruby);
  await wait(500);
  await shot('epub-footnote-hover');

  win.setContentSize(800, 600);
  await wait(800);
  const imgs800 = await inspect();
  for (const img of imgs800) {
    check(`窄屏 ${img.src} 不越过列`, img.right <= (img.columnIndex + 1) * img.columnWidth + 1);
  }
  await shot('epub-image-narrow-800x600');

  win.setContentSize(1600, 1000);
  await wait(800);
  const imgs1600 = await inspect();
  for (const img of imgs1600) {
    check(`宽屏 ${img.src} 不越过列`, img.right <= (img.columnIndex + 1) * img.columnWidth + 1);
  }
  await shot('epub-image-wide-1600x1000');

  await evaluate(() => __gaiaDebug.setMode('spread'));
  await wait(800);
  const imgsSpread = await inspect();
  check('双页模式下仍渲染 4 张图', imgsSpread.length === 4);
  for (const img of imgsSpread) {
    check(`双页 ${img.src} 不越过列`, img.right <= (img.columnIndex + 1) * img.columnWidth + 1);
  }
  await shot('epub-image-spread-1600x1000');

  await evaluate(() => { __gaiaDebug.setMode('single'); __gaiaDebug.setTheme('dark'); });
  await wait(600);
  await shot('epub-image-dark-1600x1000');

  const figInfo = await evaluate(() => {
      const c = state.current.rendition.getContents();
      const figcap = c[0].document.querySelector('figcaption');
      if (!figcap) return null;
      const cs = getComputedStyle(figcap);
      const r = figcap.getBoundingClientRect();
      return { text: figcap.textContent.trim(), display: cs.display, textIndent: cs.textIndent, fontSize: cs.fontSize, textAlign: cs.textAlign, width: r.width, left: r.left, right: r.right };
    });
  if (figInfo) {
    check('figcaption 文字内容保留', figInfo.text === '第三张图的说明文字,验证 figcaption 的居中与字号。');
    check('figcaption 不再首行缩进', figInfo.textIndent === '0px' || parseFloat(figInfo.textIndent) === 0);
    check('figcaption 居中显示', figInfo.textAlign === 'center');
  }
}

app.whenReady().then(() => {
  setTimeout(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) finish(new Error('Application window was not created'));
    else run(win).then(() => finish(), err => finish(err));
  }, 1200);
});
