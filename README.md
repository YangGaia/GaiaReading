# Gaia Reading

电子书阅读器 Demo，基于 Electron + epub.js，支持 EPUB / PDF / TXT 三种格式。

## 功能

- 书架：导入单个文件或整个文件夹，自动识别 EPUB / PDF / TXT，EPUB 显示封面与作者
- 阅读器：EPUB（epub.js 翻页）、PDF（逐页渲染）、TXT（滚动阅读）
- 排版：字号调整（A− / A+）、行距切换
- 目录：EPUB 目录导航（再次点击可关闭）
- 书签：按书保存书签、一键跳转、可删除（再次点击可关闭面板）
- 续读：自动记录阅读进度，重新打开回到上次位置

## 在其他 Windows 电脑上运行

### 方式一：绿色版 exe（推荐，无需安装任何环境）

在 GitHub Releases 页面下载最新版的 `Gaia Reading-*.exe`，双击即可运行，无需安装 Node.js。

### 方式二：源码运行

需要先安装 [Node.js LTS](https://nodejs.org/zh-cn)（安装时保持默认选项即可）。

```bash
# 1. 下载代码（或用 GitHub 的 Download ZIP）
git clone <你的仓库地址>
cd Gaia_Reading

# 2. 安装依赖（首次需要联网，会自动复制前端库）
npm install

# 3. 启动
npm start
```

也可以直接双击仓库根目录的 `start.bat`：它会自动检查 Node.js、安装依赖并启动应用。

## 测试

```bash
npm test          # 单元测试
npm run smoke     # 冒烟启动测试（应用会自动退出）
npm run smoke:open  # 自动化场景：真实打开一本书，验证翻页/进度/书签/面板
```

## 隐私说明

- 本仓库不包含任何个人书籍、阅读进度、书签或本机路径信息。
- 你的书籍文件、阅读进度、书签只保存在运行电脑的本地（应用数据目录），不会进入仓库。
- 提交历史使用中性身份（gaia-reading），不包含个人信息。
- 仓库中的 `tests/fixtures/sample.epub` 是用于自动化测试的示例书，非用户数据。

## 项目结构

```
src/
├── main.js            # Electron 主进程（文件读取、元数据、状态存储）
├── preload.js         # 安全桥接（contextBridge）
├── shared/            # 可单测的共享逻辑（EPUB 元数据、TXT 编码、书签、JSON 存储）
└── renderer/          # 界面（书架 + 阅读器），vendor 为 npm 安装时复制的库
tests/                 # node:test 单元测试 + 自动化冒烟场景
```
