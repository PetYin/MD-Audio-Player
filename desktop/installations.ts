import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AccountDirectory, Installation, ScanMode } from '../shared/contracts';
import { canonical } from './paths';

const emptyAccounts = () => ({ accounts: [] as string[], accountDirectories: [] as AccountDirectory[], latestAccount: null, selectionError: null });
const nameOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function plainDirectory(directory: string): boolean {
  try {
    const entry = fs.lstatSync(directory);
    return entry.isDirectory() && !entry.isSymbolicLink() && canonical(directory).toLowerCase() === path.resolve(directory).toLowerCase();
  } catch (error) { if (missing(error)) return false; throw error; }
}
export function inspectInstallation(input: string): Installation {
  try {
    const root=canonical(input);
    if (!fs.statSync(path.join(root,'masterduel.exe'),{throwIfNoEntry:false})?.isFile() || !plainDirectory(path.join(root,'masterduel_Data'))) return {path:root,valid:false,...emptyAccounts(),message:'请选择包含 masterduel.exe 的大师决斗安装文件夹。'};
    const local=path.join(root,'LocalData');
    const accounts: string[] = [];
    const accountDirectories: AccountDirectory[] = [];
    const errors: string[] = [];
    if (plainDirectory(local)) {
      for (const entry of fs.readdirSync(local,{withFileTypes:true}).sort((a,b)=>nameOrder(a.name,b.name))) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const account = path.join(local,entry.name);
        const directory = path.join(account,'0000');
        try {
          if (!plainDirectory(account) || !plainDirectory(directory)) continue;
          accounts.push(entry.name);
          const modifiedNs = fs.statSync(directory,{bigint:true}).mtimeNs;
          accountDirectories.push({name:entry.name,modifiedAt:Number(modifiedNs / 1_000_000n),modifiedNs:String(modifiedNs)});
        } catch (error) {
          // Do not silently choose another account when metadata was unreadable.
          if (!accounts.includes(entry.name)) accounts.push(entry.name);
          errors.push(`无法读取 ${directory} 的 0000 目录修改时间：${error instanceof Error?error.message:String(error)}`);
        }
      }
    }
    const ranked=[...accountDirectories].sort((a,b)=>BigInt(a.modifiedNs)===BigInt(b.modifiedNs)?nameOrder(a.name,b.name):BigInt(a.modifiedNs)>BigInt(b.modifiedNs)?-1:1);
    return { path:root,valid:true,accounts,accountDirectories,latestAccount:errors.length?null:ranked[0]?.name??null,selectionError:errors.length?errors.join('\n'):null,message:accounts.length ? `检测到 ${accounts.length} 个账号资源目录` : '已找到游戏；将扫描公共资源。完整资源需要先在游戏内下载。' };
  } catch(error) { return {path:input,valid:false,...emptyAccounts(),message:error instanceof Error ? error.message : '无法读取目录。'}; }
}

/** Freeze only the chosen names; the engine revalidates these before scanning. */
export function selectAccounts(installation: Installation, mode: ScanMode): string[] {
  if (!installation.valid) throw new Error(installation.message);
  if (mode === 'latest') {
    if (installation.selectionError) throw new Error(installation.selectionError);
    return installation.latestAccount === null ? [] : [installation.latestAccount];
  }
  return [...installation.accounts];
}
export function detectInstallations(): Installation[] {
  const steam=new Set<string>();
  const base=process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'; steam.add(path.join(base,'Steam'));
  if(process.platform==='win32') {
    try { const result=execFileSync('reg.exe',['query','HKCU\\Software\\Valve\\Steam','/v','SteamPath'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}); const match=result.match(/SteamPath\s+REG_SZ\s+(.+)/); if(match)steam.add(match[1].trim()); } catch { /* Steam is optional; manual selection remains available. */ }
  }
  for(const root of [...steam]) {
    const vdf=path.join(root,'steamapps','libraryfolders.vdf');
    if(fs.existsSync(vdf)) for(const m of fs.readFileSync(vdf,'utf8').matchAll(/"path"\s*"([^"]+)"/g)) steam.add(m[1].replace(/\\\\/g,'\\'));
  }
  const found=new Map<string,Installation>();
  for(const root of steam) {
    const manifest=path.join(root,'steamapps','appmanifest_1449850.acf');
    const dirname=fs.existsSync(manifest) ? fs.readFileSync(manifest,'utf8').match(/"installdir"\s*"([^"]+)"/)?.[1] : null;
    for(const name of [dirname,'Yu-Gi-Oh!  Master Duel','Yu-Gi-Oh! Master Duel'].filter((x):x is string=>!!x)) {
      const item=inspectInstallation(path.join(root,'steamapps','common',name)); if(item.valid)found.set(item.path.toLowerCase(),item);
    }
  }
  return [...found.values()];
}
