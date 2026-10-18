# Electron 44.7.0 的 FFmpeg DLL：源码、构建与替换

核对日期：2026-10-16。本文件针对随 Windows x64 Electron 运行时提供的 `ffmpeg.dll`，独立于本项目的 FFmpeg 8.0 命令行工具。

## 二进制与源码身份

已将本机 `electron.exe`、`ffmpeg.dll`、许可文件和版本文件与 [Electron v44.7.0 官方发行归档](https://github.com/electron/electron/releases/tag/v44.7.0)中的字节逐一核对。官方 Windows x64 ZIP 的 SHA256 为 `eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c`，与随本目录保留的官方 `electron-v44.7.0-SHASUMS256.txt` 一致。DLL 大小为 3,113,472 字节，SHA256 为 `d38957b4351486a16141bdd3162643b811564ba6bfa1d12f374c13b70207dc11`。外层播放器版本不改变这一 Electron 版本。

| 对象 | 精确版本或修订 |
| --- | --- |
| Electron | 44.7.0；提交 `61f55c4ce540416b3e43f75f6c0f125d22e5e908` |
| Chromium，由 Electron DEPS 指定 | 152.0.7977.130；提交 `2c592105bbcd9490a9894df48d0fe59b2c512651` |
| Chromium 的 FFmpeg，由 Chromium DEPS 指定 | `2b68d2babae73714846961fb0ee47e3b3d2e39a9` |
| NASM，由 Chromium DEPS 指定 | `525a09a813be0f75b646ee93fc2a31c27b87d722` |
| Node，由 Electron DEPS 指定 | v24.21.0 |

复核入口：[Electron 固定 DEPS](https://github.com/electron/electron/blob/61f55c4ce540416b3e43f75f6c0f125d22e5e908/DEPS)、[Chromium 固定 DEPS](https://chromium.googlesource.com/chromium/src/+/2c592105bbcd9490a9894df48d0fe59b2c512651/DEPS)、[FFmpeg 固定源码](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/2b68d2babae73714846961fb0ee47e3b3d2e39a9)。来源链、哈希和构建配置原文见 [source-provenance.json](source-provenance.json)。

## 实际随包材料

| 文件（相对本目录） | 内容 |
| --- | --- |
| `sources/chromium-ffmpeg-2b68d2babae73714846961fb0ee47e3b3d2e39a9.tar.gz` | 该提交的完整 FFmpeg 源码，含公共头文件、Chromium 平台配置、`BUILD.gn`、`ffmpeg_generated.gni`、`COPYING.LGPLv2.1` 和 `CREDITS.chromium`；11,015 个普通文件 |
| `sources/electron-v44.7.0-source.tar.gz` | 官方 Electron tag 源包，含 DEPS、全部上游补丁、GN 参数、构建脚本和构建文档；3,336 个普通文件 |
| `sources/chromium-ffmpeg-build-inputs-2c592105bbcd9490a9894df48d0fe59b2c512651.tar.gz` | 补充构建源码：Chromium 的 `build/`、`buildtools/`、`tools/generate_stubs/`、`tools/clang/scripts/`、`media/ffmpeg/`、`third_party/opus/`，以及固定 NASM 源码、根 DEPS/GN/LICENSE；3,714 个普通文件 |
| `electron-ffmpeg.patch` | Electron 此版本的 `link_with_loader_path.patch` 原文，与源包中的补丁一致 |

前两项保留官方归档字节。第三项是本项目按上述修订选取并重新打包的补充材料，源文件字节未修改；内置 `SOURCE-MANIFEST.json` 记录每个文件的路径、来源与 SHA256。各归档的整体 SHA256 和展开大小见 `source-provenance.json`。

FFmpeg 的全部源码和平台头文件已随包提供，但第三项**不是完整的离线 Chromium checkout**。完整 GN 依赖解析仍需要 Chromium 其余源码、Electron/Chromium DEPS 指定的依赖、GN/Siso/Ninja、Clang、Windows SDK、PGO 配置等。DEPS 中的固定版本及下载钩子随包保留；不能把这些附件或链接描述为已经验证的完整离线重建环境。

## 配置和许可

Electron `build/args/release.gn` 导入 `all.gn`，设置 `is_component_ffmpeg = true`，将 FFmpeg 作为可替换的动态库。`all.gn` 设置 `ffmpeg_branding = "Chrome"`、`proprietary_codecs = true`。对应的 FFmpeg 配置路径为 `chromium/config/Chrome/win/x64`，其中 `CONFIG_GPL`、`CONFIG_NONFREE`、`CONFIG_VERSION3` 均为 0，`FFMPEG_LICENSE` 为 LGPL version 2.1 or later；启用的 Opus 依赖源码和许可包含在补充档中。`proprietary_codecs` 是上游编解码功能开关，不是授予专利或第三方内容权利的许可证。

Electron 对 FFmpeg 的唯一补丁调整 macOS 的动态库 `install_name`（`@rpath` 改为 `@loader_path`），无 Windows 编译代码差异；仍保留该补丁以完整记录上游修改。Electron 另一个 `build/args/ffmpeg.gn` 使用 **Chromium** branding，生成官方单独的替代 FFmpeg 下载包，不能拿它来代替当前 Chrome branding DLL 的构建配置证明。

适用许可与文件级声明请阅读 FFmpeg 源码中的 `COPYING.LGPLv2.1`、`CREDITS.chromium`、各文件版权行，以及运行时 `LICENSES.chromium.html`；另见 [FFmpeg 官方许可说明](https://ffmpeg.org/legal.html)。本项目不对 LGPL 授予的修改、重建、替换或为调试这些修改而进行逆向工程的权利附加限制。

## 按固定修订重建的路线

以下以该 tag 内的 [GN 构建文档](https://github.com/electron/electron/blob/61f55c4ce540416b3e43f75f6c0f125d22e5e908/docs/development/build-instructions-gn.md)和 [Windows 前提](https://github.com/electron/electron/blob/61f55c4ce540416b3e43f75f6c0f125d22e5e908/docs/development/build-instructions-windows.md)为依据。本次没有执行全量 Electron/Chromium 编译；下面是固定版本的重建路线，不能视作已实测成功或可逐字节复现的承诺。

1. 在独立开发目录准备 Windows x64、Visual Studio C++ 工具和相应 Windows SDK、Git、Node.js 及官方 `depot_tools`。所需工具的版本/下载状态以已附 DEPS 和 `tools/clang/scripts/update.py` 等脚本为准。上游官方发行的 toolchain profile 的 URL、SHA256 和 SDK 标识保留在 `source-provenance.json`，本包不重新分发微软工具链。
2. 在 PowerShell 设置 `$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'`，使用自己安装的工具链。按照上游手工流程配置 checkout，并显式固定 Electron 提交：

   ```powershell
   gclient config --name src/electron --unmanaged https://github.com/electron/electron
   gclient sync --revision src/electron@61f55c4ce540416b3e43f75f6c0f125d22e5e908 --with_branch_heads --with_tags
   ```

   `gclient` 需要联网读取其余固定依赖和运行上游 hooks；若下载失败，不能宣称构建环境已补齐。核对 `src/electron/DEPS`、`src/DEPS` 与本文件记录的 Chromium/FFmpeg 修订。Electron 的 hooks 负责应用其补丁；已应用时不要重复应用 `electron-ffmpeg.patch`。
3. 在 `src` 目录创建 `out/Release/args.gn`，写入以下文本，然后执行 `gn gen out/Release`、`ninja -C out/Release electron`，与上游发布构建路径一致。上游 GN 使用其下载的构建后端；不要用 FFmpeg 独立 `configure` 脚本替代该 DLL 的 Chromium GN 构建。

   ```gn
   import("//electron/build/args/release.gn")
   target_cpu = "x64"
   target_os = "win"
   ```

   在已经成功配置的完整 checkout 中，可用 `gn desc out/Release //third_party/ffmpeg:ffmpeg` 查看 DLL 的具体编译和链接依赖，再针对该 target 构建。修改编解码选项、工具链、PGO 或其它 GN 参数后须记录差异；不同优化设置不保证产生相同二进制。
4. 保留 `out/Release/args.gn`、构建日志、修改补丁、所用源码和新 DLL 的哈希。使用自有或合成媒体验证新 DLL 的播放能力和 ABI 兼容性。

## 用户替换 DLL

退出播放器及其子进程，备份整个便携目录，再将与此 Electron 版本、Windows x64 ABI 匹配的重建 `ffmpeg.dll` 放到播放器可执行文件旁，替换原 DLL。启动备份副本进行播放测试；不兼容时恢复备份。项目发布门禁用于确认维护者发布的基准包，不要求用户重建 DLL 与官方 DLL 哈希相同，也不会把这个发行哈希当作运行时反修改限制。

本次未在本机重建整个 Chromium、未验证替换后的 DLL，也未取得官方构建机完整中间产物。已附 FFmpeg 源码、补丁、平台配置和选定构建支持源码不等于这些验证已经完成。后续分发前仍应针对适用的 LGPL 条件复核对应源码和用户修改/重新链接安排的充分性。
