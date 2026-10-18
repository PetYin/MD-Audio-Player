import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Library } from '../desktop/database';
import type { EngineRecord, Snapshot } from '../shared/contracts';

// Run against a closed legacy player: node --import tsx scripts/audit-legacy-library.ts --library <library.sqlite>
// The supplied database is only hashed and copied. Every SQLite connection uses the disposable copy.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || arguments_[0] !== '--library') throw new Error('Usage: audit-legacy-library.ts --library <legacy library.sqlite>');
const source = path.resolve(arguments_[1]);
const reportFile = path.join(project, 'test-results', '1.0.1', 'legacy-library.json');
const report: Record<string, unknown> = {
  passed: false,
  auditType: 'Database compatibility on a copy; no media files copied or played',
  sourceFile: path.basename(source),
  checks: [] as string[],
  limitations: ['This audit verifies database identity, metadata, media references and source retention. Real playback and exports are covered by separate desktop integration tests.'],
};
const checks = report.checks as string[];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileDigest = (filename: string) => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function tableState(db: DatabaseSync) {
  const tables = {
    recordIds: db.prepare('SELECT id,imported_at FROM records ORDER BY id').all(),
    media: db.prepare('SELECT id,path,bytes FROM media ORDER BY id').all(),
    sources: db.prepare('SELECT record_id,key,data FROM sources ORDER BY record_id,key').all(),
    overrides: db.prepare('SELECT id,data FROM overrides ORDER BY id').all(),
    categories: db.prepare('SELECT path FROM categories ORDER BY path').all(),
  };
  return {
    counts: { records: tables.recordIds.length, media: tables.media.length, sources: tables.sources.length, overrides: tables.overrides.length, categories: tables.categories.length },
    hashes: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, digest(rows)])),
  };
}

function effectiveState(snapshot: Snapshot) {
  const { scanMode: _scanMode, ...settings } = snapshot.settings;
  return {
    records: digest(snapshot.records),
    categories: digest(snapshot.categories),
    settings: digest(settings),
    libraryId: snapshot.libraryId,
    assetBytes: snapshot.assetBytes,
  };
}

