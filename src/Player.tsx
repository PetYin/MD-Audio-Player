import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Heart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { AudioRecord } from '../shared/contracts';
import Waveform from './Waveform';
import { kindShort, time } from './utils';
import { advance, continuesAfterEnd, emptyShuffle, nextMode, playModeOptions, rowRequest, type PlayMode } from './playback';

export interface PlaybackRequest { id: string; serial: number; }
const modeIcons = { list: Repeat, shuffle: Shuffle, one: Repeat1 } as const;
interface Props {
  records: AudioRecord[]; queue: AudioRecord[]; request: PlaybackRequest | null; volume: number;
  onVolume: (volume: number) => void; onError: (message: string) => void;
  onCurrent: (id: string | null, playing: boolean) => void; onFavorite: (record: AudioRecord) => void;
}

export default function Player({ records, queue, request, volume, onVolume, onError, onCurrent, onFavorite }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [nativeDuration, setNativeDuration] = useState(0);
  const [mode, setMode] = useState<PlayMode>('once');
  const [pointA, setPointA] = useState<number | null>(null);
  const [pointB, setPointB] = useState<number | null>(null);
  const lastVolume = useRef(volume || 0.8);
  // The play context, the list the current sound was started from; next/previous and list/shuffle playback stay inside it.
  const playContext = useRef<readonly string[]>([]);
  const shuffle = useRef(emptyShuffle());
  const current = records.find(record => record.id === currentId);
  const duration = nativeDuration || current?.duration || 0;
  const ready = useMemo(() => new Set(records.filter(record => record.status === 'ready').map(record => record.id)), [records]);
  const safePlay = useCallback(() => { void audio.current?.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) onError(`播放失败：${error instanceof Error ? error.message : String(error)}`); }); }, [onError]);

  useEffect(() => {
    if (!request) return;
    const result = rowRequest(mode, request.id, currentId, playContext.current, queue.map(record => record.id), shuffle.current);
    playContext.current = result.context; shuffle.current = result.shuffle;
    if (result.toggle) { if (audio.current?.paused) safePlay(); else audio.current?.pause(); }
    else setCurrentId(request.id);
    // A serial is a deliberate play/toggle request, independent of metadata refreshes.
  }, [request?.serial]);

  useEffect(() => {
    if (!currentId || !audio.current) return;
    setPosition(0); setNativeDuration(0); setPointA(null); setPointB(null);
    audio.current.src = `md-audio://asset/${encodeURIComponent(currentId)}`;
    audio.current.load();
    safePlay();
  }, [currentId, safePlay]);
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume)); if (volume > 0) lastVolume.current = volume; }, [volume]);
  useEffect(() => { onCurrent(currentId, playing); }, [currentId, playing, onCurrent]);

  const go = (direction: 1 | -1) => {
    const playable = (id: string) => ready.has(id);
    const target = advance(mode, direction, playContext.current, queue.map(record => record.id), [...ready], currentId, playable, shuffle.current);
    playContext.current = target.context; shuffle.current = target.shuffle;
    if (!target.id) return false;
    if (target.id === currentId) { if (audio.current) audio.current.currentTime = 0; safePlay(); }
    else setCurrentId(target.id);
    return true;
  };
  const chooseMode = (chosen: PlayMode) => { const next = nextMode(mode, chosen); if (next === 'shuffle') shuffle.current = emptyShuffle(); setMode(next); };
  const seek = (seconds: number) => { if (audio.current && duration) { audio.current.currentTime = seconds; setPosition(seconds); } };
  const togglePlay = useCallback(() => { if (!currentId) return; if (audio.current?.paused) safePlay(); else audio.current?.pause(); }, [currentId, safePlay]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,button,[contenteditable="true"]')) return;
      event.preventDefault(); togglePlay();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [togglePlay]);
  const abActive = pointA !== null && pointB !== null;
  useEffect(() => {
    if (!playing || !abActive) return;
    let frame: number;
    const tick = () => { if (audio.current && audio.current.currentTime >= pointB) audio.current.currentTime = pointA; frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pointA, pointB, abActive]);
  return <footer className="player-bar">
    <audio ref={audio} preload="auto" loop={mode === 'one' && !abActive} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onLoadedMetadata={() => setNativeDuration(Number.isFinite(audio.current?.duration) ? audio.current!.duration : 0)}
      onTimeUpdate={() => { if (!audio.current) return; if (abActive && audio.current.currentTime >= pointB) audio.current.currentTime = pointA; setPosition(audio.current.currentTime); }}
      onEnded={() => { if (abActive && audio.current) { audio.current.currentTime = pointA; safePlay(); } else if (!continuesAfterEnd(mode) || !go(1)) setPlaying(false); }}
      onError={() => { if (currentId) { setPlaying(false); onError('无法读取这条音频。请确认资产文件仍在播放器目录中，或重新扫描游戏资源。'); } }} />
    <div className={`now-art ${playing ? 'now-art-playing' : ''}`}><AudioLines size={26} strokeWidth={1.5} /></div>
    <div className="now-info"><strong title={current?.title}>{current ? current.title || '未命名音频' : '让声音，重现决斗。'}</strong><span>{current ? `${kindShort[current.kind]} · ${current.category.join(' / ') || '未分类'}` : '选择一条音频开始试听'}</span></div>
    <button className={`icon-button favorite-button ${current?.favorite ? 'active' : ''}`} disabled={!current} onClick={() => current && onFavorite(current)} title="收藏当前音频" aria-label="收藏当前音频"><Heart size={18} fill={current?.favorite ? 'currentColor' : 'none'} /></button>
    <div className="transport"><button className="icon-button" disabled={!ready.size} onClick={() => go(-1)} title="上一条" aria-label="上一条"><SkipBack size={18} fill="currentColor" /></button><button className="play-main" disabled={!current} onClick={togglePlay} title={playing ? '暂停（空格）' : '播放（空格）'} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button><button className="icon-button" disabled={!ready.size} onClick={() => go(1)} title="下一条" aria-label="下一条"><SkipForward size={18} fill="currentColor" /></button></div>
    <div className="timeline"><div className="seek-wave"><Waveform peaks={current?.peaks || []} bars={120} progress={duration ? position / duration : 0} />{pointA !== null && <span className="ab-marker" style={{ left: `${pointA / duration * 100}%` }}>A</span>}{pointB !== null && <span className="ab-marker" style={{ left: `${pointB / duration * 100}%` }}>B</span>}<input type="range" aria-label="播放进度" min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)} disabled={!current || !duration} onChange={event => seek(Number(event.target.value))} /></div><div className="timeline-times"><span>{time(position)}</span><span>{time(duration)}</span></div></div>
    <div className="audition-controls"><div className="play-modes" role="group" aria-label="播放模式">{playModeOptions.map(option => { const Icon = modeIcons[option.mode]; const active = mode === option.mode; return <button key={option.mode} className={`icon-button ${active ? 'active' : ''}`} disabled={!ready.size} onClick={() => chooseMode(option.mode)} aria-pressed={active} title={`${option.label}：${option.hint}${active ? '（再次点击关闭）' : ''}`} aria-label={option.label}><Icon size={19} /></button>; })}</div><div className={`ab-controls ${abActive ? 'active' : ''}`}><button disabled={!current || !duration} onClick={() => { setPointA(position); if (pointB !== null && position >= pointB) setPointB(null); }} title="将当前位置设为 A 点" aria-label="设置 A 点">A</button><span>—</span><button disabled={!current || pointA === null || position <= pointA} onClick={() => setPointB(position)} title="将当前位置设为 B 点，开始区间循环" aria-label="设置 B 点">B</button>{pointA !== null && <button className="ab-reset" onClick={() => { setPointA(null); setPointB(null); }} title="清除区间" aria-label="清除 A/B 区间"><X size={12} /></button>}</div></div>
    <div className="volume-control"><button className="icon-button" onClick={() => onVolume(volume === 0 ? lastVolume.current : 0)} title={volume ? '静音' : '恢复音量'} aria-label={volume ? '静音' : '恢复音量'}>{volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><input type="range" aria-label="音量" min={0} max={1} step={0.01} value={volume} onChange={event => onVolume(Number(event.target.value))} /></div>
  </footer>;
}
