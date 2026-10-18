import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Library } from '../desktop/database';
import { correctedRecordDefaults, recordFacets } from '../desktop/facet-metadata';
import metadata from '../shared/facet-metadata.json';
import classifications from '../engine/rules/classification.json';
import recipes from '../engine/rules/recipes.json';
import type { EngineRecord } from '../shared/contracts';
import type { RecordFacets } from '../shared/facet-types';
import { buildFacetView, emptyFacetSelection } from '../src/facets';

const knownHash = '593633dc0644fef14617052014b8bb6332d7655c114f2b58ebb1ea850cf890a7';
function resource(overrides: Partial<EngineRecord> = {}): EngineRecord {
  return {
    id: 'legacy_cutin', originalName: 'SE_MONSTER_CUTIN_DARK', title: '旧标题', kind: 'sfx', form: '独立片段',
    category: ['决斗音效', '卡片切入', '七属性共用音层'], tags: ['旧标签', 'SE_MONSTER_CUTIN_DARK', '11422'],
    description: '', mediaId: knownHash, relativePath: `assets/audio/${knownHash}.wav`, bytes: 100,
    duration: 1, sampleRate: 48000, channels: 2, peaks: [0, 1], status: 'ready',
    sources: [{ key: 'old-source', bundle: 'LocalData/old-account/0000/a/b', account: 'old-account', payloadHash: knownHash }],
    ...overrides,
  };
}
const testRoot = path.resolve('.cache', 'unit-tests');
fs.mkdirSync(testRoot, { recursive: true });

test('checked-in metadata covers only current exact resources and current action recipes', () => {
  assert.deepEqual(Object.keys(metadata.resources).sort(), Object.keys(classifications).sort());
  assert.deepEqual(Object.keys(metadata.actions).sort(), recipes.recipes.map(recipe => recipe.id).sort());
  assert.equal(Object.keys(metadata.actions).some(id => id.startsWith('event_card_cutin_')), false);
  for (const recipe of recipes.recipes) {
    const action = metadata.actions[recipe.id as keyof typeof metadata.actions];
    assert.equal(action.name, recipe.name);
    assert.equal(action.form, recipe.form);
  }
  for (const facets of metadata.profiles as unknown as RecordFacets[]) {
    assert.deepEqual(Object.keys(facets).sort(), ['types', 'purposes', 'summon', 'attribute', 'cardType', 'level', 'animation', 'confirmation', 'displayForm'].sort());
    assert(facets.attribute.every(value => ['暗', '光', '地', '水', '炎', '风', '神'].includes(value)));
    assert(facets.cardType.every(value => ['怪兽', '魔法', '陷阱'].includes(value)));
    for (const purpose of Object.values(facets.purposes).flat()) {
      assert(!/^\d+$|编号|(?:SE|BGM|VOICE|V)_[a-z\d_]+|Summon\w*TL|[\\/]/i.test(purpose), purpose);
    }
  }
});

test('every profile field stays within the public filter vocabulary and contains no identity or path labels', () => {
  const vocabulary: Record<string, Set<string>> = {
    types: new Set(['其他音效', '其他演出', '卡片相关', '决斗过程', '菜单', '召唤方式', '特效切入', '场地', '伙伴']),
    purposes: new Set(['周年演出', '选择', '攻击', '状态与数值', '破坏', '其他卡片操作', '发动与效果', '其他菜单提示', '胜负与结束', '卡组与检索', '抽卡', '召唤演出', '除外', '移动', '解放', '送墓', '卡片制作与收藏', '连锁', '硬币与骰子', '伤害与生命值', '决斗提示', '表示形式', '单人剧情与活动', '无效', '效果处理', '特殊胜利', '盖放与翻转', '通常与特殊召唤', '抽取演出', '按钮', '提醒', '卡片登场', '召唤切入', '阶段与回合', '卡包', '素材选择', '通用召唤卡片声', '其他演出', '返回卡组', '返回手牌', '洗牌', '召唤主体']),
    summon: new Set(['反转召唤／翻转', '通常召唤', '特殊召唤', '二重召唤', '上级召唤', '衍生物召唤', '超量召唤', '融合召唤', '连接召唤', '仪式召唤', '灵摆召唤', '同调召唤']),
    attribute: new Set(['暗', '光', '地', '水', '炎', '风', '神']),
    cardType: new Set(['怪兽', '魔法', '陷阱']),
    animation: new Set(['卡片发动与处理', '特殊胜利', '属性切入音层']),
    confirmation: new Set(['资料归类', '已确认', '用途已确认']),
    displayForm: new Set(['完整音效', '片段', '碎片片段']),
  };
  const landingConditions = new Set([
    '有登场动画，或等级≥7／阶级≥7／连接值≥4／攻击力≥2800',
    '未达高档，且等级≥5／阶级≥5／连接值≥2／攻击力≥2200',
    '未达中档或高档；具体落地方式另行判定',
  ]);
  for (const facets of metadata.profiles as unknown as RecordFacets[]) {
    for (const [field, values] of Object.entries(facets)) {
      const labels = field === 'purposes' ? Object.values(values as Record<string, string[]>).flat() : typeof values === 'string' ? [values] : values as string[];
      for (const label of labels) {
        assert(!/^\d+$|编号|(?:SE|BGM|VOICE|V)_[a-z\d_]+|Summon\w*TL|[\\/]|https?:|file:/i.test(label), `${field}: ${label}`);
        if (field === 'level') {
          assert(!/素材|召唤分支/.test(label), label);
          assert(landingConditions.has(label) || /^Link [1-6]$/.test(label), label);
        }
        else assert(vocabulary[field]?.has(label), `${field}: ${label}`);
      }
    }
    for (const group of Object.keys(facets.purposes)) assert(vocabulary.types.has(group), group);
  }
});

