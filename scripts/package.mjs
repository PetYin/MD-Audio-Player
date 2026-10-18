import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packager } from '@electron/packager';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
function inside(candidate, parent) {
  if (!normalized(path.resolve(candidate)).startsWith(normalized(path.resolve(parent)) + path.sep)) {
    throw new Error(`Release path leaves its intended workspace directory: ${candidate}`);
  }
}
function directory(candidate) {
  inside(candidate, root);
  fs.mkdirSync(candidate, { recursive: true });
  if (fs.lstatSync(candidate).isSymbolicLink() || normalized(fs.realpathSync(candidate)) !== normalized(path.resolve(candidate))) {
    throw new Error(`Refusing linked release directory: ${candidate}`);
  }
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Release version must be an explicit x.y.z version.');
const release = path.join(root, 'release', pkg.version);
if (fs.existsSync(release)) throw new Error(`Release already exists: ${release}. Review it before choosing a new output; existing releases are never overwritten.`);
const cache = path.join(root, '.cache');
directory(cache);
directory(path.join(root, 'release'));
const stage = fs.mkdtempSync(path.join(cache, 'release-'));
const python = process.env.PYTHON || 'python';
function run(script, args) {
  const result = spawnSync(python, [path.join(root, 'scripts', script), ...args], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error || result.status !== 0) throw new Error(`${script} failed; no release was published. ${result.error?.message || ''}`);
}
const audit = (...args) => run('release-audit.py', [...args, '--root', root]);
audit('prepare', '--stage', stage);
const plan = JSON.parse(fs.readFileSync(path.join(stage, 'plan.json'), 'utf8'));
const [output] = await packager({
  dir: path.join(stage, 'app'), out: path.join(stage, 'packager'), name: 'MD-Audio-Player',
  executableName: 'MD音效播放器', platform: 'win32', arch: 'x64',
  electronVersion: pkg.devDependencies.electron, electronZipDir: path.join(stage, 'electron'),
  overwrite: false, asar: false, prune: false, icon: path.join(stage, 'app', 'resources', 'icon.ico'),
  win32metadata: { CompanyName: 'MD Audio Player contributors', FileDescription: 'MD 音效播放器', ProductName: 'MD 音效播放器' },
  appVersion: pkg.version,
});
inside(output, stage);
function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
// Copy only individually approved files. Never copy a vendor or source directory wholesale.
copy(path.join(output, 'LICENSE'), path.join(output, 'resources', 'vendor', 'licenses', 'Electron-MIT.txt'));
for (const item of plan.vendor) copy(path.join(root, 'vendor', item.path), path.join(output, 'resources', 'vendor', item.path));
for (const name of plan.documentationFiles) copy(path.join(stage, 'source', name), path.join(output, name));
audit('finalize', '--stage', stage, '--portable', output);
const publish = path.join(stage, 'publish');
fs.mkdirSync(publish);
const manifest = path.join(stage, 'candidate-manifest.json');
for (const [kind, directory, suffix] of [['source', path.join(stage, 'source'), 'source'], ['portable', output, 'win-x64']]) {
  run('zip-release.py', [directory, path.join(publish, `MD-Audio-Player-${pkg.version}-${suffix}.zip`), '--manifest', manifest, '--kind', kind, '--policy', path.join(root, 'scripts', 'release-policy.json')]);
}
audit('verify-archives', '--stage', stage, '--publish', publish);
fs.renameSync(output, path.join(publish, 'MD-Audio-Player-win32-x64'));
directory(path.dirname(release));
inside(publish, stage);
inside(release, path.join(root, 'release'));
// Single final rename exposes only a completely verified version directory.
fs.renameSync(publish, release);
console.log(`Verified release: ${release}`);
console.log(`Portable executable: ${path.join(release, 'MD-Audio-Player-win32-x64', 'MD音效播放器.exe')}`);
