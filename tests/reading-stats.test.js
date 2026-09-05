'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  createReadingStats,
  setGoalMinutes,
  addReadingTime,
  buildReadingSummary,
  formatDuration,
  readingCompanionLine,
} = require('../src/shared/reading-stats');

test('阅读时长按本地日期和书籍累计，单次异常跨度受限', () => {
  let stats = createReadingStats();
  const at = new Date(2026, 8, 2, 12, 0).getTime();
  stats = addReadingTime(stats, { at, ms: 25000, book: { path: 'a.epub' }, percent: 20 });
  stats = addReadingTime(stats, { at, ms: 120000, book: { path: 'a.epub' }, percent: 21 });
  const summary = buildReadingSummary(stats, at);
  assert.strictEqual(summary.todayMs, 85000);
  assert.strictEqual(stats.days['2026-09-02'].byBook['a.epub'], 85000);
});

test('有珠阅读台词随目标完成度和连续天数变化', () => {
  assert.match(readingCompanionLine({ todayMs: 0, goalMs: 1800000 }), /书页还很安静/);
  assert.match(readingCompanionLine({ todayMs: 1200000, goalMs: 1800000 }), /离今天的目标不远/);
  assert.match(readingCompanionLine({ todayMs: 1800000, goalMs: 1800000 }), /做得不错/);
  assert.match(readingCompanionLine({ todayMs: 1800000, goalMs: 1800000, currentStreak: 7 }), /不是一时兴起/);
});

test('本周、连续阅读和年度读完书籍统计正确', () => {
  let stats = createReadingStats();
  for (const day of [31, 1, 2]) {
    const at = new Date(2026, day === 31 ? 7 : 8, day, 20, 0).getTime();
    stats = addReadingTime(stats, {
      at,
      ms: 60000,
      book: { path: 'book.epub', title: '测试书', cover: 'cover' },
      percent: day === 2 ? 100 : 50,
    });
  }
  const summary = buildReadingSummary(stats, new Date(2026, 8, 2, 21, 0).getTime());
  assert.strictEqual(summary.currentStreak, 3);
  assert.strictEqual(summary.longestStreak, 3);
  assert.strictEqual(summary.completedThisYear, 1);
  assert.strictEqual(summary.completedBooks[0].title, '测试书');
  assert.strictEqual(summary.week.reduce((sum, day) => sum + day.ms, 0), 180000);
});

test('阅读目标只接受预设档位，时长格式稳定', () => {
  assert.strictEqual(setGoalMinutes({}, 45).goalMinutes, 45);
  assert.strictEqual(setGoalMinutes({}, 22).goalMinutes, 30);
  assert.strictEqual(formatDuration(0), '0分钟');
  assert.strictEqual(formatDuration(90 * 60000), '1小时30分钟');
});

test('阅读仪表盘保留有珠素材且不跟随阅读配色', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const presentation = fs.readFileSync(path.join(root, 'src/renderer/stats-presentation.js'), 'utf8');
  assert.ok(html.includes('有珠的阅读记录'), '仪表盘标题应体现有珠主题');
  assert.ok(html.includes('id="stats-alice"') && html.includes('images/pet/stats/idle.png'), '仪表盘应使用不拆分头身的完整尺寸预合成立绘');
  assert.ok(html.includes('draggable="false"'), '仪表盘有珠不应允许拖动');
  assert.ok(html.includes('id="stats-alice-zzz"'), '统计页睡觉动作应显示 Zzz 状态');
  assert.ok(html.includes('id="stats-alice-line"'), '缺少有珠动态阅读台词');
  assert.doesNotMatch(css, /body\.(eye|dark)\s+#stats-view/, '阅读配色不能接管目标页');
  assert.ok(html.includes('stats-clock-hour') && html.includes('stats-clock-minute') && html.includes('stats-clock-second'), '阅读时钟必须包含三根真实累计时长指针');
  assert.ok(css.includes('@keyframes statsAliceBreathe') && css.includes('@keyframes statsAliceYawn') && css.includes('@keyframes statsAliceSleep'), '完整有珠立绘应支持呼吸、打哈欠和睡觉动作');
  assert.ok(app.includes('interactWithStatsAlice') && app.includes("stats-alice-perk"), '仪表盘有珠应支持无对话的移入和点击互动');
  assert.ok(app.includes("idle: 'idle.png'") && app.includes("blink: 'blink.png'") && app.includes("yawn: 'yawn.png'"), '统计页动作必须切换等尺寸完整立绘，不能拆分头身');
  assert.ok(app.includes("const actions = ['blink', 'yawn', 'sleep']") && app.includes('scheduleStatsAliceBlink'), '点击应依次提供眨眼、哈欠、睡觉，并保留自然眨眼');
  assert.ok(presentation.includes('readingCompanionLine(summary)'), '仪表盘应按阅读状态刷新有珠台词');
  const statsAssetDir = path.join(root, 'src/renderer/images/pet/stats');
  const assets = ['idle.png', 'blink.png', 'drowsy.png', 'yawn.png'].map((name) => fs.readFileSync(path.join(statsAssetDir, name)));
  for (const asset of assets) {
    assert.strictEqual(asset.readUInt32BE(16), 356, '统计页表情立绘宽度必须保持为完整原图尺寸');
    assert.strictEqual(asset.readUInt32BE(20), 647, '统计页表情立绘高度必须保持为完整原图尺寸');
  }
  assert.notDeepStrictEqual(assets[1], assets[3], '闭眼和打哈欠不能使用同一张图片冒充');
  assert.ok(fs.existsSync(path.join(root, 'scripts/build-stats-alice-assets.ps1')), '应保留完整立绘合成脚本以便素材更新时重新生成');
});
