'use strict';

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { addBookmark: addBookmarkToMap, removeBookmark: removeBookmarkFromMap, renameBookmark: renameBookmarkFromMap } = window.GaiaBookmarks;
const {
  removeBook: removeBookFromLibrary,
  removeBooks: removeBooksFromLibrary,
  removeEntry: removeEntryFromMap,
  removeEntries: removeEntriesFromMap,
} = window.GaiaLibrary;
const { paragraphsToHtml } = window.GaiaTxtHtml;
const { splitTxtParagraphs, detectTxtChapters, chapterTitleForParagraph } = window.GaiaTxtChapters;
const { epubDisplayPercent } = window.GaiaEpubProgress;
const { normalizeWheelDelta, createWheelGate } = window.GaiaReaderInput;
const readerWheelGate = createWheelGate({ threshold: 60, cooldown: 250 });

const FONTS = {
  default: '',
  song: '"SimSun", "Songti SC", serif',
  kai: '"KaiTi", "STKaiti", serif',
  hei: '"Microsoft YaHei", "SimHei", sans-serif',
  yuan: '"Microsoft YaHei UI", "YouYuan", serif',
};

const els = {
  bookshelf: $('bookshelf'),
  hint: $('library-hint'),
  readerTitle: $('reader-title'),
  readerContent: $('reader-content'),
  readerStatus: $('reader-status'),
  tocPanel: $('toc-panel'),
  bookmarksPanel: $('bookmarks-panel'),
  pageNav: $('page-nav'),
  manageBar: $('manage-bar'),
  manageCount: $('manage-count'),
  contextMenu: $('context-menu'),
  settingsOverlay: $('settings-overlay'),
  settingsDrawer: $('settings-drawer'),
  drawerReading: $('drawer-reading'),
  drawerFuncs: $('drawer-funcs'),
  fontValue: $('font-value'),
  lineHeightValue: $('line-height-value'),
  marginValue: $('margin-value'),
  drawerSpread: $('drawer-spread'),
  spreadValue: $('spread-value'),
  themeValue: $('theme-value'),
  progressFill: $('progress-fill'),
  fontSelect: $('font-select'),
};

const views = {
  splash: $('splash-view'),
  home: $('home-view'),
  library: $('library-view'),
  reader: $('reader-view'),
};

const state = {
  library: [],
  progress: {},
  bookmarks: {},
  current: null,
  manageMode: false,
  selected: new Set(),
  ctxBook: null,
  fontSize: 100,
  lineHeight: 1.8,
  txtFont: 16,
  readMode: 'single',
  prefs: { theme: 'light', fontName: 'default', fontSize: 100, txtFont: 16, lineHeight: 1.8, marginPct: 8, readMode: 'single' },
  homeReady: null,
  resolveHome: null,
};

state.homeReady = new Promise((resolve) => {
  state.resolveHome = resolve;
});

let lastProgressSave = {};
let lastTxtSave = 0;

function toUint8Array(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function saveLibrary() {
  return window.api.stateSet('library', state.library);
}

function saveBookmarksNow() {
  return window.api.stateSet('bookmarks', state.bookmarks);
}

function saveProgress(pathKey, value) {
  state.progress[pathKey] = Object.assign({}, state.progress[pathKey], value, { updatedAt: Date.now() });
  const now = Date.now();
  if (now - (lastProgressSave[pathKey] || 0) > 600) {
    lastProgressSave[pathKey] = now;
    window.api.stateSet('progress', state.progress);
  }
}

function showView(name) {
  for (const key of Object.keys(views)) {
    views[key].hidden = key !== name;
  }
  const el = views[name];
  el.classList.remove('view-fade');
  void el.offsetWidth;
  el.classList.add('view-fade');
  const fxCanvas = $('fx-canvas');
  fxCanvas.hidden = !(name === 'home' || name === 'library');
  if (name !== 'home' && name !== 'library') clearFx();
  if (window.GaiaBgm && window.GaiaBgm.positionBgm) window.GaiaBgm.positionBgm(name);
  window.GaiaPet.init();
}

function finishSplash() {
  const splash = views.splash;
  splash.classList.add('fade-out');
  setTimeout(() => {
    splash.hidden = true;
    splash.classList.remove('fade-out');
    showView('home');
    if (state.resolveHome) state.resolveHome();
  }, 450);
}

function migrateHabitsFromLastBook() {
  if (state.prefs.fontSize != null && state.prefs.lineHeight != null) return;
  const entries = Object.keys(state.progress)
    .map((k) => state.progress[k])
    .filter((e) => e && e.settings)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const last = entries[0] && entries[0].settings;
  if (!last) return;
  for (const k of ['theme', 'fontName', 'fontSize', 'txtFont', 'lineHeight', 'marginPct', 'readMode']) {
    if (state.prefs[k] == null && last[k] != null) state.prefs[k] = last[k];
  }
}

async function init() {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const [lib, progress, bookmarks, prefs] = await Promise.all([
    window.api.stateGet('library'),
    window.api.stateGet('progress'),
    window.api.stateGet('bookmarks'),
    window.api.stateGet('prefs'),
  ]);
  state.library = lib || [];
  state.progress = progress || {};
  state.bookmarks = bookmarks || {};
  state.prefs = Object.assign({ theme: 'light', fontName: 'default', fontSize: 100, txtFont: 16, lineHeight: 1.8, marginPct: 8, readMode: 'single' }, prefs || {});
  if (prefs && prefs.dark === true && !state.prefs.theme) state.prefs.theme = 'dark';
  migrateHabitsFromLastBook();
  state.fontSize = state.prefs.fontSize != null ? state.prefs.fontSize : 100;
  state.txtFont = state.prefs.txtFont != null ? state.prefs.txtFont : 16;
  state.lineHeight = state.prefs.lineHeight != null ? state.prefs.lineHeight : 1.8;
  state.readMode = state.prefs.readMode === 'spread' ? 'spread' : 'single';
  applyThemeClass();
  els.fontSelect.value = state.prefs.fontName || 'default';
  initFx();
  window.GaiaBgm.initBgm();
  window.GaiaBgm.positionBgm('home');

  const alive = [];
  for (const book of state.library) {
    if (await window.api.exists(book.path)) alive.push(book);
  }
  if (alive.length !== state.library.length) {
    state.library = alive;
    await saveLibrary();
  }
  renderLibrary();
  bindEvents();
  await delay(2000);
  finishSplash();
}

function sortLibrary() {
  return state.library.slice().sort((a, b) => {
    const ta = state.progress[a.path] ? state.progress[a.path].updatedAt || 0 : 0;
    const tb = state.progress[b.path] ? state.progress[b.path].updatedAt || 0 : 0;
    return tb - ta;
  });
}

function renderLibrary() {
  els.bookshelf.innerHTML = '';
  els.hint.hidden = state.library.length > 0;
  const sorted = sortLibrary();
  for (const book of sorted) {
    const card = document.createElement('div');
    card.className = 'book-card' + (state.selected.has(book.path) ? ' selected' : '');
    card.dataset.path = book.path;
    card.title = book.path;

    const check = document.createElement('div');
    check.className = 'book-check';
    check.textContent = '\u2713';
    card.appendChild(check);

    if (book.cover) {
      const img = document.createElement('img');
      img.className = 'book-cover';
      img.src = book.cover;
      img.alt = book.title;
      card.appendChild(img);
    } else {
      const div = document.createElement('div');
      div.className = 'book-cover';
      div.textContent = book.format.toUpperCase();
      card.appendChild(div);
    }

    const title = document.createElement('div');
    title.className = 'book-title';
    title.textContent = book.title || '(未命名)';
    card.appendChild(title);

    const author = document.createElement('div');
    author.className = 'book-author';
    author.textContent = book.author || '未知作者';
    card.appendChild(author);

    const badge = document.createElement('span');
    badge.className = 'book-format';
    badge.textContent = book.format;
    card.appendChild(badge);

    const prog = state.progress[book.path];
    if (prog && (prog.percent != null || prog.page)) {
      const prow = document.createElement('div');
      prow.className = 'book-progress';
      const track = document.createElement('div');
      track.className = 'book-progress-track';
      const fill = document.createElement('div');
      fill.className = 'book-progress-fill';
      const pct = prog.percent != null ? prog.percent : 0;
      fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
      track.appendChild(fill);
      prow.appendChild(track);
      const label = document.createElement('span');
      label.className = 'book-progress-label';
      label.textContent = Math.round(pct) + '%';
      prow.appendChild(label);
      card.appendChild(prow);
    }

    card.addEventListener('click', () => {
      if (state.manageMode) toggleSelect(book.path);
      else openBook(book);
    });
    els.bookshelf.appendChild(card);
  }
}

async function addToLibrary(meta) {
  if (state.library.some((b) => b.path === meta.path)) return;
  state.library.push(meta);
  await saveLibrary();
  renderLibrary();
}

async function importPaths(paths) {
  const existing = new Set(state.library.map((b) => b.path));
  let added = 0;
  for (const p of paths) {
    if (existing.has(p)) continue;
    const meta = await window.api.metadata(p);
    state.library.push(meta);
    existing.add(p);
    added += 1;
  }
  if (added) {
    await saveLibrary();
    renderLibrary();
  }
}

async function removeFromShelf(book, silent) {
  if (!silent && !window.confirm('确定从书架移除《' + (book.title || book.path) + '》吗？\n只从书架移除，不会删除电脑上的原文件。')) {
    return false;
  }
  state.library = removeBookFromLibrary(state.library, book.path);
  state.progress = removeEntryFromMap(state.progress, book.path);
  state.bookmarks = removeEntryFromMap(state.bookmarks, book.path);
  state.selected.delete(book.path);
  await Promise.all([
    saveLibrary(),
    window.api.stateSet('progress', state.progress),
    saveBookmarksNow(),
  ]);
  renderLibrary();
  return true;
}

function enterManageMode() {
  state.manageMode = true;
  state.selected.clear();
  els.manageBar.hidden = false;
  $('btn-manage').textContent = '完成管理';
  renderLibrary();
}

function exitManageMode() {
  state.manageMode = false;
  state.selected.clear();
  els.manageBar.hidden = true;
  $('btn-manage').textContent = '批量管理';
  renderLibrary();
}

function toggleManageMode() {
  if (state.manageMode) exitManageMode();
  else enterManageMode();
}

function toggleSelect(pathKey) {
  if (state.selected.has(pathKey)) state.selected.delete(pathKey);
  else state.selected.add(pathKey);
  updateManageUI();
}

function selectAll() {
  for (const b of state.library) state.selected.add(b.path);
  updateManageUI();
}

function updateManageUI() {
  els.manageCount.textContent = String(state.selected.size);
  for (const card of els.bookshelf.querySelectorAll('.book-card')) {
    card.classList.toggle('selected', state.selected.has(card.dataset.path));
  }
}

async function batchRemoveSelected(silent) {
  const paths = Array.from(state.selected);
  if (!paths.length) return false;
  const names = paths
    .map((p) => {
      const b = state.library.find((x) => x.path === p);
      return b ? b.title || p : p;
    })
    .join('、');
  if (!silent && !window.confirm('确定从书架移除选中的 ' + paths.length + ' 本书吗？\n只从书架移除，不会删除电脑上的原文件。\n' + names)) {
    return false;
  }
  state.library = removeBooksFromLibrary(state.library, paths);
  state.progress = removeEntriesFromMap(state.progress, paths);
  state.bookmarks = removeEntriesFromMap(state.bookmarks, paths);
  state.selected.clear();
  await Promise.all([
    saveLibrary(),
    window.api.stateSet('progress', state.progress),
    saveBookmarksNow(),
  ]);
  if (!state.library.length) exitManageMode();
  else renderLibrary();
  return true;
}

function showContextMenu(x, y, book) {
  state.ctxBook = book;
  const menu = els.contextMenu;
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 160)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 90)) + 'px';
  menu.hidden = false;
}

