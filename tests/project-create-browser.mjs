import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,cp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createDevServer} from '../dev-server.mjs';
import {EDITOR_SOURCE_RULES} from '../ai-source-rules.mjs';

const temp=await mkdtemp(join(tmpdir(),'project-create-ui-'));
const folder=join(temp,'空白项目'),editorDir=join(temp,'editor');
await mkdir(folder);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','output','editor-config.json'].includes(path.split(/[\\/]/).pop())});
let receivedInstruction='',receivedFiles={};
const model=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'test'}]}));
  let body='';for await(const chunk of req)body+=chunk;
  const envelope=JSON.parse(body);receivedInstruction=envelope.messages[0].content;
  const task=JSON.parse(envelope.messages[1].content);receivedFiles=task.files;
  const before=task.files['index.html'];
  const after=before.replace('class="project-title">新项目','class="project-title">团队工作台').replace('</section>',
    '<button id="details-toggle" type="button" aria-controls="project-details">查看说明</button><p id="project-details" hidden>演示交互说明</p></section>');
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[
    {path:'index.html',before,after},
    {path:'app.js',before:task.files['app.js'],after:'"use strict";\ndocument.getElementById("details-toggle").addEventListener("click",()=>{const details=document.getElementById("project-details");details.hidden=!details.hidden;});\n'},
  ],explanation:'已构建团队工作台和说明交互'})}}]}));
});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
const server=createDevServer({rootDir:temp,editorDir});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
await fetch(base+'/api/ai/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:`http://127.0.0.1:${model.address().port}/v1`,model:'test',apiKey:'test-only'})});
const browser=await chromium.launch({headless:true});
let standalone;
try {
  const page=await browser.newPage({viewport:{width:1550,height:1050}});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/editor/editor.html');
  await page.locator('#project-dialog').waitFor();
  await page.locator('#project-folder-path').fill(folder);
  await page.locator('#confirm-open-project').click();
  await page.locator('#create-blank-project').waitFor();
  assert.deepEqual(await readdir(folder),[],'detecting an empty folder does not create files');
  await page.locator('#project-folder-path').fill(folder+'-changed');
  assert.equal(await page.locator('#project-create-option').isVisible(),false,'changing path clears the previous target');
  await page.locator('#project-folder-path').fill(folder);
  await page.locator('#confirm-open-project').click();
  await page.locator('#create-blank-project').waitFor();
  await mkdir('output/project-create',{recursive:true});
  await page.screenshot({path:'output/project-create/empty-folder.png'});
  await page.locator('#close-project-dialog').click();
  assert.deepEqual(await readdir(folder),[],'cancelling keeps folder empty');
  await page.locator('#open-project-button').click();
  assert.equal(await page.locator('#project-create-option').isVisible(),false);
  // Substitute only the OS folder picker; reuse the actual API response for that folder.
  await page.route('**/api/projects/choose',async route=>{
    const result=await page.request.post(base+'/api/projects/open',{data:{path:folder}});
    await route.fulfill({status:result.status(),contentType:'application/json',body:await result.text()});
  });
  await page.locator('#choose-project-folder').click();
  await page.locator('#create-blank-project').click();
  const f=page.frameLocator('#prototype-frame');
  await f.locator('body[data-ve-editor-ready="true"]').waitFor();
  await page.locator('#ai-chat-input').waitFor();
  await page.waitForFunction(()=>!location.search.includes('newProject'));
  assert.equal(await page.locator('#project-select option:checked').textContent(),'空白项目');
  assert.equal(await page.locator('#initial-generation-prompt').inputValue(),EDITOR_SOURCE_RULES);
  assert.ok((await readFile(join(folder,'PROJECT-RULES.md'),'utf8')).includes(EDITOR_SOURCE_RULES));
  await page.screenshot({path:'output/project-create/new-workspace.png'});
  await page.locator('#ai-chat-input').fill('构建一个团队工作台，添加查看说明按钮和可切换的说明内容');
  await page.locator('#ai-chat-send').click();
  await f.locator('#project-title').filter({hasText:'团队工作台'}).waitFor({timeout:30000});
  assert.ok(receivedInstruction.includes(EDITOR_SOURCE_RULES),'AI receives the shared compatibility requirements');
  assert.deepEqual(Object.keys(receivedFiles).sort(),['app.js','index.html','styles.css']);
  await page.locator('#ai-close').click();
  await page.locator('[data-mode="edit"]').click();
  await f.locator('#project-title').click({modifiers:['Alt']});
  await page.locator('#prop-text').fill('已保存的团队工作台');
  await page.locator('#prop-text').dispatchEvent('change');
  await page.locator('#prop-color-text').fill('#cf304a');
  await page.locator('#prop-color-text').dispatchEvent('change');
  await f.locator('#starter-value').click({modifiers:['Alt']});
  await page.locator('#prop-text').fill('42');
  await page.locator('#prop-text').dispatchEvent('change');
  await f.locator('#starter-card').click({position:{x:8,y:8},modifiers:['Alt']});
  assert.equal(await f.locator('#starter-card.ve-selected').count(),1);
  await page.locator('[data-nudge="down"]').click();
  await page.locator('[data-nudge="right"]').click();
  const translate=await f.locator('#starter-card').evaluate(el=>getComputedStyle(el).translate);
  assert.equal(translate,'1px 1px');
  const save=page.waitForResponse(res=>res.url().includes('/api/source-save') && res.request().method()==='POST');
  await page.locator('#save-button').click();assert.equal((await save).status(),200);
  await page.waitForFunction(()=>!document.querySelector('#save-button').disabled);
  const html=await readFile(join(folder,'index.html'),'utf8');
  assert.match(html,/已保存的团队工作台/);assert.match(html,/>42<\/span>/);
  await page.close();
  // Independent HTTP server: no editor endpoints, injected scripts or saved browser state.
  standalone=createServer(async(req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!['index.html','styles.css','app.js'].includes(name)){res.writeHead(404);res.end();return;}
    res.setHeader('content-type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
    res.end(await readFile(join(folder,name)));
  });
  await new Promise(r=>standalone.listen(0,'127.0.0.1',r));
  const context=await browser.newContext(),plain=await context.newPage();
  plain.on('pageerror',e=>errors.push(e.message));
  plain.on('response',res=>{if(res.status()>=400)errors.push(`Resource ${res.status()}: ${res.url()}`);});
  await plain.goto(`http://127.0.0.1:${standalone.address().port}`);
  for(let run=0;run<3;run++) {
    assert.equal(await plain.locator('#project-title').textContent(),'已保存的团队工作台');
    assert.equal(await plain.locator('#project-title').evaluate(el=>getComputedStyle(el).color),'rgb(207, 48, 74)');
    assert.equal(await plain.locator('#starter-value').textContent(),'42');
    assert.equal(await plain.locator('#starter-card').evaluate(el=>getComputedStyle(el).translate),translate);
    await plain.locator('#details-toggle').click();assert.equal(await plain.locator('#project-details').isVisible(),true);
    await plain.locator('#details-toggle').click();assert.equal(await plain.locator('#project-details').isVisible(),false);
    assert.equal(await plain.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);return new Set(ids).size===ids.length;}),true);
    await plain.reload();
  }
  await plain.screenshot({path:'output/project-create/standalone-saved.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: empty-folder choice, cancellation, creation, shared rules, AI build, four visual edits, standalone persistence and repeated interactions');
} finally {
  await browser.close();
  await Promise.all([server,model,standalone].filter(Boolean).map(s=>new Promise(r=>s.close(r))));
  await rm(temp,{recursive:true,force:true});
}
