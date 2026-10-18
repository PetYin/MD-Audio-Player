import { useMemo } from 'react';

interface Props { peaks: number[]; progress?: number; className?: string; bars?: number; }
export default function Waveform({ peaks, progress = 0, className = '', bars = 48 }: Props) {
  const values = useMemo(() => {
    if (!peaks.length) return [];
    return Array.from({ length: Math.min(bars, peaks.length) }, (_, i) => {
      const start = Math.floor(i * peaks.length / Math.min(bars, peaks.length));
      const end = Math.floor((i + 1) * peaks.length / Math.min(bars, peaks.length));
      let peak = 0;
      for (let p = start; p < end; p++) peak = Math.max(peak, Math.abs(peaks[p] ?? 0));
      return Math.max(0.025, Math.min(1, peak));
    });
  }, [peaks, bars]);
  return <div className={`waveform ${className}`} aria-hidden="true">
    {values.length ? values.map((value, i) => <span key={i} className={i / values.length <= progress ? 'elapsed' : ''} style={{ height: `${value * 100}%` }} />) : <span className="wave-empty" />}
  </div>;
}
