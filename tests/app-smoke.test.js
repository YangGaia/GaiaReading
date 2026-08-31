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
  const shots = ['screenshot-01', 'screenshot-02', 'screenshot-03', 'screenshot-04'];
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
  assert.ok(app.includes('epubDisplayPercent'), 'EPUB 进度应使用位置索引+回退计算');
  assert.ok(app.includes('readMode: state.readMode'), '习惯应写入全局 prefs');
  assert.ok(app.includes('migrateHabitsFromLastBook'), '应保留旧版按书习惯的迁移');
});

test('EPUB 行距跟随用户设置且切换时即时生效', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(/line-height: ' \+ state\.lineHeight \+ ' !important/.test(app), 'EPUB 段落行距应使用 state.lineHeight');
  assert.ok(!app.includes('line-height: 1.9 !important; } h1, h2, h3, h4'), '不应再写死 EPUB 段落行距 1.9');
  const cycleSeg = app.slice(app.indexOf('function cycleLineHeight'), app.indexOf('function togglePanel'));
  assert.ok(cycleSeg.includes('applyEpubTypography()'), 'cycleLineHeight 应更新 epub.js 主题行距');
  assert.ok(cycleSeg.includes('applyReaderStyles(contents)'), 'cycleLineHeight 应立即重注入 EPUB 阅读样式');
  const setSeg = app.slice(app.indexOf('setLineHeight: (lh)'));
  assert.ok(setSeg.includes('applyReaderStyles(contents)'), 'setLineHeight 应立即重注入 EPUB 阅读样式');
});

test('书签支持内容锚点、重命名与 TXT 章节识别', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const bm = fs.readFileSync(path.join(root, 'src', 'shared', 'bookmarks.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(bm.includes('function renameBookmark'), '书签库应支持重命名');
  assert.ok(app.includes('renameBookmarkFromMap'), '渲染进程应接入重命名');
  assert.ok(app.includes('paginator.anchor()'), '应通过内容锚点定位书签');
  assert.ok(app.includes('paginator.locate('), '跳转应使用内容锚点重新定位');
  assert.ok(app.includes('txtChapters'), '应识别 TXT 章节');
  assert.ok(html.includes('txt-chapters.js'), '应加载 TXT 章节识别模块');
  assert.ok(fs.existsSync(path.join(root, 'src', 'shared', 'txt-chapters.js')), 'txt-chapters 模块缺失');
});

test('分页器保留左右页边距（版心）', () => {
  const p = fs.readFileSync(path.join(root, 'src', 'renderer', 'paginator.js'), 'utf8');
  assert.ok(p.includes("'body > * { margin-left: ' + pagePad + 'px !important; margin-right: ' + pagePad + 'px !important; }'"), '页面应注入左右页边距');
  assert.ok(!p.includes("'p { text-indent: 2em !important; margin: 0 0 0.8em !important;"), '段落排版不应再重置左右边距');
  assert.ok(p.includes("margin-top: 0 !important; margin-bottom: 0.8em !important"), '段落应只设上下边距，保留版心左右留白');
});

test('可调节页边距功能接入', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const pag = fs.readFileSync(path.join(root, 'src', 'renderer', 'paginator.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('btn-margin'), '缺少页边距按钮');
  assert.ok(html.includes('margin-value'), '缺少页边距数值显示');
  assert.ok(app.includes('const MARGIN_OPTIONS = [4, 8, 12, 16];'), '应提供边距档位');
  assert.ok(app.includes('function cycleMargin()'), '缺少边距循环函数');
  assert.ok(app.includes('paginator.setMargin('), '应调用分页器边距');
  assert.ok(app.includes("'body > * { margin-left: ' + marginPct + '% !important;"), 'EPUB 应注入可调边距');
  assert.ok(pag.includes('setMargin(pct)'), '分页器应支持 setMargin');
  assert.ok(pag.includes('this.marginPct'), '分页器应保存边距档位');
});

test('内置 BGM 功能接入', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const shared = fs.readFileSync(path.join(root, 'src', 'shared', 'bgm.js'), 'utf8');
  assert.ok(fs.existsSync(path.join(root, 'src', 'renderer', 'bgm.js')), '缺少渲染进程 BGM 模块');
  assert.ok(html.includes('bgm.js'), '应加载 BGM 脚本');
  assert.ok(html.includes("media-src 'self' bgm: blob: data:"), 'CSP 应允许 bgm: 媒体协议');
  assert.ok(main.includes('protocol.registerSchemesAsPrivileged'), '主进程应注册 bgm 协议');
  assert.ok(main.includes("app.commandLine.appendSwitch('autoplay-policy'"), '应开启自动播放策略');
  assert.ok(app.includes('window.GaiaBgm.initBgm()'), '应用启动应初始化 BGM');
  assert.ok(shared.includes("BGM_DEFAULT_LOOP = ['alice', 'soujurou']"), '默认循环应只有有珠/草十郎');
});

test('BGM 胶囊封面与阅读进度条细节', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  const bgm = fs.readFileSync(path.join(root, 'src', 'renderer', 'bgm.js'), 'utf8');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'bgm', 'cover.jpg')), '缺少专辑封面');
  assert.ok(html.includes("img-src 'self' data: blob: bgm:"), 'CSP 应允许 bgm: 图片');
  assert.ok(bgm.includes('bgm://local/cover.jpg'), '胶囊应加载专辑封面');
  assert.ok(css.includes('.bgm-cover'), '应有封面缩略图样式');
  assert.ok(css.includes('.bgm-capsule.in-topbar'), '阅读界面胶囊应嵌入顶栏');
  assert.ok(bgm.includes('#reader-view .topbar'), '渲染进程应把胶囊放入阅读页顶栏');
  assert.ok(css.includes('bgmWave'), '歌名播放时应带波浪形浮动动画');
  assert.ok(bgm.includes("s.className = 'bgm-char'"), '歌名应逐字渲染以支持波浪动画');
  const topIdx = html.indexOf('id="progress-track"');
  const footerIdx = html.indexOf('<footer class="statusbar">');
  assert.ok(topIdx >= 0 && footerIdx >= 0 && footerIdx < topIdx, '进度条应位于底部状态栏（footer 内）');
});