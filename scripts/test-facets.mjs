/**
 * End-to-end grouped filtering regression, using an isolated legacy-schema database.
 * node scripts/test-facets.mjs [--app <portable-directory-or-exe>]
 * Metadata identities come from the shipped mapping; all audio is a generated tone.
 * Both development and portable applications run on copies under .cache. No game,
 * user database, or source application is modified, and no import is started.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  assert(process.argv[index] === '--app' && process.argv[index + 1], 'Usage: node scripts/test-facets.mjs [--app <portable-directory-or-exe>]');
  options.app = path.resolve(process.argv[index + 1]);
}
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, '.cache', 'facets-regression-'));
const testedApp = path.join(directory, 'App');
const suppliedExecutable = !!options.app && options.app.toLowerCase().endsWith('.exe');
const sourceApp = options.app ? (suppliedExecutable ? path.dirname(options.app) : options.app) : root;
const executable = suppliedExecutable ? path.basename(options.app) : 'MD音效播放器.exe';
const packaged = !!options.app && fs.existsSync(path.join(sourceApp, executable));
const dataRoot = packaged ? testedApp : path.join(directory, 'Player');
const checks = []; const errors = []; const audioRequests = []; const inputs = [];
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reportFile = path.join(directory, 'report.json');
let app; let page;
let report = { passed: false, sourceApp, testedApp, packaged, temporaryDataRoot: dataRoot, checks, errors };

function copyFileTree(source, destination) {
  assert(!fs.lstatSync(source).isSymbolicLink(), 'Test application must not contain symbolic links');
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) copyFileTree(path.join(source, entry), path.join(destination, entry));
  } else {
    inputs.push({ file: source, digest: sha256(source) });
    fs.copyFileSync(source, destination);
  }
}
fs.mkdirSync(testedApp, { recursive: true });
if (packaged) {
  for (const entry of fs.readdirSync(sourceApp)) {
    // These locations may contain personal files in an existing portable app.
    if (['data', 'assets', 'exports', 'backups', '.cache'].includes(entry.toLowerCase())) continue;
    copyFileTree(path.join(sourceApp, entry), path.join(testedApp, entry));
  }
} else {
  copyFileTree(path.join(sourceApp, 'package.json'), path.join(testedApp, 'package.json'));
  copyFileTree(path.join(sourceApp, 'dist'), path.join(testedApp, 'dist'));
}
fs.mkdirSync(path.join(dataRoot, 'data'), { recursive: true });
fs.mkdirSync(path.join(dataRoot, 'assets', 'audio'), { recursive: true });

function tone() {
  const frames = 48000 * 30;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) wav.writeInt16LE(Math.round(1200 * Math.sin(frame * Math.PI * 2 * 330 / 48000)), 44 + frame * 2);
  return wav;
}
const wav = tone();
const mediaId = createHash('sha256').update(wav).digest('hex');
const relativePath = `assets/audio/${mediaId}.wav`;
fs.writeFileSync(path.join(dataRoot, relativePath), wav);
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'facet-metadata.json'), 'utf8'));
const fixtures = [];
function addRecord(partial, expectedFacets, expectedCardNames = []) {
  const record = { mediaId, form: '独立片段', category: ['筛选测试', '资源'], tags: ['个人高光'], kind: 'sfx', duration: 30,
    sampleRate: 48000, channels: 1, peaks: [0.1, 0.3, 0.2], status: 'ready', description: 'Generated tone for filtering regression only',
    relativePath, bytes: wav.length, sources: [], ...partial };
  record.tags = [...new Set(record.tags)];
  fixtures.push({ record, expectedFacets, expectedCardNames });
}
const representedProfiles = new Set();
for (const [key, profile] of Object.entries(metadata.resources)) {
  const corrected = Object.hasOwn(metadata.resourceDefaults, key);
  // Profile deduplication must not drop either flip-completion branch or any
  // of the four draw identities covered by read-time default corrections.
  if (representedProfiles.has(profile) && !corrected) continue;
  representedProfiles.add(profile);
  const split = key.lastIndexOf(':'); const originalName = key.slice(0, split); const payloadHash = key.slice(split + 1);
  addRecord({ id: corrected ? `fixture_corrected_${originalName}` : `fixture_resource_${profile}`, title: `资源 ${String(profile).padStart(3, '0')}`, originalName,
    tags: ['个人高光', originalName, '11422', ...Object.values(metadata.profiles[profile].purposes).flat()],
    sources: [{ key: `fixture-${profile}`, bundle: 'synthetic-metadata-only', account: 'fixture', payloadHash }] }, metadata.profiles[profile]);
}
for (const [id, action] of Object.entries(metadata.actions)) {
  addRecord({ id, title: `动作 ${action.name}`, originalName: action.name, form: action.form, category: ['筛选测试', '动作'],
    tags: ['个人动作', '链接召唤', action.name, 'SummonLinkTL'] }, metadata.profiles[action.profile]);
}
// Enough existing personal tags to exercise the full independently scrolling list.
fixtures[0].record.tags.push(...Array.from({ length: 36 }, (_, index) => `备用标签${String(index + 1).padStart(2, '0')}`));
const cardNames = Array.from({ length: 36 }, (_, index) => `合成卡片${String(index + 1).padStart(2, '0')}`);
for (let index = 0; index < 37; index++) {
  const name = cardNames[index % 36];
  const originalName = index % 2 || index === 36 ? 'SE_MONSTER_CUTIN_LIGHT' : 'SE_MONSTER_CUTIN_DARK';
  const [key, profile] = Object.entries(metadata.resources).find(([key]) => key.startsWith(`${originalName}:`));
  const payloadHash = key.slice(key.lastIndexOf(':') + 1);
  addRecord({ id: `event_card_cutin_attribute_${900001 + index}`, title: `${name} · 切入音层`, originalName,
    category: ['决斗音效', '卡片切入', '按卡名'], tags: [name, '个人卡名', originalName],
    sources: [{ key: `card-${index}`, bundle: 'synthetic-card-metadata-only', account: 'fixture', payloadHash }] }, metadata.profiles[profile], [name]);
}
addRecord({ id: 'fixture_unknown', title: '未知资源：错误载荷', originalName: 'SE_ATTACK_A_LIGHT_DEFAULT_01', category: ['筛选测试', '未知'],
  tags: ['个人未知', '11422', 'SE_ATTACK_A_LIGHT_DEFAULT_01'], sources: [{ key: 'unknown', bundle: 'synthetic', account: 'fixture', payloadHash: 'f'.repeat(64) }] });
addRecord({ id: 'fixture_music', title: '音乐测试', originalName: 'BGM_FIXTURE', kind: 'music', category: ['音乐测试'], tags: ['个人高光', '音乐专用'] });
addRecord({ id: 'fixture_voice', title: '语音测试', originalName: 'VOICE_FIXTURE', kind: 'voice', category: ['语音测试'], tags: ['语音专用'] });
const correctedFixtures = fixtures.filter(entry => entry.record.id.startsWith('fixture_corrected_'));
assert.deepEqual(correctedFixtures.map(entry => entry.record.originalName).sort(), ['SE_CARD_DRAW_01', 'SE_CARD_DRAW_02', 'SE_CARD_DRAW_03', 'SE_CARD_DRAW_04', 'SE_DISP_ATTACK', 'SE_DISP_DEFENS']);
const personalOverrides = new Map([
  [fixtures[0].record.id, { favorite: true }],
  ['fixture_corrected_SE_CARD_DRAW_02', { title: '我的抽卡名字', category: ['个人分类', '抽卡收藏'], tags: ['我的收藏'], favorite: true }],
]);
// The expected display model is independent of the application decoder: apply
// only exact table defaults, then the explicitly seeded personal override.
function displayRecord(entry) {
  const record = entry.record;
  const payloads = [...new Set(record.sources.map(source => source.payloadHash))];
  const defaults = payloads.length === 1 ? metadata.resourceDefaults[`${record.originalName}:${payloads[0]}`] : undefined;
  return { ...record, favorite: false, ...defaults, ...personalOverrides.get(record.id) };
}
const database = path.join(dataRoot, 'data', 'library.sqlite');
const fixtureDb = new DatabaseSync(database);
fixtureDb.exec('CREATE TABLE records(id TEXT PRIMARY KEY,generated TEXT NOT NULL,imported_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE media(id TEXT PRIMARY KEY,path TEXT NOT NULL,bytes INTEGER NOT NULL); CREATE TABLE sources(record_id TEXT NOT NULL,key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(record_id,key)); CREATE TABLE overrides(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
fixtureDb.prepare('INSERT INTO settings VALUES(?,?)').run('preferences', JSON.stringify({ onboardingComplete: true, volume: 0 }));
fixtureDb.prepare('INSERT INTO media VALUES(?,?,?)').run(mediaId, relativePath, wav.length);
for (const { record } of fixtures) {
  fixtureDb.prepare('INSERT INTO records VALUES(?,?,?)').run(record.id, JSON.stringify(record), '2026-01-01T00:00:00.000Z');
  for (const source of record.sources) fixtureDb.prepare('INSERT INTO sources VALUES(?,?,?)').run(record.id, source.key, JSON.stringify(source));
}
for (const [id, override] of personalOverrides) fixtureDb.prepare('INSERT INTO overrides VALUES(?,?)').run(id, JSON.stringify(override));
fixtureDb.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
const completedJob = { jobId: 'fixture-completed-import', stage: 'complete', message: 'Existing fixture import report', current: fixtures.length, total: fixtures.length, imported: fixtures.length, duplicates: 0, failures: 0 };
fixtureDb.prepare('INSERT INTO jobs VALUES(?,?)').run(completedJob.jobId, JSON.stringify(completedJob));
fixtureDb.close();

// Expected results use direct set membership, independently of the renderer's evaluator.
const values = (entry, group) => group === 'purpose' ? [...new Set(Object.values(entry.expectedFacets?.purposes || {}).flat())] : entry.expectedFacets?.[group] || [];
const count = predicate => fixtures.filter(predicate).length;
const has = (entry, group, value) => values(entry, group).includes(value);
const fullWidth = value => value.replace(/[!-~]/g, character => String.fromCharCode(character.charCodeAt(0) + 0xfee0));
const tag = (group, value) => page.locator(`button[data-facet-group=${JSON.stringify(group)}][data-facet-value=${JSON.stringify(value)}]`);
const displayedCount = async (group, value) => Number((await tag(group, value).locator('.facet-count').innerText()).replaceAll(',', ''));
const waitRows = async expected => page.waitForFunction(expected => document.querySelector('[role="table"][aria-label="音频资料库"]')?.getAttribute('aria-rowcount') === String(expected + 1), expected);
async function reset() { const button = page.getByRole('button', { name: '清除筛选', exact: true }); if (await button.count()) await button.click(); }
async function all() { await reset(); await page.getByRole('button', { name: /^所有声音/ }).click(); await waitRows(fixtures.length); }
async function capture(name) {
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
}
async function verifyCompositionKeys(lookup, value, expected) {
  await lookup.fill(''); await page.keyboard.press('Escape'); await lookup.click();
  const dispatch = async (key, composition) => lookup.evaluate((element, { key, composition }) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...composition }));
  }, { key, composition });
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await dispatch('ArrowDown', composition);
    assert.equal(await lookup.getAttribute('aria-activedescendant'), null, 'IME composition must not move candidate focus');
  }
  await lookup.fill(value); await page.keyboard.press('ArrowDown');
  assert(await lookup.getAttribute('aria-activedescendant'), 'Ordinary arrows navigate lookup candidates');
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await dispatch('Enter', composition); await waitRows(fixtures.length);
    assert.equal(await page.locator('.facet-active-filter').count(), 0, 'IME confirmation must not select a filter');
  }
  await page.keyboard.press('Enter'); await waitRows(expected);
  assert(await lookup.evaluate(element => element === document.activeElement), 'Keyboard selection keeps the lookup input focused');
  await page.keyboard.press('Enter'); await waitRows(fixtures.length);
  checks.push(`Chinese input composition and legacy keyCode 229 leave ${value} lookup unselected; ordinary ArrowDown/Enter still select and deselect`);
}
async function close() {
  if (!app) return;
  const child = app.process(); const currentApp = app; app = null;
  await currentApp.close();
  if (child.exitCode === null && child.signalCode === null) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Test process ${child.pid} failed to exit`)), 10000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

try {
  const launchOptions = packaged ? { executablePath: path.join(testedApp, executable), args: [] } : { args: [testedApp] };
  app = await electron.launch({ ...launchOptions, cwd: testedApp, env: { ...process.env, MD_PLAYER_DATA: dataRoot }, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().startsWith('md-audio:')) audioRequests.push(request.url()); });
  await page.waitForFunction(() => !!window.md);
  await waitRows(fixtures.length);
  const snapshot = await page.evaluate(() => window.md.snapshot());
  const importBefore = await page.evaluate(() => window.md.importStatus());
  assert.equal(snapshot.records.length, fixtures.length);
  for (const entry of fixtures) {
    const { record, expectedFacets, expectedCardNames } = entry;
    const expected = displayRecord(entry);
    const actual = snapshot.records.find(item => item.id === record.id);
    assert(actual, `Missing existing record ${record.id}`);
    for (const field of ['id', 'originalName', 'title', 'category', 'tags', 'description', 'mediaId', 'kind', 'form', 'duration', 'sampleRate', 'channels', 'status', 'favorite']) {
      assert.deepEqual(actual[field], expected[field], `Display defaults, personal override and identity: ${record.id}.${field}`);
    }
    if (expectedFacets) assert.deepEqual(actual.facets, expectedFacets, `Precise metadata match for ${record.id}`);
    assert.deepEqual(actual.cardNameTags || [], expectedCardNames, `Explicit existing card-name evidence for ${record.id}`);
  }
  assert.equal(snapshot.records.find(record => record.id === fixtures[0].record.id).favorite, true);
  const unknown = snapshot.records.find(record => record.id === 'fixture_unknown');
  assert(unknown.facets.confirmation.includes('待确认'));
  assert.deepEqual(unknown.facets.attribute, []); assert.deepEqual(unknown.facets.cardType, []);
  checks.push('Legacy schema receives exact resource/action facets and six reviewed display corrections without import; all identities/media stay fixed and personal title/category/tags/favorite overrides retain priority');

  const search = page.getByRole('searchbox', { name: '搜索声音', exact: true });
  const forms = page.getByRole('combobox', { name: '音效形式', exact: true });
  const types = page.getByRole('combobox', { name: '种类', exact: true });
  assert.equal(await types.locator('option').count(), 10);
  assert.deepEqual(await forms.locator('option').allTextContents(), ['全部形式', '完整音效', '片段', '碎片片段']);
  await types.selectOption('召唤方式');
  await waitRows(count(entry => entry.expectedFacets?.types.includes('召唤方式')));
  for (const entry of correctedFixtures.filter(entry => entry.record.originalName.includes('CARD_DRAW'))) {
    await search.fill(entry.record.originalName); await waitRows(0);
  }
  await search.fill('');
  await tag('summon', '反转召唤／翻转').click();
  await waitRows(2);
  for (const entry of correctedFixtures.filter(entry => entry.record.originalName.startsWith('SE_DISP_'))) {
    await search.fill(entry.record.originalName); await waitRows(1);
    assert.equal(await page.getByRole('checkbox', { name: `选择 ${displayRecord(entry).title}`, exact: true }).count(), 1);
  }
  for (const entry of correctedFixtures.filter(entry => entry.record.originalName.includes('CARD_DRAW'))) {
    await search.fill(entry.record.originalName); await waitRows(0);
  }
  await all();
  checks.push('All four CARD_DRAW identities are absent from summon type/filter results; both SE_DISP_ATTACK and SE_DISP_DEFENS are independently discoverable under reverse summon / flip');
  const cardSearch = page.getByRole('combobox', { name: '查找卡名标签', exact: true });
  const cardPopup = page.getByRole('listbox', { name: '卡名候选', exact: true });
  assert.equal(await cardPopup.count(), 0);
  await cardSearch.focus();
  assert.equal(await page.locator('button[data-facet-group="cardName"]').count(), 36);
  assert.equal(await displayedCount('cardName', cardNames[0]), 2, 'Shared card names count records once each');
  await cardSearch.fill('合成卡片0');
  assert.equal(await page.locator('button[data-facet-group="cardName"]').count(), 9);
  await cardSearch.fill('合成卡片01');
  assert.equal(await page.locator('button[data-facet-group="cardName"]').count(), 1);
  await page.getByRole('button', { name: '清除卡名查找', exact: true }).click();
  assert.equal(await cardSearch.inputValue(), '');
  assert.equal(await page.locator('button[data-facet-group="cardName"]').count(), 36);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1480, 940));
  await page.waitForFunction(() => innerWidth === 1480 && innerHeight === 940);
  await capture('card-name-lookup-1480x940');
  await cardPopup.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await tag('cardName', cardNames[35]).click(); await waitRows(1);
  await page.keyboard.press('Escape'); assert.equal(await cardPopup.count(), 0);
  assert.equal(await page.getByRole('button', { name: `移除筛选：卡名标签筛选：${cardNames[35]}`, exact: true }).count(), 1);
  await cardSearch.click(); await search.focus(); assert.equal(await cardPopup.count(), 0);
  await waitRows(1);
  await cardSearch.click(); await tag('cardName', cardNames[35]).click(); await waitRows(fixtures.length);
  await verifyCompositionKeys(cardSearch, cardNames[0], 2);
  await page.getByRole('button', { name: '清除卡名查找', exact: true }).click();
  await tag('cardName', cardNames[0]).click(); await waitRows(2);
  await tag('cardName', cardNames[1]).click(); await waitRows(3);
  await page.keyboard.press('Escape');
  await tag('attribute', '暗').click(); await waitRows(1);
  await cardSearch.focus();
  assert.equal(await displayedCount('cardName', cardNames[0]), 1);
  assert.equal(await displayedCount('cardName', cardNames[1]), 0);
  assert.equal(await tag('cardName', cardNames[1]).isDisabled(), false);
  await tag('cardName', cardNames[1]).click(); await waitRows(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '清空属性标签', exact: true }).click(); await waitRows(2);
  await page.getByRole('button', { name: `移除筛选：卡名标签筛选：${cardNames[0]}`, exact: true }).click(); await waitRows(fixtures.length);
  checks.push('Dedicated card-name lookup opens all 36 names on focus, progressively narrows, clears back to all, scrolls beyond 30, preserves selection on Escape/blur, supports OR/AND and reversible zero-count selections');
  assert.equal(await page.locator('button[data-facet-group="other"]').count(), 0);
  await page.getByRole('button', { name: '展开其他标签', exact: true }).click();
  const tagSearch = page.getByRole('combobox', { name: '查找其他标签', exact: true });
  const otherPopup = page.getByRole('listbox', { name: '其他标签候选', exact: true });
  const allOtherCount = await page.locator('button[data-facet-group="other"]').count();
  assert(allOtherCount > 36, 'Focusing an empty other-tag lookup shows all available personal labels');
  assert.equal(await cardPopup.count(), 0, 'The two inputs show separate candidate lists');
  for (const value of ['11422', fixtures[0].record.originalName, 'SummonLinkTL', '攻击', ...cardNames]) {
    await tagSearch.fill(value);
    assert.equal(await tag('other', value).count(), 0, `Internal, grouped or dedicated card-name tag must stay out of other suggestions: ${value}`);
  }
  await verifyCompositionKeys(tagSearch, '个人高光', count(entry => displayRecord(entry).tags.includes('个人高光')));
  await tagSearch.fill('备用标签');
  assert.equal(await page.locator('button[data-facet-group="other"]').count(), 36, 'The candidate list must not truncate results at 30');
  await tagSearch.fill('备用标签0'); assert.equal(await page.locator('button[data-facet-group="other"]').count(), 9);
  await page.getByRole('button', { name: '清除标签查找', exact: true }).click();
  assert.equal(await page.locator('button[data-facet-group="other"]').count(), allOtherCount);
  await tagSearch.fill('备用标签');
  await capture('other-tag-lookup-1480x940');
  await otherPopup.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await tag('other', '备用标签36').click(); await waitRows(1);
  await tagSearch.fill('个人高光'); await tag('other', '个人高光').click();
  await waitRows(count(entry => displayRecord(entry).tags.includes('个人高光')));
  await page.getByRole('button', { name: '清除标签查找', exact: true }).click();
  assert.equal(await page.locator('button[data-facet-group="other"]').count(), allOtherCount);
  assert.equal(await page.getByRole('button', { name: '移除筛选：其他标签：备用标签36', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '移除筛选：其他标签：个人高光', exact: true }).count(), 1);
  await page.keyboard.press('Escape'); assert.equal(await otherPopup.count(), 0);
  await tagSearch.click(); await search.focus(); assert.equal(await otherPopup.count(), 0);
  await waitRows(count(entry => displayRecord(entry).tags.includes('个人高光')));
  await tagSearch.fill('从未存在的新标签');
  assert.equal(await page.locator('button[data-facet-group="other"]').count(), 0);
  assert.equal((await page.evaluate(() => window.md.snapshot())).records.some(record => record.tags.includes('从未存在的新标签')), false);
  await reset(); await waitRows(fixtures.length); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.facet-group').count(), 8);
  assert.equal(await page.getByRole('group', { name: '卡名标签筛选', exact: true }).count(), 1);
  checks.push('Nine types, three friendly forms, seven classification groups, separate card names and personal tags; other lookup shows all focused candidates without truncation, retains multiple selections when cleared/closed, and never creates tags');

  const darkCount = count(entry => has(entry, 'attribute', '暗'));
  const lightCount = count(entry => has(entry, 'attribute', '光'));
  assert(darkCount && lightCount);
  await tag('attribute', '暗').focus(); await page.keyboard.press('Space'); await waitRows(darkCount);
  assert(await tag('attribute', '暗').evaluate(element => element === document.activeElement));
  assert.equal(await displayedCount('attribute', '光'), lightCount);
  await tag('attribute', '光').click(); await waitRows(count(entry => has(entry, 'attribute', '暗') || has(entry, 'attribute', '光')));
  const attackFiltered = count(entry => has(entry, 'purpose', '攻击') && (has(entry, 'attribute', '暗') || has(entry, 'attribute', '光')));
  assert.equal(await displayedCount('purpose', '攻击'), attackFiltered);
  await tag('purpose', '攻击').click(); await waitRows(attackFiltered);
  assert.equal(await displayedCount('attribute', '光'), count(entry => has(entry, 'purpose', '攻击') && has(entry, 'attribute', '光')));
  checks.push('Within-group OR, across-group AND, contextual counts that ignore their own selection, keyboard activation and stable focus');

  await search.fill('__no_results__'); await waitRows(0);
  assert.equal(await tag('purpose', '攻击').getAttribute('aria-pressed'), 'true');
  assert.equal(await tag('purpose', '攻击').isDisabled(), false);
  assert.equal(await displayedCount('purpose', '攻击'), 0);
  assert.equal(await tag('attribute', '水').isDisabled(), true);
  await tag('purpose', '攻击').click();
  assert.equal(await tag('purpose', '攻击').getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: '移除筛选：属性：暗', exact: true }).click();
  assert.equal(await tag('attribute', '暗').getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: '清空属性标签', exact: true }).click();
  assert.equal(await page.locator('.facet-active-filter').count(), 0);
  checks.push('Zero-result searches retain selections; zero-count unselected buttons disable; selected buttons, chips and group clearing remain operable');
  await reset(); await waitRows(fixtures.length);

  const linkExpected = count(entry => has(entry, 'summon', '连接召唤'));
  await tag('summon', '连接召唤').click(); await waitRows(linkExpected);
  const shared = fixtures.find(entry => values(entry, 'summon').length >= 8);
  assert(shared, 'Fixture includes a shared landing resource');
  assert(has(shared, 'summon', '通常召唤'));
  await tag('summon', '通常召唤').click();
  await waitRows(count(entry => has(entry, 'summon', '连接召唤') || has(entry, 'summon', '通常召唤')));
  await reset();
  await tag('cardType', '魔法').click(); await waitRows(count(entry => has(entry, 'cardType', '魔法')));
  assert.equal(await displayedCount('attribute', '未标注'), 0);
  await reset();
  const linkLevel = fixtures.find(entry => entry.record.id === 'event_link_summon_timeline_full_03');
  assert(linkLevel && linkLevel.expectedFacets.level.length);
  await tag('level', linkLevel.expectedFacets.level[0]).click();
  await waitRows(count(entry => has(entry, 'level', linkLevel.expectedFacets.level[0])));
  await reset();
  await forms.selectOption('完整音效'); await waitRows(count(entry => entry.expectedFacets?.displayForm === '完整音效'));
  await forms.selectOption('片段'); await waitRows(count(entry => entry.expectedFacets?.displayForm === '片段'));
  checks.push('Shared summons deduplicate, spell cards are not unattributed monsters, link levels and timeline/body form labels work');

  await all();
  await tagSearch.fill('个人高光'); await tag('other', '个人高光').click();
  await waitRows(count(entry => displayRecord(entry).tags.includes('个人高光')));
  await tag('attribute', '光').click();
  await page.getByRole('navigation', { name: '资料库导航' }).getByRole('button', { name: /^音乐/ }).click();
  await waitRows(1);
  assert.equal(await types.count(), 0);
  assert.equal(await page.getByRole('button', { name: '移除筛选：其他标签：个人高光', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '移除筛选：属性：光', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-facet-group="attribute"]').count(), 0);
  await reset();
  await page.getByRole('navigation', { name: '资料库导航' }).getByRole('button', { name: /^语音/ }).click(); await waitRows(1); assert.equal(await types.count(), 0);
  checks.push('Navigation keeps valid personal filters, removes inapplicable fixed filters and hides sound-effect types for music and voice');

  await all();
  await types.selectOption('召唤方式'); await forms.selectOption('片段'); await tag('summon', '连接召唤').click(); await search.fill('__no_results__');
  const category = page.locator('button.category-select').filter({ has: page.getByTitle('筛选测试', { exact: true }) });
  const testCategoryCount = count(entry => displayRecord(entry).category[0] === '筛选测试');
  await category.click(); await waitRows(testCategoryCount);
  assert.equal(await search.inputValue(), ''); assert.equal(await forms.inputValue(), ''); assert.equal(await types.inputValue(), '');
  assert.equal(await page.locator('.facet-active-filter').count(), 0);
  const sort = page.getByRole('combobox', { name: '排序', exact: true });
  await sort.selectOption('longest'); await tag('attribute', '光').click(); await search.fill('__no_results__'); await reset();
  await waitRows(testCategoryCount); assert.equal(await sort.inputValue(), 'longest');
  assert.equal(await page.locator('.library-heading h1').innerText(), '筛选测试.');
  checks.push('Category clicks clear search/type/form/all groups; clear-all retains the current sidebar category and sorting');

  await all();
  const scroll = page.locator('.virtual-scroll');
  await page.getByRole('checkbox', { name: '选择所有筛选结果', exact: true }).check();
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('.virtual-scroll').scrollTop > 0);
  await tag('attribute', '光').click();
  await page.waitForFunction(() => document.querySelector('.virtual-scroll').scrollTop === 0);
  assert.equal(await page.locator('.selection-bar').count(), 0);
  assert.equal(await page.locator('.track-row[aria-selected="true"]').count(), 0);
  checks.push('Changing filters clears multi-selection and resets virtual scrolling');

  await all();
  await search.fill('１１４２２'); await waitRows(count(entry => displayRecord(entry).tags.includes('11422')));
  const editable = fixtures.find(entry => has(entry, 'attribute', '暗') && has(entry, 'purpose', '攻击')).record;
  await search.fill(fullWidth(editable.originalName)); await waitRows(1);
  await page.getByRole('checkbox', { name: `选择 ${editable.title}`, exact: true }).check();
  await page.locator('.technical-details summary').click();
  assert((await page.locator('.technical-details').innerText()).includes(editable.originalName));
  assert((await page.locator('.technical-details').innerText()).includes('11422'));
  await page.getByRole('textbox', { name: '显示名称', exact: true }).fill('保存后的筛选测试');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(id => window.md.snapshot().then(snapshot => snapshot.records.find(record => record.id === id)?.title === '保存后的筛选测试'), editable.id);
  const afterEdit = await page.evaluate(id => window.md.snapshot().then(snapshot => snapshot.records.find(record => record.id === id)), editable.id);
  assert.deepEqual(afterEdit.tags, editable.tags);
  personalOverrides.set(editable.id, { ...personalOverrides.get(editable.id), title: '保存后的筛选测试', category: editable.category, tags: editable.tags });
  await search.fill('链接召唤');
  const aliasExpected = count(entry => has(entry, 'summon', '连接召唤') || displayRecord(entry).tags.includes('链接召唤'));
  await waitRows(aliasExpected);
  await search.fill('连接召唤');
  await waitRows(aliasExpected);
  checks.push('Full-width identifiers and original names remain searchable and visible in details; title edits preserve tags; summon spelling aliases match');

  await all(); await search.fill(editable.originalName); await waitRows(1);
  await page.getByRole('button', { name: '播放 保存后的筛选测试', exact: true }).click();
  await page.getByRole('button', { name: '单曲循环', exact: true }).click();
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > 0.1 && !audio.error; });
  const source = await page.locator('audio').getAttribute('src');
  await all(); await tag('attribute', '光').click(); await search.fill('__no_results__'); await waitRows(0);
  assert.equal(await page.locator('audio').getAttribute('src'), source); assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  await all();
  await tag('summon', '连接召唤').click(); await waitRows(linkExpected);
  await page.locator('.track-row input[type="checkbox"]').first().check();
  for (const [theme, name] of [['dark', '石墨'], ['light', '纸白'], ['duel', '决斗']]) {
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await page.locator('.theme-option').filter({ hasText: name }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme); await page.keyboard.press('Escape');
    for (const [width, height] of [[1480, 940], [1000, 680]]) {
      await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), { width, height });
      await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await page.evaluate(() => {
        const rect = selector => { const element = document.querySelector(selector); const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; };
        const groups = document.querySelector('.facet-groups');
        return { viewport: { width: innerWidth, height: innerHeight }, shellWidth: document.documentElement.scrollWidth, panel: rect('.facet-panel'), table: rect('.library-table'), player: rect('.player-bar'), editor: rect('.editor-panel'), groups: { clientHeight: groups.clientHeight, scrollHeight: groups.scrollHeight } };
      });
      assert(layout.shellWidth <= width + 1, `Horizontal overflow in ${theme} at ${width}`);
      assert(layout.panel.height > 100 && layout.table.height >= 70, `Filter panel leaves no usable audio list in ${theme} at ${width}`);
      assert(layout.panel.bottom <= layout.table.y + 1, 'Filter panel overlaps table');
      assert(layout.table.bottom <= layout.player.y + 1, 'Table overlaps player');
      assert(layout.editor.width > 0 && layout.editor.right <= width + 1, 'Details panel leaves viewport');
      assert(layout.groups.scrollHeight > layout.groups.clientHeight, 'Tag region must scroll internally');
      await page.getByRole('textbox', { name: '标签', exact: true }).scrollIntoViewIfNeeded();
      const detailsScroll = await page.locator('.editor-scroll').evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom }));
      assert(detailsScroll.height >= 110 && detailsScroll.scrollHeight > detailsScroll.height && detailsScroll.scrollTop > 0, 'Selected sound details need a usable scrolling viewport');
      assert(detailsScroll.top >= layout.editor.y && detailsScroll.bottom <= layout.editor.bottom + 1, 'Details scrolling viewport overflows its panel');
      layout.detailsScroll = detailsScroll;
      await page.locator('.editor-scroll').evaluate(element => { element.scrollTop = 0; });
      await tag('confirmation', '待确认').scrollIntoViewIfNeeded();
      assert(await tag('confirmation', '待确认').isVisible());
      await page.locator('.facet-groups').evaluate(element => { element.scrollTop = 0; });
      layout.lookupMenus = [];
      for (const [lookup, popup, label] of [[cardSearch, cardPopup, 'cardName'], [tagSearch, otherPopup, 'other']]) {
        await lookup.scrollIntoViewIfNeeded(); await lookup.fill(''); await lookup.click();
        await popup.waitFor();
        const bounds = await popup.evaluate(element => {
          const box = element.parentElement.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, height: element.clientHeight, scrollHeight: element.scrollHeight };
        });
        assert(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width + 1 && bounds.bottom <= height + 1, `${label} lookup leaves viewport in ${theme} at ${width}`);
        assert(bounds.height >= 64 && bounds.scrollHeight > bounds.height, `${label} candidates need an independent scroll region`);
        await popup.evaluate(element => { element.scrollTop = element.scrollHeight; });
        assert(await popup.evaluate(element => element.scrollTop > 0), 'Full candidate list remains reachable beyond the first visible rows');
        layout.lookupMenus.push({ label, ...bounds });
        if (theme === 'dark' && width === 1000) await capture(`${label}-lookup-1000x680`);
        await page.keyboard.press('Escape'); assert.equal(await popup.count(), 0);
      }
      await page.locator('.facet-groups').evaluate(element => { element.scrollTop = 0; });
      assert.equal(await page.locator('audio').getAttribute('src'), source);
      assert.equal(await page.locator('audio').evaluate(audio => audio.paused || !!audio.error), false);
      await capture(`${theme}-${width}x${height}`);
      checks.push({ name: `Theme and viewport ${theme} ${width}×${height}`, layout });
    }
  }
  const toggle = page.locator('.facet-panel-toggle'); await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false'); assert.equal(await page.locator('.facet-workbench').count(), 0);
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  checks.push('Filtering, themes, resizing and panel collapse leave current generated audio playing');

  assert.deepEqual(await page.evaluate(() => window.md.importStatus()), importBefore);
  assert.deepEqual(errors, []);
  const finalSnapshot = await page.evaluate(() => window.md.snapshot());
  assert.equal(finalSnapshot.records.length, snapshot.records.length);
  await close();
  const inspected = new DatabaseSync(database, { readOnly: true });
  try {
    for (const { record } of fixtures) assert.deepEqual(JSON.parse(inspected.prepare('SELECT generated FROM records WHERE id=?').get(record.id).generated), record);
    const storedOverrides = new Map(inspected.prepare('SELECT id,data FROM overrides ORDER BY id').all().map(row => [row.id, JSON.parse(row.data)]));
    assert.deepEqual(storedOverrides, personalOverrides, 'All pre-existing personal overrides and only the explicit UI edit must remain stored');
    assert.equal(inspected.prepare('PRAGMA user_version').get().user_version, 1);
  } finally { inspected.close(); }
  assert.equal(sha256(path.join(dataRoot, relativePath)), mediaId);
  assert(inputs.every(input => sha256(input.file) === input.digest), 'Supplied application changed during the test');
  report = { ...report, passed: true, version: snapshot.version, recordCount: fixtures.length, mappingProfiles: representedProfiles.size,
    actionRecipes: Object.keys(metadata.actions).length, gameAudioIncluded: false, importStarted: false, generatedDatabaseUnchanged: true,
    sourceApplicationUnchanged: true, correctedResourceFixtures: correctedFixtures.map(entry => entry.record.originalName), personalOverridesPreserved: true,
    audioRequests: [...new Set(audioRequests)] };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
} catch (error) {
  report.error = String(error);
  if (app && page) await capture('failure').catch(() => {});
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ error: String(error), reportFile }));
  throw error;
} finally { await close(); }
