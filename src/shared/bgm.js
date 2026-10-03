'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaBgm = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 专辑原始标签中的曲名；保留旧曲目 ID，兼容已保存的播放设置。
  const BGM_TRACKS = [
    { id: "main-theme", file: "1-01.flac", title: "魔法使いの夜～メインテーマ", artist: "深澤秀行", disc: 1, number: 1 },
    { id: "aoko", file: "1-02.flac", title: "蒼崎青子", artist: "深澤秀行", disc: 1, number: 2 },
    { id: "ost-1-03", file: "1-03.flac", title: "鍵盤は躍る (原曲:ノクターン)", artist: "深澤秀行", disc: 1, number: 3 },
    { id: "ost-1-04", file: "1-04.flac", title: "午後の眠り (原曲:ジムノペティ)", artist: "深澤秀行", disc: 1, number: 4 },
    { id: "alice", file: "1-05.flac", title: "久遠寺有珠", artist: "深澤秀行", disc: 1, number: 5 },
    { id: "ost-1-06", file: "1-06.flac", title: "ひかるランチ", artist: "芳賀敬太", disc: 1, number: 6 },
    { id: "ost-1-07", file: "1-07.flac", title: "日はまた沈む", artist: "芳賀敬太", disc: 1, number: 7 },
    { id: "soujurou", file: "1-08.flac", title: "静希草十郎", artist: "深澤秀行", disc: 1, number: 8 },
    { id: "ost-1-09", file: "1-09.flac", title: "メインテーマ/冬", artist: "深澤秀行", disc: 1, number: 9 },
    { id: "ost-1-10", file: "1-10.flac", title: "idyllic/blue", artist: "深澤秀行", disc: 1, number: 10 },
    { id: "ost-1-11", file: "1-11.flac", title: "久遠寺邸で朝食を (原曲:セレナーデ)", artist: "深澤秀行", disc: 1, number: 11 },
    { id: "ost-1-12", file: "1-12.flac", title: "WORKING!!", artist: "hil", disc: 1, number: 12 },
    { id: "ost-1-13", file: "1-13.flac", title: "目を覚ます", artist: "James Harris", disc: 1, number: 13 },
    { id: "ost-1-14", file: "1-14.flac", title: "騒ぎだす", artist: "James Harris", disc: 1, number: 14 },
    { id: "ost-1-15", file: "1-15.flac", title: "笑いあう", artist: "James Harris", disc: 1, number: 15 },
    { id: "ost-1-16", file: "1-16.flac", title: "街から離れて", artist: "芳賀敬太", disc: 1, number: 16 },
    { id: "ost-1-17", file: "1-17.flac", title: "誰かと二人で", artist: "芳賀敬太", disc: 1, number: 17 },
    { id: "ost-1-18", file: "1-18.flac", title: "密談", artist: "芳賀敬太", disc: 1, number: 18 },
    { id: "ost-1-19", file: "1-19.flac", title: "窮地/herald", artist: "芳賀敬太", disc: 1, number: 19 },
    { id: "ost-1-20", file: "1-20.flac", title: "thames troll(wood)", artist: "hil", disc: 1, number: 20 },
    { id: "ost-2-01", file: "2-01.flac", title: "鏡の国の騒動", artist: "深澤秀行", disc: 2, number: 1 },
    { id: "ost-2-02", file: "2-02.flac", title: "ghost bell (原曲:黒い瞳)", artist: "芳賀敬太", disc: 2, number: 2 },
    { id: "ost-2-03", file: "2-03.flac", title: "Judicare tibi", artist: "深澤秀行", disc: 2, number: 3 },
    { id: "ost-2-04", file: "2-04.flac", title: "決闘/one-on-one", artist: "深澤秀行", disc: 2, number: 4 },
    { id: "ost-2-05", file: "2-05.flac", title: "お伽の国の狂騒", artist: "深澤秀行", disc: 2, number: 5 },
    { id: "ost-2-06", file: "2-06.flac", title: "対峙/out border", artist: "深澤秀行", disc: 2, number: 6 },
    { id: "ost-2-07", file: "2-07.flac", title: "FLAT SNARK", artist: "深澤秀行", disc: 2, number: 7 },
    { id: "ost-2-08", file: "2-08.flac", title: "絢爛/finality", artist: "深澤秀行", disc: 2, number: 8 },
    { id: "ost-2-09", file: "2-09.flac", title: "顕現/great three", artist: "深澤秀行", disc: 2, number: 9 },
    { id: "ost-2-10", file: "2-10.flac", title: "窮地/omen", artist: "芳賀敬太", disc: 2, number: 10 },
    { id: "ost-2-11", file: "2-11.flac", title: "決着/turbulence overdrive", artist: "深澤秀行", disc: 2, number: 11 },
    { id: "ost-2-12", file: "2-12.flac", title: "nostalgia", artist: "深澤秀行", disc: 2, number: 12 },
    { id: "ost-2-13", file: "2-13.flac", title: "メインテーマ/日常", artist: "深澤秀行", disc: 2, number: 13 },
    { id: "ost-2-14", file: "2-14.flac", title: "～その隙間～", artist: "James Harris", disc: 2, number: 14 },
    { id: "ost-2-15", file: "2-15.flac", title: "エレガント", artist: "hil", disc: 2, number: 15 },
    { id: "ost-2-16", file: "2-16.flac", title: "いつまでも君と", artist: "芳賀敬太", disc: 2, number: 16 },
    { id: "ost-2-17", file: "2-17.flac", title: "時計はまわる", artist: "hil", disc: 2, number: 17 },
    { id: "ost-2-18", file: "2-18.flac", title: "遠い疵", artist: "芳賀敬太", disc: 2, number: 18 },
    { id: "ost-2-19", file: "2-19.flac", title: "メインテーマ/眠り", artist: "深澤秀行", disc: 2, number: 19 },
    { id: "ost-2-20", file: "2-20.flac", title: "輪舞/witch Tale", artist: "深澤秀行", disc: 2, number: 20 },
    { id: "ost-2-21", file: "2-21.flac", title: "imbalance/Alice", artist: "深澤秀行", disc: 2, number: 21 },
    { id: "ost-3-01", file: "3-01.flac", title: "待ち焦がれる", artist: "James Harris", disc: 3, number: 1 },
    { id: "ost-3-02", file: "3-02.flac", title: "天はたしかに", artist: "hil", disc: 3, number: 2 },
    { id: "ost-3-03", file: "3-03.flac", title: "甘い痛み", artist: "芳賀敬太", disc: 3, number: 3 },
    { id: "ost-3-04", file: "3-04.flac", title: "夜への誘い", artist: "hil", disc: 3, number: 4 },
    { id: "ost-3-05", file: "3-05.flac", title: "金狼/ELEMENTS", artist: "深澤秀行", disc: 3, number: 5 },
    { id: "ost-3-06", file: "3-06.flac", title: "imbalance/blue", artist: "深澤秀行", disc: 3, number: 6 },
    { id: "ost-3-07", file: "3-07.flac", title: "Five", artist: "深澤秀行", disc: 3, number: 7 },
    { id: "ost-3-08", file: "3-08.flac", title: "innocence", artist: "深澤秀行", disc: 3, number: 8 },
    { id: "ost-3-09", file: "3-09.flac", title: "First star", artist: "深澤秀行", disc: 3, number: 9 },
    { id: "ost-3-10", file: "3-10.flac", title: "メインテーマ/予感", artist: "深澤秀行", disc: 3, number: 10 },
    { id: "ost-3-11", file: "3-11.flac", title: "家路", artist: "James Harris", disc: 3, number: 11 },
    { id: "ost-3-12", file: "3-12.flac", title: "帰り道", artist: "James Harris", disc: 3, number: 12 },
    { id: "ost-3-13", file: "3-13.flac", title: "きみのはなし", artist: "深澤秀行", disc: 3, number: 13 },
    { id: "ost-3-14", file: "3-14.flac", title: "星が瞬くこんな夜に ～ゲームVer.～", artist: "supercell", disc: 3, number: 14 },
    { id: "ost-3-15", file: "3-15.flac", title: "星が瞬くこんな夜に ～オルゴールVer.～", artist: "supercell", disc: 3, number: 15 },
    { id: "ost-3-16", file: "3-16.flac", title: "see you again, miss blue!", artist: "深澤秀行", disc: 3, number: 16 },
    { id: "ost-3-17", file: "3-17.flac", title: "extra magic number?", artist: "深澤秀行", disc: 3, number: 17 },
    { id: "ost-3-18", file: "3-18.flac", title: "予告", artist: "深澤秀行", disc: 3, number: 18 },
  ];

  // 默认循环：只重复久遠寺有珠 / 静希草十郎；手动切换或曲目列表可播放专辑中的其他曲目
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