'use strict';

/**
 * 内置 BGM 模块：
 * - 单个全局 <audio>，通过主进程注册的 bgm:// 协议播放 assets/bgm 下的 MP3
 * - 悬浮胶囊 UI（首页顶部 / 书架左下 / 阅读左下），支持播放暂停、上一首/下一首、音量、静音
 * - 播放规则：自动播完只在默认两首（久遠寺有珠 / 静希草十郎）循环；手动切换遍历全部 4 首
 * - 状态持久化到 bgm 键（音量/静音/当前曲目/开关）
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../shared/bgm'));
  } else {
    root.GaiaBgm = factory(root.GaiaBgm);
  }
})(typeof self !== 'undefined' ? self : this, function (shared) {
  'use strict';

  const { BGM_TRACKS, trackById, nextAutoTrack, nextManualTrack, clampVolume } = shared;

  const DEFAULT_STATE = { volume: 0.5, muted: false, trackId: 'alice', on: true };
  const state = Object.assign({}, DEFAULT_STATE);
  let audio = null;
  let ui = {};
  let loaded = false;
  let errorSkip = false;

  function srcFor(track) {
    return 'bgm://local/' + encodeURIComponent(track.file);
  }

  function save() {
    window.api.stateSet('bgm', {
      volume: state.volume,
      muted: state.muted,
      trackId: state.trackId,
      on: state.on,
    });
  }

  function updateUi() {
    if (!ui.root) return;
    const t = trackById(state.trackId);
    ui.root.dataset.playing = state.on ? '1' : '0';
    ui.title.textContent = t ? t.title : '';
    const wrapW = ui.titleWrap ? ui.titleWrap.clientWidth : 0;
    const overflows = ui.title.scrollWidth > wrapW + 1;
    if (state.on && overflows) ui.title.textContent = (t ? t.title : '') + (t ? t.title : '');
    ui.title.title = t ? (t.title + ' · ' + t.artist) : '';
    ui.play.textContent = state.on ? '⏸' : '▶';
    ui.play.title = state.on ? '暂停' : '播放';
    ui.mute.textContent = state.muted ? '🔇' : '🔊';
    ui.mute.title = state.muted ? '取消静音' : '静音';
    ui.volume.value = String(Math.round(state.volume * 100));
    ui.cover.classList.toggle('playing', state.on);
    ui.root.title = t ? (t.title + ' · ' + t.artist) : '背景音乐';
  }

  function applyVolume() {
    if (audio) audio.volume = state.muted ? 0 : state.volume;
  }

  function loadTrack(id, autoplay) {
    const t = trackById(id);
    if (!t) return;
    state.trackId = t.id;
    errorSkip = false;
    if (audio) {
      audio.src = srcFor(t);
      if (autoplay && state.on) {
        const p = audio.play();
        if (p && p.catch) p.catch(() => {});
      }
    }
    updateUi();
    save();
  }

  function toggle() {
    state.on = !state.on;
    if (state.on) {
      errorSkip = false;
      const p = audio && audio.play();
      if (p && p.catch) p.catch(() => {});
    } else if (audio) {
      audio.pause();
    }
    updateUi();
    save();
  }

  function next(dir) {
    loadTrack(nextManualTrack(state.trackId, dir == null ? 1 : dir), true);
  }

  function setVolume(v) {
    state.volume = clampVolume(v);
    state.muted = false;
    applyVolume();
    updateUi();
    save();
  }

  function toggleMute() {
    state.muted = !state.muted;
    applyVolume();
    updateUi();
    save();
  }

  function positionBgm(name) {
    if (!ui.root) return;
    ui.root.dataset.view = name || 'home';
    ui.root.hidden = name === 'splash';
    const topbar = document.querySelector('#reader-view .topbar');
    if (name === 'reader' && topbar) {
      ui.root.classList.add('in-topbar');
      if (ui.root.parentElement !== topbar) topbar.appendChild(ui.root);
    } else {
      ui.root.classList.remove('in-topbar');
      if (ui.root.parentElement !== document.body) document.body.appendChild(ui.root);
    }
  }

  function mkBtn(text, tip) {
    const b = document.createElement('button');
    b.className = 'bgm-btn';
    b.textContent = text;
    b.title = tip;
    return b;
  }

  function buildCapsule() {
    const root = document.createElement('div');
    root.id = 'bgm-capsule';
    root.className = 'bgm-capsule';
    root.dataset.view = 'home';
    root.dataset.playing = '0';

    const cover = document.createElement('img');
    cover.className = 'bgm-cover';
    cover.src = 'bgm://local/cover.jpg';
    cover.alt = '专辑封面';
    cover.title = '背景音乐';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'bgm-title-wrap';
    const title = document.createElement('span');
    title.className = 'bgm-title';
    titleWrap.appendChild(title);

    const prev = mkBtn('⏮', '上一首');
    const play = mkBtn('▶', '播放');
    const nxt = mkBtn('⏭', '下一首');
    const mute = mkBtn('🔊', '静音');

    const volume = document.createElement('input');
    volume.className = 'bgm-volume';
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.step = '1';
    volume.title = '音量';

    root.append(cover, titleWrap, prev, play, nxt, mute, volume);

    cover.addEventListener('click', toggle);
    prev.addEventListener('click', () => next(-1));
    play.addEventListener('click', toggle);
    nxt.addEventListener('click', () => next(1));
    mute.addEventListener('click', toggleMute);
    volume.addEventListener('input', () => setVolume(parseInt(volume.value, 10) / 100));

    ui = { root, cover, title, titleWrap, prev, play, nxt, mute, volume };
    document.body.appendChild(root);
  }

  async function initBgm() {
    if (loaded) return;
    loaded = true;
    buildCapsule();

    audio = new Audio();
    audio.preload = 'auto';
    applyVolume();
    audio.addEventListener('ended', () => {
      loadTrack(nextAutoTrack(state.trackId), true);
    });
    audio.addEventListener('loadeddata', () => {
      errorSkip = false;
    });
    audio.addEventListener('error', () => {
      if (errorSkip) return;
      errorSkip = true;
      loadTrack(nextAutoTrack(state.trackId), true);
    });

    const saved = await window.api.stateGet('bgm');
    if (saved && typeof saved === 'object') {
      state.volume = clampVolume(saved.volume != null ? saved.volume : 0.5);
      state.muted = !!saved.muted;
      state.on = saved.on !== false;
      state.trackId = trackById(saved.trackId) ? saved.trackId : 'alice';
    }
    loadTrack(state.trackId, state.on);
    updateUi();
  }

  return {
    initBgm,
    positionBgm,
    toggle,
    next,
    setVolume,
    getState: () => Object.assign({}, state),
    getTracks: () => BGM_TRACKS.slice(),
  };
});