# FFmpeg 8.0 命令行构建的源码修改记录

记录日期：2026-10-16。本文件只针对独立的 `ffmpeg.exe` 和 `ffprobe.exe`，Electron 的 `ffmpeg.dll` 见 [另一份记录](ELECTRON_FFMPEG_SOURCE.md)。

## 已附源码和实际二进制

原始源码为 [FFmpeg 8.0 官方源码归档](https://ffmpeg.org/releases/ffmpeg-8.0.tar.xz)，SHA256 为 `b2751fccb6cc4c77708113cd78b561059b6fa904b24162fa0be2d60273d27b8e`。便携包随二进制在 `resources/vendor/sources/ffmpeg-8.0.tar.xz` 实际提供该源码和 `build-ffmpeg.sh`。源码 ZIP 不包含 `vendor/`；它提供 `scripts/build-ffmpeg.sh`、固定下载/哈希配置和本目录补丁，运行 bootstrap 后在本地下载并核验原始源码到 `vendor/sources/`。

2026-10-16 比对原始归档中的全部 9,888 个普通文件与现存实际构建目录，只有 `configure` 内容不同，无原始源码文件缺失。原始 `configure` SHA256 为 `8946342ef754811e13a08fac1c972bffdbb078d7dfef5d5468eaeb0fb6ce049c`；用于现有二进制构建的版本为 `42f9dd43626b5a45049df3940dfaf63156f475b7b82f9c8ac9dc6173489a9ee1`。

| 文件 | 当前发布基准 SHA256 |
| --- | --- |
| `ffmpeg.exe` | `1731abeb466026b4d7585a6e75633358140d7e05f3edb002ac0b56b5b8bbe972` |
| `ffprobe.exe` | `a58cfc49559da9d2fdefcc3f86e4bfc805f29478d14165dc54a394ef0cb1f3c2` |

已直接运行该 `ffmpeg.exe -buildconf`，输出保留在 [ffmpeg-cli-buildconf.txt](ffmpeg-cli-buildconf.txt)。其报告的编译器为 Microsoft C/C++ 19.44.35225 x64；构建选项与项目脚本一致。这是文件比对和二进制自报配置证据，不是逐字节可复现构建证明。

## 修改内容与日期

[ffmpeg-8.0-localized-msvc.patch](ffmpeg-8.0-localized-msvc.patch)相对原始 8.0 `configure` 提供完整差异：将两类 `grep` 表达式中的 `^Microsoft` 改为 `Microsoft`，共影响四行，以识别本机中文 MSVC 输出中不位于行首的厂商名。现有二进制已经使用这四行功能修改。

所附补丁还会在修改后文件头部加入两行显著说明，标注项目修改和说明日期 2026-10-16。这两行是本次补充到补丁材料的注释；现存构建目录和二进制并未因此重建，也不把该日期虚构为早先功能修改或二进制编译的日期。原有四行修改和本次注释均在同一补丁中清楚呈现。修改的是构建检测脚本，未改动 FFmpeg 音频处理源文件。已在原始 `configure` 的独立副本验证补丁正向应用及反向检查；去掉新增的两行说明后，与实际构建版本逐字节相同。

## 构建与替换

项目构建脚本记录完整 `configure` 参数和 MSVC 路径映射设置，关闭自动探测、网络、GPL、nonfree、version3、外部库和不需要的组件，只启用其明列的音频输入、解码、PCM 输出与滤镜。使用与 `dependencies.lock.json` 相符的依赖，在 Windows 的 VS C++ 工具链和 Git Bash 环境中运行项目 bootstrap；该脚本取得并校验原始源码、应用记录的修改，再运行 `make clean` 和编译。

从已有便携包单独重建时，先解开随包 `ffmpeg-8.0.tar.xz`，在源码根应用本目录的补丁，再按随包 `build-ffmpeg.sh` 的工具链前提、目录设置和完整参数构建。该脚本原有的 `sed` 修改与补丁的四行功能差异等效，已修改时再次执行不会叠加修改；脚本不依赖新增补丁文件。使用 Git 应用补丁时应保留 shell 脚本的 LF 换行，例如 `git -c core.autocrlf=false -c core.eol=lf apply <补丁路径>`。脚本中的 MSVC 安装路径应按用户机器调整并记录。已有补丁时先检查正向/反向状态，勿盲目重复应用。此方法需要用户自行准备编译器和 GNU Make，源码包不是这些构建工具的重新分发。

本项目以子进程调用这两个工具。用户可依据 LGPL 修改、重建并在关闭播放器后替换便携目录 `resources/vendor/ffmpeg/` 下的相应 EXE，再使用自有或合成音频验证结果。本项目不额外限制其许可授予的权利；更换为不同配置的二进制后，应保留相应的源码、补丁、配置及声明，不能复用本文件的基准哈希描述新文件。

许可原文为随包 `FFmpeg-LGPL-2.1.txt` 和 FFmpeg 源码中的 `COPYING.LGPLv2.1`；同时保留全部源码文件级声明。参阅 [FFmpeg 官方许可说明](https://ffmpeg.org/legal.html)。以上材料不包含游戏素材的使用授权，也不保证第三方内容或专利方面不存在其它适用权利。
