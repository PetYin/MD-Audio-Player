import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertWritableTarget } from './paths';
import type { AudioRecord, EngineRecord, MetadataPatch, Settings, Snapshot, ImportProgress } from '../shared/contracts';
import { backupSchema, engineRecordSchema, patchSchema, settingsSchema } from './validation';
import { correctedRecordDefaults, recordFacets } from './facet-metadata';
import { recordCardNameTags } from './card-name-tags';
import { version } from '../package.json';

const defaults: Settings = { theme: 'dark', gamePath: '', volume: .65, onboardingComplete: false, scanMode: 'latest' };
export class Library {
  readonly db: DatabaseSync;
  constructor(private filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,generated TEXT NOT NULL,imported_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,path TEXT NOT NULL,bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(record_id TEXT NOT NULL,key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(record_id,key));
      CREATE TABLE IF NOT EXISTS overrides(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS categories(path TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      PRAGMA user_version=1;`);
    if (!this.getValue('libraryId')) this.setValue('libraryId', randomUUID());
    const pending = this.lastJob();
    if (pending && !['complete','cancelled','failed'].includes(pending.stage)) this.saveJob({ ...pending, stage: 'cancelled', message: '上次导入已中断；再次扫描即可继续。' });
  }
  close() { this.db.close(); }
  private getValue(key: string): string | null { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? String(row.value) : null; }
  private setValue(key: string, value: string) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value); }
  getSettings(): Settings { return { ...defaults, ...settingsSchema.parse(JSON.parse(this.getValue('preferences') || '{}')) }; }
  updateSettings(patch: Partial<Settings>): Settings { const next = { ...this.getSettings(), ...settingsSchema.parse(patch) }; this.setValue('preferences',JSON.stringify(next)); return next; }
  gameRoots(): string[] { return JSON.parse(this.getValue('protectedGames') || '[]') as string[]; }
  protectGame(game: string) {
    const games=[...new Set([...this.gameRoots(),game])];const data=JSON.stringify(games);
    const target=assertWritableTarget(path.join(path.dirname(this.filename),'protected-games.json'),games);
    const temporary=assertWritableTarget(target+`.tmp-${process.pid}`,games);
    fs.writeFileSync(temporary,data,'utf8');fs.renameSync(temporary,target);
    this.setValue('protectedGames',data);
  }
  transaction(action: () => void) { this.db.exec('BEGIN IMMEDIATE'); try { action(); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  upsert(input: EngineRecord) {
    let record = engineRecordSchema.parse(input);
    if(record.status!=='ready'){
      const previous=this.db.prepare('SELECT generated FROM records WHERE id=?').get(record.id);
      if(previous){const saved=engineRecordSchema.parse(JSON.parse(String(previous.generated)));
        if(saved.status==='ready'&&saved.mediaId&&saved.relativePath)record={...saved,description:`保留上次成功导入的音频。当前扫描：${record.description}`.slice(0,20000)};
      }
    }
    this.transaction(() => {
      if (record.mediaId && record.relativePath) this.db.prepare('INSERT INTO media VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,bytes=excluded.bytes').run(record.mediaId,record.relativePath,record.bytes);
      this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET generated=excluded.generated').run(record.id,JSON.stringify(record),new Date().toISOString());
      for (const source of record.sources) this.db.prepare('INSERT INTO sources VALUES(?,?,?) ON CONFLICT(record_id,key) DO UPDATE SET data=excluded.data').run(record.id,source.key,JSON.stringify(source));
    });
  }
  getRecord(id: string): AudioRecord | null {
    const row = this.db.prepare('SELECT r.*,o.data AS personal,(SELECT count(*) FROM sources s WHERE s.record_id=r.id) AS source_count FROM records r LEFT JOIN overrides o ON o.id=r.id WHERE r.id=?').get(id);
    return row ? this.decode(row) : null;
  }
  private decode(row: Record<string, unknown>): AudioRecord {
    const record = correctedRecordDefaults(engineRecordSchema.parse(JSON.parse(String(row.generated))));
    const patch = patchSchema.parse(JSON.parse(String(row.personal || '{}')));
    return { id: record.id,mediaId: record.mediaId,title: patch.title ?? record.title,originalName: record.originalName,
      kind: record.kind, form: record.form, category: patch.category ?? record.category, tags: patch.tags ?? record.tags,
      favorite: patch.favorite ?? false,duration: record.duration,sampleRate: record.sampleRate,channels: record.channels,
      peaks: record.peaks,status: record.status,description: record.description,sourceCount: Number(row.source_count),
      modified: patch.title != null || patch.category != null || patch.tags != null, importedAt: String(row.imported_at), facets: recordFacets(record),
      cardNameTags: recordCardNameTags(record, patch.tags ?? record.tags) };
  }
  snapshot(): Snapshot {
    const records = this.db.prepare('SELECT r.*,o.data AS personal,(SELECT count(*) FROM sources s WHERE s.record_id=r.id) AS source_count FROM records r LEFT JOIN overrides o ON o.id=r.id ORDER BY r.imported_at,r.id').all().map(row => this.decode(row));
    const categories = new Map<string,string[]>();
    const add = (parts: string[]) => { for (let i=1;i<=parts.length;i++) { const p=parts.slice(0,i); categories.set(JSON.stringify(p),p); } };
    for (const record of records) add(record.category);
    for (const row of this.db.prepare('SELECT path FROM categories').all()) add(JSON.parse(String(row.path)) as string[]);
    return { records, categories: [...categories.values()].sort((a,b)=>a.join('/').localeCompare(b.join('/'),'zh-CN')), settings: this.getSettings(), libraryId: this.getValue('libraryId')!, assetBytes: Number(this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM media').get()!.bytes),version };
  }
  media(id: string): { path: string; bytes: number } | null {
    const record = this.getRecord(id); if (!record?.mediaId || record.status !== 'ready') return null;
    const row = this.db.prepare('SELECT path,bytes FROM media WHERE id=?').get(record.mediaId);
    return row ? { path: String(row.path), bytes:Number(row.bytes) } : null;
  }
  edit(ids: string[], input: MetadataPatch) {
    const patch = patchSchema.parse(input);
    this.transaction(() => { for (const id of new Set(ids)) this.editOne(id,patch); });
  }
  private editOne(id: string, patch: MetadataPatch) {
    const previous = this.db.prepare('SELECT data FROM overrides WHERE id=?').get(id);
    const current = patchSchema.parse(JSON.parse(String(previous?.data || '{}')));
    const next: MetadataPatch = patch.reset ? { favorite: current.favorite ?? false } : { ...current };
    for (const key of ['title','category','tags','favorite'] as const) { if (key in patch) Object.assign(next,{[key]:patch[key]}); }
    if (patch.addTags || patch.removeTags) {
      const effective = next.tags ?? this.getRecord(id)?.tags ?? [];
      next.tags = [...new Set([...effective,...(patch.addTags || [])])].filter(t=>!patch.removeTags?.includes(t));
    }
    this.db.prepare('INSERT INTO overrides VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(patchSchema.parse(next)));
  }
  createCategory(parts: string[]) { this.db.prepare('INSERT OR IGNORE INTO categories VALUES(?)').run(JSON.stringify(parts)); }
  renameCategory(from: string[], to: string[]) {
    if (!from.length || !to.length) throw new Error('分类名称不能为空。');
    if (to.length > from.length && from.every((v,i)=>to[i]===v)) throw new Error('不能把分类移到它自己的子分类。');
    const snapshot = this.snapshot();
    this.transaction(()=>{
      for(const record of snapshot.records) if(from.every((v,i)=>record.category[i]===v)) this.editOne(record.id,{ category:[...to,...record.category.slice(from.length)] });
      for(const parts of snapshot.categories) if(from.every((v,i)=>parts[i]===v)) {
        this.db.prepare('DELETE FROM categories WHERE path=?').run(JSON.stringify(parts)); this.createCategory([...to,...parts.slice(from.length)]);
      }
      this.createCategory(to);
    });
  }
  exportMetadata() {
    return { schemaVersion:1 as const, libraryId:this.getValue('libraryId')!, categories: this.snapshot().categories, records: this.db.prepare('SELECT * FROM overrides ORDER BY id').all().map(row=>({ id:String(row.id),patch:patchSchema.parse(JSON.parse(String(row.data))) })) };
  }
  importMetadata(input: unknown): number {
    const backup=backupSchema.parse(input);
    this.transaction(()=>{ for(const c of backup.categories)this.createCategory(c); for(const entry of backup.records)this.editOne(entry.id,entry.patch); });
    return backup.records.length;
  }
  saveJob(progress: ImportProgress) { this.db.prepare('INSERT INTO jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(progress.jobId,JSON.stringify(progress)); }
  lastJob(): ImportProgress | null { const row=this.db.prepare('SELECT data FROM jobs ORDER BY rowid DESC LIMIT 1').get(); return row ? JSON.parse(String(row.data)) as ImportProgress : null; }
}
