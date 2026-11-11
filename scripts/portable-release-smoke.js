'use strict';

// Launch the actual portable exe. Pause its main entry before any profile is
// read, select a fresh userData directory, then verify its payload and UI/IPC.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');
const { makeMobi7 } = require('../tests/fixtures/mobi-image-fixture');
const makeEpubFixture = require('../tests/fixtures/epub-font-fixture');
const project = path.join(__dirname, '..');
const version = require('../package.json').version;
const executable = path.resolve(process.argv[2] || path.join(project, 'dist', `Gaia.Reading.${version}.exe`));
const output = path.resolve(process.argv[3] || path.join(project, 'dist/reports', version, 'release'));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `gaia-portable-${version}-`));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light' }, pet: { auto: false, autoSleep: false, autoSpeech: false } }));
const report = { passed: false, version, executable, sandbox, checks: [], pageTurns: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
const save = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2));
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); }
async function poll(fn, timeout = 45000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (caught) { error = caught; }
    await wait(100);
  }
  throw error || new Error('Portable validation timed out');
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function inspector(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (events.has(message.method)) {
      events.get(message.method)(message.params);
      events.delete(message.method);
    }
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Inspector timeout: ' + method)); }, 45000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    event(method) { return new Promise(resolve => events.set(method, resolve)); },
    close() { ws.close(); },
  };
}
function value(response) {
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
function files(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? files(root, relative) : [relative];
  });
}
function comparableSourceBytes(file, value) {
  const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.ps1', '.bat', '.txt', '.xml', '.yml', '.yaml']);
  if (!textExtensions.has(path.extname(file).toLowerCase())) return value;
  return Buffer.from(value.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}

let cdp;
let child;
const requests = [];
const marker = 'UNREAD_CURRENT_END';
const server = http.createServer((req, res) => {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    const request = JSON.parse(data);
    requests.push(request);
    const chapter = request.messages[1].content.includes('当前整章（');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: chapter ? '本地模拟整章结果：' + marker : '【本地模拟接口验证】可以拓展知识并结合已读细节分析，区分原文事实与解读。' } }] }));
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = await freePort();
  child = spawn(executable, [`--inspect-brk=127.0.0.1:${port}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  child.on('error', error => { report.launchError = error.message; });
  const target = await poll(async () => {
    if (report.launchError) throw new Error(report.launchError);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.find(item => item.webSocketDebuggerUrl);
  });
  cdp = await inspector(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Debugger.enable');
  const paused = cdp.event('Debugger.paused');
  await cdp.send('Runtime.runIfWaitingForDebugger');
  const frame = (await paused).callFrames[0];
  const injection = `(() => {
    const load = typeof require === 'function' ? require : process.getBuiltinModule('module').createRequire(process.execPath);
    const electron = load('electron');
    electron.app.setPath('userData', ${JSON.stringify(sandbox)});
    electron.app.setPath('sessionData', ${JSON.stringify(path.join(sandbox, 'session'))});
    electron.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    electron.BrowserWindow.prototype.show = function () { this.showInactive(); };
    globalThis.__releaseElectron = electron;
    return { version: electron.app.getVersion(), packaged: electron.app.isPackaged, pid: process.pid, userData: electron.app.getPath('userData'), appPath: electron.app.getAppPath() };
  })()`;
  report.runtime = value(await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: injection, returnByValue: true }));
  check('Actual portable process uses an isolated profile before main entry runs', path.resolve(report.runtime.userData) === path.resolve(sandbox));
  check('Actual portable version is the release version', report.runtime.version === version && report.runtime.packaged);
  const asarPath = report.runtime.appPath;
  report.runtime.asarSha256 = sha256(fs.readFileSync(asarPath));
  const sourceFiles = files(path.join(project, 'src'));
  for (const file of sourceFiles) {
    const packaged = asar.extractFile(asarPath, path.join('src', file));
    const source = fs.readFileSync(path.join(project, 'src', file));
    assert.deepEqual(comparableSourceBytes(file, packaged), comparableSourceBytes(file, source), 'Packaged source mismatch: ' + file);
  }
  check('All packaged src files exactly match current source', sourceFiles.length > 100);
  check('Packaged package.json has the release version', JSON.parse(asar.extractFile(asarPath, 'package.json')).version === version);
  save('payload-check.json', { passed: true, version, sourceFiles: sourceFiles.length, asarSha256: report.runtime.asarSha256 });
  await cdp.send('Debugger.resume');
  const evaluateMain = async expression => value(await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }));
  await poll(() => evaluateMain('__releaseElectron.BrowserWindow.getAllWindows().length > 0'));
  await evaluateMain('__releaseElectron.BrowserWindow.getAllWindows()[0].setContentSize(1200, 820)');
  const evaluate = (fn, arg) => evaluateMain('__releaseElectron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(' + JSON.stringify('(' + fn.toString() + ')(' + JSON.stringify(arg) + ')') + ', true)');
  await poll(() => evaluate(() => typeof __gaiaDebug !== 'undefined' && typeof sendAiQuestion === 'function'));
  await evaluate(() => __gaiaDebug.waitHome());
  check('About panel displays the release version', await evaluate(version => document.querySelector('.drawer-about').textContent.includes(version), version));
  const txt = path.join(sandbox, 'portable-reading.txt');
  fs.writeFileSync(txt, '第一章 来信\n\n' + '冬夜里，他低下头没有回答，窗外的钟声响了。'.repeat(500) + '\n\n' + marker + '\n\n第二章 早晨\n\nLATER_CHAPTER_MARKER');
  await evaluate(async input => {
    const profiles = await api.aiProfileSave({ name: '本地验证接口', provider: 'custom', model: 'portable-local-test', baseUrl: input.url, apiKey: 'local-test-only', activate: true });
    acceptAiProfiles(profiles, profiles.activeId);
    await __gaiaDebug.openBook({ path: input.file, title: '1.1.7 AI 阅读验证', format: 'txt' });
    showAiAssistantPanel();
  }, { file: txt, url: 'http://127.0.0.1:' + server.address().port + '/v1' });
  await evaluate(() => sendAiQuestion('解释一下心理学概念，也可以联系已读内容进行分析'));
  check('Packaged UI and real IPC send a normal question', requests.length === 1);
  check('Packaged request excludes unread content', !JSON.stringify(requests[0].messages).includes(marker));
  check('Packaged prompt allows background knowledge and analysis', requests[0].messages[0].content.includes('正常回答书外问题'));
  await wait(700);
  const screenshot = await evaluateMain('__releaseElectron.BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image => image.toPNG().toString("base64"))');
  fs.writeFileSync(path.join(output, 'portable-ai-reading.png'), Buffer.from(screenshot, 'base64'));
  await evaluate(() => { $('btn-ai-full-summary-prompt').click(); return sendAiQuestion(); });
  check('Packaged explicit whole-chapter request includes current ending only', requests[1].messages[1].content.includes(marker) && !requests[1].messages[1].content.includes('LATER_CHAPTER_MARKER'));
  check('Packaged whole-chapter permission resets after send', await evaluate(() => !$('ai-chat-whole-chapter').checked));
  await evaluate(() => sendAiQuestion('继续解释普通背景知识'));
  check('Packaged next normal question excludes whole-chapter history', !JSON.stringify(requests[2].messages).includes(marker));

  const turnChecks = async format => {
    for (const key of ['Right', 'Left']) {
      await evaluate(() => { els.aiSummaryPanel.hidden = true; state.current.paginator.showPage(2); document.body.tabIndex = -1; document.body.focus(); });
      await evaluateMain('__releaseElectron.BrowserWindow.getAllWindows()[0].webContents.focus()');
      const before = await evaluate(() => state.current.paginator.currentPage);
      await evaluateMain('__releaseElectron.BrowserWindow.getAllWindows()[0].webContents.sendInputEvent(' + JSON.stringify({ type: 'keyDown', keyCode: key }) + ')');
      await wait(100);
      await evaluateMain('__releaseElectron.BrowserWindow.getAllWindows()[0].webContents.sendInputEvent(' + JSON.stringify({ type: 'keyUp', keyCode: key }) + ')');
      await wait(150);
      const after = await evaluate(() => ({ page: state.current.paginator.currentPage, held: !!heldPageKey }));
      const turn = { format, key, duration: 100, moves: Math.abs(after.page - before), held: after.held };
      report.pageTurns.push(turn);
      check('Packaged ' + format + '/' + key + ' short press turns once', turn.moves === 1 && !turn.held);
    }
  };
  await turnChecks('txt');
  const mobi = makeMobi7(sandbox, '<h1>第一章</h1><p>' + '这是一段用于实际便携程序验证的文字。'.repeat(300) + '</p>');
  await evaluate(book => __gaiaDebug.openBook(book), mobi);
  await wait(300);
  report.generatedBook = await evaluate(() => {
    const images = Array.from(state.current.paginator.doc.images);
    return { images: images.length, failures: images.filter(image => !image.complete || image.naturalWidth <= 0).map(image => image.getAttribute('src')) };
  });
  check('Generated MOBI images decode in the actual portable reader', report.generatedBook.images > 0 && report.generatedBook.failures.length === 0);
  await turnChecks('mobi');

  const epub = await makeEpubFixture(sandbox);
  await evaluateMain('__releaseElectron.BrowserWindow.getAllWindows()[0].maximize()');
  await wait(400);
  await evaluate(async book => {
    await __gaiaDebug.openBook(book);
    await nextPage();
    if (activePageAnimation) await activePageAnimation.finished;
    const rendition = state.current.rendition;
    window.portableEpubFrame = rendition.getContents()[0].window.frameElement;
    window.portableEpubLocation = rendition.currentLocation();
    window.portableEpubSize = [rendition.manager.container.offsetWidth, rendition.manager.container.offsetHeight];
    await setReaderFullscreen(true);
  }, epub);
  await poll(() => evaluate(() => readerFullscreen));
  check('Packaged EPUB keeps the same iframe, layout, and visible CFI range on fullscreen entry', await evaluate(() => {
    const rendition = state.current.rendition;
    const { container } = rendition.manager;
    const location = rendition.currentLocation();
    return container.contains(window.portableEpubFrame) &&
      container.offsetWidth === window.portableEpubSize[0] && container.offsetHeight === window.portableEpubSize[1] &&
      location.start.cfi === window.portableEpubLocation.start.cfi && location.end.cfi === window.portableEpubLocation.end.cfi;
  }));
  check('Packaged fullscreen EPUB turns a page without showing a bottom scrollbar', await evaluate(async () => {
    const host = els.readerContent;
    const container = state.current.rendition.manager.container;
    const height = host.clientHeight;
    if (host.clientWidth !== container.offsetWidth || height !== host.offsetHeight) return false;
    const moved = await nextPage();
    const animation = activePageAnimation;
    if (!animation) return false;
    let stable = true;
    while (animation.playState === 'running') {
      stable &&= host.clientHeight === height;
      await new Promise(requestAnimationFrame);
    }
    return moved && stable && host.clientHeight === height;
  }));
  await evaluate(() => setReaderFullscreen(false));
  await poll(() => evaluate(() => !readerFullscreen));
  report.passed = true;
  save('portable-check.json', report);
  save('portable-mobi-check.json', report);
  console.log(JSON.stringify({ passed: true, version, checks: report.checks.length, sourceFiles: sourceFiles.length, runtime: report.runtime }));
})().catch(error => {
  report.error = error.stack || String(error);
  save('portable-check.json', report);
  console.error(report.error);
  process.exitCode = 1;
}).finally(async () => {
  if (cdp) {
    // Close only this isolated process; never target an existing user session.
    try { await cdp.send('Runtime.evaluate', { expression: '__releaseElectron.app.quit()' }); } catch (error) {}
    cdp.close();
  }
  if (child && report.runtime?.pid) { try { process.kill(report.runtime.pid); } catch (error) {} }
  if (child) child.kill();
  server.close();
});
