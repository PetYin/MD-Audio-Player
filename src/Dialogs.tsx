import { useId, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronRight, CircleHelp, FolderOpen, HardDrive, LoaderCircle, Palette, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import type { AudioRecord, ImportProgress, Installation, ScanMode, Snapshot, ThemeId } from '../shared/contracts';
import Modal from './Modal';
import { bytes, categoryKey, isImporting, stageNames } from './utils';
import { themeOptions } from './themes';

const personalUseNotice = '导出的音频仅供个人、非商业使用。请勿再分发、上传或用于商业用途。';

function RightsNotice() {
  return <div className="rights-notice">
    <p>《游戏王：大师决斗》的音乐、音效、语音及相关名称、商标归 Konami 及相关权利人所有，包括 Studio Dice、集英社、东京电视台等，具体以官方权利声明为准。</p>
    <p className="rights-attribution">©2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI<br />©Konami Digital Entertainment</p>
    <p>本项目为非官方工具，与 Konami 及相关权利人没有隶属关系，未获其授权、赞助或认可。游戏及公司名称、商标仅用于说明兼容对象。</p>
    <p>MIT 许可仅覆盖本项目的原创代码；<code>engine/rules</code> 中的资源名、哈希、时序等游戏衍生数据不在该许可范围内。第三方组件保留各自许可。</p>
    <p><strong>{personalUseNotice}</strong>导出功能及本声明不构成游戏内容的使用授权。</p>
  </div>;
}

function ScanScope({ installation, scanMode, onScanMode, disabled }: { installation: Installation; scanMode: ScanMode; onScanMode: (mode: ScanMode) => void; disabled: boolean }) {
  const name = useId();
  const selectedAccounts = scanMode === 'all' ? installation.accounts : installation.latestAccount ? [installation.latestAccount] : [];
  const separator = installation.path.includes('\\') ? '\\' : '/';
  const root = installation.path.replace(/[\\/]$/, '');
  return <section className="scan-scope" aria-label="扫描范围">
    <div className="scan-scope-heading"><h3>扫描哪些账号目录？</h3><span>找到 {installation.accounts.length} 个账号目录</span></div>
    <fieldset className="scan-mode-options" disabled={disabled}><legend className="sr-only">扫描范围</legend>
      <label className={`scan-mode-option ${scanMode === 'latest' ? 'selected' : ''}`}><input type="radio" name={name} value="latest" aria-label="仅扫描最新目录" checked={scanMode === 'latest'} onChange={() => onScanMode('latest')} /><span><strong>仅扫描最新目录</strong><small>按 0000 目录修改时间选择，扫描更快。</small></span></label>
      <label className={`scan-mode-option ${scanMode === 'all' ? 'selected' : ''}`}><input type="radio" name={name} value="all" aria-label="扫描全部目录" checked={scanMode === 'all'} onChange={() => onScanMode('all')} /><span><strong>扫描全部目录</strong><small>包含每个账号的独有资源，扫描耗时更长。</small></span></label>
    </fieldset>
    {installation.selectionError && <p className="scan-selection-error" role="alert">{installation.selectionError}{scanMode === 'latest' && ' 无法确定最新目录，请处理目录访问问题后重试。'}</p>}
    <div className="scan-selected" aria-live="polite"><span className="scan-selected-label">{installation.accounts.length === 0 ? '没有账号目录，本次只扫描公共资源' : `本次选择 ${selectedAccounts.length} 个账号目录`}</span>
      {selectedAccounts.length > 0 && <ul className="scan-directories">{selectedAccounts.map(account => {
        const directory = installation.accountDirectories.find(item => item.name === account);
        const modified = directory && Number.isFinite(directory.modifiedAt) ? new Date(directory.modifiedAt).toLocaleString('zh-CN', { hour12: false }) : '无法读取';
        const directoryPath = [root, 'LocalData', account, '0000'].join(separator);
        return <li key={account}><code>{directoryPath}</code><small>0000 目录修改时间：{modified}</small></li>;
      })}</ul>}
      <p className="scan-public"><ShieldCheck size={13} />始终包含公共资源</p>
    </div>
    <p className="field-help">开始时会重新确认目录范围。{scanMode === 'latest' ? '最新目录为空时仅扫描公共资源，不改扫其他账号。' : '自动合并可复用的重复资源，保留各账号来源。'}</p>
  </section>;
}

export function ScanDialog({ installation, scanMode, onScanMode, busy, onClose, onImport }: { installation: Installation; scanMode: ScanMode; onScanMode: (mode: ScanMode) => void; busy: boolean; onClose: () => void; onImport: () => void }) {
  return <Modal title="选择扫描范围" eyebrow="IMPORT YOUR SOUNDS" onClose={onClose} wide>
    <div className="path-display"><span>大师决斗安装目录</span><code>{installation.path}</code></div>
    <ScanScope installation={installation} scanMode={scanMode} onScanMode={onScanMode} disabled={busy} />
    <p className="field-help">开始导入后记住此选择；已有音频、分类、标签和收藏会保留。</p>
    <div className="modal-actions"><button className="button" disabled={busy} onClick={onClose}>取消</button><button className="button button-primary" disabled={busy || !installation.valid || (scanMode === 'latest' && !!installation.selectionError)} onClick={onImport}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{busy ? '正在开始…' : '开始导入'}</button></div>
  </Modal>;
}

interface OnboardingProps { installations: Installation[]; chosen: Installation | null; detecting: boolean; busy: boolean; scanMode: ScanMode; onScanMode: (mode: ScanMode) => void; onChoose: () => void; onSelect: (installation: Installation) => void; onImport: () => void; onSkip: () => void; }
export function Onboarding({ installations, chosen, detecting, busy, scanMode, onScanMode, onChoose, onSelect, onImport, onSkip }: OnboardingProps) {
  return <div className="onboarding"><div className="onboarding-story"><span className="eyebrow">YOUR PERSONAL SOUND ARCHIVE</span><h1>每一次决斗，<br /><span>都值得被听见。</span></h1><p>将大师决斗中的声音，收进你的个人资料库。<br />试听、整理、收藏，重温每一段熟悉的声音。</p><div className="intro-signal" aria-hidden="true"><div className="signal-line" /><div className="signal-ring signal-ring-one" /><div className="signal-ring signal-ring-two" /><div className="signal-ring signal-ring-three" /><div className="signal-center">MD<span>SOUND ARCHIVE</span></div><span className="signal-coordinate coord-top">LOCAL / LOSSLESS</span><span className="signal-coordinate coord-bottom">READY TO RESONATE</span></div><div className="intro-promises"><span><ShieldCheck size={16} />游戏文件只读</span><span><HardDrive size={16} />资产本地保存</span></div><section className="onboarding-rights" aria-label="权利与使用说明"><h3>权利与使用说明</h3><RightsNotice /></section></div>
    <section className="onboarding-setup"><span className="step-label">01 <span>/ CONNECT YOUR LIBRARY</span></span><h2>从你的游戏开始</h2><p className="setup-description">选择 Master Duel 的安装文件夹，再选择要扫描的账号目录，将声音导入播放器。</p>
      {detecting && <div className="detecting"><LoaderCircle className="spin" size={17} />正在查找 Steam 安装目录…</div>}
      {installations.length > 0 && <div className="installation-list">{installations.map(installation => <button key={installation.path} className={`installation-option ${chosen?.path === installation.path ? 'chosen' : ''}`} disabled={busy} onClick={() => onSelect(installation)}><div className="installation-icon"><HardDrive size={21} /></div><div><strong>Master Duel <span>STEAM</span></strong><small title={installation.path}>{installation.path}</small></div>{chosen?.path === installation.path ? <CheckCircle2 size={19} /> : <ChevronRight size={18} />}</button>)}</div>}
      <button className="browse-installation" disabled={busy} onClick={onChoose}><FolderOpen size={22} /><span><strong>{chosen && !installations.some(item => item.path === chosen.path) ? '已选择安装目录' : '浏览安装文件夹'}</strong><small>{chosen && !installations.some(item => item.path === chosen.path) ? chosen.path : '选择包含 masterduel.exe 的文件夹'}</small></span><ChevronRight size={18} /></button>
      {chosen && <div className={`installation-validation ${chosen.valid ? 'valid' : 'invalid'}`}><ShieldCheck size={16} /><span>{chosen.valid ? `已找到 ${chosen.accounts.length} 个账号资源目录` : chosen.message}</span></div>}
      {chosen?.valid && <ScanScope installation={chosen} scanMode={scanMode} onScanMode={onScanMode} disabled={busy} />}
      <div className="import-explainer"><span>导入后你可以</span><ul><li><Check size={14} />离线试听音效、音乐与语音</li><li><Check size={14} />建立自己的分类和标签</li><li><Check size={14} />收藏喜欢的声音，方便再次试听</li></ul></div>
      <button className="button button-primary import-start" disabled={!chosen?.valid || busy || (scanMode === 'latest' && !!chosen?.selectionError)} onClick={onImport}>{busy ? <LoaderCircle size={17} className="spin" /> : '创建我的声音资料库'}<ArrowRight size={18} /></button><p className="setup-footnote">开始导入后记住扫描选择。耗时取决于所选目录的资源量。</p><button className="text-button onboarding-skip" disabled={busy} onClick={onSkip}>稍后导入，先看看播放器<ArrowRight size={13} /></button>
    </section>
  </div>;
}

export function ProgressPanel({ progress, busy, onCancel, cancelling, onClose, onRetry }: { progress: ImportProgress; busy: boolean; onCancel: () => void; cancelling: boolean; onClose: () => void; onRetry: () => void }) {
  const active = isImporting(progress);
  const percent = progress.total > 0 ? Math.min(100, Math.round(progress.current / progress.total * 100)) : null;
  return <Modal title={stageNames[progress.stage]} eyebrow="BRING YOUR SOUNDS HOME" onClose={onClose}><div className={`progress-emblem ${active ? 'is-active' : ''}`}>{active ? <LoaderCircle size={33} className="spin" /> : progress.stage === 'complete' ? <CheckCircle2 size={36} strokeWidth={1.5} /> : <CircleHelp size={36} strokeWidth={1.5} />}</div><p className="progress-message">{progress.message}</p><div className="progress-caption"><span>{active ? '可收起窗口，继续使用资料库' : '已导入的声音保存在本地'}</span><span>{percent === null ? '处理中' : `${percent}%`}</span></div><div className={`progress-track ${percent === null && active ? 'indeterminate' : ''}`}><span style={{ width: percent === null ? '30%' : `${percent}%` }} /></div><div className="progress-numbers"><div><strong>{progress.imported.toLocaleString()}</strong><span>成功导入</span></div><div><strong>{progress.duplicates.toLocaleString()}</strong><span>重复音频记录</span></div><div><strong className={progress.failures ? 'status-warning' : ''}>{progress.failures.toLocaleString()}</strong><span>需要重试</span></div></div>{progress.errors && progress.errors.length > 0 && <details className="import-errors"><summary>查看 {progress.errors.length} 条错误详情</summary><ul>{progress.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></details>}<div className="modal-actions">{active ? <><button className="button" disabled={cancelling} onClick={onCancel}>{cancelling ? '正在取消…' : '取消导入'}</button><button className="button button-primary" onClick={onClose}>在后台继续<ArrowRight size={15} /></button></> : <>{(progress.failures > 0 || progress.stage !== 'complete') && <button className="button" disabled={busy} onClick={onRetry}><RefreshCw size={15} />重新扫描</button>}<button className="button button-primary" onClick={onClose}>进入资料库<ArrowRight size={15} /></button></>}</div></Modal>;
}

interface SettingsProps { onCredits: () => void; snapshot: Snapshot; busy: boolean; importing: boolean; onClose: () => void; onTheme: (theme: ThemeId) => void; onChangeGame: () => void; onRescan: () => void; onMetadataExport: () => void; onMetadataImport: () => void; }
export function SettingsDialog({ onCredits, snapshot, busy, importing, onClose, onTheme, onChangeGame, onRescan, onMetadataExport, onMetadataImport }: SettingsProps) {
  return <Modal title="让播放器适合你" eyebrow="PREFERENCES" onClose={onClose} wide><section className="settings-section"><h3><Palette size={17} />界面主题</h3><div className="theme-options">{themeOptions.map(theme => <button key={theme.id} className={`theme-option ${snapshot.settings.theme === theme.id ? 'selected' : ''}`} onClick={() => onTheme(theme.id)} aria-pressed={snapshot.settings.theme === theme.id} disabled={busy}><div className={`theme-preview preview-${theme.id}`}><div className="preview-sidebar" /><div className="preview-content"><i /><i /><i /><i /></div><span className="preview-player" />{snapshot.settings.theme === theme.id && <span className="theme-check"><Check size={13} /></span>}</div><strong>{theme.name}</strong><small>{theme.caption}</small></button>)}</div></section><section className="settings-section"><h3><HardDrive size={17} />游戏与资产</h3><div className="path-display"><span>大师决斗安装目录</span><code>{snapshot.settings.gamePath || '尚未选择安装目录'}</code></div><div className="settings-buttons"><button className="button" disabled={busy || importing} onClick={onChangeGame}><FolderOpen size={15} />更换目录</button><button className="button" disabled={busy || importing || !snapshot.settings.gamePath} onClick={onRescan}><RefreshCw size={15} />扫描更新</button><span className="asset-size">本地资产 {bytes(snapshot.assetBytes)}</span></div><p className="field-help">已保存的扫描范围：{snapshot.settings.scanMode === 'all' ? '扫描全部目录' : '仅扫描最新目录'}。点击“扫描更新”可重新选择；已有音频、分类、标签和收藏会保留。</p></section><section className="settings-section"><h3><Upload size={17} />个人标注</h3><p className="field-help">将分类、标签、标题和收藏保存为 JSON，或恢复已有标注。</p><div className="settings-buttons"><button className="button" onClick={onMetadataExport} disabled={busy}><ArrowDownToLine size={15} />导出标注</button><button className="button" onClick={onMetadataImport} disabled={busy}><Upload size={15} />导入标注</button></div></section><section className="settings-section" aria-label="关于"><h3><CircleHelp size={17} />关于</h3><RightsNotice /><div className="settings-buttons"><button className="button" onClick={onCredits}>Creditlist · 第三方软件与致谢<ChevronRight size={15} /></button></div></section><div className="settings-footer"><span>MD 音效播放器 <b>v{snapshot.version}</b></span><span>本地管理 · 非官方工具</span></div></Modal>;
}

export function CategoryDialog({ categories, editing, busy, onClose, onSave }: { categories: string[][]; editing: string[] | null; busy: boolean; onClose: () => void; onSave: (path: string[]) => void }) {
  const [name, setName] = useState(editing?.at(-1) || '');
  const [parent, setParent] = useState(categoryKey(editing?.slice(0, -1) || []));
  const parentPath = JSON.parse(parent) as string[];
  const invalid = !name.trim() || /[\\/\u0000-\u001f]/.test(name);
  return <Modal title={editing ? '重命名分类' : '创建一个新分类'} eyebrow="ORGANIZE YOUR COLLECTION" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (!invalid) onSave([...parentPath, name.trim()]); }}><label className="field"><span>分类名称</span><input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="例如：我的常听音效" /></label><label className="field"><span>上级分类</span><select value={parent} onChange={event => setParent(event.target.value)} disabled={!!editing}><option value="[]">顶层分类</option>{categories.filter(path => path.length && path.length < 8).map(path => <option value={categoryKey(path)} key={categoryKey(path)}>{path.join(' / ')}</option>)}</select></label><p className="field-help">分类帮助你组织声音，不会移动或重命名资产文件。</p><div className="modal-actions"><button className="button" type="button" onClick={onClose}>取消</button><button className="button button-primary" disabled={invalid || busy} type="submit">{editing ? '保存名称' : '创建分类'}<Check size={15} /></button></div></form></Modal>;
}

