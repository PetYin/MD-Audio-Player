import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ImportProgress, ImportOptions } from '../shared/contracts';
import type { Library } from './database';
import { engineRecordSchema, importOptionsSchema } from './validation';
import { assertWritableTarget, assetPath } from './paths';
import { inspectInstallation, selectAccounts } from './installations';
const progressSchema=z.object({type:z.literal('progress'),stage:z.enum(['scanning','extracting','decoding','actions','complete','cancelled','failed']),message:z.string(),current:z.number().min(0),total:z.number().min(0),imported:z.number().min(0),duplicates:z.number().min(0),failures:z.number().min(0)});
const eventSchema=z.discriminatedUnion('type',[
  progressSchema, z.object({type:z.literal('record'),record:engineRecordSchema}),
  z.object({type:z.literal('error'),message:z.string()}),
  z.object({type:z.literal('done'),imported:z.number(),duplicates:z.number(),failures:z.number(),cancelled:z.boolean()}),
]);
export class Imports {
  child: ChildProcess | null=null;
  private cancelFile=''; private cancelRequested=false; private timer:NodeJS.Timeout|null=null;
  progress:ImportProgress|null;
  constructor(private library:Library,private root:string,private tools:string,private engineScript:string|null,private notify:(p:ImportProgress)=>void,private changed:()=>void) { this.progress=library.lastJob(); }
  start(gamePath:string, options?:ImportOptions):string {
    if(this.child)throw new Error('已有导入任务运行中。');
    const installation=inspectInstallation(gamePath); if(!installation.valid)throw new Error(installation.message);
    const {scanMode}=importOptionsSchema.parse(options ?? {scanMode:this.library.getSettings().scanMode});
    const accounts=selectAccounts(installation,scanMode);
    assertWritableTarget(this.root,[installation.path],true);
    this.library.protectGame(installation.path); this.library.updateSettings({gamePath:installation.path,scanMode});
    const jobId=randomUUID();
    const cache=assertWritableTarget(path.join(this.root,'.cache'),this.library.gameRoots()); fs.mkdirSync(cache,{recursive:true});
    this.cancelFile=path.join(cache,`cancel-${jobId}`); this.cancelRequested=false;
    const scope=accounts.length ? `${scanMode==='latest'?'最新目录':'全部目录'}：${accounts.join('、')}` : '仅公共资源';
    this.progress={jobId,stage:'scanning',message:`正在准备扫描公共资源 · ${scope}`,current:0,total:0,imported:0,duplicates:0,failures:0,errors:[]};
    const bundled=path.join(this.tools,'engine','md-engine.exe');
    let executable=bundled; let args:string[]=[];
    if(!fs.existsSync(bundled)) {
      if(!this.engineScript)throw new Error('缺少随程序提供的导入引擎，请重新解压完整发布包。');
      executable=process.env.MD_ENGINE_PYTHON || 'python'; args=['-X','utf8',this.engineScript];
    }
    args.push('import','--game',installation.path,'--data',this.root,'--tools',this.tools,'--cancel-file',this.cancelFile);
    args.push('--scan-mode',scanMode,'--accounts-json',JSON.stringify(accounts));
    const child=spawn(executable,args,{cwd:this.root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'}});
    this.child=child; this.publish(); let ended=false; let stderr=''; let lastChange=0; let protocolError=false; let engineFailed=false; let engineCancelled=false;
    const lines=createInterface({input:child.stdout!});
    lines.on('line',(line:string)=>{
      if(!line.trim()||protocolError)return;
      try {
        const event=eventSchema.parse(JSON.parse(line));
        if(event.type==='record') {
          if(event.record.status==='ready') {
            if(!event.record.relativePath || !event.record.mediaId || !event.record.relativePath.endsWith(`/${event.record.mediaId}.wav`))throw new Error('引擎返回了无效的媒体映射。');
            const target=assetPath(this.root,event.record.relativePath,this.library.gameRoots());
            if(fs.statSync(target).size!==event.record.bytes || event.record.bytes<44)throw new Error('导入文件尚未完整提交。');
          }
          this.library.upsert(event.record);
          if(Date.now()-lastChange>1000){this.changed();lastChange=Date.now();}
        } else if(event.type==='progress') {
          if(event.stage==='failed')engineFailed=true;
          if(event.stage==='cancelled')engineCancelled=true;
          // Final success requires the process to exit normally as well as a
          // complete protocol stream. A fatal engine also sends a done event.
          const stage=['complete','cancelled'].includes(event.stage)?this.progress!.stage:event.stage;
          this.progress={...this.progress!,...event,stage,jobId}; this.publish();
        } else if(event.type==='error') {
          this.progress!.errors=[...(this.progress!.errors||[]),event.message].slice(-100); this.publish();
        } else {
          ended=true;engineCancelled ||= event.cancelled;
          this.progress={...this.progress!,imported:event.imported,duplicates:event.duplicates,failures:event.failures};this.publish();
        }
      }catch(error){protocolError=true; this.fail(`导入数据校验失败：${error instanceof Error?error.message:String(error)}`);this.killTree();}
    });
    child.stderr!.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString('utf8')).slice(-12000);});
    child.on('error',error=>this.fail(`无法启动导入引擎：${error.message}`));
    child.on('close',code=>{
      this.child=null;if(this.timer)clearTimeout(this.timer);this.timer=null;lines.close();
      if(!protocolError) {
        if(this.cancelRequested||engineCancelled){this.progress={...this.progress!,stage:'cancelled',message:'导入已取消；再次扫描可以继续。'};this.publish();}
        else if(code===0&&ended&&!engineFailed){
          this.progress={...this.progress!,stage:'complete',message:this.progress!.failures?`导入完成，${this.progress!.failures} 项需要重试。`:'导入完成，声音已保存到本地资产库。'};
          this.library.updateSettings({onboardingComplete:true});this.publish();
        }else this.fail(`导入引擎异常退出 (${code ?? 'unknown'})。${stderr.trim()||this.progress?.errors?.at(-1)||''}`);
      }
      if(fs.existsSync(this.cancelFile))fs.unlinkSync(this.cancelFile);this.changed();
    });
    return jobId;
  }
  cancel() {
    if(!this.child)return;
    this.cancelRequested=true;fs.writeFileSync(assertWritableTarget(this.cancelFile,this.library.gameRoots()),'cancel');
    this.progress={...this.progress!,message:'正在取消并保存已完成的资源…'};this.publish();
    this.timer=setTimeout(()=>this.killTree(),5000);
  }
  killTree() {
    if(!this.child?.pid)return;
    if(process.platform==='win32') {const killer=spawn('taskkill.exe',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>this.child?.kill());}
    else this.child.kill('SIGTERM');
  }
  private fail(message:string){if(!this.progress)return;this.progress={...this.progress,stage:'failed',message,errors:[...(this.progress.errors||[]),message].slice(-100)};this.publish();}
  private publish(){if(this.progress){this.library.saveJob(this.progress);this.notify(this.progress);}}
}
