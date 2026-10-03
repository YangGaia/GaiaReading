# 音乐素材

完整版本使用 `src/shared/bgm.js` 中列出的 59 首 FLAC；精简版仅包含：

- `1-01.flac`：魔法使いの夜～メインテーマ
- `1-05.flac`：久遠寺有珠
- `1-08.flac`：静希草十郎

播放器共用封面 `cover.jpg`。FLAC 文件只随 [GitHub Releases](https://github.com/lvlucky3641/GaiaReading_Lucky/releases) 中的便携 EXE 提供，不写入源码 Git 历史。

已有目录式完整版本时，将其 `resources/app.asar.unpacked/assets/bgm/` 内的 FLAC 复制到本目录即可。也可用 7-Zip 打开完整便携 EXE 中的 7z 数据，进入相同路径提取音频（部分界面会先显示内嵌的 `app-64.7z`）；不要把个人 `数据` 目录复制进源码。

完整自动化测试及 Full 构建需要全部 59 首。Lite 构建仅需上面三首和封面。音频、曲名与作曲者信息按原素材保留，许可范围见仓库根目录的 `THIRD_PARTY_NOTICES.md`。
