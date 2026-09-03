'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

test('首页与书架共用添加图书选择窗口', () => {
  for (const id of ['btn-home-add-books', 'btn-add-books', 'book-import-overlay', 'btn-import-folder', 'btn-import-file-picker']) {
    assert.ok(html.includes(`id="${id}"`), `添加图书界面缺少 ${id}`);
  }
  assert.ok(html.includes('aria-modal="true"'), '添加图书窗口应声明为模态界面');
  assert.ok(app.includes("openBookImportChooser(true)"), '首页入口应记录从首页发起导入');
  assert.ok(app.includes("openBookImportChooser(false)"), '书架入口应复用相同选择窗口');
  assert.ok(css.includes('.book-import-overlay[hidden]'), '添加图书窗口缺少隐藏状态样式');
});

test('添加图书支持文件夹扫描、单文件与文件多选', () => {
  assert.ok(app.includes("source === 'folder' ? await window.api.openFolder() : await window.api.openFiles()"), '两种选择方式应进入各自系统选择器');
  assert.ok(main.includes("properties: ['openFile', 'multiSelections']"), '文件选择器必须支持多选');
  assert.ok(main.includes("properties: ['openDirectory']"), '文件夹选择器必须支持目录选择');
  assert.ok(main.includes('scanFolder(res.filePaths[0], out, 8)'), '文件夹应递归扫描受支持的电子书');
});

test('统一导入流程反馈重复文件并只在实际选择后切换页面', () => {
  assert.ok(app.includes("skipped += 1"), '重复图书应被计数');
  assert.ok(app.includes("已跳过 ' + skipped + ' 本重复图书"), '导入状态应反馈重复图书数量');
  const cancelCheck = app.indexOf('if (!paths.length)');
  const librarySwitch = app.indexOf("if (fromHome) showView('library');", cancelCheck);
  assert.ok(cancelCheck >= 0 && librarySwitch > cancelCheck, '取消文件选择时不应从首页跳转到书架');
});
