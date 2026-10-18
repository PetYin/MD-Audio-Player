import metadataJson from '../shared/facet-metadata.json';
import type { EngineRecord } from '../shared/contracts';
import type { RecordFacets } from '../shared/facet-types';

interface FacetMetadataTable {
  schemaVersion: number;
  profiles: RecordFacets[];
  resources: Record<string, number>;
  actions: Record<string, { name: string; form: string; profile: number }>;
  resourceDefaults: Record<string, Pick<EngineRecord, 'title' | 'category' | 'tags' | 'description'>>;
}
// JSON imports infer a union of object keys with optional `undefined` entries;
// the generated table's vocabulary and complete profiles are checked in tests.
const metadata = metadataJson as unknown as FacetMetadataTable;
const purposeLabels = new Set(metadata.profiles.flatMap(profile => Object.values(profile.purposes).flat()));
const summonLabels = new Set(metadata.profiles.flatMap(profile => profile.summon));
const formLabels: Record<string, string> = { 完整动作: '完整音效', 动作主体: '片段', 独立片段: '碎片片段', 完整音效: '完整音效', 片段: '片段', 碎片片段: '碎片片段' };
const purposeAliases: Record<string, string> = { 手牌选择: '选择', 送墓与墓地: '送墓', 卡组送墓: '送墓', 卡片发动与处理: '效果处理' };
const friendlyPurpose = (value: string) => purposeAliases[value] || value;
const unique = (values: string[]) => [...new Set(values)];

function copyFacets(source: RecordFacets): RecordFacets {
  return {
    types: [...source.types], purposes: Object.fromEntries(Object.entries(source.purposes).map(([key, values]) => [key, [...values]])),
    summon: [...source.summon], attribute: [...source.attribute], cardType: [...source.cardType], level: [...source.level],
    animation: [...source.animation], confirmation: [...source.confirmation], displayForm: source.displayForm,
  };
}

type FacetInput = Pick<EngineRecord, 'id' | 'originalName' | 'kind' | 'form' | 'category' | 'sources'>;

function exactResourceKey(record: Pick<EngineRecord, 'originalName' | 'sources'>): string | null {
  const payloads = unique(record.sources.map(source => source.payloadHash));
  return payloads.length === 1 ? `${record.originalName}:${payloads[0]}` : null;
}

/** Correct only reviewed defaults, preserving stored rows and personal overrides. */
export function correctedRecordDefaults(record: EngineRecord): EngineRecord {
  const key = exactResourceKey(record);
  const defaults = key ? metadata.resourceDefaults[key] : undefined;
  return defaults ? { ...record, title: defaults.title, category: [...defaults.category], tags: [...defaults.tags], description: defaults.description } : record;
}

/** Uses generated metadata only: personal titles/categories/tags never imply card properties. */
function fallbackFacets(record: FacetInput): RecordFacets {
  const category = record.category.map(value => value.replaceAll('链接召唤', '连接召唤'));
  const has = (value: string) => category.includes(value);
  const purposes: Record<string, string[]> = {};
  const add = (type: string, labels: string[] = []) => { purposes[type] = unique([...(purposes[type] || []), ...labels]); };
  const safePurposes = category.map(friendlyPurpose).filter(value => purposeLabels.has(value));
  const isCardDraw = /CARD_DRAW/i.test(record.originalName);
  const summon = isCardDraw ? [] : unique(category.flatMap(value => value === '通常与特殊召唤' ? ['通常召唤', '特殊召唤'] : summonLabels.has(value) ? [value] : []));
  if (record.kind === 'sfx') {
    if (has('卡片切入')) add('特效切入', ['卡片登场']);
    if (has('卡片专属效果')) add('特效切入', has('特殊胜利') ? ['特殊胜利'] : has('卡片发动与处理') ? ['效果处理'] : ['其他效果']);
    if (!isCardDraw && (has('召唤与登场') || summon.length)) add('召唤方式', safePurposes.length ? safePurposes : [record.form === '动作主体' ? '召唤主体' : '召唤演出']);
    if (has('卡片操作') || has('卡组操作')) add('卡片相关', safePurposes);
    if (has('界面与其他演出')) {
      if (has('菜单与提示')) add('菜单', ['其他菜单提示']);
      else add('其他演出', safePurposes);
    }
    if (has('场地与伙伴')) {
      if (has('伙伴')) add('伙伴');
      if (has('场地')) add('场地');
    }
    if (has('决斗过程')) add('决斗过程', safePurposes);
  }
  if (!Object.keys(purposes).length) add('其他音效', record.kind === 'sfx' ? safePurposes : []);
  return {
    types: Object.keys(purposes), purposes, summon: record.kind === 'sfx' ? summon : [], attribute: [], cardType: [], level: [], animation: [],
    confirmation: ['待确认'], displayForm: formLabels[record.form] || '',
  };
}

/** Read-time enrichment works for old libraries without rewriting records or audio caches. */
export function recordFacets(record: FacetInput): RecordFacets {
  const action = metadata.actions[record.id];
  if (action && action.name === record.originalName && action.form === record.form) return copyFacets(metadata.profiles[action.profile]);
  // A logical raw resource has one payload. Mixed or missing provenance is not
  // sufficient evidence, even when one of its candidates is a known resource.
  const key = exactResourceKey(record);
  if (key && Object.hasOwn(metadata.resources, key)) return copyFacets(metadata.profiles[metadata.resources[key]]);
  return fallbackFacets(record);
}
