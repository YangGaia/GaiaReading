# 第三方来源与许可范围

GaiaReading_Lucky 基于 [YangGaia/GaiaReading](https://github.com/YangGaia/GaiaReading) v1.1.1 维护。上游与本项目的 `package.json` 均声明代码使用 MIT 许可证；本地维护代码沿用 MIT，见 [LICENSE](LICENSE)。

本项目的 MIT 许可证适用于项目代码，不重新授予第三方音乐、角色图像、字体或依赖库的权利。

- 角色、场景与《魔法使いの夜》原声音乐：归各自原权利人所有。曲名、作曲者及碟号保留在 `src/shared/bgm.js`，完整与精简发行版的曲目数量在 Release 中注明。
- 字体：随 `src/renderer/fonts` 提供的字体许可文件适用于对应字体。
- Electron、Chromium、PDF.js、epub.js、MOBI 解析器及其他依赖：遵循各组件自己的许可证。发行包保留 Electron 的 `LICENSE.electron.txt`、`LICENSES.chromium.html`，npm 依赖的许可证随依赖文件保留。

发布到 Git 仓库的源码不包含 FLAC 音频。音频随便携版提供，不进入源码提交历史。
