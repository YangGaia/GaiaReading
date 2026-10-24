'use strict';

// Exercise real readers, UI, IPC and outgoing requests against a local server.
// No saved credentials or cloud models are used; this tests boundaries, not LLM quality.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { makeMobi7, makeKf8 } = require('../tests/fixtures/mobi-image-fixture');
const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-ai-reading-'));
const output = path.resolve(process.env.GAIA_AI_READING_OUTPUT || path.join(project, 'dist/previews/ai-reading'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
BrowserWindow.prototype.show = function () { this.showInactive(); };
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light', fontSize: 100 }, pet: { auto: false, autoSpeech: false, autoSleep: false } }));
const report = { checks: [], errors: [], screenshots: [], measurements: [], sandbox, output, interface: 'local mock; no live-model evaluation' };
const requests = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const unread = '本章未读密封信藏在钟楼';
const nextChapter = '后续章节绝密身份';
const longText = '頭髮與發展。冬夜里，他低下头，没有回答。窗外的钟声响起，他把信放回抽屉。'.repeat(500);
const body = '<h1 id="c1">第一章 冬夜的来信</h1><p>' + longText + '</p><p>' + unread + '</p>' + '<h1 id="local-second" style="break-before:column">第二章 新的早晨</h1><p>' + nextChapter + '</p>';
let finished = false;
let nextAnswer = '';
const deadline = setTimeout(() => finish(new Error('AI reading validation timed out')), 180000);
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', data => { raw += data; });
  req.on('end', () => {
    const request = JSON.parse(raw);
    requests.push(request);
    const full = request.messages[1].content.includes('当前整章（');
    const answer = nextAnswer || (full ? '【本地模拟整章回复】' + unread : '【本地模拟回复，仅用于界面验证】\n认知失调指信念与行为不一致时产生的心理不适。可以结合已读细节分析人物如何解释自己的选择，并保留其他可能。');
    nextAnswer = '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
});
server.listen(0, '127.0.0.1');
function check(name, value) { assert.ok(value, name); report.checks.push(name); }
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  report.requests = requests;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, error: report.error }, null, 2));
  server.close();
  app.exit(error ? 1 : 0);
}

