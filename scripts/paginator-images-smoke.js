'use strict';

// Real Chromium layout, isolated from the application and all reader data.
// Run: electron scripts/paginator-images-smoke.js [--screenshots] [--output DIR]
const { app, BrowserWindow, protocol } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const { pathToFileURL } = require('node:url');

const project = path.resolve(__dirname, '..');
const sandbox = makeSmokeDirectory('paginator-images-session-');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) {
  throw new Error('--output requires a directory');
}
const output = resolveFPath(outputIndex >= 0 ? args[outputIndex + 1]
  : process.env.GAIA_PAGINATOR_IMAGES_OUTPUT || path.join(sandbox, 'screenshots'));
fs.mkdirSync(output, { recursive: true });
configureSmokePaths(app, { userData: path.join(sandbox, 'user-data'), sessionData: path.join(sandbox, 'session'), temp: sandbox });
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
protocol.registerSchemesAsPrivileged([{ scheme: 'gaia-image-smoke', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const requests = new Map();
const report = { passed: false, checks: [], measurements: [], screenshots: [], rendererErrors: [], output, sandbox };
let finished = false;
let win;
const deadline = setTimeout(() => finish(new Error('Paginator image validation timed out')), 90000);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  for (const resolve of requests.values()) resolve(new Response('', { status: 404 }));
  requests.clear();
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, error: report.error }, null, 2));
  app.exit(error ? 1 : 0);
}

function check(label, value) {
  assert.ok(value, label);
  report.checks.push(label);
}

function close(actual, expected, label, tolerance = 1) {
  check(`${label}: ${actual} ≈ ${expected}`, Math.abs(actual - expected) <= tolerance);
}

function svg(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffc847"/>`
    + `<rect width="${width}" height="${height / 3}" fill="#ee5354"/>`
    + `<rect y="${height * .9}" width="${width}" height="${height / 10}" fill="#18b875"/></svg>`;
}

const portrait = svg(400, 1800);
const landscape = svg(1200, 400);
const small = svg(18, 12);
const dataImage = source => 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64');
const paragraphs = (from, to) => Array.from({ length: to - from }, (_, n) => {
  const i = n + from;
  return `<p id="paragraph-${i}">第 ${i} 段文字锚点。${'长图加载前后，正在阅读的这一行仍应保留在当前页面。'.repeat(6)}</p>`;
}).join('');
const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);

async function settle() {
  await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await wait(80);
}

async function until(fn, label, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(fn)) return;
    await wait(40);
  }
  throw new Error(label);
}

async function render(html, track = false, cssText = '') {
  await evaluate(async ({ html, track, cssText }) => {
    window.changeCount = 0;
    window.totalCount = 0;
    window.reader.onChange = () => window.changeCount++;
    window.reader.onTotalChange = () => window.totalCount++;
    await window.reader.render(html, cssText, { beforeCommit() {
      const doc = window.reader.doc;
      doc.defaultView.addEventListener('error', event => {
        if (event.error) console.error('PAGINATOR_EXCEPTION: ' + event.error.stack);
      });
      if (!track) return;
      // Track real IMG listeners on this document, without replacing their callbacks.
      const proto = doc.defaultView.EventTarget.prototype;
      const add = proto.addEventListener;
      const remove = proto.removeEventListener;
      const listeners = new Map();
      const key = target => {
        if (!listeners.has(target)) listeners.set(target, { load: new Set(), error: new Set() });
        return listeners.get(target);
      };
      proto.addEventListener = function (type, listener, options) {
        if (this instanceof doc.defaultView.HTMLImageElement && (type === 'load' || type === 'error')) key(this)[type].add(listener);
        return add.call(this, type, listener, options);
      };
      proto.removeEventListener = function (type, listener, options) {
        if (listeners.has(this) && (type === 'load' || type === 'error')) key(this)[type].delete(listener);
        return remove.call(this, type, listener, options);
      };
      window.listenerTrackers.push({ doc, count: () => Array.from(listeners.values()).reduce((sum, entry) => sum + entry.load.size + entry.error.size, 0) });
    } });
    window.reader.showPage(0);
  }, { html, track, cssText });
  await settle();
}

async function release(name, source = portrait) {
  const resolve = requests.get(name);
  assert.ok(resolve, `Image request ${name} is pending`);
  requests.delete(name);
  resolve(new Response(source, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } }));
  await settle();
}

