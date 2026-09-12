'use strict';

const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

module.exports = async function makeFontFixture(directory, fixed = false) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, 'sample.epub')));
  let opf = await zip.file('OEBPS/content.opf').async('string');
  opf = opf.replace('</manifest>', '<item id="font-css" href="font.css" media-type="text/css"/></manifest>');
  if (fixed) opf = opf.replace('</metadata>', '<meta property="rendition:layout">pre-paginated</meta></metadata>');
  zip.file('OEBPS/content.opf', opf);
  zip.file('OEBPS/font.css', `
    html { font-size: 16px; } body { font-size: 16px !important; }
    .fixed { font-size: 16px; } .points { font-size: 12pt; }
    .root-relative { font-size: 1rem; } .relative { font-size: 1em; }
    .percent { font-size: 100%; } .important { font-size: 16px !important; }
    .nested { font-size: 20px; } .nested > span { font-size: .8em; }
    .nested > span > em { font-size: .5em; }
    h1 { font-size: 28px; } small { font-size: 12px; }
    .shorthand { font: 16px/20px serif; }
    .second { font-size: 18px; }
    @media (max-width: 700px) { .responsive { font-size: 14px; } }
    @media (min-width: 701px) { .responsive { font-size: 16px; } }
  `);
  const head = '<head><meta name="viewport" content="width=600,height=800"/><title>字号兼容验证</title><link rel="stylesheet" href="font.css"/></head>';
  const text = '月光照在书页上，有珠合上手中的书。字号可以改变，故事的文字和阅读位置应当保持。';
  const probes = `<h1 id="heading">字号兼容验证</h1>
    <p id="inherited">继承字号：${text}</p>
    <p id="fixed" class="fixed">固定像素：${text}</p>
    <p id="points" class="points">印刷字号：${text}</p>
    <p id="root-relative" class="root-relative">根元素字号：${text}</p>
    <p id="relative" class="relative">相对字号：${text}</p>
    <p id="percent" class="percent">百分比字号：${text}</p>
    <p id="important" class="important">优先样式：${text}</p>
    <p><span id="inline" style="font-size:16px!important">内联样式：${text}</span></p>
    <div class="nested"><span id="nested">嵌套相对字号 <em id="nested-small">小字</em></span></div>
    <div id="shorthand" class="shorthand">固定行高：${text}</div>
    <p id="inline-shorthand" style="font:bold 16px/24px serif!important">内联字体简写</p>
    <p id="variable" style="--book-font:italic 16px/22px serif;font:var(--book-font)!important">变量字体简写</p>
    <p id="responsive" class="responsive">随窗口变化的书籍样式</p>
    <small id="footnote">脚注文字保留与正文的比例。</small>
    <svg id="art" xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#d4dce3"/><text id="art-text" x="5" y="25">插图</text></svg>`;
  const paragraphs = Array.from({ length: 90 }, (_, i) => `<p id="paragraph-${i}" class="fixed">第 ${i + 1} 段 ${i === 40 ? '唯一定位词' : ''}${text.repeat(4)}</p>`).join('');
  zip.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml">' + head + '<body>' + probes + (fixed ? '' : paragraphs) + '</body></html>');
  zip.file('OEBPS/c2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml">' + head + '<body><h1>第二章</h1><p id="second" class="second">新的章节也需要沿用字号。</p>' + (fixed ? '' : paragraphs) + '</body></html>');
  const file = path.join(directory, fixed ? 'font-fixed-layout.epub' : 'font-compatibility.epub');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return { path: file, title: fixed ? '固定版式验证' : 'EPUB 字号兼容验证', format: 'epub' };
};