test('exact raw resource evidence supplies cut-in attribute and monster type', () => {
  const facets = recordFacets(resource());
  assert.deepEqual(facets.attribute, ['暗']);
  assert.deepEqual(facets.cardType, ['怪兽']);
  assert.deepEqual(facets.types, ['特效切入', '召唤方式']);
  assert.deepEqual(facets.purposes, { 特效切入: ['卡片登场'], 召唤方式: ['召唤切入'] });
  assert.equal(facets.displayForm, '碎片片段');
  facets.attribute.push('光');
  facets.purposes['特效切入'].push('污染');
  assert.deepEqual(recordFacets(resource()).attribute, ['暗']);
  assert.deepEqual(recordFacets(resource()).purposes['特效切入'], ['卡片登场']);
});

test('changed payloads, names and mixed provenance cannot borrow known card properties', () => {
  const changedHash = { ...resource().sources[0], payloadHash: '0'.repeat(64) };
  for (const record of [
    resource({ sources: [changedHash] }),
    resource({ originalName: 'SE_MONSTER_CUTIN_UNKNOWN' }),
    resource({ sources: [...resource().sources, changedHash] }),
    resource({ sources: [] }),
  ]) {
    const facets = recordFacets(record);
    assert.deepEqual(facets.attribute, []);
    assert.deepEqual(facets.cardType, []);
    assert.deepEqual(facets.confirmation, ['待确认']);
    assert.equal(facets.displayForm, '碎片片段');
  }
});

test('shared landing resource retains all evidenced summon uses', () => {
  const facets = recordFacets(resource({
    originalName: 'SE_LAND_NORMAL',
    sources: [{ ...resource().sources[0], payloadHash: '005dcd583f4bbf2fe0d56bf49475ae30e8e2716a3d3d69ead5464367cd26439d' }],
  }));
  assert.deepEqual(facets.summon, ['通常召唤', '特殊召唤', '仪式召唤', '融合召唤', '灵摆召唤', '超量召唤', '同调召唤', '连接召唤']);
});

const drawEntries = Object.entries(classifications).filter(([key]) => key.split(':')[0].includes('CARD_DRAW'));
const displayEntries = Object.entries(classifications).filter(([key]) => ['SE_DISP_ATTACK', 'SE_DISP_DEFENS'].includes(key.split(':')[0]));
function legacyDraw(key = drawEntries[0][0]): EngineRecord {
  const [originalName, payloadHash] = key.split(':');
  return resource({
    id: `legacy_${originalName}`, originalName, title: `抽卡／共用移动候选 · ${originalName}`,
    category: ['决斗音效', '卡片操作', '抽卡与共用移动'], tags: ['抽卡与共用移动', '反转召唤／翻转'],
    sources: [{ ...resource().sources[0], payloadHash }],
  });
}

test('all CARD_DRAW resources use card-operation facets and corrected defaults without summon labels', () => {
  assert.equal(drawEntries.length, 4);
  assert.deepEqual(Object.keys(metadata.resourceDefaults).sort(), [...drawEntries, ...displayEntries].map(([key]) => key).sort());
  for (const [key, expected] of drawEntries) {
    const original = legacyDraw(key);
    const corrected = correctedRecordDefaults(original);
    assert.equal(corrected.title, `抽卡 · ${original.originalName}`);
    assert.deepEqual(corrected.category, ['决斗音效', '卡片操作', '抽卡']);
    assert.deepEqual(corrected.tags, ['卡片操作', '抽卡', '决斗音效']);
    assert.equal(corrected.title, expected.title);
    assert.deepEqual(corrected.category, expected.category);
    assert.deepEqual(corrected.tags, expected.tags);
    const facets = recordFacets(original);
    assert.deepEqual(facets.types, ['卡片相关']);
    assert.deepEqual(facets.purposes, { 卡片相关: ['抽卡'] });
    assert.deepEqual(facets.summon, []);
    corrected.category.push('污染');
    corrected.tags.push('污染');
    assert.deepEqual(correctedRecordDefaults(original).category, expected.category);
    assert.deepEqual(correctedRecordDefaults(original).tags, expected.tags);
  }
});

