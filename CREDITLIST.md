# Creditlist · 第三方软件与致谢

<!-- Generated from shared/credits.json by scripts/build-creditlist.mjs. -->

感谢以下第三方软件、运行库、字体及其作者与贡献者。它们共同支持 MD 音效播放器的资源导入、音频处理和桌面界面。

## KONAMI 与游戏内容权利人

《游戏王：大师决斗》（Yu-Gi-Oh! MASTER DUEL）相关音乐、音效、语音、游戏程序、美术、文本和商标等权利归 Konami 及相关权利人所有，具体以官方权利声明及实际权利归属为准。

本项目为非官方工具，与 Konami 及相关权利人没有隶属关系，未获得其对本项目的授权、赞助或认可。游戏及公司名称仅用于说明兼容对象，不表示合作或背书。

本项目原创代码的 MIT 许可不涵盖游戏内容，以及 engine/rules/ 和 shared/facet-metadata.json 中的游戏衍生数据。导出的音频仅供个人、非商业使用，请勿再分发、上传或用于商业用途；导出功能及本声明不构成游戏内容的使用授权。

©2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI  
©Konami Digital Entertainment

## 桌面与引擎运行库

运行库随便携版提供；各运行库内部组件的完整署名见所附许可和第三方声明。

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| Electron | 44.7.0 | MIT 及所附第三方许可 | 桌面应用运行时 |
| Chromium | 152.0.7977.130 | BSD 及所附第三方许可 | Electron 内置的界面渲染与媒体能力 |
| Node.js / V8 | 随 Electron 提供 | MIT / BSD 及所附第三方许可 | 桌面主进程与 JavaScript 执行引擎 |
| SQLite | 随 Electron 提供 | Public Domain | 通过 Node.js 的 node:sqlite 管理本地音频索引 |
| .NET Runtime | 10.0.6 · win-x64 | MIT 及所附第三方声明 | 自包含资源导入器运行时 |
| CPython | 3.13.5 | PSF 许可及所附声明 | 随包音频处理引擎运行时 |
| OpenSSL / zlib / liblzma / libmpdec | 3.0.16 / 1.3.1 / 5.2.5 / 4.0.0 | Apache-2.0 / zlib / Public Domain / BSD | CPython 的散列、归档和数值支持 |
| bzip2 / libffi | 1.0.8 / 随 CPython 提供 | bzip2 许可 / MIT | CPython 的压缩和原生函数调用支持 |
| Microsoft C/C++ 运行库 | 随 CPython Windows 构建提供 | Microsoft Distributable Code 条款 | Windows 原生运行支持；声明见 Python-3.13.txt |
| PyInstaller Bootloader | 6.16.0 | GPL-2.0-or-later，附 Bootloader Exception | 启动打包后的 Python 引擎 |

## 资源导入与音频处理

独立 FFmpeg 命令行工具与 Electron 随附的 ffmpeg.dll 是不同构建，其对应源码和说明分别保留。

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| AssetStudioMod Core | 0.19.0 | MIT | 读取 Unity 资源包并复制原始音频载荷 |
| K4os.Compression.LZ4 | 1.3.8 | MIT | Unity 资源包解压 |
| ZstdSharp.Port | 0.8.6 | MIT；另保留上游 Zstandard BSD 声明 | Unity 资源包解压 |
| Newtonsoft.Json | 13.0.3 | MIT | 资源导入器的托管库依赖 |
| vgmstream | r2117 | ISC 及上游 COPYING 中的组件声明 | 独立 FSB 音频解码 |
| libvorbis / libogg | 1.3.7 / 1.3.5 | BSD-3-Clause | vgmstream 使用的 Vorbis 解码依赖 |
| FFmpeg / ffprobe | 8.0 · 项目定制音频构建 | LGPL-2.1-or-later | 音频转换、重采样、动作混音和分析 |
| Electron 内置 FFmpeg | 提交 2b68d2babae73714846961fb0ee47e3b3d2e39a9 | LGPL-2.1-or-later 及文件级声明 | Electron / Chromium 的 ffmpeg.dll 媒体运行库 |

## 界面、图标与字体