async function imageMetrics(id) {
  return evaluate(id => {
    const p = window.reader;
    p.showPage(0);
    const img = p.doc.getElementById(id);
    const page = Math.max(0, Math.floor((img.getBoundingClientRect().left + .5) / p.colStep));
    p.showPage(page);
    const box = img.getBoundingClientRect();
    const frame = p.frame.getBoundingClientRect();
    const style = p.doc.defaultView.getComputedStyle(img);
    return { id, page, pages: p.totalPages, mode: p.mode, pageWidth: p.pageWidth, gap: p.gap,
      height: p.host.clientHeight, verticalPadding: p.verticalPadding,
      pagePad: Math.max(12, Math.round(p.pageWidth * p.marginPct / 100)),
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      screen: { x: frame.left + box.left, y: frame.top + box.top },
      display: style.display,
      naturalWidth: img.naturalWidth == null ? img.viewBox.baseVal.width || img.width.baseVal.value : img.naturalWidth,
      naturalHeight: img.naturalHeight == null ? img.viewBox.baseVal.height || img.height.baseVal.value : img.naturalHeight };
  }, id);
}

async function checkImage(id, label, ratio) {
  const m = await imageMetrics(id);
  report.measurements.push({ label, ...m });
  check(`${label}: image loaded`, m.naturalWidth > 0 && m.naturalHeight > 0);
  check(`${label}: nonzero visible size`, m.box.width > 5 && m.box.height > 5);
  close(m.box.width / m.box.height, ratio, `${label}: intrinsic aspect ratio`, .01);
  check(`${label}: top stays inside page padding`, m.box.top >= m.verticalPadding - 1);
  check(`${label}: full bottom stays inside page padding`, m.box.bottom <= m.height - m.verticalPadding + 1);
  // At the last spread, Chromium clamps scrolling and the final page can be
  // the right-hand column. Compare its bounds against that visible column.
  const visibleColumn = Math.floor((m.box.left + .5) / (m.pageWidth + m.gap));
  const columnLeft = visibleColumn * (m.pageWidth + m.gap);
  check(`${label}: image occupies a visible column`, visibleColumn >= 0 && visibleColumn < (m.mode === 'spread' ? 2 : 1));
  check(`${label}: left stays inside page margin`, m.box.left >= columnLeft + m.pagePad - 1);
  check(`${label}: right stays inside page margin`, m.box.right <= columnLeft + m.pageWidth - m.pagePad + 1);
  await settle();
  const pixel = await win.webContents.capturePage({
    x: Math.round(m.screen.x + m.box.width / 2),
    y: Math.floor(m.screen.y + m.box.height * .96), width: 1, height: 1,
  });
  const bgra = pixel.toBitmap();
  check(`${label}: green bottom stripe is actually painted`, bgra[1] > 140 && bgra[2] < 100 && bgra[0] < 160);
  return m;
}

async function screenshot(name) {
  if (!args.includes('--screenshots')) return;
  await settle();
  const target = path.join(output, name + '.png');
  fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
  report.screenshots.push(target);
}

