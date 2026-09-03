'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('项目关键文件齐全', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(root, pkg.main)), '主进程入口缺失');
  const main = fs.readFileSync(path.join(root, pkg.main), 'utf8');
  assert.ok(pkg.scripts.start, '缺少 start 脚本');
  assert.ok(pkg.scripts.test, '缺少 test 脚本');
  assert.ok(pkg.scripts.smoke, '缺少 smoke 脚本');
  assert.ok(pkg.scripts['smoke:open'], '缺少 smoke:open 脚本');
  assert.ok(pkg.scripts.shot, '缺少 shot 截图脚本');
  assert.ok(main.includes("capture('pet_console.png')"), '截图验收应包含有珠控制台界面');
  assert.ok(main.includes('const importResult = await __gaiaDebug.importPaths([fixture])'), 'EPUB 烟雾测试应走真实导入流程');
  assert.ok(main.includes('parsed.importSucceeded === true'), 'EPUB 烟雾测试应验证导入成功');
  assert.ok(main.includes('parsed.aiUiReady === true'), 'EPUB 烟雾测试应验证 AI 界面与章节提取');
  for (const frame of ['pet_tilt_early.png', 'pet_tilt_peak.png', 'pet_tilt_return.png']) {
    assert.ok(main.includes(`capture('${frame}')`), `截图验收缺少歪头动作帧 ${frame}`);
  }
  assert.ok(main.includes("capture('pet_wake_peak.png')"), '截图验收应包含唤醒动作峰值帧');
  for (const frame of ['pet_yawn_early.png', 'pet_yawn_peak.png', 'pet_yawn_return.png']) {
    assert.ok(main.includes(`capture('${frame}')`), `截图验收缺少打哈欠动作帧 ${frame}`);
  }
  for (const frame of ['pet_drowse_early.png', 'pet_drowse_peak.png', 'pet_drowse_return.png']) {
    assert.ok(main.includes(`capture('${frame}')`), `截图验收缺少困倦点头动作帧 ${frame}`);
  }
  for (const f of [
    'src/preload.js',
    'src/shared/bookmarks.js',
    'src/shared/epub-repair.js',
    'src/shared/library.js',
    'src/shared/pet.js',
    'src/shared/toc-panel.js',
    'src/shared/spread-gap.js',
    'src/renderer/index.html',
    'src/renderer/app.js',
    'src/renderer/pet.js',
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), f + ' 缺失');
  }
  for (const v of ['jszip.min.js', 'epub.min.js', 'pdf.min.js', 'pdf.worker.min.js']) {
    assert.ok(fs.existsSync(path.join(root, 'src/renderer/vendor', v)), 'vendor ' + v + ' 缺失');
  }
});

test('首页与闪屏图片资源存在', () => {
  for (const img of ['1.jpg', '2.jpeg']) {
    const f = path.join(root, 'src', 'renderer', 'images', img);
    assert.ok(fs.existsSync(f), img + ' 缺失，请先复制到 src/renderer/images/');
    assert.ok(fs.statSync(f).size > 10000, img + ' 异常过小');
  }
});

test('桌宠素材与映射表完整', () => {
  const petDir = path.join(root, 'src', 'renderer', 'images', 'pet');
  assert.ok(fs.existsSync(path.join(petDir, 'pet-expressions.json')), 'pet-expressions.json 缺失');
  const cellsDir = path.join(petDir, 'cells');
  const files = fs.existsSync(cellsDir) ? fs.readdirSync(cellsDir) : [];
  assert.ok(files.length >= 21, '表情格不足 21 个');
  for (const name of ['半身照.png', '日常表情.png']) {
    assert.ok(fs.existsSync(path.join(cellsDir, name)), name + ' 缺失');
  }
  const mapping = JSON.parse(fs.readFileSync(path.join(petDir, 'pet-expressions.json'), 'utf8'));
  assert.strictEqual(Object.keys(mapping.cells).length, 21, '映射表条目数不为 21');
  const yawnFace = path.join(petDir, 'faces', '打哈欠.png');
  assert.ok(fs.existsSync(yawnFace), '缺少打哈欠专用表情贴片');
  assert.ok(fs.statSync(yawnFace).size > 10000, '打哈欠专用表情贴片异常');
});

