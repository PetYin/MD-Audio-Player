import type { AudioRecord } from '../shared/contracts';

const normalize = (value: string) => value.trim().toLocaleLowerCase();

// Legacy libraries keep resource identifiers in tags. Hide only these known
// forms from the filter; retain the stored tags for editing and full-text search.
export function isInternalTag(tag: string, originalName = ''): boolean {
  const value = tag.trim();
  return /^\d+$/.test(value)
    || /^(?:卡片|伙伴)编号\s*\d+$/.test(value)
    || /^(?:MAT|GATE)\d+$/i.test(value)
    || /^(?:SE|BGM|V|VOICE)_[a-z0-9_]+$/i.test(value)
    || /^Summon[a-z0-9_]*TL$/i.test(value)
    || /^选择器\s*\d+$/.test(value)
    || (!!originalName && normalize(value) === normalize(originalName));
}

export function filterTags(records: Pick<AudioRecord, 'originalName' | 'tags'>[]): string[] {
  const originalNames = new Set(records.map(record => normalize(record.originalName)));
  return [...new Set(records.flatMap(record => record.tags))]
    .filter(tag => !isInternalTag(tag) && !originalNames.has(normalize(tag)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
