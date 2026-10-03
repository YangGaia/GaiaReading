'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { detectKind, openMobi, loadChapter, cleanupMobi, planChapterMerge, chapterContentWeight, parseKindlePosition, resolveMobiHref, inlineChapterResources, readMobiMetadata } = require('../src/shared/mobi');
const { createMobi7Fixture } = require('./fixtures/mobi7-book-fixture');
const { createKf8Fixture } = require('./fixtures/kf8-book-fixture');

const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');

function temporaryResources(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'gaia-mobi-resources-'));
  t.after(() => {
    assert.strictEqual(path.dirname(fs.realpathSync(directory)), temporaryRoot);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function openedParser(book) {
  return { book, spine: [{ id: '0' }], mergedKept: [0], mergePred: [null] };
}

function decodeDataUrl(url) {
  return Buffer.from(url.slice(url.indexOf(',') + 1).split('#')[0], 'base64');
}

/** 用最小无压缩 PalmDB 初始化真实解析器，再为各测试提供章节/资源表。 */
async function resourceParser(kind, directory) {
  const parser = await import('@lingo-reader/mobi-parser');
  const header = Buffer.alloc(280);
  header.writeUInt16BE(1, 0);
  header.writeUInt16BE(1, 8);
  header.write('MOBI', 16);
  header.writeUInt32BE(248, 20);
  header.writeUInt32BE(65001, 28);
  header.writeUInt32BE(kind === 'kf8' ? 8 : 6, 36);
  header.writeUInt32BE(0x40, 128);
  header.writeUInt32BE(0xffffffff, 244);
  header.write('EXTH', 264);
  header.writeUInt32BE(12, 268);
  const text = Buffer.from('<html><head></head><body></body></html>');
  const records = [header, text];
  if (kind === 'kf8') {
    const flow = Buffer.alloc(20);
    flow.write('FDST');
    flow.writeUInt32BE(1, 8);
    flow.writeUInt32BE(text.length, 16);
    const index = Buffer.alloc(68);
    index.write('INDX');
    index.writeUInt32BE(56, 4);
    index.writeUInt32BE(65001, 28);
    index.write('TAGX', 56);
    index.writeUInt32BE(12, 60);
    header.writeUInt32BE(2, 192);
    header.writeUInt32BE(3, 248);
    header.writeUInt32BE(3, 252);
    records.push(flow, index);
  }
  const pdb = Buffer.alloc(78 + records.length * 8);
  pdb.write('BOOKMOBI', 60);
  pdb.writeUInt16BE(records.length, 76);
  let offset = pdb.length;
  records.forEach((record, index) => { pdb.writeUInt32BE(offset, 78 + index * 8); offset += record.length; });
  return parser[kind === 'kf8' ? 'initKf8File' : 'initMobiFile'](Buffer.concat([pdb, ...records]), directory);
}

function sampleBooks(t) {
  const root = temporaryResources(t);
  return [createMobi7Fixture(path.join(root, 'mobi7')), createKf8Fixture(path.join(root, 'kf8'))];
}

test('生成的完整 MOBI7/AZW3 样书可重复生成并准确识别格式', (t) => {
  for (const sample of sampleBooks(t)) {
    const buffer = fs.readFileSync(sample.path);
    assert.strictEqual(detectKind(buffer), sample.expected.kind);
    assert.strictEqual(buffer.toString('ascii', 60, 68), 'BOOKMOBI');
    const copyDirectory = path.join(path.dirname(sample.path), 'repeat');
    const copy = (sample.format === 'mobi' ? createMobi7Fixture : createKf8Fixture)(copyDirectory);
    assert.deepStrictEqual(fs.readFileSync(copy.path), buffer, '样书不能依赖时间、随机数或本机路径');
    const firstRecord = buffer.readUInt32BE(78);
    assert.ok(buffer.readUInt16BE(firstRecord + 8) > 1, '正文需要跨 Palm 文本记录读取');
  }
});

test('detectKind 对非 MOBI 数据返回 unknown', () => {
  assert.strictEqual(detectKind(Buffer.from('hello world')), 'unknown');
  assert.strictEqual(detectKind(Buffer.alloc(64)), 'unknown');
});

test('MOBI 解析回退 KF8 后报告实际格式并避免 MOBI7 专属章节合并', async (t) => {
  const directory = temporaryResources(t);
  const mobi7 = createMobi7Fixture(path.join(directory, 'mobi7'));
  const unknown = path.join(directory, 'unknown.mobi');
  fs.writeFileSync(unknown, Buffer.alloc(128));
  const book = {
    getMetadata: () => ({ title: 'KF8 回退样书' }),
    getSpine: () => [{ id: '0' }, { id: '1' }],
    getToc: () => [],
    getCoverImage: () => null,
    chapters: [{ id: '0', text: '<p>第一章</p>' }, { id: '1', text: '</mbp:pagebreak><p>第二章</p>' }],
  };
  const attempts = [];
  const sourcePath = path.join(__dirname, '../src/shared/mobi.js');
  const context = {
    module: { exports: {} }, Buffer,
    require: require('module').createRequire(sourcePath),
    parser: {
      initMobiFile: async (file) => { attempts.push(['mobi7', file]); throw new Error('需要 KF8 解析器'); },
      initKf8File: async (file) => { attempts.push(['kf8', file]); return book; },
    },
  };
  require('vm').runInNewContext(fs.readFileSync(sourcePath, 'utf8') + '\nloadParser = async () => parser;', context);
  for (const file of [unknown, mobi7.path]) {
    const opened = await context.module.exports.openMobi(file, directory);
    assert.strictEqual(opened.kind, 'kf8');
    assert.strictEqual(opened.chapters.length, 2, 'KF8 回退不得触发 MOBI7 标题页合并');
  }
  assert.deepStrictEqual(attempts, [['mobi7', unknown], ['kf8', unknown], ['mobi7', mobi7.path], ['kf8', mobi7.path]]);
});

test('真实文件路径解析标题、封面与所有章节，无需替换解析器读取方法', async (t) => {
  for (const sample of sampleBooks(t)) {
    const resDir = path.join(path.dirname(sample.path), 'resources');
    const opened = await openMobi(sample.path, resDir);
    try {
      assert.strictEqual(opened.title, sample.title);
      assert.strictEqual(opened.author, sample.author);
      assert.strictEqual(opened.chapters.length, sample.expected.chapters.length);
      assert.ok(opened.chapters.every((chapter) => Number(chapter.weight) > 1));
      assert.match(opened.cover, /^data:image\//);
      const metadata = await readMobiMetadata(sample.path);
      assert.strictEqual(metadata.title, sample.title);
      assert.strictEqual(metadata.author, sample.author);
      for (const expected of sample.expected.chapters) {
        const chapter = await loadChapter(opened, expected.index, resDir);
        assert.strictEqual(chapter.index, expected.index);
        assert.ok(chapter.html.includes(expected.anchor), '每章均应保留原始锚点 ' + expected.anchor);
        assert.ok(!/kindle:(?:embed|flow):|\brecindex=/i.test(chapter.html), '资源不能残留未解析的内部编号');
      }
    } finally {
      cleanupMobi(opened);
    }
  }
});

test('章节内容权重使用单章长度而非累计长度', () => {
  assert.strictEqual(chapterContentWeight({ totalLength: 1234, length: 500, text: '短文' }), 500);
  assert.strictEqual(chapterContentWeight({ length: 500, text: '短文' }), 500);
  assert.ok(chapterContentWeight('<p>一段正文</p><img src="x">') > 400);
});

test('完整样书的非空目录覆盖每一章，含最后一章', async (t) => {
  for (const sample of sampleBooks(t)) {
    const opened = await openMobi(sample.path, path.join(path.dirname(sample.path), 'resources'));
    try {
      assert.strictEqual(opened.toc.length, sample.expected.chapters.length);
      for (const expected of sample.expected.chapters) {
        const item = opened.toc.find((entry) => entry.label === expected.label);
        assert.ok(item, '目录缺少 ' + expected.label);
        assert.strictEqual(item.index, expected.index, expected.label + ' 目录目标章节');
        assert.strictEqual(typeof item.selector, 'string');
        if (sample.expected.kind === 'kf8') assert.strictEqual(item.selector, expected.selector);
      }
    } finally {
      cleanupMobi(opened);
    }
  }
});

test('Kindle position 的 FID 和 OFF 按 32 进制解析', () => {
  assert.deepStrictEqual(parseKindlePosition('kindle:pos:fid:0025:off:000000000A'), { fid: 69, off: 10 });
  assert.deepStrictEqual(parseKindlePosition('kindle:pos:fid:008G:off:0000000010'), { fid: 272, off: 32 });
  assert.strictEqual(parseKindlePosition('filepos:123'), null);
});

test('两种真实样书的脚注均可跳至末章并返回正文的具体位置', async (t) => {
  for (const sample of sampleBooks(t)) {
    const resDir = path.join(path.dirname(sample.path), 'resources');
    const opened = await openMobi(sample.path, resDir);
    try {
      for (const expected of [sample.expected.footnote, sample.expected.returnLink]) {
        const source = await loadChapter(opened, expected.fromChapter, resDir);
        assert.ok(source.html.includes('href="' + expected.href + '"'), '真实正文必须包含待点击脚注');
        const target = resolveMobiHref(opened, expected.href);
        assert.strictEqual(target.index, expected.targetIndex, sample.format + ' 的跨章脚注目标');
        const chapter = await loadChapter(opened, target.index, resDir);
        if (sample.expected.kind === 'kf8') {
          assert.strictEqual(target.selector, expected.selector);
          const [, name, value] = target.selector.match(/^\[(id|name|aid)="([^"]+)"\]$/);
          assert.ok(chapter.html.includes(name + '="' + value + '"'));
        } else {
          assert.ok(target.textHint.length > 12, 'MOBI7 必须解析出足够精确的目标正文');
          const text = chapter.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          assert.ok(text.includes(target.textHint), '提示文字必须存在于目标章');
        }
      }
      if (sample.expected.kind === 'mobi7') {
        const buffer = fs.readFileSync(sample.path);
        const textLength = buffer.readUInt32BE(buffer.readUInt32BE(78) + 4);
        for (const offset of [textLength, textLength + 1, Number.MAX_SAFE_INTEGER]) {
          assert.strictEqual(resolveMobiHref(opened, 'filepos:' + offset).index, null, '正文之外的偏移不能误定位到末章');
        }
      }
    } finally {
      cleanupMobi(opened);
    }
  }
});

test('完整样书读取正确图片记录，并保留独立 CSS、背景及 SVG 内嵌图', async (t) => {
  for (const sample of sampleBooks(t)) {
    const resDir = path.join(path.dirname(sample.path), 'resources');
    const opened = await openMobi(sample.path, resDir);
    try {
      const chapter = await loadChapter(opened, sample.expected.galleryChapter, resDir);
      for (const [name, image] of Object.entries(sample.expected.images)) {
        assert.ok((chapter.html + chapter.cssText).includes(image.dataUrl), sample.format + ' 的 ' + name + ' 图片必须对应正确记录');
      }
      if (sample.expected.kind === 'kf8') {
        for (const marker of sample.expected.cssMarkers) assert.ok(chapter.cssText.includes(marker));
        for (const marker of sample.expected.forbiddenCssMarkers) assert.ok(!chapter.cssText.includes(marker));
        assert.ok(!/@import\b|kindle:(?:embed|flow):/.test(chapter.cssText), '样式流及导入必须全部解析');
        assert.match(chapter.html, /<image\b[^>]*href="data:image\/png;base64,/);
        const svgUrl = chapter.html.match(/src="(data:image\/svg\+xml;base64,[^"]+)"/);
        assert.ok(svgUrl, 'SVG flow 必须转为可显示资源');
        assert.ok(decodeDataUrl(svgUrl[1]).toString().includes(sample.expected.images.green.dataUrl));
        const last = await loadChapter(opened, opened.chapters.length - 1, resDir);
        assert.ok(last.html.includes(sample.expected.images.green.dataUrl), '末章插图也必须被解析');
        const raw = fs.readFileSync(sample.path);
        for (const index of sample.expected.resourceDecoys) {
          const offset = raw.readUInt32BE(78 + (sample.expected.resourceStart + index) * 8);
          assert.strictEqual(raw.toString('ascii', offset, offset + 4), 'INDX', '错误base36编号应指向真实非图片记录以防测试失去回归覆盖');
        }
      }
    } finally {
      cleanupMobi(opened);
    }
  }
});

test('planChapterMerge：mobi7 标题页并入下一章正文', () => {
  const chapters = [
    { text: '<p>第1章 标题</p>' },
    { text: '</mbp:pagebreak><p>正文一……</p>' },
    { text: '<p>第2章 标题</p>' },
    { text: '</mbp:pagebreak><p>正文二……</p>' },
    { text: '<p>第3章 标题</p>' },
    { text: '</mbp:pagebreak><p>正文三……</p>' },
  ];
  assert.deepStrictEqual(planChapterMerge(chapters, 'mobi7'), [1, -1, 3, -1, 5, -1]);
});

test('planChapterMerge：无闭合 pagebreak 的正常 mobi7 不合并', () => {
  const chapters = [
    { text: '<mbp:pagebreak/><h1>一</h1><p>正文一</p>' },
    { text: '<mbp:pagebreak/><h1>二</h1><p>正文二</p>' },
  ];
  assert.deepStrictEqual(planChapterMerge(chapters, 'mobi7'), [-1, -1]);
});

test('planChapterMerge：kf8 不合并章节', () => {
  const chapters = [{ text: '<p>a</p>' }, { text: '</mbp:pagebreak><p>b</p>' }];
  assert.deepStrictEqual(planChapterMerge(chapters, 'kf8'), [-1, -1]);
});

test('planChapterMerge：连续闭合开头段落链式并入最终章节', () => {
  const chapters = [
    { text: '</mbp:pagebreak><p>段A</p>' },
    { text: '</mbp:pagebreak><p>段B</p>' },
    { text: '</mbp:pagebreak><p>段C</p>' },
    { text: '<p>正常章节</p>' },
  ];
  assert.deepStrictEqual(planChapterMerge(chapters, 'mobi7'), [2, 2, -1, -1]);
});

test('KF8 的 embed 和独立 CSS flow 都按 32 进制读取，并内联 CSS 背景和 SVG 图片', async (t) => {
  const directory = temporaryResources(t);
  const book = await resourceParser('kf8', directory);
  const reads = [];
  const flowReads = [];
  const resources = new Map([
    [31, PIXEL_GIF], // 0010 是 32，embed 使用从 1 开始的编号。
    [35, Buffer.from('INDX-not-an-image')], // 旧 base36 实现会读到这里。
    [47, PIXEL_PNG],
    [1023, PIXEL_GIF],
  ]);
  const flows = new Map([
    [10, Buffer.from('.wrong-flow { display: none; }')],
    [32, Buffer.from('.plate { background-image: url("kindle:embed:001G?mime=image/jpeg"); }')],
    [33, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="kindle:embed:0010?mime=image/png"/></svg>')],
  ]);
  book.idToChapter.set(0, { id: '0' });
  book.loadText = () => '<html><head><link href=\'kindle:flow:0010?mime=text/css\' rel=\'stylesheet\'/>'
    + '<style>.head-style { background-image: url("kindle:embed:0010?mime=image/png"); }</style></head><body>'
    + '<img src="kindle:embed:0010?mime=image/png"/><img src="kindle:embed:0100?mime=image/jpeg"/>'
    + '<img src="kindle:flow:0011?mime=image/svg+xml"/></body></html>';
  book.loadFlow = (index) => { flowReads.push(index); return flows.get(index); };
  book.mobiFile = {
    decode: (data) => new TextDecoder().decode(data),
    loadResource: (index) => { reads.push(index); return { raw: resources.get(index), type: 'image/jpeg' }; },
  };
  const chapter = await loadChapter(openedParser(book), 0, directory);
  assert.deepStrictEqual(reads, [47, 31, 1023]);
  assert.deepStrictEqual(flowReads, [32, 33]);
  assert.ok(chapter.cssText.includes('.plate') && !chapter.cssText.includes('.wrong-flow'));
  assert.ok(chapter.cssText.includes('data:image/png;base64,' + PIXEL_PNG.toString('base64')));
  assert.ok(chapter.cssText.includes('.head-style') && chapter.cssText.includes('data:image/gif;base64,'));
  assert.strictEqual((chapter.html.match(/src="data:image\/gif;base64,/g) || []).length, 2);
  const svgUrl = chapter.html.match(/src="(data:image\/svg\+xml;base64,[^"]+)"/)[1];
  assert.ok(decodeDataUrl(svgUrl).toString().includes('href="data:image/gif;base64,'));
  assert.ok(!chapter.html.includes('INDX') && !chapter.html.includes('kindle:'));
  assert.ok(!chapter.cssText.includes('kindle:'));
  await loadChapter(openedParser(book), 0, directory);
  assert.deepStrictEqual(reads, [47, 31, 1023], '重复加载必须复用章节与资源缓存');
});

test('KF8 损坏、越界和非 base32 资源不冒充图片，也不会中断整章', async (t) => {
  const directory = temporaryResources(t);
  const book = await resourceParser('kf8', directory);
  const reads = [];
  book.idToChapter.set(0, { id: '0' });
  book.loadText = () => '<html><head></head><body><p>文字仍然可读</p>'
    + '<img src="kindle:embed:0010?mime=image/jpeg"/>'
    + '<img src="kindle:embed:001W?mime=image/jpeg"/>'
    + '<img src="kindle:embed:0000?mime=image/jpeg"/>'
    + '<img src="kindle:embed:ZZZZZZZZZZZZZZZZ?mime=image/jpeg"/>'
    + '<img src="kindle:embed:0011?mime=image/jpeg"/>'
    + '<img src="kindle:flow:00VV?mime=image/svg+xml"/>'
    + '<img src="kindle:embed:0012?mime=image/jpeg"/></body></html>';
  book.loadFlow = () => { throw new Error('flow out of range'); };
  book.mobiFile = {
    decode: (data) => new TextDecoder().decode(data),
    loadResource: (index) => {
      reads.push(index);
      return { raw: index === 31 ? Buffer.from('INDX-not-an-image') : index === 34 ? PIXEL_PNG : undefined };
    },
  };
  const chapter = await loadChapter(openedParser(book), 0, directory);
  assert.deepStrictEqual(reads, [31, 32, 33]);
  assert.ok(chapter.html.includes('文字仍然可读'));
  assert.ok(!chapter.html.includes('data:image/jpeg'));
  assert.ok(chapter.html.includes('kindle:embed:0010'));
  // 正常资源位于损坏资源之后，仍可继续处理。
  const final = book.replaceResources('kindle:embed:0013?mime=image/jpeg');
  assert.strictEqual(final, 'data:image/png;base64,' + PIXEL_PNG.toString('base64'));
});

test('KF8 无 MIME 样式 flow 和循环嵌套样式仍可读取', async (t) => {
  const directory = temporaryResources(t);
  const book = await resourceParser('kf8', directory);
  book.idToChapter.set(0, { id: '0' });
  book.loadText = () => '<html><head><link rel="stylesheet" href="kindle:flow:000a"/>'
    + '<link rel="stylesheet" href="kindle:flow:000b?mime=text/css"/></head><body>正文</body></html>';
  book.loadFlow = (index) => Buffer.from(index === 10 ? '.without-mime { background: url("kindle:embed:0010"); }'
    : '@import url("kindle:flow:000b?mime=text/css"); .cyclic { color: blue; }');
  book.mobiFile = { decode: (data) => new TextDecoder().decode(data), loadResource: () => ({ raw: PIXEL_PNG }) };
  const chapter = await loadChapter(openedParser(book), 0, directory);
  assert.ok(chapter.cssText.includes('.without-mime') && chapter.cssText.includes('.cyclic'));
  assert.ok(chapter.cssText.includes('data:image/png;base64,'));
  assert.ok(chapter.cssText.length < 10000);
  assert.strictEqual(chapter.html, '正文');
});

test('KF8 head 中带 media 的 link/style 展开嵌套 flow 后再套条件', async (t) => {
  const directory = temporaryResources(t);
  const book = await resourceParser('kf8', directory);
  book.idToChapter.set(0, { id: '0' });
  book.loadText = () => '<html><head><style>.first { color: red; }</style>'
    + '<link rel="stylesheet" href="kindle:flow:0010?mime=text/css" media="screen"/>'
    + '<style media="screen">@import "kindle:flow:0011?mime=text/css" print;</style></head><body>正文</body></html>';
  book.loadFlow = (index) => Buffer.from(index === 32
    ? '@import url("kindle:flow:0011?mime=text/css"); .parent { color: blue; }'
    : '.nested { background: url("kindle:embed:0010"); }');
  book.mobiFile = { decode: (data) => new TextDecoder().decode(data), loadResource: () => ({ raw: PIXEL_PNG }) };
  const chapter = await loadChapter(openedParser(book), 0, directory);
  assert.ok(!chapter.cssText.includes('@import') && !chapter.cssText.includes('kindle:'));
  assert.match(chapter.cssText, /@media screen\s*\{\s*\.nested[^}]*\}\s*\.parent/);
  assert.match(chapter.cssText, /@media screen\s*\{\s*@media print\s*\{\s*\.nested/);
  assert.strictEqual((chapter.cssText.match(/data:image\/png;base64,/g) || []).length, 2);
});

test('MOBI7 的 recindex 继续按十进制读取', async (t) => {
  const directory = temporaryResources(t);
  const book = await resourceParser('mobi7', directory);
  const reads = [];
  book.idToChapter.set(0, { id: '0', text: '<img recindex="0010"/><img recindex="32"/>' });
  book.mobiFile = { loadResource: (index) => { reads.push(index); return { raw: PIXEL_GIF, type: 'image/jpeg' }; } };
  const chapter = await loadChapter(openedParser(book), 0, directory);
  assert.deepStrictEqual(reads, [9, 31]);
  assert.strictEqual((chapter.html.match(/src="data:image\/gif;base64,/g) || []).length, 2);
});

test('本地 file URL、编码文件名、独立 CSS 和 SVG 外部图片均完整内联', async (t) => {
  const directory = temporaryResources(t);
  const imagePath = path.join(directory, '插图 #1 (正文).jpeg');
  fs.writeFileSync(imagePath, PIXEL_PNG);
  fs.writeFileSync(path.join(directory, '符号&图片.gif'), PIXEL_GIF);
  fs.mkdirSync(path.join(directory, 'styles'));
  fs.writeFileSync(path.join(directory, 'styles', '分页.css'), '.plate { background: url("../' + encodeURIComponent(path.basename(imagePath)) + '"); }');
  fs.writeFileSync(path.join(directory, 'styles', 'supplement.css'), '@import "分页.css"; @import url("分页.css") print; .note { color: red; }');
  fs.writeFileSync(path.join(directory, '嵌套.svg'), '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">'
    + '<image xlink:href="' + encodeURIComponent(path.basename(imagePath)) + '"/>'
    + '<image href="符号&amp;图片.gif"/></svg>');
  const html = '<link href="styles/supplement.css" media="screen" rel="stylesheet"/>'
    + '<img src="' + pathToFileURL(imagePath).href + '"/>'
    + '<img src="' + encodeURIComponent(path.basename(imagePath)) + '"/>'
    + '<svg><image xlink:href="' + pathToFileURL(imagePath).href + '"/></svg>'
    + '<img src="嵌套.svg#plate"/>'
    + '<img src="https://example.test/remote.png"/><img src="blob:local-image"/>'
    + '<span style="background-image:url(&quot;符号&amp;图片.gif&quot;)"></span>';
  const book = { loadChapter: () => ({ html, css: [{ href: pathToFileURL(path.join(directory, 'styles', '分页.css')).href }] }) };
  const chapter = await loadChapter(openedParser(book), 0, directory);
  assert.strictEqual((chapter.html.match(/data:image\/png;base64,/g) || []).length, 3);
  assert.ok(chapter.cssText.includes('data:image/png;base64,') && chapter.cssText.includes('@media screen'));
  assert.ok(!chapter.cssText.includes('@import'), '本地导入必须展开，不能在 media 内或其它样式规则后留下无效 import');
  assert.strictEqual((chapter.cssText.match(/\.plate\s*\{/g) || []).length, 3);
  assert.match(chapter.cssText, /@media screen\s*\{\s*\.plate\s*\{/);
  assert.match(chapter.cssText, /@media print\s*\{\s*\.plate\s*\{/);
  const svgUrl = chapter.html.match(/src="(data:image\/svg\+xml;base64,[^"]+)"/)[1];
  assert.ok(svgUrl.endsWith('#plate'));
  const svg = decodeDataUrl(svgUrl).toString();
  assert.ok(svg.includes('xlink:href="data:image/png;base64,') && svg.includes('href="data:image/gif;base64,'));
  assert.ok(chapter.html.includes('style="background-image:url(data:image/gif;base64,' + PIXEL_GIF.toString('base64') + ')"'));
  assert.ok(chapter.html.includes('https://example.test/remote.png') && chapter.html.includes('blob:local-image'));
  assert.ok(!chapter.html.includes('<link'));
});

test('SVG use 的外部符号引用完整内联并保留片段，内部和缺失引用不变', (t) => {
  const directory = temporaryResources(t);
  const symbolPath = path.join(directory, '图标 symbols.svg');
  const symbol = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="shape"><path d="M0 0h10v10z"/></symbol></svg>';
  fs.writeFileSync(symbolPath, symbol);
  fs.writeFileSync(path.join(directory, 'nested.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><use href="' + encodeURIComponent(path.basename(symbolPath)) + '#shape"/></svg>');
  const retained = '<use href="#local"/><use href="https://example.test/icons.svg#shape"/><use href="missing.svg#shape"/>';
  const source = '<svg><use href="' + pathToFileURL(symbolPath).href + '#shape"/>'
    + '<use xlink:href="' + encodeURIComponent(path.basename(symbolPath)) + '#shape"/>' + retained + '</svg><img src="nested.svg"/>';
  const result = inlineChapterResources(source, directory);
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(symbol).toString('base64') + '#shape';
  assert.ok(result.html.includes('<use href="' + dataUrl + '"/>'));
  assert.ok(result.html.includes('<use xlink:href="' + dataUrl + '"/>'));
  assert.ok(result.html.includes(retained));
  const nested = result.html.match(/<img src="(data:image\/svg\+xml;base64,[^"]+)"/);
  assert.ok(nested);
  assert.ok(decodeDataUrl(nested[1]).toString().includes('<use href="' + dataUrl + '"/>'));
});

test('图片格式依据文件内容识别 JPEG/PNG/GIF/WebP/BMP/SVG，拒绝 INDX 与伪 RIFF', (t) => {
  const directory = temporaryResources(t);
  const bmp = Buffer.alloc(58);
  bmp.write('BM');
  bmp.writeUInt32LE(58, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(1, 18);
  bmp.writeInt32LE(1, 22);
  const samples = [
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])],
    ['png', PIXEL_PNG], ['gif', PIXEL_GIF],
    ['webp', Buffer.from('524946461a000000574542505650384c0d0000002f000000000710fd8ffe0722a2ff0100', 'hex')],
    ['bmp', bmp],
    ['svg+xml', Buffer.from('\uFEFF<?xml version="1.0"?>\n<!-- cover -->\n<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')],
  ];
  for (const [mime, data] of samples) {
    const fileName = mime.replace('+', '-') + '.wrong-extension';
    fs.writeFileSync(path.join(directory, fileName), data);
    const result = inlineChapterResources('<img src="' + fileName + '"/>', directory);
    assert.ok(result.html.includes('data:image/' + mime + ';base64,'), mime + ' 应按内容识别');
  }
  for (const [fileName, data] of [['index.jpg', Buffer.from('INDX')], ['sound.webp', Buffer.from('RIFFxxxxWAVE')], ['broken.png', Buffer.from([0x89, 0x50])]]) {
    fs.writeFileSync(path.join(directory, fileName), data);
    assert.strictEqual(inlineChapterResources('<img src="' + fileName + '"/>', directory).html, '<img src="' + fileName + '"/>');
  }
});

test('循环 CSS/SVG 资源不会无限递归，缺失文件不会阻断其它资源', (t) => {
  const directory = temporaryResources(t);
  fs.writeFileSync(path.join(directory, 'a.css'), '@import "b.css"; .a { background:url(pixel.gif); }');
  fs.writeFileSync(path.join(directory, 'b.css'), '@import "a.css";');
  fs.writeFileSync(path.join(directory, 'self.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><image href="self.svg"/><image href="pixel.gif"/></svg>');
  fs.writeFileSync(path.join(directory, 'pixel.gif'), PIXEL_GIF);
  const result = inlineChapterResources('<link href="a.css" rel="stylesheet"><img src="self.svg"><img src="missing.png">', directory);
  assert.ok(result.cssText.includes('data:image/gif;base64,') && result.cssText.length < 10000);
  assert.ok(!result.cssText.includes('@import'), '循环导入应终止于空规则，不再留无效 import');
  assert.ok(result.html.includes('data:image/svg+xml;base64,') && result.html.includes('src="missing.png"'));
});

test('多个独立 CSS 的导入按顺序展开，保留 media、supports 和 layer 条件', (t) => {
  const directory = temporaryResources(t);
  fs.writeFileSync(path.join(directory, 'first.css'), '.first { color: red; }');
  fs.writeFileSync(path.join(directory, 'child.css'), '.child { background: url(pixel.gif); }');
  fs.writeFileSync(path.join(directory, 'pixel.gif'), PIXEL_GIF);
  fs.writeFileSync(path.join(directory, 'second.css'), '@import "child.css"; .second { color: blue; }');
  fs.writeFileSync(path.join(directory, 'conditional.css'),
    '@import url("child.css") layer(illustrations) supports(display: grid) screen and (min-width: 1px), print;'
    + '@import "child.css" layer supports(selector(:is(.a, .b)));');
  const result = inlineChapterResources('<link rel="stylesheet" href="conditional.css" media="screen">', directory,
    [{ href: 'first.css' }, { href: 'second.css' }]);
  assert.ok(!result.cssText.includes('@import'));
  assert.match(result.cssText, /^\.first[^}]*\}\s*\.child[^}]*\}\s*\.second/);
  assert.match(result.cssText, /@media screen\s*\{\s*@layer illustrations\s*\{\s*@supports \(display: grid\)\s*\{\s*@media screen and \(min-width: 1px\), print\s*\{\s*\.child/);
  assert.match(result.cssText, /@layer\s*\{\s*@supports \(selector\(:is\(\.a, \.b\)\)\)\s*\{\s*\.child/);
  assert.strictEqual((result.cssText.match(/data:image\/gif;base64,/g) || []).length, 3);
});

test('data CSS 导入递归展开，分号、括号、注释和字符串不会误切 import', (t) => {
  const directory = temporaryResources(t);
  fs.writeFileSync(path.join(directory, 'child.css'), '.local-child { color: purple; }');
  const nested = 'data:text/css;base64,' + Buffer.from('@import "child.css"; .nested { content: "a; (b)"; }').toString('base64');
  const source = '/* @import "do-not-read.css"; */\n'
    + '.quoted::before { content: \'@import "do-not-read.css";\'; }\n'
    + '@import /* comment */ url("' + nested + '") /* condition */ print;'
    + '@import "data:text/css,' + encodeURIComponent('.encoded { color: green; }') + '" screen;';
  fs.writeFileSync(path.join(directory, 'parent.css'), source);
  const result = inlineChapterResources('', directory, ['parent.css']);
  assert.ok(result.cssText.includes('/* @import "do-not-read.css"; */'));
  assert.ok(result.cssText.includes('content: \'@import "do-not-read.css";\';'));
  assert.match(result.cssText, /@media print\s*\{\s*\.local-child[^}]*\}\s*\.nested\s*\{ content: "a; \(b\)";/);
  assert.match(result.cssText, /@media screen\s*\{\s*\.encoded/);
  assert.ok(!result.cssText.includes('@import /*') && !result.cssText.includes('@import "data:'));
});
