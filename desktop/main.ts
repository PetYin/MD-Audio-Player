import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Library } from './database';
import { assertWritableTarget, assertManagedTree, assetPath, canonical, inside } from './paths';
import { idsSchema,idSchema,patchSchema,categorySchema,settingsSchema,importOptionsSchema } from './validation';
import { detectInstallations,inspectInstallation } from './installations';
import { Imports } from './jobs';
import { exportAudio } from './export';

protocol.registerSchemesAsPrivileged([
  {scheme:'md-app',privileges:{standard:true,secure:true,supportFetchAPI:true}},
  {scheme:'md-audio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}},
]);
app.setName('MD 音效播放器');
if(process.platform==='win32')app.setAppUserModelId('org.md-audio-player.desktop');
const projectRoot=path.resolve(__dirname,'../..');
const portableRoot=app.isPackaged?path.dirname(app.getPath('exe')):path.resolve(process.env.MD_PLAYER_DATA||path.join(projectRoot,'data'));
const vendor=app.isPackaged?path.join(process.resourcesPath,'vendor'):path.join(projectRoot,'vendor');
let window:BrowserWindow|null=null;let library:Library;let imports:Imports;let exportBusy=false;let closing=false;let shutdownPending=false;
let exportController:AbortController|null=null;let activeExport:Promise<unknown>|null=null;
try {
  const protectedFile=path.join(portableRoot,'data','protected-games.json');
  const protectedGames=fs.existsSync(protectedFile)?z.array(z.string().max(32768)).max(1000).parse(JSON.parse(fs.readFileSync(protectedFile,'utf8'))):[];
  assertWritableTarget(portableRoot,protectedGames,true);fs.mkdirSync(portableRoot,{recursive:true});
  const dataPath=path.join(portableRoot,'data');assertManagedTree(dataPath,protectedGames);const data=assertWritableTarget(dataPath,protectedGames);fs.mkdirSync(data,{recursive:true});
  for(const name of ['browser','logs','library.sqlite','library.sqlite-wal','library.sqlite-shm','library.sqlite-journal'])assertWritableTarget(path.join(data,name),protectedGames);
  const probe=path.join(data,`.write-test-${process.pid}`);fs.writeFileSync(probe,'');fs.unlinkSync(probe);
  app.setPath('userData',path.join(data,'browser'));app.setPath('sessionData',path.join(data,'browser'));app.setPath('logs',path.join(data,'logs'));
} catch(error) {
  dialog.showErrorBox('播放器目录不可写',`请把完整播放器文件夹移到可写的位置，并确保它位于大师决斗安装目录之外。\n\n${error instanceof Error?error.message:String(error)}`);app.exit(1);
}
if(!app.requestSingleInstanceLock()){app.quit();}
app.on('second-instance',()=>{if(window?.isMinimized())window.restore();window?.focus();});
const changed=()=>{if(window&&!window.isDestroyed())window.webContents.send('library:changed');};
function handle(name:string,action:(...args:unknown[])=>unknown){
  ipcMain.handle(name,(event,...args:unknown[])=>{
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame.url.startsWith('md-app://ui/'))throw new Error('无效的界面请求。');
    return action(...args);
  });
}
function registerHandlers(){
  handle('library:snapshot',()=>library.snapshot());
  handle('game:detect',()=>detectInstallations());
  handle('game:inspect',input=>inspectInstallation(z.string().min(1).max(32768).parse(input)));
  handle('game:choose',async()=>{const result=await dialog.showOpenDialog(window!,{title:'选择大师决斗安装目录',properties:['openDirectory'],defaultPath:library.getSettings().gamePath||undefined});return result.canceled?null:inspectInstallation(result.filePaths[0]);});
  handle('import:start',(input,options)=>imports.start(z.string().min(1).max(32768).parse(input),options===undefined?undefined:importOptionsSchema.parse(options)));
  handle('import:cancel',()=>imports.cancel());handle('import:status',()=>imports.progress);
  handle('library:edit',(ids,patch)=>{library.edit(idsSchema.parse(ids),patchSchema.parse(patch));changed();});
  handle('category:create',input=>{const parts=categorySchema.parse(input);if(!parts.length)throw new Error('分类名称不能为空。');library.createCategory(parts);changed();});
  handle('category:rename',(from,to)=>{library.renameCategory(categorySchema.parse(from),categorySchema.parse(to));changed();});
  handle('settings:update',input=>{
    const patch=settingsSchema.parse(input);
    if(patch.gamePath){const game=inspectInstallation(patch.gamePath);if(!game.valid)throw new Error(game.message);assertWritableTarget(portableRoot,[game.path],true);library.protectGame(game.path);patch.gamePath=game.path;}
    return library.updateSettings(patch);
  });
  handle('audio:reveal',input=>{const media=library.media(idSchema.parse(input));if(!media)throw new Error('音频尚未导入。');shell.showItemInFolder(assetPath(portableRoot,media.path,library.gameRoots()));});
  handle('audio:export',async(input,formatInput)=>{
    const ids=idsSchema.parse(input);const format=z.enum(['source','editing']).parse(formatInput);if(exportBusy)throw new Error('已有导出任务正在进行。');
    exportBusy=true;exportController=new AbortController();try{const result=await dialog.showOpenDialog(window!,{title:'选择音频导出目录',properties:['openDirectory','createDirectory']});if(result.canceled)return{cancelled:true,count:0,errors:[]};activeExport=exportAudio(library,portableRoot,vendor,result.filePaths[0],ids,format,exportController.signal);return await activeExport;}finally{exportBusy=false;exportController=null;activeExport=null;}
  });
  handle('metadata:export',async()=>{
    const result=await dialog.showSaveDialog(window!,{title:'导出个人分类与标签',defaultPath:'MD音效播放器-个人标注.json',filters:[{name:'JSON',extensions:['json']}]});
    if(result.canceled||!result.filePath)return false;
    const target=assertWritableTarget(result.filePath,library.gameRoots());const temporary=assertWritableTarget(target+`.tmp-${process.pid}`,library.gameRoots());
    fs.writeFileSync(temporary,JSON.stringify(library.exportMetadata(),null,2),'utf8');fs.renameSync(temporary,target);return true;
  });
  handle('metadata:import',async()=>{
    const result=await dialog.showOpenDialog(window!,{title:'导入个人分类与标签',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
    if(result.canceled)return null;const input=result.filePaths[0];if(fs.statSync(input).size>20*1024*1024)throw new Error('标注文件超过 20 MB。');
    const answer=await dialog.showMessageBox(window!,{type:'question',buttons:['导入','取消'],defaultId:0,cancelId:1,message:'导入个人标注',detail:'同一条音频在文件中提供的个人字段将替换当前值。当前标注会先自动备份。'});
    if(answer.response!==0)return null;
    const backup=assertWritableTarget(path.join(portableRoot,'data',`metadata-backup-${Date.now()}.json`),library.gameRoots());fs.writeFileSync(backup,JSON.stringify(library.exportMetadata(),null,2));
    const count=library.importMetadata(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'')));changed();return count;
  });
}
function registerProtocols(){
  const renderer=canonical(path.join(projectRoot,'dist','renderer'));
  protocol.handle('md-app',request=>{
    try{const url=new URL(request.url);if(url.hostname!=='ui')return new Response('Not found',{status:404});
      const target=canonical(path.join(renderer,decodeURIComponent(url.pathname)));if(!inside(target,renderer)||!fs.statSync(target).isFile())return new Response('Not found',{status:404});
      return net.fetch(pathToFileURL(target).toString());
    }catch{return new Response('Not found',{status:404});}
  });
  protocol.handle('md-audio',request=>{
    try{
      const url=new URL(request.url);if(url.hostname!=='asset'||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
      const id=idSchema.parse(decodeURIComponent(url.pathname.slice(1)));const media=library.media(id);if(!media)return new Response('Not found',{status:404});
      const target=assetPath(portableRoot,media.path,library.gameRoots());const size=fs.statSync(target).size;let start=0;let end=size-1;let status=200;
      const range=request.headers.get('Range');
      if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
        if(!m[1])start=Math.max(0,size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),size-1);}status=206;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
      }
      const headers:Record<string,string>={'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'no-cache','Access-Control-Allow-Origin':'md-app://ui'};
      if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
      const body=request.method==='HEAD'?null:Readable.toWeb(fs.createReadStream(target,{start,end})) as ReadableStream<Uint8Array>;
      return new Response(body,{status,headers});
    }catch{return new Response('Audio unavailable',{status:404});}
  });
}
app.whenReady().then(()=>{
  library=new Library(path.join(portableRoot,'data','library.sqlite'));
  for(const game of library.gameRoots())assertWritableTarget(portableRoot,[game],true);
  imports=new Imports(library,portableRoot,vendor,app.isPackaged?null:path.join(projectRoot,'engine','main.py'),p=>{if(window&&!window.isDestroyed())window.webContents.send('import:progress',p);},changed);
  registerProtocols();registerHandlers();
  session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  window=new BrowserWindow({width:1480,height:940,minWidth:1000,minHeight:680,backgroundColor:'#111418',title:'MD 音效播放器',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('md-app://ui/'))event.preventDefault();});
  window.once('ready-to-show',()=>window?.show());
  window.on('close',event=>{
    if(closing)return;
    if(shutdownPending){event.preventDefault();return;}
    if(imports.child||exportBusy){event.preventDefault();shutdownPending=true;void dialog.showMessageBox(window!,{type:'question',buttons:['继续等待','退出播放器'],defaultId:0,cancelId:0,message:'任务仍在运行',detail:'退出会停止当前任务，已导入的音频和个人标注会保留。'}).then(async answer=>{if(answer.response===1){imports.cancel();exportController?.abort();await activeExport?.catch(()=>{});const deadline=Date.now()+7000;while(imports.child&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));imports.killTree();closing=true;app.quit();}else shutdownPending=false;});}
  });
  void window.loadURL('md-app://ui/index.html');
}).catch(error=>{dialog.showErrorBox('播放器无法启动',error instanceof Error?error.message:String(error));app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{imports?.killTree();library?.close();});
