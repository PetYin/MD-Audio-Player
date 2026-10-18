// Optional private-data acceptance test. Assets and resulting screenshots are
// deliberately outside the source/release allowlists.
// node --import tsx scripts/test-library.mjs <portable-data-root> <engine-jsonl>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { Library } from '../desktop/database.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv[2]||!process.argv[3])throw new Error('Provide a private portable data root and completed engine JSONL.');
const data=path.resolve(process.argv[2]);const events=path.resolve(process.argv[3]);
const output=path.join(root,'test-results','real-library');fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(data,'data'),{recursive:true});
const library=new Library(path.join(data,'data','library.sqlite'));
let done;let progress;
for(const line of fs.readFileSync(events,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean)){
  const event=JSON.parse(line);if(event.type==='record')library.upsert(event.record);if(event.type==='done')done=event;if(event.type==='progress')progress=event;
}
assert(done&&!done.cancelled&&done.failures===0,'Full import must finish successfully before real-library acceptance');
library.updateSettings({onboardingComplete:true,theme:'dark'});
library.saveJob({...progress,jobId:'private-library-acceptance',stage:'complete',...done,message:'真实游戏资源导入完成'});
const snapshot=library.snapshot();const ready=snapshot.records.filter(r=>r.status==='ready');library.close();
const cases=[['short-effect',ready.filter(r=>r.kind==='sfx'&&!r.id.startsWith('event_')&&r.duration>.5&&r.duration<3).sort((a,b)=>a.duration-b.duration)[0]],
  ['long-music',ready.filter(r=>r.kind==='music').sort((a,b)=>b.duration-a.duration)[0]],
  ['voice',ready.filter(r=>r.kind==='voice').sort((a,b)=>b.duration-a.duration)[0]],
  ['loop-material',ready.find(r=>r.tags.some(t=>/循环/.test(t)))],
  ['full-action',ready.filter(r=>r.form==='完整动作').sort((a,b)=>b.duration-a.duration)[0]]];
const checks=[];const errors=[];let app;
try{
  app=await electron.launch({args:[root,'--force-device-scale-factor=1'],env:{...process.env,MD_PLAYER_DATA:data},timeout:30000});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.md);
  for(const [kind,record] of cases){
    assert(record,`Missing real ${kind} fixture`);
    await page.getByPlaceholder(/搜索/).first().fill(record.title);
    await page.getByRole('button',{name:`播放 ${record.title}`,exact:true}).click();
    await page.locator('.track-row').filter({hasText:record.title}).first().click();
    await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.08;},null,{timeout:10000});
    const native=await page.locator('audio').evaluate(a=>({duration:a.duration,error:a.error?.code||0,src:a.currentSrc}));
    assert.equal(native.error,0);assert(Math.abs(native.duration-record.duration)<.005);
    checks.push({kind,name:record.originalName,duration:native.duration,channels:record.channels,sampleRate:record.sampleRate,peaks:record.peaks.length});
  }
  await page.getByRole('button',{name:'单曲循环',exact:true}).click();
  await page.getByPlaceholder(/搜索/).first().fill('');
  await page.waitForFunction(()=>document.querySelectorAll('.track-row').length>1);
  await page.locator('.track-row').first().click();
  if(await page.getByRole('button',{name:'关闭通知',exact:true}).count())await page.getByRole('button',{name:'关闭通知',exact:true}).click();
  for(const [theme,label] of [['dark','石墨'],['light','纸白'],['duel','决斗']]){
    await page.getByRole('button',{name:'打开设置',exact:true}).click();await page.locator('.theme-option').filter({hasText:label}).click();
    await page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);await page.keyboard.press('Escape');
    await page.waitForTimeout(350); // Let the shared theme color transition settle before capture.
    await page.screenshot({path:path.join(output,`${theme}.png`)});
  }
  assert.deepEqual(errors,[]);
  const report={passed:true,logicalRecords:ready.length,assetBytes:snapshot.assetBytes,checks,errors};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(app)await app.close();}
