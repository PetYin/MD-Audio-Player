import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Library } from '../desktop/database';
import { assertWritableTarget, assertManagedTree, assetPath, safeSegment } from '../desktop/paths';
import type { EngineRecord } from '../shared/contracts';
const hash='a'.repeat(64);
const testRoot=path.resolve('.cache','unit-tests');fs.mkdirSync(testRoot,{recursive:true});
function temp(prefix:string){return fs.mkdtempSync(path.join(testRoot,prefix));}
function record(id='sound_1'):EngineRecord{return {id,mediaId:hash,title:'抽卡',originalName:'SE_CARD_DRAW',kind:'sfx',form:'片段',category:['决斗音效','卡片操作'],tags:['抽卡'],duration:1,sampleRate:48000,channels:2,peaks:[0,.4,1,.2],status:'ready',description:'',relativePath:`assets/audio/${hash}.wav`,bytes:100,sources:[{key:'source-a',bundle:'LocalData/account-A/0000/a/b',account:'account-A',payloadHash:hash}]};}
function fixture(){const root=temp('md-player-test-');const db=new Library(path.join(root,'library.sqlite'));return {root,db,cleanup:()=>{db.close();fs.rmSync(root,{recursive:true,force:true});}};}
test('personal empty tags and category survive refresh, restart and portable move',()=>{
  const root=temp('md-persist-');const filename=path.join(root,'library.sqlite');let db=new Library(filename);
  db.upsert(record());const libraryId=db.snapshot().libraryId;
  db.edit(['sound_1'],{title:'我的抽卡',tags:[],category:[],favorite:true});
  db.upsert({...record(),title:'上游改名',tags:['新默认标签']});
  assert.deepEqual(db.getRecord('sound_1')?.tags,[]);assert.deepEqual(db.getRecord('sound_1')?.category,[]);db.close();
  const moved=path.join(root,'moved');fs.mkdirSync(moved);fs.renameSync(filename,path.join(moved,'library.sqlite'));db=new Library(path.join(moved,'library.sqlite'));
  assert.equal(db.snapshot().libraryId,libraryId);assert.equal(db.getRecord('sound_1')?.title,'我的抽卡');assert.equal(db.getRecord('sound_1')?.favorite,true);
  db.edit(['sound_1'],{reset:true});assert.equal(db.getRecord('sound_1')?.title,'上游改名');assert.deepEqual(db.getRecord('sound_1')?.tags,['新默认标签']);assert.equal(db.getRecord('sound_1')?.favorite,true);
  db.close();fs.rmSync(root,{recursive:true,force:true});
});
test('media dedup preserves separate semantic records and combines account occurrences',()=>{
  const f=fixture();try{f.db.upsert(record());f.db.upsert({...record(),sources:[{...record().sources[0],key:'source-b',account:'account-B'}]});f.db.upsert(record('card_alias'));
    assert.equal(f.db.snapshot().assetBytes,100);assert.equal(f.db.snapshot().records.length,2);assert.equal(f.db.getRecord('sound_1')?.sourceCount,2);
  }finally{f.cleanup();}
});
test('metadata backup supports future records, batch tags and classification rename',()=>{
  const f=fixture();try{
    f.db.importMetadata({schemaVersion:1,libraryId:'elsewhere',categories:[['自定义','高光']],records:[{id:'sound_1',patch:{category:['自定义','高光'],tags:['珍藏']}}]});f.db.upsert(record());
    f.db.edit(['sound_1'],{addTags:['重要','珍藏'],removeTags:['珍藏']});assert.deepEqual(f.db.getRecord('sound_1')?.tags,['重要']);
    f.db.renameCategory(['自定义'],['个人']);assert.deepEqual(f.db.getRecord('sound_1')?.category,['个人','高光']);
    assert.throws(()=>f.db.renameCategory(['个人'],['个人','子目录']));
    const backup=f.db.exportMetadata();f.db.edit(['sound_1'],{reset:true});f.db.importMetadata(backup);assert.deepEqual(f.db.getRecord('sound_1')?.tags,['重要']);
    assert.throws(()=>f.db.importMetadata({...backup,records:[{id:'sound_1',patch:{tags:123}}]}));assert.deepEqual(f.db.getRecord('sound_1')?.tags,['重要']);
  }finally{f.cleanup();}
});
test('pending jobs become resumable interruption on startup',()=>{
  const root=temp('md-job-');const filename=path.join(root,'library.sqlite');let db=new Library(filename);
  db.saveJob({jobId:'a',stage:'decoding',message:'running',current:2,total:5,imported:1,duplicates:0,failures:0});db.close();db=new Library(filename);assert.equal(db.lastJob()?.stage,'cancelled');db.close();fs.rmSync(root,{recursive:true,force:true});
});
test('an incompatible game update cannot retire a previously playable action',()=>{
  const f=fixture();try{f.db.upsert(record('action'));f.db.edit(['action'],{tags:['保留']});
    f.db.upsert({...record('action'),status:'unavailable',mediaId:null,relativePath:null,bytes:0,peaks:[],description:'当前版本不匹配'});
    assert.equal(f.db.getRecord('action')?.status,'ready');assert.equal(f.db.media('action')?.path,`assets/audio/${hash}.wav`);assert.deepEqual(f.db.getRecord('action')?.tags,['保留']);assert.match(f.db.getRecord('action')!.description,/上次成功/);
  }finally{f.cleanup();}
});
test('game tree protection covers directory boundaries, real junctions, assets and reserved names',()=>{
  const root=temp('md-path-');const game=path.join(root,'Game');const data=path.join(root,'Player');fs.mkdirSync(game);fs.mkdirSync(data);fs.writeFileSync(path.join(game,'masterduel.exe'),'fixture');
  try{
    assert.throws(()=>assertWritableTarget(path.join(game,'new','audio.wav'),[]));
    assert.throws(()=>assertWritableTarget(root,[game],true));
    assert.equal(assertWritableTarget(path.join(root,'Game-extra'),[game]),path.join(root,'Game-extra'));
    assert.throws(()=>assetPath(data,'../../Game/write.wav',[game]));
    const junction=path.join(data,'linked');fs.symlinkSync(game,junction,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>assertWritableTarget(path.join(junction,'not-yet-created','file.wav'),[]));
    assert.throws(()=>assertManagedTree(data,[game]));
    assert.equal(safeSegment('CON'),'_CON');assert.equal(safeSegment('../a:b'),'.._a_b');
    fs.unlinkSync(junction);
    assert.doesNotThrow(()=>assertManagedTree(data,[game]));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('protected game roots are saved before the next writable database startup',()=>{
  const f=fixture();try{
    const game=path.join(f.root,'Game');fs.mkdirSync(game);fs.writeFileSync(path.join(game,'masterduel.exe'),'fixture');
    f.db.protectGame(game);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'protected-games.json'),'utf8')),[game]);
    assert.throws(()=>assertWritableTarget(game,JSON.parse(fs.readFileSync(path.join(f.root,'protected-games.json'),'utf8')),true));
  }finally{f.cleanup();}
});
