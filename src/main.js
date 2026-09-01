'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { parseEpub } = require('./shared/epub-meta');
const { decodeTxt, titleFromFilename } = require('./shared/txt-utils');
const { JsonStore } = require('./shared/store');
const { openMobi, loadChapter, cleanupMobi } = require('./shared/mobi');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([
  { scheme: 'bgm', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const SUPPORTED_EXT = ['.epub', '.pdf', '.txt', '.mobi', '.azw3'];
const IS_SMOKE = process.argv.includes('--smoke-test');
const DEBUG_OPEN_INDEX = process.argv.indexOf('--debug-open');
const DEBUG_OPEN_PATH = DEBUG_OPEN_INDEX >= 0 ? process.argv[DEBUG_OPEN_INDEX + 1] : null;
const SHOT_DIR_INDEX = process.argv.indexOf('--shot-dir');
const SHOT_DIR = SHOT_DIR_INDEX >= 0 ? process.argv[SHOT_DIR_INDEX + 1] : null;

if (IS_SMOKE) {
  app.setPath('userData', path.join(app.getPath('temp'), 'gaia-reading-smoke-' + process.pid));
}

if (SHOT_DIR) {
  const shotDataDir = path.join(app.getPath('temp'), 'gaia-reading-shot-' + process.pid);
  app.setPath('userData', shotDataDir);
  const realState = path.join(app.getPath('appData'), 'gaia-reading', 'gaia-reading.json');
  if (fs.existsSync(realState)) {
    fs.mkdirSync(shotDataDir, { recursive: true });
    fs.copyFileSync(realState, path.join(shotDataDir, 'gaia-reading.json'));
    console.log('SHOT_USES_REAL_LIBRARY');
  }
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
  } else if (format === 'mobi' || format === 'azw3') {
    const resDir = path.join(app.getPath('temp'), 'gaia-mobi-meta-' + process.pid);
    let opened = null;
    try {
      opened = await openMobi(filePath, resDir);
      return {
        path: filePath,
        format,
        title: opened.title || fallbackTitle,
        author: opened.author || '',
        cover: opened.cover || null,
      };
    } catch {
      // 解析失败时退回文件名标题
    } finally {
      cleanupMobi(opened);
    }
  }
  return { path: filePath, format, title: fallbackTitle, author: '', cover: null };
}

/** 解析 bgm://local/<file> 到磁盘上的音频文件（兼容开发目录与打包后的 app.asar.unpacked）。 */
function bgmFilePath(file) {
  const name = path.basename(String(file || ""));
  if (!name || name.indexOf("..") >= 0) return null;
  const appRoot = app.getAppPath();
  const candidates = [
    path.join(appRoot, 'assets', 'bgm', name),
    path.join(path.dirname(appRoot), 'app.asar.unpacked', 'assets', 'bgm', name),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}

function registerBgmProtocol() {
  protocol.handle('bgm', (request) => {
    try {
      const u = new URL(request.url);
      const file = u.pathname.replace(/^\//, '');
      const p = bgmFilePath(file);
      if (!p) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(p).toString());
    } catch (e) {
      return new Response('bad request', { status: 400 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: 'Gaia Reading',
    show: false,
    autoHideMenuBar: true,
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
          const debugExt = path.extname(DEBUG_OPEN_PATH).toLowerCase();
          if (debugExt === '.txt') {
            await mainWindow.webContents.executeJavaScript('window.__TXT_SMOKE_PATH = ' + JSON.stringify(DEBUG_OPEN_PATH) + ';');
            const txtScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'txt-smoke.js'), 'utf8');
            const txtStatus = await mainWindow.webContents.executeJavaScript(txtScript);
            console.log('DEBUG_TXT:', txtStatus);
            try {
              const parsed = JSON.parse(txtStatus);
              debugOk = parsed.contentLen > 0 && parsed.totalPages > 1 && parsed.pageAfter > parsed.pageBefore && parsed.pctMoved === true && parsed.wheelsAfterNav >= 1 && parsed.pCount >= 1 && parsed.anchorOk === true;
              if (!debugOk) console.error('DEBUG_TXT_CHECKS_FAILED:', JSON.stringify(parsed));
            } catch (parseErr) {
              debugOk = false;
              console.error('DEBUG_TXT_UNPARSEABLE:', parseErr && parseErr.message, txtStatus);
            }
          } else if (debugExt === '.mobi' || debugExt === '.azw3') {
            await mainWindow.webContents.executeJavaScript("window.__MOBI_SMOKE_PATH = " + JSON.stringify(DEBUG_OPEN_PATH) + "; window.__MOBI_SMOKE_FORMAT = " + JSON.stringify(debugExt.slice(1)) + ";");
            const mobiScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'mobi-smoke.js'), 'utf8');
            const mobiStatus = await mainWindow.webContents.executeJavaScript(mobiScript);
            console.log('DEBUG_MOBI:', mobiStatus);
            try {
              const parsed = JSON.parse(mobiStatus);
              debugOk =
                parsed.contentLen > 0 &&
                parsed.chapters > 0 &&
                typeof parsed.idxBefore === 'number' &&
                (parsed.scrollAfter > parsed.scrollBefore || parsed.idxAfter > parsed.idxBefore) &&
                parsed.pct != null &&
                parsed.moved > 0 &&
                parsed.pctMoved === true && parsed.wheelsAfterNav >= 1 &&
                parsed.eyeOk === true &&
                parsed.habitOk === true &&
                parsed.anchorOk === true;
              if (!debugOk) console.error('DEBUG_MOBI_CHECKS_FAILED:', JSON.stringify(parsed));
            } catch (parseErr) {
              debugOk = false;
              console.error('DEBUG_MOBI_UNPARSEABLE:', parseErr && parseErr.message, mobiStatus);
            }
          } else {
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
              await __gaiaDebug.setTheme('dark');
              await new Promise((r) => setTimeout(r, 400));
              const nightAfter = __gaiaDebug.isNight();
              const bodyDark = __gaiaDebug.isBodyDark();
              const darkInjected = __gaiaDebug.isDarkInjected();
              await __gaiaDebug.setTheme('eye');
              await new Promise((r) => setTimeout(r, 300));
              const eyeTheme = __gaiaDebug.getTheme() === 'eye';
              const bodyEye = __gaiaDebug.isBodyEye();
              await __gaiaDebug.setFont('song');
              await new Promise((r) => setTimeout(r, 300));
              const fontInjected = __gaiaDebug.isFontInjected();
              await new Promise((r) => setTimeout(r, 400));
              const pctBefore = __gaiaDebug.getPercent();
              const locBefore = __gaiaDebug.getLoc();
              await __gaiaDebug.nextPage();
              const pagingClass = __gaiaDebug.getPagingClass();
              await new Promise((r) => setTimeout(r, 800));
              const pctAfter = __gaiaDebug.getPercent();
              const locAfter = __gaiaDebug.getLoc();
              const progressWidth = __gaiaDebug.getProgressWidth();
              const wheelsAfterNav = __gaiaDebug.countBoundWheels();
              const bgmCapsule = !!document.getElementById("bgm-capsule");
              const bgmInTopbar = !!document.querySelector("#reader-view .topbar .bgm-capsule");
              const progTrack = document.getElementById("progress-track");
              const progressVisible = !!progTrack && progTrack.offsetHeight > 0 && !!document.getElementById("progress-fill");
              const bgmTrackBefore = __gaiaDebug.bgmState().trackId;
              await __gaiaDebug.bgmNext();
              const bgmTrackAfter = __gaiaDebug.bgmState().trackId;
              await __gaiaDebug.bgmSetVolume(0.3);
              const bgmVolumeOk = Math.abs(__gaiaDebug.bgmState().volume - 0.3) < 0.01;
              await __gaiaDebug.addBookmark();
              const countAfterAdd = __gaiaDebug.getBookmarkCount();
              const bmInfo = __gaiaDebug.getBookmarks();
              const bmChapter = bmInfo.length ? (bmInfo[bmInfo.length - 1].chapter || '') : '';
              const bmPercent = bmInfo.length ? bmInfo[bmInfo.length - 1].percent : null;
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
              __gaiaDebug.setMode('spread');
              await new Promise((r) => setTimeout(r, 600));
              const spreadAfter = __gaiaDebug.getSpreadMode();
              const epSizeAfterSpread = __gaiaDebug.getRenditionSize();
              __gaiaDebug.setMode('spread');
              __gaiaDebug.openSettings();
              await new Promise((r) => setTimeout(r, 350));
              const drawerOpen = __gaiaDebug.isSettingsOpen();
              const settingsCapsule = document.getElementById('bgm-capsule');
              const settingsDrawer = document.getElementById('settings-drawer');
              const settingsCapsuleRect = settingsCapsule.getBoundingClientRect();
              const settingsDrawerRect = settingsDrawer.getBoundingClientRect();
              const bgmAvoidsSettings = settingsCapsuleRect.right <= settingsDrawerRect.left - 16;
              const bgmSettingsState = settingsCapsule.dataset.settingsOpen === '1' && settingsCapsule.parentElement === document.body;
              __gaiaDebug.closeSettings();
              const drawerClosed = !__gaiaDebug.isSettingsOpen();
              const bgmSettingsRestored = settingsCapsule.dataset.settingsOpen === '0' && !!document.querySelector('#reader-view .topbar .bgm-capsule');
              await __gaiaDebug.setLineHeight(2);
              await __gaiaDebug.setMode('spread');
              await new Promise((r) => setTimeout(r, 500));
              await __gaiaDebug.backToLibrary();
              await __gaiaDebug.openBook({ path: fixture, format: 'epub', title: 'fixture' });
              await new Promise((r) => setTimeout(r, 1200));
              const reopenStatus = __gaiaDebug.getStatus();
              const reopenPct = __gaiaDebug.getDisplayPercent();
              const memAfter = __gaiaDebug.getCurrentSettings();
              const memOk = memAfter.theme === 'eye' && memAfter.fontName === 'song' && memAfter.spread === true && Math.abs(memAfter.lineHeight - 2) < 0.01;
              await __gaiaDebug.setTheme('light');
              if (__gaiaDebug.getSpreadMode()) await __gaiaDebug.setMode('single');
              await __gaiaDebug.addBookmark();
              await __gaiaDebug.addToLibrary({ path: fixture, format: 'epub', title: 'fixture' });
              const libAfterAdd = __gaiaDebug.getLibraryCount();
              const shelfOrderAfterRead = __gaiaDebug.getSortedLibrary();
              const shelfProgressCount = __gaiaDebug.getShelfProgressCount();
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
              console.log('DEBUG_NIGHT', nightBefore, nightAfter, bodyDark, darkInjected, eyeTheme, bodyEye, fontInjected, pagingClass);
              console.log('DEBUG_REOPEN', reopenStatus, reopenPct, memOk, shelfOrderAfterRead, shelfProgressCount);
              console.log('DEBUG_SPREAD', spreadBefore, spreadAfter, epSizeAfterSpread.w);
              console.log('DEBUG_PROGRESS', pctBefore, pctAfter);
              console.log('DEBUG_LOC', locBefore, locAfter);
              console.log('DEBUG_BOOKMARK', countAfterAdd, countAfterRemove);
              console.log('DEBUG_PANELS', bookmarksOpen, bookmarksClosed, tocOpen, tocClosed);
              console.log('DEBUG_SHELF', libAfterAdd, libAfterRemove, shelfBookmarkBeforeRemove, bookmarkCountAfterShelfRemove, progressCountAfterShelfRemove);
              console.log('DEBUG_BATCH', libAfterBatchAdd, bookmarkBeforeBatch, selectedCount, libAfterBatchRemove, bookmarkCountAfterBatchRemove, progressCountAfterBatchRemove);
              return JSON.stringify({ viewAfterSplash, splashHidden, drawerOpen, drawerClosed, bgmAvoidsSettings, bgmSettingsState, bgmSettingsRestored, epW: epSize.w, epH: epSize.h, spreadBefore, spreadAfter, epW2: epSizeAfterSpread.w, fxOnHome, particleCount, fxInReader, nightBefore, nightAfter, bodyDark, darkInjected, eyeTheme, bodyEye, fontInjected, pagingClass, reopenPct, reopenStatus, memOk, shelfOrderAfterRead, shelfProgressCount, fxOnLibrary, particleCountLibrary, trailCount, trailLoopRunning, diamondCount, pctBefore, pctAfter, locBefore, locAfter, progressWidth, wheelsAfterNav, bgmCapsule, bgmInTopbar, progressVisible, bgmTrackBefore, bgmTrackAfter, bgmVolumeOk, bmChapter, bmPercent, countAfterAdd, countAfterRemove, bookmarksOpen, bookmarksClosed, tocOpen, tocClosed, libAfterAdd, libAfterRemove, shelfBookmarkBeforeRemove, bookmarkCountAfterShelfRemove, progressCountAfterShelfRemove, libAfterBatchAdd, bookmarkBeforeBatch, selectedCount, libAfterBatchRemove, bookmarkCountAfterBatchRemove, progressCountAfterBatchRemove });
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
              parsed.bgmAvoidsSettings === true &&
              parsed.bgmSettingsState === true &&
              parsed.bgmSettingsRestored === true &&
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
              parsed.eyeTheme === true &&
              parsed.bodyEye === true &&
              parsed.fontInjected === true &&
              parsed.fxOnLibrary === true &&
              parsed.particleCountLibrary > 0 &&
              parsed.trailCount > 0 &&
              parsed.trailLoopRunning === true &&
              parsed.diamondCount > 0 &&
              parsed.locBefore !== parsed.locAfter &&
              parsed.pctAfter != null &&
              parsed.pctAfter > parsed.pctBefore &&
              parsed.progressWidth !== '' &&
              parseFloat(parsed.progressWidth) > 0 && parsed.wheelsAfterNav >= 1 &&
              parsed.pagingClass.indexOf('paging-next') >= 0 &&
              parsed.reopenPct > 0 &&
              parsed.memOk === true &&
              parsed.shelfOrderAfterRead[0] === DEBUG_OPEN_PATH &&
              parsed.shelfProgressCount >= 1 &&
              parsed.countAfterAdd === 1 &&
              parsed.bgmCapsule === true &&
              parsed.bgmInTopbar === true &&
              parsed.progressVisible === true &&
              parsed.bgmTrackAfter !== parsed.bgmTrackBefore &&
              parsed.bgmVolumeOk === true &&
              parsed.bmChapter.length > 0 &&
              typeof parsed.bmPercent === 'number' && parsed.bmPercent >= 0 &&
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
          } catch (parseErr) {
            debugOk = false;
            console.error('DEBUG_RESULT_UNPARSEABLE:', parseErr && parseErr.message, 'len=' + status.length, status);
          }
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

  if (SHOT_DIR) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const capture = async (name) => {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(path.join(SHOT_DIR, name), image.toPNG());
          console.log('SHOT_SAVED', name);
        };
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        await wait(700);
        await capture('splash.png');
        await mainWindow.webContents.executeJavaScript('window.__gaiaDebug.waitHome()');
        await wait(1700);
        await capture('home.png');
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.showView('library')");
        await wait(900);
        await capture('bookshelf.png');

        if (DEBUG_OPEN_PATH && /\.(mobi|azw3|txt)$/i.test(DEBUG_OPEN_PATH)) {
          const ext = path.extname(DEBUG_OPEN_PATH).toLowerCase().slice(1);
          await mainWindow.webContents.executeJavaScript(`__gaiaDebug.openBook(${JSON.stringify({ path: DEBUG_OPEN_PATH, format: ext, title: '阅读测试' })})`);
          await wait(3000);
          await mainWindow.webContents.executeJavaScript("__gaiaDebug.jumpToMobiChapter(10)");
          await wait(1200);
          await mainWindow.webContents.executeJavaScript("__gaiaDebug.jumpToMobiChapter(0)");
          await wait(1000);
          await mainWindow.webContents.executeJavaScript("__gaiaDebug.setMode('spread')");
          await wait(1600);
          await mainWindow.webContents.executeJavaScript("__gaiaDebug.setMode('single')");
          await mainWindow.webContents.executeJavaScript("__gaiaDebug.setTheme('dark')");
          await wait(1200);
          await capture('night_reader.png');
          console.log('SHOTS_DONE');
          app.exit(0);
          return;
        }

        const book = await mainWindow.webContents.executeJavaScript(`(async () => {
          const lib = __gaiaDebug.getLibrary();
          return lib.find((b) => b.format === 'epub') || lib[0] || null;
        })()`);
        if (!book) throw new Error('本地书架为空，无法截取阅读界面');
        await mainWindow.webContents.executeJavaScript(`__gaiaDebug.openBook(${JSON.stringify(book)})`);
        await wait(3200);
        await capture('reader.png');
        await mainWindow.webContents.executeJavaScript('__gaiaDebug.openLongestChapter()');
        await wait(2500);
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.setMode('spread')");
        await wait(1600);
        await capture('spread.png');
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.setTheme('dark')");
        await wait(900);
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.showView('home')");
        await wait(1700);
        await capture('night_home.png');
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.showView('library')");
        await wait(900);
        await capture('night_bookshelf.png');
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.showView('reader')");
        await wait(1400);
        await capture('night_reader.png');
        console.log('SHOTS_DONE');
        app.exit(0);
      } catch (err) {
        console.error('SHOT_ERROR', err);
        app.exit(1);
      }
    });
  }
}