async function run(win) {
  win.setContentSize(1200, 820);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const shot = async name => {
    await wait(200);
    const file = path.join(output, name + '.png');
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(file);
  };
  await evaluate(() => __gaiaDebug.waitHome());
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  await evaluate(async baseUrl => {
    const profiles = await api.aiProfileSave({ name: '本地验证接口', provider: 'custom', baseUrl, apiKey: 'local-test-only', model: 'local-reading-test', activate: true });
    acceptAiProfiles(profiles, profiles.activeId);
  }, 'http://127.0.0.1:' + server.address().port + '/v1');

  const txt = path.join(sandbox, 'reading.txt');
  fs.writeFileSync(txt, '第一章 冬夜的来信\n\n' + longText + '\n\n' + unread + '\n\n第二章 新的早晨\n\n' + nextChapter);
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(project, 'tests/fixtures/sample.epub')));
  zip.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>' + body + '</body></html>');
  zip.file('OEBPS/c2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><h1>第二章</h1><p>' + nextChapter + '</p></body></html>');
  const epub = path.join(sandbox, 'reading.epub');
  fs.writeFileSync(epub, await zip.generateAsync({ type: 'nodebuffer' }));
  const books = [
    { path: txt, title: '冬夜的来信 · 范围验证', format: 'txt' },
    { path: epub, title: 'EPUB 范围验证', format: 'epub' },
    makeMobi7(sandbox, body),
    makeKf8(sandbox, body),
  ];
  for (const book of books) {
    await evaluate(book => __gaiaDebug.openBook(book), book);
    if (book.format === 'azw3') await evaluate(() => __gaiaDebug.jumpToMobiChapter(3));
    await wait(450);
    const source = await evaluate(() => {
      const source = currentAiAssistantSource();
      return { chapter: source.chapterTitle, full: currentAiChatSource(source, true), read: currentAiChatSource(source) };
    });
    report.measurements.push({ format: book.format, ...source });
    check(book.format + ': current page has original text, without unread ending', source.read.content.length > 20 && !source.read.content.includes(unread));
    check(book.format + ': chapter heading and paragraph remain separated in AI text', source.read.content.includes('\n\n'));
    check(book.format + ': full chapter includes its ending but excludes next chapter', source.full.content.includes(unread) && !source.full.content.includes(nextChapter));
    check(book.format + ': single text node is cut at visible character, not paragraph end', source.read.readEnd < source.full.readEnd / 2);
    await evaluate(() => showAiAssistantPanel());
    const before = requests.length;
    await evaluate(() => sendAiQuestion('认知失调是什么意思？可以结合这段分析吗？'));
    check(book.format + ': real UI and IPC send a successful normal request', requests.length === before + 1);
    check(book.format + ': outgoing network request excludes unread content', !JSON.stringify(requests.at(-1).messages).includes(unread));

    if (book.format === 'txt') {
      await shot('ai-reading-default');
      win.setContentSize(800, 600);
      await wait(250);
      check('narrow window keeps scope choice and send button accessible', await evaluate(() => {
        const scope = $('ai-chat-whole-chapter').getBoundingClientRect();
        const send = $('btn-ai-chat-send').getBoundingClientRect();
        return scope.width > 0 && scope.top >= 0 && send.bottom <= window.innerHeight && send.right <= window.innerWidth;
      }));
      await shot('ai-reading-narrow');
      win.setContentSize(1200, 820);
      await evaluate(() => __gaiaDebug.setTheme('dark'));
      await shot('ai-reading-dark');
      await evaluate(() => __gaiaDebug.setTheme('light'));
      await wait(250);
      await evaluate(() => $('btn-ai-full-summary-prompt').click());
      check('whole-chapter shortcut only fills the question and visibly opts in', requests.length === before + 1 && await evaluate(() => $('ai-chat-whole-chapter').checked && $('ai-summary-status').textContent.includes('未读')));
      await shot('ai-reading-whole-chapter');
      await evaluate(() => sendAiQuestion());
      check('whole-chapter request includes current ending and resets permission', requests.at(-1).messages[1].content.includes(unread) && await evaluate(() => !$('ai-chat-whole-chapter').checked));
      await evaluate(() => sendAiQuestion('继续解释认知失调，联系目前读到的内容。'));
      check('full chapter and its answer are excluded from next normal request', !JSON.stringify(requests.at(-1).messages).includes(unread));
      await evaluate(() => state.current.paginator.showPage(2));
      const later = await evaluate(() => currentAiChatSource(currentAiAssistantSource()));
      check('page advance grows the safe text boundary', later.readEnd > source.read.readEnd);
      nextAnswer = '后页回答唯一标记';
      await evaluate(() => sendAiQuestion('分析这一页的动作'));
      await evaluate(() => state.current.paginator.showPage(0));
      await evaluate(() => sendAiQuestion('再解释第一段'));
      check('returning to an earlier page excludes later-page history', !JSON.stringify(requests.at(-1).messages).includes('后页回答唯一标记'));
      nextAnswer = '剧透回答唯一标记';
      await evaluate(() => sendAiQuestion('允许剧透，告诉我结局'));
      await evaluate(() => sendAiQuestion('现在解释比喻的作用'));
      check('spoiler-bearing turn and its authorization are isolated from later questions', !JSON.stringify(requests.at(-1).messages).includes('剧透回答唯一标记') && !JSON.stringify(requests.at(-1).messages.slice(1)).includes('允许剧透'));
      await evaluate(() => GaiaReaderChinese.apply(state.current.paginator.doc.body, 'simplified'));
      const converted = await evaluate(() => currentAiChatSource(currentAiAssistantSource()));
      check('Chinese display conversion keeps original text coordinates and spoiler boundary', converted.content.includes('頭髮與發展') && !converted.content.includes(unread));
      await evaluate(() => state.current.paginator.setMode('spread'));
      const spread = await evaluate(() => currentAiChatSource(currentAiAssistantSource()));
      check('spread includes both visible columns without exposing the ending', spread.readEnd > converted.readEnd && !spread.content.includes(unread));
    }
    if (book.format === 'epub') {
      check('hover footnote tooltip cannot extend the reading boundary to the chapter ending', await evaluate(() => {
        const before = currentAiChatSource(currentAiAssistantSource());
        const doc = state.current.rendition.getContents()[0].document;
        const tooltip = doc.createElement('div');
        tooltip.className = 'gaia-footnote-tooltip';
        tooltip.style.cssText = 'position:fixed;left:20px;top:20px';
        tooltip.textContent = '悬停注释';
        doc.body.appendChild(tooltip);
        try { return currentAiChatSource(currentAiAssistantSource()).readEnd === before.readEnd; }
        finally { tooltip.remove(); }
      }));
      check('EPUB page advance grows safe scope without including the next logical chapter', await evaluate(async nextChapter => {
        const before = currentAiChatSource(currentAiAssistantSource()).readEnd;
        await nextPage();
        await new Promise(resolve => setTimeout(resolve, 180));
        const read = currentAiChatSource(currentAiAssistantSource());
        return read.readEnd > before && !read.content.includes(nextChapter);
      }, nextChapter));
      check('unknown EPUB viewport does not fall back to the full chapter', await evaluate(() => {
        const source = currentAiAssistantSource();
        const container = state.current.rendition.manager.container;
        const previous = container.getBoundingClientRect;
        container.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
        try { return currentAiChatSource(source).content === ''; }
        finally { container.getBoundingClientRect = previous; }
      }));
      check('jump within one EPUB document selects the new logical chapter and resets opt-in', await evaluate(async marker => {
        $('ai-chat-whole-chapter').checked = true;
        const c = state.current;
        await c.rendition.display(c.epub.spine.get(0).href + '#local-second');
        await new Promise(resolve => setTimeout(resolve, 200));
        const source = currentAiAssistantSource();
        const read = currentAiChatSource(source);
        return source.chapterTitle.includes('第二章') && read.content.includes(marker) && !$('ai-chat-whole-chapter').checked;
      }, nextChapter));
    }
  }
  const pdf = { path: path.join(project, 'tests/fixtures/sample.pdf'), format: 'pdf', title: 'PDF 范围验证' };
  await evaluate(book => __gaiaDebug.openBook(book), pdf);
  await evaluate(() => showAiAssistantPanel());
  const pdfSource = await evaluate(() => currentAiChatSource(currentAiAssistantSource()));
  await evaluate(() => sendAiQuestion('解释一个阅读方法，不需要书中具体信息'));
  check('PDF asks questions with only current displayed pages and disables whole-chapter opt-in', pdfSource.content.length > 0 && requests.at(-1).messages[1].content.includes(pdfSource.content) && await evaluate(() => $('ai-chat-whole-chapter').disabled));

  const noChapter = path.join(sandbox, 'no-chapters.txt');
  fs.writeFileSync(noChapter, '这是一段没有章节标题的文字。'.repeat(150));
  await evaluate(book => __gaiaDebug.openBook(book), { path: noChapter, format: 'txt', title: '无章节验证' });
  check('unidentified chapter still opens assistant without sending whole book', await evaluate(() => showAiAssistantPanel() && currentAiChatSource(currentAiAssistantSource()).content === ''));
  const previousRequests = requests.length;
  await evaluate(() => sendAiQuestion('解释一下叙事视角'));
  check('general question succeeds even without chapter text', requests.length === previousRequests + 1 && requests.at(-1).messages[1].content.includes('当前没有可用正文'));
  check('no renderer errors', report.errors.length === 0);
}

app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(), finish));
});
require('../src/main');
