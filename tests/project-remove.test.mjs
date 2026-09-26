import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceManager } from '../project-workspaces.mjs';
import { createDevServer } from '../dev-server.mjs';

test('removing a linked project only removes its registry entry', async t => {
  const root=await mkdtemp(join(tmpdir(),'editor-remove-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const folder=join(root,'html-test');
  await mkdir(folder);
  await writeFile(join(folder,'index.html'),'<h1>Original</h1>');
  const manager=createWorkspaceManager(root,{registryDir:join(root,'registry')});
  const project=await manager.open(folder);
  assert.equal((await manager.list()).some(item=>item.id===project.id),true);

  await manager.remove(project.id);
  assert.equal((await manager.list()).some(item=>item.id===project.id),false);
  assert.equal(await readFile(join(folder,'index.html'),'utf8'),'<h1>Original</h1>');
  await assert.rejects(manager.get(project.id),/项目未关联/);
  await assert.rejects(manager.remove('builtin'),/不能移除/);
});

test('remove API unregisters the chosen linked project', async t => {
  const root=await mkdtemp(join(tmpdir(),'editor-remove-api-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const folder=join(root,'html-test');
  await mkdir(folder);
  await writeFile(join(folder,'index.html'),'<h1>Original</h1>');
  const server=createDevServer({rootDir:root,editorDir:root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const opened=await fetch(`${base}/api/projects/open`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:folder})}).then(response=>response.json());
  const response=await fetch(`${base}/api/projects/remove`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:opened.id})});
  assert.equal(response.status,200);
  assert.equal((await response.json()).ok,true);
  assert.equal((await fetch(`${base}/api/projects`).then(result=>result.json())).some(project=>project.id===opened.id),false);
  assert.equal(await readFile(join(folder,'index.html'),'utf8'),'<h1>Original</h1>');
});