function hideContextMenu() {
  els.contextMenu.hidden = true;
  state.ctxBook = null;
}

function openSettings() {
  const inReader = state.current != null;
  els.drawerReading.hidden = !inReader;
  els.drawerFuncs.hidden = !inReader;
  els.drawerSpread.hidden = !inReader;
  if (inReader) updateSettingsValues();
  els.settingsOverlay.hidden = false;
}

function closeSettings() {
  els.settingsOverlay.hidden = true;
}

function isSettingsOpen() {
  return !els.settingsOverlay.hidden;
}

function updateSettingsValues() {
  const c = state.current;
  els.fontValue.textContent = c && c.format === 'pdf' ? Math.round((c.zoom || 1) * 100) + '%' : (c && c.paginator ? state.fontSize + '%' : state.fontSize + '%');
  els.lineHeightValue.textContent = state.lineHeight.toFixed(1);
  els.marginValue.textContent = (state.prefs.marginPct != null ? state.prefs.marginPct : 8) + '%';
  els.spreadValue.textContent = state.readMode === 'spread' ? '双页' : '单页';
}

function closeReaderContent() {
  const c = state.current;
  if (c) {
    if (c.rendition) { try { c.rendition.destroy(); } catch (e) {} }
    if (c.pdf) { try { c.pdf.destroy(); } catch (e) {} }
    if (c.paginator) { try { c.paginator.destroy(); } catch (e) {} }
    if (c.mobiSession) { try { window.api.mobiClose(c.mobiSession); } catch (e) {} }
  }
  els.readerContent.innerHTML = '';
  els.pageNav.hidden = true;
  state.current = null;
}

async function backToLibrary() {
  if (state.current) {
    const c = state.current;
    if (c.format === 'pdf') saveProgress(c.path, { page: c.page });
    if (c.paginator) updateMobiProgress(true);
    await window.api.stateSet('progress', state.progress);
    closeReaderContent();
  }
  showView('library');
  renderLibrary();
}

async function openBook(book) {
  if (state.manageMode) exitManageMode();
  closeSettings();
  closeReaderContent();
  readerWheelGate.reset();
  showView('reader');
  els.readerTitle.textContent = book.title || book.path;
  els.tocPanel.hidden = true;
  els.bookmarksPanel.hidden = true;
  els.tocPanel.innerHTML = '';
  els.readerStatus.textContent = '加载中…';
  els.pageNav.hidden = false;
  state.current = { path: book.path, format: book.format };
  applyGlobalHabits();
  const savedProg = state.progress[book.path];
  if (savedProg && savedProg.percent != null) {
    updateProgress(savedProg.percent, '进度 ' + savedProg.percent.toFixed(2) + '%');
  }
  renderBookmarksPanel();
  try {
    if (book.format === 'epub') await openEpub(book);
    else if (book.format === 'pdf') await openPdf(book);
    else if (book.format === 'mobi' || book.format === 'azw3') await openMobi(book);
    else await openTxt(book);
  } catch (err) {
    console.error(err);
    els.readerStatus.textContent = '打开失败：' + err.message;
  }
}

