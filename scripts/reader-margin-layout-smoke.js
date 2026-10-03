'use strict';

// Real-reader regression with original fixtures and an isolated F: profile.
// --diagnose also compares temporary balance/auto overrides; source is untouched.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');
const { createKf8Fixture } = require('../tests/fixtures/kf8-book-fixture');
const project = path.resolve(__dirname, '..');
const sandbox = makeSmokeDirectory('gaia-reader-margins-');
const output = resolveFPath(process.env.GAIA_MARGIN_OUTPUT || path.join(sandbox, 'measurements'));
fs.mkdirSync(output, { recursive: true });
configureSmokePaths(app, { userData: sandbox });
app.setAppPath(project);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
fs.writeFileSync(path.join(sandbox, STATE_FILE_NAME), JSON.stringify({ library: [], prefs: { theme: 'light', fontSize: 100, txtFont: 16, marginPct: 8, verticalMarginPx: 0, spreadGap: 32, edgeTocEnabled: false }, pet: { autoSleep: false } }));
const diagnosing = process.argv.includes('--diagnose') || process.argv.includes('--button-and-widows-only');
const report = { purpose: diagnosing ? 'Measure natural line remainder and temporary CSS experiments.' : 'Check margin geometry, complete lines and source-preserving page flow.', sandbox, output, checks: [], measurements: [], comparisons: [], screenshots: [], errors: [] };
let win, finished = false, attached = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
const deadline = setTimeout(() => finish(new Error('Margin diagnosis timed out')), 180000);
const persist = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
function check(label, value) { assert.ok(value, label); report.checks.push(label); }
function finish(error) {
  if (finished) return;
  finished = true; clearTimeout(deadline);
  report.completed = !error;
  if (error) report.error = error.stack || String(error);
  persist(); console.log(JSON.stringify({ output, completed: report.completed, measurements: report.measurements.length, error: report.error }));
  app.exit(error ? 1 : 0);
}
const sentence = '夜色落在书页上，阅读的人沿着连续的文字前行，观察每一行在页面上下边界之间的位置，保持原文顺序并核对跨页时有没有丢字。';
const longText = sentence.repeat(145);
const shortText = sentence.repeat(7);
function writeMobi(file, html) {
  const title = 'Original margin fixture';
  const source = Buffer.from('<html><head><title>' + title + '</title></head><body>' + html + '</body></html>');
  const records = [];
  for (let offset = 0; offset < source.length; offset += 4096) records.push(source.subarray(offset, offset + 4096));
  const header = Buffer.alloc(248), exth = Buffer.alloc(12);
  exth.write('EXTH'); exth.writeUInt32BE(12, 4);
  header.writeUInt16BE(1, 0); header.writeUInt32BE(source.length, 4); header.writeUInt16BE(records.length, 8); header.writeUInt16BE(4096, 10);
  header.write('MOBI', 16); header.writeUInt32BE(232, 20); header.writeUInt32BE(2, 24); header.writeUInt32BE(65001, 28); header.writeUInt32BE(0x47414941, 32); header.writeUInt32BE(6, 36);
  header.writeUInt32BE(header.length + exth.length, 84); header.writeUInt32BE(Buffer.byteLength(title), 88); header[95] = 9;
  header.writeUInt32BE(records.length + 1, 108); header.writeUInt32BE(0x40, 128); header.writeUInt32BE(0xffffffff, 244);
  records.unshift(Buffer.concat([header, exth, Buffer.from(title)]));
  const palm = Buffer.alloc(78 + records.length * 8 + 2);
  palm.write('Gaia margin fixture'); palm.write('BOOKMOBI', 60); palm.writeUInt16BE(records.length, 76);
  let offset = palm.length;
  records.forEach((record, i) => { palm.writeUInt32BE(offset, 78 + i * 8); palm.writeUInt32BE(i + 1, 82 + i * 8); offset += record.length; });
  fs.writeFileSync(file, Buffer.concat([palm, ...records]));
}
async function fixtures() {
  const directory = path.join(sandbox, 'books'); fs.mkdirSync(directory);
  const make = (format, name) => ({ path: path.join(directory, name + '.' + format), format, title: name });
  const books = { epub: make('epub', '连续长段与短章'), txt: make('txt', '连续正文'), txtShort: make('txt', '双页短章'), mobi: make('mobi', '连续正文'), mobiShort: make('mobi', '双页短章') };
  fs.writeFileSync(books.txt.path, '第一章 连续正文\n\n' + longText);
  fs.writeFileSync(books.txtShort.path, '第一章 双页短章\n\n' + shortText);
  writeMobi(books.mobi.path, '<h1>连续正文</h1><p>' + longText + '</p>');
  writeMobi(books.mobiShort.path, '<h1>双页短章</h1><p>' + shortText + '</p>');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">gaia-margin-fixture</dc:identifier><dc:title>边距隔离样书</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="long" href="long.xhtml" media-type="application/xhtml+xml"/><item id="short" href="short.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="long"/><itemref idref="short"/></spine></package>');
  zip.file('OEBPS/toc.ncx', '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>边距隔离样书</text></docTitle><navMap><navPoint id="long" playOrder="1"><navLabel><text>连续正文</text></navLabel><content src="long.xhtml"/></navPoint><navPoint id="short" playOrder="2"><navLabel><text>双页短章</text></navLabel><content src="short.xhtml"/></navPoint></navMap></ncx>');
  for (const [name, title, text] of [['long', '连续正文', longText], ['short', '双页短章', shortText]]) zip.file('OEBPS/' + name + '.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + title + '</title><style>body{font-size:16px}p{font-size:16px}h1{font-size:24px}</style></head><body><h1>' + title + '</h1><p>' + text + '</p></body></html>');
  fs.writeFileSync(books.epub.path, await zip.generateAsync({ type: 'nodebuffer' }));
  books.azw3 = createKf8Fixture(directory);
  return books;
}
async function settle() {
  await evaluate(async () => { await __gaiaDebug.waitForReaderLayoutRefresh(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await wait(140);
}
async function margin(value) {
  await evaluate(value => {
    state.prefs.verticalMarginPx = value;
    if (state.current.paginator) state.current.paginator.setMargins({ horizontalPct: 8, verticalPx: value });
    if (state.current.rendition) state.current.rendition.getContents().forEach(applyReaderStyles);
  }, value);
  await settle();
}
async function measure(label) {
  const row = await evaluate(label => {
    const current = state.current;
    const rect = value => { const r = value.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const reader = rect(els.readerContent), body = rect($('reader-body'));
    const all = current.paginator ? [{ document: current.paginator.doc, frame: current.paginator.frame }] : current.rendition.getContents().map(contents => ({ document: contents.document, frame: contents.window.frameElement }));
    const frames = all.map(({ document: doc, frame }) => {
      const fr = rect(frame), root = doc.body, style = doc.defaultView.getComputedStyle(root);
      const clip = { left: Math.max(reader.left, fr.left), right: Math.min(reader.right, fr.right), top: Math.max(reader.top, fr.top), bottom: Math.min(reader.bottom, fr.bottom) };
      const lines = [];
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim() || node.parentElement.closest('style,script,svg')) continue;
        const range = doc.createRange(); range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          const bounds = { left: r.left + fr.left, right: r.right + fr.left, top: r.top + fr.top, bottom: r.bottom + fr.top, height: r.height };
          if (r.width < 1 || r.height < 1 || bounds.right <= clip.left + .2 || bounds.left >= clip.right - .2 || bounds.bottom <= clip.top || bounds.top >= clip.bottom) continue;
          lines.push({ ...bounds, tag: node.parentElement.tagName, clippedTop: bounds.top < clip.top - .5, clippedBottom: bounds.bottom > clip.bottom + .5 });
        }
      }
      const grouped = [0, 1].map(index => {
        const selected = lines.filter(line => state.readMode !== 'spread' ? index === 0 : (line.left + line.right) / 2 < (reader.left + reader.right) / 2 ? index === 0 : index === 1);
        if (!selected.length) return null;
        const first = selected.reduce((a, b) => a.top < b.top ? a : b), last = selected.reduce((a, b) => a.bottom > b.bottom ? a : b);
        return { index, textRects: selected.length, first, last, topWhitespace: first.top - reader.top, bottomWhitespace: reader.bottom - last.bottom, clippedCount: selected.filter(line => line.clippedTop || line.clippedBottom).length };
      }).filter(Boolean);
      const first = root.firstElementChild, firstStyle = first && doc.defaultView.getComputedStyle(first);
      return { frame: fr, body: rect(root), clip, htmlClientHeight: doc.documentElement.clientHeight, bodyClientHeight: root.clientHeight, bodyScrollHeight: root.scrollHeight, scrollWidth: root.scrollWidth,
        bodyStyle: Object.fromEntries(['height', 'boxSizing', 'paddingTop', 'paddingBottom', 'marginTop', 'marginBottom', 'columnFill', 'columnWidth', 'columnGap', 'lineHeight', 'fontSize', 'overflow', 'widows', 'orphans'].map(key => [key, style[key]])),
        firstChild: first ? { tag: first.tagName, rect: rect(first), marginTop: firstStyle.marginTop, marginBottom: firstStyle.marginBottom } : null, visibleColumns: grouped,
      };
    });
    const location = current.rendition && current.rendition.currentLocation();
    return { label, format: current.format, mode: state.readMode, margin: currentVerticalMargin(), reader, readerBody: body, frameCount: frames.length, frames,
      page: current.paginator ? current.paginator.currentPage : location && location.start.displayed.page, totalPages: current.paginator ? current.paginator.totalPages : location && location.start.displayed.total,
      chapter: current.flow ? current.flow.chapter : location && location.start.href,
    };
  }, label);
  report.measurements.push(row); persist();
  if (!diagnosing) {
    const prefix = [row.format, row.mode, row.margin + 'px', label].join(' / ');
    check(prefix + ': both requested vertical paddings match', row.frames.every(frame => parseFloat(frame.bodyStyle.paddingTop) === row.margin && parseFloat(frame.bodyStyle.paddingBottom) === row.margin));
    check(prefix + ': body and frame use the full reader height', row.frames.every(frame => Math.abs(frame.frame.height - row.reader.height) < 1 && Math.abs(parseFloat(frame.bodyStyle.height) - row.reader.height) < 1));
    check(prefix + ': complete visible text lines are not clipped', row.frames.every(frame => frame.visibleColumns.every(column => column.clippedCount === 0)));
  }
  console.log(JSON.stringify({ label, format: row.format, mode: row.mode, margin: row.margin, page: row.page, totalPages: row.totalPages, columns: row.frames.flatMap(frame => frame.visibleColumns.map(col => ({ index: col.index, top: col.topWhitespace, bottom: col.bottomWhitespace, clipped: col.clippedCount }))) }));
  return row;
}
async function shot(name) {
  win.showInactive(); win.moveTop(); win.webContents.invalidate(); await settle();
  const file = path.join(output, name + '.png'); fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); report.screenshots.push(file); persist();
}
async function authoredPaginationRules() {
  const result = await evaluate(() => {
    const c = state.current, doc = c.paginator ? c.paginator.doc : c.rendition.getContents()[0].document;
    const read = () => {
      const body = doc.defaultView.getComputedStyle(doc.body), paragraph = doc.defaultView.getComputedStyle(doc.querySelector('p'));
      return { body: [body.widows, body.orphans], paragraph: [paragraph.widows, paragraph.orphans] };
    };
    const defaults = read();
    const style = doc.createElement('style');
    // Insert before application rules: selector specificity, not later insertion,
    // must preserve the book author's explicit pagination choices.
    style.textContent = 'body{widows:2;orphans:2}'; doc.head.prepend(style);
    const authorBody = read();
    style.textContent = 'p{widows:2;orphans:2}';
    const authorParagraph = read();
    style.remove();
    const restored = read();
    if (c.paginator) { c.paginator.measure(); c.paginator.showPage(0); }
    return { format: c.format, defaults, authorBody, authorParagraph, restored };
  });
  (report.authoredRules ||= []).push(result);
  check(result.format + ': unstyled text inherits one-line pagination defaults', [...result.defaults.body, ...result.defaults.paragraph].every(value => value === '1'));
  check(result.format + ': earlier authored body rules override the defaults', [...result.authorBody.body, ...result.authorBody.paragraph].every(value => value === '2'));
  check(result.format + ': earlier authored paragraph rules retain their own values', result.authorParagraph.body.every(value => value === '1') && result.authorParagraph.paragraph.every(value => value === '2'));
  check(result.format + ': removing only the experimental author style restores defaults', JSON.stringify(result.defaults) === JSON.stringify(result.restored));
  persist(); await settle();
}
async function compareFill(label) {
  const result = await evaluate(async label => {
    const p = state.current.paginator;
    if (!p) return null;
    const before = p.doc.body.style.getPropertyValue('column-fill'), priority = p.doc.body.style.getPropertyPriority('column-fill'), page = p.currentPage;
    const source = p.sourceText();
    const versions = [];
    const defaultFill = p.doc.defaultView.getComputedStyle(p.doc.body).columnFill;
    for (const fill of label.diagnosing ? ['balance', 'auto'] : [defaultFill]) {
      p.doc.body.style.setProperty('column-fill', fill, 'important'); p.measure(); p.showPage(Math.min(page, p.totalPages - 1));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const parts = Array.from({ length: p.totalPages }, (_, i) => p.pageTextRange(i, i).content);
      versions.push({ fill, totalPages: p.totalPages, sourceLength: source.length, extractedLength: parts.join('').length, textMatchesExactly: parts.join('') === source, perPageCharacters: parts.map(value => value.length) });
    }
    if (before) p.doc.body.style.setProperty('column-fill', before, priority); else p.doc.body.style.removeProperty('column-fill');
    p.measure(); p.showPage(page);
    return { label: label.text, defaultFill, format: state.current.format, mode: state.readMode, margin: currentVerticalMargin(), versions };
  }, { text: label, diagnosing });
  if (result) {
    report.comparisons.push(result);
    if (!diagnosing) {
      const prefix = [result.format, result.mode, result.margin + 'px', label].join(' / ');
      check(prefix + ': pages preserve every source character exactly once', result.versions.every(version => version.textMatchesExactly));
      check(prefix + ': pagination fills columns in reading order', result.defaultFill === 'auto');
      if (label === 'short chapter fill' && result.mode === 'spread') check(prefix + ': short text fills the first page before the second', result.versions[0].perPageCharacters[0] === result.versions[0].sourceLength && result.versions[0].perPageCharacters.slice(1).every(count => count === 0));
    }
    persist();
  }
}
async function paginatorScenarios(book, short = false) {
  await evaluate(book => __gaiaDebug.openBook(book), book); await settle();
  if (!short) await authoredPaginationRules();
  for (const marginValue of [0, 28]) for (const mode of ['single', 'spread']) {
    await evaluate(mode => __gaiaDebug.setMode(mode), mode); await margin(marginValue);
    await evaluate(() => state.current.paginator.showPage(0)); await settle();
    await measure(short ? 'short chapter start' : 'chapter start');
    if (!short) {
      await evaluate(() => { const p = state.current.paginator; p.showPage(Math.min(p.totalPages - 1, state.readMode === 'spread' ? 2 : 1)); }); await settle();
      await measure('continuous page');
      if (book.format === 'mobi' && marginValue === 0 && mode === 'single') await shot('mobi-margin0-continuous');
    }
    await compareFill(short ? 'short chapter fill' : 'continuous text fill');
    if (short && book.format === 'mobi' && marginValue === 0 && mode === 'spread') {
      await shot('mobi-short-default');
      if (!diagnosing) continue;
      await evaluate(() => { const p = state.current.paginator; p.doc.body.style.setProperty('column-fill', 'auto', 'important'); p.measure(); p.showPage(0); }); await settle();
      await measure('short chapter auto experiment'); await shot('mobi-short-auto');
      await evaluate(() => { const p = state.current.paginator; p.doc.body.style.removeProperty('column-fill'); p.measure(); p.showPage(0); });
    }
  }
}
async function buttonAndWidows(books) {
  await evaluate(book => __gaiaDebug.openBook(book), books.epub); await settle();
  await evaluate(() => __gaiaDebug.setMode('single')); await margin(28);
  await evaluate(async () => { await state.current.rendition.display('long.xhtml'); await __gaiaDebug.nextPage(); }); await settle();
  await measure('before real margin button: 28px');
  await evaluate(async () => {
    __gaiaDebug.openSettings();
    for (let i = 0; currentVerticalMargin() !== 0 && i < 6; i++) $('btn-vertical-margin').click();
    __gaiaDebug.closeSettings();
    await __gaiaDebug.waitForReaderLayoutRefresh();
  });
  await wait(400); await settle();
  const zero = await measure('after real margin button: 0px');
  await evaluate(async () => { await __gaiaDebug.nextPage(); }); await settle();
  const next = await measure('after real margin button: next page');
  check('EPUB margin button updates both paddings to zero and survives page turn', [zero, next].every(row => row.margin === 0 && row.frames.every(frame => frame.bodyStyle.paddingTop === '0px' && frame.bodyStyle.paddingBottom === '0px')));
  check('EPUB margin button preserves full viewport height and complete lines', [zero, next].every(row => row.frames.every(frame => Math.abs(frame.frame.height - row.reader.height) < 1 && frame.visibleColumns.every(column => column.clippedCount === 0))));
  await evaluate(book => __gaiaDebug.openBook(book), books.azw3); await settle();
  await evaluate(() => __gaiaDebug.setMode('spread')); await margin(0);
  await evaluate(() => state.current.paginator.showPage(0)); await settle();
  async function paragraphs(label) {
    const result = await evaluate(label => {
      const p = state.current.paginator, doc = p.doc, frame = p.frame.getBoundingClientRect(), reader = els.readerContent.getBoundingClientRect();
      const clip = { left: (reader.left + reader.right) / 2, right: reader.right, top: reader.top, bottom: reader.bottom };
      const entries = [...doc.querySelectorAll('p')].map((element, index) => {
        const style = doc.defaultView.getComputedStyle(element), range = doc.createRange(); range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter(r => r.width > 0).map(r => ({ left: r.left + frame.left, right: r.right + frame.left, top: r.top + frame.top, bottom: r.bottom + frame.top }));
        const visible = rects.filter(r => r.left < clip.right && r.right > clip.left && r.top < clip.bottom && r.bottom > clip.top);
        return { index, textLength: element.textContent.length, textPrefix: element.textContent.slice(0, 45), visible: visible.length > 0, visibleRects: visible, allRects: rects,
          style: Object.fromEntries(['breakInside', 'breakBefore', 'breakAfter', 'widows', 'orphans', 'marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'lineHeight'].map(key => [key, style[key]])) };
      });
      const visible = entries.filter(item => item.visible), last = visible.at(-1);
      return { label, clip, visible, following: last ? entries[last.index + 1] : null };
    }, label);
    (report.paragraphExperiments ||= []).push(result); persist();
  }
  const compact = await measure('KF8 default one-line pagination'); await paragraphs('default paragraph rules');
  await shot('kf8-margin0-default');
  await evaluate(() => {
    const p = state.current.paginator, css = p.doc.createElement('style');
    css.id = 'margin-diagnostic-widows'; css.textContent = 'p{widows:2;orphans:2}'; p.doc.head.prepend(css);
    p.measure(); p.showPage(0);
  }); await settle();
  const reference = await measure('KF8 authored two-line pagination'); await paragraphs('authored widows2 orphans2');
  const rightBottom = row => row.frames.flatMap(frame => frame.visibleColumns).find(column => column.index === 1).bottomWhitespace;
  check('KF8 default reduces the avoidable two-line-rule gap in a continuous column', rightBottom(compact) >= 0 && rightBottom(reference) - rightBottom(compact) > 20);
  check('KF8 tighter pagination preserves typography and complete text lines', compact.frames[0].bodyStyle.fontSize === reference.frames[0].bodyStyle.fontSize && compact.frames[0].bodyStyle.lineHeight === reference.frames[0].bodyStyle.lineHeight && compact.frames.every(frame => frame.visibleColumns.every(column => column.clippedCount === 0)));
  await evaluate(() => { const p = state.current.paginator; p.doc.getElementById('margin-diagnostic-widows').remove(); p.measure(); p.showPage(0); });
  check('no renderer errors', report.errors.length === 0);
}
async function run() {
  await evaluate(() => __gaiaDebug.waitHome()); win.setContentSize(1100, 760); win.showInactive(); win.moveTop();
  const books = await fixtures();
  if (process.argv.includes('--button-and-widows-only')) return buttonAndWidows(books);
  await evaluate(book => __gaiaDebug.openBook(book), books.epub); await settle();
  await authoredPaginationRules();
  for (const marginValue of [0, 28]) for (const mode of ['single', 'spread']) {
    await evaluate(mode => __gaiaDebug.setMode(mode), mode); await margin(marginValue);
    await evaluate(async () => { await state.current.rendition.display('long.xhtml'); }); await settle();
    await measure('chapter start');
    await evaluate(async () => { await __gaiaDebug.nextPage(); }); await settle();
    await measure('continuous page');
    if (marginValue === 0 && mode === 'single') await shot('epub-margin0-continuous');
    await evaluate(async () => { await state.current.rendition.display('short.xhtml'); }); await settle();
    await measure('short chapter start');
  }
  await paginatorScenarios(books.mobi);
  await paginatorScenarios(books.mobiShort, true);
  await paginatorScenarios(books.txt);
  await paginatorScenarios(books.txtShort, true);
  await paginatorScenarios(books.azw3);
  check('no renderer errors', report.errors.length === 0);
}
BrowserWindow.prototype.show = function () { this.showInactive(); };
app.on('browser-window-created', (_event, window) => {
  if (attached) return; attached = true; win = window;
  win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  win.webContents.once('did-finish-load', () => run().then(() => finish(), finish));
});
require('../src/main');