async function staticLayout() {
  const html = `<section id="portrait-wrap" style="height:2400px;min-height:2400px;text-indent:4em;line-height:3;padding:11px 7px 13px;margin-top:9px;margin-bottom:15px">`
    + `<div id="inner-wrap" style="height:2300px;min-height:2300px;text-indent:3em"><p id="picture-paragraph" style="height:2200px;line-height:4"><a href="#picture"><img id="portrait" width="400" height="1800" src="${dataImage(portrait)}"></a></p></div></section>`
    + `<div id="landscape-wrap" style="break-before:column;padding:8px 13px"><img id="landscape" src="${dataImage(landscape)}"></div>`
    + `<p id="inline-paragraph" style="break-before:column">正文开头 <img id="inline" width="18" height="12" style="width:18px;height:12px;vertical-align:middle" src="${dataImage(small)}"> 正文结尾，行内小图保持原有尺寸。</p>`;
  await render(html);
  await checkImage('portrait', 'single tall artwork', 400 / 1800);
  await screenshot('single-tall');
  const initialWide = await checkImage('landscape', 'single wide artwork', 3);
  check('single layout has exactly three content pages', initialWide.pages === 3);
  const wrappers = await evaluate(() => {
    const p = window.reader;
    return ['portrait-wrap', 'inner-wrap', 'picture-paragraph'].map(id => {
      const element = p.doc.getElementById(id);
      const style = p.doc.defaultView.getComputedStyle(element);
      return { id, height: element.getBoundingClientRect().height, minHeight: parseFloat(style.minHeight) || 0,
        indent: parseFloat(style.textIndent), paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom),
        marginTop: parseFloat(style.marginTop), marginBottom: parseFloat(style.marginBottom) };
    });
  });
  report.measurements.push({ label: 'illustration containers', wrappers });
  for (const wrap of wrappers) {
    check(`${wrap.id}: fixed height and minimum height are cleared`, wrap.height < 800 && wrap.minHeight < 800);
    close(wrap.indent, 0, `${wrap.id}: paragraph indentation removed`);
  }
  close(wrappers[0].paddingTop, 11, 'authored top padding preserved');
  close(wrappers[0].paddingBottom, 13, 'authored bottom padding preserved');
  close(wrappers[0].marginTop, 9, 'authored top margin preserved');
  close(wrappers[0].marginBottom, 15, 'authored bottom margin preserved');

  await evaluate(() => window.reader.setMode('spread'));
  await settle();
  await checkImage('portrait', 'spread tall artwork', 400 / 1800);
  await screenshot('spread-tall');
  const spreadWide = await checkImage('landscape', 'spread wide artwork', 3);
  check('switching to spread recomputes width-limited artwork', spreadWide.box.width < initialWide.box.width);
  for (const [width, height] of [[860, 540], [1580, 960]]) {
    win.setContentSize(width, height);
    await settle();
    await checkImage('portrait', `spread ${width}×${height} tall artwork`, 400 / 1800);
    await checkImage('landscape', `spread ${width}×${height} wide artwork`, 3);
  }
  await evaluate(() => window.reader.setMode('single'));
  await settle();
  const wideBeforeMargin = await checkImage('landscape', 'single wide before margin', 3);
  await evaluate(() => window.reader.setMargin(16));
  await settle();
  const wideAfterMargin = await checkImage('landscape', 'single wide after margin', 3);
  check('larger page margins recompute the image width', wideAfterMargin.box.width < wideBeforeMargin.box.width);
  const tallBeforeFont = await checkImage('portrait', 'tall before font change', 400 / 1800);
  await evaluate(() => window.reader.setTypography({ fontSizePct: 180, lineHeight: 2.4 }));
  await settle();
  const tallAfterFont = await checkImage('portrait', 'tall after font change', 400 / 1800);
  check('font-sized paragraph spacing is included in available image height', tallAfterFont.box.height < tallBeforeFont.box.height);
  await evaluate(() => window.reader.setMode('spread'));
  await settle();
  const wideBeforeGap = await checkImage('landscape', 'spread before gap change', 3);
  await evaluate(() => window.reader.setGap(120));
  await settle();
  const wideAfterGap = await checkImage('landscape', 'spread after gap change', 3);
  check('larger spread gap recomputes the image width', wideAfterGap.box.width < wideBeforeGap.box.width);
  const inline = await imageMetrics('inline');
  close(inline.box.width, 18, 'inline image width is preserved');
  close(inline.box.height, 12, 'inline image height is preserved');
  check('inline image still participates in the text line', inline.display === 'inline' || inline.display === 'inline-block');
  await screenshot('spread-adjusted');
}

