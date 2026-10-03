'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const chinese = require('../src/shared/chinese-script');
const search = require('../src/shared/book-search');

test('首次识别简繁，只有手动习惯覆盖书籍原文，混排和中性文本有稳定结果', () => {
  assert.equal(chinese.chooseMode(null, '头发发展，阅读书籍，后台设置'), 'simplified');
  assert.equal(chinese.chooseMode(null, '頭髮發展，閱讀書籍，後臺設置'), 'traditional');
  assert.equal(chinese.chooseMode('traditional', '简体书籍'), 'traditional');
  assert.equal(chinese.chooseMode('simplified', '繁體書籍'), 'simplified');
  assert.equal(chinese.chooseMode('invalid', 'hello 123 山水'), 'simplified');
  assert.equal(chinese.detect('阅读 閱讀書籍圖書館'), 'traditional');
  assert.equal(chinese.detect('皇后看書'), 'traditional');
  assert.equal(chinese.detect('乾坤和皇后看书'), 'simplified');
});

test('字词转换区分头发和发展，并且始终从原文转换保留异体字', () => {
  const original = '頭髮發展，乾淨乾燥，皇后和後臺，裏面。';
  assert.equal(chinese.convert(original, 'simplified'), '头发发展，干净干燥，皇后和后台，里面。');
  assert.equal(chinese.convert('头发发展，干净干燥，皇后和后台，里面。', 'traditional'), original);
  assert.equal(chinese.convert(original, null), original);
  assert.equal(chinese.label('traditional'), '繁体');
  assert.equal(chinese.label('simplified'), '简体');
});

test('转换位置映射覆盖生僻字、代理对和短语，锚点可以双向恢复', () => {
  for (const mode of ['simplified', 'traditional', null]) {
    const source = '😀周𫖮的頭髮发展，二噁英和𣗊溪。';
    const mapped = chinese.convertWithMap(source, mode);
    assert.equal(mapped.text, chinese.convert(source, mode));
    let offset = 0;
    for (const character of source) {
      assert.equal(mapped.targetToSource[mapped.sourceToTarget[offset]], offset);
      offset += character.length;
    }
    assert.equal(mapped.sourceToTarget[source.length], mapped.text.length);
    assert.equal(mapped.targetToSource[mapped.text.length], source.length);
  }
});

test('简繁搜索返回原文坐标，支持反向搜索、生僻字和重复命中', () => {
  for (const [source, query, expected] of [
    ['她的頭髮很長，頭髮烏黑。', '头发', ['頭髮', '頭髮']],
    ['头发与发展', '頭髮', ['头发']],
    ['😀周𫖮讀書', '周顗读书', ['周𫖮讀書']],
    ['A 😀 B', '😀', ['😀']],
  ]) {
    const found = search.findInText(source, query);
    assert.deepEqual(found.map(match => source.slice(match.start, match.end)), expected);
  }
});
