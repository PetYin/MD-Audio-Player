import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { Library } from '../desktop/database';
import { exportAudio } from '../desktop/export';
const tools=path.resolve('vendor');
test('real WAV export preserves source bytes, normalizes editing format, and never overwrites',async()=>{
  const parent=path.resolve('.cache','export-tests');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'case-'));fs.mkdirSync(path.join(root,'assets','audio'),{recursive:true});
  const sample=path.join(root,'test.wav');const ffmpeg=path.join(tools,'ffmpeg','ffmpeg.exe');const ffprobe=path.join(tools,'ffmpeg','ffprobe.exe');
  const frames=11025;const pcm=Buffer.alloc(44+frames*4);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(2,22);pcm.writeUInt32LE(44100,24);pcm.writeUInt32LE(176400,28);pcm.writeUInt16LE(4,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++){const value=Math.round(32600*Math.sin(2*Math.PI*1000*i/44100));pcm.writeInt16LE(value,44+i*4);pcm.writeInt16LE(value,46+i*4);}fs.writeFileSync(sample,pcm);
  const hash=createHash('sha256').update(fs.readFileSync(sample)).digest('hex');const rel=`assets/audio/${hash}.wav`;fs.renameSync(sample,path.join(root,rel));
  const library=new Library(path.join(root,'library.sqlite'));library.upsert({id:'export_fixture',mediaId:hash,title:'测试音频',originalName:'test',kind:'sfx',form:'片段',category:['素材','CON'],tags:[],duration:.25,sampleRate:44100,channels:1,peaks:[1],status:'ready',description:'',relativePath:rel,bytes:fs.statSync(path.join(root,rel)).size,sources:[]});
  try{
    const dest=path.join(root,'exports');fs.mkdirSync(dest);
    const original=await exportAudio(library,root,tools,dest,['export_fixture'],'source');assert.equal(original.count,1);assert.deepEqual(original.errors,[]);
    const folder=path.join(dest,'素材','_CON');let files=fs.readdirSync(folder);assert.equal(files.length,1);assert.equal(createHash('sha256').update(fs.readFileSync(path.join(folder,files[0]))).digest('hex'),hash);
    const converted=await exportAudio(library,root,tools,dest,['export_fixture'],'editing');assert.equal(converted.count,1,converted.errors.join('\n'));files=fs.readdirSync(folder);assert.equal(files.length,2);
    const output=path.join(folder,files.find(f=>f.endsWith('_2.wav'))!);const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',output],{encoding:'utf8',windowsHide:true}));
    assert.equal(probe.streams[0].sample_rate,'48000');assert.equal(probe.streams[0].channels,2);assert.equal(probe.streams[0].bits_per_sample,24);assert(Math.abs(Number(probe.streams[0].duration)-.25)<.005);
    const measured=spawnSync(ffmpeg,['-hide_banner','-i',output,'-af','aformat=sample_fmts=dblp,aresample=192000,astats=metadata=0:reset=0','-c:a','pcm_f64le','-f','null','-'],{encoding:'utf8',windowsHide:true});assert.equal(measured.status,0);
    const peak=Math.max(...[...measured.stderr.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].map(m=>Number(m[1])));assert(peak<=-1&&peak>-1.3,`unexpected final peak ${peak}`);
    const controller=new AbortController();const pending=exportAudio(library,root,tools,dest,['export_fixture'],'editing',controller.signal);controller.abort();
    const cancelled=await pending;assert.equal(cancelled.cancelled,true);assert.equal(cancelled.count,0);assert.equal(fs.readdirSync(folder).length,2,'Cancellation must clean temporary files after FFmpeg exits');
    const game=path.join(root,'Game');fs.mkdirSync(game);fs.writeFileSync(path.join(game,'masterduel.exe'),'fixture');await assert.rejects(exportAudio(library,root,tools,game,['export_fixture'],'source'),/保护游戏/);
  }finally{library.close();fs.rmSync(root,{recursive:true,force:true});}
});
