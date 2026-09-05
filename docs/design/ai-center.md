# AI 阅读中心

AI 中心在软件内延续首页、书架和阅读目标页的石墨灰、银白文字、冷蓝细线与浅浮雕按钮。中文沿用 Noto Sans SC，Gaia 字标沿用已有字体，URL 和模型 ID 使用等宽字体。

- 接口档案在左，编辑表单在右；窄窗口改为上下排列，档案横向滚动。表单保留原控件、保存、删除、Key 管理、连接测试和读取模型功能。
- 模型列表在卡片内展开，支持原有筛选、键盘操作和手填 ID。新选项直接显示 `gpt-6-astra`，不以产品昵称替代请求 ID。
- 音乐胶囊沿用共享样式和窗口缩放规则。表单按桌宠实际宽度预留右侧空间，只读取其宽度和显隐状态，不调整桌宠坐标、缩放或拖动逻辑。
- 新样式全部限定在 `#ai-view`，保持阅读主题隔离。按实际 CSS 尺寸绘制，避免整体放大合成图层造成模糊。
- 不新增第三方推广署名，不生成 exe。

## 模型来源与兼容性

根据 [OpenAI 官方 GPT-6 Astra 模型文档](https://developers.openai.com/api/docs/models/gpt-6-astra)，OpenAI 和自定义兼容接口均增加 `gpt-6-astra` 预设。OpenAI 原默认模型不变，已有档案不迁移。自定义接口的预设仅供选择，切换服务商时不覆盖手填 ID。

请求沿用既有兼容客户端与错误反馈。测试覆盖精确 ID 的保存、发送、模型去重及参数兼容重试；使用模拟响应与本机 HTTP 测试服务，不使用用户 Key，不调用收费模型。实际账号权限和中转服务商的模型支持情况仍由相应接口决定。

## 验证

```powershell
npm test
$env:GAIA_UI_AI_ONLY = '1'
$env:GAIA_UI_OUTPUT_DIR = 'D:\Codex_project\Gaia_Reading\dist\ai-center-ui'
npm run smoke:ui

Remove-Item Env:GAIA_UI_AI_ONLY
$env:GAIA_UI_OUTPUT_DIR = 'D:\Codex_project\Gaia_Reading\dist\ai-center-regression'
npm run smoke:ui
```

AI 实机验证使用临时用户数据，覆盖 800×600、1100×760、1600×1000、1440×600、800×1000、2560×1080，以及日间、夜间、护眼三种阅读主题。检查字体、对比度、控件可达、横向溢出、键盘焦点、播放器缩放、桌宠空间、原生 IPC 保存及连接测试。指定输出目录包含截图与 JSON 报告。