async function openEpub(book) {
    const res = await window.api.readBook(book.path);
  const buf = toArrayBuffer(toUint8Array(res.data));
  const epub = window.ePub(buf);
  state.current.epub = epub;
  const rendition = epub.renderTo('reader-content', { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
  state.current.rendition = rendition;
  rendition.hooks.content.register((contents) => {
    applyReaderStyles(contents);
    bindReaderKeyboard(contents.document || contents.window);
  });
  rendition.on('rendered', () => bindEpubWheel());

  applyEpubTypography();
  const saved = state.progress[book.path];
  state.current.displayPercent = saved && saved.percent != null ? saved.percent : 0;
  state.current.locationsDone = false;
  updateProgress(state.current.displayPercent, '进度 ' + state.current.displayPercent.toFixed(2) + '%');
  await rendition.display(saved && saved.loc ? saved.loc : undefined);
  bindEpubWheel();
  if (state.readMode === 'spread') {
    try { rendition.spread('auto', 700); } catch (e) {}
  }

  rendition.on('relocated', (location) => {
    const cfi = location.start.cfi;
    const items = state.current.epub && state.current.epub.spine ? state.current.epub.spine.spineItems : [];
    const locs = state.current.epub && state.current.epub.locations;
    const locTotal = locs && locs.total ? locs.total : 0;
    const percent = epubDisplayPercent(location, items, locTotal);
    state.current.displayPercent = percent;
    updateProgress(percent, '进度 ' + percent.toFixed(2) + '%');
    saveProgress(book.path, { loc: cfi, percent });
  });

  const locationsReady = epub.locations
    .generate(1600)
    .then(() => {
      state.current.locationsDone = true;
      try {
        const loc = rendition.currentLocation();
        const items = state.current.epub && state.current.epub.spine ? state.current.epub.spine.spineItems : [];
        const locTotal = epub.locations.total || 0;
        if (loc && loc.start) {
          const percent = epubDisplayPercent(loc, items, locTotal);
          state.current.displayPercent = percent;
          updateProgress(percent, '进度 ' + percent.toFixed(2) + '%');
          saveProgress(book.path, { loc: loc.start.cfi, percent });
        }
      } catch (e) {
        // 位置刷新失败不阻塞
      }
      return true;
    })
    .catch(() => false);
  state.current.locationsReady = Promise.race([
    locationsReady,
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);

  const nav = await epub.loaded.navigation;
  const renderToc = (items, depth) => {
    for (const item of items) {
      if (!item.href) continue;
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = '\u3000'.repeat(depth) + (item.label || '').trim();
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        rendition.display(item.href);
      });
      els.tocPanel.appendChild(a);
      if (item.subitems && item.subitems.length) renderToc(item.subitems, depth + 1);
    }
  };
  renderToc(nav.toc || [], 0);
  if (!els.tocPanel.children.length) els.tocPanel.textContent = '（本书没有目录）';
}

function resizeEpubRendition() {
  const c = state.current;
  if (c && c.rendition && typeof c.rendition.resize === 'function') {
    try {
      c.rendition.resize();
    } catch (e) {
      console.error(e);
    }
  }
}

function animatePage(direction) {
  const el = els.readerContent;
  el.classList.remove('paging-next', 'paging-prev');
  void el.offsetWidth;
  el.classList.add(direction === 'next' ? 'paging-next' : 'paging-prev');
}

function toggleSpread() {
  state.readMode = state.readMode === 'spread' ? 'single' : 'spread';
  const c = state.current;
  if (c) {
    if (c.format === 'epub' && c.rendition) {
      c.rendition.spread(state.readMode === 'spread' ? 'auto' : 'none', 700);
    } else if (c.paginator) {
      c.paginator.setMode(state.readMode);
      updateMobiProgress(true);
    }
  }
  if (isSettingsOpen()) updateSettingsValues();
  rememberSettings();
}

function applyEpubTypography() {
  const c = state.current;
  if (!c || !c.rendition) return;
  c.rendition.themes.fontSize(state.fontSize + '%');
  c.rendition.themes.default({ body: { 'line-height': String(state.lineHeight) } });
}

async function openPdf(book) {
  const res = await window.api.readBook(book.path);
  const data = toUint8Array(res.data);
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  state.current.pdf = pdf;
  state.current.page = 1;
  state.current.pages = pdf.numPages;
  state.current.zoom = 1;
  const pdfSettings = state.progress[book.path] && state.progress[book.path].settings;
  if (pdfSettings && pdfSettings.zoom) state.current.zoom = pdfSettings.zoom;
  const saved = state.progress[book.path];
  if (saved && saved.page >= 1 && saved.page <= pdf.numPages) state.current.page = saved.page;
  await renderPdfPage();
}

async function renderPdfPage() {
  const c = state.current;
  const page = await c.pdf.getPage(c.page);
  const base = page.getViewport({ scale: 1 });
  const target = Math.max(320, els.readerContent.clientWidth - 32);
  const scale = (target / base.width) * c.zoom;
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  const wrap = document.createElement('div');
  wrap.className = 'pdf-page';
  wrap.style.width = Math.floor(viewport.width) + 'px';
  wrap.style.height = Math.floor(viewport.height) + 'px';

  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-canvas-base';
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';
  els.readerContent.innerHTML = '';
  els.readerContent.classList.toggle('pdf-dark', state.prefs.theme === 'dark');
  wrap.appendChild(canvas);
  els.readerContent.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  if (state.prefs.theme === 'dark') {
    const overlay = await buildPdfImageOverlay(page, viewport, dpr);
    if (overlay) wrap.appendChild(overlay);
  }

  updateProgress((c.page / c.pages) * 100, '第 ' + c.page + ' / ' + c.pages + ' 页');
  saveProgress(c.path, { page: c.page, percent: (c.page / c.pages) * 100 });
}

async function openMobi(book) {
  const res = await window.api.mobiOpen(book.path);
  state.current.mobiSession = res.sessionId;
  state.current.mobi = {
    chapters: res.chapters || [],
    toc: res.toc || [],
  };
  state.current.flow = new window.GaiaFlow({ totalChapters: Math.max(1, (res.chapters || []).length) });
  state.current.paginator = new window.GaiaPaginator(els.readerContent, { pageWidth: 640, gap: 48 });
  state.current.paginator.onChange = () => updateMobiProgress(false);
  state.current.paginator.onTotalChange = (total) => {
    if (state.current && state.current.flow) state.current.flow.setPages(state.current.flow.chapter, total);
  };
  state.current.paginator.setTheme(state.prefs.theme);
  state.current.paginator.setMargin(state.prefs.marginPct != null ? state.prefs.marginPct : 8);
  const saved = state.progress[book.path];
  let startChapter = 0;
  let startPage = 0;
  if (saved) {
    if (typeof saved.mobiChapter === 'number') startChapter = saved.mobiChapter;
    else if (typeof saved.mobiIndex === 'number') startChapter = saved.mobiIndex;
    if (typeof saved.mobiPage === 'number') startPage = saved.mobiPage;
  }
  state.current.flow.gotoChapter(startChapter);
  await loadMobiChapter(startChapter, { page: startPage });
  renderMobiToc();
}

async function loadMobiChapter(chapterIndex, opts) {
  const c = state.current;
  if (!c || !c.mobiSession) return;
  const chapters = c.mobi.chapters;
  const clamped = Math.max(0, Math.min(chapters.length - 1, chapterIndex));
  opts = opts || {};
  els.readerStatus.textContent = '加载中…';
  try {
    const ch = await window.api.mobiChapter(c.mobiSession, clamped);
    let html = ch.html || '';
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) html = bodyMatch[1];
    if (c.paginator) {
      if (c.flow) c.flow.gotoChapter(clamped);
      await c.paginator.render(html, ch.cssText || '');
      bindReaderInputs(c.paginator.doc);
      const total = c.paginator.totalPages || 1;
      if (c.flow) c.flow.setPages(clamped, total);
      c.paginator.setMode(state.readMode === 'spread' ? 'spread' : 'single');
      const p = opts.page === 'end' ? total - 1 : (typeof opts.page === 'number' ? opts.page : 0);
      c.paginator.showPage(p);
      if (c.flow) c.flow.page = Math.min(Math.max(0, p), total - 1);
      updateMobiProgress(true);
    }
  } catch (err) {
    console.error(err);
    els.readerStatus.textContent = '章节加载失败：' + err.message;
  }
}

function applyMobiTypography() {
  const c = state.current;
  if (c && c.paginator) {
    c.paginator.setTypography({
      fontSizePct: c.format === 'txt' ? (state.txtFont / 16) * 100 : state.fontSize,
      lineHeight: state.lineHeight,
      fontFamily: FONTS[state.fontName] || '',
    });
  }
}

function applyMobiTheme() {
  const c = state.current;
  if (c && c.paginator) c.paginator.setTheme(state.prefs.theme);
}

let lastMobiSave = 0;
function updateMobiProgress(force) {
  const c = state.current;
  if (!c || !c.paginator) return;
  let percent;
  let text;
  const chapters = c.mobi ? c.mobi.chapters : null;
  percent = c.flow ? c.flow.percent() : c.paginator.pagePercent();
  const total = c.paginator ? c.paginator.totalPages : 0;
  const cur = c.paginator ? c.paginator.currentPage + 1 : 0;
  if (chapters && chapters.length > 1) {
    text = '进度 ' + percent.toFixed(2) + '% · 第 ' + (c.flow ? c.flow.chapter + 1 : 1) + ' 节 ' + cur + ' / ' + total + ' 页';
  } else if (total > 0) {
    text = '进度 ' + percent.toFixed(2) + '% · 第 ' + cur + ' / ' + total + ' 页';
  } else {
    text = '进度 ' + percent.toFixed(2) + '%';
  }
  updateProgress(percent, text);
  const now = Date.now();
  if (force || now - lastMobiSave > 600) {
    lastMobiSave = now;
    const saved = { percent };
    const isMobi = c.format === 'mobi' || c.format === 'azw3';
    if (isMobi) {
      if (c.flow) saved.mobiChapter = c.flow.chapter;
      saved.mobiPage = c.paginator.currentPage;
      if (c.flow) saved.mobiIndex = c.flow.chapter;
    } else {
      saved.page = c.paginator.currentPage;
    }
    saveProgress(c.path, saved);
  }
}
function renderMobiToc() {
  const c = state.current;
  els.tocPanel.innerHTML = '';
  if (!c || !c.mobi || !c.mobi.toc.length) {
    els.tocPanel.textContent = '（本书没有目录）';
    return;
  }
  const renderItems = (items, depth) => {
    for (const item of items) {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = '\\u3000'.repeat(depth) + (item.label || '').trim();
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (typeof item.index === 'number' && item.index >= 0) loadMobiChapter(item.index, { page: 0 });
      });
      els.tocPanel.appendChild(a);
      if (item.children && item.children.length) renderItems(item.children, depth + 1);
    }
  };
  renderItems(c.mobi.toc, 0);
}


