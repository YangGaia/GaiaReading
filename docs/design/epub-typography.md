# EPUB 字号兼容

部分 EPUB 将段落或内联文字设置为 px、pt、rem，或使用 `!important`。
epub.js 的 `themes.fontSize()` 只改变 body，无法让这些文字随用户设置缩放。

`src/shared/epub-typography.js` 在每个章节的文档内处理字体缩放：

- 先恢复上次由阅读器写入的字号和行高，再一次性测量原始计算样式，最后批量应用比例。嵌套 em、百分比和继承关系不会重复放大。
- 保留标题、正文、脚注的相对大小；固定行高同时缩放，避免放大文字后行间重叠。
- 回到 100% 时恢复原有字号、行高及优先级。只修改这两项内联属性，保留 epub.js 管理的列宽、尺寸和定位。
- 不增删正文节点，保持 CFI、选区、书签、AI 章节文本和批注锚点；原 EPUB 文件不被修改。
- 嵌入 SVG、MathML 使用原有字号，固定版式 EPUB 不应用文字缩放。固定版式的设置显示说明，页面继续按阅读窗口适配。
- 字号、阅读样式及窗口布局变化时重新计算；每次加载新章节也会应用当前全局偏好。

字号按钮保留 80%～200% 范围。连续点击共享首次捕获的 CFI；最后一次分页完成后恢复批注与搜索高亮。换书会使旧的布局任务失效。

## 验证

```powershell
npm test
npm run smoke:epub-font
npm run smoke:ui
node_modules/.bin/electron.cmd scripts/page-turn-smoke.js
```

字号专项使用独立临时数据及自动生成的 EPUB，直接调用正式界面的字号按钮处理逻辑，测量 Chromium 中正文的实际计算字号。覆盖 px、pt、rem、em、百分比、内联强制样式、嵌套字体、固定行高、窗口媒体查询、跨章与重开、固定版式、单双页、翻页、CFI、书签、批注、笔记、全文搜索、AI 章节正文和桌宠尺寸。

报告与 100% / 150% 界面截图写入 `dist/epub-font-smoke/`；可通过 `GAIA_EPUB_FONT_OUTPUT` 指定其他目录。不调用云端 AI，不修改真实书架，不生成 exe。
