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

test('阅读仪表盘使用有珠主题素材并兼容三种阅读模式', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.ok(html.includes('有珠的阅读记录'), '仪表盘标题应体现有珠主题');
  assert.ok(html.includes('id="stats-alice"') && html.includes('images/pet/cells/半身照.png'), '仪表盘应使用不拆分头身的完整有珠立绘');
  assert.ok(html.includes('draggable="false"'), '仪表盘有珠不应允许拖动');
  assert.ok(html.includes('id="stats-alice-line"'), '缺少有珠动态阅读台词');
  assert.ok(css.includes('body.eye #stats-view') && css.includes('body.dark #stats-view'), '有珠仪表盘应分别适配护眼和夜间模式');
  assert.ok(css.includes('@keyframes statsOrbit'), '目标仪式盘应具有低干扰轨道动画');
  assert.ok(css.includes('@keyframes statsAliceBreathe') && css.includes('@keyframes statsAliceShiver'), '完整有珠立绘应支持呼吸和连续点击动作');
  assert.ok(app.includes('interactWithStatsAlice') && app.includes("stats-alice-perk"), '仪表盘有珠应支持无对话的移入和点击互动');
  assert.ok(app.includes('readingCompanionLine(summary)'), '仪表盘应按阅读状态刷新有珠台词');
});