test('阅读目录支持左下角按钮与左缘悬停两种展开方式', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  for (const id of ['btn-reader-toc', 'toc-panel', 'toc-backdrop', 'toc-edge-trigger']) {
    assert.ok(html.includes(`id="${id}"`), `阅读目录缺少 ${id}`);
  }
  assert.ok(html.includes('../shared/toc-panel.js'), '渲染层未加载目录状态机');
  assert.ok(app.includes('toggleTocManualMode(tocMode)'), '目录按钮必须进入手动模式');
  assert.ok(app.includes('enterTocEdgeMode(tocMode)'), '阅读区左缘必须进入悬停模式');
  assert.ok(app.includes('activateTocItemMode(tocMode)'), '目录跳转后应根据打开来源决定是否关闭');
  assert.ok(app.includes("els.tocEdgeTrigger.addEventListener('pointerenter'"), '左缘缺少鼠标进入监听');
  assert.ok(app.includes("els.tocPanel.addEventListener('pointerleave'"), '目录缺少鼠标离开监听');
  assert.ok(css.includes('transform: translateX(-102%)') && css.includes('.toc-panel.toc-panel-open'), '目录缺少从左向右滑出的动画');
  assert.ok(css.includes('.reader-toc-button'), '阅读页左下角目录按钮缺少样式');
  const footer = html.slice(html.indexOf('<footer class="statusbar">'), html.indexOf('</footer>') + 9);
  assert.ok(footer.includes('id="btn-reader-toc"') && footer.includes('id="page-nav"'), '目录与翻页按钮应位于状态栏，不能悬浮遮挡正文');
  assert.ok(css.includes('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)'), '底栏应为左目录、中翻页、右状态的三栏布局');
  assert.ok(css.includes('min-height: 48px') && css.includes('padding: 9px 16px 8px'), '底栏控件上下应保留足够留白');
});

test('版本号为 1.0.0 且界面同步', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '1.0.0');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('Gaia Reading 1.0.0'), '关于面板版本号未同步');
  assert.ok(html.includes('btn-spread'), '缺少双页模式开关');
  assert.ok(html.includes('btn-theme'), '缺少主题切换');
  assert.ok(html.includes('fx-canvas'), '缺少粒子画布');
});

test('1.0.0 Release 说明完整并包含发行文件校验值', () => {
  const notes = fs.readFileSync(path.join(root, 'RELEASE_NOTES_1.0.0.md'), 'utf8');
  for (const section of ['与 0.5.2 相比的主要变化', 'AI 阅读助手', 'AI 隐私和接口安全', '多格式阅读与章节识别', '阅读统计与数据保护', '赛博桌宠']) {
    assert.ok(notes.includes(section), `Release 说明缺少 ${section}`);
  }
  assert.match(notes, /SHA-256：`[A-F0-9]{64}`/, 'Release 说明缺少 exe 的 SHA-256');
  assert.ok(!notes.includes('{{SHA256}}'), 'Release 说明不得保留校验值占位符');
});

