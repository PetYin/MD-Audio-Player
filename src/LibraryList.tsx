import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { AudioLines, Heart, Pause, Play, Search, TriangleAlert } from 'lucide-react';
import type { AudioRecord } from '../shared/contracts';
import Waveform from './Waveform';
import { kindShort, time } from './utils';

interface Props {
  records: AudioRecord[]; selected: Set<string>; currentId: string | null; playing: boolean;
  resetKey: string;
  onSelect: (id: string, multiple: boolean, range: boolean) => void; onAll: () => void;
  onPlay: (id: string) => void; onFavorite: (record: AudioRecord) => void;
}
const ROW_HEIGHT = 76;
export default function LibraryList({ records, selected, currentId, playing, resetKey, onSelect, onAll, onPlay, onFavorite }: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => { const element = scroll.current; if (!element) return; const observer = new ResizeObserver(entries => setHeight(entries[0].contentRect.height)); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; setTop(0); }, [resetKey]);
  const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - 4);
  const end = Math.min(records.length, start + Math.ceil(height / ROW_HEIGHT) + 8);
  const all = records.length > 0 && records.every(record => selected.has(record.id));
  const stop = (event: MouseEvent) => event.stopPropagation();
  return <div className="library-table" role="table" aria-label="音频资料库" aria-rowcount={records.length + 1}>
    <div className="table-heading track-grid" role="row"><div role="columnheader"><input type="checkbox" aria-label="选择所有筛选结果" checked={all} onChange={onAll} /></div><span role="columnheader">声音名称<span className="table-count">{records.length.toLocaleString()}</span></span><span role="columnheader" className="wave-column">波形</span><span role="columnheader" className="category-column">分类</span><span role="columnheader" className="duration-column">时长</span><span /></div>
    <div className="virtual-scroll" ref={scroll} onScroll={event => setTop(event.currentTarget.scrollTop)}>
      {records.length === 0 ? <div className="empty-results"><Search size={32} strokeWidth={1.2} /><h3>还没有符合条件的声音</h3><p>尝试其他关键词，或清除筛选条件。</p></div> : <div className="virtual-spacer" style={{ height: records.length * ROW_HEIGHT }}>
        {records.slice(start, end).map((record, offset) => <div key={record.id} role="row" aria-rowindex={start + offset + 2} aria-selected={selected.has(record.id)} tabIndex={0} className={`track-row track-grid ${selected.has(record.id) ? 'selected' : ''} ${record.id === currentId ? 'current' : ''}`} style={{ top: (start + offset) * ROW_HEIGHT, height: ROW_HEIGHT }} onClick={event => onSelect(record.id, event.ctrlKey || event.metaKey, event.shiftKey)} onDoubleClick={() => record.status === 'ready' && onPlay(record.id)} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') { event.preventDefault(); if (record.status === 'ready') onPlay(record.id); } if (event.key === ' ') { event.preventDefault(); onSelect(record.id, true, event.shiftKey); } }}>
          <div role="cell" onClick={stop}><input type="checkbox" aria-label={`选择 ${record.title}`} checked={selected.has(record.id)} onChange={() => onSelect(record.id, true, false)} /></div>
          <div className="track-name-cell" role="cell"><button className={`track-icon kind-${record.kind}`} onClick={event => { stop(event); onPlay(record.id); }} disabled={record.status !== 'ready'} aria-label={`播放 ${record.title}`} title={record.status === 'ready' ? '播放' : '音频不可用'}>{record.status !== 'ready' ? <TriangleAlert size={18} /> : record.id === currentId && playing ? <Pause size={18} fill="currentColor" /> : <><AudioLines className="track-idle-icon" size={21} strokeWidth={1.6} /><Play className="track-hover-icon" size={17} fill="currentColor" /></>}</button><div className="track-text"><strong title={record.title}>{record.title || '未命名音频'}</strong><div className="track-meta"><span className={`kind-label kind-${record.kind}`}>{kindShort[record.kind]}</span>{record.form && <span className="form-label">{record.form}</span>}{record.tags.slice(0, 2).map(tag => <span className="track-tag" key={tag}>#{tag}</span>)}{record.tags.length > 2 && <span>+{record.tags.length - 2}</span>}{record.status !== 'ready' && <span className="status-warning">不可用</span>}</div></div></div>
          <div role="cell" className="wave-column"><Waveform peaks={record.peaks} bars={34} progress={record.id === currentId ? 1 : 0} /></div>
          <div role="cell" className="category-column category-cell" title={record.category.join(' / ')}><span>{record.category.at(-1) || '未分类'}</span>{record.category.length > 1 && <small>{record.category.slice(0, -1).join(' / ')}</small>}</div>
          <div role="cell" className="duration-column track-duration">{time(record.duration)}</div>
          <div role="cell"><button className={`icon-button row-favorite ${record.favorite ? 'active' : ''}`} onClick={event => { stop(event); onFavorite(record); }} aria-label={`${record.favorite ? '取消收藏' : '收藏'} ${record.title}`} title={record.favorite ? '取消收藏' : '收藏'}><Heart size={16} fill={record.favorite ? 'currentColor' : 'none'} /></button></div>
        </div>)}
      </div>}
    </div>
  </div>;
}