async function openTxt(book) {
  const res = await window.api.readBook(book.path);
  state.current.flow = new window.GaiaFlow({ totalChapters: 1 });
  state.current.paginator = new window.GaiaPaginator(els.readerContent, { pageWidth: 640, gap: 48 });
  state.current.paginator.onChange = () => updateMobiProgress(false);
  state.current.paginator.onTotalChange = (total) => {
    if (state.current && state.current.flow) state.current.flow.setPages(0, total);
  };
  state.current.paginator.setTheme(state.prefs.theme);
  state.current.paginator.setMargin(state.prefs.marginPct != null ? state.prefs.marginPct : 8);
  const paragraphs = splitTxtParagraphs(res.text);
  state.current.txtChapters = detectTxtChapters(paragraphs);
  const html = paragraphsToHtml(res.text) || '<p></p>';
  await state.current.paginator.render(html, '');
  bindReaderInputs(state.current.paginator.doc);
  if (state.current.flow) state.current.flow.setPages(0, state.current.paginator.totalPages || 1);
  state.current.paginator.setMode(state.readMode === 'spread' ? 'spread' : 'single');
  const saved = state.progress[book.path];
  if (saved && typeof saved.page === 'number') state.current.paginator.showPage(saved.page);
  updateMobiProgress(true);
}


function updateTxtProgress(force) {
  updateMobiProgress(force);
}

function applyTxtTypography() {
  applyMobiTypography();
}

function nextPage() {
  const c = state.current;
  if (!c) return;
  if (c.format === 'epub') {
    if (c.rendition) { animatePage('next'); c.rendition.next(); }
  } else if (c.format === 'pdf') {
    if (c.page < c.pages) { c.page += 1; animatePage('next'); renderPdfPage(); }
  } else if (c.paginator) {
    const step = state.readMode === 'spread' ? 2 : 1;
    const moved = c.paginator.next(step);
    if (moved) {
      animatePage('next');
      if (c.flow) c.flow.page = c.paginator.currentPage;
      updateMobiProgress(false);
    } else if (c.flow && c.flow.canNext()) {
      animatePage('next');
      const r = c.flow.next(step);
      if (r && (c.format === 'mobi' || c.format === 'azw3')) {
        loadMobiChapter(r.chapter, { page: 0 });
      }
    }
  }
}

function prevPage() {
  const c = state.current;
  if (!c) return;
  if (c.format === 'epub') {
    if (c.rendition) { animatePage('prev'); c.rendition.prev(); }
  } else if (c.format === 'pdf') {
    if (c.page > 1) { c.page -= 1; animatePage('prev'); renderPdfPage(); }
  } else if (c.paginator) {
    const step = state.readMode === 'spread' ? 2 : 1;
    const moved = c.paginator.prev(step);
    if (moved) {
      animatePage('prev');
      if (c.flow) c.flow.page = c.paginator.currentPage;
      updateMobiProgress(false);
    } else if (c.flow && c.flow.canPrev()) {
      animatePage('prev');
      const r = c.flow.prev(step);
      if (r && (c.format === 'mobi' || c.format === 'azw3')) {
        loadMobiChapter(r.chapter, { page: 'end' });
      }
    }
  }
}

function isReaderTyping(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable === true;
}

function onReaderKey(ev) {
  if (ev.key === 'Escape') {
    if (isSettingsOpen()) { ev.preventDefault(); closeSettings(); return; }
    if (els.contextMenu && !els.contextMenu.hidden) { ev.preventDefault(); hideContextMenu(); return; }
    if (!views.reader.hidden) { ev.preventDefault(); backToLibrary(); }
    return;
  }
  if (isReaderTyping(ev.target)) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (views.reader.hidden) return;
  if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); prevPage(); }
  else if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { ev.preventDefault(); nextPage(); }
}

function onReaderWheel(ev) {
  if (views.reader.hidden) return;
  if (isReaderTyping(ev.target)) return;
  const d = normalizeWheelDelta(ev);
  if (Math.abs(d) < 0.01) return;
  ev.preventDefault();
  const dir = readerWheelGate.feed(d, Date.now());
  if (dir === 'next') nextPage();
  else if (dir === 'prev') prevPage();
}

function bindReaderKeyboard(target) {
  if (!target || target.__gaiaKeyBound) return;
  try { target.addEventListener('keydown', onReaderKey); target.__gaiaKeyBound = true; } catch (e) {}
}

function bindReaderWheel(target) {
  if (!target || target.__gaiaWheelBound) return;
  try { target.addEventListener('wheel', onReaderWheel, { passive: false }); target.__gaiaWheelBound = true; } catch (e) {}
}

function bindEpubWheel() {
  if (!state.current || !state.current.rendition) return;
  const frames = els.readerContent.querySelectorAll('iframe');
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.contentWindow) bindReaderWheel(frame.contentWindow);
  }
}

function bindReaderInputs(target) {
  if (!target) return;
  bindReaderKeyboard(target);
  bindReaderWheel(target);
}

function adjustFont(delta) {
  const c = state.current;
  if (!c) return;
  if (c.format === 'epub') {
    state.fontSize = Math.min(200, Math.max(80, state.fontSize + delta * 10));
    applyEpubTypography();
  } else if (c.format === 'pdf') {
    c.zoom = Math.min(2, Math.max(0.6, (c.zoom || 1) + delta * 0.2));
    renderPdfPage();
  } else if (c.paginator) {
    state.fontSize = Math.min(200, Math.max(80, state.fontSize + delta * 10));
    state.txtFont = Math.min(28, Math.max(12, Math.round((state.fontSize / 100) * 16)));
    applyMobiTypography();
  }
  if (isSettingsOpen()) updateSettingsValues();
  rememberSettings();
}

function cycleLineHeight() {
  const options = [1.4, 1.6, 1.8, 2.0, 2.4];
  const idx = options.indexOf(state.lineHeight);
  state.lineHeight = options[(idx + 1) % options.length];
  if (state.current && state.current.format === 'epub') applyEpubTypography();
  if (state.current && state.current.format === 'epub' && state.current.rendition) {
    try { state.current.rendition.getContents().forEach((contents) => applyReaderStyles(contents)); } catch (e) {}
  }
  if (state.current && state.current.paginator) applyMobiTypography();
  if (isSettingsOpen()) updateSettingsValues();
  els.readerStatus.textContent = '行距 ' + state.lineHeight.toFixed(1);
  rememberSettings();
}
const MARGIN_OPTIONS = [4, 8, 12, 16];
function cycleMargin() {
  const opts = MARGIN_OPTIONS;
  const cur = state.prefs.marginPct != null ? state.prefs.marginPct : 8;
  const idx = opts.indexOf(cur);
  state.prefs.marginPct = opts[(idx + 1) % opts.length];
  const c = state.current;
  if (c && c.format === 'epub' && c.rendition) {
    try { c.rendition.getContents().forEach((contents) => applyReaderStyles(contents)); } catch (e) {}
  }
  if (c && c.paginator) c.paginator.setMargin(state.prefs.marginPct);
  if (isSettingsOpen()) updateSettingsValues();
  els.readerStatus.textContent = '页边距 ' + state.prefs.marginPct + '%';
  rememberSettings();
}

function togglePanel(which) {
  const isToc = which === 'toc';
  const targetHidden = isToc ? els.tocPanel.hidden : els.bookmarksPanel.hidden;
  if (!targetHidden) {
    els.tocPanel.hidden = true;
    els.bookmarksPanel.hidden = true;
  } else {
    els.tocPanel.hidden = !isToc;
    els.bookmarksPanel.hidden = isToc;
  }
  resizeEpubRendition();
}

function mobiChapterTitle(mobi, ch) {
  if (!mobi) return '第 ' + ((ch || 0) + 1) + ' 节';
  const label = findTocLabel(mobi.toc || [], ch);
  return label || '第 ' + ((ch || 0) + 1) + ' 节';
}

function findTocLabel(items, ch) {
  for (const it of items || []) {
    if (it.index === ch && it.label && String(it.label).trim()) return String(it.label).trim();
    if (it.children && it.children.length) {
      const r = findTocLabel(it.children, ch);
      if (r) return r;
    }
  }
  return null;
}

function epubChapterTitle(epub, spineIndex) {
  try {
    const items = (epub && epub.spine && epub.spine.spineItems) || [];
    const item = items[spineIndex];
    const nav = epub && epub.navigation && epub.navigation.toc;
    if (item && item.href && nav) {
      const label = findNavLabel(nav, item.href);
      if (label) return label;
    }
  } catch (e) {}
  return '第 ' + ((spineIndex || 0) + 1) + ' 章';
}

