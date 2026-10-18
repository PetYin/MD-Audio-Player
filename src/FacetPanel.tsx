import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from 'lucide-react';
import { FACET_GROUP_IDS, FORM_OPTIONS, normalizeFacetSearch, normalizeFacetTag, type FacetGroup, type FacetGroupId, type FacetSelection, type FacetView } from './facets';

interface TagLookupProps {
  group: FacetGroup;
  query: string;
  onQuery: (query: string) => void;
  onToggle: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** A searchable multi-select: typing narrows existing choices without creating tags. */
function TagLookup({ group, query, onQuery, onToggle, inputRef }: TagLookupProps) {
  const isCard = group.id === 'cardName';
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number } | null>(null);
  const control = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const normalize = isCard ? normalizeFacetSearch : normalizeFacetTag;
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = group.options.filter(option => terms.every(term => normalize(option.value).includes(term)));
  const activeIndex = matches.findIndex(option => option.value === active && !option.disabled);
  const accessibleLabel = isCard ? '查找卡名标签' : '查找其他标签';
  useLayoutEffect(() => {
    if (!open || !control.current) return;
    const update = () => {
      if (!control.current) return;
      const rect = control.current.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const down = below >= Math.min(200, above);
      const width = Math.min(Math.max(rect.width, 280), innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), width,
        maxHeight: Math.max(64, Math.min(260, (down ? below : above) - 5)),
        ...(down ? { top: rect.bottom + 5 } : { bottom: innerHeight - rect.top + 5 }),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !active || !menu.current) return;
    [...menu.current.querySelectorAll<HTMLElement>('[data-facet-value]')].find(node => node.dataset.facetValue === active)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  return <div ref={control} className="facet-lookup" onKeyDownCapture={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(null); }
  }} onBlurCapture={event => {
    const target = event.relatedTarget;
    if (!(target instanceof Node) || (!control.current?.contains(target) && !menu.current?.contains(target))) { setOpen(false); setActive(null); }
  }}>
    <div className="facet-lookup-input"><Search size={13} /><input ref={inputRef} type="search" role="combobox" aria-label={accessibleLabel} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} data-focus-key={isCard ? 'card-search' : 'other-search'} value={query} placeholder={isCard ? '输入卡名…' : '输入已有标签的关键词…'} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => { onQuery(event.target.value); setOpen(true); setActive(null); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(null); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setOpen(true);
        const enabled = matches.filter(option => !option.disabled);
        if (!enabled.length) return;
        const index = enabled.findIndex(option => option.value === active);
        const next = index < 0 ? event.key === 'ArrowDown' ? 0 : enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
        setActive(enabled[next].value);
      } else if (event.key === 'Enter' && open && activeIndex >= 0) { event.preventDefault(); onToggle(matches[activeIndex].value); }
    }} />{query && <button type="button" aria-label={isCard ? '清除卡名查找' : '清除标签查找'} onMouseDown={event => event.preventDefault()} onClick={() => { onQuery(''); setActive(null); setOpen(true); inputRef.current?.focus(); }}><X size={12} /></button>}</div>
    {open && position && createPortal(<div ref={menu} className="facet-lookup-menu" style={position}>
      <div className="facet-lookup-status" role="status">{matches.length ? `${matches.length.toLocaleString('zh-CN')} 个候选 · 可多选` : isCard ? '没有匹配的已有卡名' : '没有匹配的已有标签'}</div>
      <div className="facet-lookup-options" id={listId} role="listbox" aria-label={isCard ? '卡名候选' : '其他标签候选'} aria-multiselectable="true">
        {matches.map((option, index) => <button type="button" role="option" tabIndex={-1} id={`${listId}-${index}`} key={option.value} className={`facet-lookup-option ${active === option.value ? 'is-active' : ''}`} data-facet-group={group.id} data-facet-value={option.value} aria-selected={option.selected} aria-label={`${group.label}：${option.value}，${option.count.toLocaleString('zh-CN')} 条`} disabled={option.disabled} onMouseDown={event => event.preventDefault()} onClick={() => { setActive(option.value); onToggle(option.value); }}><span className="facet-lookup-check">{option.selected && <Check size={12} />}</span><span className="facet-lookup-label">{option.value}</span><span className="facet-count">{option.count.toLocaleString('zh-CN')}</span></button>)}
      </div>
    </div>, document.body)}
  </div>;
}

