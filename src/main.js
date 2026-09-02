'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, safeStorage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const JSZip = require('jszip');
const { pathToFileURL } = require('url');
const { parseEpub } = require('./shared/epub-meta');
const { decodeTxt, titleFromFilename } = require('./shared/txt-utils');
const { JsonStore } = require('./shared/store');
const { prepareDataFile } = require('./shared/data-upgrade');
const { openMobi, loadChapter, cleanupMobi } = require('./shared/mobi');
const { repairEpubBuffer } = require('./shared/epub-repair');
const GaiaAi = require('./shared/ai');
const Lookup = require('./shared/lookup');

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
let dictionaryWindow = null;
let dictionarySessionSecured = false;
let store = null;
const repairedEpubCache = new Map();

function aiSecretFile() {
  return path.join(app.getPath('userData'), 'gaia-ai-key.bin');
}

function readAiSecrets() {
  const secretPath = aiSecretFile();
  if (!fs.existsSync(secretPath)) return {};
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用，无法读取 API Key');
  try {
    const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(secretPath)));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    throw new Error('已保存的 API Key 无法解密，请重新填写');
  }
}

function writeAiSecrets(secrets) {
  const secretPath = aiSecretFile();
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用，API Key 不会以明文保存');
  if (!Object.keys(secrets).length) {
    try { if (fs.existsSync(secretPath)) fs.unlinkSync(secretPath); } catch (error) {}
    return;
  }
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, safeStorage.encryptString(JSON.stringify(secrets)));
}

function readAiSecret(profileId) {
  return String(readAiSecrets()[String(profileId || '')] || '');
}

function writeAiSecret(profileId, value) {
  const secret = String(value || '').trim();
  const secrets = readAiSecrets();
  const id = String(profileId || '');
  if (secret) secrets[id] = secret;
  else delete secrets[id];
  writeAiSecrets(secrets);
}

function migrateLegacyAiProfile() {
  let legacy;
  try { legacy = GaiaAi.normalizeConfig(store ? store.get('aiConfig', GaiaAi.DEFAULT_CONFIG) : GaiaAi.DEFAULT_CONFIG); }
  catch (error) { legacy = GaiaAi.normalizeConfig(GaiaAi.DEFAULT_CONFIG); }
  const profile = GaiaAi.normalizeProfile({
    id: 'profile-legacy',
    name: (GaiaAi.PROVIDERS[legacy.provider] || GaiaAi.PROVIDERS.custom).label,
    ...legacy,
  });
  const profiles = { activeId: profile.id, items: [profile] };
  if (store) store.set('aiProfiles', profiles);
  try {
    const secrets = readAiSecrets();
    const legacyScope = GaiaAi.secretScopeKey(legacy);
    const hadLegacySecret = Object.prototype.hasOwnProperty.call(secrets, legacyScope);
    if (secrets[legacyScope] && !secrets[profile.id]) secrets[profile.id] = secrets[legacyScope];
    if (hadLegacySecret) {
      delete secrets[legacyScope];
      writeAiSecrets(secrets);
    }
  } catch (error) {
    console.warn('AI_KEY_MIGRATION_FAILED', error.message);
  }
  return profiles;
}

function getAiProfiles() {
  const stored = store ? store.get('aiProfiles', null) : null;
  try {
    const profiles = GaiaAi.normalizeProfiles(stored);
    if (profiles.items.length) return profiles;
  } catch (error) {}
  return migrateLegacyAiProfile();
}

function publicAiProfile(profile) {
  const value = GaiaAi.normalizeProfile(profile);
  let hasApiKey = false;
  try { hasApiKey = GaiaAi.providerNeedsKey(value.provider) && !!readAiSecret(value.id); } catch (error) {}
  return { ...value, hasApiKey, targetHost: new URL(value.baseUrl).host };
}

function publicAiProfiles(profiles) {
  const value = GaiaAi.normalizeProfiles(profiles || getAiProfiles());
  return { activeId: value.activeId, items: value.items.map(publicAiProfile) };
}

function aiProfileById(profileId) {
  const profiles = getAiProfiles();
  const requested = String(profileId || profiles.activeId);
  const profile = profiles.items.find((item) => item.id === requested);
  if (!profile) throw new Error('所选 AI 接口不存在，请重新选择');
  return profile;
}

function aiKeyForProfile(profile) {
  return GaiaAi.providerNeedsKey(profile.provider) ? readAiSecret(profile.id) : '';
}

function aiFetch(url, options) {
  return net.fetch(url, options);
}

function epubFileStamp(filePath) {
  const stat = fs.statSync(filePath);
  return stat.size + ':' + stat.mtimeMs;
}

function cachedRepairedEpub(filePath) {
  const cached = repairedEpubCache.get(filePath);
  if (!cached) return null;
  try {
    if (cached.stamp === epubFileStamp(filePath)) return cached;
  } catch (error) {}
  repairedEpubCache.delete(filePath);
  return null;
}

function rememberRepairedEpub(filePath, repaired) {
  repairedEpubCache.delete(filePath);
  repairedEpubCache.set(filePath, { ...repaired, stamp: epubFileStamp(filePath) });
  while (repairedEpubCache.size > 2) repairedEpubCache.delete(repairedEpubCache.keys().next().value);
}

async function readableEpub(filePath, sourceBuffer) {
  const cached = cachedRepairedEpub(filePath);
  if (cached) return cached;
  const source = sourceBuffer || fs.readFileSync(filePath);
  try {
    await JSZip.loadAsync(source);
    return { buffer: source, failures: [], recovered: false };
  } catch (originalError) {
    const repaired = await repairEpubBuffer(source);
    const result = { ...repaired, recovered: true };
    rememberRepairedEpub(filePath, result);
    console.warn('EPUB_AUTO_REPAIRED', path.basename(filePath), repaired.failures.map((item) => item.fileName));
    return result;
  }
}

function displayFrequencyForWindow(win) {
  if (!win || win.isDestroyed()) return null;
  const display = screen.getDisplayMatching(win.getBounds());
  const frequency = Number(display && display.displayFrequency);
  return Number.isFinite(frequency) && frequency > 0 ? Math.round(frequency) : null;
}

function dictionaryNavigationAllowed(value) {
  return Lookup.isAllowedDictionaryUrl(value);
}

