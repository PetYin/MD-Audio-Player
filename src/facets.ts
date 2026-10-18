import type { AudioRecord } from '../shared/contracts';
import type { RecordFacets } from '../shared/facet-types';
import { isInternalTag } from './tags';

export const FACET_GROUP_IDS = ['purpose', 'summon', 'attribute', 'cardType', 'level', 'animation', 'confirmation', 'cardName', 'other'] as const;
export type FacetGroupId = typeof FACET_GROUP_IDS[number];
export interface FacetSelection { type: string; form: string; groups: Record<FacetGroupId, string[]>; }
export interface FacetOption { value: string; count: number; selected: boolean; disabled: boolean; }
export interface FacetGroup { id: FacetGroupId; label: string; options: FacetOption[]; note?: string; }
export interface FacetView {
  records: AudioRecord[];
  groups: FacetGroup[];
  availableTypes: string[];
  selection: FacetSelection;
  hasSfx: boolean;
}

export const FORM_OPTIONS = ['完整音效', '片段', '碎片片段'];
const TYPE_ORDER = ['特效切入', '召唤方式', '卡片相关', '菜单', '伙伴', '场地', '决斗过程', '其他演出', '其他音效'];
const ATTRIBUTES = ['暗', '光', '地', '水', '炎', '风', '神'];
const SUMMON_ORDER = ['通常召唤', '特殊召唤', '反转召唤', '仪式召唤', '融合召唤', '灵摆召唤', '超量召唤', '同调召唤', '连接召唤', '其他/共享'];
const GROUPS: { id: FacetGroupId; label: string; order?: string[] }[] = [
  { id: 'purpose', label: '用途' },
  { id: 'summon', label: '召唤方式', order: SUMMON_ORDER },
  { id: 'attribute', label: '属性', order: ATTRIBUTES },
  { id: 'cardType', label: '卡片类型', order: ['怪兽', '魔法', '陷阱'] },
  { id: 'level', label: '等级 / 连接值' },
  { id: 'animation', label: '演出' },
  { id: 'confirmation', label: '确认状态' },
  { id: 'cardName', label: '卡名标签筛选' },
  { id: 'other', label: '其他标签' },
];
const FORM_LABELS: Record<string, string> = { 完整动作: '完整音效', 动作主体: '片段', 独立片段: '碎片片段' };
const PURPOSE_ALIASES: Record<string, string> = { 手牌选择: '选择', 送墓与墓地: '送墓', 卡组送墓: '送墓', 卡片发动与处理: '效果处理' };
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function emptyFacetSelection(): FacetSelection {
  return { type: '', form: '', groups: { purpose: [], summon: [], attribute: [], cardType: [], level: [], animation: [], confirmation: [], cardName: [], other: [] } };
}

export function normalizeFacetSearch(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replaceAll('链接召唤', '连接召唤');
}

function unique(values: string[]): string[] { return [...new Set(values.map(value => value.trim()).filter(Boolean))]; }
function ordered(values: string[], order: string[] = []): string[] {
  return unique(values).sort((a, b) => {
    const rank = (value: string) => order.includes(value) ? order.indexOf(value) : order.length;
    return rank(a) - rank(b) || collator.compare(a, b);
  });
}
function friendlyTag(value: string): string {
  return Object.hasOwn(PURPOSE_ALIASES, value) ? PURPOSE_ALIASES[value] : Object.hasOwn(FORM_LABELS, value) ? FORM_LABELS[value] : value;
}
/** Canonical identity for tag aliases; stored user tags are never rewritten. */
export function normalizeFacetTag(value: string): string {
  const friendly = friendlyTag(value.normalize('NFKC').trim());
  const normalized = normalizeFacetSearch(/^[暗光地水炎风神]属性$/.test(friendly) ? friendly.slice(0, -2) : friendly);
  const link = /^(?:link[\s-]*|连接值\s*)(\d+)$/.exec(normalized);
  if (link) return `link ${link[1]}`;
  return normalized.replace(/^(等级值|等级|阶级)\s*(\d+)$/, '$1 $2');
}
function tagLabel(value: string, canonical: string): string {
  if (canonical === '连接召唤' || ATTRIBUTES.includes(canonical) || /^(等级值|等级|阶级) \d+$/.test(canonical)) return canonical;
  if (/^link \d+$/.test(canonical)) return canonical.replace(/^link/, 'Link');
  // Keep the first readable spelling/case for a custom label, while normalizing
  // compatibility characters and the known Chinese purpose/form aliases.
  return friendlyTag(value.normalize('NFKC').trim());
}
function metadataValues(facets?: RecordFacets): string[] {
  if (!facets) return [];
  return [...facets.types, ...Object.values(facets.purposes).flat(), ...facets.summon, ...facets.attribute,
    ...facets.cardType, ...facets.level, ...facets.animation, ...facets.confirmation, facets.displayForm];
}

/** Unknown legacy records expose their useful tags, without guessing card properties. */
function cardTagValue(value: string): string { return value.normalize('NFKC').trim().replace(/^卡名\s*:\s*/, '').trim(); }
function cardTagKey(value: string): string { return normalizeFacetSearch(cardTagValue(value)); }

