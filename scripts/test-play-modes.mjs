// Isolated play-mode regression: plays short generated tones from a temporary library; never reads or writes a real library or game folder.
// npm run build && node scripts/test-play-modes.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, '.cache', 'play-modes-regression-'));
const dataRoot = path.join(directory, 'Player');
fs.mkdirSync(path.join(dataRoot, 'data'), { recursive: true });
fs.mkdirSync(path.join(dataRoot, 'assets', 'audio'), { recursive: true });
const seconds = 0.8;
function tone(frequency) {
  const frames = Math.floor(48000 * seconds); const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(192000, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const value = Math.round(6000 * Math.sin(2 * Math.PI * frequency * i / 48000) * Math.min(1, i / 500, (frames - i) / 500)); buffer.writeInt16LE(value, 44 + i * 4); buffer.writeInt16LE(value, 46 + i * 4); }
  return buffer;
}
const samples = [
  ['mode-1', '模式测试 1', ['模式测试', '甲组'], 330], ['mode-2', '模式测试 2', ['模式测试', '甲组'], 392],
  ['mode-3', '模式测试 3', ['模式测试', '乙组'], 440], ['mode-4', '模式测试 4', ['模式测试', '乙组'], 494],
  ['mode-5', '模式测试 5', ['模式测试', '丙组'], 523],
];
const fixture = new DatabaseSync(path.join(dataRoot, 'data', 'library.sqlite'));
fixture.exec('CREATE TABLE records(id TEXT PRIMARY KEY,generated TEXT NOT NULL,imported_at TEXT NOT NULL); CREATE TABLE media(id TEXT PRIMARY KEY,path TEXT NOT NULL,bytes INTEGER NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
fixture.prepare('INSERT INTO settings VALUES(?,?)').run('preferences', JSON.stringify({ onboardingComplete: true, volume: 0.2 }));
for (const [id, title, category, frequency] of samples) {
  const data = tone(frequency); const mediaId = createHash('sha256').update(data).digest('hex'); const relativePath = `assets/audio/${mediaId}.wav`;
  fs.writeFileSync(path.join(dataRoot, relativePath), data);
  fixture.prepare('INSERT INTO media VALUES(?,?,?)').run(mediaId, relativePath, data.length);
  fixture.prepare('INSERT INTO records VALUES(?,?,?)').run(id, JSON.stringify({ id, mediaId, title, originalName: id.toUpperCase().replace('-', '_'), kind: 'sfx', form: '独立片段', category, tags: [], duration: seconds, sampleRate: 48000, channels: 2, peaks: [0.2, 0.6, 0.4], status: 'ready', description: 'Isolated play-mode fixture', relativePath, bytes: data.length, sources: [] }), '2026-01-01T00:00:00.000Z');
}
fixture.close();

const checks = []; const errors = []; let app;
const reportFile = path.join(directory, 'report.json');
try {
  app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, MD_PLAYER_DATA: dataRoot }, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.md);
  const button = name => page.getByRole('button', { name, exact: true });
  const modes = async () => Object.fromEntries(await Promise.all(['列表循环', '随机播放', '单曲循环'].map(async name => [name, await button(name).getAttribute('aria-pressed')])));
  const off = { 列表循环: 'false', 随机播放: 'false', 单曲循环: 'false' };
  await button('播放 模式测试 1').waitFor();
  // Every sound the player loads, in order.
  await page.evaluate(() => { const audio = document.querySelector('audio'); window.played = []; new MutationObserver(() => window.played.push(decodeURIComponent(audio.getAttribute('src').split('/').pop()))).observe(audio, { attributes: true, attributeFilter: ['src'] }); });
  const played = () => page.evaluate(() => window.played.slice());
  const playedFrom = async (start, count) => { await page.waitForFunction(([start, count]) => window.played.length >= start + count, [start, count], { timeout: 20000 }); return (await played()).slice(start, start + count); };
  const ended = () => page.waitForFunction(() => document.querySelector('audio').ended, null, { timeout: 10000 });
  const audio = () => page.locator('audio').evaluate(element => ({ paused: element.paused, loop: element.loop, error: element.error?.code || 0 }));

  assert.deepEqual(await modes(), off);
  await button('播放 模式测试 2').click(); await ended(); await page.waitForTimeout(600);
  assert.deepEqual(await played(), ['mode-2']); assert.equal((await audio()).paused, true);
  checks.push('Default mode stops after one sound');

  await button('列表循环').click();
  assert.deepEqual(await modes(), { ...off, 列表循环: 'true' });
  let mark = (await played()).length;
  await button('播放 模式测试 4').click();
  assert.deepEqual(await playedFrom(mark, 4), ['mode-4', 'mode-5', 'mode-1', 'mode-2']);
  checks.push('List loop continues down the list and wraps to the top');

  await page.locator('button.category-select').filter({ hasText: '乙组' }).click();
  await button('播放 模式测试 3').click();
  mark = (await played()).length;
  await page.getByRole('button', { name: /^所有声音/ }).click();
  await button('播放 模式测试 5').waitFor();
  const kept = await playedFrom(mark, 3);
  assert.ok(kept.every((id, index) => ['mode-3', 'mode-4'].includes(id) && id !== kept[index - 1]), kept.join(' '));
  checks.push('List loop stays in the list it started from while another list is shown');
  // A sound has just started: pause and resume it from its row in the list shown now, well before it ends.
  const current = (await played()).at(-1);
  const currentRow = button(`播放 ${samples.find(sample => sample[0] === current)[1]}`);
  await currentRow.click(); await page.waitForFunction(() => document.querySelector('audio').paused);
  await currentRow.click(); await page.waitForFunction(() => !document.querySelector('audio').paused);
  mark = (await played()).length;
  const resumed = await playedFrom(mark, 3);
  assert.ok([current, ...resumed].every((id, index, list) => ['mode-3', 'mode-4'].includes(id) && id !== list[index - 1]), resumed.join(' '));
  checks.push('Pausing and resuming from its row in another list keeps list loop in the list it started from');

  await button('随机播放').click();
  assert.deepEqual(await modes(), { ...off, 随机播放: 'true' });
  mark = (await played()).length;
  await button('播放 模式测试 1').click();
  await page.waitForFunction(mark => { const list = window.played.slice(mark); const start = list.indexOf('mode-1'); return start >= 0 && list.length - start >= 8; }, mark, { timeout: 30000 });
  const tail = (await played()).slice(mark); const shuffle = tail.slice(tail.indexOf('mode-1'), tail.indexOf('mode-1') + 8);
  assert.deepEqual(shuffle.slice(1, 5).sort(), ['mode-2', 'mode-3', 'mode-4', 'mode-5'], shuffle.join(' '));
  assert.ok(shuffle.every((id, index) => id !== shuffle[index - 1]), shuffle.join(' '));
  checks.push(`Shuffle plays every other sound once per round without back-to-back repeats (${shuffle.join(' ')})`);
  await page.locator('.player-bar').screenshot({ path: path.join(directory, '01-shuffle.png') });

  await button('暂停').click(); await page.waitForFunction(() => document.querySelector('audio').paused);
  const before = await played();
  await button('上一条').click();
  const back = await playedFrom(before.length, 1);
  assert.equal(back[0], before.at(-2));
  checks.push('Previous in shuffle returns to the sound played before');

  await page.waitForFunction(() => { const element = document.querySelector('audio'); return !element.paused && element.currentTime > 0.05; });
  await button('单曲循环').click();
  assert.deepEqual(await modes(), { ...off, 单曲循环: 'true' });
  mark = (await played()).length;
  await page.waitForTimeout(seconds * 2500);
  assert.deepEqual(await audio(), { paused: false, loop: true, error: 0 }); assert.equal((await played()).length, mark);
  checks.push('Single loop replaces shuffle and repeats the current sound');

  await button('单曲循环').click();
  assert.deepEqual(await modes(), off);
  await ended(); await page.waitForTimeout(600);
  assert.equal((await played()).length, mark);
  checks.push('Clicking the active mode turns it off; playback stops at the end again');
  assert.deepEqual(errors, []);
  await app.close(); app = null;
  const report = { passed: true, testedApp: root, temporaryDataRoot: dataRoot, checks, errors };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
} catch (error) {
  fs.writeFileSync(reportFile, JSON.stringify({ passed: false, temporaryDataRoot: dataRoot, checks, errors, error: String(error) }, null, 2));
  console.error(JSON.stringify({ reportFile, error: String(error) })); throw error;
} finally { if (app) await app.close(); }
