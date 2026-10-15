import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'ai-repair-ui-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json','output'].includes(path.split(/[\\/]/).pop())});
const original='<!doctype html><html><head></head><body><h1>Title</h1><p id="target">Remove me</p></body></html>';
let mode='repair',calls=[],releaseModel;
const model=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'test'}]}));return;}
 let body='';for await(const chunk of req)body+=chunk;
 const task=JSON.parse(JSON.parse(body).messages[1].content);calls.push(task);
 if(['stop','patch'].includes(mode) && calls.length===2)await new Promise(resolve=>releaseModel=resolve);
 const after=['repair','patch'].includes(mode) && calls.length>1?task.files['index.html'].replace('<p id="target">Remove me</p>','<p id="target" hidden data-ve-deleted inert aria-hidden="true">Remove me</p>'):task.files['index.html'].replace('</h1>','!</h1>');
 const edits=mode==='patch' && calls.length===1?[{path:'index.html',before:'<',after:''}]:[{path:'index.html',before:task.files['index.html'],after}];
 res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({edits})}}]}));
});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.ok,true);return response.json();};
await writeFile(join(project,'index.html'),original);
const p=await post('/api/projects/open',{path:project});
await post('/api/ai/settings',{endpoint:`http://127.0.0.1:${model.address().port}/v1`,model:'test',apiKey:'test'});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();page.setDefaultTimeout(30000);
 const patch={selector:'#target',deleted:true,ai:{fields:{deleted:'dynamic'},context:{path:'#target'}}};
 for(const scenario of ['repair','patch','fail','stop']) {
  mode=scenario;calls=[];
  await writeFile(join(project,'index.html'),original);
  await post(`/api/visual-edits?project=${p.id}&entry=index.html`,{version:1,patches:{target:patch}});
  await page.goto(`${base}/editor/editor.html?project=${p.id}&entry=index.html`);
  await page.frameLocator('#prototype-frame').locator('body[data-ve-editor-ready=true]').waitFor();
  await page.locator('#ai-button').click();await page.locator('#ai-generate').click();
  if(scenario==='patch') {
   await page.waitForFunction(()=>document.querySelector('#ai-run-detail').textContent.includes('补全上下文'),{},{timeout:5000});
   while(!releaseModel)await new Promise(resolve=>setTimeout(resolve,20));
   releaseModel();releaseModel=null;
  }
  if(scenario==='stop') {
   await page.waitForFunction(()=>document.querySelector('#ai-run-detail').textContent.includes('自动修正'));
   while(!releaseModel)await new Promise(resolve=>setTimeout(resolve,20));
   await page.locator('#ai-stop').click();releaseModel();releaseModel=null;
  }
  await page.waitForFunction(()=>['success','error','stopped'].includes(document.querySelector('#ai-run-state').dataset.state));
  const state=await page.locator('#ai-run-state').getAttribute('data-state');
  assert.equal(state,['repair','patch'].includes(scenario)?'success':scenario==='stop'?'stopped':'error');
  assert.equal(calls.length,scenario==='fail'?3:2);
  if(scenario==='patch') {
   assert.equal(calls[1].patchFailure.reason,'ambiguous');
   assert.equal(calls[1].files['index.html'],original);
   assert.deepEqual(calls[1].requirements,calls[0].requirements);
  } else {
   assert.match(calls[1].validationFailures[0],/组件仍存在/);
   assert.match(calls[1].files['index.html'],/Title!/);
  }
  const saved=await readFile(join(project,'index.html'),'utf8');
  const draft=await(await fetch(`${base}/api/visual-edits?project=${p.id}&entry=index.html`)).json();
  if(['repair','patch'].includes(scenario)) {
   if(scenario==='repair')assert.match(saved,/Title!/);
   assert.match(saved,/hidden data-ve-deleted/);assert.deepEqual(draft.patches,{});
  } else {assert.equal(saved,original);assert.ok(draft.patches.target);}
  assert.equal(await page.locator('iframe[data-ai-baseline],iframe[data-ai-verification]').count(),0);
 }
 console.log('PASS: patch matching and validation feedback repair save only a verified result; exhausted repairs and cancellation retain source and pending edits');
} finally {
 releaseModel?.();await browser.close();server.closeAllConnections();model.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>model.close(r));await rm(temp,{recursive:true,force:true});
}
