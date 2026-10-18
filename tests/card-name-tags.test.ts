import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { recordCardNameTags } from '../desktop/card-name-tags';
import { Library } from '../desktop/database';
import type { EngineRecord } from '../shared/contracts';

const hash = 'a'.repeat(64);
function cutin(patch: Partial<EngineRecord> = {}): EngineRecord {
  return {
    id: 'event_card_cutin_attribute_10001', kind: 'sfx', title: '示例卡甲 · 切入音层', originalName: 'SE_MONSTER_CUTIN_DARK',
    category: ['决斗音效', '卡片切入', '按卡名'], tags: ['卡片切入', '示例卡甲', '暗属性'], form: '独立片段',
    mediaId: hash, relativePath: `assets/audio/${hash}.wav`, bytes: 100, duration: 1, sampleRate: 48000, channels: 2,
    peaks: [0, 1], status: 'ready', description: '', sources: [], ...patch,
  };
}

test('legacy cut-in requires the exact id/category/title/tag evidence combination', () => {
  const record = cutin();
  assert.deepEqual(recordCardNameTags(record), ['示例卡甲']);
  for (const invalid of [
    { ...record, id: 'ordinary_resource' }, { ...record, category: ['决斗音效', '卡片切入', '七属性共用音层'] },
    { ...record, title: '示例卡甲' }, { ...record, tags: ['暗属性'] }, { ...record, kind: 'music' as const },
  ]) assert.deepEqual(recordCardNameTags(invalid), []);
});

test('legacy card effects use the named category leaf only when it is also an existing tag', () => {
  for (const effect of ['卡片发动与处理', '特殊胜利']) {
    const record = cutin({ id: 'old_effect', title: '其他显示标题', category: ['决斗音效', '卡片专属效果', effect, '示例卡甲'] });
    assert.deepEqual(recordCardNameTags(record), ['示例卡甲']);
    assert.deepEqual(recordCardNameTags({ ...record, tags: ['任意卡名候选'] }), []);
    assert.deepEqual(recordCardNameTags({ ...record, category: ['决斗音效', '卡片专属效果', effect, '卡名待确认'], tags: ['卡名待确认'] }), []);
  }
  assert.deepEqual(recordCardNameTags(cutin({ id: 'ordinary', category: ['个人分类', '示例卡甲'], title: '示例卡甲', tags: ['示例卡甲'] })), []);
});

test('effective tags determine membership with case/fullwidth matching and no title-only resurrection', () => {
  const record = cutin({ title: 'Card Alpha · 切入音层', tags: ['Card Alpha'] });
  const before = JSON.stringify(record);
  assert.deepEqual(recordCardNameTags(record, ['ＣＡＲＤ ＡＬＰＨＡ', 'card alpha']), ['Card Alpha']);
  assert.deepEqual(recordCardNameTags(record, []), []);
  assert.deepEqual(recordCardNameTags(record, ['别的个人标签']), []);
  assert.equal(JSON.stringify(record), before);
});

test('explicit personal card-name tags work without legacy evidence and reject empty or internal labels', () => {
  const record = cutin({ id: 'ordinary_resource', category: ['个人分类'], tags: [], originalName: 'local_resource' });
  const explicit = ['卡名：示例卡乙', '卡名:示例卡丙', '卡名：Ｂｏｓｓ', '卡名:boss'];
  assert.deepEqual(recordCardNameTags(record, explicit), ['示例卡乙', '示例卡丙', 'Boss']);
  for (const tag of ['卡名：', '卡名:  ', '卡名:11422', '卡名：１１４２２', '卡名:SE_CARD_DRAW', '卡名:GATE078', '卡名:MAT100', '卡名:SummonLink01_01TL', '卡名:选择器 01', '卡名:卡片编号 1', '卡名:local_resource', '卡名:卡名待确认', '卡名:卡名:示例']) {
    assert.deepEqual(recordCardNameTags(record, [tag]), [], tag);
  }
  assert.deepEqual(recordCardNameTags(record, ['任意中文标签', '示例卡乙']), []);
});

test('database derives card-name tags from original metadata while preserving personal overrides and stored rows', () => {
  const testRoot = path.resolve('.cache', 'unit-tests');
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, 'card-name-tags-'));
  const library = new Library(path.join(directory, 'library.sqlite'));
  try {
    library.upsert(cutin());
    library.edit(['event_card_cutin_attribute_10001'], { title: '我改过的标题', category: ['个人分类'], tags: ['示例卡甲', '卡名：个人卡乙', '任意标签'], favorite: true });
    const before = Object.fromEntries(['records', 'overrides', 'media', 'sources'].map(table => [table, library.db.prepare(`SELECT * FROM ${table}`).all()]));
    const record = library.snapshot().records[0];
    assert.deepEqual(record.cardNameTags, ['示例卡甲', '个人卡乙']);
    assert.equal(record.title, '我改过的标题');
    assert.deepEqual(record.category, ['个人分类']);
    assert.deepEqual(record.tags, ['示例卡甲', '卡名：个人卡乙', '任意标签']);
    assert.equal(record.favorite, true);
    assert.deepEqual(library.getRecord(record.id)?.cardNameTags, record.cardNameTags);
    for (const table of ['records', 'overrides', 'media', 'sources']) assert.deepEqual(library.db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
    library.edit([record.id], { tags: [] });
    assert.deepEqual(library.getRecord(record.id)?.cardNameTags, []);
  } finally {
    library.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