test('AI 章节助手接入首页、设置与阅读器并保护 API Key', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const pet = fs.readFileSync(path.join(root, 'src', 'renderer', 'pet.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
  const ai = fs.readFileSync(path.join(root, 'src', 'shared', 'ai.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

  for (const id of ['btn-home-ai', 'ai-view', 'btn-ai-back', 'drawer-ai', 'btn-open-ai-center', 'ai-profile-list', 'ai-profile-name', 'btn-ai-profile-new', 'ai-provider', 'ai-base-url', 'ai-api-key', 'btn-ai-key-clear', 'ai-model-options', 'btn-ai-model-menu', 'btn-ai-model-refresh', 'reader-bgm-slot', 'btn-alice-summary', 'btn-alice-comment', 'ai-reader-profile', 'btn-ai-reader', 'btn-ai-assistant', 'ai-summary-panel', 'ai-panel-drag-handle', 'btn-ai-appearance', 'ai-appearance-popover', 'btn-ai-summary-minimize', 'btn-ai-summary-prompt', 'btn-ai-characters-prompt', 'btn-ai-foreshadow-prompt', 'ai-chat-pane', 'ai-font-select', 'btn-ai-font-minus', 'btn-ai-line-height', 'ai-chat-messages', 'ai-chat-input', 'drawer-lookup', 'search-engine', 'search-custom-row', 'search-custom-template']) {
    assert.ok(html.includes(`id="${id}"`), `AI 界面缺少 ${id}`);
  }
  for (const bridge of ['aiProfilesGet', 'aiProfileSave', 'aiProfileActivate', 'aiProfileDelete', 'aiProfileTest', 'aiProfileModels', 'aiChat', 'aiChatCancel', 'aiAliceComment', 'dictionaryOpen', 'searchWeb']) {
    assert.ok(preload.includes(bridge), `preload 缺少 ${bridge}`);
  }
  assert.ok(main.includes('safeStorage.encryptString'), 'API Key 必须通过 Electron safeStorage 加密');
  assert.ok(main.includes('safeStorage.decryptString'), 'API Key 必须只在主进程解密');
  assert.ok(main.includes("ipcMain.handle('ai:chat'"), '缺少受控 AI 对话 IPC');
  assert.ok(main.includes("ipcMain.handle('ai:chat:cancel'") && ai.includes('externalSignal.addEventListener'), 'AI 对话必须能取消实际网络请求');
  assert.ok(!main.includes("ipcMain.handle('ai:summarize'") && !preload.includes('aiSummarize'), '独立总结调用链应被移除');
  assert.ok(main.includes("ipcMain.handle('ai:alice-comment'"), '缺少有珠短评 IPC');
  assert.ok(main.includes("ipcMain.handle('ai:profile:activate'"), '缺少多接口切换 IPC');
  assert.ok(main.includes("ipcMain.handle('ai:profile:models'"), '缺少接口模型列表 IPC');
  assert.ok(ai.includes("redirect: 'error'"), 'AI 请求必须拒绝重定向，避免 Key 被转发');
  assert.ok(ai.includes('function parseEventStream'), 'AI 响应应兼容错误返回的 SSE 增量流');
  assert.ok(ai.includes('max_completion_tokens'), 'AI 请求应兼容仅接受 max_completion_tokens 的模型');
  assert.ok(ai.includes('directAnswerMessages'), 'AI 空正文时应自动请求一次可显示的最终答案');
  assert.ok(ai.includes('responseDiagnostics'), 'AI 空正文错误必须保留结束原因与安全诊断');
  assert.ok(ai.includes("parsed.protocol !== 'https:' && !local"), '远程 AI 接口必须使用 HTTPS');
  assert.ok(app.includes('getAiChapterSource'), 'Electron 冒烟调试接口应能验证章节提取');
  assert.ok(app.includes("window.GaiaPet.speak(result.comment"), '有珠短评应只显示为桌宠台词');
  assert.ok(!app.includes("messages.push({ role: 'assistant', mode: result.mode"), '有珠短评不应进入普通聊天记录');
  const readerHeaderStart = html.indexOf('<header class="topbar reader-topbar">');
  const readerHeader = html.slice(readerHeaderStart, html.indexOf('</header>', readerHeaderStart));
  const aiPanelStart = html.indexOf('id="ai-summary-panel"');
  const aiPanel = html.slice(aiPanelStart, html.indexOf('</aside>', aiPanelStart));
  assert.ok(readerHeader.includes('data-ai-alice="summary"') && readerHeader.includes('data-ai-alice="comment"'), '有珠总结与吐槽应位于阅读顶栏');
  assert.ok(!aiPanel.includes('data-ai-alice='), 'AI 对话框内不应重复显示有珠快捷操作');
  assert.ok(aiPanel.includes('id="ai-reader-profile"'), 'AI 接口选择器应移入对话框以释放顶栏空间');
  assert.ok(css.includes('.alice-reader-summary') && css.includes('#342653') && css.includes('#5b4a82'), '有珠总结应使用月光紫配色');
  assert.ok(css.includes('.alice-reader-comment') && css.includes('#40203a') && css.includes('#713851'), '有珠吐槽应使用暗红紫配色');
  assert.ok(app.includes("state.aiAliceKind === 'summary' ? '总结中' : '构思中'"), '顶栏快捷操作应显示独立加载状态');
  assert.ok(app.includes('new ResizeObserver'), 'AI 悬浮窗应记忆缩放后的尺寸');
  assert.ok(app.includes('saveAiPanelGeometry'), 'AI 悬浮窗应保存位置和大小');
  assert.ok(app.includes('setAiPanelMinimized'), 'AI 悬浮窗应统一更新最小化状态和无障碍标签');
  assert.ok(app.includes('toggleAiAppearanceMenu'), 'AI 排版设置应收进 Aa 弹出菜单');
  assert.ok(app.includes('setAiAppearanceOpen(els.aiAppearancePopover.hidden)'), 'Aa 按钮应能正确切换 AI 排版弹层');
  assert.ok(!html.includes('id="ai-summary-pane"') && !html.includes('id="btn-ai-tab-summary"'), '独立本章总结页签应被移除');
  assert.ok(app.includes("document.querySelectorAll('[data-ai-prompt]')"), '三个章节快捷键应共用输入逻辑');
  for (const prompt of ['简要概括本章内容', '总结本章人物关系', '总结本章伏笔']) {
    assert.ok(html.includes(`data-ai-prompt="${prompt}"`), `缺少快捷指令：${prompt}`);
  }
  const summaryPrompt = app.slice(app.indexOf('function fillAiPrompt('), app.indexOf('function aiChatKey'));
  assert.ok(summaryPrompt.includes('els.aiChatInput.value = prompt') && summaryPrompt.includes('确认后点击发送'), '章节快捷键应只填入指定的简短待确认指令');
  assert.ok(!summaryPrompt.includes('sendAiQuestion') && !summaryPrompt.includes('window.api.aiChat'), '点击总结快捷键不得自动提交请求');
  assert.ok(app.includes("'打断并发送'") && app.includes("'停止生成'") && app.includes('await cancelActiveAiChat()'), '回复期间应支持停止或用新消息打断');
  assert.ok(app.includes('findEpubNavLabel(nav, href)'), 'AI 章节标题应按当前 EPUB 资源路径精确匹配目录');
  assert.ok(app.includes('resolveEpubTocTarget(epub.spine && epub.spine.spineItems, item.href)'), 'EPUB 目录跳转前应把目录路径解析为 spine 目标');
  assert.ok(app.includes('selectChapterScope(entries, index, currentOffset)'), 'EPUB 对话应按目录边界截取当前小章');
  assert.ok(app.includes('selectChapterScope(entries, chapter, currentOffset)'), 'MOBI/AZW3 对话应按目录边界截取当前小章');
  assert.ok(app.includes('sameChapterSource(currentChapterSummarySource(), source)'), 'AI 返回结果应兼容同一正文的章节标识波动');
  assert.ok(app.includes('candidateContent.length >= 32'), 'MOBI/AZW3 的短标题页应推进到紧邻的真实章节');
  assert.ok(app.includes('await window.api.mobiChapter(c.mobiSession, nextIndex)'), '跨底层片段的 MOBI/AZW3 标题页应读取紧邻正文');
  assert.ok(app.includes('resolveAiChapterSource'), 'MOBI/AZW3 烟雾测试应验证总结前的异步章节补全');
  assert.ok(main.includes('当前章节没有可供 AI 阅读的文字'), '无正文页面必须显示明确错误');
  assert.ok(app.includes("semanticChapterEntries(root, chapter, c.format + ':' + chapter"), '目录缺少小章时，MOBI/AZW3 应按正文标题识别章节');
  assert.ok(app.includes("return holder.textContent || ''"), '章节正文提取不得受 AZW3 排版 CSS 的 innerText 可见性影响');
  assert.ok(app.includes("selector: item.selector || ''"), 'MOBI/AZW3 目录跳转应定位到同一底层文档内的小章起点');
  assert.ok(app.includes('未识别到 TXT 章节标题'), 'TXT 未识别章节时不得把全文发送给 AI');
  assert.ok(main.includes('parsed.aiContentLen > 100'), 'MOBI/AZW3 冒烟必须在总结前验证 AI 已读到正文，不能只读到空格或页码');
  assert.ok(css.includes('.ai-content-stage { flex: 1; min-height: 0; overflow: hidden; }'), 'AI 对话内容区不得覆盖标题和状态文字');
  assert.ok(css.includes('.ai-chat-input-shortcuts'), '对话输入区应显示快捷指令栏');
  assert.ok(css.includes('min-width: 0 !important; min-height: 0 !important;'), 'AI 最小化时必须覆盖普通窗口的最小尺寸');
  assert.ok(css.includes('.ai-summary-panel.minimized #btn-ai-chat-clear'), 'AI 最小化时应隐藏清空与排版按钮');
  assert.ok(css.includes('max-height: 220px; overflow-y: auto;'), '模型选择菜单应限制高度并支持纵向滚动');
  assert.ok(!html.includes('ai-auto-summarize') && !app.includes('AI_AUTO_SUMMARY') && !app.includes('autoSummarize'), '打开或切换章节不得自动调用 AI 总结');
  assert.ok(!app.includes('summarizeSource(') && !app.includes('aiSummarize'), '渲染层不得保留独立总结请求');
  for (const action of ['ai-analyze', 'ai-ask', 'dictionary', 'search']) {
    assert.ok(html.includes(`data-selection-action="${action}"`), `选区工具栏缺少 ${action}`);
  }
  assert.ok(app.includes("sourceDoc.addEventListener('selectionchange'"), '取消正文选择时应监听选区变化并隐藏工具栏');
  assert.ok(app.includes("context.origin !== 'selection'"), '已有批注与普通文字选区应使用不同的关闭规则');
  assert.ok(main.includes("ipcMain.handle('dictionary:open'"), '主进程缺少内置词典窗口入口');
  assert.ok(main.includes("partition: 'gaia-dictionary'"), '内置词典应使用隔离会话');
  assert.ok(main.includes('nodeIntegration: false') && main.includes('sandbox: true'), '内置词典窗口必须禁用 Node 并启用沙箱');
  assert.ok(main.includes("ipcMain.handle('selection:search'"), '主进程缺少默认浏览器搜索入口');
  assert.ok(main.includes('Lookup.searchUrl(normalized, { engine, customTemplate: input.customTemplate })'), '主进程应根据用户设置生成搜索地址');
  assert.ok(main.includes('shell.openExternal(target)'), '网页搜索应交给系统默认浏览器');
  assert.ok(app.includes('function saveSearchSettings()'), '搜索引擎选择应能持久保存');
  for (const engine of ['google', 'bing', 'baidu', 'custom']) {
    assert.ok(html.includes(`<option value="${engine}">`), `设置中缺少 ${engine} 搜索引擎`);
  }
  assert.ok(app.includes('document.createTextNode(message.content)'), 'AI 回答必须按纯文本渲染，不能作为 HTML 执行');
  assert.ok(pet.includes('function speak(text, duration)'), '桌宠应公开受长度限制的 AI 台词入口');
});

test('README 按拍摄时间引用当前全部界面截图', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const shots = [
    'PixPin_2026-09-01_20-10-31.png',
    'PixPin_2026-09-03_01-12-06.png',
    'PixPin_2026-09-03_01-13-04.png',
    'PixPin_2026-09-03_01-13-48.png',
    'PixPin_2026-09-03_01-14-32.png',
    'PixPin_2026-09-03_01-14-46.png',
  ];
  const referenced = Array.from(readme.matchAll(/docs\/screenshots\/([^\s)]+\.png)/g), (match) => match[1]);
  assert.deepStrictEqual(referenced, shots, 'README 截图必须按拍摄时间从早到晚排列且不引用旧图');
  const screenshotSection = readme.slice(readme.indexOf('## 界面截图'), readme.indexOf('## 主要功能'));
  assert.ok(!/^###\s+\d{4}-\d{2}-\d{2}/m.test(screenshotSection), '截图标题不应显示拍摄日期或时间');
  const currentFiles = fs.readdirSync(path.join(root, 'docs', 'screenshots')).filter((name) => name.toLowerCase().endsWith('.png')).sort();
  assert.deepStrictEqual(currentFiles, shots, 'README 必须展示 screenshots 目录中的全部 PNG');
  for (const shot of shots) {
    const file = path.join(root, 'docs', 'screenshots', shot);
    assert.ok(fs.statSync(file).size > 5000, shot + ' 异常过小');
  }
  assert.ok(readme.includes('当前稳定版本：**1.0.0**'), 'README 应明确当前稳定版本');
  assert.ok(readme.includes('releases/tag/v1.0.0'), 'README 应提供正式版下载入口');
});

test('主题/排版/翻页动画/菜单相关配置存在', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  assert.ok(css.includes('body.dark'), '缺少夜间模式变量');
  assert.ok(css.includes('body.eye'), '缺少护眼模式变量');
  assert.ok(css.includes('paging-next'), '缺少翻页动画规则');
  assert.ok(css.includes('pdf-dark'), '缺少 PDF 深色规则');
  assert.ok(css.includes('book-progress'), '缺少书架进度样式');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('font-select'), '缺少字体选择');
  assert.ok(html.includes('btn-text-contrast') && html.includes('text-contrast-value'), '缺少夜间文字对比度控制');
  assert.ok(html.includes('btn-theme'), '缺少主题切换');
  assert.ok(html.includes('btn-pet-console'), '设置页缺少有珠控制台入口');
  for (const id of ['pdf-zoom-controls', 'btn-pdf-zoom-out', 'btn-pdf-zoom-reset', 'btn-pdf-zoom-in', 'pdf-zoom-value']) {
    assert.ok(html.includes(`id="${id}"`), `PDF 阅读器缺少手动缩放控件 ${id}`);
  }
  assert.ok(app.includes("c.format === 'pdf' && (ev.ctrlKey || ev.metaKey)") && app.includes('queuePdfWheelZoom(d, ev)'), 'PDF 应支持 Ctrl+滚轮缩放');
  assert.ok(app.includes('shouldScrollPdfPage(els.readerContent, d)'), 'PDF 普通滚轮应优先滚动当前页');
  assert.ok(app.includes('restorePdfZoomAnchor(wrap, renderOptions.anchor)'), 'PDF 缩放后应保持鼠标所指阅读位置');
  assert.ok(css.includes('.pdf-zoom-controls'), 'PDF 手动缩放控件缺少样式');
  assert.ok(html.includes('progress-fill'), '缺少阅读进度条');
  assert.match(html, /class="drawer-row appearance-row"[\s\S]*?class="appearance-control"[\s\S]*?id="btn-theme"[\s\S]*?<\/div>\s*<div class="appearance-control">[\s\S]*?id="btn-pet-toggle"/, '主题与桌宠应为同一行内的同级控制组');
  assert.ok(css.includes('.appearance-control { display: flex; align-items: center;'), '主题与桌宠控制组应垂直居中');
  assert.ok(css.includes('.appearance-control .btn { min-width: 52px; height: 30px; }'), '主题与桌宠按钮应使用相同高度');
  assert.ok(html.includes("style-src 'self' 'unsafe-inline' blob:"), '缺少 blob 样式许可（图书 CSS 会被拦截）');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.ok(main.includes('setApplicationMenu'), '缺少自定义菜单');
  assert.ok(main.includes('autoHideMenuBar'), '缺少菜单栏隐藏配置');
});