界面依赖的版本来自 package-lock.json；字体版本为 Fontsource 可变字体包版本。

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| React / React DOM | 19.3.0 | MIT | 播放器界面与交互 |
| Scheduler | 0.28.0 | MIT | React 调度支持 |
| Zod | 4.6.5 | MIT | 桌面进程通信的输入校验 |
| Lucide React / Feather | 1.54.0 / 所含图标 | ISC，并保留 Feather MIT 声明 | 播放器界面图标 |
| Manrope · The Manrope Project Authors | Fontsource 5.3.0 | SIL Open Font License 1.1 | 本地西文字体 |
| Noto Sans SC · Google | Fontsource 5.3.0 | SIL Open Font License 1.1 | 本地简体中文字体 |

## 构建与测试工具

以下工具用于开发、打包或测试；PyInstaller 的随包 Bootloader 已在运行库一节单列。未固定版本的工具以实际构建环境为准。

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| Vite / @vitejs/plugin-react | 8.3.4 / 6.1.2 | MIT | 界面构建与 React 集成 |
| Tailwind CSS / @tailwindcss/vite | 4.3.3 | MIT | 界面样式生成 |
| esbuild | 0.28.2 | MIT | 桌面主进程与预加载脚本打包 |
| TypeScript | 7.0.2 | Apache-2.0 | 类型检查 |
| DefinitelyTyped：@types/node / @types/react / @types/react-dom | 26.6.5 / 19.3.0 / 19.3.0 | MIT | Node.js 与 React 的 TypeScript 类型定义 |
| @electron/packager | 20.3.0 | BSD-2-Clause | Windows 便携版打包 |
| Playwright | 1.64.0 | Apache-2.0 | 桌面界面与交互测试 |
| tsx | 4.23.15 | MIT | TypeScript 测试执行 |
| Node.js / npm | 构建环境；项目要求 Node.js 24+ | 见各项目许可与第三方声明 | JavaScript 构建脚本与依赖管理 |
| .NET SDK | 10.0.202 | 见 .NET 许可与第三方声明 | 编译自包含资源导入器 |
| Python / PyInstaller / pip 及构建依赖 | 3.13.5 / 6.16.0；依赖见 requirements-build.txt | 见各项目许可 | Python 引擎构建；固定依赖包括 altgraph、packaging、pefile、pyinstaller-hooks-contrib、pywin32-ctypes 和 setuptools |
| GNU Make | 4.4.1-2 · MSYS2 包 | GPL-3.0-or-later | FFmpeg 编译 |
| Visual Studio C++ Build Tools / CMake | Visual Studio 2022；CMake 随构建环境 | Microsoft 工具许可 / BSD-3-Clause | 原生音频工具编译 |
| Git for Windows / Bash / PowerShell | 构建环境；项目要求 PowerShell 7 | 见各项目许可及所含组件声明 | 源码与构建脚本支持 |
| Pillow | 构建环境，未固定版本 | 见 Pillow 随附许可 | 生成播放器 PNG 与 Windows ICO 图标 |

## 完整许可与源码说明

播放器内可通过「设置与偏好 → 关于 → Creditlist · 第三方软件与致谢」离线查看此清单。便携包中的文件位置如下；源码工程的第三方许可文本位于 `vendor/licenses/`。

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：完整第三方声明、游戏内容权利说明与构建边界
- [LICENSE](LICENSE)：本项目原创代码的 MIT 许可证
- `resources/vendor/licenses/`：便携版随附的第三方许可原文；源码工作目录对应 vendor/licenses/
- `LICENSES.chromium.html`：便携版中 Electron / Chromium 的完整第三方声明
- [compliance/ELECTRON_FFMPEG_SOURCE.md](compliance/ELECTRON_FFMPEG_SOURCE.md)：Electron 内置 FFmpeg 的对应源码与替换说明
- [compliance/FFMPEG_CLI_CHANGES.md](compliance/FFMPEG_CLI_CHANGES.md)：独立 FFmpeg 命令行构建的修改记录

本 Creditlist 是便于阅读的致谢摘要。完整署名、适用许可、权利说明及源码资料以 THIRD_PARTY_NOTICES.md、各组件随附许可原文和 compliance/ 中的记录为准。感谢所有上游作者与贡献者。