test('both face-up completion branches share flip and position-change facets with corrected legacy defaults', () => {
  assert.equal(displayEntries.length, 2);
  for (const [key, expected] of displayEntries) {
    const [originalName, payloadHash] = key.split(':');
    const original = resource({ originalName, title: `旧名称 · ${originalName}`, description: '旧说明', category: ['决斗音效', '决斗过程', '攻击'], sources: [{ ...resource().sources[0], payloadHash }] });
    const corrected = correctedRecordDefaults(original);
    assert.equal(corrected.title, expected.title);
    assert.deepEqual(corrected.category, ['决斗音效', '卡片操作', '表示形式']);
    assert.deepEqual(corrected.tags, expected.tags);
    assert.equal(corrected.description, expected.description);
    assert.match(corrected.description, /表侧/);
    assert.doesNotMatch(corrected.description, /客户端|静态|动态实录/);
    const facets = recordFacets(original);
    assert.deepEqual([...facets.types].sort(), ['卡片相关', '召唤方式'].sort());
    assert.deepEqual(facets.purposes, { 卡片相关: ['表示形式'], 召唤方式: ['表示形式'] });
    assert.deepEqual(facets.summon, ['反转召唤／翻转']);
    assert.equal(correctedRecordDefaults({ ...original, sources: [] }).title, original.title);
  }
});

test('CARD_DRAW defaults require exact provenance and unknown versions cannot regain summon facets', () => {
  const original = legacyDraw();
  const changed = { ...original.sources[0], payloadHash: '0'.repeat(64) };
  for (const candidate of [
    { ...original, originalName: 'SE_OTHER' },
    { ...original, sources: [changed] },
    { ...original, sources: [...original.sources, changed] },
    { ...original, sources: [] },
  ]) assert.equal(correctedRecordDefaults(candidate), candidate);
  for (const sources of [[changed], [...original.sources, changed], []]) {
    const facets = recordFacets({ ...original, sources, category: ['决斗音效', '召唤与登场', '通常召唤'] });
    assert.deepEqual(facets.summon, []);
    assert.equal(facets.types.includes('召唤方式'), false);
    assert.equal(Object.hasOwn(facets.purposes, '召唤方式'), false);
  }
});

