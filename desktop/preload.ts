import { contextBridge, ipcRenderer } from 'electron';
import type { PlayerApi, ImportProgress } from '../shared/contracts';
const api:PlayerApi={
  snapshot:()=>ipcRenderer.invoke('library:snapshot'), detectInstallations:()=>ipcRenderer.invoke('game:detect'),
  chooseGame:()=>ipcRenderer.invoke('game:choose'), inspectInstallation:path=>ipcRenderer.invoke('game:inspect',path),
  startImport:(path,options)=>ipcRenderer.invoke('import:start',path,options), cancelImport:()=>ipcRenderer.invoke('import:cancel'),importStatus:()=>ipcRenderer.invoke('import:status'),
  edit:(ids,patch)=>ipcRenderer.invoke('library:edit',ids,patch),createCategory:path=>ipcRenderer.invoke('category:create',path),renameCategory:(path,replacement)=>ipcRenderer.invoke('category:rename',path,replacement),
  exportAudio:(ids,format)=>ipcRenderer.invoke('audio:export',ids,format),exportMetadata:()=>ipcRenderer.invoke('metadata:export'),importMetadata:()=>ipcRenderer.invoke('metadata:import'),
  settings:patch=>ipcRenderer.invoke('settings:update',patch),revealAsset:id=>ipcRenderer.invoke('audio:reveal',id),
  onProgress:callback=>{const listener=(_event:Electron.IpcRendererEvent,progress:ImportProgress)=>callback(progress);ipcRenderer.on('import:progress',listener);return()=>ipcRenderer.removeListener('import:progress',listener);},
  onLibraryChanged:callback=>{const listener=()=>callback();ipcRenderer.on('library:changed',listener);return()=>ipcRenderer.removeListener('library:changed',listener);},
};
contextBridge.exposeInMainWorld('md',api);
