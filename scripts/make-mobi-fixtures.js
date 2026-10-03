'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveFPath } = require('./smoke-paths');

const project = path.resolve(__dirname, '..');
const defaultOutput = path.resolve(project, '.tmp', 'mobi-fixtures');

function parseArguments(args) {
  let output = defaultOutput;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument !== '--output') throw new Error('未知参数：' + argument);
    const directory = args[++index];
    if (!directory || directory.startsWith('--')) throw new Error('--output 后需要提供输出目录。');
    output = path.resolve(directory);
  }
  return { output };
}

function summarizeFixture(fixture) {
  const expected = fixture.expected || {};
  const kind = expected.kind || (fixture.format === 'azw3' ? 'kf8' : 'mobi7');
  const chapters = Array.isArray(expected.chapters) ? expected.chapters.map((chapter, index) => ({
    index: Number.isInteger(chapter.index) ? chapter.index : index,
    label: chapter.label || chapter.title || '',
  })) : [];
  // The generators also return full image data for assertions. Keep the
  // reusable manifest small and readable by selecting only descriptive fields.
  const images = Object.entries(expected.images || {}).map(([name, image]) => {
    const summary = { name };
    for (const key of ['resourceIndex', 'embed', 'recindex', 'width', 'height', 'mime']) {
      if (typeof image[key] === 'string' || typeof image[key] === 'number') summary[key] = image[key];
    }
    return summary;
  });
  const filePath = path.resolve(fixture.path);
  return {
    path: filePath,
    format: fixture.format,
    title: fixture.title,
    bytes: fs.statSync(filePath).size,
    kind,
    resourceNumberBase: kind === 'kf8' ? 32 : 10,
    chapters,
    images,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/make-mobi-fixtures.js [--output DIR]');
    console.log('生成完全合成的 MOBI7、KF8/AZW3 样书和 manifest.json。');
    console.log('默认目录：' + defaultOutput);
    return;
  }
  const { createMobi7Fixture } = require('../tests/fixtures/mobi7-book-fixture');
  const { createKf8Fixture } = require('../tests/fixtures/kf8-book-fixture');
  resolveFPath(options.output, '合成样书输出目录');
  fs.mkdirSync(options.output, { recursive: true });
  const mobi7 = await createMobi7Fixture(options.output);
  const kf8 = await createKf8Fixture(options.output);
  const manifest = {
    schemaVersion: 1,
    description: '完全合成的本地阅读器测试样书，无需外部书籍。',
    outputDirectory: options.output,
    limitations: ['正文未压缩；不覆盖 DRM 加密或 HUFF/CDIC 压缩。'],
    books: [mobi7, kf8].map(summarizeFixture),
  };
  const manifestPath = path.join(options.output, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  for (const book of manifest.books) {
    console.log(`[${book.format.toUpperCase()} / ${book.kind.toUpperCase()}] ${book.title}`);
    console.log('  ' + book.path);
  }
  console.log('样书清单：' + manifestPath);
}

main().catch((error) => {
  console.error('样书生成失败：' + error.message);
  process.exitCode = 1;
});