function otherTags(record: AudioRecord, originalNames: Set<string>, labels: Map<string, string>, cardNames: Map<string, string>): string[] {
  const mapped = new Set([...metadataValues(record.facets), ...record.category, record.form].map(normalizeFacetTag));
  const result = new Set<string>();
  for (const tag of unique(record.tags)) {
    const canonical = normalizeFacetTag(tag);
    if (isInternalTag(normalizeFacetSearch(tag), normalizeFacetSearch(record.originalName))
      || isInternalTag(normalizeFacetSearch(cardTagValue(tag)), normalizeFacetSearch(record.originalName))
      || originalNames.has(normalizeFacetSearch(tag)) || mapped.has(canonical) || cardNames.has(cardTagKey(tag))) continue;
    if (!labels.has(canonical)) labels.set(canonical, tagLabel(tag, canonical));
    result.add(labels.get(canonical)!);
  }
  return [...result];
}

function groupValues(record: AudioRecord, id: FacetGroupId, type: string, other: string[], cardNames: string[]): string[] {
  const facets = record.facets;
  if (id === 'other') return other;
  if (id === 'cardName') return cardNames;
  if (!facets) return [];
  if (id === 'purpose') return unique(type ? facets.purposes[type] || [] : Object.values(facets.purposes).flat());
  if (id === 'attribute') {
    const known = facets.attribute.filter(attribute => ATTRIBUTES.includes(attribute));
    return known.length ? unique(known) : facets.cardType.some(value => value === '魔法' || value === '陷阱') ? [] : ['未标注'];
  }
  return unique(facets[id]);
}

/** The caller supplies its navigation scope; search never changes the candidate set. */
export function buildFacetView(baseRecords: AudioRecord[], requested: FacetSelection, query: string, libraryRecords: AudioRecord[] = baseRecords): FacetView {
  const hasSfx = baseRecords.some(record => record.kind === 'sfx');
  const availableTypes = hasSfx ? ordered(baseRecords.filter(record => record.kind === 'sfx').flatMap(record => record.facets?.types || []), TYPE_ORDER) : [];
  const type = availableTypes.includes(requested.type) ? requested.type : '';
  const scoped = type ? baseRecords.filter(record => record.kind === 'sfx' && record.facets?.types.includes(type)) : baseRecords;
  const originalNames = new Set(baseRecords.map(record => normalizeFacetSearch(record.originalName)));
  const otherLabels = new Map<string, string>();
  // The local library supplies the vocabulary. No bundled card-name index or
  // guesses from arbitrary Chinese titles/tags are used to create this group.
  const cardNames = new Map<string, string>();
  for (const record of libraryRecords) for (const name of record.cardNameTags || []) {
    const key = cardTagKey(name);
    if (key && !cardNames.has(key)) cardNames.set(key, cardTagValue(name));
  }
  const prepared = scoped.map(record => {
    const cards = unique(record.tags.flatMap(tag => cardNames.has(cardTagKey(tag)) ? [cardNames.get(cardTagKey(tag))!] : []));
    const other = otherTags(record, originalNames, otherLabels, cardNames);
    return {
      record,
      form: record.facets ? record.facets.displayForm : FORM_LABELS[record.form] || record.form,
      values: Object.fromEntries(FACET_GROUP_IDS.map(id => [id, groupValues(record, id, type, other, cards)])) as Record<FacetGroupId, string[]>,
      search: normalizeFacetSearch([record.id, record.title, record.originalName, record.description, record.form, record.kind,
        ({ sfx: '音效', music: '背景音乐', voice: '语音' } as const)[record.kind],
        ...record.category, ...record.tags, ...other, ...cards, ...metadataValues(record.facets)].join(' ')),
    };
  });
  const candidates = new Map<FacetGroupId, string[]>(GROUPS.map(({ id, order }) => {
    if (id === 'attribute' && !scoped.some(record => record.facets?.attribute.some(value => ATTRIBUTES.includes(value)))) return [id, []];
    const values = prepared.flatMap(item => item.values[id]);
    if (id === 'purpose' && type === '菜单') values.push('公告');
    return [id, ordered(values, order)];
  }));
  const selection: FacetSelection = {
    type,
    form: requested.form,
    groups: Object.fromEntries(FACET_GROUP_IDS.map(id => [id, unique((requested.groups[id] || [])
      .map(value => id === 'other' ? otherLabels.get(normalizeFacetTag(value)) || value : id === 'cardName' ? cardNames.get(cardTagKey(value)) || value : value))
      .filter(value => candidates.get(id)!.includes(value))])) as FacetSelection['groups'],
  };
  const terms = normalizeFacetSearch(query).split(/\s+/).filter(Boolean);
  const basicMatch = prepared.filter(item => (!selection.form || item.form === selection.form) && terms.every(term => item.search.includes(term)));
  const matches = (item: typeof prepared[number], except?: FacetGroupId) => FACET_GROUP_IDS.every(id => id === except || !selection.groups[id].length || item.values[id].some(value => selection.groups[id].includes(value)));
  const groups: FacetGroup[] = GROUPS.filter(({ id }) => candidates.get(id)!.length).map(({ id, label }) => {
    const counts = new Map<string, number>();
    for (const item of basicMatch) if (matches(item, id)) for (const value of item.values[id]) counts.set(value, (counts.get(value) || 0) + 1);
    return {
      id, label,
      options: candidates.get(id)!.map(value => {
        const count = counts.get(value) || 0;
        const selected = selection.groups[id].includes(value);
        return { value, count, selected, disabled: count === 0 && !selected };
      }),
      ...(id === 'purpose' && type === '菜单' ? { note: '公告暂无已确认映射；其余菜单提示保留原始用途。' } : {}),
    };
  });
  return { records: basicMatch.filter(item => matches(item)).map(item => item.record), groups, availableTypes, selection, hasSfx };
}