let library: Library | null = null;
let originalHash: string | undefined;
let failure: unknown;
try {
  assert(fs.statSync(source).isFile(), 'Source database must be a regular file');
  assert(!fs.existsSync(`${source}-wal`), 'Close the original player first; its WAL must be absent before copying');
  assert(!fs.existsSync(`${source}-shm`), 'Close the original player first; its SHM must be absent before copying');
  report.originalSidecarsAbsentBefore = true;
  originalHash = fileDigest(source);
  report.originalSha256Before = originalHash;
  fs.mkdirSync(path.join(project, '.cache'), { recursive: true });
  const workspace = fs.mkdtempSync(path.join(project, '.cache', 'legacy-audit-'));
  const copiedFile = path.join(workspace, 'library.sqlite');
  fs.copyFileSync(source, copiedFile, fs.constants.COPYFILE_EXCL);
  assert.equal(fileDigest(copiedFile), originalHash, 'Database copy must be byte identical before it is opened');
  report.copyDirectory = path.relative(project, workspace);
  checks.push('Original database was never opened with SQLite; byte-identical copy created without original WAL/SHM');

  const reader = new DatabaseSync(copiedFile, { readOnly: true });
  let baseline: ReturnType<typeof tableState>;
  try {
    assert.equal(reader.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
    baseline = tableState(reader);
    const preferences = reader.prepare("SELECT value FROM settings WHERE key='preferences'").get();
    report.originalStoredScanMode = JSON.parse(String(preferences?.value || '{}')).scanMode ?? null;
  } finally { reader.close(); }
  report.before = baseline;

  library = new Library(copiedFile);
  assert.deepEqual(tableState(library.db), baseline, 'Opening the old database must preserve library tables');
  const initialSnapshot = library.snapshot();
  const initialEffective = effectiveState(initialSnapshot);
  report.effectiveBefore = initialEffective;
  if (report.originalStoredScanMode === null) assert.equal(initialSnapshot.settings.scanMode, 'latest');
  checks.push('Opening with 1.0.1 preserves records, media, sources, overrides and categories; missing legacy scan mode defaults to latest');

  const candidate = library.db.prepare('SELECT r.id,r.generated FROM records r WHERE (SELECT count(*) FROM sources s WHERE s.record_id=r.id)>1 ORDER BY r.id').all()
    .map(row => ({ id: String(row.id), generated: JSON.parse(String(row.generated)) as EngineRecord }))
    .find(row => row.generated.status === 'ready' && row.generated.mediaId && row.generated.relativePath);
  assert(candidate, 'Expected at least one ready record with multiple saved sources');
  const singleSource = JSON.parse(String(library.db.prepare('SELECT data FROM sources WHERE record_id=? ORDER BY key LIMIT 1').get(candidate.id)!.data)) as EngineRecord['sources'][number];
  const sourceCount = library.getRecord(candidate.id)!.sourceCount;
  report.selectedRecord = { id: candidate.id, sourceCountBefore: sourceCount, replayedSources: 1 };

  const modes: string[] = [];
  for (const mode of ['all', 'latest', 'all'] as const) {
    library.updateSettings({ scanMode: mode });
    if (mode === 'latest') library.upsert({ ...candidate.generated, sources: [singleSource] });
    library.close();
    library = new Library(copiedFile);
    assert.equal(library.getSettings().scanMode, mode, `Mode ${mode} must persist after restart`);
    assert.deepEqual(tableState(library.db), baseline, `Mode ${mode} must preserve complete library tables`);
    assert.deepEqual(effectiveState(library.snapshot()), initialEffective, `Mode ${mode} must preserve every effective record field`);
    assert.equal(library.getRecord(candidate.id)!.sourceCount, sourceCount, 'Single-source replay must retain every historical source');
    modes.push(mode);
  }
  report.persistedModeSequence = modes;
  report.after = tableState(library.db);
  report.effectiveAfter = effectiveState(library.snapshot());
  checks.push('All → latest → all persists across three restarts and preserves record IDs, media mappings, original annotations and all effective snapshot fields');
  checks.push('Latest-mode single-source replay retains all historical source rows and the original multi-source count');

  // If the supplied library has no personal annotations, this separate copy-only probe
  // makes preservation of title, tags, category and favorite observable as well.
  library.edit([candidate.id], { title: '兼容验证 · 自定义标题', category: ['兼容验证', '个人分类'], tags: ['兼容验证标签'], favorite: true });
  library.createCategory(['兼容验证', '空分类']);
  const annotated = library.getRecord(candidate.id);
  const annotationBaseline = tableState(library.db);
  const annotatedEffective = effectiveState(library.snapshot());
  library.updateSettings({ scanMode: 'latest' });
  library.upsert({ ...candidate.generated, sources: [singleSource] });
  library.updateSettings({ scanMode: 'all' });
  library.close();
  library = new Library(copiedFile);
  assert.equal(library.getSettings().scanMode, 'all');
  assert.deepEqual(library.getRecord(candidate.id), annotated);
  assert.deepEqual(tableState(library.db), annotationBaseline);
  assert.deepEqual(effectiveState(library.snapshot()), annotatedEffective);
  report.syntheticAnnotationProbe = { passed: true, copyOnly: true, fields: ['title', 'category', 'tags', 'favorite', 'unassigned custom category'], hashes: annotationBaseline.hashes };
  checks.push('Additional copy-only custom title, tags, favorite and empty custom category survive single-source replay, mode changes and restart');
  report.passed = true;
} catch (error) {
  failure = error;
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  try { library?.close(); } catch (error) { report.passed = false; failure ||= error; report.closeError = String(error); }
  if (originalHash !== undefined) {
    try {
      const after = fileDigest(source);
      report.originalSha256After = after;
      report.originalSidecarsAbsentAfter = !fs.existsSync(`${source}-wal`) && !fs.existsSync(`${source}-shm`);
      assert.equal(after, originalHash, 'Original database content changed during audit');
      assert.equal(report.originalSidecarsAbsentAfter, true, 'Original database must remain without WAL/SHM');
      checks.push('Original database SHA256 is unchanged and no original WAL/SHM was created');
    } catch (error) { report.passed = false; failure ||= error; report.sourceVerificationError = String(error); }
  }
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({ passed: report.passed, counts: (report.before as ReturnType<typeof tableState> | undefined)?.counts, report: path.relative(project, reportFile), checks }, null, 2));
if (failure) throw failure;
