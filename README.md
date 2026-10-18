# MD Audio Player · MD 音效播放器

[English](readme_en.md)

将你电脑上《游戏王：大师决斗》已下载的音效、音乐和语音整理为个人声音资料库，方便试听、分类、标注、收藏和导出。

**Windows 10 及以上（x64） · 离线运行 · 不附带游戏音频**

> [!IMPORTANT]
> 这是非官方工具，与 Konami 及相关权利人没有隶属关系，也未获得其授权、赞助或认可。游戏音乐、音效、语音、相关名称与商标归 Konami 及相关权利人所有。
>
> 本仓库和发行包不包含游戏音频或资源包。工具只处理本机已有的游戏文件，不授予任何游戏内容使用权。导出的音频仅供个人、非商业使用，请勿再分发、上传或用于商业用途；使用前请确认游戏使用条款和当地法律允许。上述游戏内容说明不改变原创代码的 MIT 许可。

## 功能

- **导入**：选择本机游戏目录，扫描最新账号资源或全部账号资源；支持取消及后续继续导入。
- **整理**：搜索名称、原始资源名、内部编号和标签；批量修改分类与标签，添加收藏。重新导入会保留个人修改。
- **筛选**：按种类、音效形式及分组标签多选。同组条件满足任一，跨组条件同时满足；点击侧栏分类会清除搜索和筛选。
- **试听**：采样波形、拖动进度、单曲循环、A/B 区间试听，以及空格键播放或暂停。
- **完整动作**：资源版本和所需声音匹配时，按时序组合多段声音；不匹配时显示不可用原因。
- **导出**：按导入格式复制库内 WAV，或转换为 48 kHz / 24-bit 双声道 WAV。批量导出按分类建目录，并避免同名覆盖。
- **标注备份**：将个人标注导出为 JSON，或从 JSON 恢复；备份不含音频。
- **主题与致谢**：深色、浅色和游戏风格三套主题；在「设置与偏好 → 关于」离线查看第三方软件与字体致谢。

卡名标签筛选使用本机旧库中符合识别规则的已有标签，以及个人明确添加的 `卡名：名称` 标签，不附带卡名字典，也不会根据普通标题猜测卡名。缺少来源资料时，不猜测属性或卡片类型。打开旧资料库会在读取时补充分组信息，无需重新导入音频，不会改写原有标注或媒体文件。

## 下载与使用（推荐）

