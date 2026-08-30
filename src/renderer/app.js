'use strict';

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { addBookmark: addBookmarkToMap, removeBookmark: removeBookmarkFromMap } = window.GaiaBookmarks;
const {
  removeBook: removeBookFromLibrary,
  removeBooks: removeBooksFromLibrary,
  removeEntry: removeEntryFromMap,
  removeEntries: removeEntriesFromMap,
} = window.GaiaLibrary;

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
  drawerSpread: $('drawer-spread'),
  spreadValue: $('spread-value'),
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
  spread: false,
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

async function init() {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const [lib, progress, bookmarks] = await Promise.all([
    window.api.stateGet('library'),
    window.api.stateGet('progress'),
    window.api.stateGet('bookmarks'),
  ]);
  state.library = lib || [];
  state.progress = progress || {};
  state.bookmarks = bookmarks || {};

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

function renderLibrary() {
  els.bookshelf.innerHTML = '';
  els.hint.hidden = state.library.length > 0;
  for (const book of state.library) {
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
  els.drawerSpread.hidden = !(inReader && state.current && state.current.format === 'epub');
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
  els.fontValue.textContent = c && c.format === 'pdf' ? Math.round((c.zoom || 1) * 100) + '%' : state.fontSize + '%';
  els.lineHeightValue.textContent = state.lineHeight.toFixed(1);
  els.spreadValue.textContent = state.spread ? '双页' : '单页';
}

function closeReaderContent() {
  const c = state.current;
  if (c) {
    if (c.rendition) { try { c.rendition.destroy(); } catch (e) {} }
    if (c.pdf) { try { c.pdf.destroy(); } catch (e) {} }
  }
  els.readerContent.innerHTML = '';
  els.pageNav.hidden = true;
  state.current = null;
}

async function backToLibrary() {
  if (state.current) {
    const c = state.current;
    if (c.format === 'pdf') saveProgress(c.path, { page: c.page });
    if (c.format === 'txt') saveProgress(c.path, { offset: els.readerContent.scrollTop });
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
  showView('reader');
  els.readerTitle.textContent = book.title || book.path;
  els.tocPanel.hidden = true;
  els.bookmarksPanel.hidden = true;
  els.tocPanel.innerHTML = '';
  els.readerStatus.textContent = '加载中…';
  els.pageNav.hidden = false;
  state.current = { path: book.path, format: book.format };
  renderBookmarksPanel();
  try {
    if (book.format === 'epub') await openEpub(book);
    else if (book.format === 'pdf') await openPdf(book);
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

  applyEpubTypography();
  const saved = state.progress[book.path];
  await rendition.display(saved && saved.loc ? saved.loc : undefined);

  rendition.on('relocated', (location) => {
    const cfi = location.start.cfi;
    const percent = location.start.percentage != null ? location.start.percentage * 100 : null;
    els.readerStatus.textContent = percent != null ? '进度 ' + percent.toFixed(1) + '%' : '进度 计算中…';
    saveProgress(book.path, { loc: cfi, percent: percent != null ? percent : 0 });
  });

  state.current.locationsReady = epub.locations
    .generate(1600)
    .then(() => {
      const locObj = rendition.currentLocation();
      if (locObj && locObj.start && locObj.start.percentage != null) {
        const percent = locObj.start.percentage * 100;
        els.readerStatus.textContent = '进度 ' + percent.toFixed(1) + '%';
        saveProgress(book.path, { loc: locObj.start.cfi, percent });
      }
      return true;
    })
    .catch(() => false);

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
  const c = state.current;
  if (!c || c.format !== 'epub' || !c.rendition) return;
  state.spread = !state.spread;
  c.rendition.spread(state.spread ? 'auto' : 'none', 700);
  if (isSettingsOpen()) updateSettingsValues();
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
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';
  els.readerContent.innerHTML = '';
  els.readerContent.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;
  els.readerStatus.textContent = '第 ' + c.page + ' / ' + c.pages + ' 页';
  saveProgress(c.path, { page: c.page });
}

async function openTxt(book) {
  const res = await window.api.readBook(book.path);
  const div = document.createElement('div');
  div.id = 'txt-content';
  div.textContent = res.text;
  els.readerContent.appendChild(div);
  applyTxtTypography();
  const saved = state.progress[book.path];
  setTimeout(() => {
    if (saved && typeof saved.offset === 'number') els.readerContent.scrollTop = saved.offset;
    updateTxtProgress(true);
  }, 0);
  els.readerContent.addEventListener('scroll', () => updateTxtProgress(false));
}

function updateTxtProgress(force) {
  const c = state.current;
  if (!c || c.format !== 'txt') return;
  const container = els.readerContent;
  const max = container.scrollHeight - container.clientHeight;
  const percent = max > 0 ? (container.scrollTop / max) * 100 : 0;
  els.readerStatus.textContent = '进度 ' + percent.toFixed(1) + '%';
  const now = Date.now();
  if (force || now - lastTxtSave > 600) {
    lastTxtSave = now;
    saveProgress(c.path, { offset: container.scrollTop, percent });
  }
}

function applyTxtTypography() {
  const div = els.readerContent.querySelector('#txt-content');
  if (div) {
    div.style.fontSize = state.txtFont + 'px';
    div.style.lineHeight = String(state.lineHeight);
  }
}

function nextPage() {
  const c = state.current;
  if (!c) return;
  if (c.format === 'epub') {
    if (c.rendition) { animatePage('next'); c.rendition.next(); }
  } else if (c.format === 'pdf') {
    if (c.page < c.pages) { c.page += 1; animatePage('next'); renderPdfPage(); }
  } else if (c.format === 'txt') {
    els.readerContent.scrollTop += els.readerContent.clientHeight * 0.9;
  }
}

function prevPage() {
  const c = state.current;
  if (!c) return;
  if (c.format === 'epub') {
    if (c.rendition) { animatePage('prev'); c.rendition.prev(); }
  } else if (c.format === 'pdf') {
    if (c.page > 1) { c.page -= 1; animatePage('prev'); renderPdfPage(); }
  } else if (c.format === 'txt') {
    els.readerContent.scrollTop -= els.readerContent.clientHeight * 0.9;
  }
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
  } else if (c.format === 'txt') {
    state.txtFont = Math.min(28, Math.max(12, state.txtFont + delta));
    applyTxtTypography();
  }
  if (isSettingsOpen()) updateSettingsValues();
}

function cycleLineHeight() {
  const options = [1.4, 1.6, 1.8, 2.0, 2.4];
  const idx = options.indexOf(state.lineHeight);
  state.lineHeight = options[(idx + 1) % options.length];
  if (state.current && state.current.format === 'epub') applyEpubTypography();
  if (state.current && state.current.format === 'txt') applyTxtTypography();
  if (isSettingsOpen()) updateSettingsValues();
  els.readerStatus.textContent = '行距 ' + state.lineHeight.toFixed(1);
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

    const a = document.createElement('a');
    a.href = '#';
    a.textContent = bm.label;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      jumpToBookmark(bm.loc);
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

    row.appendChild(a);
    row.appendChild(del);
    els.bookmarksPanel.appendChild(row);
  });
}

async function addBookmark() {
  const c = state.current;
  if (!c) return;
  let loc;
  let label;
  if (c.format === 'epub') {
    const locObj = c.rendition && c.rendition.currentLocation();
    if (!locObj || !locObj.start) {
      els.readerStatus.textContent = '暂无法获取当前位置';
      return;
    }
    loc = locObj.start.cfi;
    label = '书签 ' + (getBookmarkCount() + 1);
  } else if (c.format === 'pdf') {
    loc = String(c.page);
    label = '书签 ' + (getBookmarkCount() + 1) + '（第 ' + c.page + ' 页）';
  } else {
    loc = String(els.readerContent.scrollTop);
    label = '书签 ' + (getBookmarkCount() + 1);
  }
  state.bookmarks = addBookmarkToMap(state.bookmarks, c.path, { label, loc });
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

function getBookmarkCount() {
  return state.current ? (state.bookmarks[state.current.path] || []).length : 0;
}

async function jumpToBookmark(loc) {
  const c = state.current;
  if (!c) return;
  if (c.format === 'epub') c.rendition.display(loc);
  else if (c.format === 'pdf') {
    c.page = parseInt(loc, 10) || 1;
    await renderPdfPage();
  } else {
    els.readerContent.scrollTop = parseInt(loc, 10) || 0;
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
  $('btn-spread').addEventListener('click', toggleSpread);
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

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (isSettingsOpen()) {
        closeSettings();
        return;
      }
      hideContextMenu();
      return;
    }
    const c = state.current;
    if (!c) return;
    if (ev.key === 'ArrowRight' || ev.key === 'PageDown') {
      ev.preventDefault();
      nextPage();
    } else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') {
      ev.preventDefault();
      prevPage();
    }
  });
  window.addEventListener('resize', () => {
    const c = state.current;
    if (c && c.format === 'pdf') renderPdfPage();
    if (c && c.format === 'epub') resizeEpubRendition();
  });
}

window.__gaiaDebug = {
  openBook,
  nextPage,
  prevPage,
  addBookmark,
  removeBookmarkAt,
  togglePanel,
  toggleSpread,
  getSpreadMode: () => state.spread,
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
  getLibraryCount: () => state.library.length,
  getProgressKeys: () => Object.keys(state.progress),
  getSelectedCount: () => state.selected.size,
};

init();

