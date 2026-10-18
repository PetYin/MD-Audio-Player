import type { RecordFacets } from './facet-types';

export type ThemeId = 'dark' | 'light' | 'duel';
export type AudioKind = 'sfx' | 'music' | 'voice';
export type ScanMode = 'all' | 'latest';
export interface ImportOptions { scanMode: ScanMode; }
export interface AudioRecord {
  id: string; mediaId: string | null; title: string; originalName: string;
  kind: AudioKind; form: string; category: string[]; tags: string[];
  favorite: boolean; duration: number; sampleRate: number; channels: number;
  peaks: number[]; status: 'ready' | 'unavailable' | 'failed';
  description: string; sourceCount: number; modified: boolean; importedAt: string;
  readonly facets?: RecordFacets;
  readonly cardNameTags?: string[];
}
export interface Settings { theme: ThemeId; gamePath: string; volume: number; onboardingComplete: boolean; scanMode: ScanMode; }
export interface Snapshot {
  records: AudioRecord[]; categories: string[][]; settings: Settings;
  libraryId: string; assetBytes: number; version: string;
}
export interface AccountDirectory { name: string; modifiedAt: number; modifiedNs: string; }
export interface Installation {
  path: string; valid: boolean; accounts: string[]; message: string;
  accountDirectories: AccountDirectory[]; latestAccount: string | null; selectionError: string | null;
}
export interface MetadataPatch {
  title?: string | null; category?: string[] | null; tags?: string[] | null;
  addTags?: string[]; removeTags?: string[]; favorite?: boolean; reset?: boolean;
}
export interface ImportProgress {
  jobId: string; stage: 'scanning' | 'extracting' | 'decoding' | 'actions' | 'complete' | 'cancelled' | 'failed';
  message: string; current: number; total: number; imported: number; duplicates: number;
  failures: number; errors?: string[];
}
export interface ExportResult { cancelled: boolean; count: number; directory?: string; errors: string[]; }
export interface PlayerApi {
  snapshot(): Promise<Snapshot>;
  detectInstallations(): Promise<Installation[]>;
  chooseGame(): Promise<Installation | null>;
  inspectInstallation(path: string): Promise<Installation>;
  startImport(path: string, options?: ImportOptions): Promise<string>;
  cancelImport(): Promise<void>;
  importStatus(): Promise<ImportProgress | null>;
  edit(ids: string[], patch: MetadataPatch): Promise<void>;
  createCategory(path: string[]): Promise<void>;
  renameCategory(path: string[], replacement: string[]): Promise<void>;
  exportAudio(ids: string[], format: 'source' | 'editing'): Promise<ExportResult>;
  exportMetadata(): Promise<boolean>;
  importMetadata(): Promise<number | null>;
  settings(patch: Partial<Settings>): Promise<Settings>;
  revealAsset(id: string): Promise<void>;
  onProgress(callback: (progress: ImportProgress) => void): () => void;
  onLibraryChanged(callback: () => void): () => void;
}
export interface EngineRecord {
  id: string; mediaId: string | null; title: string; originalName: string; kind: AudioKind;
  form: string; category: string[]; tags: string[]; duration: number; sampleRate: number;
  channels: number; peaks: number[]; status: 'ready' | 'unavailable' | 'failed';
  description: string; relativePath: string | null; bytes: number;
  sources: { key: string; bundle: string; account: string; payloadHash: string }[];
}
export type EngineEvent =
  | { type: 'progress'; stage: ImportProgress['stage']; message: string; current: number; total: number; imported: number; duplicates: number; failures: number }
  | { type: 'record'; record: EngineRecord }
  | { type: 'error'; message: string }
  | { type: 'done'; imported: number; duplicates: number; failures: number; cancelled: boolean };
declare global { interface Window { md: PlayerApi; } }