test('测试用 EPUB fixture 存在', () => {
  const fixture = path.join(root, 'tests', 'fixtures', 'sample.epub');
  assert.ok(fs.existsSync(fixture), 'fixture 缺失，请先运行 node scripts/make-fixture.js');
  assert.ok(fs.statSync(fixture).size > 1000);
});

test('应用图标存在且打包配置已启用', () => {
  const png = path.join(root, 'build', 'icon.png');
  assert.ok(fs.existsSync(png), 'build/icon.png 缺失，请先运行 scripts/make-icon.ps1');
  const ico = path.join(root, 'build', 'icon.ico');
  assert.ok(fs.existsSync(ico), 'build/icon.ico 缺失，请先运行 scripts/make-icon.ps1');
  assert.ok(fs.statSync(ico).size > 1000, 'icon.ico 异常过小（生成可能失败）');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build && pkg.build.win, '缺少 build.win 配置');
  assert.strictEqual(pkg.build.win.icon, 'build/icon.png');
});








test('全局阅读习惯、进度精度与主题即时生效已接入', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(app.includes('function applyGlobalHabits'), '缺少全局习惯应用函数');
  assert.ok(!app.includes('function applyBookSettings'), '不应再按书记忆阅读习惯');
  const themeCalls = (app.match(/paginator\.setTheme\(state\.prefs\.theme\)/g) || []).length;
  assert.ok(themeCalls >= 3, '打开 MOBI/TXT 时应立即注入主题（当前 ' + themeCalls + ' 处）');
  assert.ok(app.includes('percent.toFixed(2)'), '进度百分比应显示两位小数');
  assert.ok(app.includes('epubDisplayPercent'), 'EPUB 进度应使用位置索引+回退计算');
  assert.ok(app.includes('readMode: state.readMode'), '习惯应写入全局 prefs');
  assert.ok(app.includes('migrateHabitsFromLastBook'), '应保留旧版按书习惯的迁移');
});