function findNavLabel(items, href) {
  for (const it of items || []) {
    if (it.href && (it.href === href || href.indexOf(it.href) === 0 || it.href.indexOf(href) === 0)) {
      if (it.label && String(it.label).trim()) return String(it.label).trim();
    }
    if (it.subitems && it.subitems.length) {
      const r = findNavLabel(it.subitems, href);
      if (r) return r;
    }
  }
  return null;
}

function bookmarkChapterLabel(bm, c) {
  if (bm && bm.chapter && String(bm.chapter).trim()) return String(bm.chapter).trim();
  if (!bm || !bm.loc) return '未知位置';
  if (c && c.format === 'pdf') return '第 ' + (parseInt(bm.loc, 10) || 1) + ' 页';
  const m = String(bm.loc).match(/^page:(\d+):(\d+)/);
  if (m) {
    const ch = parseInt(m[1], 10) || 0;
    if (c && (c.format === 'mobi' || c.format === 'azw3')) return mobiChapterTitle(c.mobi, ch);
    return '第 ' + (ch + 1) + ' 节';
  }
  if (c && c.format === 'txt') return '全文';
  return '未知章节';
}

function bookmarkPercentLabel(bm) {
  if (bm && typeof bm.percent === 'number') return '进度 ' + bm.percent.toFixed(1) + '%';
  return '进度 —';
}

function renderBookmarksPanel() {
  const c = state.current;
  els.bookmarksPanel.innerHTML = '';
  const list = c ? state.bookmarks[c.path] || [] : [];
  if (!list.length) {
    els.bookmarksPanel.textContent = '（还没有书签，点击设置中的"添加书签"）';
    return;
  }
  list.forEach((bm, index) => {
    const row = document.createElement('div');
    row.className = 'bookmark-row';

    const main = document.createElement('div');
    main.className = 'bookmark-main';

    const title = document.createElement('span');
    title.className = 'bookmark-title';
    title.textContent = bm.name || bm.label || '书签 ' + (index + 1);
    title.title = '双击书名或点 ✎ 重命名';
    title.addEventListener('click', (ev) => {
      ev.preventDefault();
      jumpToBookmark(bm);
    });
    title.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      makeBookmarkNameEditable(title, bm, index);
    });

    const meta = document.createElement('div');
    meta.className = 'bookmark-meta';
    meta.textContent = bookmarkChapterLabel(bm, c) + ' · ' + bookmarkPercentLabel(bm);

    const edit = document.createElement('button');
    edit.className = 'btn bookmark-edit';
    edit.textContent = '✎';
    edit.title = '重命名书签';
    edit.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      makeBookmarkNameEditable(title, bm, index);
    });

    const del = document.createElement('button');
    del.className = 'btn bookmark-delete';
    del.textContent = '删除';
    del.title = '删除此书签';
    del.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removeBookmarkAt(index);
    });

    main.appendChild(title);
    main.appendChild(meta);
    row.appendChild(main);
    row.appendChild(edit);
    row.appendChild(del);
    els.bookmarksPanel.appendChild(row);
  });
}

function makeBookmarkNameEditable(titleEl, bm, index) {
  const input = document.createElement('input');
  input.className = 'bookmark-name-input';
  input.value = bm.name || bm.label || '书签 ' + (index + 1);
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== (bm.name || bm.label)) {
      await renameBookmarkAt(index, v);
    } else {
      renderBookmarksPanel();
    }
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit(true);
    else if (ev.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
}

async function addBookmark() {
  const c = state.current;
  if (!c) return;
  let loc = '';
  let anchor = null;
  let chapter = '';
  let percent = null;
  if (c.format === 'epub') {
    const locObj = c.rendition && c.rendition.currentLocation();
    if (!locObj || !locObj.start) {
      els.readerStatus.textContent = '暂无法获取当前位置';
      return;
    }
    loc = locObj.start.cfi;
    percent = typeof state.current.displayPercent === 'number' ? state.current.displayPercent : 0;
    chapter = epubChapterTitle(c.epub, locObj.start.index);
  } else if (c.format === 'pdf') {
    loc = String(c.page);
    chapter = '第 ' + c.page + ' 页';
    percent = c.pages ? (c.page / c.pages) * 100 : 0;
  } else if (c.paginator) {
    const ch = c.flow ? c.flow.chapter : 0;
    const a = c.paginator.anchor();
    if (a && typeof a.off === 'number') {
      anchor = c.format === 'txt' ? { off: a.off, snippet: a.snippet || '' } : { ch, off: a.off, snippet: a.snippet || '' };
      loc = 'anchor:' + JSON.stringify(anchor);
    } else {
      loc = 'page:' + ch + ':' + c.paginator.currentPage;
    }
    percent = c.flow ? c.flow.percent() : c.paginator.pagePercent();
    if (c.format === 'txt') {
      const paraIdx = a ? c.paginator.paragraphIndexOfTextOffset(a.off) : -1;
      const t = paraIdx >= 0 ? chapterTitleForParagraph(c.txtChapters, paraIdx) : null;
      chapter = t || (a && a.snippet ? '…' + a.snippet + '…' : '全文');
    } else {
      chapter = mobiChapterTitle(c.mobi, ch);
    }
  } else {
    loc = String(els.readerContent.scrollTop);
    chapter = '全文';
    percent = 0;
  }
  const name = '书签 ' + (getBookmarkCount() + 1);
  const bookmark = {
    name,
    label: name,
    loc,
    format: c.format,
    chapter,
    percent: percent == null ? null : Math.round(percent * 100) / 100,
    anchor,
    addedAt: Date.now(),
  };
  state.bookmarks = addBookmarkToMap(state.bookmarks, c.path, bookmark);
  await saveBookmarksNow();
  renderBookmarksPanel();
  els.readerStatus.textContent = '已添加书签';
}

async function removeBookmarkAt(index) {
  const c = state.current;
  if (!c) return;
  state.bookmarks = removeBookmarkFromMap(state.bookmarks, c.path, index);
  await saveBookmarksNow();
  renderBookmarksPanel();
  els.readerStatus.textContent = '书签已删除';
}

async function renameBookmarkAt(index, name) {
  const c = state.current;
  if (!c) return;
  state.bookmarks = renameBookmarkFromMap(state.bookmarks, c.path, index, name);
  await saveBookmarksNow();
  renderBookmarksPanel();
  els.readerStatus.textContent = '书签已重命名';
}

function getBookmarkCount() {
  return state.current ? (state.bookmarks[state.current.path] || []).length : 0;
}

async function jumpToBookmark(bm) {
  const c = state.current;
  if (!c || !bm) return;
  const loc = bm.loc;
  if (c.format === 'epub') {
    if (loc) c.rendition.display(loc);
  } else if (c.format === 'pdf') {
    c.page = parseInt(loc, 10) || 1;
    await renderPdfPage();
  } else if (c.paginator) {
    if (bm.anchor && typeof bm.anchor.off === 'number') {
      const ch = typeof bm.anchor.ch === 'number' ? bm.anchor.ch : (c.flow ? c.flow.chapter : 0);
      if (c.format === 'mobi' || c.format === 'azw3') {
        await loadMobiChapter(ch, {});
      } else {
        c.paginator.setMode(state.readMode === 'spread' ? 'spread' : 'single');
      }
      const page = c.paginator.locate(bm.anchor.off);
      if (page >= 0) {
        c.paginator.showPage(page);
        if (c.flow) c.flow.page = page;
      }
    } else if (loc) {
      const parts = String(loc).split(':');
      const chapter = parseInt(parts[1], 10) || 0;
      const page = parseInt(parts[2], 10) || 0;
      if (c.format === 'mobi' || c.format === 'azw3') {
        await loadMobiChapter(chapter, { page });
      } else {
        c.paginator.setMode(state.readMode === 'spread' ? 'spread' : 'single');
        c.paginator.showPage(page);
      }
    }
    updateMobiProgress(true);
  } else {
    els.readerContent.scrollTop = parseInt(loc, 10) || 0;
  }
}
/* ===== 粒子特效（仅首页） ===== */
const fx = {
  canvas: null,
  ctx: null,
  particles: [],
  lastTrail: null,
  lastMove: 0,
  raf: 0,
  running: false,
};

function initFx() {
  fx.canvas = $('fx-canvas');
  fx.ctx = fx.canvas.getContext('2d');
  resizeFx();
  window.addEventListener('resize', resizeFx);
}

function resizeFx() {
  fx.canvas.width = window.innerWidth;
  fx.canvas.height = window.innerHeight;
}

function spawnBurst(x, y) {
  const colors = ['#ff5f5f', '#ffb020', '#ffd93d', '#4cd964', '#34c7ff', '#8f6bff', '#ff7ad9'];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    fx.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      size: 3 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: 'circle',
      life: 1,
      decay: 0.018 + Math.random() * 0.02,
      gravity: 0.12,
    });
  }
  ensureFxLoop();
}

