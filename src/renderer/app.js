'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  libraryView: $('library-view'),
  readerView: $('reader-view'),
  bookshelf: $('bookshelf'),
  hint: $('library-hint'),
  readerTitle: $('reader-title'),
  readerContent: $('reader-content'),
  readerStatus: $('reader-status'),
  tocPanel: $('toc-panel'),
  bookmarksPanel: $('bookmarks-panel'),
  pdfNav: $('pdf-nav'),
};

const state = {
  library: [],
  progress: {},
  bookmarks: {},
  current: null,
  fontSize: 100,
  lineHeight: 1.8,
  txtFont: 16,
};

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
}

function renderLibrary() {
  els.bookshelf.innerHTML = '';
  els.hint.hidden = state.library.length > 0;
  for (const book of state.library) {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.title = book.path;

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

    card.addEventListener('click', () => openBook(book));
    els.bookshelf.appendChild(card);
  }
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

function closeReaderContent() {
  const c = state.current;
  if (c) {
    if (c.rendition) { try { c.rendition.destroy(); } catch (e) {} }
    if (c.pdf) { try { c.pdf.destroy(); } catch (e) {} }
  }
  els.readerContent.innerHTML = '';
  els.pdfNav.hidden = true;
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
  els.readerView.hidden = true;
  els.libraryView.hidden = false;
  renderLibrary();
}

async function openBook(book) {
  closeReaderContent();
  els.libraryView.hidden = true;
  els.readerView.hidden = false;
  els.readerTitle.textContent = book.title || book.path;
  els.tocPanel.hidden = true;
  els.bookmarksPanel.hidden = true;
  els.tocPanel.innerHTML = '';
  els.readerStatus.textContent = '加载中…';
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
    const percent = location.start.percentage ? location.start.percentage * 100 : 0;
    els.readerStatus.textContent = '进度 ' + percent.toFixed(1) + '%';
    saveProgress(book.path, { loc: cfi, percent });
  });

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
  els.pdfNav.hidden = false;
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
}

function cycleLineHeight() {
  const options = [1.4, 1.6, 1.8, 2.0, 2.4];
  const idx = options.indexOf(state.lineHeight);
  state.lineHeight = options[(idx + 1) % options.length];
  if (state.current && state.current.format === 'epub') applyEpubTypography();
  if (state.current && state.current.format === 'txt') applyTxtTypography();
  els.readerStatus.textContent = '行距 ' + state.lineHeight.toFixed(1);
}

function togglePanel(which) {
  const tocOpen = which === 'toc';
  els.tocPanel.hidden = !tocOpen;
  els.bookmarksPanel.hidden = tocOpen;
}

function renderBookmarksPanel() {
  const c = state.current;
  els.bookmarksPanel.innerHTML = '';
  const list = c ? state.bookmarks[c.path] || [] : [];
  if (!list.length) {
    els.bookmarksPanel.textContent = '（还没有书签，点击右上角 +书签 添加）';
    return;
  }
  for (const bm of list) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = bm.label;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      jumpToBookmark(bm.loc);
    });
    els.bookmarksPanel.appendChild(a);
  }
}

async function addBookmark() {
  const c = state.current;
  if (!c) return;
  const list = state.bookmarks[c.path] || [];
  let loc;
  let label;
  if (c.format === 'epub') {
    const locObj = c.rendition && c.rendition.currentLocation();
    if (!locObj || !locObj.start) {
      els.readerStatus.textContent = '暂无法获取当前位置';
      return;
    }
    loc = locObj.start.cfi;
    label = '书签 ' + (list.length + 1);
  } else if (c.format === 'pdf') {
    loc = String(c.page);
    label = '书签 ' + (list.length + 1) + '（第 ' + c.page + ' 页）';
  } else {
    loc = String(els.readerContent.scrollTop);
    label = '书签 ' + (list.length + 1);
  }
  list.push({ label, loc });
  state.bookmarks[c.path] = list;
  await saveBookmarksNow();
  renderBookmarksPanel();
  els.readerStatus.textContent = '已添加书签';
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
  $('btn-import-files').addEventListener('click', async () => {
    const paths = await window.api.openFiles();
    if (paths.length) await importPaths(paths);
  });
  $('btn-import-folder').addEventListener('click', async () => {
    const paths = await window.api.openFolder();
    if (paths.length) await importPaths(paths);
  });
  $('btn-back').addEventListener('click', backToLibrary);
  $('btn-font-minus').addEventListener('click', () => adjustFont(-1));
  $('btn-font-plus').addEventListener('click', () => adjustFont(1));
  $('btn-line-height').addEventListener('click', cycleLineHeight);
  $('btn-toc').addEventListener('click', () => togglePanel('toc'));
  $('btn-bookmarks').addEventListener('click', () => togglePanel('bookmarks'));
  $('btn-add-bookmark').addEventListener('click', addBookmark);
  $('btn-prev-page').addEventListener('click', () => {
    const c = state.current;
    if (c && c.format === 'pdf' && c.page > 1) { c.page -= 1; renderPdfPage(); }
  });
  $('btn-next-page').addEventListener('click', () => {
    const c = state.current;
    if (c && c.format === 'pdf' && c.page < c.pages) { c.page += 1; renderPdfPage(); }
  });
  document.addEventListener('keydown', (ev) => {
    const c = state.current;
    if (!c) return;
    if (c.format === 'pdf' && ev.key === 'ArrowLeft' && c.page > 1) { c.page -= 1; renderPdfPage(); }
    if (c.format === 'pdf' && ev.key === 'ArrowRight' && c.page < c.pages) { c.page += 1; renderPdfPage(); }
  });
  window.addEventListener('resize', () => {
    const c = state.current;
    if (c && c.format === 'pdf') renderPdfPage();
  });
}

init();

window.__gaiaDebug = {
  openBook,
  getStatus: () => els.readerStatus.textContent,
};
