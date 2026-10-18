import test from 'node:test';
import assert from 'node:assert/strict';
import type { AudioRecord } from '../shared/contracts';
import type { RecordFacets } from '../shared/facet-types';
import { buildFacetView, emptyFacetSelection, normalizeFacetTag, type FacetGroupId, type FacetSelection, type FacetView } from '../src/facets';

function metadata(patch: Partial<RecordFacets> = {}): RecordFacets {
  return { types: ['召唤方式'], purposes: { 召唤方式: ['召唤演出'] }, summon: ['特殊召唤'], attribute: ['暗'], cardType: ['怪兽'], level: [], animation: [], confirmation: ['已确认'], displayForm: '片段', ...patch };
}
function sound(id: string, facets?: RecordFacets, patch: Partial<AudioRecord> = {}): AudioRecord {
  return { id, title: id, originalName: `SE_${id.toUpperCase()}`, mediaId: id, kind: 'sfx', form: '动作主体', category: ['决斗音效', '召唤与登场'], tags: [], favorite: false, duration: 1, sampleRate: 48000, channels: 2, peaks: [], status: 'ready', description: '', sourceCount: 1, modified: false, importedAt: '', ...(facets ? { facets } : {}), ...patch };
}
function chosen(groups: Partial<FacetSelection['groups']>, rest: Partial<Pick<FacetSelection, 'type' | 'form'>> = {}): FacetSelection {
  const selection = emptyFacetSelection();
  return { ...selection, ...rest, groups: { ...selection.groups, ...groups } };
}
function option(view: FacetView, id: FacetGroupId, value: string) {
  return view.groups.find(group => group.id === id)?.options.find(candidate => candidate.value === value);
}
const summonSounds = [
  sound('dark_normal', metadata({ summon: ['通常召唤'] })),
  sound('dark_special', metadata()),
  sound('light_special', metadata({ attribute: ['光'] })),
];

test('facets use OR within each group and AND between groups; counts ignore their own group', () => {
  const dark = buildFacetView(summonSounds, chosen({ attribute: ['暗'] }), '');
  assert.deepEqual(dark.records.map(record => record.id), ['dark_normal', 'dark_special']);
  assert.equal(option(dark, 'attribute', '光')?.count, 1);
  const either = buildFacetView(summonSounds, chosen({ attribute: ['暗', '光'] }), '');
  assert.equal(either.records.length, 3);
  const special = buildFacetView(summonSounds, chosen({ attribute: ['暗', '光'], summon: ['特殊召唤'] }), '');
  assert.deepEqual(special.records.map(record => record.id), ['dark_special', 'light_special']);
  assert.equal(option(special, 'attribute', '暗')?.count, 1);
  assert.equal(option(special, 'attribute', '光')?.count, 1);
  assert.equal(option(special, 'summon', '通常召唤')?.count, 1);
});

test('zero-result search or form retains candidates and selections, with selected zero-count tags removable', () => {
  const selection = chosen({ attribute: ['暗'], summon: ['特殊召唤'] }, { form: '完整音效' });
  for (const [form, query] of [['完整音效', ''], ['', 'NO_SUCH_RECORD']]) {
    const view = buildFacetView(summonSounds, { ...selection, form }, query);
    assert.equal(view.records.length, 0);
    assert.deepEqual(view.selection.groups.attribute, ['暗']);
    assert.equal(option(view, 'attribute', '暗')?.count, 0);
    assert.equal(option(view, 'attribute', '暗')?.disabled, false);
    assert.equal(option(view, 'attribute', '光')?.disabled, true);
    assert.equal(view.groups.find(group => group.id === 'summon')?.options.length, 2);
  }
});

test('scope changes discard only inapplicable group selections and invalid types, while preserving form', () => {
  const menu = sound('menu', metadata({ types: ['菜单'], purposes: { 菜单: ['按钮'] }, summon: [], attribute: [], cardType: [], confirmation: ['已确认'] }));
  const selection = chosen({ attribute: ['暗'], summon: ['特殊召唤'], confirmation: ['已确认'] }, { type: '召唤方式', form: '完整音效' });
  const changed = buildFacetView([menu], selection, 'any query');
  assert.equal(changed.selection.type, '');
  assert.equal(changed.selection.form, '完整音效');
  assert.deepEqual(changed.selection.groups.attribute, []);
  assert.deepEqual(changed.selection.groups.summon, []);
  assert.deepEqual(changed.selection.groups.confirmation, ['已确认']);
  assert.deepEqual(changed.availableTypes, ['菜单']);
});

