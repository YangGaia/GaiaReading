'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaBgm = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 内置 BGM 曲目清单（assets/bgm/*.mp3）
  const BGM_TRACKS = [
    { id: 'main-theme', file: '01-main-theme.mp3', title: '魔法使いの夜～メインテーマ', artist: '深澤秀行' },
    { id: 'aoko', file: '02-aoko.mp3', title: '蒼崎青子', artist: '深澤秀行' },
    { id: 'alice', file: '03-alice.mp3', title: '久遠寺有珠', artist: '深澤秀行' },
    { id: 'soujurou', file: '04-soujurou.mp3', title: '静希草十郎', artist: '深澤秀行' },
  ];

  // 默认循环：只重复久遠寺有珠 / 静希草十郎；手动切换才能听到其余两首
  const BGM_DEFAULT_LOOP = ['alice', 'soujurou'];

  function trackById(id) {
    return BGM_TRACKS.find((t) => t.id === id) || null;
  }

  /** 自动播完下一首：默认两首循环；手动切到的歌播完后回到默认循环第一首。 */
  function nextAutoTrack(currentId) {
    const loop = BGM_DEFAULT_LOOP;
    const idx = loop.indexOf(currentId);
    if (idx >= 0) return loop[(idx + 1) % loop.length];
    return loop[0];
  }

  /** 手动切换：在全部曲目里前进/后退，循环。 */
  function nextManualTrack(currentId, dir) {
    const ids = BGM_TRACKS.map((t) => t.id);
    const cur = currentId && ids.includes(currentId) ? currentId : ids[0];
    const idx = ids.indexOf(cur);
    const step = dir === -1 ? -1 : 1;
    return ids[(idx + step + ids.length) % ids.length];
  }

  function clampVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  return { BGM_TRACKS, BGM_DEFAULT_LOOP, trackById, nextAutoTrack, nextManualTrack, clampVolume };
});