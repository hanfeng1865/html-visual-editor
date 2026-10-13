import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceManager } from '../project-workspaces.mjs';
import { createDevServer } from '../dev-server.mjs';
import { EDITOR_SOURCE_RULES } from '../ai-source-rules.mjs';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'editor-create-')),folder=join(root,'new-project');
  await mkdir(folder);t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,folder,manager:createWorkspaceManager(root,{registryDir:join(root,'registry')})};
}

test('opening an empty folder offers creation without writing or registering',async t=>{
  const {folder,manager}=await fixture(t);
  const canonical=await realpath(folder);
  await assert.rejects(manager.open(folder),e=>e.code==='PROJECT_NEEDS_CREATION' && e.root===canonical);
  assert.deepEqual(await readdir(folder),[]);
  assert.deepEqual(await manager.list(),[]);
});

test('create writes a standalone project and shared rules, and registers it',async t=>{
  const {folder,manager}=await fixture(t);
  const project=await manager.create(folder);
  assert.equal(project.created,true);assert.equal(project.entry,'index.html');
  assert.deepEqual(project.pages,['index.html']);
  assert.deepEqual((await readdir(folder)).sort(),['PROJECT-RULES.md','app.js','index.html','styles.css']);
  assert.ok((await readFile(join(folder,'PROJECT-RULES.md'),'utf8')).includes(EDITOR_SOURCE_RULES));
  const html=await readFile(join(folder,'index.html'),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  assert.match(html,/href="\.\/styles.css"/);assert.match(html,/src="\.\/app.js" defer/);
  assert.equal((await manager.describe(project.id)).entry,'index.html');
  assert.equal((await manager.open(folder)).id,project.id);
  await assert.rejects(manager.create(folder),/已有 HTML/);
  assert.equal(await readFile(join(folder,'index.html'),'utf8'),html);
});

test('existing files, directories and symlinks are never overwritten or partially initialized',async t=>{
  const {root,folder,manager}=await fixture(t);
  for(const name of ['styles.css','app.js','PROJECT-RULES.md']) {
    await writeFile(join(folder,name),'keep');
    await assert.rejects(manager.create(folder),/已存在/);
    assert.deepEqual(await readdir(folder),[name]);
    assert.equal(await readFile(join(folder,name),'utf8'),'keep');
    await rm(join(folder,name));
  }
  await mkdir(join(folder,'styles.css'));
  await assert.rejects(manager.create(folder),/已存在/);
  await rm(join(folder,'styles.css'),{recursive:true});
  await symlink(join(root,'missing.html'),join(folder,'index.html'));
  await assert.rejects(manager.create(folder),/已存在/);
  assert.deepEqual(await readdir(folder),['index.html']);
  assert.deepEqual(await manager.list(),[]);
});

test('creation preserves unrelated files and refuses nested HTML projects',async t=>{
  const {folder,manager}=await fixture(t);
  await mkdir(join(folder,'pages'));await writeFile(join(folder,'pages','existing.html'),'<h1>keep</h1>');
  await assert.rejects(manager.create(folder),/已有 HTML/);
  await rm(join(folder,'pages'),{recursive:true});
  await writeFile(join(folder,'notes.txt'),'keep');
  await manager.create(folder);
  assert.equal(await readFile(join(folder,'notes.txt'),'utf8'),'keep');
});

test('concurrent creation yields one complete project without overwrites',async t=>{
  const {folder,manager}=await fixture(t);
  const results=await Promise.allSettled([manager.create(folder),manager.create(folder)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await manager.list()).length,1);
  assert.equal((await readdir(folder)).length,4);
});

test('API returns an actionable empty-folder result and creates only on explicit create',async t=>{
  const {root,folder}=await fixture(t);
  const server=createDevServer({rootDir:root,editorDir:root});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=path=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:folder})});
  const opened=await post('/api/projects/open');
  assert.equal(opened.status,400);assert.equal((await opened.json()).code,'PROJECT_NEEDS_CREATION');
  assert.deepEqual(await readdir(folder),[]);
  const response=await post('/api/projects/create');assert.equal(response.status,200);
  const project=await response.json();
  for(const entry of ['index.html','styles.css','app.js'])assert.equal((await fetch(`${base}/project/${project.id}/${entry}`)).status,200);
  assert.equal((await post('/api/projects/create')).status,409);
});
