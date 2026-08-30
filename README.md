# Gaia Reading

电子书阅读器 Demo，基于 Electron + epub.js，支持 EPUB / PDF / TXT 三种格式。

## 功能

- 书架：导入单个文件或整个文件夹，自动识别 EPUB / PDF / TXT，EPUB 显示封面与作者
- 阅读器：EPUB（epub.js 翻页）、PDF（逐页渲染）、TXT（滚动阅读）
- 排版：字号调整（A− / A+）、行距切换
- 目录：EPUB 目录导航
- 书签：按书保存书签、一键跳转
- 续读：自动记录阅读进度，重新打开回到上次位置

## 运行

```bash
npm install
npm start
```

## 测试

```bash
npm test
npm run smoke   # 冒烟启动测试（应用会自动退出）
```

## 项目结构

```
src/
├── main.js            # Electron 主进程（文件读取、元数据、状态存储）
├── preload.js         # 安全桥接（contextBridge）
├── shared/            # 可单测的共享逻辑（EPUB 元数据、TXT 编码、JSON 存储）
└── renderer/          # 界面（书架 + 阅读器），vendor 为 npm 安装时复制的库
tests/                 # node:test 单元测试
```
