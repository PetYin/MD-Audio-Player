import { useEffect, useState } from 'react';
import { Check, ChevronDown, FileAudio, FolderOpen, Heart, PanelRightClose, RotateCcw, Save, Tags } from 'lucide-react';
import type { AudioRecord, MetadataPatch } from '../shared/contracts';
import Waveform from './Waveform';
import { categoryKey, kindNames, parseTags, time } from './utils';
import { isInternalTag } from './tags';

interface Props { records: AudioRecord[]; categories: string[][]; busy: boolean; onEdit: (patch: MetadataPatch) => Promise<boolean>; onClose: () => void; onReveal: (id: string) => void; }
export default function Editor({ records, categories, busy, onEdit, onClose, onReveal }: Props) {
  const record = records.length === 1 ? records[0] : null;
  const internalTags = record?.tags.filter(tag => isInternalTag(tag, record.originalName)) || [];
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('[]');
  const [tags, setTags] = useState('');
  const [removeTags, setRemoveTags] = useState('');
  const [changeCategory, setChangeCategory] = useState(false);
  const [saved, setSaved] = useState(false);
  const identity = records.map(item => item.id).join(',');
  const signature = record ? JSON.stringify([record.title, record.category, record.tags]) : '';
  useEffect(() => { setTitle(record?.title || ''); setCategory(categoryKey(record?.category || [])); setTags(record?.tags.join(', ') || ''); setRemoveTags(''); setChangeCategory(false); setSaved(false); }, [identity, signature]);
  const save = async () => {
    const patch: MetadataPatch = record ? { title, category: JSON.parse(category) as string[], tags: parseTags(tags) } : { addTags: parseTags(tags), removeTags: parseTags(removeTags), ...(changeCategory ? { category: JSON.parse(category) as string[] } : {}) };
    if (await onEdit(patch)) { setSaved(true); window.setTimeout(() => setSaved(false), 1800); }
  };
  return <aside className="editor-panel" aria-label="音频编辑面板">
    <div className="editor-heading"><span className="eyebrow">{records.length > 1 ? 'BATCH EDITOR' : 'SOUND DETAILS'}</span><button className="icon-button" onClick={onClose} title="收起详情" aria-label="收起详情"><PanelRightClose size={18} /></button></div>
    {records.length === 0 ? <div className="editor-empty"><Tags size={36} strokeWidth={1} /><h3>为每个声音<br />找到自己的位置。</h3><p>选择音频以修改名称、分类和标签。按住 Ctrl 或 Shift 可多选。</p><div className="key-hint"><kbd>Enter</kbd><span>试听选中音频</span></div><div className="key-hint"><kbd>Space</kbd><span>播放 / 暂停</span></div></div> : <>
      <div className="detail-art"><span className="detail-art-label">{record ? kindNames[record.kind] : `${records.length} 条音频`}</span>{record ? <Waveform peaks={record.peaks} bars={54} progress={1} /> : <Tags size={46} strokeWidth={1} />}<span className="detail-art-caption">{record ? `${record.sampleRate ? `${(record.sampleRate / 1000).toFixed(1)} kHz` : '—'} / ${record.channels ? `${record.channels} CH` : '—'} / ${time(record.duration)}` : '共同整理 · 独立保存'}</span></div>
      <div className="editor-scroll"><div className="detail-title"><h2>{record ? record.title || '未命名音频' : `已选择 ${records.length} 条声音`}</h2>{record && <span className={`badge ${record.modified ? 'badge-accent' : ''}`}>{record.modified ? '已自定义' : '原始分类'}</span>}</div>
        {record?.status !== 'ready' && record && <p className="inline-warning">{record.description || '这条音频目前不可播放。重新扫描后可重试提取。'}</p>}
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          {record && <label className="field"><span>显示名称</span><input aria-label="显示名称" value={title} onChange={event => setTitle(event.target.value)} placeholder="给这条声音起个名字" maxLength={200} /></label>}
          <label className="field"><span className="field-label-row">主分类{!record && <span className="tiny-check"><input type="checkbox" aria-label="同时修改分类" checked={changeCategory} onChange={event => setChangeCategory(event.target.checked)} />同时修改</span>}</span><div className="select-wrap"><select aria-label="主分类" value={category} disabled={!record && !changeCategory} onChange={event => setCategory(event.target.value)}><option value="[]">未分类</option>{categories.filter(path => path.length).map(path => <option key={categoryKey(path)} value={categoryKey(path)}>{path.join(' / ')}</option>)}</select><ChevronDown size={14} /></div></label>
          <label className="field"><span>{record ? '标签' : '添加标签'}</span><textarea aria-label={record ? '标签' : '添加标签'} value={tags} rows={3} onChange={event => setTags(event.target.value)} placeholder="例如：召唤, 高能, 经常试听" /><small>使用逗号分隔；留空可{record ? '清空标签' : '保留已有标签'}。</small></label>
          {record && parseTags(tags).length > 0 && <div className="tag-preview">{parseTags(tags).map(tag => <span key={tag}>#{tag}</span>)}</div>}
          {!record && <label className="field"><span>移除标签</span><input aria-label="移除标签" value={removeTags} onChange={event => setRemoveTags(event.target.value)} placeholder="输入要从所选声音移除的标签" /></label>}
          <button className="button button-primary save-button" type="submit" disabled={busy}>{saved ? <Check size={16} /> : <Save size={16} />}{saved ? '已保存' : '保存修改'}</button>
        </form>
        <div className="editor-quick"><button className="button button-subtle" disabled={busy} onClick={() => void onEdit({ favorite: !records.every(item => item.favorite) })}><Heart size={15} fill={records.every(item => item.favorite) ? 'currentColor' : 'none'} />{records.every(item => item.favorite) ? '取消收藏' : '加入收藏'}</button><button className="button button-subtle" disabled={busy} onClick={() => void onEdit({ reset: true })}><RotateCcw size={14} />恢复默认</button></div>
        {record && <details className="technical-details"><summary>文件信息<ChevronDown size={14} /></summary><dl><dt>原始名称</dt><dd>{record.originalName}</dd>{internalTags.length > 0 && <><dt>内部标识</dt><dd>{internalTags.join(' · ')}</dd></>}<dt>资源状态</dt><dd>{record.status === 'ready' ? '可离线播放' : '不可用'}</dd><dt>来源数量</dt><dd>{record.sourceCount}</dd><dt>声音 ID</dt><dd className="mono">{record.id}</dd><dt>导入时间</dt><dd>{record.importedAt ? new Date(record.importedAt).toLocaleString('zh-CN') : '—'}</dd></dl>{record.description && <p>{record.description}</p>}<button className="button button-subtle" disabled={!record.mediaId} onClick={() => onReveal(record.id)}><FolderOpen size={14} />打开资产位置</button></details>}
        <p className="editor-footnote"><FileAudio size={13} />标注独立保存，原始音频始终保留。</p>
      </div>
    </>}
  </aside>;
}
