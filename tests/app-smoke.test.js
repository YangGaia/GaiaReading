'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('项目关键文件齐全', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(root, pkg.main)), '主进程入口缺失');
  assert.ok(pkg.scripts.start, '缺少 start 脚本');
  assert.ok(pkg.scripts.test, '缺少 test 脚本');
  assert.ok(pkg.scripts.smoke, '缺少 smoke 脚本');
  assert.ok(pkg.scripts['smoke:open'], '缺少 smoke:open 脚本');
  assert.ok(pkg.scripts.shot, '缺少 shot 截图脚本');
  for (const f of [
    'src/preload.js',
    'src/shared/bookmarks.js',
    'src/shared/library.js',
    'src/renderer/index.html',
    'src/renderer/app.js',
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), f + ' 缺失');
  }
  for (const v of ['jszip.min.js', 'epub.min.js', 'pdf.min.js', 'pdf.worker.min.js']) {
    assert.ok(fs.existsSync(path.join(root, 'src/renderer/vendor', v)), 'vendor ' + v + ' 缺失');
  }
});

test('首页与闪屏图片资源存在', () => {
  for (const img of ['1.jpg', '2.jpeg']) {
    const f = path.join(root, 'src', 'renderer', 'images', img);
    assert.ok(fs.existsSync(f), img + ' 缺失，请先复制到 src/renderer/images/');
    assert.ok(fs.statSync(f).size > 10000, img + ' 异常过小');
  }
});

test('版本号为 0.3.1 且界面同步', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '0.3.1');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('Gaia Reading 0.3.1'), '关于面板版本号未同步');
  assert.ok(html.includes('btn-spread'), '缺少双页模式开关');
  assert.ok(html.includes('btn-theme'), '缺少主题切换');
  assert.ok(html.includes('fx-canvas'), '缺少粒子画布');
});

test('README 界面截图存在且已引用', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const shots = ['splash', 'night_home', 'night_bookshelf', 'reader', 'spread'];
  for (const s of shots) {
    assert.ok(readme.includes('docs/screenshots/' + s + '.png'), 'README 缺少 ' + s + ' 截图引用');
    const f = path.join(root, 'docs', 'screenshots', s + '.png');
    assert.ok(fs.existsSync(f), s + '.png 缺失，请先运行 npm run shot');
    assert.ok(fs.statSync(f).size > 5000, s + '.png 异常过小');
  }
});

test('主题/排版/翻页动画/菜单相关配置存在', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  assert.ok(css.includes('body.dark'), '缺少夜间模式变量');
  assert.ok(css.includes('body.eye'), '缺少护眼模式变量');
  assert.ok(css.includes('paging-next'), '缺少翻页动画规则');
  assert.ok(css.includes('pdf-dark'), '缺少 PDF 深色规则');
  assert.ok(css.includes('book-progress'), '缺少书架进度样式');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('font-select'), '缺少字体选择');
  assert.ok(html.includes('btn-theme'), '缺少主题切换');
  assert.ok(html.includes('progress-fill'), '缺少阅读进度条');
  assert.ok(html.includes("style-src 'self' 'unsafe-inline' blob:"), '缺少 blob 样式许可（图书 CSS 会被拦截）');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.ok(main.includes('setApplicationMenu'), '缺少自定义菜单');
  assert.ok(main.includes('autoHideMenuBar'), '缺少菜单栏隐藏配置');
});

test('测试用 EPUB fixture 存在', () => {
  const fixture = path.join(root, 'tests', 'fixtures', 'sample.epub');
  assert.ok(fs.existsSync(fixture), 'fixture 缺失，请先运行 node scripts/make-fixture.js');
  assert.ok(fs.statSync(fixture).size > 1000);
});

test('应用图标存在且打包配置已启用', () => {
  const png = path.join(root, 'build', 'icon.png');
  assert.ok(fs.existsSync(png), 'build/icon.png 缺失，请先运行 scripts/make-icon.ps1');
  const ico = path.join(root, 'build', 'icon.ico');
  assert.ok(fs.existsSync(ico), 'build/icon.ico 缺失，请先运行 scripts/make-icon.ps1');
  assert.ok(fs.statSync(ico).size > 1000, 'icon.ico 异常过小（生成可能失败）');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build && pkg.build.win, '缺少 build.win 配置');
  assert.strictEqual(pkg.build.win.icon, 'build/icon.png');
});








test('全局阅读习惯、进度精度与主题即时生效已接入', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(app.includes('function applyGlobalHabits'), '缺少全局习惯应用函数');
  assert.ok(!app.includes('function applyBookSettings'), '不应再按书记忆阅读习惯');
  const themeCalls = (app.match(/paginator\.setTheme\(state\.prefs\.theme\)/g) || []).length;
  assert.ok(themeCalls >= 3, '打开 MOBI/TXT 时应立即注入主题（当前 ' + themeCalls + ' 处）');
  assert.ok(app.includes('percent.toFixed(2)'), '进度百分比应显示两位小数');
  assert.ok(app.includes('readMode: state.readMode'), '习惯应写入全局 prefs');
  assert.ok(app.includes('migrateHabitsFromLastBook'), '应保留旧版按书习惯的迁移');
});
