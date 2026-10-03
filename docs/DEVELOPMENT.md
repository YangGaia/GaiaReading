# 开发说明

## 环境与依赖

使用 Windows 和 Node.js 22.12.0 或更新版本。源码包不附带 Node.js、npm 或专用运行环境，请自行安装。当前脚本将开发、验证与构建写入限制在 F 盘；先进入自己的源码目录，再设置当前进程环境。

```powershell
Set-Location 'F:\GaiaReading_Lucky'
. ./scripts/dev-env.ps1
npm.cmd ci --include=dev
npm.cmd run doctor
```

`dev-env.ps1` 把临时文件、缓存和可控应用资料定向到 F 盘，不修改全局 Windows 环境。`node_modules`、`.cache`、`.tmp` 与 `src/renderer/vendor` 都是本地生成内容，不提交到源码仓库。依赖完整时可跳过重复安装。

`npm ci` 根据锁文件安装依赖，并生成 EPUB/PDF 阅读组件。若所用 npm 版本拦截 Electron 安装脚本，按 npm 提示允许锁文件中指定的 Electron 版本，再运行 `npm.cmd run doctor` 检查实际程序和组件是否齐全。

## 检查与测试

```powershell
. ./scripts/dev-env.ps1
npm.cmd run check
npm.cmd run smoke:open
npm.cmd run smoke:pdf
npm.cmd run smoke:reader-ui
```

`check` 运行源码语法、工程配置检查及全部自动化测试。完整测试会检查音乐素材，因此需要先按 [音乐素材说明](../assets/bgm/README.md) 恢复 59 首 FLAC。界面验证使用独立临时档案，避免读取个人书架或调用真实云端 AI；截图和报告留在 F 盘临时目录。报告目录可通过对应脚本的环境变量显式设置。

正式设计说明保留在 [AI 中心](design/ai-center.md)、[EPUB 字号兼容](design/epub-typography.md)、[阅读工具栏](design/reader-toolbar.md)、[翻页动画](design/page-transitions.md) 和 [阅读统计](design/stats.md)。

## MOBI/AZW3 合成样书

`tests/fixtures` 中的样书与生成器用于验证解析、分页和导入；它们不包含个人藏书。使用 `npm.cmd run fixture:mobi` 生成 MOBI7/KF8 样本，使用 `npm.cmd run smoke:mobi` 验证。合成样书不表示支持 DRM 或所有压缩变体。

## 构建

```powershell
. ./scripts/dev-env.ps1
npm.cmd run dist
npm.cmd run dist:portable
```

目录式版本输出到 `dist/win-unpacked`。便携构建生成 Full（59 首）和 Lite（三首）两个独立 EXE；脚本会打印实际产物路径。单独构建可使用 `node scripts/build-portable.js --edition=full` 或 `--edition=lite`。所有构建命令都禁用自动发布，详细验证和发布步骤见 [发布指南](GITHUB_RELEASE.md)。

## 数据与维护

启动和档案位置见 [启动说明](LOCAL_SETUP.md)。个人书架、API 配置、密钥、完整数据备份、构建产物和 Git 历史不得混入公开源码。关闭相关应用后，可以先用 `npm.cmd run clean:cache` 预览缓存清理范围；完整操作与恢复规则见 [维护指南](MAINTENANCE.md)。