test('legacy CARD_DRAW rows correct on read while SQLite and personal edits stay intact', () => {
  const directory = fs.mkdtempSync(path.join(testRoot, 'draw-legacy-'));
  const filename = path.join(directory, 'library.sqlite');
  let library = new Library(filename);
  const generated = legacyDraw();
  const custom = { ...generated, id: 'custom_draw' };
  try {
    library.upsert(generated);
    library.upsert(custom);
    library.upsert(resource());
    library.edit([custom.id], { title: '我的抽卡', category: ['个人分类'], tags: ['保留'], favorite: true });
    const before = Object.fromEntries(['records', 'overrides', 'media', 'sources'].map(table => [table, library.db.prepare(`SELECT * FROM ${table}`).all()]));
    library.close();
    library = new Library(filename);
    const automatic = library.getRecord(generated.id)!;
    assert.equal(automatic.title, `抽卡 · ${generated.originalName}`);
    assert.deepEqual(automatic.category, ['决斗音效', '卡片操作', '抽卡']);
    assert.deepEqual(automatic.tags, ['卡片操作', '抽卡', '决斗音效']);
    assert.equal(automatic.modified, false);
    assert.deepEqual(automatic.facets?.purposes, { 卡片相关: ['抽卡'] });
    const personal = library.getRecord(custom.id)!;
    assert.equal(personal.title, '我的抽卡');
    assert.deepEqual(personal.category, ['个人分类']);
    assert.deepEqual(personal.tags, ['保留']);
    assert.equal(personal.favorite, true);
    assert.equal(personal.modified, true);
    assert.deepEqual(personal.facets?.summon, []);
    assert.deepEqual(personal.facets?.purposes, { 卡片相关: ['抽卡'] });
    const summonView = buildFacetView(library.snapshot().records, { ...emptyFacetSelection(), type: '召唤方式' }, '');
    assert.deepEqual(summonView.records.map(record => record.id), ['legacy_cutin']);
    for (const table of ['records', 'overrides', 'media', 'sources']) assert.deepEqual(library.db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
    library.edit([custom.id], { reset: true });
    assert.equal(library.getRecord(custom.id)?.title, automatic.title);
    assert.equal(library.getRecord(custom.id)?.favorite, true);
  } finally {
    library.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('verified spell and trap classifications keep monster attributes empty', () => {
  for (const [originalName, payloadHash, cardType] of [
    ['SE_EV_039_NORMAL', 'e7cc54502b04862795caaef78d45a55a6386d9ff3d6701ae0129854bb2101a39', '魔法'],
    ['SE_EV_043_NORMAL', 'e23fb513a25c26b4258303a56c2fed552c46605baacf753098b32f375fed9ca2', '陷阱'],
  ]) {
    const facets = recordFacets(resource({ originalName, sources: [{ ...resource().sources[0], payloadHash }] }));
    assert.deepEqual(facets.cardType, [cardType]);
    assert.deepEqual(facets.attribute, []);
    assert.deepEqual(facets.purposes, { 特效切入: ['效果处理'] });
  }
});

test('action metadata requires matching identity and excludes material counts from level facets', () => {
  const record = resource({ id: 'event_link_summon_body_01', originalName: 'link_summon_body_01', form: '动作主体', sources: [] });
  assert.deepEqual(recordFacets(record).level, ['Link 1']);
  assert.equal(recordFacets(record).displayForm, '片段');
  for (const invalid of [{ ...record, originalName: 'changed' }, { ...record, form: '完整动作' }]) {
    assert.deepEqual(recordFacets(invalid).level, []);
    assert.deepEqual(recordFacets(invalid).confirmation, ['待确认']);
  }
  const xyz = recipes.recipes.find(recipe => recipe.id.startsWith('event_xyz_summon_body_') && recipe.id.endsWith('_01'))!;
  const facets = recordFacets(resource({ id: xyz.id, originalName: xyz.name, form: xyz.form, sources: [] }));
  assert.deepEqual(facets.level, []);
  for (const profile of metadata.profiles) assert(profile.level.every(value => !/素材|召唤分支/.test(value)));
});

test('unknown generated categories use conservative purposes without exposing arbitrary card names or tags', () => {
  const facets = recordFacets(resource({
    originalName: 'future_asset', category: ['决斗音效', '卡片专属效果', '卡片发动与处理', '私人卡名123'],
    tags: ['暗属性', '怪兽', '连接召唤', 'SE_INTERNAL_999'], sources: [],
  }));
  assert.deepEqual(facets.purposes, { 特效切入: ['效果处理'] });
  assert.deepEqual(facets.attribute, []);
  assert.deepEqual(facets.cardType, []);
  assert.deepEqual(facets.summon, []);
  assert.deepEqual(facets.confirmation, ['待确认']);
});

test('old SQLite libraries gain read-only facets while stored rows and personal overrides remain intact', () => {
  const directory = fs.mkdtempSync(path.join(testRoot, 'facets-legacy-'));
  const filename = path.join(directory, 'library.sqlite');
  let library = new Library(filename);
  try {
    library.upsert(resource());
    library.edit(['legacy_cutin'], { title: '我的名字', category: ['个人分类', '光属性'], tags: ['自定义', '11422'], favorite: true });
    const before = {
      records: library.db.prepare('SELECT * FROM records').all(), overrides: library.db.prepare('SELECT * FROM overrides').all(),
      media: library.db.prepare('SELECT * FROM media').all(), sources: library.db.prepare('SELECT * FROM sources').all(),
      backup: library.exportMetadata(),
    };
    library.close();
    library = new Library(filename);
    const record = library.snapshot().records[0];
    assert.equal(record.title, '我的名字');
    assert.deepEqual(record.category, ['个人分类', '光属性']);
    assert.deepEqual(record.tags, ['自定义', '11422']);
    assert.equal(record.favorite, true);
    assert.equal(record.sourceCount, 1);
    assert.deepEqual(record.facets?.attribute, ['暗']);
    assert.deepEqual(record.facets?.purposes, { 特效切入: ['卡片登场'], 召唤方式: ['召唤切入'] });
    for (const table of ['records', 'overrides', 'media', 'sources'] as const) assert.deepEqual(library.db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
    assert.deepEqual(library.exportMetadata(), before.backup);
    assert.equal(Object.hasOwn(JSON.parse(String(before.records[0].generated)), 'facets'), false);
  } finally {
    library.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
