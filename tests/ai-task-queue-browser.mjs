import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'ai-chat-ui-')),project=join(temp,'project'),editorDir=join(temp,'editor');await mkdir(project);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(path.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),'<!doctype html><html><head><style>body{padding:40px}h1{margin:0}</style></head><body><h1 id="title">Original</h1><p id="number">128</p></body></html>');
let mode='good',tasks=[],instructions=[],modelGate=null,releaseModel=null,resolveDisconnect=null;
const model=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'test'}]}));}
 let body='';for await(const chunk of req)body+=chunk;const envelope=JSON.parse(body),content=envelope.messages[1].content,task=JSON.parse(Array.isArray(content)?content[0].text:content);task.receivedImageCount=Array.isArray(content)?content.filter(part=>part.type==='image_url').length:0;tasks.push(task);instructions.push(envelope.messages[0].content);
 res.on('close',()=>{if(!res.writableEnded)resolveDisconnect?.();});
 if(modelGate && mode!=='stream')await modelGate;
 if(mode==='fail'){res.writeHead(503);return res.end();}
 const before=task.files['index.html'];let after=before.replace(/(<h1 id="title"[^>]*>)[\s\S]*?<\/h1>/,'$1'+([...task.request.matchAll(/\b(one|two)\b/g)].at(-1)?.[1]==='two'?'AI two':'AI one')+'</h1>');
 after=after.replace(/(<p id="number"[^>]*>)[\s\S]*?<\/p>/,'$1'+tasks.length+'</p>');
 if(mode==='duplicate')after=after.replace('</body>','<p id="title">Duplicate</p></body>');
 if(mode==='stream'){
  after=after.replace(/AI one/g,'AI streamed');
  res.setHeader('content-type','text/event-stream');
  const output=JSON.stringify({summary:'先保留页面结构，再更新标题，最后检查页面是否正常。',edits:[{path:'index.html',before,after}],explanation:'按要求修改标题并保留可编辑结构'});
  const cut=24;
  res.write('data: '+JSON.stringify({choices:[{delta:{content:output.slice(0,cut)}}]})+'\n\n');
  if(modelGate)await modelGate;
  res.write('data: '+JSON.stringify({choices:[{delta:{content:output.slice(cut)},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');return;
 }
 res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[{path:'index.html',before,after}],explanation:'按要求修改标题并保留可编辑结构'})}}]}));
});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,p=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
await fetch(base+'/api/ai/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:`http://127.0.0.1:${model.address().port}/v1`,model:'test',apiKey:'dummy-chat-key'})});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),f=page.frameLocator('#prototype-frame');
 await page.goto(`${base}/editor/editor.html?project=${p.id}&entry=index.html`);await f.locator('body[data-ve-editor-ready=true]').waitFor();
 await page.locator('#ai-chat-button').click();
 const input=page.locator('#ai-chat-input'),send=page.locator('#ai-chat-send');
 page.setDefaultTimeout(8000);
 const waitTasks=async count=>{const deadline=Date.now()+8000;while(tasks.length<count){assert.ok(Date.now()<deadline,'model request timed out');await new Promise(r=>setTimeout(r,20));}};
 const idle=()=>page.waitForFunction(()=>document.querySelector('#ai-run-state').dataset.state!=='running' && document.querySelector('#ai-chat-steer').hidden);
 modelGate=new Promise(resolve=>{releaseModel=resolve;});
 await input.fill('first one');await send.click();
 await page.waitForFunction(()=>document.querySelector('#ai-run-state').dataset.phase==='generate');
 assert.equal(await input.isEnabled(),true);assert.equal(await input.inputValue(),'');
 const pixel=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=8;c.height=8;return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#ai-image-file').setInputFiles({name:'queued.png',mimeType:'image/png',buffer:Buffer.from(pixel,'base64')});
 await page.waitForFunction(()=>document.querySelectorAll('#ai-images img').length===1);
 await input.fill('second two');await input.press('ControlOrMeta+Enter');
 await input.fill('remove me');await send.click();
 assert.equal(await page.locator('#ai-task-list li').count(),2);
 await page.locator('#ai-task-list li').last().getByRole('button',{name:'移除任务 2',exact:true}).click();
 await input.fill('unsent draft');
 assert.equal(tasks.length,1,'queue does not start a concurrent request');
 releaseModel();modelGate=null;
 await page.waitForFunction(()=>document.querySelectorAll('#ai-task-list li').length===0 && document.querySelector('#ai-run-state').dataset.state==='success');await idle();
 assert.equal(tasks[0].receivedImageCount,0);assert.equal(tasks[1].receivedImageCount,1,'queued screenshots belong to the queued request');
 assert.equal(tasks.length,2);assert.equal(tasks[1].request,'second two');assert.match(tasks[1].files['index.html'],/AI one/);
 assert.ok(tasks[1].history.some(item=>item.role==='assistant' && item.content.includes('已写入')));
 assert.equal(await input.inputValue(),'unsent draft','completion preserves the next draft');
 assert.match(await readFile(join(project,'index.html'),'utf8'),/AI two/);
 // Steering aborts the old model request and restarts with both instructions.
 modelGate=new Promise(resolve=>{releaseModel=resolve;});
 await input.fill('original one');await send.click();
 await waitTasks(3);
 const disconnected=new Promise(resolve=>{resolveDisconnect=resolve;});
 await input.fill('adjust two');await page.locator('#ai-chat-steer').click();
 assert.equal(await Promise.race([disconnected.then(()=>true),new Promise(r=>setTimeout(()=>r(false),2000))]),true);
 await waitTasks(4);
 assert.match(tasks[3].request,/original one/);assert.match(tasks[3].request,/adjust two/);
 releaseModel();modelGate=null;resolveDisconnect=null;await idle();
 assert.match(await readFile(join(project,'index.html'),'utf8'),/AI two/);
 // Failures pause pending tasks and never overwrite a new draft.
 mode='fail';modelGate=new Promise(resolve=>{releaseModel=resolve;});
 await input.fill('failed one');await send.click();
 await waitTasks(5);
 await input.fill('after failure two');await send.click();await input.fill('keep my draft');
 releaseModel();modelGate=null;await idle();
 assert.equal(tasks.length,5);assert.equal(await page.locator('#ai-task-list li').count(),2);
 assert.equal(await input.inputValue(),'keep my draft');
 assert.equal(await page.locator('#ai-task-resume').isVisible(),true);
 mode='good';await page.locator('#ai-task-resume').click();
 await page.waitForFunction(()=>document.querySelectorAll('#ai-task-list li').length===0 && document.querySelector('#ai-run-state').dataset.state==='success');await idle();
 assert.equal(tasks.length,7);assert.equal(tasks[5].request,'failed one');assert.equal(tasks[6].request,'after failure two');
 assert.equal(await input.inputValue(),'keep my draft');
 // Stopping pauses the queue and restores the active request when the draft is empty.
 modelGate=new Promise(resolve=>{releaseModel=resolve;});
 await input.fill('stop one');await send.click();
 await waitTasks(8);
 await input.fill('wait two');await send.click();await page.locator('#ai-stop').click();await idle();
 assert.equal(await input.inputValue(),'stop one');assert.equal(await page.locator('#ai-task-list li').count(),1);
 assert.equal(tasks.length,8);releaseModel();modelGate=null;
 // Immediately executing a queued instruction merges it into the active task.
 await page.locator('#ai-task-list li').getByRole('button',{name:'移除任务 1',exact:true}).click();
 modelGate=new Promise(resolve=>{releaseModel=resolve;});
 const start=tasks.length;
 await input.fill('继续调整标题 two');await send.click();await waitTasks(start+1);
 await input.fill('优先调整标题 one');await send.click();await input.fill('把标题字号改大，留出更多空白。');
 await page.locator('#ai-task-list li').filter({hasText:'优先调整标题 one'}).getByRole('button',{name:'立即执行',exact:true}).click();
 await waitTasks(start+2);
 assert.match(tasks.at(-1).request,/继续调整标题 two/);
 assert.match(tasks.at(-1).request,/后续调整[\s\S]*优先调整标题 one/);
 assert.equal(await page.locator('#ai-run-task').textContent(),tasks.at(-1).request,'show the merged task currently running');
 await mkdir(new URL('../output/ai-queue-ui/',import.meta.url),{recursive:true});
 await page.screenshot({path:fileURLToPath(new URL('../output/ai-queue-ui/running.png',import.meta.url)),clip:await page.locator('#ai-dialog').boundingBox()});
 await page.setViewportSize({width:1000,height:1000});
 const layout=await page.locator('.ai-composer').evaluate(row=>{
   const box=row.getBoundingClientRect();return [...row.children].filter(child=>child.getClientRects().length).every(child=>{const rect=child.getBoundingClientRect();return rect.left>=box.left && rect.right<=box.right+1;});
 });
 assert.ok(layout,'composer controls fit the narrow sidebar');
 await page.screenshot({path:fileURLToPath(new URL('../output/ai-queue-ui/narrow.png',import.meta.url)),clip:await page.locator('#ai-dialog').boundingBox()});
 await page.setViewportSize({width:1500,height:1000});

 assert.equal(await page.locator('#ai-task-list li').count(),0,'the original task is absorbed, never requeued');
 assert.equal(await input.inputValue(),'把标题字号改大，留出更多空白。');
 releaseModel();modelGate=null;
 await page.waitForFunction(()=>document.querySelectorAll('#ai-task-list li').length===0 && document.querySelector('#ai-run-state').dataset.state==='success');await idle();
 assert.equal(tasks.length,start+2,'one combined request completes both instructions');
 assert.match(await readFile(join(project,'index.html'),'utf8'),/AI one/,'new direction wins instead of being overwritten by a replay');
 // A transport that settles cancellation late must not hold the priority task.
 await page.evaluate(()=>{
   const original=window.fetch;window.restoreQueueFetch=()=>{window.fetch=original;};
   window.fetch=(url,options)=>{
     if(String(url).includes('/api/ai/generate') && options?.body?.includes('delayed cancellation two')){
       const {signal,...rest}=options;return original(url,rest);
     }
     return original(url,options);
   };
 });
 modelGate=new Promise(resolve=>{releaseModel=resolve;});
 const beforeDelayed=tasks.length;
 await input.fill('delayed cancellation two');await send.click();await waitTasks(beforeDelayed+1);
 await input.fill('responsive priority one');await send.click();await input.fill('draft while switching');
 await page.locator('#ai-task-list li').getByRole('button',{name:'立即执行',exact:true}).click();
 await waitTasks(beforeDelayed+2);
 assert.match(tasks.at(-1).request,/delayed cancellation two[\s\S]*responsive priority one/,'merged adjustment starts without waiting for the old transport');
 assert.equal(await page.locator('#ai-run-task').textContent(),tasks.at(-1).request);
 await page.evaluate(()=>{window.restoreQueueFetch();delete window.restoreQueueFetch;});
 releaseModel();modelGate=null;
 await page.waitForFunction(()=>document.querySelectorAll('#ai-task-list li').length===0 && document.querySelector('#ai-run-state').dataset.state==='success');await idle();
 assert.equal(tasks.length,beforeDelayed+2,'the superseded request never runs again');
 assert.equal(await input.inputValue(),'draft while switching');
 // Priority requests during an atomic save must be acknowledged and run next.
 let releaseSave,saveEntered,saveContinued;
 const saving=new Promise(resolve=>{saveEntered=resolve;});
 const saveGate=new Promise(resolve=>{releaseSave=resolve;});
 const saveRouted=new Promise(resolve=>{saveContinued=resolve;});
 await page.route('**/api/ai/apply?**',async route=>{saveEntered();await saveGate;await route.continue();saveContinued();});
 const beforeSave=tasks.length;
 await input.fill('saving two');await send.click();await saving;
 await input.fill('later two');await send.click();
 await input.fill('save priority one');await send.click();await input.fill('draft during save');
 const priority=page.locator('#ai-task-list li').filter({hasText:'save priority one'}).getByRole('button',{name:'立即执行',exact:true});
 assert.equal(await priority.isEnabled(),true,'saving still accepts a priority request');
 await priority.click();
 assert.match(await page.locator('#ai-run-detail').textContent(),/保存完成后.*调整/);
 assert.equal(await page.locator('#ai-task-list li').count(),1,'only unrelated tasks remain queued');
 assert.equal(tasks.length,beforeSave+1,'priority cannot interrupt an atomic save');
 await page.screenshot({path:fileURLToPath(new URL('../output/ai-queue-ui/save-priority.png',import.meta.url))});
 releaseSave();await saveRouted;await page.unroute('**/api/ai/apply?**');
 await page.waitForFunction(()=>document.querySelectorAll('#ai-task-list li').length===0 && document.querySelector('#ai-run-state').dataset.state==='success');await idle();
 assert.equal(tasks[beforeSave].request,'saving two');
 assert.match(tasks[beforeSave+1].request,/saving two[\s\S]*后续调整[\s\S]*save priority one/);
 assert.equal(tasks[beforeSave+2].request,'later two');
 assert.equal(tasks.length,beforeSave+3);
 assert.equal(await input.inputValue(),'draft during save');
 // A failed atomic save pauses the combined task rather than losing either goal.
 let rejectSave;
 const rejectedSaveGate=new Promise(resolve=>{rejectSave=resolve;});
 let failedSaveEntered;
 const failedSaving=new Promise(resolve=>{failedSaveEntered=resolve;});
 await page.route('**/api/ai/apply?**',async route=>{
   failedSaveEntered();await rejectedSaveGate;
   await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'模拟保存冲突'})});
 });
 const beforeFailure=tasks.length;
 await input.fill('save conflict two');await send.click();await failedSaving;
 await input.fill('continue with one');await send.click();await input.fill('preserve after conflict');
 await page.locator('#ai-task-list li').getByRole('button',{name:'立即执行',exact:true}).click();
 rejectSave();await idle();await page.unroute('**/api/ai/apply?**');
 assert.equal(tasks.length,beforeFailure+1,'failed save pauses further generation');
 assert.equal(await page.locator('#ai-task-list li').count(),1);
 assert.match(await page.locator('#ai-task-list').textContent(),/save conflict two[\s\S]*continue with one/);
 assert.equal(await input.inputValue(),'preserve after conflict');
 await page.locator('#ai-task-resume').click();await idle();
 assert.equal(tasks.length,beforeFailure+2);
 assert.match(tasks.at(-1).request,/save conflict two[\s\S]*continue with one/);
 console.log('PASS: sequential queue, merged adjustments, save-phase continuation, draft preservation, steering, failure pause/resume and manual stop');
}finally{releaseModel?.();await browser.close();await new Promise(r=>server.close(r));await new Promise(r=>model.close(r));await rm(temp,{recursive:true,force:true});}
