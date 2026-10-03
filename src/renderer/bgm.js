'use strict';

/**
 * 内置 BGM 模块：
 * - 单个全局 <audio>，通过主进程注册的 bgm:// 协议播放 assets/bgm 下的音频
 * - 悬浮胶囊 UI（首页顶部 / 书架左下 / 阅读左下），支持播放暂停、上一首/下一首、音量、静音
 * - 播放规则：自动播完在默认两首（久遠寺有珠 / 静希草十郎）循环；手动切换或列表可选专辑全部曲目
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
  const SETTINGS_SLIDE_MS = 280;
  const state = Object.assign({}, DEFAULT_STATE);
  let audio = null;
  let ui = {};
  let loaded = false;
  let errorSkip = false;
  let currentView = 'home';
  let settingsOpen = false;
  let settingsAnimation = null;
  let restoreHomeClip = () => {};
  const TITLE_GAP = 24;
  const TITLE_SPEED = 22;
  const TITLE_DELAY = 1000;
  let renderedTitle = null;
  let titleAnimation = null;
  let titleDistance = 0;
  let titleFrame = 0;
  let titleMotion;

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

  function stopTitleScroll() {
    if (titleAnimation) titleAnimation.cancel();
    titleAnimation = null;
    titleDistance = 0;
    ui.title.removeAttribute('data-scrolling');
    ui.titleCopy.hidden = true;
  }

  function updateTitlePlayback() {
    if (!titleAnimation) return;
    const paused = document.hidden || ui.title.matches(':hover, :focus-within');
    if (paused) titleAnimation.pause();
    else if (titleAnimation.playState === 'paused') titleAnimation.play();
  }

  function syncTitleScroll() {
    if (!ui.title) return;
    const style = getComputedStyle(ui.root);
    if (currentView !== 'reader' || ui.root.hidden || !ui.title.clientWidth ||
        style.visibility === 'hidden' || titleMotion.matches) {
      stopTitleScroll();
      return;
    }
    // Account for a settings FLIP transform while measuring CSS-pixel text.
    const scale = ui.root.getBoundingClientRect().width / ui.root.offsetWidth || 1;
    const width = ui.titleText.getBoundingClientRect().width / scale;
    if (width <= ui.title.clientWidth + .5) {
      stopTitleScroll();
      return;
    }
    const distance = width + TITLE_GAP;
    if (!titleAnimation || Math.abs(distance - titleDistance) > .1) {
      const previousTime = titleAnimation && titleAnimation.currentTime;
      const previousDuration = titleDistance / TITLE_SPEED * 1000;
      stopTitleScroll();
      ui.titleCopy.hidden = false;
      ui.title.dataset.scrolling = 'true';
      ui.title.tabIndex = 0;
      titleDistance = distance;
      titleAnimation = ui.titleTrack.animate([
        { transform: 'translateX(0)' },
        { transform: `translateX(-${distance}px)` },
      ], { delay: TITLE_DELAY, duration: distance / TITLE_SPEED * 1000, iterations: Infinity, easing: 'linear', fill: 'backwards' });
      titleAnimation.id = 'bgm-title-marquee';
      // Font loading can change the measured length. Preserve the current
      // cycle position instead of restarting the initial delay on a resize.
      if (previousTime != null && previousDuration > 0) {
        titleAnimation.currentTime = previousTime < TITLE_DELAY ? previousTime :
          TITLE_DELAY + ((previousTime - TITLE_DELAY) % previousDuration) / previousDuration * (distance / TITLE_SPEED * 1000);
      }
    }
    updateTitlePlayback();
  }

  function scheduleTitleScroll() {
    if (titleFrame) return;
    titleFrame = requestAnimationFrame(() => { titleFrame = 0; syncTitleScroll(); });
  }

  /** Only a new title rebuilds text; volume/mute/play updates retain its phase. */
  function renderTitle(title) {
    const text = String(title || '');
    if (!ui.title || renderedTitle === text) return;
    stopTitleScroll();
    renderedTitle = text;
    ui.titleText.textContent = text;
    ui.titleCopy.textContent = text;
    scheduleTitleScroll();
  }

  function updateUi() {
    if (!ui.root) return;
    const t = trackById(state.trackId);
    ui.root.dataset.playing = state.on ? '1' : '0';
    ui.root.dataset.muted = state.muted ? '1' : '0';
    renderTitle(t ? t.title : '');
    ui.title.title = t ? (t.title + ' · ' + t.artist) : '';
    ui.play.textContent = state.on ? '⏸' : '▶';
    ui.play.title = state.on ? '暂停' : '播放';
    ui.play.setAttribute('aria-label', ui.play.title);
    ui.mute.textContent = state.muted ? '🔇' : '🔊';
    ui.mute.title = state.muted ? '取消静音' : '静音';
    ui.mute.setAttribute('aria-label', ui.mute.title);
    ui.volume.value = String(Math.round(state.volume * 100));
    ui.cover.classList.toggle('playing', state.on);
    ui.root.title = t ? (t.title + ' · ' + t.artist) : '背景音乐';
    ui.title.setAttribute('aria-label', (t ? t.title + '，' : '') + '打开音乐列表');
    for (const row of ui.playlist.querySelectorAll('[data-track-id]')) {
      const selected = row.dataset.trackId === state.trackId;
      row.setAttribute('aria-current', selected ? 'true' : 'false');
      row.querySelector('.bgm-track-state').textContent = selected ? '当前' : '';
    }
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

  function closePlaylist() {
    if (ui.playlist && ui.playlist.matches(':popover-open')) ui.playlist.hidePopover();
  }

  function positionPlaylist() {
    if (!ui.playlist || !ui.playlist.matches(':popover-open')) return;
    const rect = ui.root.getBoundingClientRect();
    const margin = 16;
    const width = Math.min(420, innerWidth - margin * 2);
    const desiredHeight = Math.min(430, innerHeight - margin * 2);
    const below = innerHeight - rect.bottom - margin - 8;
    const above = rect.top - margin - 8;
    const useBelow = below >= desiredHeight || below >= above;
    const height = Math.min(desiredHeight, Math.max(120, useBelow ? below : above));
    ui.playlist.style.width = `${width}px`;
    ui.playlist.style.maxHeight = `${height}px`;
    ui.playlist.style.left = `${Math.max(margin, Math.min(innerWidth - width - margin, rect.right - width))}px`;
    ui.playlist.style.top = `${Math.max(margin, useBelow ? rect.bottom + 8 : rect.top - height - 8)}px`;
  }

  function togglePlaylist() {
    if (ui.playlist.matches(':popover-open')) { closePlaylist(); return; }
    ui.playlist.showPopover();
    positionPlaylist();
    const current = [...ui.playlist.querySelectorAll('[data-track-id]')].find(row => row.dataset.trackId === state.trackId);
    if (current) {
      current.focus({ preventScroll: true });
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  function buildPlaylist() {
    const panel = document.createElement('section');
    panel.id = 'bgm-playlist';
    panel.className = 'bgm-playlist';
    panel.setAttribute('popover', 'auto');
    panel.setAttribute('aria-label', '音乐列表');
    const header = document.createElement('div');
    header.className = 'bgm-playlist-header';
    const heading = document.createElement('strong');
    heading.textContent = `音乐列表 · ${BGM_TRACKS.length} 首`;
    const close = mkBtn('×', '关闭音乐列表', 'close-playlist');
    close.addEventListener('click', () => { closePlaylist(); ui.title.focus(); });
    header.append(heading, close);
    const list = document.createElement('div');
    list.className = 'bgm-playlist-tracks';
    let disc = 0;
    for (const track of BGM_TRACKS) {
      if (track.disc !== disc) {
        disc = track.disc;
        const label = document.createElement('div');
        label.className = 'bgm-disc-label';
        label.textContent = `Disc ${disc}`;
        list.appendChild(label);
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bgm-track-row';
      row.dataset.trackId = track.id;
      const number = document.createElement('span');
      number.className = 'bgm-track-number';
      number.textContent = String(track.number).padStart(2, '0');
      const info = document.createElement('span');
      info.className = 'bgm-track-info';
      const title = document.createElement('span');
      title.className = 'bgm-track-name';
      title.textContent = track.title;
      const artist = document.createElement('span');
      artist.className = 'bgm-track-artist';
      artist.textContent = track.artist;
      info.append(title, artist);
      const marker = document.createElement('span');
      marker.className = 'bgm-track-state';
      marker.setAttribute('aria-hidden', 'true');
      row.append(number, info, marker);
      row.addEventListener('click', () => {
        state.on = true;
        loadTrack(track.id, true);
        closePlaylist();
        ui.title.focus({ preventScroll: true });
      });
      list.appendChild(row);
    }
    panel.append(header, list);
    panel.addEventListener('toggle', () => ui.title.setAttribute('aria-expanded', String(panel.matches(':popover-open'))));
    panel.addEventListener('keydown', event => {
      const rows = [...list.querySelectorAll('button')];
      const index = rows.indexOf(document.activeElement);
      if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
        (index + (event.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length;
      rows[next].focus();
    });
    return panel;
  }

  function positionBgm(name) {
    if (!ui.root) return;
    closePlaylist();
    currentView = name || 'home';
    ui.root.dataset.view = currentView;
    ui.root.hidden = currentView === 'splash';
    if (settingsOpen && currentView !== 'splash') {
      ui.root.classList.remove('in-topbar');
      if (ui.root.parentElement !== document.body) document.body.appendChild(ui.root);
      scheduleTitleScroll();
      return;
    }
    const topbarSelector = currentView === 'home' ? '#home-bgm-slot' : currentView === 'reader'
      ? '#reader-bgm-slot'
      : (currentView === 'library' ? '#library-view .topbar' : (currentView === 'ai' ? '#ai-view .topbar' : (currentView === 'stats' ? '#stats-view .topbar' : null)));
    const topbar = topbarSelector ? document.querySelector(topbarSelector) : null;
    if (topbar) {
      ui.root.classList.add('in-topbar');
      if (ui.root.parentElement !== topbar) topbar.appendChild(ui.root);
    } else {
      ui.root.classList.remove('in-topbar');
      if (ui.root.parentElement !== document.body) document.body.appendChild(ui.root);
    }
    scheduleTitleScroll();
  }

  function cancelSettingsAnimation() {
    restoreHomeClip();
    restoreHomeClip = () => {};
    if (settingsAnimation) settingsAnimation.cancel();
    settingsAnimation = null;
  }

  function canAnimateSettings() {
    return !!(ui.root && ui.root.animate && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  }

  /** FLIP：从原顶栏坐标平滑移动到抽屉左侧的避让坐标。 */
  function animateSettingsEntry(fromRect) {
    if (!canAnimateSettings() || !fromRect) return;
    const toRect = ui.root.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    settingsAnimation = ui.root.animate([
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${fromRect.width / toRect.width}, ${fromRect.height / toRect.height})`, opacity: 0.95 },
      { transformOrigin: 'top left', transform: 'translateX(0) scale(1)', opacity: 0.96 },
    ], { duration: SETTINGS_SLIDE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    settingsAnimation.id = 'bgm-settings-entry-flip';
  }

  /** FLIP：先恢复顶栏布局，再从旧位置向右滑到新位置。 */
  function animateSettingsRestore(fromRect) {
    if (!canAnimateSettings() || !fromRect) return;
    const toRect = ui.root.getBoundingClientRect();
    // FLIP deltas arrive in viewport pixels; a scaled homepage needs local ones.
    const scale = toRect.width / parseFloat(getComputedStyle(ui.root).width) || 1;
    const dx = (fromRect.left - toRect.left) / scale;
    const dy = (fromRect.top - toRect.top) / scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const finalOpacity = Number.parseFloat(getComputedStyle(ui.root).opacity) || 0.95;
    settingsAnimation = ui.root.animate([
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${fromRect.width / toRect.width}, ${fromRect.height / toRect.height})`, opacity: 0.96 },
      { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1)', opacity: finalOpacity },
    ], { duration: SETTINGS_SLIDE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    settingsAnimation.id = 'bgm-settings-restore-flip';
    // In tall windows the drawer starts outside the centered home canvas.
    // Let this one overlay travel across the margin until it reaches its slot.
    const stage = ui.root.closest('.home-stage');
    if (stage) {
      stage.style.overflow = 'visible';
      restoreHomeClip = () => stage.style.removeProperty('overflow');
      settingsAnimation.onfinish = restoreHomeClip;
    }
  }

  /** 设置抽屉打开时把胶囊移到抽屉左侧，关闭后恢复到当前视图原位。 */
  function setSettingsOpen(open) {
    cancelSettingsAnimation();
    const fromRect = ui.root ? ui.root.getBoundingClientRect() : null;
    settingsOpen = !!open;
    if (!ui.root) return;
    ui.root.dataset.settingsOpen = settingsOpen ? '1' : '0';
    positionBgm(currentView);
    if (settingsOpen) animateSettingsEntry(fromRect);
    else animateSettingsRestore(fromRect);
  }

  function mkBtn(text, tip, action) {
    const b = document.createElement('button');
    b.className = 'bgm-btn';
    b.textContent = text;
    b.title = tip;
    b.dataset.action = action;
    b.setAttribute('aria-label', tip);
    return b;
  }

  function buildCapsule() {
    const root = document.createElement('div');
    root.id = 'bgm-capsule';
    root.className = 'bgm-capsule';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', '阅读音乐');
    root.dataset.view = 'home';
    root.dataset.playing = '0';
    root.dataset.settingsOpen = '0';

    const cover = document.createElement('img');
    cover.className = 'bgm-cover';
    cover.src = 'bgm://local/cover.jpg';
    cover.alt = '专辑封面';
    cover.title = '背景音乐';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'bgm-title-wrap';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'bgm-title';
    title.setAttribute('aria-haspopup', 'true');
    title.setAttribute('aria-controls', 'bgm-playlist');
    title.setAttribute('aria-expanded', 'false');
    const titleTrack = document.createElement('span');
    titleTrack.className = 'bgm-title-track';
    const titleText = document.createElement('span');
    titleText.className = 'bgm-title-text';
    const titleCopy = document.createElement('span');
    titleCopy.className = 'bgm-title-copy';
    titleCopy.hidden = true;
    titleCopy.setAttribute('aria-hidden', 'true');
    titleTrack.append(titleText, titleCopy);
    title.appendChild(titleTrack);
    titleWrap.appendChild(title);

    const prev = mkBtn('⏮', '上一首', 'prev');
    const play = mkBtn('▶', '播放', 'play');
    const nxt = mkBtn('⏭', '下一首', 'next');
    const mute = mkBtn('🔊', '静音', 'mute');

    const volume = document.createElement('input');
    volume.className = 'bgm-volume';
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.step = '1';
    volume.title = '音量';
    volume.setAttribute('aria-label', '音量');

    const playlist = buildPlaylist();
    root.append(cover, titleWrap, prev, play, nxt, mute, volume, playlist);

    cover.addEventListener('click', toggle);
    title.addEventListener('click', togglePlaylist);
    prev.addEventListener('click', () => next(-1));
    play.addEventListener('click', toggle);
    nxt.addEventListener('click', () => next(1));
    mute.addEventListener('click', toggleMute);
    volume.addEventListener('input', () => setVolume(parseInt(volume.value, 10) / 100));

    ui = { root, cover, title, titleWrap, titleTrack, titleText, titleCopy, prev, play, nxt, mute, volume, playlist };
    document.body.appendChild(root);
    titleMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    titleMotion.addEventListener('change', syncTitleScroll);
    const titleObserver = new ResizeObserver(scheduleTitleScroll);
    titleObserver.observe(title);
    titleObserver.observe(titleText);
    window.addEventListener('resize', positionPlaylist);
    document.fonts.ready.then(scheduleTitleScroll);
    document.fonts.addEventListener('loadingdone', scheduleTitleScroll);
    for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) title.addEventListener(event, () => {
      updateTitlePlayback();
      queueMicrotask(updateTitlePlayback);
      // Focus pseudo-classes can settle after focusout dispatch; recheck next
      // frame so returning from the playlist cannot leave the title paused.
      scheduleTitleScroll();
    });
    document.addEventListener('visibilitychange', () => {
      updateTitlePlayback();
      if (!document.hidden) scheduleTitleScroll();
    });
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
    applyVolume();
    loadTrack(state.trackId, state.on);
    updateUi();
  }

  function marqueeInfo() {
    if (!ui.title) return null;
    return {
      charCount: Array.from(renderedTitle || '').length,
      on: state.on,
      track: state.trackId,
      text: renderedTitle,
      textLen: (renderedTitle || '').length,
      wrapW: ui.titleWrap ? ui.titleWrap.clientWidth : 0,
      scrollW: ui.titleText.offsetWidth,
      animName: titleAnimation ? titleAnimation.id : 'none',
      transform: getComputedStyle(ui.titleTrack).transform,
      playState: titleAnimation ? titleAnimation.playState : 'idle',
      currentTime: titleAnimation ? titleAnimation.currentTime : null,
      distance: titleDistance,
      duration: titleDistance / TITLE_SPEED * 1000,
      delay: TITLE_DELAY,
      playingAttr: ui.root ? ui.root.dataset.playing : '',
    };
  }

  return {
    initBgm,
    positionBgm,
    setSettingsOpen,
    toggle,
    next,
    setVolume,
    marqueeInfo,
    getState: () => Object.assign({}, state),
    getTracks: () => BGM_TRACKS.slice(),
  };
});
