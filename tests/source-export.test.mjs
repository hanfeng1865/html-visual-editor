import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createWorkspaceManager, exportProjectZip} from '../project-workspaces.mjs';

async function fixture(context) {
  const root=await mkdtemp(join(tmpdir(),'source-export-'));
  context.after(()=>rm(root,{recursive:true,force:true}));
  const project=join(root,'project');await mkdir(project);
  await writeFile(join(project,'index.html'),'<h1 id="title">Saved source</h1>');
  await writeFile(join(project,'other.html'),'<p>Other page</p>');
  await writeFile(join(project,'style.css'),'h1{color:red}');
  const manager=createWorkspaceManager(root);
  const opened=await manager.open(project);
  return {manager,id:opened.id};
}

test('source handoff rejects unsaved current-page patches',async context=>{
  const {manager,id}=await fixture(context);
  await assert.rejects(exportProjectZip(manager,id,'index.html',{title:{selector:'#title',text:'Unsaved'}},{sourceOnly:true}),/未写入源码/);
});

test('source handoff rejects pending edits on other pages',async context=>{
  const {manager,id}=await fixture(context);
  const page=await manager.describe(id,'other.html');
  await mkdir(dirname(page.editsFile),{recursive:true});
  await writeFile(page.editsFile,JSON.stringify({version:1,patches:{pending:{selector:'p',text:'AI draft',ai:{fields:{text:'动态文字'},context:{}}}}}));
  await assert.rejects(exportProjectZip(manager,id,'index.html',{}, {sourceOnly:true}),/other\.html.*未写入源码/);
});

test('source handoff contains saved HTML and assets without export-time patches',async context=>{
  const {manager,id}=await fixture(context);
  const zip=await exportProjectZip(manager,id,'index.html',{}, {sourceOnly:true});
  const text=zip.toString('utf8');
  assert.ok(text.includes('<h1 id="title">Saved source</h1>'));
  assert.ok(text.includes('h1{color:red}'));
  assert.ok(text.includes('<p>Other page</p>'));
  assert.ok(!text.includes('createVisualPatchEngine'));
});
