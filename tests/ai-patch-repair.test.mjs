import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAIService} from '../ai-service.mjs';

const original='<h1>Training</h1><section id="create"><label>提交观后感</label></section><section id="detail"><label>提交观后感</label></section>';
const titleEdit={path:'index.html',before:'Training',after:'New training'};
const deleteEdit={path:'index.html',before:'<section id="create"><label>提交观后感</label></section>',after:'<section id="create"></section>'};
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'ai-patch-repair-'));
 t.after(async()=>{t.mock.restoreAll();await rm(root,{recursive:true,force:true});});
 const project={root,entry:'index.html',editsFile:join(root,'.visual-editor','edits.json')};
 await writeFile(join(root,'index.html'),original);
 const service=createAIService(join(root,'editor'));
 await service.settings({endpoint:'http://localhost:8317/v1',model:'test',apiKey:'test'});
 return {root,project,service};
}
function mockModel(t,reply){
 const tasks=[];
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  const body=JSON.parse(options.body),task=JSON.parse(body.messages[1].content);tasks.push(task);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reply(task,tasks.length))}}]}));
 });
 return tasks;
}

for(const before of ['<label>提交观后感</label>','<label>Missing</label>'])test(`patch matching repair regenerates the complete batch from baseline: ${before}`,async t=>{
 const {root,project,service}=await setup(t),progress=[];
 const tasks=mockModel(t,(_task,count)=>({edits:count===1?[titleEdit,{path:'index.html',before,after:''}]:[titleEdit,deleteEdit]}));
 const input={request:'修改标题并移除创建表单中的提交观后感选项',history:[{role:'user',content:'保留详情'}]};
 const result=await service.generate(project,input,{onProgress:event=>progress.push(event)});
 assert.equal(tasks.length,2);
 assert.equal(tasks[1].files['index.html'],original);
 assert.equal(tasks[1].request,input.request);
 assert.deepEqual(tasks[1].history,input.history);
 assert.equal(tasks[1].patchFailure.editIndex,1);
 assert.equal(tasks[1].patchFailure.edit.before,before);
 assert.equal(tasks[1].patchFailure.reason,before.includes('Missing')?'not_found':'ambiguous');
 assert.ok(progress.some(event=>/自动修正/.test(event.message||'')));
 assert.equal(result.changes[0].after,original.replace('Training','New training').replace(deleteEdit.before,deleteEdit.after));
 assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
 await service.apply(project,{id:result.id,verified:true});
 assert.equal(await readFile(join(root,'index.html'),'utf8'),result.changes[0].after);
});

test('persistent ambiguous patches stop after two repairs without saving any partial edit',async t=>{
 const {root,project,service}=await setup(t);
 const tasks=mockModel(t,()=>({edits:[titleEdit,{path:'index.html',before:'<label>提交观后感</label>',after:''}]}));
 await assert.rejects(service.generate(project,{request:'删除选项'}),/自动修正.*唯一匹配/);
 assert.equal(tasks.length,3);
 assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
});

test('cancelling at patch repair stops before another model call',async t=>{
 const {root,project,service}=await setup(t),controller=new AbortController();
 const tasks=mockModel(t,()=>({edits:[{path:'index.html',before:'<label>提交观后感</label>',after:''}]}));
 await assert.rejects(service.generate(project,{request:'删除选项'},{signal:controller.signal,onProgress:event=>{if(/自动修正/.test(event.message||''))controller.abort();}}),error=>error.statusCode===499);
 assert.equal(tasks.length,1);
 assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
});

test('invalid and out-of-scope edits are rejected without patch repair',async t=>{
 const {project,service}=await setup(t);
 const tasks=mockModel(t,()=>({edits:[{path:'../secret',before:'anything',after:''}]}));
 await assert.rejects(service.generate(project,{request:'删除选项'}),/范围外/);
 assert.equal(tasks.length,1);
});
