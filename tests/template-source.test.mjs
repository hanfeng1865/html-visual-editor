import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ensureSourceOrigin,saveSource,readSourceVersion,listSourceVersions} from '../source-store.mjs';
import {splitEditRoutes} from '../ai-routing.mjs';import {validateVisualEdits} from '../visual-edits-store.mjs';
const binding={file:'app.js',scriptIndex:null,segment:'<div>Label</div>',opening:'<div>',offset:0,quote:'`'};
test('template metadata belongs to the direct style operation, not an AI task',()=>{
 const routes=splitEditRoutes({a:{selector:'.card',styles:{color:'red'},text:'99',templateSource:binding,ai:{fields:{text:'calculated value'},context:{}}}});
 assert.deepEqual(routes.direct.a,{selector:'.card',styles:{color:'red'},templateSource:binding});assert.equal(routes.pending.a.templateSource,undefined);
 assert.deepEqual(splitEditRoutes({a:{selector:'.card',templateSource:binding}}),{direct:{},pending:{}});
 assert.doesNotThrow(()=>validateVisualEdits({version:1,patches:routes.direct}));
 assert.throws(()=>validateVisualEdits({version:1,patches:{a:{selector:'.card',templateSource:{...binding,offset:2}}}}),/生成源码定位/);
});
test('direct source save writes HTML and JS together, backs both up, rejects stale and unrelated file writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'template-save-')),project={root,entry:'index.html',editsFile:join(root,'.visual-editor','edits.json'),backupDir:join(root,'.visual-editor','backups')};
 const draft={version:1,patches:{}};
 try{
  await writeFile(join(root,'index.html'),'<h1>Original</h1>');await writeFile(join(root,'app.js'),'const original=true;');
  const before=await ensureSourceOrigin(project,join(root,'editor'));
  await assert.rejects(saveSource(project,join(root,'editor'),{revision:before.revision,html:'<h1>No</h1>',files:{'../other.js':'bad'},draft}),/项目范围外/);
  await saveSource(project,join(root,'editor'),{revision:before.revision,html:'<h1>Saved</h1>',files:{'app.js':'const changed=true;'},draft});
  assert.equal(await readFile(join(root,'app.js'),'utf8'),'const changed=true;');assert.equal(await readFile(join(root,'index.html'),'utf8'),'<h1>Saved</h1>');
  const versions=await listSourceVersions(project),backup=await readSourceVersion(project,versions.find(v=>v.kind==='before-save').id);
  assert.equal(backup.files['app.js'],'const original=true;');assert.equal(backup.files['index.html'],'<h1>Original</h1>');
  await assert.rejects(saveSource(project,join(root,'editor'),{revision:before.revision,html:'<h1>stale</h1>',files:{'app.js':'stale'},draft}),/源码又发生变化/);
  assert.equal(await readFile(join(root,'app.js'),'utf8'),'const changed=true;');
 }finally{await rm(root,{recursive:true,force:true});}
});
