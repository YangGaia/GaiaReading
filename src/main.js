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
              await __gaiaDebug.openBook({ path: ${JSON.stringify(DEBUG_OPEN_PATH)}, format: 'epub', title: 'fixture' });
              await new Promise((r) => setTimeout(r, 1200));
              const locBefore = __gaiaDebug.getLoc();
              await __gaiaDebug.nextPage();
              await new Promise((r) => setTimeout(r, 1200));
              const locAfter = __gaiaDebug.getLoc();
              await __gaiaDebug.addBookmark();
              const countAfterAdd = __gaiaDebug.getBookmarkCount();
              await __gaiaDebug.removeBookmarkAt(0);
              const countAfterRemove = __gaiaDebug.getBookmarkCount();
              console.log('DEBUG_LOC_BEFORE', locBefore);
              console.log('DEBUG_LOC_AFTER', locAfter);
              console.log('DEBUG_BOOKMARK_ADD', countAfterAdd);
              console.log('DEBUG_BOOKMARK_REMOVE', countAfterRemove);
              return JSON.stringify({ locBefore, locAfter, countAfterAdd, countAfterRemove });
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
              parsed.locBefore !== parsed.locAfter &&
              parsed.countAfterAdd === 1 &&
              parsed.countAfterRemove === 0;
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
