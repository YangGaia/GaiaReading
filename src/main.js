'use strict';

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseEpub } = require('./shared/epub-meta');
const { decodeTxt, titleFromFilename } = require('./shared/txt-utils');
const { JsonStore } = require('./shared/store');

const SUPPORTED_EXT = ['.epub', '.pdf', '.txt'];
const IS_SMOKE = process.argv.includes('--smoke-test');
const DEBUG_OPEN_INDEX = process.argv.indexOf('--debug-open');
const DEBUG_OPEN_PATH = DEBUG_OPEN_INDEX >= 0 ? process.argv[DEBUG_OPEN_INDEX + 1] : null;

if (IS_SMOKE) {
  app.setPath('userData', path.join(app.getPath('temp'), 'gaia-reading-smoke-' + process.pid));
}

let mainWindow = null;
let store = null;

function formatOf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXT.includes(ext) ? ext.slice(1) : null;
}

function scanFolder(dir, out, depth) {
  if (depth <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanFolder(full, out, depth - 1);
    else if (entry.isFile() && formatOf(full)) out.push(full);
  }
}

async function metaFor(filePath) {
  const format = formatOf(filePath);
  const fallbackTitle = titleFromFilename(path.basename(filePath));
  if (format === 'epub') {
    try {
      const meta = await parseEpub(fs.readFileSync(filePath));
      return {
        path: filePath,
        format,
        title: meta.title || fallbackTitle,
        author: meta.author || '',
        cover: meta.cover ? `data:${meta.cover.mime};base64,${meta.cover.base64}` : null,
      };
    } catch {
      // 解析失败时退回文件名标题
    }
  }
  return { path: filePath, format, title: fallbackTitle, author: '', cover: null };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: 'Gaia Reading',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (IS_SMOKE) {
    const messages = [];
    mainWindow.webContents.on('console-message', (event, level, message) => {
      messages.push({ level, message });
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 800));
        let debugOk = true;
        if (DEBUG_OPEN_PATH) {
          const script = `(async () => {
            try {
              const fixture = ${JSON.stringify(DEBUG_OPEN_PATH)};
              await __gaiaDebug.waitHome();
              const viewAfterSplash = __gaiaDebug.getView();
              const splashHidden = __gaiaDebug.isSplashHidden();
              const fxOnHome = __gaiaDebug.isFxActive();
              __gaiaDebug.burst(200, 200);
              await new Promise((r) => setTimeout(r, 60));
              const particleCount = __gaiaDebug.getParticleCount();
              __gaiaDebug.clearFx();
              __gaiaDebug.trailPoint(100, 100);
              __gaiaDebug.trailPoint(140, 100);
              __gaiaDebug.trailPoint(180, 100);
              __gaiaDebug.trailPoint(220, 100);
              __gaiaDebug.trailPoint(260, 100);
              await new Promise((r) => setTimeout(r, 120));
              const trailCount = __gaiaDebug.getParticleCount();
              const trailLoopRunning = __gaiaDebug.isFxLoopRunning();
              const diamondCount = __gaiaDebug.getDiamondCount();
              await __gaiaDebug.openBook({ path: fixture, format: 'epub', title: 'fixture' });
              await __gaiaDebug.waitLocations();
              const fxInReader = __gaiaDebug.isFxActive();
              const nightBefore = __gaiaDebug.isNight();
              __gaiaDebug.toggleNight();
              await new Promise((r) => setTimeout(r, 400));
              const nightAfter = __gaiaDebug.isNight();
              const bodyDark = __gaiaDebug.isBodyDark();
              const darkInjected = __gaiaDebug.isDarkInjected();
              __gaiaDebug.toggleNight();
              await new Promise((r) => setTimeout(r, 400));
              const pctBefore = __gaiaDebug.getPercent();
              const locBefore = __gaiaDebug.getLoc();
              await __gaiaDebug.nextPage();
              await new Promise((r) => setTimeout(r, 800));
              const pctAfter = __gaiaDebug.getPercent();
              const locAfter = __gaiaDebug.getLoc();
              await __gaiaDebug.addBookmark();
              const countAfterAdd = __gaiaDebug.getBookmarkCount();
              await __gaiaDebug.removeBookmarkAt(0);
              const countAfterRemove = __gaiaDebug.getBookmarkCount();
              __gaiaDebug.togglePanel('bookmarks');
              const bookmarksOpen = !__gaiaDebug.getPanels().bookmarksHidden;
              __gaiaDebug.togglePanel('bookmarks');
              const bookmarksClosed = __gaiaDebug.getPanels().bookmarksHidden;
              __gaiaDebug.togglePanel('toc');
              const tocOpen = !__gaiaDebug.getPanels().tocHidden;
              __gaiaDebug.togglePanel('toc');
              const tocClosed = __gaiaDebug.getPanels().tocHidden;
              __gaiaDebug.togglePanel('toc');
              await __gaiaDebug.nextPage();
              await new Promise((r) => setTimeout(r, 600));
              __gaiaDebug.togglePanel('toc');
              await new Promise((r) => setTimeout(r, 400));
              const epSize = __gaiaDebug.getRenditionSize();
              const spreadBefore = __gaiaDebug.getSpreadMode();
              __gaiaDebug.toggleSpread();
              await new Promise((r) => setTimeout(r, 600));
              const spreadAfter = __gaiaDebug.getSpreadMode();
              const epSizeAfterSpread = __gaiaDebug.getRenditionSize();
              __gaiaDebug.toggleSpread();
              __gaiaDebug.openSettings();
              const drawerOpen = __gaiaDebug.isSettingsOpen();
              __gaiaDebug.closeSettings();
              const drawerClosed = !__gaiaDebug.isSettingsOpen();
              await __gaiaDebug.addBookmark();
              await __gaiaDebug.addToLibrary({ path: fixture, format: 'epub', title: 'fixture' });
              const libAfterAdd = __gaiaDebug.getLibraryCount();
              const shelfBookmarkBeforeRemove = __gaiaDebug.getBookmarkCount();
              await __gaiaDebug.removeFromShelf({ path: fixture });
              const libAfterRemove = __gaiaDebug.getLibraryCount();
              const bookmarkCountAfterShelfRemove = __gaiaDebug.getBookmarkCount();
              const progressCountAfterShelfRemove = __gaiaDebug.getProgressKeys().length;
              await __gaiaDebug.addToLibrary({ path: fixture, format: 'epub', title: 'fixture' });
              await __gaiaDebug.addToLibrary({ path: '/fake/book2.epub', format: 'epub', title: 'fake2' });
              const libAfterBatchAdd = __gaiaDebug.getLibraryCount();
              await __gaiaDebug.addBookmark();
              const bookmarkBeforeBatch = __gaiaDebug.getBookmarkCount();
              await __gaiaDebug.selectBook(fixture);
              await __gaiaDebug.selectBook('/fake/book2.epub');
              const selectedCount = __gaiaDebug.getSelectedCount();
              await __gaiaDebug.batchRemoveSelected();
              const libAfterBatchRemove = __gaiaDebug.getLibraryCount();
              const bookmarkCountAfterBatchRemove = __gaiaDebug.getBookmarkCount();
              const progressCountAfterBatchRemove = __gaiaDebug.getProgressKeys().length;
              await __gaiaDebug.backToLibrary();
              await new Promise((r) => setTimeout(r, 200));
              const fxOnLibrary = __gaiaDebug.isFxActive();
              __gaiaDebug.burst(150, 150);
              await new Promise((r) => setTimeout(r, 50));
              const particleCountLibrary = __gaiaDebug.getParticleCount();
              console.log('DEBUG_VIEW', viewAfterSplash, splashHidden, drawerOpen, drawerClosed, epSize.w, epSize.h);
              console.log('DEBUG_FX', fxOnHome, particleCount, fxInReader, fxOnLibrary, particleCountLibrary, trailCount, trailLoopRunning, diamondCount, diamondCount);
              console.log('DEBUG_NIGHT', nightBefore, nightAfter, bodyDark, darkInjected);
              console.log('DEBUG_SPREAD', spreadBefore, spreadAfter, epSizeAfterSpread.w);
              console.log('DEBUG_PROGRESS', pctBefore, pctAfter);
              console.log('DEBUG_LOC', locBefore, locAfter);
              console.log('DEBUG_BOOKMARK', countAfterAdd, countAfterRemove);
              console.log('DEBUG_PANELS', bookmarksOpen, bookmarksClosed, tocOpen, tocClosed);
              console.log('DEBUG_SHELF', libAfterAdd, libAfterRemove, shelfBookmarkBeforeRemove, bookmarkCountAfterShelfRemove, progressCountAfterShelfRemove);
              console.log('DEBUG_BATCH', libAfterBatchAdd, bookmarkBeforeBatch, selectedCount, libAfterBatchRemove, bookmarkCountAfterBatchRemove, progressCountAfterBatchRemove);
              return JSON.stringify({ viewAfterSplash, splashHidden, drawerOpen, drawerClosed, epW: epSize.w, epH: epSize.h, spreadBefore, spreadAfter, epW2: epSizeAfterSpread.w, fxOnHome, particleCount, fxInReader, nightBefore, nightAfter, bodyDark, darkInjected, fxOnLibrary, particleCountLibrary, trailCount, trailLoopRunning, diamondCount, pctBefore, pctAfter, locBefore, locAfter, countAfterAdd, countAfterRemove, bookmarksOpen, bookmarksClosed, tocOpen, tocClosed, libAfterAdd, libAfterRemove, shelfBookmarkBeforeRemove, bookmarkCountAfterShelfRemove, progressCountAfterShelfRemove, libAfterBatchAdd, bookmarkBeforeBatch, selectedCount, libAfterBatchRemove, bookmarkCountAfterBatchRemove, progressCountAfterBatchRemove });
            } catch (e) {
              console.error('DEBUG_OPEN_ERROR', e && (e.stack || e.message || String(e)));
              return 'ERROR';
            }
          })()`;
          const status = await mainWindow.webContents.executeJavaScript(script);
          console.log('DEBUG_STATUS:', status);
          try {
            const parsed = JSON.parse(status);
            debugOk =
              parsed.viewAfterSplash === 'home' &&
              parsed.splashHidden === true &&
              parsed.drawerOpen === true &&
              parsed.drawerClosed === true &&
              parsed.epW > 0 &&
              parsed.epH > 0 &&
              parsed.spreadBefore === false &&
              parsed.spreadAfter === true &&
              parsed.epW2 > 0 &&
              parsed.fxOnHome === true &&
              parsed.particleCount > 0 &&
              parsed.fxInReader === false &&
              parsed.nightBefore === false &&
              parsed.nightAfter === true &&
              parsed.bodyDark === true &&
              parsed.darkInjected === true &&
              parsed.fxOnLibrary === true &&
              parsed.particleCountLibrary > 0 &&
              parsed.trailCount > 0 &&
              parsed.trailLoopRunning === true &&
              parsed.diamondCount > 0 &&
              parsed.locBefore !== parsed.locAfter &&
              parsed.pctAfter != null &&
              parsed.pctAfter > parsed.pctBefore &&
              parsed.countAfterAdd === 1 &&
              parsed.countAfterRemove === 0 &&
              parsed.bookmarksOpen === true &&
              parsed.bookmarksClosed === true &&
              parsed.tocOpen === true &&
              parsed.tocClosed === true &&
              parsed.libAfterAdd === 1 &&
              parsed.libAfterRemove === 0 &&
              parsed.shelfBookmarkBeforeRemove === 1 &&
              parsed.bookmarkCountAfterShelfRemove === 0 &&
              parsed.progressCountAfterShelfRemove === 0 &&
              parsed.libAfterBatchAdd === 2 &&
              parsed.bookmarkBeforeBatch === 1 &&
              parsed.selectedCount === 2 &&
              parsed.libAfterBatchRemove === 0 &&
              parsed.bookmarkCountAfterBatchRemove === 0 &&
              parsed.progressCountAfterBatchRemove === 0;
            if (!debugOk) console.error('DEBUG_CHECKS_FAILED:', JSON.stringify(parsed));
          } catch {
            debugOk = false;
            console.error('DEBUG_RESULT_UNPARSEABLE:', status);
          }
        }
        const errors = messages.filter((m) => m.level >= 3);
        if (errors.length || !debugOk) {
          if (errors.length) console.error('SMOKE_ERRORS:', JSON.stringify(errors.map((e) => e.message)));
          app.exit(1);
        } else {
          console.log('SMOKE_OK');
          app.exit(0);
        }
      } catch (err) {
        console.error('SMOKE_HARNESS_ERROR:', err);
        app.exit(1);
      }
    });
  }
}

ipcMain.handle('dialog:openFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择电子书文件',
    filters: [{ name: '电子书', extensions: ['epub', 'pdf', 'txt'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled) return [];
  return res.filePaths.filter((p) => formatOf(p));
});

ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择电子书文件夹',
    properties: ['openDirectory'],
  });
  if (res.canceled) return [];
  const out = [];
  scanFolder(res.filePaths[0], out, 8);
  return out;
});

ipcMain.handle('book:read', async (event, filePath) => {
  const format = formatOf(filePath);
  if (!format) throw new Error('不支持的文件格式: ' + filePath);
  const buf = fs.readFileSync(filePath);
  if (format === 'txt') {
    const { text, encoding } = decodeTxt(buf);
    return { format, text, encoding };
  }
  return { format, data: buf };
});

ipcMain.handle('book:metadata', async (event, filePath) => metaFor(filePath));

ipcMain.handle('state:get', (event, key) => store.get(key, null));
ipcMain.handle('state:set', (event, { key, value }) => {
  store.set(key, value);
  return true;
});
ipcMain.handle('file:exists', (event, filePath) => fs.existsSync(filePath));

app.whenReady().then(() => {
  store = new JsonStore(path.join(app.getPath('userData'), 'gaia-reading.json'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});






