/**
 * Packaged scanning acceptance. Real Unity fixture plus original tones.
 * Everything runs in new .cache copies; supplied fixture and release are read-only.
 * node scripts/test-scan-modes.mjs [--app <release>] [--fixture <Unity-fixture>] [--output <report-directory>]
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
for (let i = 2; i < process.argv.length; i++) {
  if (!['--app', '--fixture', '--output'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error(`Unknown or incomplete option: ${process.argv[i]}`);
  options[process.argv[i].slice(2)] = process.argv[++i];
}
assert.equal(process.platform, 'win32');
const release = path.resolve(options.app || path.join(root, 'release', packageVersion, 'MD-Audio-Player-win32-x64'));
const fixture = path.resolve(options.fixture || path.join(root, '.cache/engine-real-fixture'));
const output = path.resolve(options.output || path.join(root, 'test-results/scan-modes'));
const workspace = path.join(root, '.cache', `scan-modes-${Date.now()}`);
const game = path.join(workspace, 'Game');
const changedGame = path.join(workspace, 'Changed Game');
const oldAccount = 'a-旧账号';
const newAccount = 'z-最新账号';
const checks = [];
const errors = [];
const report = { passed: false, kind: 'real packaged Unity extraction and Electron UI acceptance', workspace, checks, errors, runs: {} };
let app, page, portable;
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });

function files(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const item = path.join(relative, entry.name);
    assert(!entry.isSymbolicLink(), `Fixture/release must not contain links: ${item}`);
    return entry.isDirectory() ? files(directory, item) : [item];
  });
}
async function hash(filename) {
  const sha = createHash('sha256');
  for await (const buffer of fs.createReadStream(filename)) sha.update(buffer);
  return sha.digest('hex');
}
async function manifest(directory) {
  const rows = [];
  for (const relative of files(directory)) rows.push([relative.replaceAll('\\', '/'), await hash(path.join(directory, relative))]);
  return { files: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}
function tone(filename, hz) {
  const frames = 48000 * 2;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(7000 * Math.sin(i * Math.PI * 2 * hz / 48000) * Math.min(1, i / 500, (frames - i) / 500)), 44 + i * 2);
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes);
}
function accountDirectory(name) { return path.join(game, 'LocalData', name, '0000'); }
function accountTimes() {
  return Object.fromEntries([oldAccount, newAccount].map(name => [name, fs.statSync(accountDirectory(name), { bigint: true }).mtimeNs.toString()]));
}
const windows = process.env.SystemRoot || 'C:\\Windows';
const env = { ...process.env };
for (const key of Object.keys(env)) if (['path', 'md_player_data', 'md_engine_python', 'pythonhome', 'pythonpath', 'python', 'node_options', 'node_path', 'electron_run_as_node'].includes(key.toLowerCase())) delete env[key];
env.PATH = `${path.join(windows, 'System32')};${windows}`;
env.DOTNET_MULTILEVEL_LOOKUP = '0';

async function launch(directory) {
  portable = directory;
  console.log(`Launching ${path.basename(directory)} with Windows-only PATH…`);
  app = await electron.launch({ executablePath: path.join(portable, 'MD音效播放器.exe'), args: [], env, timeout: 30000 });
  app.process().stderr.on('data', buffer => { if (/Uncaught|Error occurred in handler/.test(buffer.toString())) errors.push(buffer.toString()); });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.md);
  await page.waitForSelector('.app-shell');
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath, userData: app.getPath('userData'), searchPath: process.env.PATH }));
  assert(identity.packaged); assert.equal(identity.searchPath, env.PATH);
  assert(identity.userData.toLowerCase().startsWith(portable.toLowerCase() + path.sep));
  return page;
}
async function close() {
  if (!app) return;
  const closing = app; const child = closing.process();
  const closed = new Promise((resolve, reject) => {
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    if (child.exitCode !== null && [child.stdout, child.stderr].every(stream => !stream || stream.destroyed || stream.readableEnded)) return resolve();
    timer = setTimeout(() => reject(new Error(`Test process ${child.pid} did not exit`)), 15000);
    child.once('close', done);
  });
  await Promise.all([closed, closing.close()]);
  assert.equal(child.exitCode, 0); app = null;
}
async function capture(name) { await page.screenshot({ path: path.join(output, name) }); }
async function snapshot() { return page.evaluate(() => window.md.snapshot()); }
async function pickDirectory(directory) {
  await app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] }); }, directory);
}
async function checkScope(container, expectedMode, expectedPath = game) {
  await container.waitFor({ state: 'visible' });
  assert.equal(await container.getByRole('radio', { name: expectedMode === 'all' ? '扫描全部目录' : '仅扫描最新目录', exact: true }).isChecked(), true);
  const text = await container.innerText();
  assert(text.includes('找到 2 个账号目录'), text);
  assert(text.includes('0000 目录修改时间'), text);
  assert(text.includes(path.join(expectedPath, 'LocalData', newAccount, '0000')), text);
  return container;
}
async function scope(expectedMode, expectedPath = game) {
  return checkScope(page.getByRole('dialog', { name: '选择扫描范围', exact: true }), expectedMode, expectedPath);
}
async function dismiss() { if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape'); }
async function onboard() {
  await pickDirectory(game);
  await page.locator('.browse-installation').click();
  await page.locator('.onboarding .scan-scope').waitFor({ state: 'visible' });
  await page.waitForFunction(directory => document.querySelector('.onboarding-setup')?.textContent?.includes(directory), game);
  return checkScope(page.locator('.onboarding-setup'), 'latest');
}
async function startUI(dialog, name, expectedMode, expectedAccounts, expectedBundles, expectedCalls, buttonName = '开始导入') {
  console.log(`Running ${name} (${expectedMode}) through the visible controls…`);
  const previousJob = (await page.evaluate(() => window.md.importStatus()))?.jobId;
  const started = Date.now();
  await dialog.getByRole('button', { name: buttonName, exact: true }).click();
  let progress;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    progress = await page.evaluate(() => window.md.importStatus());
    if (progress && progress.jobId !== previousJob && ['complete', 'failed', 'cancelled'].includes(progress.stage)) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert(progress && progress.jobId !== previousJob, 'No new import started');
  assert.equal(progress.stage, 'complete', JSON.stringify(progress)); assert.equal(progress.failures, 0, JSON.stringify(progress));
  const imported = JSON.parse(fs.readFileSync(path.join(portable, 'cache/last-import.json'), 'utf8'));
  const scan = JSON.parse(fs.readFileSync(path.join(portable, 'cache/last-scan.json'), 'utf8'));
  assert.equal(imported.scanMode, expectedMode); assert.deepEqual(imported.accounts, expectedAccounts);
  assert.deepEqual(scan.accounts, expectedAccounts); assert.equal(scan.scanMode, expectedMode);
  assert.equal(scan.bundleCount, expectedBundles); assert.equal(imported.bundleCount, expectedBundles);
  assert.equal(imported.uniqueBundleTasks, 1); assert.equal(imported.deduplicatedBundles, expectedBundles - 1);
  assert.equal(imported.extractorCalls, expectedCalls); assert.equal(imported.retries, 0);
  assert.equal(imported.pendingBundleTasks, expectedCalls ? 1 : 0);
  assert.equal(imported.cacheReusedBundles, expectedCalls ? 0 : expectedBundles);
  for (const phase of ['scan', 'fingerprintCache', 'extractDecode', 'actions']) assert(Number.isFinite(imported.phaseSeconds[phase]) && imported.phaseSeconds[phase] >= 0);
  assert.equal((await snapshot()).settings.scanMode, expectedMode);
  report.runs[name] = { elapsedMs: Date.now() - started, progress, scan, imported };
  await dismiss();
  return (await snapshot()).records.filter(record => record.status === 'ready');
}
async function rescan(mode) {
  await dismiss();
  await page.getByRole('button', { name: '导入声音', exact: true }).click();
  return scope(mode);
}
async function settingsRescan(mode) {
  await dismiss();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '扫描更新', exact: true }).click();
  return scope(mode);
}
async function play(record) {
  await page.getByPlaceholder(/搜索/).first().fill(record.title);
  await page.getByRole('button', { name: `播放 ${record.title}`, exact: true }).click();
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > 0.01 && !audio.error; }, null, { timeout: 10000 });
  const result = await page.locator('audio').evaluate(audio => ({ duration: audio.duration, error: audio.error?.code || 0, source: audio.getAttribute('src') }));
  assert(result.duration > 0); assert.equal(result.error, 0);
  await page.locator('audio').evaluate(audio => audio.pause());
  await page.getByPlaceholder(/搜索/).first().fill('');
  return result;
}
function cliImport(label, extraArgs, expectedAccounts, expectedBundles, expectedReady) {
  console.log(`Running ${label} with the packaged engine…`);
  const data = path.join(workspace, label);
  const stdout = execFileSync(path.join(portable, 'resources/vendor/engine/md-engine.exe'), ['import', '--game', game, '--data', data, '--tools', path.join(portable, 'resources/vendor'), ...extraArgs], { env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const events = stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const done = events.findLast(event => event.type === 'done');
  assert(done && done.failures === 0 && !done.cancelled, stdout.slice(-3000));
  const scan = JSON.parse(fs.readFileSync(path.join(data, 'cache/last-scan.json'), 'utf8'));
  const imported = JSON.parse(fs.readFileSync(path.join(data, 'cache/last-import.json'), 'utf8'));
  assert.deepEqual(scan.accounts, expectedAccounts); assert.equal(scan.bundleCount, expectedBundles);
  const ready = new Map(events.filter(event => event.type === 'record' && event.record.status === 'ready').map(event => [event.record.id, event.record]));
  assert.equal(ready.size, expectedReady);
  report.runs[label] = { scan, imported, readyRecords: ready.size };
}

try {
  console.log('Hashing original inputs and preparing independent release / Unity fixture copies…');
  const releaseBefore = await manifest(release); const fixtureBefore = await manifest(fixture);
  const fixtureAccounts = fs.readdirSync(path.join(fixture, 'LocalData')).filter(name => fs.statSync(path.join(fixture, 'LocalData', name, '0000')).isDirectory());
  assert.equal(fixtureAccounts.length, 1, 'Supply the documented one-account real Unity fixture');
  const fixtureAccount = path.join(fixture, 'LocalData', fixtureAccounts[0], '0000');
  fs.mkdirSync(game, { recursive: true }); fs.writeFileSync(path.join(game, 'masterduel.exe'), '');
  for (const account of [oldAccount, newAccount]) fs.cpSync(fixtureAccount, accountDirectory(account), { recursive: true });
  tone(path.join(game, 'masterduel_Data', 'SE_PUBLIC_FIXTURE.wav'), 220);
  tone(path.join(accountDirectory(oldAccount), 'private', 'SE_OLD_ACCOUNT_ONLY.wav'), 330);
  fs.utimesSync(accountDirectory(oldAccount), new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'));
  fs.utimesSync(accountDirectory(newAccount), new Date('2025-02-01T00:00:00Z'), new Date('2025-02-01T00:00:00Z'));
  fs.cpSync(game, changedGame, { recursive: true, preserveTimestamps: true });
  for (const account of [oldAccount, newAccount]) {
    const stat = fs.statSync(accountDirectory(account));
    fs.utimesSync(path.join(changedGame, 'LocalData', account, '0000'), stat.atime, stat.mtime);
  }
  const latestPlayer = path.join(workspace, 'Latest Player'); const allPlayer = path.join(workspace, 'All Player');
  fs.cpSync(release, latestPlayer, { recursive: true }); fs.cpSync(release, allPlayer, { recursive: true });
  report.inputs = { release: releaseBefore, realUnityFixture: fixtureBefore, generatedFixture: await manifest(game) };
  const gameBefore = await manifest(game); const timesBefore = accountTimes();
  await launch(latestPlayer);
  assert.equal((await snapshot()).version, '1.0.1'); assert.equal((await snapshot()).settings.scanMode, 'latest');
  const inspection = await page.evaluate(directory => window.md.inspectInstallation(directory), game);
  assert(inspection.valid); assert.deepEqual(inspection.accounts, [oldAccount, newAccount]); assert.equal(inspection.latestAccount, newAccount);
  assert.equal(inspection.accountDirectories.length, 2);
  for (const entry of inspection.accountDirectories) { assert(Number.isFinite(entry.modifiedAt)); assert.equal(entry.modifiedNs, timesBefore[entry.name]); }
  const newerTime = fs.statSync(accountDirectory(newAccount));
  fs.utimesSync(accountDirectory(newAccount), new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'));
  assert.equal((await page.evaluate(directory => window.md.inspectInstallation(directory), game)).latestAccount, oldAccount);
  fs.utimesSync(accountDirectory(newAccount), newerTime.atime, newerTime.mtime);
  checks.push('Chinese account names and 0000 timestamp ordering/tie-break metadata work; new library defaults to latest');
  let dialog = await onboard(); await capture('01-latest-choice.png');
  assert.equal(await page.evaluate(() => window.md.importStatus()), null);
  let ready = await startUI(dialog, 'latestCold', 'latest', [newAccount], 1, 1, '创建我的声音资料库');
  assert.equal(ready.length, 2); assert(ready.some(record => record.originalName === 'SE_PUBLIC_FIXTURE'));
  assert(!ready.some(record => record.originalName === 'SE_OLD_ACCOUNT_ONLY'));
  const unity = ready.find(record => record.originalName === 'SE_M04041_b'); assert(unity); assert.equal(unity.sourceCount, 1);
  report.realUnityPlayback = await play(unity);
  const latestIndex = JSON.parse(fs.readFileSync(path.join(latestPlayer, 'cache/source-index.json'), 'utf8'));
  assert(Object.keys(latestIndex).every(name => !name.includes(`LocalData/${oldAccount}/`)));
  const finishedJob = (await page.evaluate(() => window.md.importStatus())).jobId;
  dialog = await rescan('latest');
  await dialog.getByRole('radio', { name: '扫描全部目录', exact: true }).check();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await snapshot()).settings.scanMode, 'latest');
  assert.equal((await page.evaluate(() => window.md.importStatus())).jobId, finishedJob);
  ready = await startUI(await rescan('latest'), 'latestWarm', 'latest', [newAccount], 1, 0);
  assert.equal(ready.length, 2);
  checks.push('Onboarding range controls precede import; cancelled rescan changes no job or saved mode; cold latest imports public + selected real Unity, warm latest invokes no extractor');
  await close();

  await launch(allPlayer); dialog = await onboard();
  await dialog.getByRole('radio', { name: '扫描全部目录', exact: true }).check();
  assert.equal((await snapshot()).settings.scanMode, 'latest');
  await capture('02-all-choice.png');
  ready = await startUI(dialog, 'allCold', 'all', [oldAccount, newAccount], 2, 1, '创建我的声音资料库');
  assert.equal(ready.length, 3);
  const allUnity = ready.find(record => record.id === unity.id); assert(allUnity); assert.equal(allUnity.sourceCount, 2);
  const oldOnly = ready.find(record => record.originalName === 'SE_OLD_ACCOUNT_ONLY'); assert(oldOnly);
  await page.evaluate(async ids => { for (const id of ids) await window.md.edit([id], { title: `保留标注 ${id.slice(0, 8)}`, category: ['自定义', '测试'], tags: ['保留'], favorite: true }); }, [allUnity.id, oldOnly.id]);
  const metadataBefore = (await snapshot()).records.filter(record => record.status === 'ready');
  ready = await startUI(await rescan('all'), 'allWarm', 'all', [oldAccount, newAccount], 2, 0);
  assert.equal(ready.length, 3);
  dialog = await settingsRescan('all');
  await dialog.getByRole('radio', { name: '仅扫描最新目录', exact: true }).check();
  ready = await startUI(dialog, 'allThenLatest', 'latest', [newAccount], 1, 0);
  for (const before of metadataBefore) {
    const after = ready.find(record => record.id === before.id); assert(after, `Lost ${before.id}`);
    for (const key of ['id', 'mediaId', 'title', 'category', 'tags', 'favorite', 'sourceCount', 'importedAt']) assert.deepEqual(after[key], before[key], `${before.originalName}: ${key}`);
  }
  checks.push('Cold all extracts two identical bundles once and merges both sources; all warm is cached; all→latest retains ids, media, source history, title, categories, tags and favorites');
  await close(); await launch(allPlayer);
  assert.equal((await snapshot()).settings.scanMode, 'latest');
  dialog = await settingsRescan('latest'); await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await pickDirectory(changedGame); await page.getByRole('button', { name: '更换目录', exact: true }).click();
  dialog = await scope('latest', changedGame);
  assert.equal((await snapshot()).settings.gamePath, game);
  await capture('03-change-directory-choice.png');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await snapshot()).settings.gamePath, game);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '更换目录', exact: true }).click();
  ready = await startUI(await scope('latest', changedGame), 'changedDirectory', 'latest', [newAccount], 1, 0);
  assert.equal((await snapshot()).settings.gamePath, changedGame); assert.equal(ready.length, 3);
  assert.equal(ready.find(record => record.id === oldOnly.id).favorite, true);
  checks.push('Restart remembers latest; settings rescan and changing game both show range dialog; cancelled change keeps old path; confirmed change preserves annotations');
  await capture('04-preserved-library.png');
  await close();
  cliImport('explicitEmptyAccounts', ['--scan-mode', 'all', '--accounts-json', '[]'], [], 0, 1);
  assert.equal(report.runs.explicitEmptyAccounts.imported.extractorCalls, 0);
  cliImport('legacyCLI', [], [oldAccount, newAccount], 2, 3);
  assert.equal(report.runs.legacyCLI.imported.scanMode, 'all'); assert.equal(report.runs.legacyCLI.imported.extractorCalls, 1);
  checks.push('Bundled CLI explicit [] scans only public assets; omitted scan mode remains all for script compatibility');
  assert.deepEqual(await manifest(game), gameBefore); assert.deepEqual(accountTimes(), timesBefore);
  assert.deepEqual(await manifest(fixture), fixtureBefore); assert.deepEqual(await manifest(release), releaseBefore);
  assert.deepEqual(errors, []);
  checks.push('Original release and original Unity fixture are unchanged; generated game content and 0000 directory mtimes remain unchanged after imports');
  report.passed = true;
  console.log(JSON.stringify({ passed: true, checks, report: path.join(output, 'report.json') }, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  if (app) { try { await capture('failure.png'); } catch (captureError) { report.captureError = String(captureError); } }
  throw error;
} finally {
  if (app) { try { await close(); } catch (error) { report.shutdownError = String(error); } }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