test('purpose is scoped by type; evidence-backed cross-membership does not invent a summon type', () => {
  const cutin = sound('cutin', metadata({ types: ['特效切入', '召唤方式'], purposes: { 特效切入: ['卡片登场'], 召唤方式: ['召唤切入'] }, summon: [] }));
  const all = buildFacetView([cutin], emptyFacetSelection(), '');
  assert.ok(option(all, 'purpose', '卡片登场'));
  assert.ok(option(all, 'purpose', '召唤切入'));
  assert.equal(all.groups.some(group => group.id === 'summon'), false);
  const scoped = buildFacetView([cutin], chosen({ purpose: ['召唤切入'] }, { type: '特效切入' }), '');
  assert.deepEqual(scoped.selection.groups.purpose, []);
  assert.equal(option(scoped, 'purpose', '召唤切入'), undefined);
  assert.equal(scoped.records.length, 1);
});

test('attributes require structured evidence; magic and traps never enter the missing-attribute bucket', () => {
  const spell = sound('spell', metadata({ attribute: ['魔法'], cardType: ['魔法'] }));
  const unknown = sound('SE_MONSTER_DARK_name_only', metadata({ attribute: [], cardType: [] }));
  const records = [summonSounds[0], spell, unknown];
  const view = buildFacetView(records, chosen({ attribute: ['未标注'] }), '');
  assert.deepEqual(view.records.map(record => record.id), [unknown.id]);
  assert.equal(option(view, 'attribute', '魔法'), undefined);
  assert.equal(option(view, 'cardType', '魔法')?.count, 0);
  const withoutEvidence = buildFacetView([spell, unknown], chosen({ attribute: ['未标注'] }), '');
  assert.equal(withoutEvidence.groups.some(group => group.id === 'attribute'), false);
  assert.deepEqual(withoutEvidence.selection.groups.attribute, []);
});

test('other tags retain custom and one-item labels, excluding internal names and structured aliases', () => {
  const record = sound('cutin', metadata({
    purposes: { 召唤方式: ['送墓', '效果处理'] }, summon: ['连接召唤'], attribute: ['暗'],
    level: ['Link 1', '等级 4', '阶级 2', '实际超量素材数 3'],
  }), { originalName: 'SE_TEST_CUTIN', tags: ['11422', '１１４２２', 'SE_TEST_CUTIN', 'SE_OTHER', 'SummonLink01_01TL', '选择器 01',
    '伙伴编号 7', 'MAT100', 'GATE2', '送墓与墓地', '卡组送墓', '卡片发动与处理', '链接召唤', '暗属性',
    'Link-1', '连接值1', '等级4', '阶级2', '决斗音效', '动作主体', '自用高光', '灰流丽', '等级3', '等级3'] });
  const otherNamed = sound('other', undefined, { originalName: 'My_Legacy_Resource', tags: [] });
  record.tags.push('My_Legacy_Resource');
  const view = buildFacetView([record, otherNamed], emptyFacetSelection(), '');
  assert.deepEqual(new Set(view.groups.find(group => group.id === 'other')?.options.map(candidate => candidate.value)), new Set(['自用高光', '灰流丽', '等级 3']));
  assert.equal(option(view, 'other', '等级 3')?.count, 1);
  assert.equal(buildFacetView([record], chosen({ other: ['灰流丽'] }), '').records.length, 1);
});

test('card-name tags form an independent group without duplicating personal tags or records', () => {
  const records = [
    sound('card_a', metadata(), { cardNameTags: ['测试卡甲'], tags: ['测试卡甲', '卡名：测试卡甲', '个人高光'] }),
    sound('card_b', metadata({ attribute: ['光'] }), { cardNameTags: ['测试卡乙'], tags: ['测试卡乙', '个人高光'] }),
    sound('card_a_copy', metadata({ attribute: ['光'] }), { tags: ['测试卡甲', '私人用途'] }),
    sound('unclassified', metadata(), { title: '未确认的卡名', tags: ['未确认的卡名', '卡名：11422', '卡名：SE_INTERNAL'] }),
  ];
  const before = JSON.stringify(records);
  const view = buildFacetView(records, emptyFacetSelection(), '');
  assert.deepEqual(view.groups.find(group => group.id === 'cardName')?.options.map(item => [item.value, item.count]), [['测试卡甲', 2], ['测试卡乙', 1]]);
  assert.equal(option(view, 'other', '测试卡甲'), undefined);
  assert.equal(option(view, 'other', '卡名：测试卡甲'), undefined);
  assert.equal(option(view, 'other', '未确认的卡名')?.count, 1);
  assert.equal(option(view, 'other', '卡名：11422'), undefined);
  assert.equal(option(view, 'other', '卡名：SE_INTERNAL'), undefined);
  const selected = chosen({ cardName: ['测试卡甲', '测试卡乙'], attribute: ['光'], other: ['个人高光'] });
  const filtered = buildFacetView(records, selected, '');
  assert.deepEqual(filtered.records.map(record => record.id), ['card_b']);
  assert.equal(option(filtered, 'cardName', '测试卡甲')?.count, 0);
  assert.equal(option(filtered, 'cardName', '测试卡甲')?.disabled, false);
  assert.equal(option(filtered, 'attribute', '暗')?.count, 1);
  assert.equal(buildFacetView(records, selected, '__missing__').selection.groups.cardName.length, 2);
  assert.equal(JSON.stringify(records), before);
});

