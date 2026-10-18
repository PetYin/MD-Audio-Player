import type { AudioKind, ImportProgress } from '../shared/contracts';

export const kindNames: Record<AudioKind, string> = { sfx: '音效', music: '音乐', voice: '语音' };
export const kindShort: Record<AudioKind, string> = { sfx: 'SFX', music: 'BGM', voice: 'VOX' };
export const time = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (value > 0 && value < 10) return `${value.toFixed(2)}s`;
  const minutes = Math.floor(value / 60);
  return `${minutes.toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
};
export const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
export const categoryKey = (path: string[]) => JSON.stringify(path);
export const parseTags = (value: string) => [...new Set(value.split(/[,，\n]/).map(v => v.trim()).filter(Boolean))];
export const isImporting = (progress: ImportProgress | null) => !!progress && !['complete', 'cancelled', 'failed'].includes(progress.stage);
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
export const stageNames: Record<ImportProgress['stage'], string> = {
  scanning: '发现声音', extracting: '提取资源', decoding: '解码音频', actions: '生成完整动作', complete: '导入完成', cancelled: '导入已取消', failed: '导入未完成',
};