function addTrailPoint(x, y) {
  if (fx.lastTrail && Math.abs(fx.lastTrail.x - x) < 4 && Math.abs(fx.lastTrail.y - y) < 4) return;
  fx.lastTrail = { x, y };
  const colors = ['#ff5f5f', '#ffb020', '#ffd93d', '#4cd964', '#34c7ff', '#8f6bff', '#ff7ad9'];
  const n = 2;
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.2 + Math.random() * 0.8;
    fx.particles.push({
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 1.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: 'diamond',
      life: 0.9 + Math.random() * 0.3,
      decay: 0.008 + Math.random() * 0.006,
      gravity: 0,
    });
  }
  ensureFxLoop();
}

function ensureFxLoop() {
  if (fx.running) return;
  fx.running = true;
  fx.raf = requestAnimationFrame(fxTick);
}

function drawParticle(ctx, p) {
  ctx.globalAlpha = Math.max(0, p.life);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  if (p.shape === 'diamond') {
    const s = p.size * (0.6 + p.life * 0.7);
    ctx.moveTo(p.x, p.y - s);
    ctx.lineTo(p.x + s, p.y);
    ctx.lineTo(p.x, p.y + s);
    ctx.lineTo(p.x - s, p.y);
    ctx.closePath();
  } else {
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  }
  ctx.fill();
}

function fxTick() {
  const ctx = fx.ctx;
  ctx.clearRect(0, 0, fx.canvas.width, fx.canvas.height);
  fx.particles = fx.particles.filter((p) => p.life > 0);
  for (const p of fx.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.life -= p.decay;
    drawParticle(ctx, p);
  }
  ctx.globalAlpha = 1;
  if (fx.particles.length) {
    fx.raf = requestAnimationFrame(fxTick);
  } else {
    fx.running = false;
    ctx.clearRect(0, 0, fx.canvas.width, fx.canvas.height);
  }
}

function clearFx() {
  fx.particles = [];
  fx.lastTrail = null;
  if (fx.running) {
    cancelAnimationFrame(fx.raf);
    fx.running = false;
  }
  if (fx.ctx) fx.ctx.clearRect(0, 0, fx.canvas.width, fx.canvas.height);
}

/* ===== 主题（日间 / 护眼 / 夜间） ===== */
function themeLabel(t) {
  return t === 'dark' ? '夜间' : t === 'eye' ? '护眼' : '日间';
}

function applyThemeClass() {
  document.body.classList.remove('dark', 'eye');
  if (state.prefs.theme === 'dark') document.body.classList.add('dark');
  if (state.prefs.theme === 'eye') document.body.classList.add('eye');
  els.themeValue.textContent = themeLabel(state.prefs.theme);
}

async function applyTheme(theme) {
  state.prefs.theme = theme;
  applyThemeClass();
  const c = state.current;
  if (c && c.format === 'epub' && c.rendition) {
    try {
      c.rendition.getContents().forEach((contents) => applyReaderStyles(contents));
    } catch (e) {}
  }
  if (c && c.format === 'pdf') renderPdfPage();
  if (c && c.paginator) applyMobiTheme();
  await window.api.stateSet('prefs', state.prefs);
  rememberSettings();
}


function petValueLabel() {
  return window.GaiaPet && window.GaiaPet.getState().on ? '开' : '关';
}

function updatePetUI() {
  const el = $('pet-value');
  if (el) el.textContent = petValueLabel();
}

function togglePet() {
  const on = !(window.GaiaPet && window.GaiaPet.getState().on);
  if (window.GaiaPet) window.GaiaPet.setEnabled(on);
  updatePetUI();
}

async function cycleTheme() {
  const order = ['light', 'eye', 'dark'];
  const idx = order.indexOf(state.prefs.theme);
  await applyTheme(order[(idx + 1) % order.length]);
}

function applyReaderStyles(contents) {
  const doc = contents.document;
  let style = doc.getElementById('gaia-reader-style');
  const theme = state.prefs.theme;
  const font = FONTS[state.fontName] || '';
  let css = '';
  if (theme === 'dark') {
    css += 'html, body { background: #000 !important; } body { color: #e6edf3 !important; } p, div, span, li, h1, h2, h3, h4, td, blockquote { color: #e6edf3 !important; } a { color: #58a6ff !important; }';
  } else if (theme === 'eye') {
    css += 'html, body { background: #f5ecd9 !important; } body { color: #4a3826 !important; } p, div, span, li, h1, h2, h3, h4, td, blockquote { color: #4a3826 !important; } a { color: #8a6d3b !important; }';
  }
  css += 'p { text-indent: 2em !important; margin: 0 0 0.8em !important; line-height: ' + state.lineHeight + ' !important; } h1, h2, h3, h4 { line-height: 1.4 !important; margin: 1.2em 0 0.6em !important; }';
  const marginPct = state.prefs.marginPct != null ? state.prefs.marginPct : 8;
  css += 'body > * { margin-left: ' + marginPct + '% !important; margin-right: ' + marginPct + '% !important; }';
  if (font) css += 'body, p, div, span, li { font-family: ' + font + ' !important; }';
  if (style) style.remove();
  if (!css) return;
  style = doc.createElement('style');
  style.id = 'gaia-reader-style';
  (doc.head || doc.documentElement).appendChild(style);
  style.textContent = css;
}

function isThemeInjected() {
  const c = state.current;
  if (!c || !c.rendition) return false;
  try {
    return c.rendition.getContents().some((contents) => !!contents.document.getElementById('gaia-reader-style'));
  } catch (e) {
    return false;
  }
}

async function buildPdfImageOverlay(page, viewport, dpr) {
  try {
    const OPS = window.pdfjsLib.OPS;
    const fnToName = {};
    for (const name of Object.keys(OPS)) fnToName[OPS[name]] = name;
    const opList = await page.getOperatorList();
    const draws = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const name = fnToName[opList.fnArray[i]];
      if ((name === 'paintImageXObject' || name === 'paintJpegXObject') && typeof opList.argsArray[i][1] === 'number') {
        const args = opList.argsArray[i];
        draws.push({ objId: args[0], x: args[1], y: args[2], w: args[3], h: args[4] });
      }
    }
    if (!draws.length) return null;
    const overlay = document.createElement('canvas');
    overlay.className = 'pdf-image-overlay';
    overlay.width = Math.floor(viewport.width * dpr);
    overlay.height = Math.floor(viewport.height * dpr);
    overlay.style.width = Math.floor(viewport.width) + 'px';
    overlay.style.height = Math.floor(viewport.height) + 'px';
    const octx = overlay.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const d of draws) {
      try {
        const img = await page.objs.get(d.objId);
        if (!img || !img.width || !img.height || !img.data) continue;
        const p1 = viewport.convertToViewportPoint(d.x, viewport.height - d.y);
        const p2 = viewport.convertToViewportPoint(d.x + d.w, viewport.height - (d.y + d.h));
        const ix = Math.min(p1[0], p2[0]);
        const iy = Math.min(p1[1], p2[1]);
        const iw = Math.abs(p2[0] - p1[0]);
        const ih = Math.abs(p2[1] - p1[1]);
        if (iw <= 0 || ih <= 0) continue;
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        const tctx = tmp.getContext('2d');
        if (img.data.length === img.width * img.height * 4) {
          tctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
        } else {
          const bmp = await createImageBitmap(new Blob([img.data]));
          tctx.drawImage(bmp, 0, 0);
        }
        octx.drawImage(tmp, ix, iy, iw, ih);
      } catch (e) {
        // 单张图片失败不影响其他
      }
    }
    return overlay;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function updateProgress(percent, text) {
  els.progressFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  if (text) els.readerStatus.textContent = text;
}

function applyGlobalHabits() {
  const p = state.prefs;
  if (p.theme) { state.prefs.theme = p.theme; applyThemeClass(); }
  if (p.fontName) { state.fontName = p.fontName; els.fontSelect.value = p.fontName; }
  if (p.fontSize != null) state.fontSize = p.fontSize;
  if (p.txtFont != null) state.txtFont = p.txtFont;
  if (p.lineHeight != null) state.lineHeight = p.lineHeight;
  state.readMode = p.readMode === 'spread' ? 'spread' : 'single';
}

function rememberSettings() {
  state.prefs = Object.assign({}, state.prefs, {
    theme: state.prefs.theme,
    fontName: state.fontName,
    fontSize: state.fontSize,
    txtFont: state.txtFont,
    lineHeight: state.lineHeight,
    marginPct: state.prefs.marginPct,
    readMode: state.readMode,
  });
  window.api.stateSet('prefs', state.prefs);
  const c = state.current;
  if (!c) return;
  const prev = (state.progress[c.path] && state.progress[c.path].settings) || {};
  if (c.zoom != null || prev.zoom != null) {
    const settings = Object.assign({}, prev, { zoom: c.zoom || prev.zoom });
    state.progress[c.path] = Object.assign({}, state.progress[c.path], { settings });
    window.api.stateSet('progress', state.progress);
  }
}