export interface FacetPanelProps {
  view: FacetView;
  selection: FacetSelection;
  query: string;
  onChange: (next: FacetSelection) => void;
  onReset: () => void;
}

export function FacetPanel({ view, query, onChange, onReset }: FacetPanelProps) {
  const selection = view.selection;
  const [expanded, setExpanded] = useState(true);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [otherQuery, setOtherQuery] = useState('');
  const [cardQuery, setCardQuery] = useState('');
  const panel = useRef<HTMLElement>(null);
  const form = useRef<HTMLSelectElement>(null);
  const otherSearch = useRef<HTMLInputElement>(null);
  const cardSearch = useRef<HTMLInputElement>(null);
  const focusAfterUpdate = useRef<{ key: string; group?: FacetGroupId } | null>(null);
  const bodyId = useId();
  const count = FACET_GROUP_IDS.reduce((total, id) => total + selection.groups[id].length, 0);
  const hasFilters = !!query || !!selection.type || !!selection.form || count > 0;
  const cardGroup = view.groups.find(group => group.id === 'cardName');
  const inlineGroups = view.groups.filter(group => group.id !== 'cardName');
  const change = (next: FacetSelection, key: string, group?: FacetGroupId) => {
    focusAfterUpdate.current = { key, group };
    onChange(next);
  };
  const changeGroup = (id: FacetGroupId, values: string[], key: string) => change({ ...selection, groups: { ...selection.groups, [id]: values } }, key, id);
  useLayoutEffect(() => {
    const pending = focusAfterUpdate.current;
    if (!pending || !panel.current) return;
    focusAfterUpdate.current = null;
    const controls = [...panel.current.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('[data-focus-key]')];
    const target = controls.find(node => node.dataset.focusKey === pending.key && !node.disabled)
      || (pending.group && controls.find(node => node.dataset.facetGroup === pending.group && !node.disabled))
      || (pending.group === 'other' && otherSearch.current)
      || (pending.group === 'cardName' && cardSearch.current);
    (target || form.current || panel.current.querySelector<HTMLButtonElement>('.facet-panel-toggle'))?.focus({ preventScroll: true });
  }, [view, expanded, otherExpanded]);

  const chips = [
    ...(selection.type ? [{ key: 'type', label: `种类：${selection.type}`, remove: () => change({ ...selection, type: '' }, 'chip:type') }] : []),
    ...(selection.form ? [{ key: 'form', label: `形式：${selection.form}`, remove: () => change({ ...selection, form: '' }, 'chip:form') }] : []),
    ...view.groups.flatMap(group => selection.groups[group.id].map(value => ({
      key: `${group.id}:${value}`, label: `${group.label}：${value}`,
      remove: () => changeGroup(group.id, selection.groups[group.id].filter(selected => selected !== value), `chip:${group.id}:${value}`),
    }))),
  ];

  return <section ref={panel} className={`facet-panel ${expanded ? 'is-expanded' : 'is-collapsed'}`} aria-label="标签筛选">
    <div className="facet-panel-heading">
      <button type="button" className="facet-panel-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(!expanded)}>
        <SlidersHorizontal size={15} /><strong>筛选标签</strong><span className="facet-multi-hint">{count ? `已选 ${count}` : '可多选'}</span>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <span className="facet-summary">同组满足任一，跨组同时满足</span>
      {cardGroup && <div className="facet-card-control" role="group" aria-label="卡名标签筛选"><span className="facet-card-label">卡名标签筛选</span><TagLookup group={cardGroup} query={cardQuery} onQuery={setCardQuery} inputRef={cardSearch} onToggle={value => changeGroup('cardName', selection.groups.cardName.includes(value) ? selection.groups.cardName.filter(selected => selected !== value) : [...selection.groups.cardName, value], 'card-search')} /><button type="button" className="facet-card-clear" aria-label="清空卡名标签" data-clear-facet="cardName" disabled={!selection.groups.cardName.length} onClick={() => changeGroup('cardName', [], 'card-search')}>清空</button></div>}
      {hasFilters && <button type="button" className="facet-reset" onClick={() => { focusAfterUpdate.current = { key: 'reset' }; setOtherQuery(''); setCardQuery(''); onReset(); }}>清除筛选<X size={12} /></button>}
    </div>
    {expanded && <div className="facet-workbench" id={bodyId}>
      <div className="facet-scope">
        <span className="facet-scope-title">选择范围</span>
        {view.hasSfx && <label className="facet-scope-field">种类<select aria-label="种类" value={selection.type} disabled={!view.availableTypes.length} onChange={event => onChange({ ...selection, type: event.target.value })}>
          <option value="">全部种类</option>{view.availableTypes.map(type => <option key={type}>{type}</option>)}
        </select></label>}
        <label className="facet-scope-field">音效形式<select ref={form} aria-label="音效形式" value={selection.form} onChange={event => onChange({ ...selection, form: event.target.value })}>
          <option value="">全部形式</option>{FORM_OPTIONS.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <p className="facet-scope-help">完整音效 · 片段 · 碎片片段</p>
      </div>
      <div className="facet-groups" aria-label="可选标签">
        {inlineGroups.map(group => {
          return <section className={`facet-group ${group.id === 'other' ? 'facet-group-other' : ''}`} role="group" aria-label={group.label} key={group.id}>
          <div className="facet-group-heading">
            {group.id === 'other' ? <button type="button" className="facet-other-toggle" data-focus-key="other-toggle" aria-expanded={otherExpanded} aria-controls={`${bodyId}-other`} onClick={() => { if (!otherExpanded) focusAfterUpdate.current = { key: 'other-search' }; setOtherExpanded(!otherExpanded); }}><span>{group.label}</span>{otherExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button> : <h3>{group.label}</h3>}
            <button type="button" className="facet-clear" disabled={!selection.groups[group.id].length} aria-label={`清空${group.label}标签`} data-focus-key={`clear:${group.id}`} data-clear-facet={group.id} onClick={() => changeGroup(group.id, [], `clear:${group.id}`)}>清空</button>
          </div>
          {group.id !== 'other' || otherExpanded ? <div className="facet-group-content" id={group.id === 'other' ? `${bodyId}-other` : undefined}>
            {group.id === 'other' ? <TagLookup group={group} query={otherQuery} onQuery={setOtherQuery} inputRef={otherSearch} onToggle={value => changeGroup('other', selection.groups.other.includes(value) ? selection.groups.other.filter(selected => selected !== value) : [...selection.groups.other, value], 'other-search')} /> : <div className="facet-options">{group.options.map(option => <button type="button" key={option.value} className="facet-option" data-facet-group={group.id} data-facet-value={option.value} data-focus-key={`facet:${group.id}:${option.value}`} aria-pressed={option.selected} aria-label={`${group.label}：${option.value}，${option.count.toLocaleString('zh-CN')} 条`} disabled={option.disabled} onClick={() => changeGroup(group.id, option.selected ? selection.groups[group.id].filter(value => value !== option.value) : [...selection.groups[group.id], option.value], `facet:${group.id}:${option.value}`)}><span>{option.value}</span><span className="facet-count">{option.count.toLocaleString('zh-CN')}</span></button>)}</div>}
            {group.note && <p className="facet-note">{group.note}</p>}
          </div> : <button type="button" className="facet-other-summary" aria-label="展开其他标签" onClick={() => { focusAfterUpdate.current = { key: 'other-search' }; setOtherExpanded(true); }}>查找已有标签{selection.groups.other.length ? ` · 已选 ${selection.groups.other.length}` : ''}</button>}
        </section>; })}
        {!inlineGroups.length && <p className="facet-empty">当前范围暂无可用用途标签，可按名称或原资源名搜索。</p>}
      </div>
    </div>}
    {!!chips.length && <div className="facet-active-filters" aria-label="已选筛选条件">{chips.map(chip => <button type="button" key={chip.key} className="facet-active-filter" data-focus-key={`chip:${chip.key}`} aria-label={`移除筛选：${chip.label}`} onClick={chip.remove}>{chip.label}<X size={11} /></button>)}</div>}
  </section>;
}