ipcMain.handle('dialog:openFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择电子书文件',
    filters: [{ name: '电子书', extensions: ['epub', 'pdf', 'txt', 'mobi', 'azw3'] }],
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

const mobiSessions = new Map();
let mobiSessionSeq = 0;

ipcMain.handle('mobi:open', async (event, filePath) => {
  const format = formatOf(filePath);
  if (format !== 'mobi' && format !== 'azw3') throw new Error('不是 MOBI/AZW3 文件: ' + filePath);
  const resourceSaveDir = path.join(app.getPath('temp'), 'gaia-mobi-' + process.pid + '-' + (mobiSessionSeq + 1));
  const opened = await openMobi(filePath, resourceSaveDir);
  const sessionId = 'mobi-' + (++mobiSessionSeq);
  mobiSessions.set(sessionId, { opened, resourceSaveDir });
  return {
    sessionId,
    kind: opened.kind,
    title: opened.title,
    author: opened.author,
    cover: opened.cover,
    chapters: opened.chapters,
    toc: opened.toc,
  };
});

ipcMain.handle('mobi:chapter', async (event, { sessionId, index }) => {
  const session = mobiSessions.get(sessionId);
  if (!session) throw new Error('MOBI 会话已失效，请重新打开');
  const ch = await loadChapter(session.opened, index, session.resourceSaveDir);
  return ch;
});

ipcMain.handle('mobi:close', (event, sessionId) => {
  const session = mobiSessions.get(sessionId);
  if (session) {
    cleanupMobi(session.opened);
    mobiSessions.delete(sessionId);
  }
  return true;
});


ipcMain.handle('state:get', (event, key) => store.get(key, null));
ipcMain.handle('state:set', (event, { key, value }) => {
  store.set(key, value);
  return true;
});
ipcMain.handle('file:exists', (event, filePath) => fs.existsSync(filePath));

function setupMenu() {
  const template = [
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '恢复' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  store = new JsonStore(path.join(app.getPath('userData'), 'gaia-reading.json'));
  registerBgmProtocol();
  setupMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});






