function bindEvents() {
  $('btn-home-shelf').addEventListener('click', () => showView('library'));
  $('btn-home-folder').addEventListener('click', async () => {
    const paths = await window.api.openFolder();
    if (paths.length) {
      await importPaths(paths);
      showView('library');
    }
  });
  $('btn-home-settings').addEventListener('click', openSettings);
  views.home.addEventListener('pointerdown', (ev) => spawnBurst(ev.clientX, ev.clientY));
  views.home.addEventListener('pointermove', (ev) => {
    const now = performance.now();
    if (now - fx.lastMove > 16) { fx.lastMove = now; addTrailPoint(ev.clientX, ev.clientY); }
  });
  views.library.addEventListener('pointerdown', (ev) => spawnBurst(ev.clientX, ev.clientY));
  views.library.addEventListener('pointermove', (ev) => {
    const now = performance.now();
    if (now - fx.lastMove > 16) { fx.lastMove = now; addTrailPoint(ev.clientX, ev.clientY); }
  });
  $('btn-back-home').addEventListener('click', () => showView('home'));

  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-reader').addEventListener('click', openSettings);
  $('btn-settings-close').addEventListener('click', closeSettings);
  els.settingsOverlay.addEventListener('click', (ev) => {
    if (ev.target === els.settingsOverlay) closeSettings();
  });
  els.settingsDrawer.addEventListener('click', (ev) => ev.stopPropagation());

  $('btn-manage').addEventListener('click', toggleManageMode);
  $('btn-select-all').addEventListener('click', selectAll);
  $('btn-remove-selected').addEventListener('click', () => batchRemoveSelected());
  $('btn-exit-manage').addEventListener('click', exitManageMode);
  $('btn-import-files').addEventListener('click', async () => {
    const paths = await window.api.openFiles();
    if (paths.length) await importPaths(paths);
  });

  $('btn-back').addEventListener('click', backToLibrary);

  $('btn-font-minus').addEventListener('click', () => adjustFont(-1));
  $('btn-font-plus').addEventListener('click', () => adjustFont(1));
  $('btn-line-height').addEventListener('click', cycleLineHeight);
  $('btn-margin').addEventListener('click', cycleMargin);
  $('btn-spread').addEventListener('click', toggleSpread);
  $('btn-theme').addEventListener('click', cycleTheme);
  $('btn-pet-toggle').addEventListener('click', togglePet);
  els.fontSelect.addEventListener('change', (ev) => {
    state.fontName = ev.target.value;
    const c = state.current;
    if (c && c.format === 'epub' && c.rendition) {
      try { c.rendition.getContents().forEach((contents) => applyReaderStyles(contents)); } catch (e) {}
    }
    if (c && c.paginator) applyMobiTypography();
    if (c && (c.format === 'mobi' || c.format === 'azw3')) applyMobiTypography();
    window.api.stateSet('prefs', state.prefs);
    rememberSettings();
  });
  $('btn-toc').addEventListener('click', () => {
    closeSettings();
    togglePanel('toc');
  });
  $('btn-bookmarks').addEventListener('click', () => {
    closeSettings();
    togglePanel('bookmarks');
  });
  $('btn-add-bookmark').addEventListener('click', () => {
    closeSettings();
    addBookmark();
  });
  $('btn-prev-page').addEventListener('click', prevPage);
  $('btn-next-page').addEventListener('click', nextPage);

  els.bookshelf.addEventListener('contextmenu', (ev) => {
    const card = ev.target.closest('.book-card');
    if (!card) return;
    ev.preventDefault();
    const book = state.library.find((b) => b.path === card.dataset.path);
    if (book) showContextMenu(ev.clientX, ev.clientY, book);
  });
  els.contextMenu.addEventListener('contextmenu', (ev) => ev.preventDefault());
  $('ctx-open').addEventListener('click', () => {
    const book = state.ctxBook;
    hideContextMenu();
    if (book) openBook(book);
  });
  $('ctx-remove').addEventListener('click', () => {
    const book = state.ctxBook;
    hideContextMenu();
    if (book) removeFromShelf(book);
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#context-menu')) hideContextMenu();
  });

  bindReaderKeyboard(document);
  bindReaderWheel(els.readerContent);
  window.addEventListener('resize', () => {
    const c = state.current;
    if (c && c.format === 'pdf') renderPdfPage();
    if (c && c.format === 'epub') resizeEpubRendition();
  });
}

