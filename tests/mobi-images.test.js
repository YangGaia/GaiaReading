'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { openMobi, loadChapter, cleanupMobi } = require('../src/shared/mobi');
const { inlineChapterResources, toDataUrl, fixKf8ResourceIds } = require('../src/shared/mobi-resources');
const { picture, makeMobi7, makeKf8 } = require('./fixtures/mobi-image-fixture');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-image-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('真实 KF8 容器：32 进制 embed/flow、嵌套 SVG/CSS 和缓存均取正确资源', async t => {
  const dir = temporary(t);
  const fixture = makeKf8(dir);
  const resources = path.join(dir, 'resources');
  const opened = await openMobi(fixture.path, resources);
  try {
    assert.equal(opened.kind, 'kf8');
    assert.equal(opened.chapters.length, 4);
    const first = await loadChapter(opened, 0, resources);
    assert.match(first.html, /src="data:image\/svg\+xml;base64,/);
    assert.ok(!first.html.includes('application/octet-stream'));
    const svg = Buffer.from(first.html.match(/base64,([^"]+)/)[1], 'base64').toString();
    assert.match(svg, /height="2400"/);
    assert.match(svg, /BOTTOM/);
    assert.match(first.cssText, /fixed-wrapper/); // flow 000A = 10
    assert.match(first.cssText, /rgb\(40, 50, 60\)/); // flow 0010 = 32
    assert.match(first.cssText, /url\(data:image\/svg\+xml;base64,/);
    assert.ok(!first.cssText.includes('kindle:'));
    assert.deepEqual(await loadChapter(opened, 0, resources), first);
    fixKf8ResourceIds(opened.book); // idempotent
    const fourth = await loadChapter(opened, 3, resources);
    const nested = Buffer.from(fourth.html.match(/base64,([^"]+)/)[1], 'base64').toString();
    assert.match(nested, /xlink:href="data:image\/svg\+xml;base64,/);
    assert.ok(!nested.includes('kindle:'));
  } finally { cleanupMobi(opened); }
});

test('真实 MOBI7 容器：recindex 仍按十进制读取，小图没有取到其他记录', async t => {
  const dir = temporary(t);
  const fixture = makeMobi7(dir);
  const opened = await openMobi(fixture.path, path.join(dir, 'resources'));
  try {
    assert.equal(opened.kind, 'mobi7');
    const chapter = await loadChapter(opened, 1, path.join(dir, 'resources'));
    const svg = Buffer.from(chapter.html.match(/base64,([^"]+)/)[1], 'base64').toString();
    assert.match(svg, /width="80" height="40"/);
  } finally { cleanupMobi(opened); }
});

test('本地 file URL、编码文件名、SVG image 与独立样式表图片均内联', t => {
  const dir = temporary(t);
  const file = path.join(dir, '长 图.svg');
  fs.writeFileSync(file, picture(360, 2400));
  fs.mkdirSync(path.join(dir, 'css'));
  fs.writeFileSync(path.join(dir, 'css', 'book.css'), '.a { background: url("../' + encodeURIComponent('长 图.svg') + '"); }');
  const html = '<link href="css/book.css" rel="stylesheet"><img src="' + pathToFileURL(file).href + '"><svg><image xlink:href="' + encodeURIComponent('长 图.svg') + '"/><use href="#shape"/></svg>';
  const inlined = inlineChapterResources(html, dir, [{ href: path.join(dir, 'css/book.css') }]);
  assert.equal((inlined.html.match(/data:image\/svg\+xml/g) || []).length, 2);
  assert.match(inlined.html, /href="#shape"/);
  assert.ok(!inlined.html.includes('<link'));
  assert.equal((inlined.cssText.match(/background/g) || []).length, 1);
  assert.match(inlined.cssText, /data:image\/svg\+xml/);
  const symbol = inlineChapterResources('<svg><use href="' + pathToFileURL(file).href + '#shape"/></svg>', dir);
  assert.match(symbol.html, /href="data:image\/svg\+xml;base64,[^"]+#shape"/);
  const background = inlineChapterResources('<div style="background-image:url(\'' + pathToFileURL(file).href + '\')"></div>', dir);
  assert.match(background.html, /^<div style="background-image:url\(data:image\/svg\+xml;base64,[^"']+\)"><\/div>$/);
});

test('MIME 依据真实数据识别 SVG/BMP/WebP，不把 RIFF 音频或索引伪装成图片', t => {
  const dir = temporary(t);
  for (const [name, bytes, expected] of [
    ['wrong.jpg', Buffer.from('RIFF0000WAVE'), 'application/octet-stream'],
    ['wrong.png', Buffer.from('RESC'), 'application/octet-stream'],
    ['image.bin', Buffer.from('RIFF0000WEBP'), 'image/webp'],
    ['bitmap.bin', Buffer.from('BM000000'), 'image/bmp'],
    ['vector.bin', Buffer.concat([Buffer.from('<?xml version="1.0"?>\n'), picture(20, 20)]), 'image/svg+xml'],
  ]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    assert.ok(toDataUrl(file).startsWith('data:' + expected + ';base64,'), name);
  }
});

test('已内联、远端、片段及缺失资源保持原引用，递归 SVG 不会无限循环', t => {
  const dir = temporary(t);
  const html = '<img src="data:image/png;base64,abc"><img src="https://example.test/x"><img src="missing.jpg"><svg><use href="#icon"/></svg>';
  assert.equal(inlineChapterResources(html, dir).html, html);
  fs.writeFileSync(path.join(dir, 'loop.svg'), '<svg><image href="loop.svg"/></svg>');
  assert.ok(toDataUrl(path.join(dir, 'loop.svg')).startsWith('data:image/svg+xml;'));
});
