# 启动与源码安装

## 使用 Windows 便携版

从项目 Release 下载 Full 或 Lite EXE，放入可写的本地文件夹后运行。Full 包含 59 首音乐；Lite 包含 `1-01.flac`、`1-05.flac` 和 `1-08.flac`，其他阅读功能相同。便携版无需另外安装 Node.js。

便携版默认把书架、偏好与应用可控缓存放在 EXE 同级的 `数据` 文件夹。移动程序时一并移动该文件夹；备份与恢复见 [维护指南](MAINTENANCE.md)。NSIS 启动器解压使用 Windows 进程临时目录。

## 从源码运行

源码不包含 Node.js、npm、`运行环境`、`node_modules` 或生成的阅读组件。请自行安装 Node.js 22.12.0 或更新版本，推荐受支持的 LTS 版本。当前开发脚本要求源码、测试档案与构建缓存位于 F 盘；以下路径是可替换的示例。

```powershell
Set-Location 'F:\GaiaReading_Lucky'
. ./scripts/dev-env.ps1
npm.cmd ci --include=dev
npm.cmd run doctor
npm.cmd start
```

环境脚本只修改当前 PowerShell 进程，使用项目内的 `.tmp` 与 `.cache`，并优先使用已安装的 Node.js。安装依赖后，`postinstall` 会生成 `src/renderer/vendor` 中的阅读组件。

源码运行默认使用源码目录同级的 `数据` 文件夹。测试或调试应使用独立档案，例如在启动参数中指定 `--user-data-dir="F:\GaiaReading-TestData"`。不要把已有个人档案复制到公开源码目录。

Git 仓库不包含 FLAC 音频；需要音乐、完整自动化测试或重新打包时，按 [音乐素材说明](../assets/bgm/README.md) 恢复相应文件。进一步的检查、样书和构建命令见 [开发说明](DEVELOPMENT.md)，发布过程见 [发布指南](GITHUB_RELEASE.md)。
