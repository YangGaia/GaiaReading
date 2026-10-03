'use strict';

// Actual Electron renderer with an isolated F: profile and synthetic book.
// AI requests are intercepted at IPC: no provider, key or user data is used.
// Optional comparison: --baseline=<styles.css> --baseline-tools=<tool-surfaces.css>
// --baseline-html=<index.html>. All three files must describe the same old build.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeSmokeDirectory, configureSmokePaths, resolveFPath } = require('./smoke-paths');
const { STATE_FILE_NAME } = require('../src/shared/app-paths');
const project = path.resolve(__dirname, '..');
const option = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const sandbox = makeSmokeDirectory('gaia-ai-chat-layout-');
const output = resolveFPath(option('output') || path.join(sandbox, 'screenshots'));
fs.mkdirSync(output, { recursive: true });
configureSmokePaths(app, { userData: sandbox });
app.setAppPath(project);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const baselineFiles = ['baseline', 'baseline-tools', 'baseline-html'].map(option);
assert.ok(baselineFiles.every(Boolean) || baselineFiles.every(value => !value), 'Supply all three baseline layout files together');
const baseline = baselineFiles.every(Boolean) ? Object.fromEntries(['styles', 'tools', 'html'].map((key, i) => [key, fs.readFileSync(resolveFPath(baselineFiles[i]), 'utf8')])) : null;
const bookPath = path.join(sandbox, '聊天布局验收.txt');
const bookContent = '第一章 灯下的书页\n\n' + Array.from({ length: 120 }, (_, i) => `第${i + 1}段：傍晚，窗外的光线慢慢柔和下来。阅读的人翻开书页，在故事里停留片刻，听一听作者的声音，也听一听自己的想法。`).join('\n\n');
fs.writeFileSync(bookPath, bookContent);
// Geometry checks intentionally hide the independent foreground companion.
// Its required stacking order is checked separately below.
fs.writeFileSync(path.join(sandbox, STATE_FILE_NAME), JSON.stringify({ library: [], prefs: { theme: 'light' }, pet: { on: false, autoSleep: false } }));
const response = [
  '这段文字从傍晚的书房写起，用窗外的光线和桌上的书页，构成了安静的阅读场景。作者没有急着推进情节，而是让人物在日常细节里显出自己的心情。',
  '人物关系可以从说话的方式理解。对方没有直接回答，而是先整理桌上的书，这个小动作表示他仍在犹豫。两个人都在等待一个能够自然开始的话题。',
  '值得留意的细节是那枚旧书签。它第一次出现时只是书页间的物件，后来又被人物重新拿起，因此可能连接着过去的经历，也可能为下一段对话提供线索。',
  '这一章的节奏比较舒缓。短句让叙述停顿，较长的描写则把注意力带向环境。阅读时可以把人物说出的内容和没有说出的内容放在一起比较。',
  '目前只能根据已经给出的文字判断。书签的来历尚未交代，人物之间的误会也没有完全解释；这些问题可以暂时保留，随着后续章节再核对。',
].join('\n\n');
const report = { sandbox, output, checks: [], measurements: [], screenshots: [], errors: [] };
const requests = [];
let pending;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => handle(channel, channel === 'ai:chat' ? (_event, payload) => {
  requests.push(payload);
  return new Promise((resolve, reject) => { pending = { resolve, reject }; });
} : handler);
let win;
let finished = false;
let attached = false;
const timeout = setTimeout(() => finish(new Error('AI chat layout validation timed out')), 120000);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
function check(label, pass) { assert.ok(pass, label); report.checks.push(label); }
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  if (error && win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    try {
      const capture = await Promise.race([
        win.webContents.capturePage(),
        wait(2500).then(() => { throw new Error('Failure screenshot timed out'); }),
      ]);
      const target = path.join(output, 'chat-failure.png');
      fs.writeFileSync(target, capture.toPNG());
      report.failureScreenshot = target;
      report.screenshots.push(target);
    } catch (captureError) { report.failureScreenshotError = captureError.stack || String(captureError); }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
async function until(fn, ...args) {
  for (let i = 0; i < 80; i++) { if (await evaluate(fn, ...args)) return; await wait(50); }
  throw new Error('Timed out waiting for ' + fn);
}
async function settle() {
  await evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await wait(100);
}
async function click(selector) {
  const point = await evaluate(selector => {
    const el = document.querySelector(selector), r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    if (!r.width || !r.height || !el.contains(document.elementFromPoint(x, y))) throw new Error(selector + ' is not reachable');
    return { x, y };
  }, selector);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await settle();
}
async function key(keyCode, modifiers = [], char) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (char) win.webContents.sendInputEvent({ type: 'char', keyCode: char, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await settle();
}
async function shot(name) {
  win.showInactive(); win.moveTop(); win.webContents.invalidate();
  await settle();
  const target = path.join(output, name + '.png');
  fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
  if (!report.screenshots.includes(target)) report.screenshots.push(target);
}
async function setInput(value) {
  await evaluate(value => { els.aiChatInput.value = value; els.aiChatInput.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await settle();
}
async function measure(label) {
  const metrics = await evaluate(async (baseline, label) => {
    function read(panel) {
      const doc = panel.ownerDocument, view = doc.defaultView;
      const messages = panel.querySelector('.ai-chat-messages');
      const box = messages.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
      const lines = new Set();
      for (const [i, bubble] of [...messages.querySelectorAll('.ai-chat-message')].entries()) {
        for (const node of bubble.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE) continue;
          const range = doc.createRange(); range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width > 0 && r.top >= box.top && r.bottom <= box.bottom) lines.add(i + ':' + Math.round(r.top * 10));
        }
      }
      const bubble = messages.querySelector('.ai-chat-message.assistant');
      const style = view.getComputedStyle(bubble);
      return { panelWidth: panelBox.width, panelHeight: panelBox.height, contentHeight: box.height, visibleTextLines: lines.size, fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight };
    }
    const panel = document.getElementById('ai-summary-panel');
    const messages = panel.querySelector('.ai-chat-messages'); messages.scrollTop = 0;
    const current = read(panel);
    if (!baseline) return { label, current };
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;width:1100px;height:800px;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const old = new DOMParser().parseFromString(baseline.html, 'text/html').getElementById('ai-summary-panel');
    const otherStyles = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => !/\/(?:styles|tool-surfaces)\.css(?:\?|$)/.test(link.href)).map(link => `<link rel="stylesheet" href="${link.href}">`).join('');
    doc.open(); doc.write('<!doctype html><html><head><base href="' + document.baseURI + '"><style>' + baseline.styles + '</style>' + otherStyles + '<style>' + baseline.tools + '</style></head><body>' + old.outerHTML + '</body></html>'); doc.close();
    const oldPanel = doc.getElementById('ai-summary-panel');
    oldPanel.hidden = false;
    oldPanel.style.cssText = `position:absolute;left:0;top:0;right:auto;width:${current.panelWidth}px;height:${current.panelHeight}px;`;
    for (const name of ['--ai-font-family', '--ai-font-size', '--ai-line-height']) oldPanel.style.setProperty(name, getComputedStyle(panel).getPropertyValue(name));
    for (const selector of ['.ai-chat-messages', '#ai-summary-chapter', '#ai-summary-target', '#ai-reader-model']) oldPanel.querySelector(selector).innerHTML = panel.querySelector(selector).innerHTML;
    const status = panel.querySelector('#ai-summary-status');
    if (status.textContent.trim()) {
      oldPanel.querySelector('#ai-summary-status').textContent = status.textContent;
      oldPanel.querySelector('#ai-summary-status').classList.toggle('error', status.classList.contains('error'));
    }
    await Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].map(link => link.sheet ? Promise.resolve() : new Promise((resolve, reject) => {
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => reject(new Error('Baseline stylesheet failed: ' + link.href)), { once: true });
    })));
    await doc.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const previous = read(oldPanel);
    frame.remove();
    return { label, current, previous, contentHeightGain: current.contentHeight - previous.contentHeight, contentHeightGainPercent: Math.round((current.contentHeight / previous.contentHeight - 1) * 100), visibleTextLineGain: current.visibleTextLines - previous.visibleTextLines };
  }, baseline, label);
  report.measurements.push(metrics);
  if (baseline) {
    const { current, previous } = metrics;
    check(label + ': panel width and height are unchanged', Math.abs(current.panelWidth - previous.panelWidth) < 1 && Math.abs(current.panelHeight - previous.panelHeight) < 1);
    check(label + ': response typography is unchanged', ['fontFamily', 'fontSize', 'lineHeight'].every(key => current[key] === previous[key]));
    check(label + ': conversation viewport gains at least 30px', metrics.contentHeightGain >= 30);
    check(label + ': more complete text lines are visible', metrics.visibleTextLineGain >= 1);
  }
}
async function run() {
  await evaluate(() => __gaiaDebug.waitHome());
  win.setContentSize(1100, 800); win.showInactive(); win.moveTop();
  await evaluate(async file => { await __gaiaDebug.importPaths([file]); await __gaiaDebug.openBook(__gaiaDebug.getLibrary()[0]); }, bookPath);
  await until(() => __gaiaDebug.getPaginatorTotal() > 1);
  await evaluate(() => { state.aiConfig = { model: 'local-layout-fixture', provider: 'ollama', hasApiKey: false }; __gaiaDebug.openAiAssistant(); });
  await settle();
  check('AI panel retains its lower layer than the foreground companion', await evaluate(() => {
    const companion = $('gaia-pet');
    return !!companion && companion.hidden && Number(getComputedStyle(els.aiSummaryPanel).zIndex) < Number(getComputedStyle(companion).zIndex);
  }));
  check('idle guidance is absent and consumes no vertical space', await evaluate(() => !els.aiSummaryPanel.textContent.includes('可以直接提问，或先选择一条快捷指令。') && !els.aiSummaryStatus.textContent.trim() && els.aiSummaryStatus.getBoundingClientRect().height === 0));
  const initial = await evaluate(() => ({ width: els.aiSummaryPanel.offsetWidth, height: els.aiSummaryPanel.offsetHeight, input: els.aiChatInput.offsetHeight, line: parseFloat(getComputedStyle(els.aiChatInput).lineHeight), padding: parseFloat(getComputedStyle(els.aiChatInput).paddingTop) + parseFloat(getComputedStyle(els.aiChatInput).paddingBottom) + 2 }));
  check('empty composer occupies one line', initial.input <= initial.line + initial.padding + 2);
  await evaluate(answer => {
    const source = currentChapterSummarySource();
    state.aiChats[aiChatKey(source)] = [{ role: 'user', content: '结合这一章分析人物关系与伏笔。' }, { role: 'assistant', content: answer }];
    renderAiChat(source);
  }, response);
  await measure('normal window');
  await shot('chat-normal');
  const beforeShortcut = requests.length;
  await click('#btn-ai-summary-prompt');
  check('shortcut fills input without sending', requests.length === beforeShortcut && await evaluate(() => els.aiChatInput.value.includes('简要概括')));
  await setInput('一行问题');
  const single = await evaluate(() => els.aiChatInput.offsetHeight);
  const readingPosition = await evaluate(() => {
    els.aiChatMessages.scrollTop = Math.min(160, (els.aiChatMessages.scrollHeight - els.aiChatMessages.clientHeight) / 2);
    return els.aiChatMessages.scrollTop;
  });
  check('scroll fixture is away from either end', readingPosition > 10 && await evaluate(() => els.aiChatMessages.scrollHeight - els.aiChatMessages.scrollTop - els.aiChatMessages.clientHeight > 50));
  await setInput('第一行\n第二行\n第三行');
  const multiple = await evaluate(() => els.aiChatInput.offsetHeight);
  check('composer grows for multiple lines', multiple > single + 15);
  check('growing composer preserves the current reading position', await evaluate(before => Math.abs(els.aiChatMessages.scrollTop - before) <= 1, readingPosition));
  await setInput(Array.from({ length: 16 }, (_, i) => '第' + i + '行输入').join('\n'));
  check('long composer is capped and scrolls', await evaluate(() => els.aiChatInput.offsetHeight <= parseFloat(getComputedStyle(els.aiChatInput).maxHeight) + 1 && els.aiChatInput.scrollHeight > els.aiChatInput.clientHeight));
  await shot('chat-multiline');
  await setInput('');
  check('empty composer contracts again', await evaluate(() => els.aiChatInput.offsetHeight) === initial.input);
  check('contracting composer preserves the current reading position', await evaluate(before => Math.abs(els.aiChatMessages.scrollTop - before) <= 1, readingPosition));
  await evaluate(() => { els.aiChatMessages.scrollTop = els.aiChatMessages.scrollHeight; });
  await setInput('第一行\n第二行\n第三行');
  check('growing composer keeps the latest message in view at the bottom', await evaluate(() => els.aiChatMessages.scrollHeight - els.aiChatMessages.scrollTop - els.aiChatMessages.clientHeight <= 2));
  await setInput('');
  await evaluate(() => { state.aiChats[aiChatKey(currentChapterSummarySource())] = []; renderAiChat(currentChapterSummarySource()); });
  await click('#ai-chat-input');
  await win.webContents.insertText('第一行');
  await key('Enter', [], '\r');
  await win.webContents.insertText('第二行');
  check('native Enter inserts a newline without sending', requests.length === beforeShortcut && await evaluate(() => els.aiChatInput.value === '第一行\n第二行'));
  await evaluate(() => {
    els.aiChatInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '输入中' }));
    els.aiChatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }));
  });
  await settle();
  check('IME confirmation does not submit unfinished composition', requests.length === beforeShortcut && await evaluate(() => els.aiChatInput.value === '第一行\n第二行'));
  await evaluate(() => els.aiChatInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '第二行' })));
  await key('Enter', ['control']);
  await until(() => __gaiaDebug.getAiChatState().loading && els.aiSummaryStatus.textContent.includes('AI 正在'));
  for (let i = 0; !pending && i < 80; i++) await wait(50);
  check('Ctrl+Enter submits through the controlled IPC handler', requests.length === beforeShortcut + 1 && !!pending);
  check('loading status remains visible', await evaluate(() => els.aiSummaryStatus.getBoundingClientRect().height > 0 && getComputedStyle(els.aiSummaryStatus).display !== 'none'));
  pending.resolve({ answer: response, model: 'local-layout-fixture', targetHost: 'isolated.invalid' }); pending = null;
  await until(() => !__gaiaDebug.getAiChatState().loading);
  check('answer displays and submitted composer contracts', await evaluate(answer => [...els.aiChatMessages.querySelectorAll('.assistant')].some(el => el.textContent.includes(answer)) && els.aiChatInput.value === '' && els.aiChatInput.rows === 1, response));
  await measure('completed reply');
  await shot('chat-normal');
  await setInput('受控错误测试');
  await click('#btn-ai-chat-send');
  for (let i = 0; !pending && i < 80; i++) await wait(50);
  assert.ok(pending, 'Error fixture request arrives');
  pending.reject(new Error('隔离验收：模拟请求失败')); pending = null;
  await until(() => !__gaiaDebug.getAiChatState().loading);
  check('error remains visible in status and conversation', await evaluate(() => els.aiSummaryStatus.classList.contains('error') && els.aiSummaryStatus.getBoundingClientRect().height > 0 && els.aiSummaryStatus.textContent.includes('模拟请求失败') && els.aiChatMessages.textContent.includes('模拟请求失败')));
  await evaluate(() => {
    const bounds = $('reader-body').getBoundingClientRect(), panel = els.aiSummaryPanel.getBoundingClientRect();
    applyAiPanelGeometry({ left: bounds.left + 420, top: bounds.top + 30, width: panel.width, height: panel.height });
  });
  await settle();
  const beforeDrag = await evaluate(() => {
    const r = els.aiSummaryPanel.getBoundingClientRect(), bounds = $('reader-body').getBoundingClientRect();
    return { left: r.left, top: r.top, minLeft: bounds.left, minTop: bounds.top, maxLeft: bounds.right - r.width, maxTop: bounds.bottom - r.height };
  });
  const readGeometry = () => evaluate(() => {
    const r = els.aiSummaryPanel.getBoundingClientRect(), body = $('reader-body').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      reader: { left: body.left, top: body.top, right: body.right, bottom: body.bottom, width: body.width, height: body.height }, saved: state.prefs.aiWindow };
  });
  const insideReader = value => value.left >= value.reader.left - 1 && value.top >= value.reader.top - 1 && value.right <= value.reader.right + 1 && value.bottom <= value.reader.bottom + 1;
  const panelFitsReader = () => {
    const r = els.aiSummaryPanel.getBoundingClientRect(), body = $('reader-body').getBoundingClientRect();
    return r.left >= body.left - 1 && r.top >= body.top - 1 && r.right <= body.right + 1 && r.bottom <= body.bottom + 1;
  };
  const readDragPoint = async () => {
    const information = await evaluate(() => {
      const describe = element => {
        if (!element) return null;
        const r = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { tag: element.tagName, id: element.id, className: String(element.className), hidden: element.hidden,
          zIndex: style.zIndex, position: style.position, pointerEvents: style.pointerEvents,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } };
      };
      const title = els.aiPanelDragHandle.querySelector('h2'), r = title.getBoundingClientRect();
      const x = Math.round(r.left + 25), y = Math.round(r.top + r.height / 2), hit = document.elementFromPoint(x, y);
      return { x, y, reachable: title.contains(hit), hit: describe(hit), stack: document.elementsFromPoint(x, y).slice(0, 8).map(describe),
        header: describe(els.aiPanelDragHandle), title: describe(title), panel: describe(els.aiSummaryPanel), reader: describe($('reader-body')), companion: describe($('gaia-pet')) };
    });
    (report.dragHitTests ||= []).push(information);
    if (!information.reachable) throw new Error('Drag handle is not reachable: ' + JSON.stringify(information));
    return { x: information.x, y: information.y };
  };
  const dragPoint = await readDragPoint();
  await evaluate(() => {
    window.__chatDragEvents = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) els.aiPanelDragHandle.addEventListener(type, event => window.__chatDragEvents.push({ type, button: event.button, buttons: event.buttons, target: event.target.tagName, x: event.clientX, y: event.clientY }), { capture: true });
  });
  // CDP supplies an explicit held-buttons mask and ordered input acknowledgments.
  // Electron sendInputEvent can establish capture without delivering its first move.
  win.webContents.debugger.attach('1.3');
  const dragMouse = async (type, x, y, held = false) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !held ? 'none' : 'left', buttons: held ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await settle();
  };
  await dragMouse('mouseMoved', dragPoint.x, dragPoint.y);
  await dragMouse('mousePressed', dragPoint.x, dragPoint.y, true);
  await dragMouse('mouseMoved', dragPoint.x - 35, dragPoint.y + 8, true);
  await dragMouse('mouseMoved', dragPoint.x - 75, dragPoint.y + 18, true);
  await dragMouse('mouseReleased', dragPoint.x - 75, dragPoint.y + 18);
  await settle();
  report.drag = { before: beforeDrag, after: await evaluate(() => { const r = els.aiSummaryPanel.getBoundingClientRect(); return { left: r.left, top: r.top }; }), events: await evaluate(() => window.__chatDragEvents) };
  check('header still supports pointer dragging', Math.abs(report.drag.after.left - Math.max(beforeDrag.minLeft, Math.min(beforeDrag.maxLeft, beforeDrag.left - 75))) <= 1 && Math.abs(report.drag.after.top - Math.max(beforeDrag.minTop, Math.min(beforeDrag.maxTop, beforeDrag.top + 18))) <= 1);
  const dragPastCorner = async corner => {
    const start = await readDragPoint();
    const movement = await evaluate(corner => {
      const r = els.aiSummaryPanel.getBoundingClientRect(), body = $('reader-body').getBoundingClientRect();
      return corner === 'right-bottom' ? { x: body.right - r.right + 20, y: body.bottom - r.bottom + 20 } : { x: body.left - r.left - 20, y: body.top - r.top - 20 };
    }, corner);
    await dragMouse('mouseMoved', start.x, start.y);
    await dragMouse('mousePressed', start.x, start.y, true);
    await dragMouse('mouseMoved', start.x + movement.x / 2, start.y + movement.y / 2, true);
    await dragMouse('mouseMoved', start.x + movement.x, start.y + movement.y, true);
    await dragMouse('mouseReleased', start.x + movement.x, start.y + movement.y);
  };
  await dragPastCorner('left-top');
  const topLeftGeometry = await readGeometry();
  check('native dragging stops at the reader left and top edges', insideReader(topLeftGeometry) && Math.abs(topLeftGeometry.left - topLeftGeometry.reader.left) <= 1 && Math.abs(topLeftGeometry.top - topLeftGeometry.reader.top) <= 1);
  await dragPastCorner('right-bottom');
  win.webContents.debugger.detach();
  await settle();
  const edgeGeometry = await readGeometry();
  report.edgeDrag = { topLeft: topLeftGeometry, beforeReopen: edgeGeometry };
  check('native dragging stops at the reader right and bottom edges', insideReader(edgeGeometry) && Math.abs(edgeGeometry.right - edgeGeometry.reader.right) <= 1 && Math.abs(edgeGeometry.bottom - edgeGeometry.reader.bottom) <= 1);
  check('AI window leaves the top toolbar and bottom page controls uncovered', edgeGeometry.reader.top > 0 && edgeGeometry.reader.bottom < edgeGeometry.viewportHeight && insideReader(edgeGeometry));
  check('dragged geometry is stored in viewport coordinates', edgeGeometry.saved.coordinateSpace === 'viewport' && Math.abs(edgeGeometry.saved.left - edgeGeometry.left) <= 1 && Math.abs(edgeGeometry.saved.top - edgeGeometry.top) <= 1);
  await click('#btn-ai-summary-close'); await click('#btn-ai-reader');
  report.edgeDrag.afterReopen = await readGeometry();
  check('reader right-bottom placement persists across closing and reopening', insideReader(report.edgeDrag.afterReopen) && ['left', 'top', 'width', 'height'].every(key => Math.abs(report.edgeDrag.afterReopen[key] - edgeGeometry[key]) <= 1));
  win.setContentSize(800, 600);
  await until(() => innerWidth === 800 && innerHeight === 600);
  await until(panelFitsReader);
  await settle();
  const smallerGeometry = await readGeometry();
  check('shrinking the application keeps the full AI panel inside the reader', insideReader(smallerGeometry));
  check('temporary viewport clamping does not overwrite the remembered rectangle', JSON.stringify(smallerGeometry.saved) === JSON.stringify(edgeGeometry.saved));
  await click('#btn-ai-summary-close'); await click('#btn-ai-reader');
  check('reopening in a small window remains within all reader edges', insideReader(await readGeometry()));
  win.webContents.setZoomFactor(1.25);
  await until(() => Math.abs(innerWidth - 640) <= 1 && Math.abs(innerHeight - 480) <= 1);
  await until(panelFitsReader); await settle();
  const zoomedGeometry = await readGeometry();
  check('browser zoom clamps the AI panel to the resized reading region', insideReader(zoomedGeometry));
  await evaluate(() => {
    const close = $('btn-ai-summary-close'), r = close.getBoundingClientRect();
    if (!close.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))) throw new Error('Zoomed close control is unreachable');
    close.click(); __gaiaDebug.openAiAssistant();
  }); await settle();
  check('reopening while zoomed keeps both reader toolbars uncovered', insideReader(await readGeometry()));
  check('zoom and small-window reopening preserve the intended rectangle', JSON.stringify((await readGeometry()).saved) === JSON.stringify(edgeGeometry.saved));
  win.webContents.setZoomFactor(1);
  await until(() => innerWidth === 800 && innerHeight === 600);
  await wait(350);
  win.setContentSize(1100, 800);
  await until(() => innerWidth === 1100 && innerHeight === 800);
  await settle();
  const largerGeometry = await readGeometry();
  report.viewportResize = { intended: edgeGeometry, smaller: smallerGeometry, zoomed: zoomedGeometry, restored: largerGeometry };
  check('enlarging the application restores the exact pre-shrink AI rectangle', ['left', 'top', 'width', 'height'].every(key => Math.abs(largerGeometry[key] - edgeGeometry[key]) <= 1));
  check('viewport resize notifications do not drift the saved geometry', JSON.stringify(largerGeometry.saved) === JSON.stringify(edgeGeometry.saved));
  check('panel retains two-axis resizing', await evaluate(() => getComputedStyle(els.aiSummaryPanel).resize === 'both'));
  await evaluate(() => { els.aiSummaryPanel.style.width = '360px'; els.aiSummaryPanel.style.height = '440px'; });
  await wait(400);
  await click('#btn-ai-summary-close'); await click('#btn-ai-reader');
  check('resized panel geometry persists across reopen inside the reader', await evaluate(() => Math.abs(els.aiSummaryPanel.offsetWidth - 360) <= 1 && Math.abs(els.aiSummaryPanel.offsetHeight - 440) <= 1) && insideReader(await readGeometry()));
  win.setContentSize(800, 600);
  await until(() => innerWidth === 800 && innerHeight === 600); await until(panelFitsReader); await settle();
  await evaluate(answer => {
    state.aiConfig.model = 'local-fixture-a-very-long-model-name-for-width-checks';
    const source = currentChapterSummarySource();
    showAiAssistantChapter(source);
    state.aiChats[aiChatKey(source)] = [{ role: 'user', content: '结合这一章分析人物关系与伏笔。' }, { role: 'assistant', content: answer }];
    renderAiChat(source);
    const body = $('reader-body').getBoundingClientRect();
    applyAiPanelGeometry({ width: 340, height: Math.min(440, body.height - 24), left: Math.min(body.left + 390, body.right - 352), top: body.top + 12 });
  }, response);
  await setInput('');
  await measure('narrow window');
  check('narrow panel stays inside the reading region', insideReader(await readGeometry()));
  check('narrow panel has no horizontal content overflow', await evaluate(() => [els.aiSummaryPanel, els.aiChatMessages, document.querySelector('.ai-chat-input-shortcuts'), document.querySelector('.ai-panel-profile-row')].every(el => el.scrollWidth <= el.clientWidth + 1)));
  check('narrow shortcuts stay equally sized', await evaluate(() => { const r = [...document.querySelectorAll('.ai-chat-input-shortcuts button')].map(el => el.getBoundingClientRect()); return r.length === 3 && r.every(el => Math.abs(el.width - r[0].width) < 1 && Math.abs(el.height - r[0].height) < 1); }));
  check('narrow panel controls remain reachable', await evaluate(() => [...els.aiSummaryPanel.querySelectorAll('button, textarea')].filter(el => el.getClientRects().length).every(el => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; return el.contains(document.elementFromPoint(x, y)); })));
  await shot('chat-narrow');
  await evaluate(() => { state.prefs.aiTypography = { fontName: 'default', fontSize: 24, lineHeight: 2.3 }; applyAiTypography(); });
  await settle();
  check('maximum typography preserves a complete empty input line', await evaluate(() => {
    const style = getComputedStyle(els.aiChatInput);
    const oneLine = parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;
    return style.fontSize === '24px' && Math.abs(parseFloat(style.lineHeight) - 55.2) < .1 && els.aiChatInput.offsetHeight >= oneLine && els.aiChatInput.offsetHeight <= 96;
  }));
  await setInput('大字号第一行\n大字号第二行\n大字号第三行');
  check('maximum typography still caps multiline input at 96px', await evaluate(() => els.aiChatInput.offsetHeight <= 96 && els.aiChatInput.scrollHeight > els.aiChatInput.clientHeight));
  check('maximum typography keeps the message viewport and send button usable', await evaluate(() => {
    const r = els.aiChatSend.getBoundingClientRect();
    return els.aiChatMessages.clientHeight > 100 && els.aiChatSend.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }));
  await shot('chat-max-typography');
  await setInput('');
  check('maximum typography contracts back to one complete line', await evaluate(() => els.aiChatInput.offsetHeight >= 65 && els.aiChatInput.offsetHeight <= 66));
  check('fixture book remains unchanged', fs.readFileSync(bookPath, 'utf8') === bookContent);
  check('no renderer errors', report.errors.length === 0);
}
BrowserWindow.prototype.show = function () { this.showInactive(); };
app.on('browser-window-created', (_event, window) => {
  if (attached) return;
  attached = true; win = window;
  win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  win.webContents.once('did-finish-load', () => run().then(() => finish(), finish));
});
require('../src/main');