async function delayedImages() {
  win.setContentSize(1100, 760);
  await evaluate(() => {
    window.reader.setMode('single'); window.reader.setMargin(8); window.reader.setGap(32);
    window.reader.setTypography({ fontSizePct: 100, lineHeight: 1.8 });
  });
  await render('<div><img id="late-one" src="gaia-image-smoke://fixture/late-one"></div>'
    + paragraphs(0, 10) + '<div><img id="late-two" src="gaia-image-smoke://fixture/late-two"></div>'
    + '<div><img id="late-error" src="gaia-image-smoke://fixture/late-error"></div>' + paragraphs(10, 70));
  // Exceed the former waitImages 2500ms timeout after render has committed.
  await wait(2700);
  const before = await evaluate(() => {
    const p = window.reader;
    const target = p.doc.getElementById('paragraph-35').firstChild;
    const off = p._textOffsetOfNode(target, 0);
    p.showPage(p.locate(off));
    return { anchor: p.anchor(), pages: p.totalPages, page: p.currentPage, totalCount: window.totalCount,
      pending: Array.from(p.doc.images).every(img => !img.complete) };
  });
  check('all delayed requests remain pending after the former timeout', before.pending);
  check('text anchor exists before delayed loads', before.anchor && Number.isFinite(before.anchor.off));
  await release('late-one');
  await until(() => window.reader.doc.getElementById('late-one').naturalWidth > 0, 'First delayed image did not load');
  await settle();
  const first = await evaluate(anchor => ({ pages: window.reader.totalPages, page: window.reader.currentPage,
    totalCount: window.totalCount, anchorVisible: window.reader.anchorInView(anchor.off),
    secondPending: !window.reader.doc.getElementById('late-two').complete }), before.anchor);
  report.measurements.push({ label: 'first late image', before, after: first });
  check('first late image repaginates while the second is still pending', first.secondPending && first.totalCount > before.totalCount);
  check('first late image increases the measured page count', first.pages > before.pages);
  check('first late image preserves the visible text anchor', first.anchorVisible);
  await release('late-two');
  await until(() => window.reader.doc.getElementById('late-two').naturalWidth > 0, 'Second delayed image did not load');
  await settle();
  const second = await evaluate(anchor => ({ pages: window.reader.totalPages, totalCount: window.totalCount,
    anchorVisible: window.reader.anchorInView(anchor.off) }), before.anchor);
  report.measurements.push({ label: 'second late image', after: second });
  check('second late image independently repaginates', second.totalCount > first.totalCount && second.pages > first.pages);
  check('second late image preserves the visible text anchor', second.anchorVisible);
  await release('late-error', 'not an image');
  await until(() => window.reader.doc.getElementById('late-error').complete, 'Delayed image error did not settle');
  await settle();
  check('late image errors trigger layout and preserve the text anchor', await evaluate(({ count, off }) =>
    window.totalCount > count && window.reader.anchorInView(off), { count: second.totalCount, off: before.anchor.off }));

  await render('<div><img id="preceding" src="gaia-image-smoke://fixture/preceding"></div>'
    + `<div><img id="anchored-art" src="${dataImage(portrait)}"></div>`);
  await wait(2700);
  const artworkBefore = await imageMetrics('anchored-art');
  check('illustration-only page has no synthetic text anchor', await evaluate(() => window.reader.anchor() == null));
  await release('preceding');
  await until(() => window.reader.doc.getElementById('preceding').naturalWidth > 0, 'Preceding image did not load');
  await settle();
  const artworkAfter = await evaluate(() => {
    const p = window.reader;
    const rect = p.doc.getElementById('anchored-art').getBoundingClientRect();
    return { page: p.currentPage, pages: p.totalPages, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      visible: rect.left >= -1 && rect.right <= p.pageWidth + 1 && rect.top >= p.verticalPadding - 1
        && rect.bottom <= p.host.clientHeight - p.verticalPadding + 1 };
  });
  report.measurements.push({ label: 'late image before an illustration anchor', before: artworkBefore, after: artworkAfter });
  check('late preceding image moves the existing illustration to a later page', artworkAfter.page > artworkBefore.page);
  check('late image loading keeps the previously visible illustration in view', artworkAfter.visible);
  await screenshot('late-illustration-anchor');
}

async function illustrationEdges() {
  win.setContentSize(1100, 760);
  await evaluate(() => {
    window.reader.setMode('single'); window.reader.setMargin(8); window.reader.setGap(32);
    window.reader.setTypography({ fontSizePct: 100, lineHeight: 1.8 });
  });
  const noViewBox = svg(600, 1200).replace(' viewBox="0 0 600 1200"', '').replace('<svg ', '<svg id="svg-without-viewbox" ');
  await render(`<div>${noViewBox}</div>`);
  await checkImage('svg-without-viewbox', 'inline SVG without authored viewBox', .5);
  await screenshot('inline-svg');
  win.setContentSize(860, 540);
  await settle();
  await checkImage('svg-without-viewbox', 'resized SVG without authored viewBox', .5);

  await render('<section id="multi-art" style="height:100%;overflow:hidden">'
    + Array.from({ length: 3 }, (_, i) => `<p><img id="multi-${i}" src="${dataImage(portrait)}"></p>`).join('')
    + '</section>');
  for (const mode of ['single', 'spread']) {
    await evaluate(mode => window.reader.setMode(mode), mode);
    await settle();
    for (let i = 0; i < 3; i++) await checkImage(`multi-${i}`, `${mode} shared fixed-height container artwork ${i + 1}`, 400 / 1800);
  }
  await screenshot('shared-illustration-container');

  await render(`<div id="hidden-parent" style="display:none"><img id="hidden-child" src="${dataImage(portrait)}"></div>`
    + `<p><img id="hidden-image" style="display:none" src="${dataImage(portrait)}"></p><p>可见的正文。</p>`);
  check('authored display:none images and their ancestors remain hidden', await evaluate(() => {
    const p = window.reader;
    return ['hidden-parent', 'hidden-child', 'hidden-image'].every(id => p.doc.getElementById(id).getClientRects().length === 0);
  }));
}

