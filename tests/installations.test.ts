import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspectInstallation, selectAccounts } from '../desktop/installations';
import { Library } from '../desktop/database';

function fixture() {
  const parent=path.resolve('.cache','installation-tests');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'case-'));
  const game=path.join(root,'Game');fs.mkdirSync(path.join(game,'masterduel_Data'),{recursive:true});
  fs.writeFileSync(path.join(game,'masterduel.exe'),'fixture');
  return {root,game,account(name:string,time:number){const directory=path.join(game,'LocalData',name,'0000');fs.mkdirSync(directory,{recursive:true});fs.utimesSync(directory,time,time);return directory;},cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}

test('latest uses only resource-directory timestamps, with deterministic names on ties',t=>{
  const f=fixture();
  try {
    const old=f.account('old',1000);f.account('z-last',2000);f.account('a-first',2000);
    // New file timestamp inside an old account must not redefine "latest".
    fs.writeFileSync(path.join(old,'recent.wav'),'fixture');fs.utimesSync(old,1000,1000);
    const readDirectory=fs.readdirSync.bind(fs);
    const observed:string[]=[];
    t.mock.method(fs,'readdirSync',(input:fs.PathLike,...args:unknown[])=>{observed.push(String(input));return (readDirectory as Function)(input,...args);});
    const result=inspectInstallation(f.game);
    assert.equal(result.valid,true);assert.equal(result.latestAccount,'a-first');
    assert.deepEqual(selectAccounts(result,'latest'),['a-first']);
    assert.deepEqual(selectAccounts(result,'all'),['a-first','old','z-last']);
    assert.equal(result.accountDirectories.find(a=>a.name==='old')?.modifiedAt,1000000);
    assert.deepEqual(observed,[path.join(f.game,'LocalData')]);
  } finally {t.mock.restoreAll();f.cleanup();}
});

test('no accounts selects public only; latest empty directory does not fall back',()=>{
  const f=fixture();try {
    assert.deepEqual(selectAccounts(inspectInstallation(f.game),'latest'),[]);
    f.account('older',1000);f.account('empty-latest',2000);
    assert.deepEqual(selectAccounts(inspectInstallation(f.game),'latest'),['empty-latest']);
  } finally {f.cleanup();}
});

test('unreadable candidate timestamp blocks latest instead of silently selecting older',t=>{
  const f=fixture();try {
    f.account('older',1000);const broken=f.account('newer',2000);
    const stat=fs.statSync.bind(fs);
    t.mock.method(fs,'statSync',(input:fs.PathLike,options?:unknown)=>{
      if(String(input)===broken&&(options as {bigint?:boolean})?.bigint)throw Object.assign(new Error('test access denied'),{code:'EACCES'});
      return (stat as Function)(input,options);
    });
    const result=inspectInstallation(f.game);
    assert.equal(result.valid,true);assert.equal(result.latestAccount,null);
    assert.match(result.selectionError||'',/newer.*0000/);
    assert.throws(()=>selectAccounts(result,'latest'),/test access denied/);
    assert.deepEqual(selectAccounts(result,'all'),['newer','older']);
  } finally {t.mock.restoreAll();f.cleanup();}
});

test('account and 0000 junctions are excluded from selection',()=>{
  const f=fixture();try {
    f.account('normal',1000);const external=path.join(f.root,'external');fs.mkdirSync(path.join(external,'0000'),{recursive:true});
    const accountLink=path.join(f.game,'LocalData','linked');
    fs.symlinkSync(external,accountLink,process.platform==='win32'?'junction':'dir');
    const account=path.join(f.game,'LocalData','linked-resource');fs.mkdirSync(account);
    fs.symlinkSync(path.join(external,'0000'),path.join(account,'0000'),process.platform==='win32'?'junction':'dir');
    assert.deepEqual(inspectInstallation(f.game).accounts,['normal']);
    fs.unlinkSync(accountLink);fs.unlinkSync(path.join(account,'0000'));
  } finally {f.cleanup();}
});

test('legacy settings default to latest; mode persists without deleting records or personal data',()=>{
  const f=fixture();const filename=path.join(f.root,'library.sqlite');let library=new Library(filename);
  try {
    library.db.prepare('INSERT INTO settings VALUES(?,?)').run('preferences',JSON.stringify({theme:'light',onboardingComplete:true}));
    assert.equal(library.getSettings().scanMode,'latest');
    library.updateSettings({scanMode:'all'});library.close();library=new Library(filename);
    assert.equal(library.getSettings().scanMode,'all');assert.equal(library.getSettings().theme,'light');
    const before=library.exportMetadata();library.updateSettings({scanMode:'latest'});
    assert.deepEqual(library.exportMetadata(),before);
    const packageVersion=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
    assert.equal(library.snapshot().version,packageVersion);
    assert.throws(()=>library.updateSettings({scanMode:'unknown' as never}));
  } finally {library.close();f.cleanup();}
});
