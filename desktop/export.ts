import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ExportResult } from '../shared/contracts';
import type { Library } from './database';
import { assetPath, assertWritableTarget, safeSegment } from './paths';
function run(executable:string,args:string[],signal?:AbortSignal):Promise<string> {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','ignore','pipe'],signal});let diagnostic='';let failure:Error|null=null;
    child.stderr!.on('data',(b:Buffer)=>{diagnostic=(diagnostic+b.toString()).slice(-24000);});
    child.on('error',error=>{failure=error;});child.on('close',code=>failure?reject(failure):code===0?resolve(diagnostic):reject(new Error(`音频转换失败 (${code})：${diagnostic.slice(-1500)}`)));
  });
}
async function peak(executable:string,source:string,signal?:AbortSignal):Promise<number> {
  const log=await run(executable,['-hide_banner','-nostdin','-nostats','-threads','1','-filter_threads','1','-i',source,'-vn','-af','aformat=sample_fmts=dblp,aresample=192000:resampler=swr:filter_size=64:phase_shift=10:cutoff=1,astats=metadata=0:reset=0','-c:a','pcm_f64le','-f','null','-'],signal);
  const values=[...log.matchAll(/Peak level dB:\s*(-?inf|[-\d.]+)/g)].map(m=>m[1]==='-inf'?-Infinity:Number(m[1]));
  if(!values.length||values.some(v=>Number.isNaN(v)))throw new Error('无法验证音频峰值。');
  return Math.max(...values);
}
export async function exportAudio(library:Library,root:string,tools:string,destination:string,ids:string[],format:'source'|'editing',signal?:AbortSignal):Promise<ExportResult> {
  const games=library.gameRoots();const directory=assertWritableTarget(destination,games);
  const result:ExportResult={cancelled:false,count:0,directory,errors:[]};
  const ffmpeg=path.join(tools,'ffmpeg','ffmpeg.exe');
  if(format==='editing'&&!fs.existsSync(ffmpeg))throw new Error('缺少 FFmpeg，请重新解压完整发布包。');
  for(const id of new Set(ids)) {
    if(signal?.aborted){result.cancelled=true;break;}
    let temporary:string|null=null;
    try {
      const record=library.getRecord(id);const media=library.media(id);
      if(!record||!media)throw new Error('该记录没有可导出的音频。');
      const source=assetPath(root,media.path,games);
      const folder=assertWritableTarget(path.join(directory,...record.category.map(safeSegment)),games);
      fs.mkdirSync(folder,{recursive:true});
      const stem=`${safeSegment(record.title)}__${safeSegment(id).slice(0,12)}`;
      let output=assertWritableTarget(path.join(folder,`${stem}.wav`),games);let suffix=2;
      while(fs.existsSync(output))output=assertWritableTarget(path.join(folder,`${stem}_${suffix++}.wav`),games);
      if(format==='source')fs.copyFileSync(source,output,fs.constants.COPYFILE_EXCL);
      else {
        temporary=assertWritableTarget(path.join(folder,`.export-${randomUUID()}.wav`),games);
        // Analyze the same stereo/rate conversion that will be exported before attenuation.
        await run(ffmpeg,['-hide_banner','-nostdin','-nostats','-v','error','-n','-threads','1','-filter_threads','1','-i',source,'-vn','-ar','48000','-ac','2','-c:a','pcm_f64le',temporary],signal);
        const measured=await peak(ffmpeg,temporary,signal);
        const adjusted=assertWritableTarget(path.join(folder,`.export-${randomUUID()}.wav`),games);
        try {
          const gain=measured>-1?-1.1-measured:0;
          await run(ffmpeg,['-hide_banner','-nostdin','-nostats','-v','error','-n','-threads','1','-filter_threads','1','-i',temporary,'-af',`volume=${gain}dB:precision=double`,'-ar','48000','-ac','2','-c:a','pcm_s24le',adjusted],signal);
          if(await peak(ffmpeg,adjusted,signal)>-1)throw new Error('导出音频的峰值验证未通过。');
          fs.copyFileSync(adjusted,output,fs.constants.COPYFILE_EXCL);
        } finally {if(fs.existsSync(adjusted))fs.unlinkSync(adjusted);}
      }
      result.count++;
    }catch(error){if(signal?.aborted){result.cancelled=true;break;}result.errors.push(`${library.getRecord(id)?.title||id}：${error instanceof Error?error.message:String(error)}`);}
    finally{if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  return result;
}
