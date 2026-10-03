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
  const ids = ['btn-back', 'btn-ai-reader', 'btn-book-search', 'btn-settings-reader', 'btn-alice-comment', 'btn-pdf-zoom-out', 'btn-pdf-zoom-reset', 'btn-pdf-zoom-in', 'btn-pdf-pairing', 'btn-reader-toc', 'btn-prev-page', 'btn-next-page'];
  for (const id of ids) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, id);
    assert.match(tag, /type="button"/, id);
    assert.match(tag, /(?:aria-label|title)="[^"]+"/, id);
  }
  const topbar = html.slice(html.indexOf('<header class="topbar reader-topbar">'), html.indexOf('<div id="reader-body">'));
  assert.doesNotMatch(topbar, /btn-alice-summary|总结/);
  assert.match(topbar, /id="btn-alice-comment"[\s\S]*?<span class="alice-action-text">有珠吐槽<\/span>/);
  assert.match(topbar, /id="btn-ai-reader"[\s\S]*?<span class="reader-label-compact">AI对话<\/span>/);
  for (const icon of topbar.matchAll(/<svg[^>]*>/g)) assert.match(icon[0], /aria-hidden="true"/);
});

test('选中文字保留解读、划线与两个不同搜索入口，移除重复操作', () => {
  const html = read('index.html');
  const toolbar = html.slice(html.indexOf('id="selection-toolbar"'), html.indexOf('id="note-editor-overlay"'));
  const actions = [...toolbar.matchAll(/data-selection-action="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(actions, ['ai-analyze', 'dictionary', 'web-search', 'book-search', 'copy', 'delete']);
  assert.equal((toolbar.match(/data-highlight-color=/g) || []).length, 3);
  assert.match(toolbar, /data-selection-action="web-search"[^>]*>联网搜索/);
  assert.match(toolbar, /data-selection-action="book-search"[^>]*>全文搜索/);
  const app = read('app.js');
  assert.match(app, /selectionAction === 'web-search'[\s\S]*?searchSelectionOnWeb\(selectionContext\)/);
  assert.match(app, /selectionAction === 'book-search'[\s\S]*?openBookSearch/);
});

test('书签和笔记共用入口并用页内标签切换，正文右键与桌宠控件分开处理', () => {
  const html = read('index.html'), app = read('app.js');
  assert.match(html, /id="btn-bookmarks"[^>]*>书签和笔记/);
  assert.doesNotMatch(html, /id="(?:btn-annotations|btn-add-bookmark|btn-book-search-drawer|btn-toc|btn-ai-assistant)"/);
  const tools = html.match(/class="drawer-tools">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(tools, '阅读工具区域应保留');
  assert.deepEqual([...tools.matchAll(/<button id="([^"]+)"/g)].map(match => match[1]), ['btn-bookmarks', 'btn-reading-stats-reader', 'btn-simplified']);
  assert.match(read('settings.css'), /#settings-drawer \.drawer-tools\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(html, /在阅读正文任意位置右键[\s\S]*?右键有珠打开控制台/);
  assert.match(app, /function appendCollectionHeader\(/);
  assert.match(app, /\['bookmarks', '书签'\]/);
  assert.match(app, /\['annotations', '笔记'\]/);
  assert.match(app, /sourceDoc\.addEventListener\('contextmenu'/);
  assert.match(app, /target\.closest\([^\n]*#gaia-pet[^\n]*#gaia-pet-console[^\n]*#bgm-capsule/);
});