test('EPUB 行距跟随用户设置且切换时即时生效', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(/line-height: ' \+ state\.lineHeight \+ ' !important/.test(app), 'EPUB 段落行距应使用 state.lineHeight');
  assert.ok(!app.includes('line-height: 1.9 !important; } h1, h2, h3, h4'), '不应再写死 EPUB 段落行距 1.9');
  const cycleSeg = app.slice(app.indexOf('function cycleLineHeight'), app.indexOf('function togglePanel'));
  assert.ok(cycleSeg.includes('applyEpubTypography()'), 'cycleLineHeight 应更新 epub.js 主题行距');
  assert.ok(cycleSeg.includes('applyReaderStyles(contents)'), 'cycleLineHeight 应立即重注入 EPUB 阅读样式');
  const setSeg = app.slice(app.indexOf('setLineHeight: (lh)'));
  assert.ok(setSeg.includes('applyReaderStyles(contents)'), 'setLineHeight 应立即重注入 EPUB 阅读样式');
});

test('书签支持内容锚点、重命名与 TXT 章节识别', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const bm = fs.readFileSync(path.join(root, 'src', 'shared', 'bookmarks.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(bm.includes('function renameBookmark'), '书签库应支持重命名');
  assert.ok(app.includes('renameBookmarkFromMap'), '渲染进程应接入重命名');
  assert.ok(app.includes('paginator.anchor()'), '应通过内容锚点定位书签');
  assert.ok(app.includes('paginator.locate('), '跳转应使用内容锚点重新定位');
  assert.ok(app.includes('txtChapters'), '应识别 TXT 章节');
  assert.ok(html.includes('txt-chapters.js'), '应加载 TXT 章节识别模块');
  assert.ok(fs.existsSync(path.join(root, 'src', 'shared', 'txt-chapters.js')), 'txt-chapters 模块缺失');
});

test('分页器保留左右页边距（版心）', () => {
  const p = fs.readFileSync(path.join(root, 'src', 'renderer', 'paginator.js'), 'utf8');
  assert.ok(p.includes("'body > * { margin-left: ' + pagePad + 'px !important; margin-right: ' + pagePad + 'px !important; }'"), '页面应注入左右页边距');
  assert.ok(p.includes('this.verticalPadding = 28;'), '分页正文应保留舒适的上下留白');
  assert.ok(p.includes("padding: ' + this.verticalPadding + 'px 0; box-sizing: border-box"), '上下留白应计入分页高度，不能挤出可视区域');
  assert.ok(!p.includes("'p { text-indent: 2em !important; margin: 0 0 0.8em !important;"), '段落排版不应再重置左右边距');
  assert.ok(p.includes("margin-top: 0 !important; margin-bottom: 0.8em !important"), '段落应只设上下边距，保留版心左右留白');
});

test('高对比白即时应用于所有可重排格式并保持 PDF 原样', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const pag = fs.readFileSync(path.join(root, 'src', 'renderer', 'paginator.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('../shared/reader-contrast.js'), '页面应加载夜间文字对比度模块');
  assert.ok(app.includes('function cycleReaderTextContrast()'), '缺少文字对比度切换逻辑');
  assert.ok(app.includes('readerTextContrast: window.GaiaReaderContrast.normalizeReaderTextContrast'), '文字对比度应写入全局阅读习惯');
  assert.ok(app.includes("els.textContrastRow.hidden = !!c && c.format === 'pdf'"), 'PDF 设置中不得显示文字对比度控制');
  assert.ok(app.includes('-webkit-text-fill-color: '), 'EPUB 应强制覆盖特殊文字填充色');
  assert.ok(app.includes('c.paginator.setTextContrast(state.prefs.readerTextContrast)'), 'TXT/MOBI/AZW3 应同步文字对比度');
  assert.ok(pag.includes('setTextContrast(value)') && pag.includes('darkReaderTextColor(this.textContrast)'), '分页器应支持高对比纯白');
  assert.ok(pag.includes('opacity: 1 !important'), '高对比模式应清除正文元素异常透明度');
});

test('可调节页边距功能接入', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const pag = fs.readFileSync(path.join(root, 'src', 'renderer', 'paginator.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('btn-margin'), '缺少页边距按钮');
  assert.ok(html.includes('margin-value'), '缺少页边距数值显示');
  assert.ok(app.includes('const MARGIN_OPTIONS = [4, 8, 12, 16];'), '应提供边距档位');
  assert.ok(app.includes('function cycleMargin()'), '缺少边距循环函数');
  assert.ok(app.includes('paginator.setMargin('), '应调用分页器边距');
  assert.ok(app.includes("'body > * { margin-left: ' + marginPct + '% !important;"), 'EPUB 应注入可调边距');
  assert.ok(app.includes('padding-top: 28px !important; padding-bottom: 28px !important;'), 'EPUB 正文应保留上下留白');
  assert.ok(pag.includes('setMargin(pct)'), '分页器应支持 setMargin');
  assert.ok(pag.includes('this.marginPct'), '分页器应保存边距档位');
});

test('EPUB、TXT、MOBI 与 AZW3 共用可调双页间隙且不改变 PDF', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const pag = fs.readFileSync(path.join(root, 'src', 'renderer', 'paginator.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="btn-spread-gap"') && html.includes('id="spread-gap-value"'), '设置页缺少双页间隙控件');
  assert.ok(html.includes('../shared/spread-gap.js'), '渲染层未加载双页间隙档位模块');
  assert.ok(app.includes("gap: currentSpreadGap()"), 'EPUB 初始化时应使用用户设置的间隙');
  assert.strictEqual((app.match(/new window\.GaiaPaginator\(els\.readerContent, \{ pageWidth: 640, gap: currentSpreadGap\(\) \}\)/g) || []).length, 2, 'TXT 与 MOBI/AZW3 应使用同一间隙');
  assert.ok(app.includes("c.format === 'pdf' || state.readMode !== 'spread'"), 'PDF 和单页模式不得应用双页间隙调节');
  assert.ok(app.includes('spreadGap: currentSpreadGap()'), '双页间隙应写入全局阅读习惯');
  assert.ok(pag.includes('setGap(px)') && pag.includes('initialGap') && pag.includes('initialGap : 0'), '分页器应支持0px间隙和实时更新');
  assert.ok(app.includes("column-rule: 1px solid rgba(127,127,127,.28)"), '无额外间隙时仍应显示细书脊线区分左右页');
});

test('内置 BGM 功能接入', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const shared = fs.readFileSync(path.join(root, 'src', 'shared', 'bgm.js'), 'utf8');
  assert.ok(fs.existsSync(path.join(root, 'src', 'renderer', 'bgm.js')), '缺少渲染进程 BGM 模块');
  assert.ok(html.includes('bgm.js'), '应加载 BGM 脚本');
  assert.ok(html.includes("media-src 'self' bgm: blob: data:"), 'CSP 应允许 bgm: 媒体协议');
  assert.ok(main.includes('protocol.registerSchemesAsPrivileged'), '主进程应注册 bgm 协议');
  assert.ok(main.includes("app.commandLine.appendSwitch('autoplay-policy'"), '应开启自动播放策略');
  assert.ok(app.includes('window.GaiaBgm.initBgm()'), '应用启动应初始化 BGM');
  assert.ok(shared.includes("BGM_DEFAULT_LOOP = ['alice', 'soujurou']"), '默认循环应只有有珠/草十郎');
});

test('BGM 胶囊封面与阅读进度条细节', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
  const bgm = fs.readFileSync(path.join(root, 'src', 'renderer', 'bgm.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'bgm', 'cover.jpg')), '缺少专辑封面');
  assert.ok(html.includes("img-src 'self' data: blob: bgm:"), 'CSP 应允许 bgm: 图片');
  assert.ok(bgm.includes('bgm://local/cover.jpg'), '胶囊应加载专辑封面');
  assert.ok(css.includes('.bgm-cover'), '应有封面缩略图样式');
  assert.ok(css.includes('.bgm-capsule.in-topbar'), '阅读界面胶囊应嵌入顶栏');
  assert.ok(bgm.includes('#reader-bgm-slot'), '渲染进程应把胶囊放入阅读页专用槽位');
  assert.ok(bgm.includes('function setSettingsOpen(open)'), 'BGM 应响应设置抽屉开关状态');
  assert.ok(app.includes('window.GaiaBgm.setSettingsOpen(true)'), '打开设置时应通知 BGM 胶囊避让');
  assert.ok(app.includes('window.GaiaBgm.setSettingsOpen(false)'), '关闭设置时应恢复 BGM 胶囊位置');
  assert.ok(css.includes('.bgm-capsule[data-settings-open="1"]'), '设置打开时应有胶囊避让样式');
  assert.ok(css.includes('calc(var(--settings-drawer-width) + 24px)'), '胶囊应移动到设置抽屉左侧');
  assert.ok(css.includes('#reader-view.settings-open .reader-actions'), '设置打开时应收起顶栏操作，避免与音乐胶囊重叠');
  assert.ok(css.includes('@media (max-width: 760px)'), '窄窗口下应隐藏无空间避让的胶囊');
  assert.ok(bgm.includes('function animateSettingsEntry(fromRect)'), '打开设置时应从胶囊原位置开始移动');
  assert.ok(bgm.includes("settingsAnimation.id = 'bgm-settings-entry-flip'"), '打开设置应使用真实位置间的 FLIP 动画');
  assert.ok(bgm.includes('function animateSettingsRestore(fromRect)'), '关闭设置时胶囊应平滑返回原位');
  assert.ok(bgm.includes("matchMedia('(prefers-reduced-motion: reduce)')"), '胶囊动画应尊重系统减少动态效果设置');
  assert.ok(css.includes('bgmWave'), '歌名播放时应带波浪形浮动动画');
  assert.ok(bgm.includes("s.className = 'bgm-char'"), '歌名应逐字渲染以支持波浪动画');
  const topIdx = html.indexOf('id="progress-track"');
  const footerIdx = html.indexOf('<footer class="statusbar">');
  assert.ok(topIdx >= 0 && footerIdx >= 0 && footerIdx < topIdx, '进度条应位于底部状态栏（footer 内）');
});

test('键盘快捷键：左右键翻页、Esc 返回书架', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(app.includes("ev.key === 'ArrowLeft'"), '← 键应绑定上一页');
  assert.ok(app.includes("ev.key === 'ArrowRight'"), '→ 键应绑定下一页');
  assert.ok(app.includes("ev.key === 'Escape'"), 'Esc 键应关闭阅读界面');
  assert.ok(app.includes('prevPage()'), '← 应调用上一页');
  assert.ok(app.includes('nextPage()'), '→ 应调用下一页');
  assert.ok(app.includes('backToLibrary()'), 'Esc 应返回书架');
  assert.ok(app.includes('views.reader.hidden'), '仅在阅读界面响应快捷键');
});
