'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  createReadingStats,
  setGoalMinutes,
  addReadingTime,
  buildReadingSummary,
  formatDuration,
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
