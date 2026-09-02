# Gaia Reading

Gaia Reading 是一款面向 Windows 的绿色电子书阅读器，支持 EPUB、PDF、TXT、MOBI 和 AZW3。它把多格式阅读、章节级 AI 对话、划线笔记、阅读统计和桌面角色「久远寺有珠」放在同一个应用中。

当前稳定版本：**1.0.0**

[下载 1.0.0](https://github.com/YangGaia/GaiaReading/releases/tag/v1.0.0) · [查看本版说明](RELEASE_NOTES_1.0.0.md) · [版本记录](CHANGELOG.md)

## 界面截图

以下截图严格按拍摄时间从早到晚排列。

### 2026-09-01 20:10:31 · 启动画面

![Gaia Reading 启动画面](docs/screenshots/PixPin_2026-09-01_20-10-31.png)

### 2026-09-03 01:12:06 · 首页

![Gaia Reading 首页](docs/screenshots/PixPin_2026-09-03_01-12-06.png)

### 2026-09-03 01:13:04 · AI 阅读中心

![Gaia Reading AI 阅读中心](docs/screenshots/PixPin_2026-09-03_01-13-04.png)

### 2026-09-03 01:13:48 · 书架与有珠控制台

![Gaia Reading 书架与有珠控制台](docs/screenshots/PixPin_2026-09-03_01-13-48.png)

### 2026-09-03 01:14:32 · 双页阅读与 AI 对话

![Gaia Reading 双页阅读与 AI 对话](docs/screenshots/PixPin_2026-09-03_01-14-32.png)

### 2026-09-03 01:14:46 · 阅读统计

![Gaia Reading 阅读统计](docs/screenshots/PixPin_2026-09-03_01-14-46.png)

## 主要功能

### 阅读

- 支持 EPUB、PDF、TXT、MOBI、AZW3，保留书架、目录、进度和断点续读。
- EPUB、MOBI、AZW3 支持目录跳转；TXT 可识别常见中英文章节标题。
- 支持单页、双页、日间、护眼和夜间模式，并可调整字体、字号、行距与页边距。
- PDF 支持 60%～200% 缩放，可使用顶栏按钮或 `Ctrl + 鼠标滚轮`；普通滚轮先滚动当前页，到边缘后再翻页。
- 五种格式均可添加书签、三色划线和笔记。

### AI 阅读助手

- 用户自行配置接口，支持 OpenAI、DeepSeek、兼容 OpenAI 格式的第三方服务和本地 Ollama。
- 可保存多套接口档案，分别管理 Base URL、API Key 和模型，并在阅读时随时切换。
- AI 只接收当前逻辑章节作为上下文；正文没有提供的信息会明确说明，不主动补写剧情或剧透后文。
- 提供“总结本章”“人物关系”“伏笔”三个输入快捷键，点击后仅填入问题，由用户确认发送。
- 生成期间可以停止；输入新问题后可以中止旧请求并立即发送。
- “有珠概括”和“有珠吐槽”生成一句简短台词，通过桌宠气泡显示，不进入普通对话记录。

### 划词工具

- 选中文字后可直接划线、写笔记、复制、让 AI 解读或引用文字向 AI 提问。
- “字典”会在应用内打开网易有道并直接查询选中文字。
- “搜索”交给系统默认浏览器，可选择 Google、Bing、百度或自定义 HTTPS 搜索模板。

### 阅读记录与有珠

- 记录每日和每周阅读时长、目标完成度、连续阅读天数与年度读完书籍。
- 有珠支持点击、拖动、表情、哈欠、困倦、睡眠、梦话和阅读关怀提醒。
- 控制台可调整有珠的尺寸、透明度、阅读页显示方式和自主行为。
- 内置 BGM 胶囊，支持播放、切歌、音量与状态记忆。

## 下载与运行

1. 打开 [GitHub Releases](https://github.com/YangGaia/GaiaReading/releases/tag/v1.0.0)。
2. 下载 `Gaia.Reading.1.0.0.exe`。
3. 双击运行，无需安装 Node.js，也无需执行安装程序。

系统要求：Windows 10/11 x64。当前发行文件未购买商业代码签名证书，Windows 首次运行时可能显示 SmartScreen 提示；请确认下载来源并核对 Release 中公布的 SHA-256。

## AI 接口配置

| 类型 | Base URL 示例 | 模型示例 | 说明 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | 账号可用的模型 ID | 使用 OpenAI API Key |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` | 使用 DeepSeek API Key |
| 第三方兼容接口 | 服务商提供的地址 | 服务商提供的模型 ID | 地址和 Key 均由服务商决定 |
| Ollama | `http://127.0.0.1:11434` | 本机已安装模型 | 完全本地运行，不需要 API Key |

Base URL 决定请求发送到哪里，API Key 用来向该地址证明身份，模型名称决定调用该服务中的哪个模型。三项必须与同一家服务的文档保持一致。

## 隐私与数据

- 书籍原文件、书架、进度、书签、笔记和阅读统计保存在本机，不上传到项目服务器。
- API Key 通过 Windows `safeStorage` 加密保存，只在 Electron 主进程中解密，不写入普通 JSON，也不会返回给页面。
- 使用云端 AI 时，当前章节正文直接发送到用户设置的 Base URL；远程地址必须使用 HTTPS，且请求禁止重定向。
- 项目不存在代收 API Key 或转发 AI 请求的开发者服务器。需要完全离线时，请使用本地 Ollama。
- 数据结构升级前会自动备份本地数据，最多保留最近五份备份。

## 常用操作

| 操作 | 按键或方式 |
| --- | --- |
| 上一页 / 下一页 | `←` / `→` 或 `PageUp` / `PageDown` |
| 返回书架 | `Esc` |
| PDF 缩放 | `Ctrl + 鼠标滚轮` 或顶栏缩放按钮 |
| 发送 AI 问题 | `Ctrl + Enter` |
| 打开有珠控制台 | 设置页入口或 `Shift + F10` |

## 从源码运行

需要 Node.js LTS 和 Windows 环境。

```bash
git clone https://github.com/YangGaia/GaiaReading.git
cd GaiaReading
npm install
npm start
```

也可以双击仓库根目录的 `start.bat`，脚本会检查 Node.js、补齐依赖并启动应用。

## 测试与构建

```bash
npm test            # 全部自动化测试
npm run smoke       # Electron 基础启动验证
npm run smoke:open  # 打开测试 EPUB 的综合冒烟验证
npm run dist        # 生成 Windows 绿色版 exe
```

## 项目结构

```text
src/main.js          Electron 主进程、窗口、文件与本地状态
src/preload.js       安全的页面与主进程通信桥
src/renderer/        阅读器和应用界面
src/shared/          可独立测试的解析与业务逻辑
tests/               自动化测试和测试用电子书
assets/bgm/          内置音乐资源
```

完整的 1.0.0 变化与 0.5.2 对比请阅读 [RELEASE_NOTES_1.0.0.md](RELEASE_NOTES_1.0.0.md)。
