# MD Audio Player

[简体中文](README.md)

Organize the Yu-Gi-Oh! MASTER DUEL sound effects, music and voices already downloaded on your PC into a personal library for listening, categorizing, tagging, collecting and exporting.

**Windows 10 or later (x64) · Offline operation · No game audio included**

> [!IMPORTANT]
> This is an unofficial tool. It is not affiliated with, authorized, sponsored or endorsed by Konami or the relevant rights holders. Game music, sound effects, voices, related names and trademarks belong to Konami and their respective rights holders.
>
> Neither this repository nor its release packages include game audio or resource bundles. The tool processes game files already on your PC and grants no rights to game content. Exported audio is for personal, non-commercial use only; do not redistribute, upload or use it commercially. Use the tool only as permitted by the game's terms and applicable law. These notices about game content do not change the MIT license for original project code.

## Features

- **Import:** Select a local game installation and scan the latest account resource directory or all account resource directories. Cancel an import and resume by scanning again.
- **Organize:** Search names, original resource names, internal identifiers and tags. Edit categories and tags in bulk and mark favorites. Reimporting preserves personal edits.
- **Filter:** Select sound types, audio forms and grouped tags. Selections within a group use OR; selections across groups use AND. Clicking a sidebar category clears the search and filters.
- **Listen:** View sample-based waveforms, seek through audio, repeat a track, loop an A/B section and use Space to play or pause.
- **Complete actions:** Combine multiple sounds according to their timing when the resource version and all required sounds match. Unavailable actions display the reason.
- **Export:** Copy the library's decoded WAV without another conversion, or export a 48 kHz / 24-bit stereo WAV. Batch exports use category folders and avoid overwriting existing files.
- **Back up annotations:** Export personal annotations to JSON or restore them from JSON. These backups contain no audio.
- **Themes and credits:** Choose dark, light or game-inspired themes. View third-party software and font credits offline under settings → about (`设置与偏好 → 关于`).

The card-name tag filter uses qualifying existing tags in your local legacy library and personal tags explicitly written as `卡名：Card name`. It includes no card-name dictionary and does not infer card names from ordinary titles. Missing source information does not lead to guessed attributes or card types. Existing libraries receive display facets when records are read, without reimporting audio or rewriting personal annotations or media files.

## Download and use (recommended)