test('card-name recognition stays consistent across navigation using only existing library evidence', () => {
  const evidence = sound('evidence', undefined, { cardNameTags: ['Test Card'], tags: ['卡名：Ｔｅｓｔ Ｃａｒｄ'] });
  const personal = sound('personal', undefined, { tags: ['test card', '常用'] });
  const view = buildFacetView([personal], chosen({ cardName: ['ＴＥＳＴ ＣＡＲＤ'] }), '', [evidence, personal]);
  assert.deepEqual(view.selection.groups.cardName, ['Test Card']);
  assert.deepEqual(view.records.map(record => record.id), ['personal']);
  assert.equal(option(view, 'other', 'test card'), undefined);
  assert.equal(option(view, 'other', '常用')?.count, 1);
  const withoutEvidence = buildFacetView([personal], emptyFacetSelection(), '');
  assert.equal(withoutEvidence.groups.some(group => group.id === 'cardName'), false);
  assert.equal(option(withoutEvidence, 'other', 'test card')?.count, 1);
});

test('unknown records merge tag aliases across records and count each matching record once', () => {
  const records = [
    sound('alias_a', undefined, { tags: ['链接召唤', '连接召唤', 'Ｌｉｎｋ－２', '连接值2', '等级３', '素材数3'] }),
    sound('alias_b', undefined, { tags: ['连接召唤', 'Link 2', '等级 3', '素材数4'] }),
    sound('alias_c', undefined, { tags: ['链接召唤', 'link-3', '实际超量素材数 3'] }),
  ];
  const before = JSON.stringify(records);
  const view = buildFacetView(records, emptyFacetSelection(), '');
  const labels = view.groups.find(group => group.id === 'other')!.options.map(candidate => candidate.value);
  assert.deepEqual(new Set(labels), new Set(['连接召唤', 'Link 2', 'Link 3', '等级 3', '素材数3', '素材数4', '实际超量素材数 3']));
  assert.equal(option(view, 'other', '连接召唤')?.count, 3);
  assert.equal(option(view, 'other', 'Link 2')?.count, 2);
  assert.equal(option(view, 'other', '等级 3')?.count, 2);
  const chosenAliases = buildFacetView(records, chosen({ other: ['连接值２', 'link-2'] }), '');
  assert.deepEqual(chosenAliases.selection.groups.other, ['Link 2']);
  assert.deepEqual(chosenAliases.records.map(record => record.id), ['alias_a', 'alias_b']);
  assert.equal(option(chosenAliases, 'other', 'Link 3')?.count, 1);
  assert.deepEqual(buildFacetView(records, chosen({ other: ['素材数4'] }), '').records.map(record => record.id), ['alias_b']);
  assert.equal(buildFacetView(records, emptyFacetSelection(), 'Link 2').records.length, 2);
  assert.equal(JSON.stringify(records), before);
});

