import type { EngineRecord } from '../shared/contracts';
import { isInternalTag } from '../src/tags';

type CardNameInput = Pick<EngineRecord, 'id' | 'kind' | 'title' | 'originalName' | 'category' | 'tags'>;
const readable = (value: string) => value.normalize('NFKC').trim();
const identity = (value: string) => readable(value).toLocaleLowerCase('zh-CN');
const unresolved = new Set(['卡名待确认', '待确认', '未标注', '用途待确认']);

/** Only explicit legacy structures and explicit personal labels establish names. */
export function recordCardNameTags(record: CardNameInput, effectiveTags: string[] = record.tags): string[] {
  const valid = (value: string) => !!value && !unresolved.has(value) && !/^卡名\s*:/.test(value)
    && !isInternalTag(value, readable(record.originalName));
  const generatedTags = new Set(record.tags.map(identity));
  const evidence = new Map<string, string>();
  const addEvidence = (value: string) => {
    const name = readable(value);
    if (valid(name) && generatedTags.has(identity(name))) evidence.set(identity(name), name);
  };
  if (record.kind === 'sfx') {
    const category = record.category.map(readable);
    if (/^event_card_cutin_attribute_\d+$/.test(record.id)
      && category.length === 3 && category[0] === '决斗音效' && category[1] === '卡片切入' && category[2] === '按卡名') {
      const title = readable(record.title);
      const suffix = ' · 切入音层';
      if (title.endsWith(suffix)) addEvidence(title.slice(0, -suffix.length));
    }
    if (category.length === 4 && category[0] === '决斗音效' && category[1] === '卡片专属效果'
      && ['卡片发动与处理', '特殊胜利'].includes(category[2])) addEvidence(category[3]);
  }
  const names = new Map<string, string>();
  for (const tag of effectiveTags) {
    const label = readable(tag);
    const explicit = /^卡名\s*:\s*(.*)$/.exec(label);
    const candidate = explicit ? readable(explicit[1]) : evidence.get(identity(label));
    if (candidate && valid(candidate) && !names.has(identity(candidate))) names.set(identity(candidate), candidate);
  }
  return [...names.values()];
}
