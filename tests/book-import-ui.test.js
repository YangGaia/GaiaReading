'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/renderer/library.css'), 'utf8');

test('书架提供添加图书选择窗口，首页提供阅读目标', () => {
  for (const id of ['btn-home-reading-stats', 'btn-add-books', 'book-import-overlay', 'btn-import-folder', 'btn-import-file-picker']) {
    assert.ok(html.includes(`id="${id}"`), `添加图书界面缺少 ${id}`);
  }
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(!html.includes('id="btn-home-add-books"'));
  assert.ok(!html.includes('id="btn-reading-stats"'));
  assert.ok(app.includes('openBookImportChooser(false)'));
  assert.ok(app.includes('window.api.openFolder(requestId)'));
  assert.ok(app.includes('window.api.openFiles(requestId)'));
  assert.ok(app.includes('window.api.metadata(filePath, requestId)'));
  assert.ok(html.indexOf('../shared/book-import.js') < html.indexOf('src="app.js"'));
});

test('导入界面提供当前文件、进度、已保存数与取消按钮，长文件名省略显示', () => {
  for (const id of ['import-status', 'import-current-file', 'import-counts', 'import-progress-bar', 'btn-cancel-import']) {
    assert.ok(html.includes(`id="${id}"`), `导入进度缺少 ${id}`);
  }
  assert.match(html, /<progress[^>]*aria-label="图书导入进度"/);
  assert.match(css, /\.import-current-file\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/);
  assert.ok(app.includes('progress.processed + \' / \' + progress.total + \' · 已保存 \''));
  assert.ok(app.includes("els.cancelBookImport.addEventListener('click', cancelBookImport)"));
});

test('扫描后显示书架取消入口，空选择保留首页与此前提示', () => {
  assert.ok(app.includes("progress.phase === 'scanning'"));
  assert.ok(app.includes('result.selectionEmpty && input.selectPaths && bookImportContext.fromHome'));
  assert.ok(app.includes('els.importStatus.textContent = previousStatus.text'));
  assert.ok(app.includes("window.api.onBookImportProgress((progress) => bookImporter.scanning(progress))"));
});

test('导入与书架写入期间阻止并发管理、删除及重复导入', () => {
  for (const name of ['addToLibrary', 'removeFromShelf', 'batchRemoveSelected']) {
    const start = app.indexOf('async function ' + name + '(');
    const guard = app.slice(start, start + 220);
    assert.ok(guard.includes('bookImporter.getState().active || libraryWritesPending'), `${name} 缺少写入互斥`);
  }
  assert.ok(app.includes("'btn-manage', 'btn-select-all', 'btn-remove-selected', 'ctx-remove'"));
  assert.ok(app.includes('saveLibrary: (library) => window.api.stateSet(\'library\', library)'));
  assert.ok(app.includes("parts.push('成功 ' + (result.added - result.recovered)"));
  assert.ok(app.includes("parts.push('恢复 ' + result.recovered"));
  assert.ok(app.includes("parts.push('重复跳过 ' + result.skipped"));
  assert.ok(app.includes("parts.push('失败 ' + result.failures.length"));
});
