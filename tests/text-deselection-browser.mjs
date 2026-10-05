import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'text-deselect-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:p=>!['.git','node_modules','.editor-workspaces','editor-config.json','output'].includes(p.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),'<!doctype html><style>body{margin:0;min-height:900px;background:#f5f6fa}#text{position:absolute;left:100px;top:100px;width:110px;margin:0}#other{position:absolute;left:100px;top:200px;margin:0}</style><p id="text">文字</p><p id="other">其他文字</p>');
const server=createDevServer({rootDir:temp,editorDir});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const projectInfo=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1700,height:1050}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/editor/editor.html?project=${projectInfo.id}&entry=index.html`);
  const f=page.frameLocator('#prototype-frame');
  await f.locator('body[data-ve-editor-ready="true"]').waitFor();
  await page.locator('[data-mode="edit"]').click();
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  async function point(selector,x=8,y=8,clickCount=1) {
    await settle();
    const r=await f.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top};});
    const b=await page.locator('#prototype-frame').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,scale:r.width/el.clientWidth};});
    await page.mouse.click(b.left+(r.left+x)*b.scale,b.top+(r.top+y)*b.scale,{clickCount});await settle();
  }
  async function edit(){await point('#text',8,8,2);assert.equal(await f.locator('#text').getAttribute('contenteditable'),'true');}
  await edit();
  await page.keyboard.press('End');await page.keyboard.type('修改');
  await point('body',500,400);
  assert.equal(await f.locator('[contenteditable="true"]').count(),0,'blank canvas must exit text editing');
  assert.equal(await f.locator('.ve-selected').count(),0,'blank canvas must clear selection');
  assert.equal(await f.locator('#text').textContent(),'文字修改','clicking away commits text');
  await edit();await page.keyboard.press('End');await page.keyboard.type('取消');await page.keyboard.press('Escape');await settle();
  assert.equal(await f.locator('[contenteditable="true"]').count(),0,'Escape must exit text editing');
  assert.equal(await f.locator('.ve-selected').count(),0,'Escape must clear selection');
  assert.equal(await f.locator('#text').textContent(),'文字修改','Escape cancels only the current text edit');
  await edit();await point('#other');
  assert.equal(await f.locator('[contenteditable="true"]').count(),0,'selecting another element exits text editing');
  assert.equal(await f.locator('.ve-selected').getAttribute('id'),'other');
  await edit();await page.locator('#clear-selection').click();
  assert.equal(await f.locator('[contenteditable="true"]').count(),0);
  assert.equal(await f.locator('.ve-selected').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: blank canvas, Escape, switching elements and clear-selection button exit text editing');
} finally {await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