Download the Windows x64 portable ZIP from [Releases](https://github.com/PetYin/MD-Audio-Player/releases). Its filename starts with `MD-Audio-Player-` and ends with `-win-x64.zip`. Extract it and run the player; **no development tools are required**. To modify the code or build it yourself, use this repository or a release source archive and follow the optional build instructions below.

1. Install Yu-Gi-Oh! MASTER DUEL through an official channel and download the resources you need within the game.
2. Download the portable ZIP and extract the entire archive into a writable folder outside the game installation. Do not run the player directly from inside the ZIP.
3. Run `MD音效播放器.exe` and select the game folder containing `masterduel.exe`. Detected Steam installations appear as candidates.
4. Choose the scan scope and start importing. Canceling preserves completed sounds; you can scan again later.
5. Listen, organize and export offline. After a game update, scan again from settings.

**Moving an existing portable library:** Close both copies of the player. Copy `assets/`, `data/` and `cache/` from the old folder to the folder containing the new EXE, then start the new copy. Keep the old folder as a backup instead of overwriting the old application. A used player folder contains game audio and personal data; do not share the entire folder.

## Data locations and runtime behavior

The running player has no online download, upload, account login, telemetry or automatic update feature. Building from source requires internet access to obtain development dependencies.

The player only reads game files. It does not modify the game, read or inject into the game process, or execute the game program or its DLLs. Scanning reads Steam installation locations, account directory names and modification times under `LocalData`, and hashes of selected game files, including `GameAssembly.dll`, to identify resources and versions. Attempts to write into the game directory are rejected.

| Run mode | Data root |
| --- | --- |
| Portable package | The folder containing `MD音效播放器.exe` |
| From source | The repository's `data/` folder by default; override it with the `MD_PLAYER_DATA` environment variable |

Within the data root, `assets/` stores imported audio, `data/` stores the library, settings and logs, and `cache/` stores import caches. The default database path when running from source is therefore `data/data/library.sqlite`. Exported audio and annotation backups can be saved elsewhere and are not removed when you delete the player's data.

## Run from source (optional)

The development environment requires Windows x64, PowerShell, Node.js, Python, the .NET SDK, Visual Studio C++ Build Tools with CMake, and Git for Windows with Bash. Use the toolchain versions specified in the [dependency lock file](dependencies.lock.json) and [Windows build workflow](.github/workflows/windows.yml). **Python must exactly match the version in the dependency lock file**; the bootstrap script enforces this requirement.

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

Alternatively, download and extract the release archive ending in `-source.zip`. Open the directory containing `package.json` and follow the commands above starting with `npm ci`. Once the player starts, follow the game-folder selection and import steps in “Download and use.”

`dependencies.lock.json` pins native dependency sources, versions and SHA256 hashes. `package-lock.json` pins npm dependencies and their integrity values. `bootstrap.ps1` prepares third-party tools and license material in the project's `vendor/` directory. These downloaded dependencies and runtime data are not committed to Git.

Normal builds use the checked-in classification and facet JSON files.

### Verify and package

```powershell
python -m unittest discover -s engine/tests
npm run test:release
npm run test:desktop
npm run test:facets
node scripts/test-category-navigation.mjs
```

These tests use synthetic sounds or synthetic structures. Do not commit real game resources, personal libraries or import reports.

```powershell
npm run package
node scripts/test-packaged.mjs
```

Packaging writes to a subdirectory of `release/` named after the application version. It produces a portable ZIP, a source ZIP, a file manifest and SHA256 hashes, and refuses to overwrite an existing version directory. The [release file policy](scripts/release-policy.json) checks package contents; unlisted files, game media, resource bundles and databases cannot enter a release package.

Rebuilt native binaries may differ from the previously reviewed hashes, so successful bootstrapping does not guarantee successful packaging. Hash differences require a review of sources and build results; do not bypass the checks by simply regenerating approval values. On pushes and pull requests, GitHub Actions only checks that the project compiles (`npm ci` and `npm run build`). It does not run bootstrapping, tests or packaging, and it does not create a GitHub Release; run tests and packaging locally with the commands above.

## Project structure

| Directory | Contents |
| --- | --- |
| `src/` | React interface |
| `desktop/` | Electron main process, library and exports |
| `shared/` | Shared interfaces, facet metadata and credits |
| `engine/` | Python import engine; `rules/` holds classifications and action recipes |
| `importer/` | C# audio reader based on AssetStudioMod |
| `scripts/`, `tests/` | Build, packaging, audit and test tools |
| `compliance/` | Third-party source material, patches, provenance records and rule manifest |

## License and third-party material

- Original project code is licensed under the [MIT license](LICENSE).
- Game content and the game-derived data in `engine/rules/` and `shared/facet-metadata.json` are excluded from the MIT license. This data includes resource names, hashes, versions, action timings and limited classification information. Provenance records do not establish permission to distribute game content.
- Third-party components retain their own licenses. See [CREDITLIST.md](CREDITLIST.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the [source and provenance material](compliance/README.md). Three pinned third-party source archives are retained in the repository; their upstream test fixtures are not game resources.
- After bootstrapping, license texts are in `vendor/licenses/`; their portable-package location is `resources/vendor/licenses/`. Source for the FFmpeg command-line tools is obtained during dependency preparation and included with the portable package. See `compliance/` for the source and rebuild limitations of Electron's FFmpeg component.

©2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI  
©Konami Digital Entertainment

## Feedback and frequently asked questions

Submit problems and suggestions through [Issues](https://github.com/PetYin/MD-Audio-Player/issues), including the version, steps to reproduce and error messages. Do not attach game audio, resource bundles, account directory names or other personal information. Rights holders can also identify the relevant content and requested action through Issues. Such requests receive priority, including content removal or suspension of distribution where necessary.

**Why are some complete actions unavailable?** Combined actions require a matching resource version and all required sounds. If a game update changes those resources, the player displays the reason. Individual sounds already imported remain playable.

**Is an exported WAV the original game file?** No. It is the WAV already decoded into the library. Exporting in the imported format copies that file; standard export converts it to 48 kHz / 24-bit stereo.

**Are macOS or Linux supported?** Only Windows x64 is currently supported.
