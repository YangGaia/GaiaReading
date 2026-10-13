# Gaia Reading 1.1.6

发布日期：2026-10-13

本版修复 EPUB 图片在多种包裹（`<p>`、`<div class="image-wrapper">`、`<figure>`、`<p><a>`）下显示位置错乱、图片被行高顶出列底、`<figcaption>` 排版不一致等问题，同时补充对应样书和 30 项真实窗口回归检查。

## EPUB 图片包裹场景

修复以下场景下图片"加载错地方"或越过列边界的问题：

- `<p><img></p>`：行内图片被段落 `line-height` 顶得很高且不再居中。改为图片块级 + 段落首行不缩进。
- `<div class="image-wrapper"><img></div>`：自定义 div 包裹的图片之前没有专门的列内宽度约束，现统一为块级居中并按列宽等比缩放。
- `<figure><img><figcaption></figcaption></figure>`：浏览器默认 `margin-block: 1em` 让图片与正文错开，新增 `padding-block: 40px` 又把说明文字挤出列。现重置 figure 上下 margin 为 `0.8em`、内边距为 `0`，并把 `<figcaption>` 居中、字号 `0.9em`、取消首行缩进。
- `<p><a><img></a></p>`：链接里的图片之前没有 `display:block`，继承正文 `2em` 首行缩进。现链接块级化、首行不缩进。

所有图片统一 `display: block; margin: 0 auto; max-width: 100%; max-height: calc(100vh - 80px)`，保留原 EPUB 图片的纵横比（`object-fit: contain`），保证不越过列边界、不超出可视高度。

## 测试与回归

- 新增 `tests/fixtures/epub-image-fixture.js`：生成含四种图片包裹的真实 EPUB 样书（4 张不同尺寸 PNG）。
- 新增 `scripts/epub-image-smoke.js` 与 `npm run smoke:epub-image`：在 800/1100/1600 窗口、单页/双页、日间/夜间主题下用 `getBoundingClientRect()` 校验图片的 `right <= 列右边界`、`left >= 列左边界`、`bottom <= 列底`，30 项检查全部通过。
- 在 `tests/app-smoke.test.js` 增加字符串断言，确保新 CSS 规则不会回退。
- `npm test` 全部 376 项单元测试通过（3 项预先存在的私人样书测试跳过）。

## 验证情况

- 单元测试：376 项中 373 项通过、0 项失败、3 项跳过（私人 MOBI/AZW3 样书缺失）。
- EPUB 图片位置：30 项 Electron 回归全部通过，覆盖窄屏/宽屏/双页/暗色主题、figcaption 样式。
- `smoke:epub-font` 157 项、EPUB 字号与排版回归未受影响。
