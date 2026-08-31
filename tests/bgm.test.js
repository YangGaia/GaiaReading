'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BGM_TRACKS, BGM_DEFAULT_LOOP, trackById, nextAutoTrack, nextManualTrack, clampVolume } = require('../src/shared/bgm');

test('清单：4 首曲目且默认循环两首都在清单内', () => {
  assert.strictEqual(BGM_TRACKS.length, 4);
  const ids = BGM_TRACKS.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, 4, 'id 不应重复');
  assert.strictEqual(new Set(BGM_TRACKS.map((t) => t.file)).size, 4, '文件名不应重复');
  for (const id of BGM_DEFAULT_LOOP) assert.ok(ids.includes(id), '默认循环曲目应在清单内');
});

test('自动播放只循环默认两首', () => {
  let cur = 'alice';
  for (let i = 0; i < 10; i++) {
    cur = nextAutoTrack(cur);
    assert.ok(BGM_DEFAULT_LOOP.includes(cur), '自动下一首只能在默认两首内');
  }
  assert.strictEqual(nextAutoTrack('alice'), 'soujurou');
  assert.strictEqual(nextAutoTrack('soujurou'), 'alice');
});

test('手动切到的歌播完回到默认循环', () => {
  assert.strictEqual(nextAutoTrack('main-theme'), 'alice');
  assert.strictEqual(nextAutoTrack('aoko'), 'alice');
  assert.strictEqual(nextAutoTrack('unknown'), 'alice');
});

test('手动切换遍历全部 4 首且可回退', () => {
  assert.strictEqual(nextManualTrack('alice', 1), 'soujurou');
  assert.strictEqual(nextManualTrack('soujurou', 1), 'main-theme');
  assert.strictEqual(nextManualTrack('main-theme', 1), 'aoko');
  assert.strictEqual(nextManualTrack('aoko', 1), 'alice');
  assert.strictEqual(nextManualTrack('alice', -1), 'aoko');
  assert.strictEqual(nextManualTrack(null, 1), 'aoko');
});

test('音量钳制', () => {
  assert.strictEqual(clampVolume(-5), 0);
  assert.strictEqual(clampVolume(1.5), 1);
  assert.strictEqual(clampVolume(0.35), 0.35);
  assert.strictEqual(clampVolume(NaN), 0);
  assert.strictEqual(clampVolume('abc'), 0);
});

test('trackById', () => {
  assert.strictEqual(trackById('alice').title, '久遠寺有珠');
  assert.strictEqual(trackById('nope'), null);
});