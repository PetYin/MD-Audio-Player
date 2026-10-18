import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronDown, ChevronRight, CircleAlert, Folder, FolderPlus, Headphones, Heart, Library, LoaderCircle, Mic2, Music2, PanelRightOpen, Pencil, Plus, Search, Settings2, SlidersHorizontal, ShieldCheck, Upload, X } from 'lucide-react';
import type { AudioKind, AudioRecord, ImportProgress, Installation, MetadataPatch, ScanMode, Snapshot, ThemeId } from '../shared/contracts';
import { CategoryDialog, ExportDialog, Onboarding, ProgressPanel, ScanDialog, SettingsDialog } from './Dialogs';
import Editor from './Editor';
import LibraryList from './LibraryList';
import Player, { type PlaybackRequest } from './Player';
import { bytes, categoryKey, errorMessage, isImporting, kindNames, stageNames } from './utils';
import { applyTheme } from './themes';
import { buildFacetView, emptyFacetSelection, type FacetSelection } from './facets';
import { FacetPanel } from './FacetPanel';
import Creditlist from './Creditlist';

type Filter = { type: 'unavailable' } | { type: 'all' } | { type: 'favorite' } | { type: 'kind'; kind: AudioKind } | { type: 'category'; path: string[] };
type Dialog = 'settings' | 'credits' | 'progress' | 'category' | 'export' | 'scan' | null;
type Sort = 'name' | 'newest' | 'shortest' | 'longest';
type Notice = { id: number; text: string; error: boolean };

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [bootError, setBootError] = useState('');
  const [filter, setFilter] = useState<Filter>({ type: 'all' });
  const [search, setSearch] = useState('');
  const [facetSelection, setFacetSelection] = useState(emptyFacetSelection);
  const [sort, setSort] = useState<Sort>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editingCategory, setEditingCategory] = useState<string[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [chosen, setChosen] = useState<Installation | null>(null);
  const [scanTarget, setScanTarget] = useState<Installation | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('latest');
  const [detecting, setDetecting] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [request, setRequest] = useState<PlaybackRequest | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSequence = useRef(0);
  const notifiedJob = useRef('');
  const notify = useCallback((text: string, error = false) => setNotice({ id: Date.now(), text, error }), []);
  const onError = useCallback((text: string) => notify(text, true), [notify]);
  const refresh = useCallback(async () => { const sequence = ++refreshSequence.current; const data = await window.md.snapshot(); if (sequence === refreshSequence.current) setSnapshot(data); return data; }, []);
  const task = useCallback(async (action: () => Promise<void>) => { setBusy(true); try { await action(); return true; } catch (error) { onError(errorMessage(error)); return false; } finally { setBusy(false); } }, [onError]);

  useEffect(() => {
    if (!window.md) { setBootError('请通过 MD 音效播放器桌面程序打开。浏览器预览无法访问本地资产。'); return; }
    let alive = true;
    const unsubscribeProgress = window.md.onProgress(value => { if (alive) setProgress(value); });
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribeLibrary = window.md.onLibraryChanged(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void refresh().catch(error => onError(errorMessage(error))); }, 250); });
    void refresh().then(data => { if (alive) setVolume(data.settings.volume); }).catch(error => { if (alive) setBootError(errorMessage(error)); });
    void window.md.importStatus().then(value => { if (alive && value) { setProgress(value); if (isImporting(value)) setDialog('progress'); } }).catch(error => onError(errorMessage(error)));
    void window.md.detectInstallations().then(value => { if (alive) { setInstallations(value.filter(item => item.valid)); setChosen(value.find(item => item.valid) || null); } }).catch(error => onError(errorMessage(error))).finally(() => { if (alive) setDetecting(false); });
    return () => { alive = false; unsubscribeProgress(); unsubscribeLibrary(); clearTimeout(refreshTimer); };
  }, [refresh, onError]);
  useEffect(() => { if (snapshot) applyTheme(snapshot.settings.theme); }, [snapshot?.settings.theme]);
  useEffect(() => { setScanMode(snapshot?.settings.scanMode || 'latest'); }, [snapshot?.settings.scanMode]);
  useEffect(() => {
    if (!progress || isImporting(progress) || notifiedJob.current === `${progress.jobId}:${progress.stage}`) return;
    notifiedJob.current = `${progress.jobId}:${progress.stage}`;
    setCancelling(false);
    void refresh().catch(error => onError(errorMessage(error)));
    notify(`${stageNames[progress.stage]} · 成功 ${progress.imported} 条，重复音频记录 ${progress.duplicates} 条，失败 ${progress.failures} 条`, progress.stage === 'failed' || progress.failures > 0);
  }, [progress, refresh, notify, onError]);
  useEffect(() => { if (!notice || notice.error) return; const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => () => { if (volumeTimer.current) clearTimeout(volumeTimer.current); }, []);

  const records = snapshot?.records || [];
  const readyRecords = useMemo(() => records.filter(record => record.status === 'ready'), [records]);
  const unavailableCount = records.length - readyRecords.length;
  const categories = useMemo(() => {
    const paths = new Map<string, string[]>();
    for (const path of [...(snapshot?.categories || []), ...records.map(record => record.category)]) for (let length = 1; length <= path.length; length++) paths.set(categoryKey(path.slice(0, length)), path.slice(0, length));
    return [...paths.values()].sort((a, b) => a.join('/').localeCompare(b.join('/'), 'zh-CN'));
  }, [snapshot]);
  const baseRecords = useMemo(() => records.filter(record => {
      if (filter.type === 'unavailable' ? record.status === 'ready' : record.status !== 'ready') return false;
      if (filter.type === 'favorite' && !record.favorite) return false;
      if (filter.type === 'kind' && record.kind !== filter.kind) return false;
      if (filter.type === 'category' && !filter.path.every((part, i) => record.category[i] === part)) return false;
      return true;
    }), [records, filter]);
  const facetView = useMemo(() => buildFacetView(baseRecords, facetSelection, search, records), [baseRecords, facetSelection, search, records]);
  const effectiveFacets = facetView.selection;
  const facetKey = JSON.stringify(effectiveFacets);
  useEffect(() => {
    if (JSON.stringify(facetSelection) !== facetKey) {
      setFacetSelection(effectiveFacets);
      setSelected(new Set());
      anchor.current = null;
    }
  }, [facetSelection, effectiveFacets, facetKey]);
  const hasFacetFilters = !!effectiveFacets.type || !!effectiveFacets.form || Object.values(effectiveFacets.groups).some(values => values.length > 0);
  const filtered = useMemo(() => [...facetView.records].sort((a, b) => sort === 'newest' ? b.importedAt.localeCompare(a.importedAt) || a.title.localeCompare(b.title, 'zh-CN') : sort === 'shortest' ? a.duration - b.duration : sort === 'longest' ? b.duration - a.duration : a.title.localeCompare(b.title, 'zh-CN')), [facetView.records, sort]);
  const selectedRecords = useMemo(() => records.filter(record => selected.has(record.id)), [records, selected]);
  const exporting = selectedRecords.length ? selectedRecords : filtered;
  const importing = isImporting(progress);
  const onboarding = !!snapshot && !snapshot.settings.onboardingComplete && records.length === 0;
  const changeFilter = (next: Filter) => {
    setFilter(next);
    // Opening a category should show its contents, without filters from the previous view.
    if (next.type === 'category') { setSearch(''); setFacetSelection(emptyFacetSelection()); }
    setSelected(new Set());
    anchor.current = null;
  };
  const changeSearch = (value: string) => { setSearch(value); setSelected(new Set()); anchor.current = null; };
  const changeFacets = (next: FacetSelection) => { setFacetSelection(next); setSelected(new Set()); anchor.current = null; };
  const resetFacets = () => { changeSearch(''); changeFacets(emptyFacetSelection()); };
  const select = (id: string, multiple: boolean, range: boolean) => {
    setEditorOpen(true);
    setSelected(previous => {
      if (range && anchor.current) {
        const first = filtered.findIndex(record => record.id === anchor.current);
        const last = filtered.findIndex(record => record.id === id);
        if (first >= 0 && last >= 0) return new Set([...(multiple ? previous : []), ...filtered.slice(Math.min(first, last), Math.max(first, last) + 1).map(record => record.id)]);
      }
      anchor.current = id;
      if (!multiple) return new Set([id]);
      const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });
  };
  const play = (id: string) => { setRequest({ id, serial: performance.now() }); };
  const onCurrent = useCallback((id: string | null, active: boolean) => { setCurrentId(id); setPlaying(active); }, []);
  const edit = (patch: MetadataPatch) => task(async () => { await window.md.edit([...selected], patch); await refresh(); });
  const favorite = (record: AudioRecord) => { void task(async () => { await window.md.edit([record.id], { favorite: !record.favorite }); await refresh(); }); };
  const choose = () => { void task(async () => { const installation = await window.md.chooseGame(); if (installation) { setChosen(installation); if (!installation.valid) onError(installation.message); } }); };
  const startImport = (path: string) => { if (busy || importing) return; void task(async () => { await window.md.startImport(path, { scanMode }); setDialog('progress'); setCancelling(false); await refresh(); const status = await window.md.importStatus(); if (status) setProgress(status); }); };
  const prepareImport = (path: string) => { if (busy || importing) return; void task(async () => { const installation = await window.md.inspectInstallation(path); if (!installation.valid) throw new Error(installation.message); setScanTarget(installation); setScanMode(snapshot?.settings.scanMode || 'latest'); setDialog('scan'); }); };
  const changeGame = () => { if (busy || importing) return; void task(async () => { const installation = await window.md.chooseGame(); if (!installation) return; setChosen(installation); if (!installation.valid) throw new Error(installation.message); setScanTarget(installation); setScanMode(snapshot?.settings.scanMode || 'latest'); setDialog('scan'); }); };
  const rescan = () => { const path = snapshot?.settings.gamePath || chosen?.path; if (path) prepareImport(path); else changeGame(); };
  const setTheme = (theme: ThemeId) => { void task(async () => { const settings = await window.md.settings({ theme }); setSnapshot(previous => previous ? { ...previous, settings } : previous); }); };
  const setPlayerVolume = (value: number) => { setVolume(value); if (volumeTimer.current) clearTimeout(volumeTimer.current); volumeTimer.current = setTimeout(() => { void window.md.settings({ volume: value }).catch(error => onError(errorMessage(error))); }, 200); };
  const createCategory = (path: string[]) => { void task(async () => { if (editingCategory) await window.md.renameCategory(editingCategory, path); else await window.md.createCategory(path); await refresh(); if (editingCategory && filter.type === 'category' && categoryKey(filter.path) === categoryKey(editingCategory)) setFilter({ type: 'category', path }); setDialog(null); notify(editingCategory ? '分类名称已更新' : '新分类已创建'); }); };
  const exportAudio = (format: 'source' | 'editing') => { void task(async () => { const result = await window.md.exportAudio(exporting.filter(record => record.status === 'ready').map(record => record.id), format); if (result.cancelled) return; setDialog(null); notify(`已导出 ${result.count} 条音频${result.errors.length ? `。${result.errors.length} 条失败：${result.errors.join('；')}` : ''}`, result.errors.length > 0); }); };

  if (!snapshot) return <div className="boot-screen"><Brand /><div className="boot-center">{bootError ? <CircleAlert size={38} strokeWidth={1.2} /> : <LoaderCircle className="spin" size={32} />}<h1>{bootError ? '暂时无法打开资料库' : '正在打开声音资料库'}</h1><p>{bootError || '每个声音，都有自己的位置。'}</p>{bootError && window.md && <button className="button" onClick={() => window.location.reload()}>重新加载</button>}</div></div>;
  const title = filter.type === 'unavailable' ? '未就绪动作' : filter.type === 'all' ? '所有声音' : filter.type === 'favorite' ? '我的收藏' : filter.type === 'kind' ? kindNames[filter.kind] : filter.path.at(-1) || '所有声音';
  return <div className={`app-shell ${onboarding ? 'onboarding-shell' : ''}`}>
    <aside className="sidebar"><Brand /><div className="sidebar-section-label">WORKSPACE<span className="live-dot" /></div><nav className="main-nav" aria-label="资料库导航"><button className={filter.type === 'all' ? 'selected' : ''} onClick={() => changeFilter({ type: 'all' })}><Library size={18} /><span>所有声音</span><b>{readyRecords.length.toLocaleString()}</b></button><button className={filter.type === 'favorite' ? 'selected' : ''} onClick={() => changeFilter({ type: 'favorite' })}><Heart size={18} /><span>我的收藏</span>{readyRecords.some(record => record.favorite) && <b>{readyRecords.filter(record => record.favorite).length.toLocaleString()}</b>}</button><div className="nav-divider" />{(['sfx', 'music', 'voice'] as AudioKind[]).map(kind => <button key={kind} className={filter.type === 'kind' && filter.kind === kind ? 'selected' : ''} onClick={() => changeFilter({ type: 'kind', kind })}>{kind === 'sfx' ? <AudioLines size={18} /> : kind === 'music' ? <Music2 size={18} /> : <Mic2 size={18} />}<span>{kindNames[kind]}</span><small>{readyRecords.filter(record => record.kind === kind).length.toLocaleString()}</small></button>)}<button className={filter.type === 'unavailable' ? 'selected' : ''} onClick={() => changeFilter({ type: 'unavailable' })}><CircleAlert size={18} /><span>未就绪动作</span><small>{unavailableCount.toLocaleString()}</small></button></nav>
      <div className="sidebar-section-label category-section-label">我的分类<button className="icon-button" title="新建分类" aria-label="新建分类" onClick={() => { setEditingCategory(null); setDialog('category'); }}><Plus size={16} /></button></div><nav className="category-nav" aria-label="分类导航">{categories.length === 0 ? <button className="empty-categories" onClick={() => { setEditingCategory(null); setDialog('category'); }}><FolderPlus size={16} />建立你的第一个分类</button> : categories.filter(path => !path.slice(0, -1).some((_, index) => collapsed.has(categoryKey(path.slice(0, index + 1))))).map(path => {
        const key = categoryKey(path); const hasChildren = categories.some(other => other.length === path.length + 1 && path.every((part, i) => other[i] === part));
        return <div key={key} className={`category-item ${filter.type === 'category' && categoryKey(filter.path) === key ? 'selected' : ''}`} style={{ paddingLeft: `${12 + (path.length - 1) * 14}px` }}><button className={`category-toggle ${hasChildren ? '' : 'no-children'}`} aria-label={collapsed.has(key) ? '展开分类' : '折叠分类'} disabled={!hasChildren} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>{collapsed.has(key) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button><button className="category-select" onClick={() => changeFilter({ type: 'category', path })}><Folder size={14} /><span title={path.join(' / ')}>{path.at(-1)}</span></button><button className="category-rename" title="重命名分类" aria-label={`重命名 ${path.join(' / ')}`} onClick={() => { setEditingCategory(path); setDialog('category'); }}><Pencil size={12} /></button></div>;
      })}</nav><div className="sidebar-bottom"><div className="local-storage"><span className="storage-icon"><Headphones size={17} /></span><div><strong>你的本地声音库</strong><span>{bytes(snapshot.assetBytes)} · 随时离线试听</span></div></div><button className="settings-nav" onClick={() => setDialog('settings')}><Settings2 size={17} /><span>设置与偏好</span><span className="version-label">v{snapshot.version}</span></button></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>MD SOUND ARCHIVE</span><ChevronRight size={13} /><span>{onboarding ? '开始' : '资料库'}</span></div><div className="topbar-right"><span className="offline-pill"><span />本地资料库</span><button className="icon-button" title="设置" aria-label="打开设置" onClick={() => setDialog('settings')}><SlidersHorizontal size={17} /></button></div></header>
      {onboarding ? <Onboarding installations={installations} chosen={chosen} detecting={detecting} busy={busy || importing} scanMode={scanMode} onScanMode={setScanMode} onChoose={choose} onSelect={setChosen} onImport={() => chosen && startImport(chosen.path)} onSkip={() => { void task(async () => { await window.md.settings({ onboardingComplete: true }); await refresh(); }); }} /> : <>
        <div className="library-heading"><div><div className="eyebrow">LISTEN. ORGANIZE. COLLECT.</div><h1>{title}<span className="heading-dot">.</span></h1><p>{filtered.length.toLocaleString()} 条声音<span> / </span>{filter.type === 'unavailable' ? '素材或配方未就绪 · 选择条目查看原因' : filter.type === 'favorite' ? '随时重温喜欢的声音' : filter.type === 'category' ? filter.path.join(' / ') : '游戏内听到的一切'}</p></div><div className="library-actions"><button className="button" disabled={!exporting.length || busy} onClick={() => setDialog('export')}><ArrowDownToLine size={16} />导出音频</button><button className="button button-primary" disabled={busy} onClick={() => importing ? setDialog('progress') : snapshot.settings.gamePath ? rescan() : changeGame()}>{importing ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />}{importing ? '正在导入' : '导入声音'}</button></div></div>
        {progress && <button className={`import-banner ${importing ? 'is-importing' : ''}`} onClick={() => setDialog('progress')}><span className="import-banner-icon">{importing ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}</span><strong>{stageNames[progress.stage]}</strong><span>{importing ? progress.message : `${progress.imported} 条成功 · ${progress.duplicates} 条重复音频记录 · ${progress.failures} 条失败`}</span>{importing && <span className="mini-progress"><i style={{ width: `${progress.total ? Math.min(100, progress.current / progress.total * 100) : 15}%` }} /></span>}<ChevronRight size={15} /></button>}
        <div className="library-toolbar"><label className="search-box"><Search size={17} /><input type="search" value={search} onChange={event => changeSearch(event.target.value)} placeholder="搜索声音、标签或分类…" aria-label="搜索声音" />{search && <button className="icon-button" onClick={() => changeSearch('')} aria-label="清除搜索"><X size={14} /></button>}</label><div className="toolbar-select sort-filter"><select value={sort} onChange={event => setSort(event.target.value as Sort)} aria-label="排序"><option value="name">名称排序</option><option value="newest">最近导入</option><option value="shortest">时长从短到长</option><option value="longest">时长从长到短</option></select><ChevronDown size={13} /></div><button className={`icon-button editor-toggle ${editorOpen ? 'active' : ''}`} onClick={() => setEditorOpen(!editorOpen)} title="切换详情面板" aria-label="切换详情面板"><PanelRightOpen size={18} /></button></div>
        <FacetPanel view={facetView} selection={effectiveFacets} query={search} onChange={changeFacets} onReset={resetFacets} />
        {selected.size > 0 && <div className="selection-bar"><span><Check size={13} />已选择 {selected.size} 条</span><button onClick={() => setEditorOpen(true)}>批量编辑</button><button onClick={() => setDialog('export')}>导出所选</button><button className="clear-selection" onClick={() => setSelected(new Set())}><X size={13} />取消选择</button></div>}
        <div className="library-body">{readyRecords.length === 0 && filter.type === 'all' && !search && !hasFacetFilters ? <div className="first-empty"><div className="empty-sound-art"><AudioLines size={52} strokeWidth={1} /></div><span className="eyebrow">A SPACE FOR EVERY SOUND</span><h2>资料库已就绪，等待第一段声音。</h2><p>从大师决斗导入本地资源，<br />让喜欢的音效和音乐触手可及。</p><button className="button button-primary" disabled={busy || importing} onClick={snapshot.settings.gamePath ? rescan : changeGame}><Upload size={16} />导入游戏声音<ArrowRight size={15} /></button></div> : <LibraryList records={filtered} resetKey={JSON.stringify([filter, search, effectiveFacets, sort])} selected={selected} currentId={currentId} playing={playing} onSelect={select} onAll={() => setSelected(previous => filtered.every(record => previous.has(record.id)) ? new Set() : new Set(filtered.map(record => record.id)))} onPlay={play} onFavorite={favorite} />}{editorOpen && <Editor records={selectedRecords} categories={categories} busy={busy} onEdit={edit} onClose={() => setEditorOpen(false)} onReveal={id => { void task(() => window.md.revealAsset(id)); }} />}</div>
        <div className="library-status"><span>{filtered.length.toLocaleString()} {filter.type === 'unavailable' ? '条未就绪动作' : '条声音'}<span className="status-divider">·</span>{readyRecords.length.toLocaleString()} 条可播放</span><span><ShieldCheckSmall />源文件只读</span></div>
      </>}
    </main>
    <Player records={records} queue={filtered} request={request} volume={volume} onVolume={setPlayerVolume} onError={onError} onCurrent={onCurrent} onFavorite={favorite} />
    {notice && <NoticePortal notice={notice} dialog={dialog} onClose={() => setNotice(null)} />}
    {dialog === 'settings' && <SettingsDialog onCredits={() => setDialog('credits')} snapshot={snapshot} busy={busy} importing={importing} onClose={() => setDialog(null)} onTheme={setTheme} onChangeGame={changeGame} onRescan={rescan} onMetadataExport={() => { void task(async () => { if (await window.md.exportMetadata()) notify('个人标注已导出'); }); }} onMetadataImport={() => { void task(async () => { const count = await window.md.importMetadata(); if (count !== null) { await refresh(); notify(`已恢复 ${count} 条个人标注`); } }); }} />}
    {dialog === 'credits' && <Creditlist onClose={() => setDialog('settings')} />}
    {dialog === 'scan' && scanTarget && <ScanDialog installation={scanTarget} scanMode={scanMode} onScanMode={setScanMode} busy={busy || importing} onClose={() => { if (!busy) setDialog(null); }} onImport={() => startImport(scanTarget.path)} />}
    {dialog === 'progress' && progress && <ProgressPanel progress={progress} busy={busy} cancelling={cancelling} onCancel={() => { setCancelling(true); void task(() => window.md.cancelImport()).then(ok => { if (!ok) setCancelling(false); }); }} onClose={() => setDialog(null)} onRetry={rescan} />}
    {dialog === 'category' && <CategoryDialog categories={categories} editing={editingCategory} busy={busy} onClose={() => setDialog(null)} onSave={createCategory} />}
    {dialog === 'export' && <ExportDialog records={exporting} busy={busy} onClose={() => { if (!busy) setDialog(null); }} onExport={exportAudio} />}
  </div>;
}

function Brand() { return <div className="brand"><div className="brand-symbol"><AudioLines size={25} strokeWidth={1.6} /></div><div><strong>MD<span>音效播放器</span></strong><small>SOUND ARCHIVE</small></div></div>; }
function ShieldCheckSmall() { return <ShieldCheck size={11} />; }
function NoticePortal({ notice, dialog, onClose }: { notice: Notice; dialog: Dialog; onClose: () => void }) {
  const [target, setTarget] = useState<HTMLElement>(document.body);
  // Native dialogs occupy the top layer; portal errors into it so they remain visible.
  useLayoutEffect(() => { setTarget(document.querySelector<HTMLDialogElement>('dialog[open]') || document.body); }, [dialog, notice]);
  return createPortal(<div className={`notice ${notice.error ? 'notice-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleAlert size={18} /> : <Check size={18} />}<span>{notice.text}</span><button className="icon-button" aria-label="关闭通知" onClick={onClose}><X size={15} /></button></div>, target);
}
