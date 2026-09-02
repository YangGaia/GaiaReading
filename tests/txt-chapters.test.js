'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { splitTxtParagraphs, detectTxtChapters, chapterAt, chapterTitleForParagraph, paragraphCharOffset, paragraphForCharOffset } = require('../src/shared/txt-chapters');
const { paragraphsToHtml } = require('../src/shared/txt-html');

function escapeForTest(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

test('splitTxtParagraphs 与 paragraphsToHtml 分段一致', () => {
  const cases = [
    '第一行\n第二行\n第三行',
    '第一段第一行\n第一段第二行\n\n第二段',
    '甲 & 乙 <x>\n丙 "引号"',
    '',
    '  \n\n  ',
    '甲\r\n乙\r\n\r\n丙',
  ];
  for (const text of cases) {
    const paras = splitTxtParagraphs(text);
    const html = paras.map((p) => '<p>' + p.split('\n').map(escapeForTest).join('<br>') + '</p>').join('');
    assert.strictEqual(html, paragraphsToHtml(text), '分段不一致: ' + JSON.stringify(text));
  }
});

test('detectTxtChapters 识别常见章节标题', () => {
  const paras = ['第一章 风起', '正文第一段', '第二章 云涌', '更多内容', '第 12 回 转折', '继续', 'Chapter 3', '后面', '序章', '楔子', '正文 第四章 重逢', '1、雨夜', 'Part IV', '结尾'];
  const chapters = detectTxtChapters(paras);
  assert.deepStrictEqual(chapters, [
    { title: '第一章 风起', paraIndex: 0 },
    { title: '第二章 云涌', paraIndex: 2 },
    { title: '第 12 回 转折', paraIndex: 4 },
    { title: 'Chapter 3', paraIndex: 6 },
    { title: '序章', paraIndex: 8 },
    { title: '楔子', paraIndex: 9 },
    { title: '正文 第四章 重逢', paraIndex: 10 },
    { title: '1、雨夜', paraIndex: 11 },
    { title: 'Part IV', paraIndex: 12 },
  ]);
});

test('detectTxtChapters 不误判长段落与普通句子', () => {
  const paras = ['第一章 风起云涌的漫长开篇' + '字'.repeat(40), '这是一个普通的句子，第一章并不是标题', '他说道：第二十三章开始了'];
  assert.deepStrictEqual(detectTxtChapters(paras), []);
});

test('chapterTitleForParagraph 命中章节区间', () => {
  const chapters = [{ title: '第一章', paraIndex: 0 }, { title: '第三章', paraIndex: 5 }];
  assert.strictEqual(chapterTitleForParagraph(chapters, 0), '第一章');
  assert.strictEqual(chapterTitleForParagraph(chapters, 3), '第一章');
  assert.strictEqual(chapterTitleForParagraph(chapters, 5), '第三章');
  assert.strictEqual(chapterTitleForParagraph(chapters, 100), '第三章');
  assert.strictEqual(chapterTitleForParagraph([], 0), null);
  assert.strictEqual(chapterAt([], 0), -1);
});

test('段落偏移换算往返一致', () => {
  const paras = ['abcd', 'ef', 'ghijkl'];
  const off = paragraphCharOffset(paras, 2, 3);
  assert.strictEqual(off, 9);
  assert.deepStrictEqual(paragraphForCharOffset(paras, off), { paraIndex: 2, charInPara: 3 });
  assert.deepStrictEqual(paragraphForCharOffset(paras, 0), { paraIndex: 0, charInPara: 0 });
  assert.deepStrictEqual(paragraphForCharOffset(paras, 4), { paraIndex: 0, charInPara: 4 });
  assert.deepStrictEqual(paragraphForCharOffset(paras, 999), { paraIndex: 2, charInPara: 6 });
  assert.deepStrictEqual(paragraphForCharOffset([], 3), { paraIndex: 0, charInPara: 0 });
});
