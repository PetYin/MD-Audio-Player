# 导入引擎

标准库 Python 引擎使用 JSONL 向 Electron 返回 [`shared/contracts.ts`](../shared/contracts.ts) 定义的事件。

## 运行边界与资源权利

本说明针对当前 `engine/` 及播放器调用的导入器。游戏音乐、音效、语音及其他游戏内容的权利归 KONAMI 及相应权利人；本项目非官方，未获 KONAMI 对本项目的授权、赞助或认可。原创代码的 MIT 许可不授予游戏素材使用权。完整使用边界见 [播放器说明](../README.md)。

Game content remains the property of KONAMI and the respective rights holders. This unofficial project is not authorized, sponsored or endorsed by KONAMI. Its MIT code license grants no rights to game content.

当前导入流程读取本机文件，不实现游戏资源联网下载、游戏账号登录、读取或注入游戏进程内存、修改游戏文件。这些说明描述源码中的运行边界，不代表对所有依赖或实际二进制完成了安全鉴定，也不构成复制、提取或再利用资源的法律授权。

## 运行与数据处理

以下命令在本仓库根目录执行。导入前需按 [源码构建说明](../README.md) 准备 `vendor/` 中的提取与解码工具；`inspect` 仅检查游戏目录。

```powershell
python engine/main.py inspect --game "D:\SteamLibrary\steamapps\common\Yu-Gi-Oh! Master Duel"
python engine/main.py import --game "D:\SteamLibrary\steamapps\common\Yu-Gi-Oh! Master Duel" --data ".local-data" --tools vendor
python engine/main.py import --game "D:\SteamLibrary\steamapps\common\Yu-Gi-Oh! Master Duel" --data ".local-data" --tools vendor --scan-mode latest
python -m unittest discover -s engine/tests -v
```

发行构建通过 PyInstaller 打包 `main.py`、同目录模块及 `rules/`，用户不需要 Python。原始载荷由 `vendor/importer/AudioInventory.exe` 读取；该程序只引用 AssetStudio 核心，不使用 AudioClipConverter、FMOD 或 AssetStudioUtility。FSB 使用 vgmstream 单次解码（忽略循环）；其他格式交给 FFmpeg。源采样率、声道与完整尾音保留。

导入引擎管理的音频、缓存与报告输出局限于 `--data`。资料根与游戏根不能重叠，路径验证解析 Windows junction，并拒绝数据子目录中的链接；扫描不跟随源目录中的链接。游戏文件只读打开，进程工作目录不设置到游戏内。支持任意名称的 `LocalData/*/0000`，以及公共 `masterduel_Data` 资源。

这里的写入范围描述的是导入引擎；桌面导出可写到另选的受路径保护目录。扫描会读取并记录账号资源目录名称及文件来源，不验证这些文件的取得方式或用户授权。`version_matches` 按配方的版本锁读取并计算文件哈希，包括 `GameAssembly.dll`，但不执行该游戏 DLL。运行时导入使用本机文件；开发依赖准备需要联网下载。

`--scan-mode all|latest` 控制账号范围；CLI 未指定时为 `all`，桌面默认选择 `latest`。最新目录按 `0000` 目录的修改时间纳秒值选取，时间并列按账号名称 Unicode 字典序选取；选择时只读取目录元数据，不遍历旧账号的文件。`inspect` 返回 `accountDirectories`（`name`、毫秒 `modifiedAt`、十进制字符串 `modifiedNs`）、`latestAccount` 与 `selectionError`。目录时间读取失败时返回错误，不猜测最新账号。

桌面在任务开始前冻结账号名单并通过 `--accounts-json '["account"]'` 传入。显式 `[]` 只扫描公共资源，省略参数则按模式选择；`latest` 名单至多一个账号。无账号或最新账号为空时仍读取公共资源，不自动改扫旧账号。冻结后账号消失、目录变成联接或源文件变化会明确报告，任务不会切换到其他账号。公共资源始终包含在两种模式中。

临时载荷位于 `cache/staging/`；逐个 WAV 完整读取并计算真实样本峰值包络，按 SHA-256 原子提交到 `assets/audio/<hash>.wav` 后才发布记录。失败的文件不进入成功缓存。缓存签名包含内容哈希、依赖哈希、工具哈希、引擎版本；重复扫描根据文件大小与修改时间判断是否需要重新哈希，已提交媒体再次校验内容哈希。取消文件支持正在运行的解码／提取子进程终止。

