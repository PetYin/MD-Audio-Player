import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'.cache',`desktop-test-${Date.now()}`);fs.mkdirSync(directory,{recursive:true});
const game=path.join(directory,'Game');fs.mkdirSync(path.join(game,'masterduel_Data'),{recursive:true});fs.writeFileSync(path.join(game,'masterduel.exe'),'test fixture, not executable');
const data=path.join(directory,'Player');const screenshots=path.join(root,'test-results');fs.mkdirSync(screenshots,{recursive:true});
function tone(seconds,frequency){const frames=Math.floor(48000*seconds);const buffer=Buffer.alloc(44+frames*4);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(2,22);buffer.writeUInt32LE(48000,24);buffer.writeUInt32LE(192000,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++){const value=Math.round(9000*Math.sin(2*Math.PI*frequency*i/48000)*Math.min(1,i/1000,(frames-i)/1000));buffer.writeInt16LE(value,44+i*4);buffer.writeInt16LE(value,46+i*4);}return buffer;}
const before=[];
for(const account of ['any-account-name','different-UUID'])for(const [name,seconds,hz] of [['SE_CARD_DRAW',4,440],['BGM_TEST',12,220],['VOICE_TEST',6,330],['SE_SUMMON_LINK',4,660]]) {
  const file=path.join(game,'LocalData',account,'0000','ab',`${name}.wav`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,tone(seconds,hz));before.push([file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
}
let app;const errors=[];const checks=[];
async function launch(){
  app=await electron.launch({args:[root],env:{...process.env,MD_PLAYER_DATA:data,ELECTRON_ENABLE_LOGGING:'1'},timeout:30000});
  app.process().stderr.on('data',b=>{const message=b.toString();if(/Uncaught|Error occurred in handler/.test(message))errors.push(message);});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForLoadState('domcontentloaded');await page.waitForFunction(()=>!!window.md);return page;
}
async function seek(page,value){await page.getByRole('slider',{name:'播放进度'}).evaluate((input,seconds)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(seconds));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function importFinished(page){const deadline=Date.now()+120000;while(Date.now()<deadline){const progress=await page.evaluate(()=>window.md.importStatus());if(progress&&['complete','failed','cancelled'].includes(progress.stage))return progress;await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Import timed out');}
try{
  let page=await launch();
  await page.screenshot({path:path.join(screenshots,'onboarding.png')});
  assert.equal((await page.evaluate(()=>window.md.snapshot())).records.length,0);checks.push('First launch has an empty real library');
  const inspection=await page.evaluate(p=>window.md.inspectInstallation(p),game);assert.equal(inspection.valid,true);assert.equal(inspection.accounts.length,2);
  await page.evaluate(p=>window.md.startImport(p,{scanMode:'all'}),game);
  await importFinished(page);
  const progress=await page.evaluate(()=>window.md.importStatus());assert.equal(progress.stage,'complete',progress.message);assert.equal(progress.failures,0,JSON.stringify(progress));
  let snapshot=await page.evaluate(()=>window.md.snapshot());const ready=snapshot.records.filter(r=>r.status==='ready');assert.equal(ready.length,4);assert(ready.every(r=>r.sourceCount===2));checks.push('Packaged engine imported two arbitrary account directories and deduplicated media');
  const chosen=ready.find(r=>r.originalName==='BGM_TEST');assert(chosen);
  await page.evaluate(async id=>{await window.md.edit([id],{title:'测试 · 夜航',category:['个人收藏','氛围'],tags:['试听','高光'],favorite:true});},chosen.id);
  snapshot=await page.evaluate(()=>window.md.snapshot());assert.equal(snapshot.records.find(r=>r.id===chosen.id).title,'测试 · 夜航');
  // Close an automatically opened import report if present; actual list uses search.
  const dialogs=page.locator('dialog[open]');if(await dialogs.count())await page.keyboard.press('Escape');
  await page.getByPlaceholder(/搜索/).first().fill('测试 · 夜航');
  await page.getByRole('button',{name:'播放 测试 · 夜航',exact:true}).click();
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.currentTime>.15;},null,{timeout:10000});
  const audioMeta=await page.locator('audio').evaluate(a=>({duration:a.duration,error:a.error?.code||0}));assert(Math.abs(audioMeta.duration-12)<.05);assert.equal(audioMeta.error,0);checks.push('Real Electron audio decoded, played, and advanced');
  await seek(page,5);
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=5);checks.push('Range protocol and seeking work');
  await page.getByRole('button',{name:'设置 A 点',exact:true}).click();
  await seek(page,7);await page.getByRole('button',{name:'设置 B 点',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime<6.8,null,{timeout:5000});checks.push('A/B loop wraps to A');
  await page.getByRole('button',{name:'清除 A/B 区间'}).click();
  await page.getByRole('button',{name:'单曲循环',exact:true}).click();
  for(const [theme,name] of [['dark','石墨'],['light','纸白'],['duel','决斗']]){
    await page.getByRole('button',{name:'打开设置',exact:true}).click();
    await page.locator('.theme-option').filter({hasText:name}).click();await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
    assert.equal(await page.locator('audio').evaluate(a=>a.paused),false,'Theme switch interrupted playback');
    await page.keyboard.press('Escape');await page.screenshot({path:path.join(screenshots,`theme-${theme}.png`)});
  }
  checks.push('Three saved themes render without interrupting actual playback');
  await page.evaluate(async id=>{await window.md.edit([id],{tags:[],category:[]});},chosen.id);
  await page.evaluate(p=>window.md.startImport(p,{scanMode:'all'}),game);await importFinished(page);
  assert.equal((await page.evaluate(()=>window.md.importStatus())).stage,'complete');
  const refreshed=await page.evaluate(id=>window.md.snapshot().then(s=>s.records.find(r=>r.id===id)),chosen.id);assert.deepEqual(refreshed.tags,[]);assert.deepEqual(refreshed.category,[]);assert.equal(refreshed.title,'测试 · 夜航');checks.push('Incremental import preserves explicitly cleared metadata');
  await app.close();app=null;page=await launch();const restored=await page.evaluate(id=>window.md.snapshot().then(s=>s.records.find(r=>r.id===id)),chosen.id);assert.equal(restored.favorite,true);assert.deepEqual(restored.tags,[]);checks.push('Restart preserves overrides and favorites');
  for(const [file,hash] of before)assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);checks.push('Source game fixture contents unchanged');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(screenshots,'desktop-verification.json'),JSON.stringify({passed:true,checks,errors,dataRoot:data},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}catch(error){fs.writeFileSync(path.join(screenshots,'desktop-verification.json'),JSON.stringify({passed:false,checks,errors,error:String(error),dataRoot:data},null,2));if(app){const pages=await app.windows();if(pages[0])await pages[0].screenshot({path:path.join(screenshots,'desktop-failure.png')});}throw error;}
finally{if(app){await app.evaluate(({app,dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});app.quit();}).catch(()=>{});await app.close().catch(()=>{});}}
