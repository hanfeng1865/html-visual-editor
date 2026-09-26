import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ensureSourceOrigin,saveSource,restoreSource,readSourceState,listSourceVersions,readSourceVersion} from '../source-store.mjs';
test('source saves reject stale writes, preserve backups, and restore HTML/CSS/JS with draft',async()=>{
 const root=await mkdtemp(join(tmpdir(),'source-store-'));
 const p={root,entry:'index.html',editsFile:join(root,'.visual-editor','page','visual-edits.json'),backupDir:join(root,'.visual-editor','page','backups')};
 try{
  await writeFile(join(root,'index.html'),'<h1>Original</h1>');await writeFile(join(root,'styles.css'),'h1{color:red}');await writeFile(join(root,'app.js'),'const original=true;');
  const baseline=await ensureSourceOrigin(p,join(root,'editor'));
  await writeFile(join(root,'index.html'),'<h1>Codex</h1>');
  const draft={version:1,patches:{title:{selector:'h1',text:'Editor'}}};
  await assert.rejects(saveSource(p,join(root,'editor'),{revision:baseline.revision,html:'<h1>Editor</h1>',draft}),/源码又发生变化/);
  assert.equal(await readFile(join(root,'index.html'),'utf8'),'<h1>Codex</h1>');
  const current=await readSourceState(p,join(root,'editor'));
  await saveSource(p,join(root,'editor'),{revision:current.revision,html:'<h1>Editor</h1>',draft});
  await ensureSourceOrigin(p,join(root,'editor'));
  assert.equal((await readSourceVersion(p,'original')).files['index.html'],'<h1>Original</h1>');
  assert.equal(await readFile(join(root,'index.html'),'utf8'),'<h1>Editor</h1>');
  assert.deepEqual(JSON.parse(await readFile(p.editsFile,'utf8')).patches,{});
  const versions=await listSourceVersions(p);assert.equal(versions.length,2);
  const before=await readSourceVersion(p,versions.find(v=>v.summary.startsWith('保存前')).id);
  assert.equal(before.files['index.html'],'<h1>Codex</h1>');assert.deepEqual(before.patches,draft.patches);
  await writeFile(join(root,'styles.css'),'h1{color:blue}');await writeFile(join(root,'app.js'),'const changed=true;');
  const next=await readSourceState(p,join(root,'editor'));
  await restoreSource(p,join(root,'editor'),{id:'original',revision:next.revision,draft});
  assert.equal(await readFile(join(root,'index.html'),'utf8'),'<h1>Original</h1>');
  assert.equal(await readFile(join(root,'styles.css'),'utf8'),'h1{color:red}');assert.equal(await readFile(join(root,'app.js'),'utf8'),'const original=true;');
  const restored=(await listSourceVersions(p)).find(v=>v.beforeRestore);const backup=await readSourceVersion(p,restored.id);assert.equal(backup.files['styles.css'],'h1{color:blue}');
 }finally{await rm(root,{recursive:true,force:true});}
});