export function ExportDialog({ records, busy, onClose, onExport }: { records: AudioRecord[]; busy: boolean; onClose: () => void; onExport: (format: 'source' | 'editing') => void }) {
  const [format, setFormat] = useState<'source' | 'editing'>('source');
  const count = records.filter(record => record.status === 'ready').length;
  return <Modal title="导出音频" eyebrow="EXPORT YOUR SELECTION" onClose={onClose}><p className="export-summary">已选择 <strong>{records.length}</strong> 条声音，将导出 <strong>{count}</strong> 条可用音频。</p><div className="export-formats"><button className={format === 'source' ? 'selected' : ''} onClick={() => setFormat('source')}><span className="radio-dot" /><div><strong>原始解码 WAV<span>保真</span></strong><p>保留原始采样率、声道及完整尾音。</p></div></button><button className={format === 'editing' ? 'selected' : ''} onClick={() => setFormat('editing')}><span className="radio-dot" /><div><strong>标准格式 WAV<span>48 kHz</span></strong><p>48 kHz · 24-bit · 双声道，统一音频格式。</p></div></button></div><p className="field-help">按当前分类建立导出文件夹。重名文件附加编号，已有文件不会被覆盖。</p><aside className="export-use-notice" aria-label="导出使用限制"><strong>仅限个人使用</strong><p>{personalUseNotice}</p><p>音频权利归 Konami 及相关权利人所有。导出功能及本声明不构成游戏内容的使用授权。</p></aside><div className="modal-actions"><button className="button" disabled={busy} onClick={onClose}>取消</button><button className="button button-primary" disabled={busy || !count} onClick={() => onExport(format)}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}{busy ? '正在导出…' : '选择位置并导出'}</button></div></Modal>;
}
