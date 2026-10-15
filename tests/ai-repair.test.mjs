import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAIService} from '../ai-service.mjs';

test('verification repair works from the unsaved candidate and keeps original request and baseline',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ai-repair-'));
 const project={root,entry:'index.html',editsFile:join(root,'.visual-editor','edits.json'),backupDir:join(root,'.visual-editor','backups')};
 const original='<h1>Old title</h1><p>Remove me</p>';
 try {
  await writeFile(join(root,'index.html'),original);
  const service=createAIService(join(root,'editor'));await service.settings({endpoint:'http://localhost:8317/v1',model:'test',apiKey:'test'});
  const tasks=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
   const task=JSON.parse(JSON.parse(options.body).messages[1].content);tasks.push(task);
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:tasks.length===1?[{path:'index.html',before:'Old title',after:'New title'}]:[{path:'index.html',before:'<p>Remove me</p>',after:''}]})}}]}));
  });
  const first=await service.generate(project,{request:'Change title and remove paragraph'});
  const repaired=await service.generate(project,{repair:{id:first.id,failures:['p：组件仍存在']}});
  assert.equal(tasks[1].files['index.html'],'<h1>New title</h1><p>Remove me</p>');
  assert.equal(tasks[1].request,tasks[0].request);
  assert.deepEqual(tasks[1].validationFailures,['p：组件仍存在']);
  assert.equal(repaired.changes[0].before,original);
  assert.equal(repaired.changes[0].after,'<h1>New title</h1>');
  assert.equal(service.proposal(repaired.id).originalFiles['index.html'],original);
  assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
  await service.apply(project,{id:repaired.id,verified:true});
  assert.equal(await readFile(join(root,'index.html'),'utf8'),'<h1>New title</h1>');
 } finally {t.mock.restoreAll();await rm(root,{recursive:true,force:true});}
});

test('repair is bounded, validates feedback, and refuses changed source or pending edits',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ai-repair-'));
 const project={root,entry:'index.html',editsFile:join(root,'.visual-editor','edits.json')};
 try {
  await writeFile(join(root,'index.html'),'<h1>Original</h1>');
  const service=createAIService(join(root,'editor'));await service.settings({endpoint:'http://localhost:8317/v1',model:'test',apiKey:'test'});
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[{path:'index.html',before:'</h1>',after:'!</h1>'}]})}}]}));});
  let result=await service.generate(project,{request:'Change title'});
  await assert.rejects(service.generate(project,{repair:{id:result.id,failures:[]}}),/验证反馈/);
  await assert.rejects(service.generate({...project,entry:'other.html'},{repair:{id:result.id,failures:['failed']}}),/不属于/);
  for(let i=0;i<2;i++)result=await service.generate(project,{repair:{id:result.id,failures:['failed']}});
  await assert.rejects(service.generate(project,{repair:{id:result.id,failures:['failed']}}),/自动修正次数/);
  assert.equal(calls,3);
  const fresh=await service.generate(project,{request:'Change title'});
  await writeFile(join(root,'index.html'),'<h1>User changed</h1>');
  await assert.rejects(service.generate(project,{repair:{id:fresh.id,failures:['failed']}}),/源码或待办已变化/);
  await writeFile(join(root,'index.html'),'<h1>Original</h1>');
  const draft=await service.generate(project,{request:'Change title'});
  const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'.visual-editor'),{recursive:true});
  await writeFile(project.editsFile,JSON.stringify({version:1,patches:{p:{selector:'h1',text:'New',ai:{fields:{text:'dynamic'},context:{}}}}}));
  await assert.rejects(service.generate(project,{repair:{id:draft.id,failures:['failed']}}),/源码或待办已变化/);
 } finally {t.mock.restoreAll();await rm(root,{recursive:true,force:true});}
});
