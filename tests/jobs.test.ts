import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Library } from '../desktop/database';
import { Imports } from '../desktop/jobs';
test('fatal engine done event and nonzero exit never become successful onboarding',async()=>{
  const parent=path.resolve('.cache','job-tests');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'case-'));
  const game=path.join(root,'Game');const data=path.join(root,'Player');const tools=path.join(root,'missing-tools');fs.mkdirSync(path.join(game,'masterduel_Data'),{recursive:true});fs.mkdirSync(data);fs.mkdirSync(tools);fs.writeFileSync(path.join(game,'masterduel.exe'),'fixture');
  const library=new Library(path.join(data,'library.sqlite'));const imports=new Imports(library,data,tools,path.resolve('engine/main.py'),()=>{},()=>{});
  try{imports.start(game);const deadline=Date.now()+15000;while(imports.child&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));assert.equal(imports.child,null);assert.equal(imports.progress?.stage,'failed');assert.equal(library.getSettings().onboardingComplete,false);assert.match(imports.progress?.message||'',/缺少播放器组件/);}
  finally{imports.killTree();library.close();fs.rmSync(root,{recursive:true,force:true});}
});
