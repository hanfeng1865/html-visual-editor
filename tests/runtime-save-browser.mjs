import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'source-save-ui-')),project=join(temp,'project');await mkdir(project);
await cp(new URL('../',import.meta.url),join(temp,'editor'),{recursive:true,filter:source=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(source.split(/[\\/]/).pop())});
const original='<!doctype html><html><head><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><h1 id="title">Original</h1><p id="other">Other</p><div id="dynamic"></div></body></html>';
await writeFile(join(project,'index.html'),original);await writeFile(join(project,'style.css'),'h1{color:rgb(255,0,0)}');await writeFile(join(project,'app.js'),'document.querySelector("#dynamic").innerHTML="<p id=generated>Runtime</p>";');
const server=createDevServer({rootDir:temp,editorDir:join(temp,'editor')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const p=await (await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1700,height:1050}});page.setDefaultTimeout(8000);
 const url=`${base}/editor/editor.html?project=${p.id}&entry=index.html`;
 await page.goto(url);const f=page.frameLocator('#prototype-frame');
 await f.locator('#generated').waitFor();await page.locator('[data-mode="edit"]').click();
 async function save() {
   const response=page.waitForResponse(r=>r.url().includes('/api/source-save') && r.request().method()==='POST');
   await page.locator('#save-button').click();assert.equal((await response).status(),200);
   await page.waitForFunction(()=>!document.querySelector('#source-dialog').open&&!document.querySelector('#save-button').disabled);
   await f.locator('#title').waitFor();
 }
 await f.locator('#generated').click({modifiers:['Alt']});await page.locator('#prop-text').fill('Saved dynamic text');await page.locator('#prop-text').dispatchEvent('change');
 await save();await page.reload();await f.locator('#generated').waitFor();
 assert.equal(await f.locator('#generated').textContent(),'Saved dynamic text');
 await page.locator('[data-mode="edit"]').click();await f.locator('#generated').click({modifiers:['Alt']});
 await page.locator('#prop-text').fill('Edited again');await page.locator('#prop-text').dispatchEvent('change');
 await save();await page.reload();await f.locator('#generated').waitFor();
 assert.equal(await f.locator('#generated').textContent(),'Edited again');
 await page.locator('[data-mode="edit"]').click();await f.locator('#generated').click({modifiers:['Alt']});await page.locator('#delete-button').click();
 await save();await page.reload();await f.locator('#title').waitFor();
 assert.equal(await f.locator('#generated').isVisible(),false);
 const standalone=await browser.newPage();await standalone.goto(`file://${join(project,'index.html')}`);
 await standalone.waitForFunction(()=>document.querySelector('#generated[data-ve-deleted]'));
 await standalone.evaluate(()=>{document.querySelector('#dynamic').innerHTML='<p id="generated">Regenerated</p><p id="sibling">Keep sibling</p>';});
 await standalone.waitForFunction(()=>document.querySelector('#generated[data-ve-deleted]'));
 assert.equal(await standalone.locator('#sibling').textContent(),'Keep sibling');
 // A further static save must retain the existing runtime deletion.
 await page.locator('[data-mode="edit"]').click();await f.locator('#title').click({modifiers:['Alt']});await page.locator('#prop-text').fill('Static saved');await page.locator('#prop-text').dispatchEvent('change');
 await save();await standalone.reload();await standalone.waitForFunction(()=>document.querySelector('#generated[data-ve-deleted]'));
 assert.equal(await standalone.locator('#title').textContent(),'Static saved');
 console.log('PASS: dynamic edit, second edit, deletion, editor reload, standalone file, re-render and subsequent static save');
} finally {await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