资源包先按完整缓存键分组，每组只安排一个提取代表，再按原目录分批（不超过 128 个文件或 256 MiB，单个超限文件独立成批）。有效缓存包括成功解析且没有音频的空结果；损坏或缺字段的音频记录不算成功。代表完成后，其他副本通过重新核对签名补齐来源。批次异常先复查已提交缓存，只重试未完成的代表一次，再顺序尝试其等价副本。尝试错误写入 `attemptErrors`，只有最终未恢复的组或无法绑定的变化来源计入 `failures`；取消立即停止后续重试和来源补齐。

报告格式标识为 `md-audio-1.0.1`，缓存兼容标识为 `md-audio-1.0.0`；它们独立于播放器的应用版本。没有账号外部依赖时，普通资源保留 1.0.0 的完整键形状、音频媒体缓存与逻辑身份。所选范围发现任意账号 `.resource`/`.resS` 依赖时，所有账号资源包使用 `account-dependencies-v1` 命名空间与账号标识隔离，依赖只纳入公共文件及该账号文件，禁止回退复用旧跨账号资源包缓存。媒体自身经哈希校验后仍可复用。

`last-scan.json` 和 `last-import.json` 记录实际 `scanMode` 与冻结的 `accounts`。导入报告包含 `phaseSeconds`（`scan`、`fingerprintCache`、`extractDecode`、`actions`），以及 `bundleCount`、`uniqueBundleTasks`、`deduplicatedBundles`、`pendingBundleTasks`、`cacheReusedBundles`、`sameRunReusedBundles`、`extractorCalls`、`retries`。`uniqueBundleTasks` 包含已命中缓存的唯一任务；`cacheReusedBundles` 是启动时已存在有效缓存的源资源包数量，`sameRunReusedBundles` 是本轮提取成功后实际补齐的副本数量。它们不同于音频记录层的 `duplicates`。指纹索引在分组结束后保存一次，提取阶段不反复重写相同的大索引。

逻辑记录 ID 使用账号无关的资源位置、序列化文件、PathID、名称与原始载荷哈希。相同文件在不同账号中共用逻辑记录与媒体，来源单独保留；改变载荷时保留为独立版本，避免将旧标注猜测关联到新声音。个人覆盖由 Electron SQLite 管理；引擎从不读写个人标题或标签。

`rules/classification.json` 是 2,378 条整理过的名称＋原始载荷哈希分类。`rules/recipes.json` 保存时间、增益、变调与哈希参数，包含 71 个完整动作和 13 个动作主体。当前规则不包含卡名切入索引、卡名或卡片编号；文件哈希、条目数量及资料整理记录见 [规则清单](../compliance/rules-manifest.json)。规则文件不含游戏音频载荷，但其中的内部名称、哈希、时序等仍属从游戏整理的资料；结构化存储和通过功能验证均不能证明这些资料具有可分发的法律依据，其分发范围仍待独立评估。

动作缓存键包含完整配方对象，因此文案变更会让受影响的非别名动作在下次扫描时重新生成；原始音频缓存、合成参数及个人标注保持原有行为。

原始游戏版本及所需素材不匹配时，动作明确标为不可用；从不凭名称猜测合成。动作混音使用 48 kHz 双声道 24-bit，保留源尾音（有明确时序截断要求的旧连锁模块例外），输出后再次验证 4 倍过采样峰值不超过 -1 dBFS。

测试覆盖账号改名、多账号去重、最新／全部／公共范围、目录时间并列与读取失败、冻结目录消失、空目录、便携目录移动、增量重放、空成功缓存、缓存元数据损坏、代表失败回退、部分批次提交、来源及依赖变化、账号依赖隔离、取消续跑、分批限制与索引保存次数、损坏音频、目录边界与 junction、取消子进程及空间不足。真实 Unity 资源与真实解码器的端到端验证由发行验证流程补充，不以模拟提取替代。

默认自动化测试使用程序生成的信号及合成结构；这些功能测试不是版权或授权审计。真实外部测试资源须具有相应使用依据，资源本体、来源目录和导入报告不应进入公开仓库或发行包。
