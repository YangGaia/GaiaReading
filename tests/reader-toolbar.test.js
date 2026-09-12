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
  const ids = ['btn-back', 'btn-ai-reader', 'btn-book-search', 'btn-settings-reader', 'btn-alice-summary', 'btn-alice-comment', 'btn-pdf-zoom-out', 'btn-pdf-zoom-reset', 'btn-pdf-zoom-in', 'btn-pdf-pairing', 'btn-reader-toc', 'btn-prev-page', 'btn-next-page'];
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
