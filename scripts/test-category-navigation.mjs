// Isolated UI regression; never scans, plays audio, or writes to a supplied app/database.
// node scripts/test-category-navigation.mjs [--app <app-root-or-portable-exe>] [--db <library.sqlite>] [--renderer <candidate.js>]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { _electron as electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  assert(['--app', '--db', '--renderer'].includes(key) && process.argv[i + 1], 'Invalid option or missing value');
  options[key.slice(2)] = path.resolve(process.argv[i + 1]);
}
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, '.cache', 'category-navigation-regression-'));
const suppliedExecutable = !!options.app && options.app.toLowerCase().endsWith('.exe');
const sourceApp = suppliedExecutable ? path.dirname(options.app) : options.app || root;
const executable = suppliedExecutable ? path.basename(options.app) : 'MD音效播放器.exe';
const packaged = !!options.app && fs.existsSync(path.join(sourceApp, executable));
const testedApp = path.join(directory, 'app');
const dataRoot = packaged ? testedApp : path.join(directory, 'Player');
fs.mkdirSync(testedApp, { recursive: true });
fs.mkdirSync(path.join(dataRoot, 'data'), { recursive: true });
const digest = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const trackedFiles = [];
function copyAppPart(relative) {
  const source = path.join(sourceApp, relative);
  const files = fs.statSync(source).isDirectory() ? fs.readdirSync(source, { recursive: true }).map(file => path.join(relative, file)) : [relative];
  for (const file of files) if (fs.statSync(path.join(sourceApp, file)).isFile()) trackedFiles.push({ file: path.join(sourceApp, file), sha256: digest(path.join(sourceApp, file)) });
  fs.cpSync(source, path.join(testedApp, relative), { recursive: true });
}
if (packaged) {
  for (const relative of fs.readdirSync(sourceApp)) {
    if (['data', 'assets', 'exports', 'backups', '.cache'].includes(relative.toLowerCase())) continue;
    copyAppPart(relative);
  }
} else {
  copyAppPart('package.json');
  copyAppPart('dist');
}
let rendererSha256 = null;
if (options.renderer) {
  const assets = path.join(testedApp, ...(packaged ? ['resources', 'app'] : []), 'dist', 'renderer', 'assets');
  const scripts = fs.readdirSync(assets).filter(file => /^index-.*\.js$/.test(file));
  assert.equal(scripts.length, 1, 'Expected one renderer entry bundle');
  rendererSha256 = digest(options.renderer);
  fs.copyFileSync(options.renderer, path.join(assets, scripts[0]));
  assert.equal(digest(path.join(assets, scripts[0])), rendererSha256);
}
const sourceDbFiles = options.db ? [options.db, options.db + '-wal', options.db + '-shm'].map(file => ({ file, sha256: digest(file) })) : [];
const database = path.join(dataRoot, 'data', 'library.sqlite');
if (options.db) {
  const original = new DatabaseSync(options.db, { readOnly: true });
  try { await backup(original, database); } finally { original.close(); }
} else {
  const fixture = new DatabaseSync(database);
  fixture.exec('CREATE TABLE records(id TEXT PRIMARY KEY, generated TEXT NOT NULL, imported_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  fixture.prepare('INSERT INTO settings VALUES(?,?)').run('preferences', JSON.stringify({ onboardingComplete: true }));
  const samples = [
    { id: 'draw', title: '抽卡音效', originalName: 'SE_DRAW', category: ['决斗音效', '抽卡'], tags: ['决斗音效', '抽卡', '导航抽卡'], kind: 'sfx' },
    { id: 'summon', title: '召唤音效', originalName: 'SE_SUMMON', category: ['决斗音效', '召唤'], tags: ['决斗音效', '召唤', '导航召唤'], kind: 'sfx' },
    { id: 'tutorial', title: '教程音乐', originalName: 'BGM_TUTORIAL', category: ['背景音乐', '教程'], tags: ['背景音乐', '教程', '导航音乐'], kind: 'music' },
  ];
  for (const sample of samples) fixture.prepare('INSERT INTO records VALUES(?,?,?)').run(sample.id, JSON.stringify({ ...sample, mediaId: null, form: '独立片段', duration: 1, sampleRate: 48000, channels: 2, peaks: [0.1, 0.3], status: 'ready', description: 'Isolated navigation fixture', relativePath: null, bytes: 0, sources: [] }), '2026-01-01T00:00:00.000Z');
  fixture.close();
}
function storedIdentity() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    return {
      records: db.prepare('SELECT id,generated,imported_at FROM records ORDER BY id').all(),
      media: tables.has('media') ? db.prepare('SELECT * FROM media ORDER BY id').all() : [],
      overrides: tables.has('overrides') ? db.prepare('SELECT * FROM overrides ORDER BY id').all() : [],
    };
  } finally { db.close(); }
}
const databaseIdentityBefore = storedIdentity();
const checks = []; const errors = []; const audioRequests = []; let app;
const reportFile = path.join(directory, 'report.json');
let report = { passed: false, sourceApp, packaged, sourceDatabase: options.db || null, candidateRenderer: options.renderer || null, rendererSha256, testedApp, temporaryDataRoot: dataRoot, checks, errors };
try {
  const launchOptions = packaged ? { executablePath: path.join(testedApp, executable), args: [] } : { args: [testedApp] };
  app = await electron.launch({ ...launchOptions, cwd: testedApp, env: { ...process.env, MD_PLAYER_DATA: dataRoot }, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().startsWith('md-audio:')) audioRequests.push(request.url()); });
  await page.waitForFunction(() => !!window.md);
  const snapshot = await page.evaluate(() => window.md.snapshot());
  const importBefore = await page.evaluate(() => window.md.importStatus());
  const ready = snapshot.records.filter(record => record.status === 'ready');
  const category = ['决斗音效'];
  const matches = (record, parts) => parts.every((part, index) => record.category[index] === part);
  const categoryRecords = ready.filter(record => matches(record, category));
  const expected = categoryRecords.length;
  assert(expected >= 2);
  const search = page.getByRole('searchbox', { name: '搜索声音' });
  const facetPanel = page.getByRole('region', { name: '标签筛选', exact: true });
  const tagButton = ({ group, value }) => page.locator(`button[data-facet-group=${JSON.stringify(group)}][data-facet-value=${JSON.stringify(value)}]`);
  const revealTags = async () => { const expand = page.getByRole('button', { name: '展开其他标签', exact: true }); if (await expand.count()) await expand.click(); };
  const tagSearch = group => page.getByRole('combobox', { name: group === 'cardName' ? '查找卡名标签' : '查找其他标签', exact: true });
  const selectTag = async candidate => { await revealTags(); await tagSearch(candidate.group).fill(candidate.value); await tagButton(candidate).click(); await page.keyboard.press('Escape'); };
  const button = parts => page.locator('button.category-select').filter({ has: page.getByTitle(parts.join(' / '), { exact: true }) });
  const waitRows = async count => page.waitForFunction(count => document.querySelector('[role="table"][aria-label="音频资料库"]')?.getAttribute('aria-rowcount') === String(count + 1), count);
  const restoreCategory = async name => {
    await button(category).click(); await waitRows(expected);
    assert.equal(await search.inputValue(), ''); assert.equal(await facetPanel.locator('[aria-pressed="true"]').count(), 0); assert.equal(await page.locator('.facet-active-filter').count(), 0);
    assert.equal(await page.getByRole('combobox', { name: '音效形式', exact: true }).inputValue(), '');
    const types = page.getByRole('combobox', { name: '种类', exact: true }); if (await types.count()) assert.equal(await types.inputValue(), '');
    assert(await page.locator('.track-row').first().isVisible());
    checks.push({ name, displayed: expected });
  };
  await search.waitFor();
  await revealTags();
  assert((await page.locator('button[data-facet-group="other"]').count()) > 0, 'Focusing other-tag lookup shows existing candidates');
  const cardNames = new Set(ready.flatMap(record => record.cardNameTags || []));
  const candidateTags = [...new Set(ready.flatMap(record => [...record.tags, ...(record.cardNameTags || [])]))].filter(tag => /[^\x00-\x7f]/.test(tag)).sort((a, b) => a.localeCompare(b, 'zh-CN')).map(value => ({ group: cardNames.has(value) ? 'cardName' : 'other', value }));
  const hasTag = (record, candidate) => candidate.group === 'cardName' ? (record.cardNameTags || []).includes(candidate.value) || record.tags.includes(candidate.value) : record.tags.includes(candidate.value);
  const findAvailable = async predicate => {
    for (const candidate of candidateTags.filter(predicate)) {
      const lookup = tagSearch(candidate.group);
      if (!(await lookup.count())) continue;
      await lookup.fill(candidate.value);
      if (await tagButton(candidate).count()) return candidate;
    }
    return undefined;
  };
  const incompatible = await findAvailable(candidate => !categoryRecords.some(record => hasTag(record, candidate)));
  const compatible = await findAvailable(candidate => { const count = categoryRecords.filter(record => hasTag(record, candidate)).length; return count > 0 && count < expected; });
  assert(incompatible && compatible);
  for (const mode of ['search', 'tag', 'both']) {
    await page.getByRole('button', { name: /^所有声音/ }).click();
    await revealTags();
    if (mode !== 'search') await selectTag(incompatible);
    if (mode !== 'tag') await search.fill('__category_regression_no_match__');
    await restoreCategory(`${mode} filter is cleared when navigating to a category`);
  }
  await page.screenshot({ path: path.join(directory, '01-category-restored.png') });
  const query = categoryRecords[0].originalName;
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const queryExpected = categoryRecords.filter(record => { const text = [record.title, record.originalName, record.description, ...record.category, ...record.tags].join(' ').toLocaleLowerCase(); return terms.every(term => text.includes(term)); }).length;
  assert(queryExpected > 0 && queryExpected < expected);
  await search.fill(query); await waitRows(queryExpected);
  checks.push({ name: 'Searching within a selected category still filters records', query, displayed: queryExpected });
  await restoreCategory('Clicking the currently selected category clears search and restores its contents');
  await selectTag(compatible);
  const tagExpected = categoryRecords.filter(record => hasTag(record, compatible)).length;
  await waitRows(tagExpected);
  checks.push({ name: 'Selecting a tag within a category still filters records', tag: compatible, displayed: tagExpected });
  await restoreCategory('Clicking the currently selected category clears tag and restores its contents');
  await selectTag(compatible); await search.fill('__category_regression_no_match__'); await waitRows(0);
  await restoreCategory('Clicking the currently selected category clears both filters');
  const scroll = page.locator('.virtual-scroll');
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const bottom = await scroll.evaluate(element => ({ height: element.clientHeight, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight }));
  if (bottom.scrollHeight > bottom.height) {
    await page.waitForFunction(() => Number(document.querySelector('.track-row')?.getAttribute('aria-rowindex')) > 2);
    checks.push({ name: 'Large category renders rows after scrolling to bottom', ...bottom });
  }
  const small = snapshot.categories.find(parts => parts.length > 1 && ready.filter(record => matches(record, parts)).length === 1);
  assert(small);
  await button(small).click(); await waitRows(1);
  await page.waitForFunction(() => document.querySelector('.virtual-scroll')?.scrollTop === 0 && document.querySelectorAll('.track-row').length === 1);
  assert(await page.locator('.track-row').first().isVisible());
  checks.push({ name: 'Changing to a single-record category resets virtual scrolling and displays its row', category: small, displayed: 1 });
  await page.screenshot({ path: path.join(directory, '02-single-record-category.png') });
  assert.deepEqual(await page.evaluate(() => window.md.importStatus()), importBefore);
  assert.deepEqual(audioRequests, []);
  assert.equal(await page.locator('audio').evaluateAll(audios => audios.some(audio => !audio.paused)), false);
  assert.deepEqual(errors, []);
  await app.close(); app = null;
  assert.deepEqual(storedIdentity(), databaseIdentityBefore, 'Opening and filtering the existing library must not rewrite generated records, audio identities, or personal overrides');
  assert(trackedFiles.every(item => digest(item.file) === item.sha256));
  assert(sourceDbFiles.every(item => digest(item.file) === item.sha256));
  report = { ...report, passed: true, testedVersion: snapshot.version, snapshotRecords: snapshot.records.length, readyRecords: ready.length, sourceDatabaseUnchanged: true, sourceApplicationUnchanged: true, storedRecordsAndPersonalDataUnchanged: true, audioPlayed: false, importStarted: false };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
} catch (error) {
  report.error = String(error); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ reportFile, error: String(error) })); throw error;
} finally { if (app) await app.close(); }
