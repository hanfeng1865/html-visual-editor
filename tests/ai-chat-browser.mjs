import {chromium} from 'playwright';
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
 const before=task.files['index.html'];let after=before.replace(/(<h1 id="title"[^>]*>)[\s\S]*?<\/h1>/,'$1'+(task.request.includes('two')?'AI two':'AI one')+'</h1>');
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
 assert.equal(await page.locator('#ai-chat-button').count(),1,'自然语言入口存在');
 await page.locator('[data-mode=edit]').click();await f.locator('#title').click({modifiers:['Alt']});await page.locator('#prop-text').fill('Saved draft');await page.locator('#prop-text').dispatchEvent('change');
 await page.locator('#ai-chat-button').click();
 assert.equal(await page.locator('.toolbar-actions #ai-chat-button').count(),0,'入口在侧边栏');
 assert.equal(await page.locator('.sidebar-navigation button').count(),3,'保留三个工具入口');
 async function checkNavigation(){const buttons=await page.locator('.sidebar-navigation').evaluate(nav=>[...nav.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right};}));assert.ok(buttons.every(b=>Math.abs(b.top-buttons[0].top)<1),'所有侧栏共用横向标签栏');assert.ok(buttons[0].right<=buttons[1].left && buttons[1].right<=buttons[2].left,'三个入口并排且不重叠');}
 await checkNavigation();
 assert.equal(await page.locator('#ai-generate').isVisible(),false,'空待办不干扰对话输入');
 assert.equal(await page.locator('.ai-compose-help').evaluate(el=>el.open),false,'详细说明按需展开');
 assert.equal(await page.locator('#ai-dialog').evaluate(el=>el.matches(':modal')),false,'AI 不遮挡画布');
 for(const width of [1500,1000]) {
  await page.setViewportSize({width,height:1000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const bounds=await page.evaluate(()=>{const pane=document.getElementById('ai-dialog').getBoundingClientRect(),canvas=document.querySelector('.canvas-area').getBoundingClientRect();return {pane:{left:pane.left,right:pane.right},canvas:{left:canvas.left,right:canvas.right},width:innerWidth};});
  assert.ok(bounds.pane.right<=bounds.canvas.left+1,'AI 栏在画布左侧并排显示');assert.ok(bounds.pane.left>=0,'左侧栏保持在窗口内');assert.ok(bounds.pane.right<=bounds.width+1,'侧栏保持在窗口内');assert.ok(bounds.canvas.right-bounds.canvas.left>250,'画布仍可见');
 }
 await page.setViewportSize({width:1500,height:1000});
 // Keep the panel open while changing selection in the main interface.
 await page.waitForTimeout(300);await f.locator('#number').click({position:{x:8,y:8},modifiers:['Alt']});assert.equal(await f.locator('#number.ve-selected').count(),1);assert.equal(await page.locator('#ai-chat-input').isVisible(),true);assert.equal(await page.locator('#text-toolbar').isVisible(),false);
 assert.equal(await page.locator('#inspector-fields').isVisible(),true,'AI 打开时右侧属性仍可编辑');
 await page.locator('#ai-close').click();await page.waitForFunction(()=>!document.querySelector('.editor-main').classList.contains('ai-open'));
 assert.equal(await page.locator('#inspector-fields').isVisible(),true,'关闭 AI 后恢复组件属性');
 assert.equal(await page.locator('#ai-chat-button').getAttribute('aria-expanded'),'false');
 await page.locator('#ai-chat-button').click();
 await page.locator('#layers-toggle').click();assert.equal(await page.locator('#ai-dialog').isVisible(),false,'切换图层关闭 AI');await page.locator('#structure-panel').waitFor({state:'visible'});await checkNavigation();
 assert.equal(await page.locator('#insert-panel').isVisible(),true,'打开时默认新增组件');
 await page.locator('[data-structure-tab=layers]').click();assert.equal(await page.locator('#layers-panel').isVisible(),true,'仍可切回图层');
 await page.locator('#layers-toggle').click();await page.locator('#layers-toggle').click();assert.equal(await page.locator('#insert-panel').isVisible(),true,'重新打开仍默认新增组件');
 await page.locator('#ai-chat-button').click();assert.equal(await page.locator('#structure-panel').isVisible(),false,'AI 使用左侧区域');
 await page.locator('#editor-help-toggle').click();assert.equal(await page.locator('#ai-dialog').isVisible(),false);await page.locator('#editor-help-content').waitFor({state:'visible'});await checkNavigation();
 await page.locator('#ai-chat-button').click();assert.equal(await page.locator('#editor-help-content').isVisible(),false);
 assert.equal(await page.locator('#ai-attach-selection').count(),1,'可以引用选中的区域');
 await page.locator('#ai-attach-selection').click();assert.match(await page.locator('#ai-selection-summary').textContent(),/128/);
 const pixel=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;canvas.getContext('2d').fillRect(0,0,8,8);return canvas.toDataURL('image/png').split(',')[1];});
 await page.locator('#ai-image-file').setInputFiles({name:'截图.png',mimeType:'image/png',buffer:Buffer.from(pixel,'base64')});
 await page.waitForFunction(()=>document.querySelectorAll('#ai-images img').length===1);
 await page.locator('#ai-chat-input').evaluate((input,pixel)=>{const bytes=Uint8Array.from(atob(pixel),c=>c.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'粘贴截图.png',{type:'image/png'}));input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},pixel);
 await page.waitForFunction(()=>document.querySelectorAll('#ai-images img').length===2);
 const large=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1200;canvas.getContext('2d').fillRect(0,0,2000,1200);return canvas.toDataURL('image/png').split(',')[1];});
 await page.locator('#ai-image-file').setInputFiles({name:'高清截图.png',mimeType:'image/png',buffer:Buffer.from(large,'base64')});await page.waitForFunction(()=>document.querySelectorAll('#ai-images img').length===3);assert.match(await page.locator('#ai-images img').last().getAttribute('src'),/^data:image\/jpeg/);
 await page.locator('#ai-image-file').setInputFiles({name:'第四张.png',mimeType:'image/png',buffer:Buffer.from(pixel,'base64')});await page.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('最多'));assert.equal(await page.locator('#ai-images img').count(),3);

 modelGate=new Promise(resolve=>{releaseModel=resolve;});
 await page.locator('#ai-chat-input').fill('把标题改成 AI one');await page.locator('#ai-chat-send').click();
 await page.locator('#ai-run-state[data-state="running"][data-phase="generate"]').waitFor({timeout:3000});
 assert.equal(await page.locator('.ai-run-segment').count(),3,'progress uses three aligned segments');
 async function checkProgressAlignment(){
   const bounds=await page.locator('.ai-run-steps li').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect(),bar=el.querySelector('.ai-run-segment').getBoundingClientRect(),label=el.querySelector('.ai-run-step-label').getBoundingClientRect();return {width:r.width,top:r.top,barTop:bar.top,labelTop:label.top};}));
   assert.ok(bounds.every(b=>Math.abs(b.width-bounds[0].width)<1 && Math.abs(b.top-bounds[0].top)<1 && Math.abs(b.barTop-bounds[0].barTop)<1 && Math.abs(b.labelTop-bounds[0].labelTop)<1),'bars and labels align in equal columns');
 }
 await checkProgressAlignment();
 assert.match(await page.locator('#ai-run-title').textContent(),/AI 修改中/);
 assert.match(await page.locator('#ai-run-detail').textContent(),/模型/);
 assert.match(await page.locator('#ai-chat-send').textContent(),/修改中/);
 assert.equal(await page.locator('#ai-chat-send').isDisabled(),true);
 await page.waitForFunction(()=>document.querySelector('#ai-run-elapsed').textContent.includes('1 秒'));
 await page.locator('#ai-chat-input').press('ControlOrMeta+Enter');assert.equal(tasks.length,1,'busy state prevents duplicate requests');
 const indicator=await page.locator('#ai-run-state').boundingBox();
 assert.ok(indicator.y>=0 && indicator.y+indicator.height<500,'progress stays above the scrolling conversation');
 await page.screenshot({path:'/tmp/html-editor-ai-running.png',clip:{x:indicator.x-6,y:indicator.y-50,width:indicator.width+12,height:indicator.height+100}});
 releaseModel();modelGate=null;
 await page.locator('#ai-run-state[data-phase="verify"]').waitFor();
 await page.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('已修改并保存'),{},{timeout:5000});
 assert.equal(await page.locator('#ai-run-state').getAttribute('data-state'),'success');
 assert.match(await page.locator('#ai-run-title').textContent(),/已保存/);
 assert.equal(await page.locator('.ai-run-steps .is-done').count(),3);
 await checkProgressAlignment();
 for(const width of [1000,1500]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await checkProgressAlignment();}
 const completed=await page.locator('#ai-run-state').boundingBox();
 await page.screenshot({path:'/tmp/html-editor-ai-progress.png',clip:{x:completed.x-4,y:completed.y-4,width:completed.width+8,height:completed.height+8}});

 assert.equal(await page.locator('#ai-chat-send').textContent(),'发送并修改 ↑');
 assert.match(tasks[0].files['index.html'],/Saved draft/);assert.equal(tasks.length,1);assert.equal(tasks[0].request,'把标题改成 AI one');assert.equal(tasks[0].receivedImageCount,3);assert.equal(tasks[0].selection.elements[0].selector,'#number');
 assert.match(await readFile(join(project,'index.html'),'utf8'),/AI one/);await f.locator('#title').filter({hasText:'AI one'}).waitFor();
 assert.equal(await page.locator('#ai-dialog').evaluate(el=>el.open),true,'侧栏保持打开');assert.equal(await page.locator('#ai-apply').count(),0,'无需再次确认');assert.equal(await page.locator('#ai-images img').count(),0);assert.equal(await page.locator('#ai-chat-input').inputValue(),'');
 assert.equal(await page.locator('#ai-chat-log').isVisible(),false,'完成后历史默认收起');
 await page.locator('#ai-chat-history summary').click();assert.equal(await page.locator('#ai-chat-log').isVisible(),true,'可按需展开历史');
 const firstDuration=await page.locator('.ai-chat-message.assistant .ai-chat-duration').first().textContent({timeout:2000});assert.match(firstDuration,/^用时 \d+ 秒$/);
 await page.locator('#ai-chat-input').fill('接着改成 AI two');await page.locator('#ai-chat-input').press('ControlOrMeta+Enter');
 await page.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('已修改并保存') && !document.querySelector('#ai-chat-input').disabled && document.querySelector('#ai-chat-input').value==='',{},{timeout:5000});
 assert.ok(tasks.at(-1).history.some(item=>item.role==='assistant' && item.content.includes('已写入')));
 assert.match(await readFile(join(project,'index.html'),'utf8'),/AI two/);
 assert.equal(await page.locator('#ai-chat-history').evaluate(el=>el.open),false,'下一轮完成自动收起历史');
 const standalone=await browser.newPage();await standalone.goto(`${base}/project/${p.id}/index.html`);assert.equal(await standalone.locator('#title').textContent(),'AI two');assert.equal(await standalone.locator('#number').textContent(),'128');await standalone.close();
 await page.locator('#ai-chat-button').click();await page.locator('#ai-attach-region').click();
 const geometry=await page.locator('#prototype-frame').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left,y:r.top,scale:r.width/el.clientWidth};});
 await page.mouse.move(geometry.x+20*geometry.scale,geometry.y+20*geometry.scale);await page.mouse.down();await page.mouse.move(geometry.x+350*geometry.scale,geometry.y+130*geometry.scale,{steps:3});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('#ai-selection-summary').textContent.includes('框选区域'));
 assert.equal(await f.locator('#editor-box-selection').count(),0);
 await page.locator('#ai-chat-input').fill('只修改框选区域');mode='fail';await page.locator('#ai-chat-send').click();await page.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('503'));assert.equal(tasks.at(-1).selection.kind,'region');assert.ok(tasks.at(-1).selection.elements.length>0);
 await page.locator('#ai-selection-clear').click();assert.equal(await page.locator('#ai-selection-context').isVisible(),false);
 await page.locator('#ai-close').click();
 mode='duplicate';await page.locator('#ai-chat-button').click();await page.locator('#ai-chat-input').fill('新增重复标题');await page.locator('#ai-chat-send').click();await page.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('重复 ID'));assert.match(await readFile(join(project,'index.html'),'utf8'),/AI two/);
 mode='fail';await page.locator('#ai-image-file').setInputFiles({name:'失败保留.png',mimeType:'image/png',buffer:Buffer.from(pixel,'base64')});await page.waitForFunction(()=>document.querySelectorAll('#ai-images img').length===1);await page.locator('#ai-chat-input').fill('保留这条失败的请求');await page.locator('#ai-chat-send').click();await page.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('503'));
 assert.equal(await page.locator('#ai-run-state').getAttribute('data-state'),'error');assert.match(await page.locator('#ai-run-title').textContent(),/失败/);
 assert.equal(await page.locator('#ai-chat-input').inputValue(),'保留这条失败的请求');assert.equal(await page.locator('#ai-chat-send').isEnabled(),true);assert.equal(await page.locator('#ai-images img').count(),1,'失败保留截图');
 await page.reload();await f.locator('#title').waitFor();await page.locator('#ai-chat-button').click();assert.equal(await page.locator('#ai-chat-input').inputValue(),'保留这条失败的请求');assert.match(await page.locator('#ai-chat-log').textContent(),/已写入/);
 assert.equal(await page.locator('#ai-chat-log').isVisible(),false,'刷新后历史仍默认收起');
 assert.equal(await page.locator('.ai-chat-duration').count(),2,'successful requests retain their own timings after reload');assert.equal(await page.locator('.ai-chat-duration').last().textContent(),firstDuration);
 assert.match(await readFile(join(project,'index.html'),'utf8'),/AI two/);
 await page.locator('#ai-image-file').setInputFiles({name:'停止保留.png',mimeType:'image/png',buffer:Buffer.from(pixel,'base64')});await page.waitForFunction(()=>document.querySelectorAll('#ai-images img').length===1);
 const beforeStop=await readFile(join(project,'index.html'),'utf8');
 mode='good';modelGate=new Promise(resolve=>{releaseModel=resolve;});
 const disconnected=new Promise(resolve=>{resolveDisconnect=resolve;});
 await page.locator('#ai-chat-input').fill('取消这一轮任务');await page.locator('#ai-chat-send').click();
 await page.locator('#ai-run-state[data-phase="generate"][data-state="running"]').waitFor();
 await page.locator('#ai-stop').click({timeout:1000});
 await page.locator('#ai-run-state[data-state="stopped"]').waitFor({timeout:2000});
 assert.match(await page.locator('#ai-run-title').textContent(),/已停止/);
 assert.equal(await page.locator('#ai-chat-input').inputValue(),'取消这一轮任务');
 assert.equal(await page.locator('#ai-chat-send').isEnabled(),true);
 assert.equal(await page.locator('#ai-images img').count(),1);
 assert.equal(await readFile(join(project,'index.html'),'utf8'),beforeStop);
 assert.equal(await Promise.race([disconnected.then(()=>true),new Promise(r=>setTimeout(()=>r(false),2000))]),true,'stop also disconnects the upstream model request');
 releaseModel();modelGate=null;resolveDisconnect=null;
 await page.locator('#ai-chat-send').click();await page.locator('#ai-run-state[data-phase="verify"][data-state="running"]').waitFor();
 await page.locator('#ai-stop').click({timeout:1000});await page.locator('#ai-run-state[data-state="stopped"]').waitFor({timeout:2000});
 assert.equal(await readFile(join(project,'index.html'),'utf8'),beforeStop,'stopping verification prevents apply');
 mode='good';
 await page.route('**/api/ai/generate?**',async route=>{
   const request=route.request(),body=request.postDataJSON();delete body.stream;
   const response=await route.fetch({postData:JSON.stringify(body)});
   await route.fulfill({response});
 });
 await page.locator('#ai-chat-input').fill('兼容旧服务的普通响应');await page.locator('#ai-chat-send').click();
 await page.locator('#ai-run-state[data-state="success"]').waitFor({timeout:5000});
 await page.unroute('**/api/ai/generate?**');
 const beforeStream=await readFile(join(project,'index.html'),'utf8');
 mode='stream';modelGate=new Promise(resolve=>{releaseModel=resolve;});
 await page.locator('#ai-chat-input').fill('流式修改标题');await page.locator('#ai-chat-send').click();
 await page.waitForFunction(()=>document.querySelector('#ai-live-summary')?.textContent.includes('先保留页面结构'),{},{timeout:2000});
 assert.equal(await readFile(join(project,'index.html'),'utf8'),beforeStream,'summary arrives before the model finishes and before saving');
 assert.equal(await page.locator('#ai-process').evaluate(el=>el.open),true,'process expands during generation');
 releaseModel();modelGate=null;
 await page.locator('#ai-run-state[data-state="success"]').waitFor();
 assert.match(await page.locator('#ai-live-summary').textContent(),/最后检查页面是否正常/);
 assert.match(await page.locator('#ai-process-log').textContent(),/检查.*保存/s);
 console.log('PASS: selection/region context, screenshot upload/paste/compression/limits, multimodal transmission and failure retention; chat saves drafts first, sends compatibility rules, automatically checks and saves changes, supports follow-up/collapsed history/reload, blocks duplicate IDs and preserves failed input');
}finally{releaseModel?.();await browser.close();await new Promise(r=>server.close(r));await new Promise(r=>model.close(r));await rm(temp,{recursive:true,force:true});}