test('custom case and fullwidth variants preserve readable first spelling and selection across scope changes', () => {
  const first = sound('first', undefined, { tags: ['BossCue', 'ＢｏｓｓＣｕｅ', 'constructor'] });
  const second = sound('second', undefined, { tags: ['bosscue', 'ＢＯＳＳＣＵＥ'] });
  const full = buildFacetView([first, second], chosen({ other: ['ＢＯＳＳＣＵＥ'] }), '');
  assert.deepEqual(full.selection.groups.other, ['BossCue']);
  assert.equal(option(full, 'other', 'BossCue')?.count, 2);
  assert.equal(option(full, 'other', 'bosscue'), undefined);
  assert.equal(option(full, 'other', 'constructor')?.count, 1);
  const scoped = buildFacetView([second], full.selection, '');
  assert.deepEqual(scoped.selection.groups.other, ['bosscue']);
  assert.deepEqual(scoped.records.map(record => record.id), ['second']);
  assert.equal(option(scoped, 'other', 'bosscue')?.selected, true);
  const noResults = buildFacetView([second], full.selection, 'no_such_record');
  assert.deepEqual(noResults.selection.groups.other, ['bosscue']);
  assert.equal(option(noResults, 'other', 'bosscue')?.count, 0);
  assert.equal(option(noResults, 'other', 'bosscue')?.disabled, false);
  assert.equal(normalizeFacetTag('连接值２'), normalizeFacetTag('Ｌｉｎｋ－２'));
  assert.equal(normalizeFacetTag('ＢＯＳＳＣＵＥ'), normalizeFacetTag('BossCue'));
});

test('search keeps internal identifiers and metadata searchable with NFKC, case folding and summon aliases', () => {
  const record = sound('reference_id', metadata({ summon: ['连接召唤'], level: ['Link 1'] }), { originalName: 'SE_TEST_CARD', tags: ['11422', 'SummonLink01_01TL'], title: '卡名甲', description: '用来切入' });
  for (const query of ['１１４２２ ｓｅ＿ｔｅｓｔ', '链接召唤 卡名甲', 'REFERENCE_ID', 'summonlink01_01tl', 'Link 1 用来切入']) {
    assert.equal(buildFacetView([record], emptyFacetSelection(), query).records.length, 1, query);
  }
  assert.equal(buildFacetView([record], emptyFacetSelection(), '11422 不存在').records.length, 0);
});

test('music and voice hide sound-effect types but retain applicable metadata groups', () => {
  for (const kind of ['music', 'voice'] as const) {
    const record = sound(kind, metadata({ types: [], purposes: {}, summon: [], attribute: [], cardType: [], confirmation: ['资料归类'], displayForm: '碎片片段' }), { kind });
    const view = buildFacetView([record], chosen({ confirmation: ['资料归类'] }, { type: '召唤方式' }), '');
    assert.equal(view.hasSfx, false);
    assert.deepEqual(view.availableTypes, []);
    assert.equal(view.selection.type, '');
    assert.equal(view.records.length, 1);
    assert.ok(option(view, 'confirmation', '资料归类'));
  }
});

test('an effect type in a mixed library excludes music and voice with the same fallback taxonomy', () => {
  const fallback = metadata({ types: ['其他音效'], purposes: { 其他音效: [] }, summon: [], attribute: [], cardType: [] });
  const records = [sound('effect', fallback), sound('music', fallback, { kind: 'music' }), sound('voice', fallback, { kind: 'voice' })];
  assert.equal(buildFacetView(records, emptyFacetSelection(), '').records.length, 3);
  const view = buildFacetView(records, chosen({}, { type: '其他音效' }), '');
  assert.deepEqual(view.records.map(record => record.id), ['effect']);
  assert.equal(option(view, 'confirmation', '已确认')?.count, 1);
});

test('menu announcement stays visible as a disabled zero-count candidate', () => {
  const record = sound('menu', metadata({ types: ['菜单'], purposes: { 菜单: ['按钮'] }, summon: [], attribute: [], cardType: [] }));
  const view = buildFacetView([record], chosen({}, { type: '菜单' }), '');
  assert.deepEqual(option(view, 'purpose', '公告'), { value: '公告', count: 0, selected: false, disabled: true });
  assert.match(view.groups.find(group => group.id === 'purpose')?.note || '', /暂无已确认映射/);
});

test('legacy records without facets remain usable without property guesses, and filtering does not mutate data', () => {
  const legacy = sound('legacy', undefined, { tags: ['灰流丽', '自用'], form: '独立片段' });
  const records = [legacy];
  const selection = chosen({ other: ['自用'] }, { form: '碎片片段' });
  const before = JSON.stringify([records, selection]);
  const view = buildFacetView(records, selection, '灰流丽');
  assert.equal(view.records[0], legacy);
  assert.deepEqual(view.groups.map(group => group.id), ['other']);
  assert.equal(view.availableTypes.length, 0);
  assert.equal(JSON.stringify([records, selection]), before);
  const first = emptyFacetSelection();
  first.groups.other.push('test');
  assert.deepEqual(emptyFacetSelection().groups.other, []);
});
