#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot ('.cache/bootstrap-guard-test-' + [Guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test workspace escaped project root.' }
$playerRoot = Join-Path $testRoot 'player'
$buildBackupRoot = Join-Path $playerRoot '.cache/backup'
New-Item -ItemType Directory -Path $playerRoot -Force | Out-Null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'bootstrap.ps1'), [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load only the two local helper definitions; do not run bootstrap or download/build dependencies.
$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Assert-WorkspacePath','Reset-BuildDirectory')}, $true) | ForEach-Object { Invoke-Expression $_.Extent.Text }
function Assert-Refused([scriptblock]$Action, [string]$MessagePattern) {
    try { & $Action; throw 'Expected rejection did not occur.' }
    catch { if ($_.Exception.Message -notlike $MessagePattern) { throw } }
}
Reset-BuildDirectory 'vendor/engine'
$oldFile = Join-Path $playerRoot 'vendor/engine/old.txt'
[IO.File]::WriteAllText($oldFile, 'preserved build output')
Reset-BuildDirectory 'vendor/engine'
if (Test-Path -LiteralPath $oldFile) { throw 'Old file contaminated new build output.' }
if ([IO.File]::ReadAllText((Join-Path $buildBackupRoot 'vendor/engine/old.txt')) -ne 'preserved build output') { throw 'Prior build output was not preserved.' }
Assert-Refused { Reset-BuildDirectory 'vendor/engine' } 'Refusing to overwrite a build backup:*'
Assert-Refused { Reset-BuildDirectory '../outside' } 'Build path escaped the player workspace:*'
$linkTarget = Join-Path $testRoot 'junction-target'
New-Item -ItemType Directory -Path $linkTarget | Out-Null
$linkPath = Join-Path $playerRoot 'linked'
New-Item -ItemType Junction -Path $linkPath -Target $linkTarget | Out-Null
Assert-Refused { Reset-BuildDirectory 'linked/engine' } 'Refusing a linked build path:*'
Write-Host 'PASS: fresh output, backup preservation, backup collision, workspace escape, junction refusal.'
Write-Host 'Small test fixtures retained at:' $testRoot
