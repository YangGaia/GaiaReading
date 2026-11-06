'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src/renderer', name), 'utf8');

test('阅读栏样式的所有选择器都限定在上下栏，不覆盖正文或其他页面', () => {
  const css = read('reader-chrome.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim()).filter(rule => !rule.startsWith('@'));
  assert.ok(rules.length > 0);
  for (const rule of rules) for (const selector of rule.split(/,(?![^()]*\))/)) {
    assert.match(selector.trim(), /^#reader-view(?:\.settings-open)? > (?:\.reader-topbar|\.statusbar|:is\(\.reader-topbar, \.statusbar\))(?=$|[\s.#:])/, selector);
    assert.doesNotMatch(selector, /[+~]\s*#(?:reader-body|reader-content)/);
  }
  assert.doesNotMatch(css, /@import|url\(|deerflow|design-credit/i);
  const html = read('index.html');
  assert.ok(html.indexOf('href="reader-chrome.css"') > html.indexOf('href="music.css"'));
});

test('阅读栏紧凑布局中的图标按钮保留可访问名称与原有操作 ID', () => {
  const html = read('index.html');
  const ids = ['btn-back', 'btn-ai-reader', 'btn-book-search', 'btn-settings-reader', 'btn-reader-fullscreen', 'btn-alice-summary', 'btn-alice-comment', 'btn-pdf-zoom-out', 'btn-pdf-zoom-reset', 'btn-pdf-zoom-in', 'btn-pdf-pairing', 'btn-reader-toc', 'btn-prev-page', 'btn-next-page'];
  for (const id of ids) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, id);
    assert.match(tag, /type="button"/, id);
    assert.match(tag, /(?:aria-label|title)="[^"]+"/, id);
  }
  const topbar = html.slice(html.indexOf('<header class="topbar reader-topbar">'), html.indexOf('<div id="reader-body">'));
  for (const icon of topbar.matchAll(/<svg[^>]*>/g)) assert.match(icon[0], /aria-hidden="true"/);
});

test('阅读全屏提供 F11/Esc 控制、工具栏自动收放和锚点重排', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  assert.match(html, /id="btn-reader-fullscreen"[^>]*aria-pressed="false"/);
  assert.match(css, /#reader-view\.reader-fullscreen > \.reader-topbar \{ top: 0; opacity: 0;/);
  assert.match(css, /#reader-view\.reader-fullscreen > \.statusbar \{ bottom: 0; opacity: 0;/);
  assert.match(css, /#reader-view\.reader-fullscreen\.top-chrome-visible > \.reader-topbar/);
  assert.match(css, /#reader-view\.reader-fullscreen\.bottom-chrome-visible > \.statusbar/);
  assert.ok(app.includes("ev.key === 'F11'"), 'F11 应切换阅读全屏');
  assert.ok(app.includes("if (readerFullscreen) { ev.preventDefault(); ev.stopPropagation(); void setReaderFullscreen(false); return; }"), '全屏时 Esc 应先退出，而不是返回书架');
  assert.ok(app.includes('scheduleReaderLayoutRefresh(anchor, { force: true })'), '全屏切换后应按原阅读锚点重排');
  assert.ok(preload.includes("ipcRenderer.invoke('window:fullscreen:set'"));
  assert.ok(preload.includes("ipcRenderer.on('window:fullscreen-changed'"));
  assert.ok(main.includes("ipcMain.handle('window:fullscreen:set'"));
  assert.ok(main.includes("win !== mainWindow"), '全屏 IPC 只能控制应用主窗口');
});

test('EPUB 使用应用管理的像素尺寸，避免 epub.js 与应用并发监听窗口 resize', () => {
  const app = read('app.js');
  const openEpub = app.slice(app.indexOf('async function openEpub('), app.indexOf('function resizeEpubRendition('));
  assert.match(openEpub, /const readerBounds = els\.readerContent\.getBoundingClientRect\(\)/);
  assert.match(openEpub, /width:\s*Math\.max\(1, Math\.floor\(readerBounds\.width\)\)/);
  assert.match(openEpub, /height:\s*Math\.max\(1, Math\.floor\(readerBounds\.height\)\)/);
  assert.doesNotMatch(openEpub, /width:\s*['"]100%['"]|height:\s*['"]100%['"]/);
});
