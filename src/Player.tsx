import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Heart, Pause, Play, Repeat1, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { AudioRecord } from '../shared/contracts';
import Waveform from './Waveform';
import { kindShort, time } from './utils';

export interface PlaybackRequest { id: string; serial: number; }
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
  const [loop, setLoop] = useState(false);
  const [pointA, setPointA] = useState<number | null>(null);
  const [pointB, setPointB] = useState<number | null>(null);
  const lastVolume = useRef(volume || 0.8);
  const current = records.find(record => record.id === currentId);
  const duration = nativeDuration || current?.duration || 0;
  const safePlay = useCallback(() => { void audio.current?.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) onError(`播放失败：${error instanceof Error ? error.message : String(error)}`); }); }, [onError]);

  useEffect(() => {
    if (!request) return;
    if (currentId === request.id) { if (audio.current?.paused) safePlay(); else audio.current?.pause(); }
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

  const navigate = (direction: number) => {
    const playable = queue.filter(record => record.status === 'ready');
    const source = playable.some(record => record.id === currentId) ? playable : records.filter(record => record.status === 'ready');
    if (!source.length) return;
    const index = source.findIndex(record => record.id === currentId);
    const target = source[(index + direction + source.length) % source.length];
    if (target.id === currentId) { if (audio.current) audio.current.currentTime = 0; safePlay(); }
    else setCurrentId(target.id);
  };
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
    <audio ref={audio} preload="auto" loop={loop && !abActive} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onLoadedMetadata={() => setNativeDuration(Number.isFinite(audio.current?.duration) ? audio.current!.duration : 0)}
      onTimeUpdate={() => { if (!audio.current) return; if (abActive && audio.current.currentTime >= pointB) audio.current.currentTime = pointA; setPosition(audio.current.currentTime); }}
      onEnded={() => { if (abActive && audio.current) { audio.current.currentTime = pointA; safePlay(); } else setPlaying(false); }}
      onError={() => { if (currentId) { setPlaying(false); onError('无法读取这条音频。请确认资产文件仍在播放器目录中，或重新扫描游戏资源。'); } }} />
    <div className={`now-art ${playing ? 'now-art-playing' : ''}`}><AudioLines size={26} strokeWidth={1.5} /></div>
    <div className="now-info"><strong title={current?.title}>{current ? current.title || '未命名音频' : '让声音，重现决斗。'}</strong><span>{current ? `${kindShort[current.kind]} · ${current.category.join(' / ') || '未分类'}` : '选择一条音频开始试听'}</span></div>
    <button className={`icon-button favorite-button ${current?.favorite ? 'active' : ''}`} disabled={!current} onClick={() => current && onFavorite(current)} title="收藏当前音频" aria-label="收藏当前音频"><Heart size={18} fill={current?.favorite ? 'currentColor' : 'none'} /></button>
    <div className="transport"><button className="icon-button" disabled={!records.some(r => r.status === 'ready')} onClick={() => navigate(-1)} title="上一条" aria-label="上一条"><SkipBack size={18} fill="currentColor" /></button><button className="play-main" disabled={!current} onClick={togglePlay} title={playing ? '暂停（空格）' : '播放（空格）'} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button><button className="icon-button" disabled={!records.some(r => r.status === 'ready')} onClick={() => navigate(1)} title="下一条" aria-label="下一条"><SkipForward size={18} fill="currentColor" /></button></div>
    <div className="timeline"><div className="seek-wave"><Waveform peaks={current?.peaks || []} bars={120} progress={duration ? position / duration : 0} />{pointA !== null && <span className="ab-marker" style={{ left: `${pointA / duration * 100}%` }}>A</span>}{pointB !== null && <span className="ab-marker" style={{ left: `${pointB / duration * 100}%` }}>B</span>}<input type="range" aria-label="播放进度" min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)} disabled={!current || !duration} onChange={event => seek(Number(event.target.value))} /></div><div className="timeline-times"><span>{time(position)}</span><span>{time(duration)}</span></div></div>
    <div className="audition-controls"><button className={`icon-button ${loop ? 'active' : ''}`} disabled={!current} onClick={() => setLoop(!loop)} aria-pressed={loop} title="单曲循环" aria-label="单曲循环"><Repeat1 size={19} /></button><div className={`ab-controls ${abActive ? 'active' : ''}`}><button disabled={!current || !duration} onClick={() => { setPointA(position); if (pointB !== null && position >= pointB) setPointB(null); }} title="将当前位置设为 A 点" aria-label="设置 A 点">A</button><span>—</span><button disabled={!current || pointA === null || position <= pointA} onClick={() => setPointB(position)} title="将当前位置设为 B 点，开始区间循环" aria-label="设置 B 点">B</button>{pointA !== null && <button className="ab-reset" onClick={() => { setPointA(null); setPointB(null); }} title="清除区间" aria-label="清除 A/B 区间"><X size={12} /></button>}</div></div>
    <div className="volume-control"><button className="icon-button" onClick={() => onVolume(volume === 0 ? lastVolume.current : 0)} title={volume ? '静音' : '恢复音量'} aria-label={volume ? '静音' : '恢复音量'}>{volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><input type="range" aria-label="音量" min={0} max={1} step={0.01} value={volume} onChange={event => onVolume(Number(event.target.value))} /></div>
  </footer>;
}
