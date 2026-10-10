import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'interaction-recovery-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:p=>!['.git','node_modules','.editor-workspaces','output','editor-config.json'].includes(p.split(/[\\/]/).pop())});
const source=`<!doctype html><html><body><button id="view" type="button">查看</button><section id="detail" hidden><h1 id="title">Original</h1><button id="back" type="button">返回</button></section><script>
document.getElementById('view').onclick=()=>{if(document.getElementById('title').textContent==='Broken')throw Error('entry regression');detail.hidden=false;document.getElementById('view').hidden=true;};
document.getElementById('back').onclick=()=>{detail.hidden=true;document.getElementById('view').hidden=false;};
</script></body></html>`;
await writeFile(join(project,'index.html'),source);
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const config=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1700,height:1050}});page.setDefaultTimeout(15000);
 await page.goto(`${base}/editor/editor.html?project=${config.id}&entry=index.html`);const f=page.frameLocator('#prototype-frame');
 await f.locator('#view').click();
 async function edit(text){await page.locator('[data-mode=edit]').click();if(!await page.locator('#prop-text').isVisible() || !await page.locator('#prop-text').isEnabled())await f.locator('#title').click({modifiers:['Alt']});await page.locator('#prop-text').fill(text);await page.locator('#prop-text').dispatchEvent('change');}
 await edit('Kept');await edit('Broken');
 await page.locator('[data-mode=preview]').click();await f.locator('#back').click();await f.locator('#view').click();
 await page.locator('#interaction-issue').waitFor();assert.match(await page.locator('#interaction-issue-text').textContent(),/entry regression/);
 await page.locator('#interaction-recover').click();await f.locator('#view').click();assert.equal(await f.locator('#title').textContent(),'Kept','recovery preserves earlier edits');
 await edit('Broken');assert.equal(await f.locator('#title').textContent(),'Broken');await page.reload();await f.locator('body[data-ve-editor-ready=true]').waitFor();
 let checks=0;
 await page.route('**/api/source-check**',route=>{checks++;return route.abort();});
 await f.locator('#view').click();await page.locator('#interaction-issue').waitFor();
 assert.equal(await page.locator('#interaction-recover').isEnabled(),true,'recovery survives editor reload');
 await page.locator('#interaction-recover').click();await f.locator('#view').click();assert.equal(await f.locator('#title').textContent(),'Kept');
 const saved=page.waitForResponse(r=>r.url().includes('/api/source-save')&&r.request().method()==='POST');
 await page.locator('#save-button').click();assert.equal((await saved).status(),200);
 await page.waitForFunction(()=>!document.getElementById('save-button').disabled);
 assert.match(await readFile(join(project,'index.html'),'utf8'),/>Kept</);
 assert.equal(checks,0,'ordinary saving must not run the slow entry check');
 console.log('PASS: runtime issue notice, one-step recovery, preserved earlier edits, recovery across reload and direct save without automatic entry checks');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
