import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {createVisualPatchEngine} from '../visual-patch-engine.mjs';
import {createStandaloneHtml} from '../export-html.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'delete-module-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json','output'].includes(path.split(/[\\/]/).pop())});
const source=`<!doctype html><html><head><style>section{padding:30px;border:1px solid #ccc}</style></head><body>
<div id="list"><button id="view">查看</button></div>
<div id="detail" class="detail-page" hidden><button id="back">返回</button><h1>车辆档案</h1>
<section id="maintenance"><h2>保养信息</h2><span id="reminder">正常</span><input id="interval" value="5000"></section>
<section id="insurance">保险信息</section></div>
<script>
const cached=document.getElementById('interval');
document.getElementById('view').onclick=()=>{
 document.getElementById('reminder').classList.toggle('alert',true);
 cached.value='6000';document.getElementById('maintenance').hidden=false;
 document.getElementById('list').hidden=true;document.getElementById('detail').hidden=false;
};
document.getElementById('back').onclick=()=>{document.getElementById('detail').hidden=true;document.getElementById('list').hidden=false;};
</script></body></html>`;
await writeFile(join(project,'index.html'),source);
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const config=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1700,height:1050}});page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${base}/editor/editor.html?project=${config.id}&entry=index.html`);
 const f=page.frameLocator('#prototype-frame');
 await f.locator('#view').click();await page.locator('[data-mode=edit]').click();
 await f.locator('#interval').click({modifiers:['Alt']});
 await page.locator('#place-on-page').click();
 assert.equal(await f.locator('#interval').evaluate(e=>e.closest('#detail')?.id),'detail','UI refuses to detach a detail control into the main page');
 await f.locator('#maintenance').click({modifiers:['Alt'],position:{x:5,y:5}});
 await page.locator('#delete-button').click();
 assert.equal(await f.locator('#maintenance').isVisible(),false);
 async function reopen(){await page.locator('[data-mode=preview]').click();await f.locator('#back').click();await f.locator('#view').click();assert.deepEqual(errors,[],'deleting a module must not break scripts reopening the detail page');assert.equal(await f.locator('#insurance').isVisible(),true);assert.equal(await f.locator('#maintenance').isVisible(),false);}
 await reopen();
 await page.locator('#undo-button').click();await f.locator('#view').click();
 assert.equal(await f.locator('#maintenance').isVisible(),true,'undo restores the module');
 await page.locator('#redo-button').click();await f.locator('#view').click();await reopen();
 await page.reload();await f.locator('#view').click();await reopen();
 await page.locator('#save-button').click();
 await page.waitForFunction(()=>!document.querySelector('#save-button').disabled && !document.querySelector('#source-dialog').open);
 await page.reload();await f.locator('#view').click();await reopen();
 const standalone=await browser.newPage();standalone.on('pageerror',e=>errors.push(e.message));
 await standalone.goto(`file://${join(project,'index.html')}`);await standalone.locator('#view').click();
 assert.equal(await standalone.locator('#insurance').isVisible(),true);
 assert.equal(await standalone.locator('#maintenance').isVisible(),false);
 assert.deepEqual(errors,[]);
 const exported=await createStandaloneHtml({source,patches:{maintenance:{selector:'#maintenance',deleted:true}},fetchImpl:async()=>({ok:true,text:async()=>'',arrayBuffer:async()=>new ArrayBuffer(0),headers:{get:()=>null}})});
 await standalone.goto("about:blank");
 await standalone.setContent(exported);
 await standalone.waitForFunction(()=>document.querySelector('#maintenance[data-ve-deleted]'));
 await standalone.locator('#view').click();await standalone.locator('#back').click();await standalone.locator('#view').click();
 assert.equal(await standalone.locator('#maintenance').isVisible(),false,'standalone export retains deletion after navigation');
 assert.equal(await standalone.locator('#insurance').isVisible(),true);
 assert.deepEqual(errors,[]);
 // Positional selectors remain stable across repeat application and serialization.
 await standalone.setContent('<main><section>A</section><section>B</section><section>C</section></main>');
 await standalone.evaluate(engineSource=>{
  const engine=eval('('+engineSource+')')(document);
  const patches={a:{selector:'main > section:nth-of-type(1)',deleted:true},b:{selector:'main > section:nth-of-type(2)',text:'Changed'}};
  engine.apply(patches);engine.apply(patches);
  window.savedPatches=patches;
 },createVisualPatchEngine.toString());
 assert.deepEqual(await standalone.locator('section:visible').allTextContents(),['Changed','C']);
 console.log('PASS: module deletion preserves navigation, undo/redo, draft reload, source save, standalone export and positional neighbours');
} finally {await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