function createDictionaryWindow() {
  if (dictionaryWindow && !dictionaryWindow.isDestroyed()) return dictionaryWindow;
  dictionaryWindow = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 420,
    minHeight: 420,
    title: 'Gaia 字典',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      partition: 'gaia-dictionary',
    },
  });
  const contents = dictionaryWindow.webContents;
  const dictionarySession = contents.session;
  dictionarySession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  if (!dictionarySessionSecured) {
    dictionarySessionSecured = true;
    dictionarySession.on('will-download', (event) => event.preventDefault());
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (dictionaryNavigationAllowed(url) && dictionaryWindow && !dictionaryWindow.isDestroyed()) {
      dictionaryWindow.loadURL(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!dictionaryNavigationAllowed(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!dictionaryNavigationAllowed(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('page-title-updated', (event) => event.preventDefault());
  dictionaryWindow.on('closed', () => { dictionaryWindow = null; });
  return dictionaryWindow;
}

function openDictionary(query) {
  const normalized = Lookup.normalizeLookupText(query, 80);
  const target = Lookup.dictionaryUrl(normalized);
  const win = createDictionaryWindow();
  win.setTitle('Gaia 字典 · ' + normalized);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.loadURL(target).catch((error) => console.warn('DICTIONARY_LOAD_FAILED', error.message));
  return { ok: true, query: normalized, targetHost: new URL(target).host };
}

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
      const readable = await readableEpub(filePath, fs.readFileSync(filePath));
      const meta = await parseEpub(readable.buffer);
      return {
        path: filePath,
        format,
        title: meta.title || fallbackTitle,
        author: meta.author || '',
        cover: meta.cover ? `data:${meta.cover.mime};base64,${meta.cover.base64}` : null,
        recovered: readable.recovered,
        recoveredEntries: readable.failures.map((item) => item.fileName),
      };
    } catch (error) {
      throw new Error('EPUB 文件损坏且无法自动恢复：' + (error && error.message ? error.message : '未知错误'));
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
  let displayUpdateTimer = null;
  const sendDisplayFrequency = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('display:frequency-changed', displayFrequencyForWindow(mainWindow));
  };
  const scheduleDisplayFrequency = () => {
    clearTimeout(displayUpdateTimer);
    displayUpdateTimer = setTimeout(sendDisplayFrequency, 120);
  };
  mainWindow.on('move', scheduleDisplayFrequency);
  mainWindow.on('resize', scheduleDisplayFrequency);
  screen.on('display-metrics-changed', scheduleDisplayFrequency);
  mainWindow.on('closed', () => {
    clearTimeout(displayUpdateTimer);
    screen.removeListener('display-metrics-changed', scheduleDisplayFrequency);
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
                Math.abs(parsed.endPercent - 100) < 0.001 &&
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
              const importResult = await __gaiaDebug.importPaths([fixture]);
              const importedBook = __gaiaDebug.getLibrary().find((book) => book.path === fixture);
              const importSucceeded = importResult.added === 1 && importResult.failures.length === 0 && !!importedBook;
              await __gaiaDebug.openBook(importedBook || { path: fixture, format: 'epub', title: 'fixture' });
              await __gaiaDebug.waitLocations();
              const aiUi = __gaiaDebug.getAiUiState();
              const aiSource = __gaiaDebug.getAiChapterSource();
              __gaiaDebug.openAiCenter('reader');
              const aiCenterOpened = __gaiaDebug.getView() === 'ai';
              const aiCenterCard = document.querySelector('.ai-config-card');
              const aiCenterLayout = !!aiCenterCard && aiCenterCard.offsetWidth >= 420 && aiCenterCard.offsetHeight > 300;
              const aiModelPresets = document.getElementById('ai-model-options').children.length >= 3;
              document.getElementById('btn-ai-model-menu').click();
              const modelMenu = document.getElementById('ai-model-options');
              const aiModelMenuScrollable = !modelMenu.hidden && getComputedStyle(modelMenu).overflowY === 'auto' && modelMenu.clientHeight <= 220;
              document.getElementById('btn-ai-model-menu').click();
              document.getElementById('btn-ai-back').click();
              const aiCenterReturned = __gaiaDebug.getView() === 'reader';
              __gaiaDebug.openAiAssistant();
              const aiChatState = __gaiaDebug.getAiChatState();
              const aiPanelRect = document.getElementById('ai-summary-panel').getBoundingClientRect();
              const aiPanelOpened = !document.getElementById('ai-summary-panel').hidden && aiChatState.messages >= 1 &&
                aiPanelRect.width >= 340 && aiPanelRect.left > 0 && aiPanelRect.right < innerWidth;
              const aiChapterLabelMatches = document.getElementById('ai-summary-chapter').textContent === aiSource.chapterTitle;
              document.getElementById('btn-ai-appearance').click();
              const aiAppearanceCompact = !document.getElementById('ai-appearance-popover').hidden && !document.querySelector('.ai-typography-toolbar');
              document.getElementById('btn-ai-appearance').click();
              document.getElementById('btn-ai-tab-summary').click();
              const aiSummaryTabReady = document.getElementById('ai-chat-pane').hidden && !document.getElementById('ai-summary-pane').hidden;
              document.getElementById('btn-ai-tab-chat').click();
              document.getElementById('btn-ai-summary-minimize').click();
              const minimizedPanel = document.getElementById('ai-summary-panel');
              const minimizedRect = minimizedPanel.getBoundingClientRect();
              const aiMinimizedLayout = minimizedPanel.classList.contains('minimized') && minimizedRect.width <= 280 && minimizedRect.height === 50 &&
                getComputedStyle(document.getElementById('btn-ai-chat-clear')).display === 'none' &&
                getComputedStyle(document.getElementById('btn-ai-appearance')).display === 'none' &&
                document.getElementById('btn-ai-summary-minimize').getAttribute('aria-label') === '还原 AI 阅读助手';
              document.getElementById('btn-ai-summary-minimize').click();
              const aiRestoredLayout = !minimizedPanel.classList.contains('minimized') && minimizedPanel.getBoundingClientRect().width >= 340 &&
                document.getElementById('btn-ai-summary-minimize').getAttribute('aria-label') === '最小化 AI 阅读助手';
              const selectionAiTools = ['ai-analyze', 'ai-ask', 'dictionary', 'search'].every((action) => !!document.querySelector('[data-selection-action="' + action + '"]'));
              __gaiaDebug.openAiAssistant();
              const selectionDismissed = await __gaiaDebug.verifySelectionDismissal();
              const aiUiReady = aiUi.homeEntry && aiUi.centerView && aiUi.settingsSection && aiUi.summaryButton && aiUi.summaryPanel &&
                aiUi.readerTrigger && aiUi.chatInput && aiUi.profileCount >= 1 && aiUi.floatingWindow && aiCenterOpened && aiCenterLayout && aiModelPresets && aiModelMenuScrollable && aiCenterReturned && aiPanelOpened && aiChapterLabelMatches && aiAppearanceCompact && aiSummaryTabReady && aiMinimizedLayout && aiRestoredLayout && selectionAiTools && selectionDismissed &&
                aiSource.bookPath === fixture && aiSource.chapterId.startsWith('epub:') && aiSource.content.length > 0;
              const annotationsBefore = __gaiaDebug.getAnnotations().length;
              const selectionPrepared = __gaiaDebug.prepareAnnotationSelectionForTest('烟雾测试摘录');
              document.querySelector('[data-selection-action="note"]').click();
              await new Promise((r) => setTimeout(r, 80));
              const noteEditorState = __gaiaDebug.getNoteEditorState();
              __gaiaDebug.setNoteEditorText('烟雾测试笔记');
              await __gaiaDebug.commitNoteEditor();
              await new Promise((r) => setTimeout(r, 100));
              const savedAnnotations = __gaiaDebug.getAnnotations();
              const savedNote = savedAnnotations.find((item) => item.note === '烟雾测试笔记');
              const noteEditorSaved = savedAnnotations.length === annotationsBefore + 1 && !!savedNote;
              const notePanelOpen = !document.getElementById('annotations-panel').hidden;
              const noteCardLocated = !!savedNote && !!document.querySelector('[data-annotation-id="' + savedNote.id + '"]');
              if (notePanelOpen) {
                __gaiaDebug.togglePanel('annotations');
                await new Promise((r) => setTimeout(r, 250));
              }
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
              const settingsCapsule = document.getElementById('bgm-capsule');
              const settingsOpeningAnimation = settingsCapsule.getAnimations().find((a) => a.id === 'bgm-settings-entry-flip');
              const settingsOpeningFrames = settingsOpeningAnimation && settingsOpeningAnimation.effect.getKeyframes();
              const bgmSettingsOpeningAnimation = !!settingsOpeningAnimation && settingsOpeningAnimation.playState === 'running';
              const bgmSettingsOpeningFromOriginal = !!settingsOpeningFrames && settingsOpeningFrames.length >= 2 && settingsOpeningFrames[0].transform.startsWith('translate(');
              await new Promise((r) => setTimeout(r, 350));
              const drawerOpen = __gaiaDebug.isSettingsOpen();
              const searchEngineSelect = document.getElementById('search-engine');
              const searchEngineOptionsReady = ['google', 'bing', 'baidu', 'custom'].every((value) => !!searchEngineSelect.querySelector('option[value="' + value + '"]'));
              searchEngineSelect.value = 'bing';
              searchEngineSelect.dispatchEvent(new Event('change', { bubbles: true }));
              const searchUsesBing = document.querySelector('[data-selection-action="search"]').title === '使用 Bing 搜索';
              searchEngineSelect.value = 'custom';
              searchEngineSelect.dispatchEvent(new Event('change', { bubbles: true }));
              const customSearchVisible = !document.getElementById('search-custom-row').hidden;
              searchEngineSelect.value = 'google';
              searchEngineSelect.dispatchEvent(new Event('change', { bubbles: true }));
              const searchSettingsReady = searchEngineOptionsReady && searchUsesBing && customSearchVisible &&
                document.getElementById('search-custom-row').hidden && document.querySelector('[data-selection-action="search"]').title === '使用 Google 搜索';
              const settingsDrawer = document.getElementById('settings-drawer');
              const settingsCapsuleRect = settingsCapsule.getBoundingClientRect();
              const settingsDrawerRect = settingsDrawer.getBoundingClientRect();
              const themeButtonRect = document.getElementById('btn-theme').getBoundingClientRect();
              const petButtonRect = document.getElementById('btn-pet-toggle').getBoundingClientRect();
              const appearanceControlsAligned = Math.abs(themeButtonRect.top - petButtonRect.top) <= 1 && Math.abs(themeButtonRect.height - petButtonRect.height) <= 1;
              const bgmAvoidsSettings = settingsCapsuleRect.right <= settingsDrawerRect.left - 16;
              const bgmSettingsState = settingsCapsule.dataset.settingsOpen === '1' && settingsCapsule.parentElement === document.body;
              __gaiaDebug.closeSettings();
              const settingsClosingAnimation = settingsCapsule.getAnimations().find((a) => a.id === 'bgm-settings-restore-flip');
              const bgmSettingsClosingAnimation = !!settingsClosingAnimation && settingsClosingAnimation.playState === 'running';
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
              return JSON.stringify({ viewAfterSplash, splashHidden, importSucceeded, importRecovered: importResult.recovered, aiUiReady, aiCenterOpened, aiCenterLayout, aiModelPresets, aiModelMenuScrollable, aiCenterReturned, aiPanelOpened, aiAppearanceCompact, aiSummaryTabReady, selectionAiTools, selectionPrepared, noteEditorOpen: noteEditorState.open, noteEditorQuote: noteEditorState.quote, noteEditorSaved, notePanelOpen, noteCardLocated, drawerOpen, drawerClosed, searchSettingsReady, appearanceControlsAligned, bgmAvoidsSettings, bgmSettingsState, bgmSettingsRestored, bgmSettingsOpeningAnimation, bgmSettingsOpeningFromOriginal, bgmSettingsClosingAnimation, epW: epSize.w, epH: epSize.h, spreadBefore, spreadAfter, epW2: epSizeAfterSpread.w, fxOnHome, particleCount, fxInReader, nightBefore, nightAfter, bodyDark, darkInjected, eyeTheme, bodyEye, fontInjected, pagingClass, reopenPct, reopenStatus, memOk, shelfOrderAfterRead, shelfProgressCount, fxOnLibrary, particleCountLibrary, trailCount, trailLoopRunning, diamondCount, pctBefore, pctAfter, locBefore, locAfter, progressWidth, wheelsAfterNav, bgmCapsule, bgmInTopbar, progressVisible, bgmTrackBefore, bgmTrackAfter, bgmVolumeOk, bmChapter, bmPercent, countAfterAdd, countAfterRemove, bookmarksOpen, bookmarksClosed, tocOpen, tocClosed, libAfterAdd, libAfterRemove, shelfBookmarkBeforeRemove, bookmarkCountAfterShelfRemove, progressCountAfterShelfRemove, libAfterBatchAdd, bookmarkBeforeBatch, selectedCount, libAfterBatchRemove, bookmarkCountAfterBatchRemove, progressCountAfterBatchRemove });
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
              parsed.importSucceeded === true &&
              parsed.aiUiReady === true &&
              parsed.selectionPrepared === true &&
              parsed.noteEditorOpen === true &&
              parsed.noteEditorQuote === '烟雾测试摘录' &&
              parsed.noteEditorSaved === true &&
              parsed.notePanelOpen === true &&
              parsed.noteCardLocated === true &&
              parsed.drawerOpen === true &&
              parsed.drawerClosed === true &&
              parsed.searchSettingsReady === true &&
              parsed.appearanceControlsAligned === true &&
              parsed.bgmAvoidsSettings === true &&
              parsed.bgmSettingsState === true &&
              parsed.bgmSettingsRestored === true &&
              parsed.bgmSettingsOpeningAnimation === true &&
              parsed.bgmSettingsOpeningFromOriginal === true &&
              parsed.bgmSettingsClosingAnimation === true &&
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
        if (!DEBUG_OPEN_PATH) {
          const petStatus = await mainWindow.webContents.executeJavaScript(`(async () => {
            await __gaiaDebug.waitHome();
            await GaiaPet.whenReady();
            GaiaPet.openConsole();
            const panel = document.querySelector('.gaia-pet-console');
            const emotionButtons = panel ? panel.querySelectorAll('[data-emotion]').length : 0;
            const actionButtons = panel ? panel.querySelectorAll('[data-action]').length : 0;
            const careToggle = panel && panel.querySelector('[data-reading-care-toggle]');
            const careSelect = panel && panel.querySelector('[data-reading-care-interval]');
            const careStatus = panel && panel.querySelector('.gaia-pet-console-care-status');
            const careTest = panel && panel.querySelector('[data-reading-care-test]');
            const readingCareControls = !!careToggle && !!careSelect && !!careStatus && !!careTest;
            const panelVisible = !!panel && !panel.hidden && panel.offsetWidth > 0 && panel.offsetHeight > 0;
            const rect = panel ? panel.getBoundingClientRect() : null;
            const panelInViewport = !!rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
            const panelStyle = panel && getComputedStyle(panel);
            const panelCompact = !!rect && Math.round(rect.width) === 240 && rect.height <= 420;
            panel.scrollTop = panel.scrollHeight;
            const panelScrollable = panel.scrollHeight > panel.clientHeight && panel.scrollTop > 0 && panelStyle.overflowY === 'auto';
            panel.scrollTop = 0;
            const stickyConsoleTop = getComputedStyle(panel.querySelector('.gaia-pet-console-top')).position === 'sticky';
            let panelWheelBubbled = false;
            const detectPanelWheel = () => { panelWheelBubbled = true; };
            document.addEventListener('wheel', detectPanelWheel);
            panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
            document.removeEventListener('wheel', detectPanelWheel);
            const panelWheelIsolated = !panelWheelBubbled;
            const fpsLabel = document.querySelector('.gaia-pet-fps');
            const fpsToggle = panel.querySelector('[data-fps-toggle]');
            fpsToggle.checked = false;
            fpsToggle.dispatchEvent(new Event('change', { bubbles: true }));
            const fpsToggleHides = fpsLabel.hidden && document.getElementById('gaia-pet').classList.contains('fps-hidden');
            fpsToggle.checked = true;
            fpsToggle.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 1300));
            const reportedDisplayFrequency = await window.api.displayFrequency();
            const fpsSegments = fpsLabel.textContent.split(' / ');
            const fpsMeasured = !fpsLabel.hidden && fpsSegments.length === 2 && /^FPS [0-9]+$/.test(fpsSegments[0]) && /^[0-9]+Hz$/.test(fpsSegments[1]) && ['good', 'warn', 'bad'].includes(fpsLabel.dataset.level);
            const fpsTargetMatchesDisplay = Number.isFinite(reportedDisplayFrequency) && fpsLabel.textContent.endsWith('/ ' + Math.round(reportedDisplayFrequency) + 'Hz');
            const petBodyLayer = document.querySelector('.gaia-pet-halfbody');
            const petHeadLayer = document.querySelector('.gaia-pet-head');
            const petHeadRig = document.querySelector('.gaia-pet-head-rig');
            const blinkFace = document.querySelector('.gaia-pet-blink-face');
            const layeredPet = !!petBodyLayer && petBodyLayer.src.endsWith('/parts/body.png') && !!petHeadLayer && petHeadLayer.src.endsWith('/parts/head.png') && !!petHeadRig && petHeadRig.offsetHeight > 0;
            if (petBodyLayer && (!petBodyLayer.complete || !petBodyLayer.naturalWidth)) {
              await new Promise((resolve) => {
                petBodyLayer.addEventListener('load', resolve, { once: true });
                petBodyLayer.addEventListener('error', resolve, { once: true });
              });
            }
            let headCutoutClean = false;
            if (petBodyLayer && petBodyLayer.naturalWidth) {
              const cutoutCanvas = document.createElement('canvas');
              cutoutCanvas.width = petBodyLayer.naturalWidth;
              cutoutCanvas.height = petBodyLayer.naturalHeight;
              const cutoutContext = cutoutCanvas.getContext('2d', { willReadFrequently: true });
              cutoutContext.drawImage(petBodyLayer, 0, 0);
              const cutoutPixels = cutoutContext.getImageData(88, 0, 180, 223).data;
              headCutoutClean = true;
              for (let i = 3; i < cutoutPixels.length; i += 4) {
                if (cutoutPixels[i] !== 0) { headCutoutClean = false; break; }
              }
            }
            const oldLidRemoved = !document.querySelector('.gaia-pet-lid');
            const petRoot = document.getElementById('gaia-pet');
            const petTarget = petRoot.querySelector('.gaia-pet-hitbox');
            petRoot.style.pointerEvents = 'none';
            petTarget.style.pointerEvents = 'none';
            careTest.click();
            const careTestBubble = document.querySelector('.gaia-pet-bubble');
            const immediateCareTest = careTestBubble.classList.contains('show') && GaiaPetShared.LINES.readingCare.includes(careTestBubble.textContent);
            GaiaPet.setView('reader');
            careSelect.value = '60000';
            careSelect.dispatchEvent(new Event('change', { bubbles: true }));
            const readingDateNow = Date.now;
            Date.now = () => readingDateNow() + 30000;
            await new Promise((resolve) => setTimeout(resolve, 600));
            const readingTimerAdvanced = careStatus.textContent.includes('00:30 / 01:00');
            window.dispatchEvent(new Event('blur'));
            const readingTimerResetOnBlur = careStatus.textContent.includes('00:00 / 01:00');
            const fpsUnavailableOnBlur = fpsLabel.textContent.startsWith('FPS -- / ') && fpsLabel.dataset.level === 'idle';
            Date.now = readingDateNow;
            GaiaPet.setView('home');
            const readingTimerResetOnLeave = careStatus.textContent.includes('未在阅读');
            GaiaPet.runEmotion('sleeping');
            GaiaPet.setView('reader');
            Date.now = () => readingDateNow() + 61000;
            await new Promise((resolve) => setTimeout(resolve, 600));
            const readingCareReminderTriggered = careTestBubble.classList.contains('show') &&
              GaiaPetShared.LINES.readingCare.includes(careTestBubble.textContent) &&
              careStatus.textContent.includes('00:00 / 01:00');
            Date.now = readingDateNow;
            GaiaPet.setView('home');
            GaiaPet.runEmotion('idle');
            const originalDateNow = Date.now;
            Date.now = () => originalDateNow() + 26000;
            await new Promise((resolve) => setTimeout(resolve, 600));
            const autoRestWhileConsoleOpen = !panel.hidden && GaiaPet.getBrain().state === 'sleepy' && petHeadRig.classList.contains('performance-drowse');
            Date.now = () => originalDateNow() + 36000;
            await new Promise((resolve) => setTimeout(resolve, 600));
            const autoSleepWhileConsoleOpen = !panel.hidden && GaiaPet.getBrain().state === 'sleeping';
            Date.now = originalDateNow;
            GaiaPet.runEmotion('idle');
            GaiaPet.runEmotion('sleeping');
            const sleeping = GaiaPet.getBrain().state === 'sleeping';
            const sleepExpression = document.querySelector('.gaia-pet-face').dataset.exp;
            const sleepAnimation = document.querySelector('.gaia-pet-body').classList.contains('sleeping');
            const sleepHeadPose = petHeadRig.classList.contains('sleeping');
            const zzzVisible = !document.querySelector('.gaia-pet-zzz').hidden;
            petTarget.dispatchEvent(new PointerEvent('pointerenter', { clientX: 0, clientY: 0 }));
            const hoverKeepsSleeping = GaiaPet.getBrain().state === 'sleeping';
            petTarget.dispatchEvent(new MouseEvent('click', { clientX: 0, clientY: 0 }));
            const firstClickOnlyWakes = GaiaPet.getBrain().state === 'wake';
            GaiaPet.runEmotion('wake');
            await new Promise((resolve) => setTimeout(resolve, 30));
            const awake = GaiaPet.getBrain().state === 'wake';
            const wakePerformance = petHeadRig.classList.contains('performance-wake');
            const sleepAnimationCleared = !document.querySelector('.gaia-pet-body').classList.contains('sleeping');
            const zzzHidden = document.querySelector('.gaia-pet-zzz').hidden;
            await new Promise((resolve) => setTimeout(resolve, 900));
            const actionBeforeState = GaiaPet.getBrain().state;
            const actionBeforeExpression = document.querySelector('.gaia-pet-face').dataset.exp;
            GaiaPet.runAction('tilt');
            const actionStarted = petHeadRig.classList.contains('performance-tilt') && document.querySelector('.gaia-pet-face').dataset.exp === '倾听';
            await new Promise((resolve) => setTimeout(resolve, 1160));
            const bodyAfterAction = document.querySelector('.gaia-pet-body');
            const actionCleared = !petHeadRig.classList.contains('performance-tilt') && !bodyAfterAction.classList.contains('no-breathe');
            const breathingRestored = getComputedStyle(bodyAfterAction).animationName === 'pet-breathe';
            const actionStateRestored = GaiaPet.getBrain().state === actionBeforeState && document.querySelector('.gaia-pet-face').dataset.exp === actionBeforeExpression;
            const interruptBaseExpression = document.querySelector('.gaia-pet-face').dataset.exp;
            GaiaPet.runAction('yawn');
            await new Promise((resolve) => setTimeout(resolve, 1230));
            const yawnClosedBeforeInterrupt = petHeadRig.classList.contains('performance-yawn') && document.querySelector('.gaia-pet-face').dataset.exp === '安心';
            GaiaPet.runAction('blink');
            const blinkInterruptedYawn = !petHeadRig.classList.contains('performance-yawn') &&
              !bodyAfterAction.classList.contains('no-breathe') &&
              blinkFace.classList.contains('blink') &&
              document.querySelector('.gaia-pet-face').dataset.exp === interruptBaseExpression;
            const blinkEnd = new Event('animationend');
            Object.defineProperty(blinkEnd, 'animationName', { value: 'pet-eye-sprite-blink' });
            blinkFace.dispatchEvent(blinkEnd);
            const interruptedBlinkCleaned = !blinkFace.classList.contains('blink') && document.querySelector('.gaia-pet-face').dataset.exp === interruptBaseExpression;
            GaiaPet.runAction('yawn');
            await new Promise((resolve) => setTimeout(resolve, 340));
            const yawnHeadActive = petHeadRig.classList.contains('performance-yawn');
            const yawnBodyAnimation = getComputedStyle(bodyAfterAction).animationName;
            const yawnExpression = document.querySelector('.gaia-pet-face').dataset.exp;
            const yawnStarted = yawnHeadActive && yawnBodyAnimation === 'pet-body-yawn' && yawnExpression === '打哈欠';
            const yawnBubble = document.querySelector('.gaia-pet-bubble');
            const yawnTextVisible = yawnBubble.classList.contains('show') && yawnBubble.textContent.length > 0;
            await new Promise((resolve) => setTimeout(resolve, 1420));
            const yawnCleared = !petHeadRig.classList.contains('performance-yawn') && !bodyAfterAction.classList.contains('no-breathe');
            GaiaPet.runEmotion('sleepy');
            await new Promise((resolve) => setTimeout(resolve, 800));
            const drowseStarted = petHeadRig.classList.contains('performance-drowse') &&
              getComputedStyle(bodyAfterAction).animationName === 'pet-body-drowse' &&
              document.querySelector('.gaia-pet-face').dataset.exp === '安心';
            GaiaPet.runAction('blink');
            const blinkInterruptedDrowse = !petHeadRig.classList.contains('performance-drowse') &&
              !bodyAfterAction.classList.contains('no-breathe') &&
              blinkFace.classList.contains('blink') &&
              document.querySelector('.gaia-pet-face').dataset.exp === '眼睛微张';
            blinkFace.dispatchEvent(blinkEnd);
            GaiaPet.runEmotion('sleepy');
            await new Promise((resolve) => setTimeout(resolve, 2260));
            const drowseCleared = !petHeadRig.classList.contains('performance-drowse') &&
              !bodyAfterAction.classList.contains('no-breathe') &&
              document.querySelector('.gaia-pet-face').dataset.exp === '眼睛微张';
            GaiaPet.runEmotion('angry');
            const angryPerformanceStarted = petHeadRig.classList.contains('performance-angry') && document.querySelector('.gaia-pet-face').dataset.exp === '冷脸';
            await new Promise((resolve) => setTimeout(resolve, 230));
            const angryExpressionMatched = document.querySelector('.gaia-pet-face').dataset.exp === '生气';
            await new Promise((resolve) => setTimeout(resolve, 650));
            const angryPerformanceCleared = !petHeadRig.classList.contains('performance-angry');
            GaiaPet.runAction('blink');
            const spriteBlinkStarted = !!blinkFace && blinkFace.classList.contains('blink');
            GaiaPet.runAction('blink');
            const repeatedBlinkRestarted = blinkFace.classList.contains('blink');
            blinkFace.dispatchEvent(blinkEnd);
            const repeatedBlinkCleaned = !blinkFace.classList.contains('blink');
            GaiaPet.closeConsole();
            GaiaPet.runEmotion('idle');
            const bubbleBeforeStats = document.querySelector('.gaia-pet-bubble').textContent;
            __gaiaDebug.openReadingStats('library');
            await new Promise((resolve) => setTimeout(resolve, 80));
            const statsView = document.getElementById('stats-view');
            const statsAlice = document.getElementById('stats-alice');
            const statsViewVisible = !statsView.hidden;
            const statsUsesWholeImage = statsAlice.src.endsWith('/images/pet/stats/idle.png') && statsAlice.naturalWidth === 356 && statsAlice.naturalHeight === 647;
            const statsAliceRect = statsAlice.getBoundingClientRect();
            const statsRingRect = document.getElementById('stats-ring').getBoundingClientRect();
            const statsAliceVisible = statsAliceRect.width > 0 && statsAliceRect.height > 0;
            const statsAliceSizeStable = Math.abs(statsAliceRect.height - 350) < 1;
            const statsLayoutOverlap = Math.max(0, Math.min(statsAliceRect.right, statsRingRect.right) - Math.max(statsAliceRect.left, statsRingRect.left)) <= 28;
            const statsPetHidden = petRoot.hidden;
            const statsBreathing = getComputedStyle(statsAlice).animationName === 'statsAliceBreathe';
            statsAlice.dispatchEvent(new PointerEvent('pointerenter'));
            const statsHoverInteractive = statsAlice.classList.contains('stats-alice-perk');
            statsAlice.click();
            const statsBlinkStarted = statsAlice.src.endsWith('/images/pet/stats/blink.png');
            await new Promise((resolve) => setTimeout(resolve, 210));
            statsAlice.click();
            const statsYawnStarted = statsAlice.classList.contains('stats-alice-yawn') && statsAlice.src.endsWith('/images/pet/stats/drowsy.png');
            await new Promise((resolve) => setTimeout(resolve, 310));
            const statsYawnExpression = statsAlice.src.endsWith('/images/pet/stats/yawn.png');
            await new Promise((resolve) => setTimeout(resolve, 1320));
            statsAlice.click();
            const statsSleepStarted = statsAlice.classList.contains('stats-alice-sleep') && !document.getElementById('stats-alice-zzz').hidden && statsAlice.src.endsWith('/images/pet/stats/blink.png');
            statsAlice.click();
            const statsWakeStarted = statsAlice.classList.contains('stats-alice-wake') && document.getElementById('stats-alice-zzz').hidden;
            const dragEvent = new Event('dragstart', { cancelable: true });
            statsAlice.dispatchEvent(dragEvent);
            const statsDragDisabled = statsAlice.draggable === false && dragEvent.defaultPrevented;
            const statsHasNoDialogue = document.querySelector('.gaia-pet-bubble').textContent === bubbleBeforeStats;
            __gaiaDebug.closeReadingStats();
            await new Promise((resolve) => setTimeout(resolve, 80));
            const statsPetRestored = !petRoot.hidden;
            return { panelVisible, panelInViewport, panelCompact, panelScrollable, stickyConsoleTop, panelWheelIsolated, fpsToggleHides, fpsMeasured, fpsTargetMatchesDisplay, fpsUnavailableOnBlur, emotionButtons, actionButtons, readingCareControls, immediateCareTest, readingTimerAdvanced, readingTimerResetOnBlur, readingTimerResetOnLeave, readingCareReminderTriggered, layeredPet, headCutoutClean, oldLidRemoved, autoRestWhileConsoleOpen, autoSleepWhileConsoleOpen, sleeping, sleepExpression, sleepAnimation, sleepHeadPose, zzzVisible, hoverKeepsSleeping, firstClickOnlyWakes, awake, wakePerformance, sleepAnimationCleared, zzzHidden, actionStarted, actionCleared, actionStateRestored, breathingRestored, yawnClosedBeforeInterrupt, blinkInterruptedYawn, interruptedBlinkCleaned, yawnStarted, yawnHeadActive, yawnBodyAnimation, yawnExpression, yawnTextVisible, yawnCleared, drowseStarted, blinkInterruptedDrowse, drowseCleared, angryPerformanceStarted, angryExpressionMatched, angryPerformanceCleared, spriteBlinkStarted, repeatedBlinkRestarted, repeatedBlinkCleaned, statsViewVisible, statsUsesWholeImage, statsAliceVisible, statsAliceSizeStable, statsLayoutOverlap, statsPetHidden, statsBreathing, statsHoverInteractive, statsDragDisabled, statsBlinkStarted, statsYawnStarted, statsYawnExpression, statsSleepStarted, statsWakeStarted, statsHasNoDialogue, statsPetRestored };
          })()`);
          debugOk =
            petStatus.panelVisible === true &&
            petStatus.panelInViewport === true &&
            petStatus.panelCompact === true &&
            petStatus.panelScrollable === true &&
            petStatus.stickyConsoleTop === true &&
            petStatus.panelWheelIsolated === true &&
            petStatus.fpsToggleHides === true &&
            petStatus.fpsMeasured === true &&
            petStatus.fpsTargetMatchesDisplay === true &&
            petStatus.fpsUnavailableOnBlur === true &&
            petStatus.emotionButtons === 8 &&
            petStatus.actionButtons === 3 &&
            petStatus.readingCareControls === true &&
            petStatus.immediateCareTest === true &&
            petStatus.readingTimerAdvanced === true &&
            petStatus.readingTimerResetOnBlur === true &&
            petStatus.readingTimerResetOnLeave === true &&
            petStatus.readingCareReminderTriggered === true &&
            petStatus.layeredPet === true &&
            petStatus.headCutoutClean === true &&
            petStatus.oldLidRemoved === true &&
            petStatus.autoRestWhileConsoleOpen === true &&
            petStatus.autoSleepWhileConsoleOpen === true &&
            petStatus.sleeping === true &&
            petStatus.sleepExpression === '安心' &&
            petStatus.sleepAnimation === true &&
            petStatus.sleepHeadPose === true &&
            petStatus.zzzVisible === true &&
            petStatus.hoverKeepsSleeping === true &&
            petStatus.firstClickOnlyWakes === true &&
            petStatus.awake === true &&
            petStatus.wakePerformance === true &&
            petStatus.sleepAnimationCleared === true &&
            petStatus.zzzHidden === true &&
            petStatus.actionStarted === true &&
            petStatus.actionCleared === true &&
            petStatus.actionStateRestored === true &&
            petStatus.breathingRestored === true &&
            petStatus.yawnClosedBeforeInterrupt === true &&
            petStatus.blinkInterruptedYawn === true &&
            petStatus.interruptedBlinkCleaned === true &&
            petStatus.yawnStarted === true &&
            petStatus.yawnTextVisible === true &&
            petStatus.yawnCleared === true &&
            petStatus.drowseStarted === true &&
            petStatus.blinkInterruptedDrowse === true &&
            petStatus.drowseCleared === true &&
            petStatus.angryPerformanceStarted === true &&
            petStatus.angryExpressionMatched === true &&
            petStatus.angryPerformanceCleared === true &&
            petStatus.spriteBlinkStarted === true &&
            petStatus.repeatedBlinkRestarted === true &&
            petStatus.repeatedBlinkCleaned === true &&
            petStatus.statsViewVisible === true &&
            petStatus.statsUsesWholeImage === true &&
            petStatus.statsAliceVisible === true &&
            petStatus.statsAliceSizeStable === true &&
            petStatus.statsLayoutOverlap === true &&
            petStatus.statsPetHidden === true &&
            petStatus.statsBreathing === true &&
            petStatus.statsHoverInteractive === true &&
            petStatus.statsDragDisabled === true &&
            petStatus.statsBlinkStarted === true &&
            petStatus.statsYawnStarted === true &&
            petStatus.statsYawnExpression === true &&
            petStatus.statsSleepStarted === true &&
            petStatus.statsWakeStarted === true &&
            petStatus.statsHasNoDialogue === true &&
            petStatus.statsPetRestored === true;
          if (!debugOk) console.error('PET_SMOKE_CHECKS_FAILED:', JSON.stringify(petStatus));
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
        await mainWindow.webContents.executeJavaScript(`(() => {
          const pet = document.getElementById('gaia-pet');
          const rect = pet.getBoundingClientRect();
          pet.style.left = Math.round(innerWidth - rect.width - 48) + 'px';
          pet.style.top = Math.round(Math.max(72, innerHeight * 0.34)) + 'px';
          GaiaPet.openConsole();
        })()`);
        await wait(450);
        await capture('pet_console.png');
        await mainWindow.webContents.executeJavaScript('GaiaPet.closeConsole()');
        await mainWindow.webContents.executeJavaScript("GaiaPet.runEmotion('sleeping')");
        await wait(100);
        await mainWindow.webContents.executeJavaScript("GaiaPet.runEmotion('wake')");
        await wait(390);
        await capture('pet_wake_peak.png');
        await wait(550);
        await mainWindow.webContents.executeJavaScript("GaiaPet.runAction('tilt')");
        await wait(260);
        await capture('pet_tilt_early.png');
        await wait(260);
        await capture('pet_tilt_peak.png');
        await wait(390);
        await capture('pet_tilt_return.png');
        await wait(270);
        await mainWindow.webContents.executeJavaScript("GaiaPet.runAction('yawn')");
        await wait(260);
        await capture('pet_yawn_early.png');
        await wait(420);
        await capture('pet_yawn_peak.png');
        await wait(500);
        await capture('pet_yawn_return.png');
        await wait(560);
        await mainWindow.webContents.executeJavaScript("GaiaPet.runEmotion('sleepy')");
        await wait(260);
        await capture('pet_drowse_early.png');
        await wait(600);
        await capture('pet_drowse_peak.png');
        await wait(850);
        await capture('pet_drowse_return.png');
        await wait(550);
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.showView('library')");
        await wait(900);
        await capture('bookshelf.png');
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.openReadingStats('library')");
        await wait(500);
        await capture('reading_stats.png');
        await mainWindow.webContents.executeJavaScript("document.getElementById('stats-alice').click()");
        await wait(70);
        await capture('reading_stats_blink.png');
        await wait(160);
        await mainWindow.webContents.executeJavaScript("document.getElementById('stats-alice').click()");
        await wait(340);
        await capture('reading_stats_yawn.png');
        await wait(1280);
        await mainWindow.webContents.executeJavaScript("document.getElementById('stats-alice').click()");
        await wait(260);
        await capture('reading_stats_sleep.png');
        await mainWindow.webContents.executeJavaScript("document.getElementById('stats-alice').click()");
        await wait(520);
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.setTheme('eye')");
        await wait(350);
        await capture('reading_stats_eye.png');
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.setTheme('dark')");
        await wait(350);
        await capture('reading_stats_dark.png');
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.closeReadingStats()");
        await mainWindow.webContents.executeJavaScript("__gaiaDebug.setTheme('day')");
        await wait(350);

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
  let buf = fs.readFileSync(filePath);
  if (format === 'txt') {
    const { text, encoding } = decodeTxt(buf);
    return { format, text, encoding };
  }
  if (format === 'epub') {
    const readable = await readableEpub(filePath, buf);
    buf = readable.buffer;
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
ipcMain.handle('ai:profiles:get', () => publicAiProfiles());
ipcMain.handle('ai:profile:save', (event, payload) => {
  const input = payload && typeof payload === 'object' ? payload : {};
  const profiles = getAiProfiles();
  const existingIndex = profiles.items.findIndex((item) => item.id === String(input.id || ''));
  if (existingIndex < 0 && profiles.items.length >= 20) throw new Error('最多保存 20 套 AI 接口');
  const id = existingIndex >= 0 ? profiles.items[existingIndex].id : 'profile-' + crypto.randomUUID();
  const profile = GaiaAi.normalizeProfile({ ...input, id });
  const endpointChanged = existingIndex >= 0 && GaiaAi.secretScopeKey(profiles.items[existingIndex]) !== GaiaAi.secretScopeKey(profile);
  if (input.clearApiKey === true) writeAiSecret(profile.id, '');
  else if (String(input.apiKey || '').trim()) writeAiSecret(profile.id, input.apiKey);
  else if (endpointChanged) writeAiSecret(profile.id, '');
  if (existingIndex >= 0) profiles.items[existingIndex] = profile;
  else profiles.items.push(profile);
  if (existingIndex < 0 || input.activate === true) profiles.activeId = profile.id;
  store.set('aiProfiles', profiles);
  return publicAiProfiles(profiles);
});
ipcMain.handle('ai:profile:activate', (event, profileId) => {
  const profiles = getAiProfiles();
  const profile = aiProfileById(profileId);
  profiles.activeId = profile.id;
  store.set('aiProfiles', profiles);
  return publicAiProfiles(profiles);
});
ipcMain.handle('ai:profile:delete', (event, profileId) => {
  const profiles = getAiProfiles();
  if (profiles.items.length <= 1) throw new Error('至少需要保留一套 AI 接口');
  const index = profiles.items.findIndex((item) => item.id === String(profileId || ''));
  if (index < 0) throw new Error('要删除的 AI 接口不存在');
  const removed = profiles.items.splice(index, 1)[0];
  writeAiSecret(removed.id, '');
  if (profiles.activeId === removed.id) profiles.activeId = profiles.items[0].id;
  store.set('aiProfiles', profiles);
  return publicAiProfiles(profiles);
});
ipcMain.handle('ai:profile:test', async (event, profileId) => {
  try {
    const profile = aiProfileById(profileId);
    const result = await GaiaAi.testConnection(aiFetch, profile, aiKeyForProfile(profile), { timeoutMs: 30000 });
    return { ok: true, message: result.slice(0, 80), targetHost: new URL(profile.baseUrl).host };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error || '连接测试失败') };
  }
});
ipcMain.handle('ai:profile:models', async (event, profileId) => {
  try {
    const profile = aiProfileById(profileId);
    const models = await GaiaAi.listModels(aiFetch, profile, aiKeyForProfile(profile), { timeoutMs: 20000 });
    return { ok: true, models, targetHost: new URL(profile.baseUrl).host };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error || '读取模型列表失败') };
  }
});
ipcMain.handle('ai:summarize', async (event, payload) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const content = GaiaAi.cleanChapterText(source.content);
  if (!content) throw new Error('当前章节没有可总结的文字');
  if (content.length > 180000) throw new Error('当前章节超过 18 万字，请缩小总结范围');
  const profile = aiProfileById(source.profileId);
  const summary = await GaiaAi.summarize(aiFetch, profile, aiKeyForProfile(profile), {
    bookTitle: String(source.bookTitle || '').slice(0, 300),
    chapterTitle: String(source.chapterTitle || '').slice(0, 300),
    content,
  }, { timeoutMs: 90000, maxChunkChars: 12000 });
  return { summary, profileId: profile.id, profileName: profile.name, provider: profile.provider, baseUrl: profile.baseUrl, model: profile.model, targetHost: new URL(profile.baseUrl).host };
});
ipcMain.handle('ai:chat', async (event, payload) => {
  const input = payload && typeof payload === 'object' ? payload : {};
  const source = input.source && typeof input.source === 'object' ? input.source : {};
  const content = GaiaAi.cleanChapterText(source.content);
  if (!content) throw new Error('当前章节没有可供 AI 阅读的文字');
  if (content.length > 180000) throw new Error('当前章节超过 18 万字，请缩小阅读范围');
  const profile = aiProfileById(input.profileId);
  const answer = await GaiaAi.chat(aiFetch, profile, aiKeyForProfile(profile), {
    bookTitle: String(source.bookTitle || '').slice(0, 300),
    chapterTitle: String(source.chapterTitle || '').slice(0, 300),
    content,
  }, input.question, input.history, { timeoutMs: 90000 });
  return { answer, provider: profile.provider, model: profile.model, targetHost: new URL(profile.baseUrl).host };
});
ipcMain.handle('ai:alice-comment', async (event, payload) => {
  const input = payload && typeof payload === 'object' ? payload : {};
  const source = input.source && typeof input.source === 'object' ? input.source : {};
  const content = GaiaAi.cleanChapterText(source.content);
  if (!content) throw new Error('当前章节没有可供有珠阅读的文字');
  if (content.length > 180000) throw new Error('当前章节超过 18 万字，请缩小阅读范围');
  const profile = aiProfileById(input.profileId);
  const comment = await GaiaAi.aliceComment(aiFetch, profile, aiKeyForProfile(profile), {
    bookTitle: String(source.bookTitle || '').slice(0, 300),
    chapterTitle: String(source.chapterTitle || '').slice(0, 300),
    content,
  }, input.kind === 'summary' ? 'summary' : 'comment', { timeoutMs: 90000 });
  return { comment, kind: input.kind === 'summary' ? 'summary' : 'comment', model: profile.model, targetHost: new URL(profile.baseUrl).host };
});
ipcMain.handle('dictionary:open', (event, query) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('无权打开词典窗口');
  return openDictionary(query);
});
ipcMain.handle('selection:search', async (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('无权打开搜索');
  const input = payload && typeof payload === 'object' ? payload : { query: payload };
  const normalized = Lookup.normalizeLookupText(input.query, 200);
  const engine = Lookup.normalizeSearchEngine(input.engine);
  const target = Lookup.searchUrl(normalized, { engine, customTemplate: input.customTemplate });
  await shell.openExternal(target);
  return { ok: true, query: normalized, engine, engineLabel: Lookup.searchEngineLabel(engine) };
});
ipcMain.handle('file:exists', (event, filePath) => fs.existsSync(filePath));
ipcMain.handle('display:frequency', (event) => displayFrequencyForWindow(BrowserWindow.fromWebContents(event.sender)));

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
  const storePath = path.join(app.getPath('userData'), 'gaia-reading.json');
  try {
    const upgrade = prepareDataFile(storePath, { appVersion: app.getVersion(), backupLimit: 5 });
    if (upgrade.backupPath) console.log('USER_DATA_BACKUP:', upgrade.backupPath);
  } catch (err) {
    console.error('USER_DATA_UPGRADE_FAILED:', err);
    dialog.showErrorBox(
      'Gaia Reading 数据保护',
      '用户数据无法安全升级，程序不会覆盖原文件。\n\n数据位置：' + storePath + '\n\n原因：' + err.message
    );
    app.quit();
    return;
  }
  store = new JsonStore(storePath);
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






















