'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { BGM_TRACKS, BGM_DEFAULT_LOOP, trackById, nextAutoTrack, nextManualTrack, clampVolume } = require('../src/shared/bgm');

test('清单：三碟共 59 首曲目，不重复原有四首', () => {
  assert.strictEqual(BGM_TRACKS.length, 59);
  const ids = BGM_TRACKS.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, 59, 'id 不应重复');
  assert.strictEqual(new Set(BGM_TRACKS.map((t) => t.file)).size, 59, '文件名不应重复');
  assert.deepStrictEqual([1, 2, 3].map(disc => BGM_TRACKS.filter(t => t.disc === disc).length), [20, 21, 18]);
  for (const id of ['main-theme', 'aoko', 'alice', 'soujurou']) assert.strictEqual(ids.filter(value => value === id).length, 1);
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

test('手动切换按三碟曲序遍历全部歌曲，首尾相接且可回退', () => {
  let current = BGM_TRACKS[0].id;
  const visited = new Set();
  for (const track of BGM_TRACKS) {
    assert.strictEqual(current, track.id);
    visited.add(current);
    const next = nextManualTrack(current, 1);
    assert.strictEqual(nextManualTrack(next, -1), current);
    current = next;
  }
  assert.strictEqual(visited.size, 59);
  assert.strictEqual(current, 'main-theme');
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

test('生产音频全部存在且无损音频指纹各不相同，曲名使用原始标签', () => {
  const folder = path.join(__dirname, '../assets/bgm');
  const fingerprints = new Set();
  for (const track of BGM_TRACKS) {
    const fd = fs.openSync(path.join(folder, track.file), 'r');
    try {
      const header = Buffer.alloc(42);
      fs.readSync(fd, header, 0, header.length, 0);
      assert.strictEqual(header.subarray(0, 4).toString(), 'fLaC', track.file);
      const fingerprint = header.subarray(26, 42).toString('hex');
      assert.ok(!fingerprints.has(fingerprint), `${track.title} audio duplicated`);
      fingerprints.add(fingerprint);
      let position = 4;
      let title;
      while (true) {
        const block = Buffer.alloc(4);
        assert.strictEqual(fs.readSync(fd, block, 0, 4, position), 4);
        const length = block.readUIntBE(1, 3);
        if ((block[0] & 127) === 4) {
          const comments = Buffer.alloc(length);
          fs.readSync(fd, comments, 0, length, position + 4);
          let cursor = 4 + comments.readUInt32LE(0);
          const count = comments.readUInt32LE(cursor);
          cursor += 4;
          for (let i = 0; i < count; i++) {
            const size = comments.readUInt32LE(cursor);
            cursor += 4;
            const value = comments.subarray(cursor, cursor + size).toString('utf8');
            if (value.startsWith('TITLE=')) title = value.slice(6);
            cursor += size;
          }
        }
        if (block[0] & 128) break;
        position += length + 4;
      }
      assert.strictEqual(track.title, title);
    } finally { fs.closeSync(fd); }
  }
  assert.strictEqual(fingerprints.size, 59);
  assert.strictEqual(trackById('ost-1-09').title, 'メインテーマ/冬');
  assert.strictEqual(trackById('ost-3-17').title, 'extra magic number?');
});