window.__gaiaDebug = {
  openBook,
  backToLibrary,
  showView,
  nextPage,
  prevPage,
  addBookmark,
  removeBookmarkAt,
  togglePanel,
  toggleSpread,
  countBoundWheels: () => {
    let n = 0;
    const frames = els.readerContent.querySelectorAll('iframe');
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (
        (f.contentWindow && f.contentWindow.__gaiaWheelBound) ||
        (f.contentDocument && f.contentDocument.__gaiaWheelBound)
      ) n += 1;
    }
    return n;
  },
  getSpreadMode: () => state.readMode === 'spread',
  getReadMode: () => state.readMode,
  setMode: (mode) => {
    if (mode === 'single' || mode === 'spread') {
      state.readMode = mode;
      const c = state.current;
      if (c) {
        if (c.format === 'epub' && c.rendition) {
          try { c.rendition.spread(mode === 'spread' ? 'auto' : 'none', 700); } catch (e) {}
        } else if (c.paginator) {
          c.paginator.setMode(mode);
          updateMobiProgress(true);
        }
      }
      rememberSettings();
    }
  },
  toggleNight: cycleTheme,
  setTheme: applyTheme,
  getTheme: () => state.prefs.theme,
  isNight: () => state.prefs.theme === 'dark',
  isBodyDark: () => document.body.classList.contains('dark'),
  isBodyEye: () => document.body.classList.contains('eye'),
  isDarkInjected: () => isThemeInjected() && state.prefs.theme === 'dark',
  setFont: async (name) => {
    state.fontName = name;
    const c = state.current;
    if (c && c.format === 'epub' && c.rendition) {
      try { c.rendition.getContents().forEach((contents) => applyReaderStyles(contents)); } catch (e) {}
    }
    if (c && c.paginator) applyMobiTypography();
    await window.api.stateSet('prefs', state.prefs);
    rememberSettings();
  },
  isFontInjected: () => {
    const c = state.current;
    if (!c || !c.rendition) return false;
    try {
      return c.rendition.getContents().some((contents) => {
        const s = contents.document.getElementById('gaia-reader-style');
        return s && s.textContent.indexOf('font-family') >= 0;
      });
    } catch (e) {
      return false;
    }
  },
  getPagingClass: () => els.readerContent.className,
  getPaginatorTotal: () => (state.current && state.current.paginator ? state.current.paginator.totalPages : 0),
  getPaginatorPage: () => (state.current && state.current.paginator ? state.current.paginator.currentPage : -1),
  getMobiContentLength: () => {
    const c = state.current;
    return c && c.paginator && c.paginator.doc ? c.paginator.doc.body.innerHTML.length : 0;
  },
  getMobiChapters: () => (state.current && state.current.mobi ? state.current.mobi.chapters.length : 0),
  getMobiTocCount: () => (state.current && state.current.mobi ? state.current.mobi.toc.length : 0),
  getMobiIndex: () => (state.current && state.current.flow ? state.current.flow.chapter : -1),
  getReaderScrollTop: () => {
    const c = state.current;
    if (c && c.paginator) return c.paginator.currentPage;
    return els.readerContent.scrollTop;
  },
  jumpToMobiChapter: (idx) => loadMobiChapter(idx, { page: 0 }),
  getBookmarks: () => (state.current ? state.bookmarks[state.current.path] || [] : []),
  jumpToBookmark: (bm) => jumpToBookmark(bm),
  getPaginatorScroll: () => {
    const c = state.current;
    if (!c || !c.paginator || !c.paginator.doc) return null;
    const d = c.paginator.doc;
    return {
      page: c.paginator.currentPage,
      total: c.paginator.totalPages,
      colStep: c.paginator.colStep,
      htmlScroll: d.documentElement.scrollLeft,
      bodyScroll: d.body ? d.body.scrollLeft : -1,
      winX: c.paginator.frame ? c.paginator.frame.contentWindow.scrollX : -1,
      htmlW: d.documentElement.scrollWidth,
      hostW: c.paginator.host ? c.paginator.host.clientWidth : 0,
      frameW: c.paginator.frame ? c.paginator.frame.clientWidth : 0,
    };
  },
  getAnchorSnippet: () => (state.current && state.current.paginator ? ((state.current.paginator.anchor() || {}).snippet || '') : ''),
  getAnchorProbe: () => {
    const p = state.current && state.current.paginator;
    if (!p || !p.doc) return null;
    const doc = p.doc;
    const w = p.pageWidth;
    const h = p.host ? p.host.clientHeight : 600;
    const out = [];
    const xs = [Math.max(4, Math.floor(w / 2)), Math.max(4, 12), Math.max(4, w - 12)];
    for (let y = 8; y <= h; y += 12) {
      for (const x of xs) {
        let range = null;
        try { range = doc.caretRangeFromPoint(x, y); } catch (e) {}
        if (!range || !range.startContainer || range.startContainer.nodeType !== 3) continue;
        let r = null;
        try { r = range.getBoundingClientRect(); } catch (e) {}
        out.push({
          x,
          y,
          tag: range.startContainer.parentElement ? range.startContainer.parentElement.tagName : null,
          nodeLen: (range.startContainer.textContent || "").length,
          caretOff: range.startOffset,
          rectLeft: r ? Math.round(r.left) : null,
          rectTop: r ? Math.round(r.top) : null,
          snippet: String(range.startContainer.textContent || "").slice(range.startOffset, range.startOffset + 12),
        });
      }
    }
    return out.slice(0, 14);
  },
  getPaginatorLayout: () => {
    const c = state.current;
    if (!c || !c.paginator || !c.paginator.doc) return null;
    const p = c.paginator;
    const d = p.doc;
    const body = d.body;
    const first = body.firstElementChild;
    const cs = getComputedStyle(body);
    const colStart = p.currentPage * p.colStep;
    let textBox = null;
    const walker = d.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent || !n.textContent.trim()) continue;
      const r = d.createRange();
      r.selectNodeContents(n);
      const rects = r.getClientRects();
      for (const rect of rects) {
        if (rect.left >= colStart && rect.left < colStart + p.pageWidth) {
          textBox = { left: Math.round(rect.left - colStart), right: Math.round(rect.right - colStart), top: Math.round(rect.top) };
          break;
        }
      }
      if (textBox) break;
    }
    const fcs = first ? getComputedStyle(first) : null;
    return {
      hostW: p.host ? p.host.clientWidth : 0,
      frameW: p.frame ? p.frame.clientWidth : 0,
      pageWidth: p.pageWidth,
      gap: p.gap,
      colStep: p.colStep,
      mode: p.mode,
      page: p.currentPage,
      total: p.totalPages,
      bodyMarginL: cs.marginLeft,
      bodyMarginR: cs.marginRight,
      bodyPaddingL: cs.paddingLeft,
      bodyPaddingR: cs.paddingRight,
      firstChildTag: first ? first.tagName : null,
      firstChildMarginL: fcs ? fcs.marginLeft : null,
      firstChildMarginR: fcs ? fcs.marginRight : null,
      textBox,
    };
  },
  getAnchorInView: (off) => (state.current && state.current.paginator ? state.current.paginator.anchorInView(off) : false),
  bgmState: () => window.GaiaBgm.getState(),
  bgmNext: () => window.GaiaBgm.next(),
  bgmSetVolume: (v) => window.GaiaBgm.setVolume(v),
  bgmToggle: () => window.GaiaBgm.toggle(),
  bgmMarqueeInfo: () => window.GaiaBgm.marqueeInfo(),
  getReaderTitle: () => els.readerTitle.textContent,
  getMobiBackground: () => {
    const c = state.current;
    if (c && c.paginator && c.paginator.doc) return getComputedStyle(c.paginator.doc.body).backgroundColor;
    return '';
  },
  getDisplayPercent: () => (state.current && state.current.displayPercent != null ? state.current.displayPercent : 0),
  getProgressWidth: () => els.progressFill.style.width,
  getCurrentSettings: () => ({
    theme: state.prefs.theme,
    fontName: state.fontName,
    fontSize: state.fontSize,
    txtFont: state.txtFont,
    lineHeight: state.lineHeight,
    marginPct: state.prefs.marginPct,
    readMode: state.readMode,
    spread: state.readMode === 'spread',
  }),
  setLineHeight: (lh) => {
    state.lineHeight = lh;
    if (state.current && state.current.format === 'epub') applyEpubTypography();
    if (state.current && state.current.format === 'epub' && state.current.rendition) {
      try { state.current.rendition.getContents().forEach((contents) => applyReaderStyles(contents)); } catch (e) {}
    }
    if (state.current && state.current.paginator) applyMobiTypography();
    if (isSettingsOpen()) updateSettingsValues();
    rememberSettings();
  },
  burst: (x, y) => spawnBurst(x == null ? 200 : x, y == null ? 200 : y),
  getParticleCount: () => fx.particles.length,
  getDiamondCount: () => fx.particles.filter((p) => p.shape === 'diamond').length,
  trailPoint: (x, y) => addTrailPoint(x, y),
  clearFx,
  isFxLoopRunning: () => fx.running,
  isFxActive: () => !$('fx-canvas').hidden,
  addToLibrary,
  removeFromShelf: (book) => removeFromShelf(book, true),
  toggleManageMode,
  selectBook: (pathKey) => {
    if (!state.manageMode) enterManageMode();
    toggleSelect(pathKey);
  },
  batchRemoveSelected: () => batchRemoveSelected(true),
  openSettings,
  closeSettings,
  isSettingsOpen,
  waitHome: () => state.homeReady,
  getView: () => {
    for (const key of Object.keys(views)) {
      if (!views[key].hidden) return key;
    }
    return null;
  },
  isSplashHidden: () => views.splash.hidden,
  getStatus: () => els.readerStatus.textContent,
  getLoc: () => {
    const c = state.current;
    if (!c || !c.rendition) return null;
    try {
      const locObj = c.rendition.currentLocation();
      return locObj && locObj.start ? locObj.start.cfi : null;
    } catch (e) {
      return null;
    }
  },
  getPercent: () => {
    const c = state.current;
    if (!c) return null;
    if (c.paginator) {
      return c.flow ? c.flow.percent() : c.paginator.pagePercent();
    }
    if (!c || !c.rendition) return null;
    try {
      const locObj = c.rendition.currentLocation();
      return locObj && locObj.start && locObj.start.percentage != null ? locObj.start.percentage : null;
    } catch (e) {
      return null;
    }
  },
  waitLocations: () =>
    state.current && state.current.locationsReady
      ? state.current.locationsReady
      : Promise.resolve(false),
  getPanels: () => ({ tocHidden: els.tocPanel.hidden, bookmarksHidden: els.bookmarksPanel.hidden }),
  getRenditionSize: () => {
    const c = state.current;
    if (!c || !c.rendition) return { w: 0, h: 0 };
    try {
      const iframe = els.readerContent.querySelector('iframe');
      return { w: iframe ? iframe.clientWidth : 0, h: iframe ? iframe.clientHeight : 0 };
    } catch (e) {
      return { w: 0, h: 0 };
    }
  },
  getBookmarkCount,
  getTocHrefs: async () => {
    const c = state.current;
    if (!c || !c.epub) return [];
    try {
      const nav = await c.epub.loaded.navigation;
      const out = [];
      const walk = (items) => {
        for (const it of items) {
          if (it.href) out.push(it.href);
          if (it.subitems && it.subitems.length) walk(it.subitems);
        }
      };
      walk(nav.toc || []);
      return out;
    } catch (e) {
      return [];
    }
  },
  displayHref: (href) => {
    const c = state.current;
    if (!c || !c.rendition) return Promise.resolve(false);
    return c.rendition.display(href).then(() => true).catch(() => false);
  },
  openLongestChapter: async () => {
    const c = state.current;
    if (!c || !c.epub || !c.rendition) return false;
    try {
      const items = c.epub.spine.spineItems || [];
      let best = null;
      for (const item of items) {
        if (item.properties && item.properties.includes('non-linear')) continue;
        await item.load(c.epub.request);
        const text = item.document && item.document.body ? item.document.body.textContent.length : 0;
        item.unload();
        if (!best || text > best.len) best = { href: item.href, len: text };
      }
      if (!best) return false;
      await c.rendition.display(best.href);
      return true;
    } catch (e) {
      return false;
    }
  },
  getLibrary: () => state.library,
  getSortedLibrary: () => sortLibrary().map((b) => b.path),
  getShelfProgressCount: () => els.bookshelf.querySelectorAll('.book-progress').length,
  getLibraryCount: () => state.library.length,
  getProgressKeys: () => Object.keys(state.progress),
  getSelectedCount: () => state.selected.size,
};

init();





















