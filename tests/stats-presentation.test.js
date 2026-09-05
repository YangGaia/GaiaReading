'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clockReading } = require('../src/renderer/stats-presentation');
const goal = 30 * 60000;

test('累计阅读从零开始，秒表显示不受墙上时钟时间影响', () => {
  assert.deepEqual(clockReading(0, goal), {
    text: '00:00:00', label: '0小时0分钟0秒', hourAngle: 0, minuteAngle: 0,
    secondAngle: 0, progress: 0, percent: 0,
  });
  for (const ms of [undefined, NaN, Infinity, -1000]) assert.equal(clockReading(ms, goal).text, '00:00:00');
  assert.equal(clockReading(999, goal).text, '00:00:00');
  assert.equal(clockReading(1000, goal).text, '00:00:01');
});

test('时分秒针与精确时长一致，跨分钟和小时不丢失累计读数', () => {
  const clock = clockReading((3600 + 38 * 60 + 42) * 1000, goal);
  assert.equal(clock.text, '01:38:42');
  assert.equal(clock.label, '1小时38分钟42秒');
  assert.equal(clock.hourAngle, 49.35);
  assert.equal(clock.minuteAngle, 232.2);
  assert.equal(clock.secondAngle, 252);
  const before = clockReading(3599999, goal);
  assert.equal(before.text, '00:59:59');
  assert.equal(before.secondAngle, 354);
  const after = clockReading(3600000, goal);
  assert.equal(after.text, '01:00:00');
  assert.equal(after.hourAngle, 30);
  assert.equal(after.minuteAngle, 0);
  assert.equal(after.secondAngle, 0);
});

test('12小时后模拟表盘循环，数字时长保留完整累计值', () => {
  assert.equal(clockReading(13 * 3600000, goal).hourAngle, 30);
  assert.equal(clockReading(13 * 3600000, goal).text, '13:00:00');
  assert.equal(clockReading(24 * 3600000, goal).text, '24:00:00');
});

test('目标外圈不会提前完成，超出目标不截断阅读时长', () => {
  assert.equal(clockReading(goal - 1, goal).percent, 99);
  assert.equal(clockReading(goal, goal).percent, 100);
  assert.equal(clockReading(goal / 2, goal).progress, .5);
  assert.equal(clockReading(goal * 2, goal).progress, 1);
  assert.equal(clockReading(goal * 2, goal).text, '01:00:00');
  assert.equal(clockReading(goal, 0).percent, 0);
});
