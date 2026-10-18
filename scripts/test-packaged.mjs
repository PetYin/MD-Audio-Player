/**
 * Portable Windows release acceptance test. Never edits the supplied app/fixture.
 *
 * node scripts/test-packaged.mjs
 * node scripts/test-packaged.mjs --app <extracted-release-directory> --fixture <fixture-directory>
 *
 * Without --fixture, generates a small original sine-wave fixture. To exercise
 * Unity/FSB extraction, pass a legally available Unity audio installation fixture.
 * Tests run only on copies inside .cache. The child PATH contains Windows only.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (key === '--help') {
    console.log('Usage: node scripts/test-packaged.mjs [--app <release-directory-or-exe>] [--fixture <fixture-directory>] [--expected-ready <count>] [--output <report-directory>]');
    process.exit(0);
  }
  if (!['--app', '--fixture', '--expected-ready', '--output'].includes(key) || !process.argv[index + 1]) throw new Error(`Unknown or incomplete option: ${key}`);
  options[key.slice(2)] = process.argv[++index];
}
if (process.platform !== 'win32') throw new Error('This acceptance test targets the Windows portable release.');
const suppliedApp = path.resolve(options.app || path.join(root, 'release', packageVersion, 'MD-Audio-Player-win32-x64'));
const release = suppliedApp.toLowerCase().endsWith('.exe') ? path.dirname(suppliedApp) : suppliedApp;
const executableName = suppliedApp.toLowerCase().endsWith('.exe') ? path.basename(suppliedApp) : 'MD音效播放器.exe';
const expectedReady = Number(options['expected-ready'] || 1);
assert(Number.isSafeInteger(expectedReady) && expectedReady > 0, '--expected-ready must be a positive integer');
const output = path.resolve(options.output || path.join(root, 'test-results', 'packaged-audit'));
const workspace = path.join(root, '.cache', `packaged-audit-${Date.now()}`);
let portable = path.join(workspace, 'Player');
const game = path.join(workspace, 'Game');
const offlineGame = path.join(workspace, 'Game-offline');
const moved = path.join(workspace, 'Moved Player');
const checks = [];
const runtimeErrors = [];
let app;
let page;
let report = { passed: false, fixtureKind: options.fixture ? 'provided fixture' : 'generated original sine wave', checks, runtimeErrors, workspace };

const required = [executableName, 'resources/vendor/engine/md-engine.exe', 'resources/vendor/importer/AudioInventory.exe', 'resources/vendor/vgmstream/vgmstream-cli.exe', 'resources/vendor/ffmpeg/ffmpeg.exe', 'resources/vendor/ffmpeg/ffprobe.exe'];
for (const relative of required) assert(fs.statSync(path.join(release, relative)).size > 0, `Missing or incomplete release file: ${relative}`);
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });

function files(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const item = path.join(relative, entry.name);
    assert(!entry.isSymbolicLink(), `Test inputs cannot contain symbolic links: ${item}`);
    return entry.isDirectory() ? files(directory, item) : [item];
  });
}
async function hash(filename) {
  const digest = createHash('sha256');
  for await (const buffer of fs.createReadStream(filename)) digest.update(buffer);
  return digest.digest('hex');
}
async function manifest(directory) {
  const entries = [];
  for (const relative of files(directory)) entries.push([relative.replaceAll('\\', '/'), await hash(path.join(directory, relative))]);
  return { count: entries.length, digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
function assertWorkspace(target) {
  const resolved = path.resolve(target).toLowerCase();
  assert(resolved.startsWith(path.resolve(workspace).toLowerCase() + path.sep), 'A move target escaped the dedicated audit workspace');
}
function generateFixture(directory) {
  const samples = 48000 * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(7000 * Math.sin(index * Math.PI * 2 * 330 / 48000) * Math.min(1, index / 500, (samples - index) / 500)), 44 + index * 2);
  const bundle = path.join(directory, 'LocalData', 'portable-test-account', '0000', '00', 'SE_ORIGINAL_TEST.wav');
  fs.mkdirSync(path.dirname(bundle), { recursive: true }); fs.writeFileSync(bundle, wav);
}
const windows = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) if (['path', 'md_player_data', 'md_engine_python', 'pythonhome', 'pythonpath', 'python', 'node_options', 'node_path', 'electron_run_as_node'].includes(key.toLowerCase())) delete childEnv[key];
childEnv.PATH = `${path.join(windows, 'System32')};${windows}`;
childEnv.DOTNET_MULTILEVEL_LOOKUP = '0';

async function launch() {
  app = await electron.launch({ executablePath: path.join(portable, executableName), args: [], env: childEnv, timeout: 30000 });
  app.process().stderr.on('data', buffer => { const text = buffer.toString(); if (/Uncaught|Error occurred in handler/.test(text)) runtimeErrors.push(text); });
  page = await app.firstWindow();
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.waitForFunction(() => !!window.md);
  await page.waitForSelector('.app-shell');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath, userData: app.getPath('userData'), searchPath: process.env.PATH }));
  assert.equal(identity.packaged, true);
  assert.equal(path.resolve(identity.executable).toLowerCase(), path.resolve(portable, executableName).toLowerCase());
  assert.equal(identity.searchPath, childEnv.PATH);
  assert(identity.userData.toLowerCase().startsWith(path.resolve(portable).toLowerCase() + path.sep));
  return identity;
}
async function capture(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(output, name), Buffer.from(data, 'base64'));
}
async function waitImport() {
  const timeout = Date.now() + 180000;
  while (Date.now() < timeout) {
    const progress = await page.evaluate(() => window.md.importStatus());
    if (progress && ['complete', 'cancelled', 'failed'].includes(progress.stage)) return progress;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Packaged engine import timed out after 180 seconds');
}
async function play(title) {
  const dialogs = page.locator('dialog[open]');
  if (await dialogs.count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `播放 ${title}`, exact: true }).click();
  await page.getByRole('button', { name: '单曲循环', exact: true }).click();
  if (await page.locator('audio').evaluate(audio => audio.paused)) await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && audio.readyState >= 2 && !audio.paused && audio.currentTime > 0 && !audio.error; }, null, { timeout: 10000 });
  return page.locator('audio').evaluate(audio => ({ duration: audio.duration, currentTime: audio.currentTime, readyState: audio.readyState, error: audio.error?.code || 0, source: audio.getAttribute('src') }));
}
async function close() {
  if (!app) return;
  const closingApp = app;
  const child = closingApp.process();
  const started = Date.now();
  // Playwright's application-close notification can precede the OS process and
  // stdio handles actually closing. Observe ChildProcess.close before moving it.
  const processClosed = new Promise((resolve, reject) => {
    const hasExited = child.exitCode !== null || child.signalCode !== null;
    const streamsClosed = [child.stdout, child.stderr].every(stream => !stream || stream.destroyed || stream.readableEnded);
    if (hasExited && streamsClosed) { resolve(); return; }
    let timer;
    const finished = () => { clearTimeout(timer); child.off('close', finished); resolve(); };
    timer = setTimeout(() => { child.off('close', finished); reject(new Error(`Audit application PID ${child.pid} did not fully exit within 15 seconds; refusing to move its directory.`)); }, 15000);
    child.once('close', finished);
  });
  await Promise.all([processClosed, closingApp.close()]);
  app = null;
  report.shutdowns ||= [];
  report.shutdowns.push({ pid: child.pid, elapsedMs: Date.now() - started, exitCode: child.exitCode, signal: child.signalCode });
  assert.equal(child.exitCode, 0, `Audit application exited abnormally (${child.exitCode}, ${child.signalCode})`);
}

async function moveAfterExit(source, destination) {
  assertWorkspace(source); assertWorkspace(destination);
  const started = Date.now();
  const transientCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);
  let attempts = 0;
  const locks = [];
  while (true) {
    assertWorkspace(source); assertWorkspace(destination);
    assert(fs.existsSync(source), 'Move source disappeared unexpectedly');
    assert(!fs.existsSync(destination), 'Refusing to overwrite an existing move destination');
    attempts++;
    try {
      await fs.promises.rename(source, destination);
      report.moves ||= [];
      report.moves.push({ from: path.relative(workspace, source), to: path.relative(workspace, destination), attempts, elapsedMs: Date.now() - started, transientErrors: locks });
      return;
    } catch (error) {
      if (!transientCodes.has(error.code)) throw error;
      const remaining = 10000 - (Date.now() - started);
      if (remaining <= 0) throw new Error(`Directory remained locked for 10 seconds after application exit: ${source}. No processes were killed and no files were removed.`, { cause: error });
      locks.push(error.code);
      if (attempts === 1) console.log(`Waiting up to 10 seconds for Windows to release a directory handle (${error.code})…`);
      await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 100 * 2 ** Math.min(attempts - 1, 4))));
    }
  }
}

try {
  console.log('Hashing release and preparing independent copies…');
  const releaseBefore = await manifest(release);
  fs.cpSync(release, portable, { recursive: true });
  assert.deepEqual(await manifest(portable), releaseBefore, 'The copied release differs from the original');
  let originalFixtureBefore = null;
  let fixtureSource = null;
  if (options.fixture) {
    fixtureSource = path.resolve(options.fixture); originalFixtureBefore = await manifest(fixtureSource);
    fs.cpSync(fixtureSource, game, { recursive: true });
  } else generateFixture(game);
  // Minimal installation structure is added only to the copied/generated fixture.
  fs.mkdirSync(path.join(game, 'masterduel_Data'), { recursive: true });
  if (!fs.existsSync(path.join(game, 'masterduel.exe'))) fs.writeFileSync(path.join(game, 'masterduel.exe'), '');
  const gameBefore = await manifest(game);
  report = { ...report, releaseManifest: releaseBefore, engineSha256: await hash(path.join(portable, 'resources/vendor/engine/md-engine.exe')), originalFixtureManifest: originalFixtureBefore };
  report.initialLaunch = await launch();
  checks.push('Packaged executable starts with Windows-only PATH and portable userData');
  assert.equal((await page.evaluate(() => window.md.snapshot())).records.length, 0);
  await capture('01-first-launch.png');
  console.log('Importing fixture with bundled .NET, vgmstream and Python engine…');
  const inspection = await page.evaluate(directory => window.md.inspectInstallation(directory), game);
  assert.equal(inspection.valid, true, inspection.message);
  await page.evaluate(directory => window.md.startImport(directory, { scanMode: 'all' }), game);
  const progress = await waitImport(); report.import = progress;
  assert.equal(progress.stage, 'complete', JSON.stringify(progress)); assert.equal(progress.failures, 0, JSON.stringify(progress));
  const snapshot = await page.evaluate(() => window.md.snapshot());
  const ready = snapshot.records.filter(record => record.status === 'ready');
  assert.equal(ready.length, expectedReady); checks.push(`Bundled tools import ${expectedReady} playable record(s) without developer runtimes on PATH`);
  const chosen = ready[0];
  report.playback = await play(chosen.title); checks.push('Imported audio really decodes and plays in packaged Chromium');
  await page.locator('.track-row').filter({ hasText: chosen.title }).first().click();
  await capture('02-real-audio-playing.png');
  const renamed = '便携版验收 · 自定义名称';
  await page.evaluate(async ({ id, title }) => { await window.md.edit([id], { title, category: [], tags: [] }); }, { id: chosen.id, title: renamed });
  await page.waitForFunction(id => window.md.snapshot().then(value => { const record = value.records.find(item => item.id === id); return record?.title === '便携版验收 · 自定义名称' && !record.category.length && !record.tags.length; }), chosen.id);
  checks.push('Custom title and explicitly empty categories/tags persist');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const sourceAsset = path.join(portable, 'assets', 'audio', `${chosen.mediaId}.wav`);
  const sourceHash = await hash(sourceAsset);
  report.exports = {};
  for (const format of ['source', 'editing']) {
    console.log(`Exporting ${format} WAV with the packaged application…`);
    const destination = path.join(workspace, `Export-${format}`); fs.mkdirSync(destination, { recursive: true });
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, destination);
    const result = await page.evaluate(({ id, format }) => window.md.exportAudio([id], format), { id: chosen.id, format });
    assert.equal(result.cancelled, false); assert.equal(result.count, 1); assert.deepEqual(result.errors, []);
    const outputs = files(destination).filter(name => name.toLowerCase().endsWith('.wav')); assert.equal(outputs.length, 1);
    const target = path.join(destination, outputs[0]);
    const probe = JSON.parse(execFileSync(path.join(portable, 'resources/vendor/ffmpeg/ffprobe.exe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', target], { encoding: 'utf8', windowsHide: true, env: childEnv }));
    const stream = probe.streams.find(item => item.codec_type === 'audio'); assert(stream);
    if (format === 'source') assert.equal(await hash(target), sourceHash, 'Source export must preserve every decoded WAV byte');
    else { assert.equal(Number(stream.sample_rate), 48000); assert.equal(stream.channels, 2); assert.equal(stream.bits_per_sample, 24); assert.equal(stream.codec_name, 'pcm_s24le'); }
    report.exports[format] = { result, stream: { codec: stream.codec_name, sampleRate: Number(stream.sample_rate), channels: stream.channels, bits: stream.bits_per_sample }, sha256: await hash(target) };
  }
  checks.push('Original export is byte-identical; editing export is 48 kHz / 24-bit / stereo PCM');
  await capture('03-edited-library.png');
  await close();
  assert.deepEqual(await manifest(game), gameBefore, 'Import/export changed the working fixture');
  assertWorkspace(portable); assertWorkspace(moved); assertWorkspace(game); assertWorkspace(offlineGame);
  assert(!fs.existsSync(moved) && !fs.existsSync(offlineGame));
  console.log('Moving the complete copied player and making its source fixture unavailable…');
  await moveAfterExit(portable, moved); portable = moved;
  await moveAfterExit(game, offlineGame);
  assert(!fs.existsSync(game));
  report.movedLaunch = await launch();
  const restored = await page.evaluate(id => window.md.snapshot().then(value => value.records.find(item => item.id === id)), chosen.id);
  assert.equal(restored.title, renamed); assert.deepEqual(restored.tags, []); assert.deepEqual(restored.category, []);
  assert.equal(await hash(path.join(portable, 'assets', 'audio', `${chosen.mediaId}.wav`)), sourceHash);
  report.offlinePlayback = await play(renamed);
  await page.locator('.track-row').filter({ hasText: renamed }).first().click();
  await capture('04-moved-offline-playing.png');
  checks.push('Moving the entire portable folder preserves edits, media and real offline playback');
  await close();
  assert.deepEqual(await manifest(offlineGame), gameBefore);
  if (fixtureSource) assert.deepEqual(await manifest(fixtureSource), originalFixtureBefore, 'Supplied fixture contents changed');
  assert.deepEqual(await manifest(release), releaseBefore, 'Original release contents changed');
  assert.deepEqual(runtimeErrors, []);
  checks.push('Supplied fixture, working fixture and original release content hashes are unchanged');
  report.passed = true;
  console.log(JSON.stringify({ passed: true, checks, report: path.join(output, 'report.json') }, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  if (app) { try { await capture('failure.png'); } catch (captureError) { report.captureError = String(captureError); } }
  throw error;
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (app) {
    try { await close(); } catch (closeError) { console.error(`Failed to close audit application: ${closeError}`); }
  }
}
