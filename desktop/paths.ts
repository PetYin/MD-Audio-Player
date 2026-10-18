import fs from 'node:fs';
import path from 'node:path';

/** Resolve existing ancestors as well as a destination that does not exist yet. */
export function canonical(input: string): string {
  let cursor = path.resolve(input);
  const rest: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('找不到目录所在的磁盘。');
    rest.unshift(path.basename(cursor)); cursor = parent;
  }
  return path.resolve(fs.realpathSync.native(cursor), ...rest);
}
export function inside(target: string, root: string): boolean {
  const t = path.resolve(target).toLowerCase(); const r = path.resolve(root).toLowerCase();
  return t === r || t.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}
export function containingGame(target: string): string | null {
  let cursor = canonical(target);
  if (fs.existsSync(cursor) && !fs.statSync(cursor).isDirectory()) cursor = path.dirname(cursor);
  while (true) {
    if (fs.existsSync(path.join(cursor, 'masterduel.exe'))) return cursor;
    const parent = path.dirname(cursor); if (parent === cursor) return null; cursor = parent;
  }
}
export function assertWritableTarget(target: string, games: string[], overlap = false): string {
  const resolved = canonical(target);
  const ancestorGame = containingGame(resolved);
  const roots = [...games, ...(ancestorGame ? [ancestorGame] : [])].map(game => {
    // A removed external Steam drive must not prevent offline playback. Its
    // lexical location stays protected; accessible roots always resolve links.
    try { return canonical(game); } catch (error) {
      const drive = path.parse(path.resolve(game)).root;
      if (!fs.existsSync(drive)) return path.resolve(game);
      throw error;
    }
  });
  for (const game of roots) {
    if (inside(resolved, game) || (overlap && inside(game, resolved))) {
      throw new Error('保护游戏目录：请选择大师决斗安装目录之外的位置。');
    }
  }
  return resolved;
}
export function assetPath(root: string, relative: string, games: string[]): string {
  if (!/^assets\/audio\/[a-f0-9]{64}\.wav$/.test(relative)) throw new Error('无效的资产路径。');
  const target = assertWritableTarget(path.join(root, relative), games);
  if (!inside(target, canonical(path.join(root, 'assets')))) throw new Error('资产路径越界。');
  return target;
}
export function safeSegment(value: string): string {
  let clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 80);
  if (!clean) clean = '未分类';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) clean = '_' + clean;
  return clean;
}
/** Chromium and SQLite create their own descendants; reject linked state trees. */
export function assertManagedTree(root: string, games: string[]): void {
  assertWritableTarget(root,games);
  if(!fs.existsSync(root))return;
  const pending=[root];
  while(pending.length){
    const item=pending.pop()!;const stat=fs.lstatSync(item);
    if(stat.isSymbolicLink())throw new Error('播放器数据目录包含目录链接或符号链接，请改用普通文件夹。');
    assertWritableTarget(item,games);
    if(stat.isDirectory())for(const entry of fs.readdirSync(item))pending.push(path.join(item,entry));
  }
}
