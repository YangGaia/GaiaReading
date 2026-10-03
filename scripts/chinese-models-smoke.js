'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { makeMobi7, makeKf8 } = require('../tests/fixtures/mobi-image-fixture');
const project = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-chinese-models-'));
const output = path.join(project, 'dist/previews/chinese-models');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', sandbox);
app.setPath('sessionData', path.join(sandbox, 'session'));
app.setAppPath(project);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
BrowserWindow.prototype.show = function () { this.showInactive(); };
fs.writeFileSync(path.join(sandbox, 'gaia-reading.json'), JSON.stringify({ library: [], prefs: { theme: 'light' }, pet: { auto: false, autoSpeech: false, autoSleep: false } }));

const report = { checks: [], errors: [], screenshots: [], sandbox, output };
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let finished = false;
let server;
const deadline = setTimeout(() => finish(new Error('Chinese/model validation timed out')), 180000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (server) server.close();
  report.passed = !error;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}

function check(name, value) {
  assert.ok(value, name);
  report.checks.push(name);
  console.log('CHECK_OK ' + name);
}

async function run(win) {
  win.setContentSize(1200, 820);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) { report.errors.push(message); console.error(message); }
  });
  const evaluate = (callback, value) => win.webContents.executeJavaScript('(' + callback.toString() + ')(' + JSON.stringify(value) + ')');
  const shot = async name => {
    await wait(300);
    const file = path.join(output, name + '.png');
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    report.screenshots.push(file);
  };
  await evaluate(() => __gaiaDebug.waitHome());
  check('DOM conversion preserves phrases across inline nodes, attributes, original variants and supplementary offsets', await evaluate(() => {
    const doc = new DOMParser().parseFromString('<p id="probe">頭<em>髮</em>發展，周𫖮讀書，裏面有書。</p><a href="#繁體">繁體</a><pre>繁體原樣</pre>', 'text/html');
    const original = doc.body.textContent;
    GaiaReaderChinese.apply(doc.body, 'simplified');
    const simple = doc.querySelector('p').textContent === '头发发展，周𫖮读书，里面有书。';
    const start = doc.body.textContent.indexOf('读书');
    const range = GaiaReaderChinese.rangeAt(doc.body, start, start + 2);
    const mark = doc.createElement('mark');
    range.surroundContents(mark);
    const offset = GaiaReaderChinese.sourceOffset(doc.body, start);
    GaiaReaderChinese.apply(doc.body, 'traditional');
    const stable = doc.body.textContent.includes('周顗讀書') && mark.textContent === '讀書' && GaiaReaderChinese.sourceOffset(doc.body, GaiaReaderChinese.displayOffset(doc.body, offset)) === offset;
    GaiaReaderChinese.apply(doc.body, null);
    return simple && stable && doc.body.textContent === original && doc.querySelector('a').getAttribute('href') === '#繁體' && doc.querySelector('pre').textContent === '繁體原樣';
  }));

  const text = '第一章 閱讀與書房\n\n' + Array.from({ length: 75 }, (_, index) => `第${index + 1}段：頭髮與發展，乾淨的書房裏，周𫖮安靜地閱讀。月光落在書頁上，故事繼續。`).join('\n\n');
  const txt = { path: path.join(sandbox, 'traditional.txt'), title: '月光下的书房', format: 'txt' };
  fs.writeFileSync(txt.path, text);
  await evaluate(book => __gaiaDebug.openBook(book), txt);
  check('TXT detects traditional on first open without saving an automatic preference', await evaluate(() => state.current.chineseScript === 'traditional' && !state.prefs.chineseScript && $('chinese-script-value').textContent === '繁体'));
  const originalAi = await evaluate(() => currentChapterSummarySource());
  check('TXT bookmark and annotation store original coordinates', await evaluate(async () => {
    const current = state.current;
    const root = current.paginator.doc.body;
    const offset = root.textContent.indexOf('周顗');
    current.paginator.showPage(current.paginator.locate(offset));
    const selected = GaiaReaderChinese.rangeAt(root, offset, offset + 4);
    const selection = root.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(selected);
    captureTextSelection(root.ownerDocument, root);
    await saveSelectionAnnotation('green', false);
    await addBookmark();
    return annotationsForBook(state.annotations, current.path)[0].anchor.quote.includes('周𫖮');
  }));
  await evaluate(async () => { await toggleChineseScript(); els.annotationsPanel.hidden = true; await refreshReaderLayout(captureReaderLayoutAnchor(), { force: true }); openSettings(); });
  check('first click switches TXT to simplified and persists the preference', await evaluate(async () => {
    const current = state.current;
    const saved = await api.stateGet('prefs');
    return current.chineseScript === 'simplified' && current.paginator.doc.body.textContent.includes('头发与发展') && saved.chineseScript === 'simplified' && $('chinese-script-value').textContent === '简体';
  }));
  check('TXT annotation survives conversion and AI source is unchanged', await evaluate(before => {
    const root = state.current.paginator.doc.body;
    return root.querySelector('mark[data-gaia-annotation]').textContent.includes('周𫖮') && currentChapterSummarySource().content === before.content;
  }, originalAi));
  await shot('reading-simplified');
  await evaluate(async () => { closeSettings(); await jumpToBookmark(state.bookmarks[state.current.path][0]); await toggleChineseScript(); openSettings(); });
  check('second click returns to traditional and keeps bookmark anchor visible', await evaluate(() => {
    const current = state.current;
    const bookmark = state.bookmarks[current.path][0];
    return $('chinese-script-value').textContent === '繁体' && current.paginator.anchorInView(GaiaReaderChinese.displayOffset(current.paginator.doc.body, bookmark.anchor.off));
  }));
  await shot('reading-traditional');
  await evaluate(() => closeSettings());
  check('TXT search matches simplified queries in traditional text and highlights', await evaluate(async () => {
    const result = await __gaiaDebug.runBookSearch('头发与发展');
    const located = await __gaiaDebug.activateBookSearchResult(2);
    return result.results === 75 && located.highlightCount > 0;
  }));
  await evaluate(() => closeBookSearch());

  const archive = await JSZip.loadAsync(fs.readFileSync(path.join(project, 'tests/fixtures/sample.epub')));
  const body = '<h1 id="c1">第一章 阅读与书房</h1>' + Array.from({ length: 65 }, (_, index) => '<p id="para-' + index + '">周𫖮的头<em>发</em>与发展，干净的书房里，阅读让故事继续。' + '窗外的月光落在书页上。'.repeat(10) + '</p>').join('');
  archive.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>简繁验证</title></head><body>' + body + '</body></html>');
  const epub = { path: path.join(sandbox, 'chinese.epub'), title: '简繁与定位验证', format: 'epub' };
  fs.writeFileSync(epub.path, await archive.generateAsync({ type: 'nodebuffer' }));
  await evaluate(book => __gaiaDebug.openBook(book), epub);
  await wait(200);
  check('saved traditional preference applies to a simplified EPUB, including inline phrases', await evaluate(() => state.current.rendition.getContents()[0].document.body.textContent.includes('周顗的頭髮與發展')));
  check('EPUB CFI round trips supplementary characters and saved annotation locations', await evaluate(async () => {
    const current = state.current;
    const contents = current.rendition.getContents()[0];
    const root = contents.document.body;
    const offset = root.textContent.indexOf('頭髮');
    const range = GaiaReaderChinese.rangeAt(root, offset, offset + 2);
    const displayed = contents.cfiFromRange(range);
    const canonical = sourceEpubCfi(current, displayed);
    const restored = displayedEpubCfi(current, canonical);
    const originalRange = new ePub.CFI(canonical).toRange(GaiaReaderChinese.sourceRoot(root).ownerDocument);
    const restoredRange = contents.range(restored);
    await persistSelectionAnnotation({ text: '頭髮', anchor: { kind: 'epub-cfi', cfi: canonical }, chapter: '第一章' }, 'yellow', '简繁切换测试');
    await addBookmark();
    return originalRange.toString() === '头发' && restoredRange.toString() === '頭髮';
  }));
  const epubAi = await evaluate(() => currentChapterSummarySource());
  await evaluate(() => toggleChineseScript());
  check('EPUB conversion restores highlights, canonical bookmarks and original AI context', await evaluate(async before => {
    const current = state.current;
    await jumpToBookmark(state.bookmarks[current.path][0]);
    await jumpToAnnotation(annotationsForBook(state.annotations, current.path)[0]);
    const contents = current.rendition.getContents()[0];
    return contents.document.body.textContent.includes('周𫖮的头发与发展') && currentChapterSummarySource().content === before.content && current.epubAppliedAnnotations.size === 1;
  }, epubAi));
  check('EPUB search handles both scripts with the changed layout', await evaluate(async () => {
    const result = await __gaiaDebug.runBookSearch('頭髮與發展');
    const located = await __gaiaDebug.activateBookSearchResult(1);
    return result.results === 65 && located.highlightCount > 0;
  }));
  await evaluate(async () => { closeBookSearch(); await toggleChineseScript(); });
  await evaluate(() => __gaiaDebug.backToLibrary());
  await evaluate(book => __gaiaDebug.openBook(book), epub);
  check('EPUB reopens its persisted position in the chosen script', await evaluate(() => state.current.chineseScript === 'traditional' && state.current.rendition.getContents()[0].document.body.textContent.includes('頭髮')));
  await evaluate(() => { state.prefs.chineseScript = null; });
  await evaluate(book => __gaiaDebug.openBook(book), epub);
  check('EPUB automatically detects simplified text before a manual preference exists', await evaluate(() => state.current.chineseScript === 'simplified' && !state.prefs.chineseScript));
  const traditionalEpub = { ...epub, path: path.join(sandbox, 'traditional.epub') };
  const chinese = require('../src/shared/chinese-script');
  archive.file('OEBPS/c1.xhtml', chinese.convert(await archive.file('OEBPS/c1.xhtml').async('string'), 'traditional'));
  fs.writeFileSync(traditionalEpub.path, await archive.generateAsync({ type: 'nodebuffer' }));
  await evaluate(book => __gaiaDebug.openBook(book), traditionalEpub);
  check('EPUB automatically detects traditional text without recording a preference', await evaluate(() => state.current.chineseScript === 'traditional' && !state.prefs.chineseScript));
  await evaluate(() => { state.prefs.chineseScript = 'traditional'; });

  const mobi = makeMobi7(sandbox, '<h1>第一章 阅读故事</h1><p>' + '头发与发展，阅读书籍。'.repeat(100) + '</p>');
  await evaluate(book => __gaiaDebug.openBook(book), mobi);
  check('MOBI parser and paginator apply the saved preference', await evaluate(() => state.current.paginator.doc.body.textContent.includes('頭髮與發展')));
  await evaluate(() => toggleChineseScript());
  check('MOBI switches in place', await evaluate(() => state.current.paginator.doc.body.textContent.includes('头发与发展')));
  const kf8 = makeKf8(sandbox);
  await evaluate(book => __gaiaDebug.openBook(book), kf8);
  check('AZW3 subsequent chapters use the current script', await evaluate(async () => {
    await loadMobiChapter(state.current.mobi.chapters.length - 1, {});
    await toggleChineseScript();
    return state.current.paginator.doc.body.textContent.includes('閱讀位置驗證');
  }));
  await evaluate(book => __gaiaDebug.openBook(book), { path: path.join(project, 'tests/fixtures/sample.pdf'), title: 'PDF 验证', format: 'pdf' });
  check('PDF conversion is disabled with an explanation', await evaluate(() => { openSettings(); return $('btn-chinese-script').disabled && $('btn-chinese-script').title.includes('固定版式'); }));
  await evaluate(() => { closeSettings(); openAiCenter(); });

  let generation = 1;
  let failModels = false;
  let modelRequests = 0;
  let lastChatModel = '';
  let delayModels = 0;
  server = http.createServer(async (request, response) => {
    if (request.url.startsWith('/v1/models')) {
      modelRequests++;
      if (delayModels) await wait(delayModels);
      response.writeHead(failModels ? 401 : 200, { 'Content-Type': 'application/json' });
      if (failModels) return response.end(JSON.stringify({ error: { message: '测试鉴权失败' } }));
      const names = ['gpt-pro', 'claude-reading', 'gemini-reading', 'deepseek-chat', 'qwen-reading', 'glm-reading', 'llama-reading', 'mistral-reading', 'kimi-reading'];
      const data = names.map(id => ({ id, capabilities: ['text'] })).concat(Array.from({ length: 245 }, (_, index) => ({ id: 'private-' + index })));
      if (generation > 1) { data.shift(); data.push({ id: 'gpt-upstream-new', capabilities: ['text', 'reasoning'] }); }
      response.end(JSON.stringify({ data }));
    } else {
      let body = '';
      for await (const chunk of request) body += chunk;
      lastChatModel = JSON.parse(body).model;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '已验证模型调用。' } }] }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const originalActive = await evaluate(() => state.aiProfiles.activeId);
  await evaluate(async base => {
    newAiProfile();
    els.aiProfileName.value = '阅读接口 · 本地验证';
    els.aiProvider.value = 'custom';
    changeAiProvider();
    els.aiBaseUrl.value = base;
    els.aiApiKey.value = 'fixture-key';
    els.aiModel.value = '';
    await refreshAiModels();
  }, baseUrl);
  check('new draft fetches 254 models without a model ID or activating another profile', await evaluate(active => state.aiProfiles.activeId === active && aiModelChoices().models.length === 254 && els.aiModel.value === '', originalActive));
  check('model groups and search show complete IDs beyond the old 200 limit', await evaluate(() => {
    $('ai-model-search').value = 'private-244';
    updateAiModelOptions();
    const found = els.aiModelOptions.querySelector('[data-model-id="private-244"]');
    $('ai-model-search').value = '';
    $('ai-model-family').value = 'Claude';
    updateAiModelOptions();
    const grouped = els.aiModelOptions.querySelectorAll('[data-model-id]').length === 1;
    $('ai-model-family').value = '';
    updateAiModelOptions();
    return !!found && grouped && els.aiModelOptions.querySelectorAll('[role="group"]').length >= 9;
  }));
  check('model list supports keyboard navigation', await evaluate(() => {
    const options = els.aiModelOptions.querySelectorAll('[data-model-id]');
    options[0].focus();
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    return document.activeElement === options[1];
  }));
  await evaluate(() => $('btn-ai-save').scrollIntoView({ block: 'end' }));
  await shot('ai-model-catalog');
  await evaluate(async () => {
    els.aiModelOptions.querySelector('[data-model-id="claude-reading"]').click();
    await saveAiConfig();
  });
  const profileId = await evaluate(() => state.aiProfiles.activeId);
  check('saved profile adopts the fetched cache and encrypted key', await evaluate(() => !!activeAiProfile().modelCatalog && activeAiProfile().hasApiKey));
  generation = 2;
  await evaluate(() => refreshAiModels());
  check('refresh sees additions/removals and retains the current selection', await evaluate(() => {
    const catalog = currentAiModelCatalog();
    return catalog.added.includes('gpt-upstream-new') && catalog.removed.includes('gpt-pro') && els.aiModel.value === 'claude-reading' && els.aiModelOptions.querySelector('[data-model-id="gpt-upstream-new"] .ai-model-badge');
  }));
  check('a removed selected model is kept and clearly identified', await evaluate(() => {
    els.aiModel.value = 'gpt-pro';
    updateAiModelOptions();
    const kept = els.aiModel.value === 'gpt-pro' && els.aiModelHint.textContent.includes('不在最新列表');
    els.aiModel.value = 'claude-reading';
    updateAiModelOptions();
    return kept;
  }));
  await evaluate(() => $('btn-ai-save').scrollIntoView({ block: 'end' }));
  await shot('ai-model-updated');
  await evaluate(async () => {
    els.aiModelOptions.querySelector('[data-model-id="gpt-upstream-new"]').click();
    await saveAiConfig();
    await api.aiChat({ profileId: state.aiProfiles.activeId, requestId: 'model-smoke', question: '总结本章', source: { content: '这是用于本地验证的章节。' }, history: [] });
  });
  check('selected upstream ID is sent unchanged through the real chat IPC', lastChatModel === 'gpt-upstream-new');
  failModels = true;
  await evaluate(() => refreshAiModels());
  check('failed refresh preserves the successful catalog and current model', await evaluate(() => currentAiModelCatalog().models.length === 254 && els.aiModel.value === 'gpt-upstream-new' && els.aiConfigStatus.textContent.includes('401')));
  failModels = false;
  delayModels = 200;
  check('late refresh does not overwrite another editing profile', await evaluate(async otherId => {
    const pending = refreshAiModels();
    await selectAiProfile(otherId);
    await pending;
    return state.aiEditingProfileId === otherId && !state.aiModelDraft;
  }, originalActive));
  delayModels = 0;
  await evaluate(async id => { await selectAiProfile(id); els.aiApiKey.value = 'changed-key'; els.aiApiKey.dispatchEvent(new Event('input')); }, profileId);
  check('edited key invalidates the previous visible catalog', await evaluate(() => currentAiModelCatalog() === null));
  await evaluate(() => { els.aiApiKey.value = ''; els.aiApiKey.dispatchEvent(new Event('input')); });
  check('unchanged saved key restores its own cached catalog', await evaluate(() => currentAiModelCatalog().models.length === 254));
  check('manual refresh always reaches upstream', modelRequests >= 4);
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  await evaluate(() => __gaiaDebug.waitHome());
  check('preference and model catalog survive a renderer restart', await evaluate(id => state.prefs.chineseScript === 'traditional' && state.aiProfiles.items.find(profile => profile.id === id).modelCatalog.models.length === 254, profileId));
  check('no unexpected renderer errors', report.errors.length === 0);
}

app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(), finish));
});
require('../src/main');
