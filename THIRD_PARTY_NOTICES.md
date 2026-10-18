# 第三方声明 / Third-party notices

第三方软件、运行库、字体及 Konami 的简明致谢清单见 [CREDITLIST.md](CREDITLIST.md)，也可在播放器「设置与偏好 → 关于」中查看。完整许可及源码说明仍以本文件和随附材料为准。

本项目原创代码采用 [MIT 许可证](LICENSE)。游戏内容、`engine/rules/` 中的资源名、哈希、时序等游戏衍生数据，以及 `shared/facet-metadata.json` 中的游戏衍生分类资料，不在本项目 MIT 授权范围内。下列第三方组件、运行时和字体分别遵循其自身许可；本文件不修改 MIT 许可，也不将第三方内容重新许可为 MIT。

## 游戏资源、权利归属与非官方关系

《游戏王：大师决斗》（Yu-Gi-Oh! MASTER DUEL）相关音乐、音效、语音、游戏程序、美术、文本和商标等权利归 Konami 及相关权利人所有，具体以官方权利声明及实际权利归属为准。本项目为非官方工具，与 Konami 及相关权利人没有隶属关系，未获得其对本项目的授权、赞助或认可。游戏及公司名称仅用于说明兼容对象，不表示合作或背书。

[游戏官网](https://www.konami.com/yugioh/masterduel/eu/en/)的版权声明（2026-10-17 核对）列有 Studio Dice、集英社（SHUEISHA）、东京电视台（TV TOKYO）及 KONAMI：

> ©2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI  
> ©Konami Digital Entertainment

MIT 许可只适用于本项目有权许可的原创代码，不授予游戏素材的提取、复制、改编、公开传播、再分发或商业使用权。用户应自行合法取得来源文件，并确认拟进行的处理及使用具有适用法律、许可或权利人的授权依据。能从本机文件中读取或导出内容，不代表已获得这些权利；署名、非商业用途及本声明本身也不构成授权。

**导出的音频仅供个人、非商业使用。请勿再分发、上传或用于商业用途。导出功能及本声明不构成游戏内容的使用授权。** 这一素材使用提示不限制 MIT 对本项目原创代码授予的权利。

**English rights notice:** Music, sound effects, voices, game software, artwork, text and trademarks associated with Yu-Gi-Oh! MASTER DUEL remain the property of Konami and their respective rights holders. This is an unofficial project with no affiliation, authorization, sponsorship or endorsement from Konami or the relevant rights holders. The MIT license covers only original code that this project is entitled to license; it excludes game content and game-derived data in `engine/rules/` and `shared/facet-metadata.json`, including resource names, hashes, timing data and classifications. It grants no rights to extract, copy, adapt, publicly communicate, redistribute or commercially use game content. Exported audio is for personal, non-commercial use only. Do not redistribute, upload or use it commercially. The export feature and this notice do not grant permission to use game content.

播放器的导入流程从用户选择的本机目录读取资源，技术检查无法证明文件的取得方式或使用授权。`engine/rules/classification.json` 和 `engine/rules/recipes.json` 含整理后的游戏衍生元数据，例如素材名、哈希、分类及动作时序；`shared/facet-metadata.json` 含据此整理的筛选分组资料。它们未内嵌游戏音频载荷，但这一技术事实不等于这些元数据已经获得发布授权，也不支持“整个项目不含任何版权内容”的结论。

[游戏使用条款](https://store.steampowered.com/eula/1449850_eula_0)中的个人、非商业许可针对游戏及其中素材按条款规定的方式使用，不能视为允许独立提取或传播音频。Konami 的[《游戏王卡牌游戏》视频投稿指南](https://www.konami.com/yugioh/guide/movieguideline)（2026-07-01 修订，2026-10-17 核对）涵盖《大师决斗》，要求投稿时不要仅抽出 BGM、角色图像等个别元素，且使用游戏中第三方知识产权时需要相应第三方许可。指南也说明其涵盖的部分游戏含 JASRAC 管理的乐曲；这不等于全部《大师决斗》音频均由 JASRAC 管理，也不表示只有 Konami 一方享有相关权利。该指南面向日本境内个人的游戏视频等投稿，不能作为其他地区用户或音频独立提取、上传及再分发的授权依据。

## 第三方组件清单

| 组件 | 固定版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| AssetStudioMod core | 0.19.0 | MIT | 读取 Unity 资源包并复制原始音频载荷 |
| K4os.Compression.LZ4 | 1.3.8 | MIT | Unity 资源包解压 |
| ZstdSharp.Port | 0.8.6 | MIT；另保留上游 Zstandard 声明 | Unity 资源包解压 |
| Newtonsoft.Json | 13.0.3 | MIT | 托管库依赖 |
| .NET runtime | 10.0.6，win-x64 | MIT 及所附第三方声明 | 自包含导入器运行时 |
| vgmstream | r2117 | ISC，另见上游 COPYING 的组件声明 | 独立 FSB 音频解码器 |
| libvorbis / libogg | 1.3.7 / 1.3.5 | BSD-3-Clause | vgmstream 使用的 Vorbis 解码依赖 |
| FFmpeg / ffprobe 独立命令行工具 | 8.0，项目定制音频构建 | LGPL-2.1-or-later | WAV 转换、重采样、动作混音与分析 |
| Electron 随附的 `ffmpeg.dll` | Electron 44.7.0 / Chromium 152.0.7977.130 / FFmpeg 提交 `2b68d2babae73714846961fb0ee47e3b3d2e39a9` | LGPL-2.1-or-later 及所附文件级声明 | Electron/Chromium 媒体运行时；独立于上述 FFmpeg 8.0 命令行构建 |
| CPython | 3.13.5 | PSF 许可及所附声明 | 随包引擎运行时 |
| OpenSSL / zlib / liblzma / libmpdec | 3.0.16 / 1.3.1 / 5.2.5 / 4.0.0 | Apache-2.0 / zlib / public domain / BSD | CPython 的散列、归档及数值支持 |
| PyInstaller bootloader | 6.16.0 | GPL-2.0-or-later，附 Bootloader Exception | 打包引擎；组合分发适用该例外，修改或单独分发仍须核对其条款 |
| Electron | 44.7.0 | MIT 及 Chromium 第三方许可 | 桌面运行时 |
| React / React DOM / Scheduler | 见 `package-lock.json` | MIT | 界面 |
| Zod | 见 `package-lock.json` | MIT | IPC 输入校验 |
| Lucide React | 见 `package-lock.json` | ISC，并保留 Feather MIT 声明 | 界面图标 |
| Manrope / Noto Sans SC | Fontsource variable packages 5.3.0 | SIL Open Font License 1.1 | 本地字体 |

开发目录中的许可文本位于 `vendor/licenses/`；打包脚本将其放入便携包的 `resources/vendor/licenses/`。Electron 自身的 MIT 文本另存为 `resources/vendor/licenses/Electron-MIT.txt`，Chromium 第三方声明位于可执行文件旁的 `LICENSES.chromium.html`。JavaScript 依赖版本和完整性值见 `package-lock.json`；原生依赖归档及下载的许可快照按 `dependencies.lock.json` 校验。保存声明或通过哈希校验本身不代表全部分发义务已经满足。

## 定制 FFmpeg 8.0 命令行工具的源码与重建

`scripts/bootstrap.ps1` 将原始 `ffmpeg-8.0.tar.xz` 和 `build-ffmpeg.sh` 放入 `vendor/sources/`；便携包随二进制提供 `resources/vendor/sources/` 及 `resources/vendor/licenses/FFmpeg-LGPL-2.1.txt`。仓库及源码 ZIP 不含 `vendor/`，提供构建脚本、固定下载/哈希配置及修改补丁，bootstrap 会取得原始源码。源码归档 SHA256 固定于 `dependencies.lock.json`；[详细修改记录](compliance/FFMPEG_CLI_CHANGES.md)及随包补丁记录四行 MSVC 检测修改和日期注释。此定制构建关闭 GPL、nonfree、version3、自动探测和网络功能，不启用外部编解码库。

本项目通过子进程调用这两个可替换的命令行程序。此调用方式的说明仅适用于 `resources/vendor/ffmpeg/ffmpeg.exe` 和 `ffprobe.exe`，不能据此宣称整个 Electron 发行包未链接 FFmpeg。

从本项目源码重建时，安装 Node.js 24、PowerShell 7、Git for Windows、Visual Studio 2022 C++ Build Tools（含 CMake）、.NET SDK 10.0.202 和 Python 3.13.5；在仓库根目录运行 `npm ci`，再运行 `pwsh -NoProfile -File scripts/bootstrap.ps1`。脚本下载或复用并校验固定源码，随后配置和编译。FFmpeg 源码调整是移除编译器横幅匹配中的行首厂商名限制，以识别中文 Visual Studio；脚本另配置编译器路径映射并执行干净重建。应保留这些修改说明，并核对最终分发二进制与相应源码、配置的对应关系。

用户可依据 LGPL 修改、重建和替换这些工具，本项目不额外限制该许可授予的权利。发布者应随相应二进制保留许可及可取得的对应源码和构建修改资料。[FFmpeg 官方法律说明](https://ffmpeg.org/legal.html)要求关注与二进制确切对应的源码、构建选项和修改；具体义务以适用的 [LGPL 2.1 文本](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)为准。

## Electron 随附 `ffmpeg.dll`：对应源码与验证范围

发布策略登记的 Electron 44.7.0 DLL 已与官方发行 ZIP 逐字节核对，官方 ZIP 的 SHA256 亦与官方 SHASUMS 一致，核对记录见 [来源记录](compliance/source-provenance.json)。DLL SHA256 为 `d38957b4351486a16141bdd3162643b811564ba6bfa1d12f374c13b70207dc11`。它不由本项目的 `build-ffmpeg.sh` 构建，不能以 FFmpeg 8.0 原始源码替代它的对应源码。

源码包和便携包根目录 `compliance/` 实际附上精确 FFmpeg 源码、Electron 源码（含其补丁和 GN 构建配置）、选定 Chromium 构建支持源码及 Opus/NASM 依赖；材料、精确提交链和官方来源见 [源码与替换说明](compliance/ELECTRON_FFMPEG_SOURCE.md)及 [来源记录](compliance/source-provenance.json)。该 DLL 使用 Chrome branding、动态库构建和 LGPL 2.1 或更新版本配置；文件级声明保留在源码与 `LICENSES.chromium.html`。本项目不对适用 LGPL 授予的修改、替换和调试修改的逆向工程权利附加限制。

已附补充档不是完整离线 Chromium checkout。完整 GN 构建仍需要按固定 DEPS 联网取得其它源码、工具链和构建输入；全量 Electron/Chromium 重建及替换 DLL 实测尚未完成。文档给出固定修订的重建和本地替换路线，但不保证任意新 DLL 兼容或逐字节可复现，也不将对应源码充分性和全部许可义务标记为已经最终核验。应继续按 [FFmpeg 官方法律说明](https://ffmpeg.org/legal.html)及实际许可条款复核分发安排。

完整官方 Electron 源码中保留上游自己的 `tone.wav`、测试视频、文档图片、图标和 ASAR 测试容器；其它源码也保留相应测试参考资料。它们不是本项目从 KONAMI 游戏取得的音频，作为上游源码材料按其许可和版权声明分发，不被播放器当作素材使用。发布审计只对固定官方源归档和已列明成员哈希给予限定例外，不能据此允许未审核游戏文件进入发布包。

## 组件选择与打包边界

`scripts/bootstrap.ps1` 从固定的 AssetStudioMod 发行归档中选择 `AssetStudio.dll`、`K4os.Compression.LZ4.dll`、`ZstdSharp.dll` 和 `Newtonsoft.Json.dll`，不选择 AssetStudioUtility、AssetStudio.PInvoke、纹理/FBX 工具或 FMOD。vgmstream 配置启用 Vorbis，禁用 MPEG、FFmpeg、G.722.1、G.719、ATRAC9、CELT 和 SPEEX 集成；脚本复制其命令行程序及上游 x64 Vorbis DLL。这是该构建流程的选择范围，不是对已有目录全部文件的检查结果。

GNU Make、CMake、Visual Studio、pip 及 PyInstaller 的构建期依赖用于开发。GNU Make 下载包位于 `.cache/`，不在当前发行脚本选择的发布目录中。

打包流程使用明确的文件清单、固定原生二进制/归档 SHA256 和内容检查；最终目录与 ZIP 还要相互核对。新增文件或变更归档需要人工复核来源后更新固定策略，不能从任意本机目录自动生成批准。清单和哈希能帮助发现夹带或变更，但不能证明每个文件已经取得授权；游戏衍生元数据的分发依据、KONAMI 条款及具体版权例外适用性仍需独立评估。

每个发行版本都应以该版本通过检查的实际清单、ZIP 和 SHA256 为准。审计记录不替代本文件随发行包保留的权利说明、许可文本和对应源码义务。