async function importedStylesheets() {
  const { inlineChapterResources } = require('../src/shared/mobi');
  const resources = path.join(sandbox, 'book-resources');
  const styles = path.join(resources, 'styles');
  fs.mkdirSync(styles, { recursive: true });
  const imageName = '背景 #插图.jpeg';
  fs.writeFileSync(path.join(resources, imageName), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#18b875"/></svg>');
  fs.writeFileSync(path.join(styles, 'first.css'), '.import-box {width:180px;height:90px;padding:0;margin:0;background-color:rgb(220,0,0);font-size:17px;font-family:monospace}');
  fs.writeFileSync(path.join(styles, 'string.css'), '#import-string {background-image:url("../' + encodeURIComponent(imageName) + '");color:rgb(1,35,69);font-size:23px}');
  fs.writeFileSync(path.join(styles, 'url.css'), '#import-url {background-image:url("../' + encodeURIComponent(imageName) + '");color:rgb(82,40,112);font-size:27px}');
  fs.writeFileSync(path.join(styles, 'print.css'), '.import-box {background-image:none;color:rgb(0,0,0);font-size:99px}');
  fs.writeFileSync(path.join(styles, 'screen.css'), '@import "string.css"; @import url("url.css") screen; @import "print.css" print;'
    + ' .import-box {background-size:100% 100%;background-repeat:no-repeat}');
  const inlined = inlineChapterResources('<link rel="stylesheet" media="screen" href="styles/screen.css">'
    + '<div class="import-box" id="import-string">字符串导入</div><div class="import-box" id="import-url">URL 导入</div>',
  resources, [{ href: pathToFileURL(path.join(styles, 'first.css')).href }]);
  await evaluate(() => { window.reader.setMode('single'); window.reader.setTypography({ fontSizePct: 100 }); });
  await render(inlined.html, false, inlined.cssText);
  const result = await evaluate(async () => {
    const p = window.reader;
    const frame = p.frame.getBoundingClientRect();
    return Promise.all(['import-string', 'import-url'].map(async id => {
      const element = p.doc.getElementById(id);
      const style = p.doc.defaultView.getComputedStyle(element);
      const source = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
      if (source) { const img = new Image(); img.src = source[1]; await img.decode(); }
      const rect = element.getBoundingClientRect();
      return { id, background: style.backgroundImage, color: style.color, fontSize: parseFloat(style.fontSize),
        fontFamily: style.fontFamily, width: rect.width, height: rect.height,
        pixel: { x: frame.left + rect.left + rect.width * .8, y: frame.top + rect.top + rect.height * .8 } };
    }));
  });
  report.measurements.push({ label: 'MOBI imported stylesheets in Chromium', cssLength: inlined.cssText.length, result });
  await settle();
  for (const [index, m] of result.entries()) {
    check(`${m.id}: imported background is an inlined image with its real SVG MIME`, m.background.includes('data:image/svg+xml;base64,'));
    close(m.fontSize, index === 0 ? 23 : 27, `${m.id}: imported font size is applied`);
    check(`${m.id}: imported color applies and print-only CSS stays inactive`, m.color === (index === 0 ? 'rgb(1, 35, 69)' : 'rgb(82, 40, 112)'));
    close(m.width, 180, `${m.id}: earlier ordinary stylesheet remains active`);
    const pixel = await win.webContents.capturePage({ x: Math.round(m.pixel.x), y: Math.round(m.pixel.y), width: 1, height: 1 });
    const bgra = pixel.toBitmap();
    check(`${m.id}: imported green background is actually painted`, bgra[1] > 140 && bgra[2] < 100 && bgra[0] < 160);
  }
  await screenshot('imported-backgrounds');
}

async function lifecycle() {
  await render('<div><img id="cancel-retained" src="gaia-image-smoke://fixture/cancel-retained"></div>' + paragraphs(0, 8), true);
  const cancelled = await evaluate(() => {
    const doc = window.reader.doc;
    const totalCount = window.totalCount;
    window.reader.cancelPendingRender();
    return { totalCount, sameDocument: window.reader.doc === doc, listeners: window.listenerTrackers.at(-1).count() };
  });
  check('cancelling an uncommitted chapter retains active chapter image listeners', cancelled.sameDocument && cancelled.listeners >= 2);
  await release('cancel-retained');
  await until(() => window.reader.doc.getElementById('cancel-retained').naturalWidth > 0, 'Retained chapter image did not load');
  await settle();
  check('late image still repaginates the active chapter after cancelling a render', await evaluate(count => window.totalCount > count, cancelled.totalCount));

  await render('<div><img id="abandoned" src="gaia-image-smoke://fixture/abandoned"></div>' + paragraphs(0, 5), true);
  check('chapter with pending image has load/error listeners', await evaluate(() => window.listenerTrackers.at(-1).count() >= 2));
  await evaluate(() => { window.abandonedImage = window.reader.doc.getElementById('abandoned'); });
  await render('<p>新章节已显示，旧章节图片不能触发它的重排。</p>');
  check('changing chapters removes old image load/error listeners', await evaluate(() => window.listenerTrackers.at(-1).count() === 0));
  check('old chapter events cannot repaginate the new chapter', await evaluate(async () => {
    const before = window.totalCount;
    window.abandonedImage.dispatchEvent(new Event('load'));
    window.abandonedImage.dispatchEvent(new Event('error'));
    await new Promise(resolve => setTimeout(resolve, 100));
    return window.totalCount === before;
  }));
  await render('<div><img id="closing" src="gaia-image-smoke://fixture/closing"></div>', true);
  check('closing fixture has pending image listeners', await evaluate(() => window.listenerTrackers.at(-1).count() >= 2));
  check('destroy removes pending listeners and iframe', await evaluate(() => {
    window.reader.destroy();
    return window.listenerTrackers.at(-1).count() === 0 && !window.reader.frame && !window.reader.doc
      && !document.getElementById('reader').querySelector('iframe');
  }));
}

async function run() {
  protocol.handle('gaia-image-smoke', request => new Promise(resolve => {
    const name = new URL(request.url).pathname.slice(1);
    requests.set(name, resolve);
  }));
  const fixture = path.join(sandbox, 'reader.html');
  const scriptUrl = file => pathToFileURL(path.join(project, file)).href;
  fs.writeFileSync(fixture, '<!doctype html><html><head><meta charset="utf-8"><title>Paginator image checks</title>'
    + '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fffdf7}'
    + '#reader{position:relative;width:100%;height:100%;display:flex;justify-content:center;overflow:hidden}'
    + '.paginator-frame{display:block;flex:none;border:0;background:#fffdf7}'
    + '.paginator-pending{position:absolute;visibility:hidden;pointer-events:none}</style></head><body>'
    + `<div id="reader"></div><script src="${scriptUrl('src/shared/reader-contrast.js')}"></script>`
    + `<script src="${scriptUrl('src/shared/epub-typography.js')}"></script>`
    + `<script src="${scriptUrl('src/shared/chinese-display-data.js')}"></script>`
    + `<script src="${scriptUrl('src/shared/chinese-display.js')}"></script>`
    + `<script src="${scriptUrl('src/shared/page-text-range.js')}"></script>`
    + `<script src="${scriptUrl('src/renderer/paginator.js')}"></script></body></html>`);
  win = new BrowserWindow({ show: false, width: 1180, height: 800, useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3 && !message.startsWith('Failed to load resource:')) report.rendererErrors.push(message);
  });
  await win.loadFile(fixture);
  win.setContentSize(1180, 800);
  await evaluate(() => {
    window.listenerTrackers = [];
    window.reader = new window.GaiaPaginator(document.getElementById('reader'), { pageWidth: 640, gap: 32 });
    window.addEventListener('error', event => { if (event.error) console.error('PAGINATOR_EXCEPTION: ' + event.error.stack); });
    window.addEventListener('unhandledrejection', event => console.error('PAGINATOR_REJECTION: ' + event.reason));
  });
  await staticLayout();
  await illustrationEdges();
  await importedStylesheets();
  await delayedImages();
  await lifecycle();
  check('no renderer exceptions', report.rendererErrors.length === 0);
}

app.whenReady().then(run).then(() => finish(), finish);
