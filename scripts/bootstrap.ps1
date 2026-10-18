#requires -Version 7.0
[CmdletBinding()]
param([switch]$SkipEngine, [switch]$EngineOnly)
$ErrorActionPreference = 'Stop'
if ($SkipEngine -and $EngineOnly) { throw '-SkipEngine and -EngineOnly cannot be combined.' }
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$playerRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $playerRoot
$lock = Get-Content dependencies.lock.json -Raw | ConvertFrom-Json
# Keep prior build outputs for recovery. Never merge an old output/source tree
# into a fresh dependency build, and never follow a junction while moving it.
$buildBackupRoot = Join-Path $playerRoot ('.cache/bootstrap-backup-' + [Guid]::NewGuid().ToString('N'))
function Assert-WorkspacePath([string]$Candidate) {
    $resolved = [IO.Path]::GetFullPath($Candidate)
    $prefix = [IO.Path]::GetFullPath($playerRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Build path escaped the player workspace: $resolved" }
    $cursor = $resolved
    while ($cursor -and $cursor.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing a linked build path: $cursor" }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $resolved
}
function Reset-BuildDirectory([string]$Relative) {
    $target = Assert-WorkspacePath (Join-Path $playerRoot $Relative)
    if (Test-Path -LiteralPath $target) {
        $backup = Assert-WorkspacePath (Join-Path $buildBackupRoot $Relative)
        if (Test-Path -LiteralPath $backup) { throw "Refusing to overwrite a build backup: $backup" }
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($backup)) -Force | Out-Null
        Move-Item -LiteralPath $target -Destination $backup
    }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
}
if (-not $EngineOnly) {
    foreach ($relative in @('vendor/assetstudio','vendor/importer','vendor/vgmstream','vendor/ffmpeg','vendor/sources','.cache/src/assetstudio','.cache/src/vgmstream-r2117','.cache/src/ffmpeg-8.0','.cache/build-vgmstream')) {
        Reset-BuildDirectory $relative
    }
}
if (-not $SkipEngine) {
    foreach ($relative in @('vendor/engine','.cache/engine-dist','.cache/engine-build')) { Reset-BuildDirectory $relative }
}
foreach ($dir in @('.cache/downloads','.cache/src','vendor/assetstudio','vendor/importer','vendor/vgmstream','vendor/ffmpeg','vendor/engine','vendor/licenses','vendor/sources')) {
    $null = Assert-WorkspacePath (Join-Path $playerRoot $dir)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
function Assert-Exit([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}
function Get-Verified([string]$Url, [string]$Path, [string]$Sha256) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Invoke-WebRequest -Uri $Url -OutFile ($Path + '.part')
        if ((Get-FileHash -LiteralPath ($Path + '.part')).Hash -ne $Sha256) { throw "Checksum mismatch: $Url" }
        Move-Item -LiteralPath ($Path + '.part') -Destination $Path
    }
    if ((Get-FileHash -LiteralPath $Path).Hash -ne $Sha256) { throw "Checksum mismatch: $Path" }
}
if (-not $EngineOnly) {
    foreach ($archive in $lock.archives) {
        Get-Verified $archive.url (Join-Path '.cache/downloads' $archive.file) $archive.sha256
    }
    foreach ($license in $lock.licenses) {
        Get-Verified $license.url (Join-Path 'vendor/licenses' $license.file) $license.sha256
    }
    Expand-Archive .cache/downloads/assetstudio-v0.19.0.zip .cache/src/assetstudio -Force
    Expand-Archive .cache/downloads/vgmstream-r2117.zip .cache/src -Force
    & tar -xf .cache/downloads/ffmpeg-8.0.tar.xz -C .cache/src
    Assert-Exit 'Extract FFmpeg'
    & tar -xf .cache/downloads/make-4.4.1-2.pkg.tar.zst -C .cache
    Assert-Exit 'Extract GNU Make'
    $asset = $lock.archives | Where-Object id -eq assetstudio
    foreach ($name in $asset.runtimeAllowlist) {
        Copy-Item -LiteralPath (Join-Path '.cache/src/assetstudio/AssetStudioModCLI_net9_portable' $name) -Destination vendor/assetstudio -Force
    }
    & dotnet publish importer/AudioInventory.csproj -c Release -r win-x64 --self-contained true -o vendor/importer -p:RuntimeFrameworkVersion=10.0.6 -p:PublishSingleFile=false -p:DebugType=None -p:DebugSymbols=false
    Assert-Exit 'Publish self-contained importer'
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $vsRoot = & $vswhere -products '*' -version '[17.0,18.0)' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath -latest
    if (-not $vsRoot) { throw 'Install Visual Studio 2022 Build Tools with C++ Desktop and CMake components.' }
    $cmake = Join-Path $vsRoot 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
    if (-not (Test-Path -LiteralPath $cmake)) { $cmake = (Get-Command cmake -ErrorAction Stop).Source }
    & $cmake -S .cache/src/vgmstream-r2117 -B .cache/build-vgmstream -G 'Visual Studio 17 2022' -A x64 -DBUILD_CLI=ON -DBUILD_FB2K=OFF -DBUILD_WINAMP=OFF -DBUILD_XMPLAY=OFF -DUSE_MPEG=OFF -DUSE_VORBIS=ON -DUSE_FFMPEG=OFF -DUSE_G7221=OFF -DUSE_G719=OFF -DUSE_ATRAC9=OFF -DUSE_CELT=OFF -DUSE_SPEEX=OFF -DCMAKE_POLICY_DEFAULT_CMP0091=NEW -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
    Assert-Exit 'Configure minimal vgmstream'
    & $cmake --build .cache/build-vgmstream --config Release --parallel 12
    Assert-Exit 'Build minimal vgmstream'
    Copy-Item .cache/build-vgmstream/cli/Release/vgmstream-cli.exe vendor/vgmstream -Force
    Copy-Item .cache/src/vgmstream-r2117/ext_libs/dll-x64/libvorbis.dll vendor/vgmstream -Force
    $gitRoot = Split-Path (Split-Path (Get-Command git -ErrorAction Stop).Source -Parent) -Parent
    $bash = Join-Path $gitRoot 'bin/bash.exe'
    if (-not (Test-Path -LiteralPath $bash)) { throw 'Git for Windows with Bash is required.' }
    $vsdevcmd = Join-Path $vsRoot 'Common7/Tools/VsDevCmd.bat'
    # Only fixed tool paths and this checked-in build script are passed to cmd.
    $buildCommand = 'call "' + $vsdevcmd + '" -arch=x64 && "' + $bash + '" --noprofile --norc scripts/build-ffmpeg.sh'
    & cmd.exe /d /s /c $buildCommand
    Assert-Exit 'Build LGPL FFmpeg'
    Copy-Item .cache/src/ffmpeg-8.0/ffmpeg.exe,.cache/src/ffmpeg-8.0/ffprobe.exe vendor/ffmpeg -Force
    Copy-Item .cache/downloads/ffmpeg-8.0.tar.xz vendor/sources -Force
    Copy-Item scripts/build-ffmpeg.sh vendor/sources -Force
    Copy-Item .cache/src/ffmpeg-8.0/COPYING.LGPLv2.1 vendor/licenses/FFmpeg-LGPL-2.1.txt -Force
    Copy-Item .cache/src/vgmstream-r2117/COPYING vendor/licenses/vgmstream-ISC.txt -Force
    Copy-Item .cache/src/vgmstream-r2117/ext_libs/licenses/libvorbis-1.3.7.COPYING vendor/licenses/Vorbis-BSD.txt -Force
    Copy-Item .cache/src/vgmstream-r2117/ext_libs/licenses/libogg-1.3.5.COPYING vendor/licenses/Ogg-BSD.txt -Force
    & vendor/ffmpeg/ffmpeg.exe -version
    Assert-Exit 'FFmpeg smoke test'
    & vendor/vgmstream/vgmstream-cli.exe -h
}
if (-not $SkipEngine) {
    if (-not (Test-Path .cache/build-python/Scripts/python.exe)) {
        & python -m venv .cache/build-python
        Assert-Exit 'Create local Python build environment'
    }
    $python = Join-Path $playerRoot '.cache/build-python/Scripts/python.exe'
    $pythonVersion = & $python -c 'import platform; print(platform.python_version())'
    if ($pythonVersion -ne $lock.buildTools.python) { throw "Build requires Python $($lock.buildTools.python), found $pythonVersion. This keeps the packaged runtime and third-party notices in sync." }
    & $python -m pip install --disable-pip-version-check --require-hashes -r scripts/requirements-build.txt
    Assert-Exit 'Install pinned Python build dependencies'
    $rules = (Resolve-Path engine/rules).Path + ';rules'
    & $python -m PyInstaller --noconfirm --clean --onedir --name md-engine --distpath .cache/engine-dist --workpath .cache/engine-build --specpath .cache --add-data $rules engine/main.py
    Assert-Exit 'Package Python engine'
    Copy-Item .cache/engine-dist/md-engine/* vendor/engine -Recurse -Force
    Copy-Item .cache/build-python/Lib/site-packages/pyinstaller-6.16.0.dist-info/licenses/COPYING.txt vendor/licenses/PyInstaller-COPYING.txt -Force
    $pythonBase = & $python -c 'import sys; print(sys.base_prefix)'
    Copy-Item (Join-Path $pythonBase 'LICENSE.txt') vendor/licenses/Python-3.13.txt -Force
    & vendor/engine/md-engine.exe --help
    Assert-Exit 'Packaged engine smoke test'
}
$uiLicenses = @{'React-MIT.txt'='react/LICENSE';'ReactDOM-MIT.txt'='react-dom/LICENSE';'Scheduler-MIT.txt'='scheduler/LICENSE';'Zod-MIT.txt'='zod/LICENSE';'Lucide-LICENSE.txt'='lucide-react/LICENSE';'Manrope-OFL.txt'='@fontsource-variable/manrope/LICENSE';'NotoSansSC-OFL.txt'='@fontsource-variable/noto-sans-sc/LICENSE'}
foreach ($entry in $uiLicenses.GetEnumerator()) {
    $source = Join-Path 'node_modules' $entry.Value
    if (-not (Test-Path -LiteralPath $source)) { throw 'Run npm ci before bootstrap to include the exact JavaScript/font licenses.' }
    Copy-Item -LiteralPath $source -Destination (Join-Path 'vendor/licenses' $entry.Key) -Force
}
$runtimeFiles = foreach ($directory in @('importer','engine','vgmstream','ffmpeg')) {
    Get-ChildItem -LiteralPath (Join-Path 'vendor' $directory) -Recurse -File | ForEach-Object {
        [ordered]@{ path=[IO.Path]::GetRelativePath((Join-Path $playerRoot 'vendor'), $_.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
    }
}
[ordered]@{ schemaVersion=1; platform='win-x64'; buildTools=$lock.buildTools; runtimeFiles=@($runtimeFiles) } | ConvertTo-Json -Depth 5 | Set-Content vendor/build-info.json -Encoding utf8
Write-Host 'Pinned portable dependencies are ready in vendor/. Previous build trees, if any, are retained under:' $buildBackupRoot
Write-Host 'Packaging separately checks the reviewed release policy. Rebuilt binary hash differences require review; bootstrap never updates approval hashes.'