推荐从 [Releases](https://github.com/PetYin/MD-Audio-Player/releases) 下载 Windows x64 便携压缩包，文件名以 `MD-Audio-Player-` 开头、以 `-win-x64.zip` 结尾。解压后即可运行，**无需安装开发工具**。需要修改代码或自行构建时，可使用仓库源码或 Release 中的源码包，按下方可选构建说明操作。

1. 通过官方渠道安装《游戏王：大师决斗》，并在游戏中下载所需资源。
2. 下载便携压缩包，将整个压缩包解压到游戏目录之外的可写文件夹。不要直接在压缩包内运行。
3. 运行 `MD音效播放器.exe`，选择包含 `masterduel.exe` 的游戏目录。已识别的 Steam 安装会列为候选。
4. 选择扫描范围并开始导入。取消时保留已完成的声音，之后可以重新扫描。
5. 导入后即可离线试听、整理和导出；游戏更新后，在设置中重新扫描。

**迁移已有便携版资料库**：先退出新旧版本，将旧目录的 `assets/`、`data/`、`cache/` 复制到新版 EXE 同级目录，再启动新版。保留旧目录作为备份，不直接覆盖旧程序。用过的播放器目录包含游戏音频和个人数据，请勿整目录分享。

## 数据位置与运行方式

播放器运行时没有联网下载、上传、账号登录、统计或自动更新功能。源码构建需要联网下载开发依赖，两者应区分。

播放器只读游戏文件，不修改游戏，不读取或注入游戏进程，也不执行游戏程序或其中的 DLL。扫描会读取 Steam 安装位置、`LocalData` 下的账号目录名与修改时间，以及部分游戏文件（包括 `GameAssembly.dll`）的哈希，用于识别资源和版本。向游戏目录写入的操作会被拒绝。

| 运行方式 | 数据根目录 |
| --- | --- |
| 便携版 | `MD音效播放器.exe` 所在目录 |
| 源码运行 | 默认是仓库内的 `data/`，可通过环境变量 `MD_PLAYER_DATA` 指定其他目录 |

数据根目录下，`assets/` 保存导入音频，`data/` 保存资料库、设置和日志，`cache/` 保存导入缓存。因此源码模式默认数据库路径为 `data/data/library.sqlite`。导出的音频和标注备份可保存在另选的目录，不会随播放器数据一起删除。

## 从源码运行（可选）

开发环境需要 Windows x64、PowerShell、Node.js、Python、.NET SDK、Visual Studio C++ 生成工具（含 CMake），以及带 Bash 的 Git for Windows。工具链版本请按 [依赖锁定文件](dependencies.lock.json) 和 [Windows 构建工作流](.github/workflows/windows.yml) 准备；**Python 必须与依赖锁定文件指定的版本完全一致**，依赖准备脚本会严格检查。

```powershell
git clone https://github.com/PetYin/MD-Audio-Player.git
cd MD-Audio-Player
npm ci
node node_modules/electron/install.js
pwsh -NoProfile -File scripts/bootstrap.ps1
npm run build
npm test
npm start
```

也可下载并解压 Release 中以 `-source.zip` 结尾的源码包，在包含 `package.json` 的目录执行上述命令中的 `npm ci` 及后续步骤。源码启动后，按“下载与使用”中的游戏目录选择和导入步骤操作。

`dependencies.lock.json` 固定原生依赖的来源、版本和 SHA256；`package-lock.json` 固定 npm 依赖及其 integrity 校验值。`bootstrap.ps1` 将第三方工具与许可材料准备到工程内的 `vendor/`。这些依赖和运行时数据不提交 Git。

普通构建直接使用已提交的分类和分组 JSON。

### 验证与打包

```powershell
python -m unittest discover -s engine/tests
npm run test:release
npm run test:desktop
npm run test:facets
node scripts/test-category-navigation.mjs
```

测试使用合成声音或合成结构。请不要提交真实游戏资源、个人资料库或导入报告。

```powershell
npm run package
node scripts/test-packaged.mjs
```

打包输出位于 `release/` 下按应用版本命名的子目录，包含便携 ZIP、源码 ZIP、文件清单和 SHA256；若该目录已存在，脚本会拒绝覆盖。打包按 [发布文件清单](scripts/release-policy.json) 检查内容，未登记文件、游戏媒体、资源包和数据库不能进入发行包。

重新构建的原生二进制可能与既有审核哈希不同，因此完成 `bootstrap.ps1` 不代表必然能通过打包。哈希差异需要核对来源与构建结果，不能直接重新生成批准值绕过检查。GitHub Actions 在推送和 PR 时只检查能否编译（`npm ci` 和 `npm run build`），不运行依赖准备、测试或打包，也不创建 Release；测试和打包请按上面的命令在本机执行。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/` | React 界面 |
| `desktop/` | Electron 主进程、资料库与导出 |
| `shared/` | 共享接口、分组元数据与致谢 |
| `engine/` | Python 导入引擎；`rules/` 保存分类和动作配方 |
| `importer/` | 基于 AssetStudioMod 的 C# 音频读取工具 |
| `scripts/`、`tests/` | 构建、打包、审计与测试 |
| `compliance/` | 第三方源码材料、补丁、来源记录和规则清单 |

## 许可与第三方材料

- 原创代码采用 [MIT 许可](LICENSE)。
- 游戏内容，以及 `engine/rules/`、`shared/facet-metadata.json` 中的游戏衍生数据不在 MIT 授权范围内。这些数据包含资源名、哈希、版本、动作时序和有限分类信息；来源记录不代表已取得游戏内容发布授权。
- 第三方组件适用各自许可，见 [CREDITLIST.md](CREDITLIST.md)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [源码与来源材料](compliance/README.md)。三个固定第三方源码归档随仓库保留，其中上游测试素材不属于游戏资源。
- 依赖准备后的许可文本位于 `vendor/licenses/`；便携包中的对应位置是 `resources/vendor/licenses/`。FFmpeg 命令行源码随依赖准备取得，并随便携包附带；Electron 的 FFmpeg 源码及重建限制见 `compliance/`。

©2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI  
©Konami Digital Entertainment

## 反馈与常见问题

问题和建议请提交到 [Issues](https://github.com/PetYin/MD-Audio-Player/issues)，说明版本、操作步骤和错误信息，不要附上游戏音频、资源包、账号目录名或其他个人信息。相关权利人也可通过 Issues 提出具体内容与处理要求，维护者会优先处理，必要时移除内容或停止发布。

**为什么有些完整动作不可用？** 组合动作需要资源版本和所需声音全部匹配。游戏更新改变相关资源后，会显示原因；已经导入的单独声音仍可试听。

**导出的 WAV 是原始游戏文件吗？** 不是。它是已经解码到资料库的 WAV；“按导入格式”导出复制该文件，标准导出则转换为 48 kHz / 24-bit 双声道。

**支持 macOS 或 Linux 吗？** 目前仅支持 Windows x64。

