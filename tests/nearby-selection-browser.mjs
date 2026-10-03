import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'nearby-pick-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:p=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(p.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),`<!doctype html><html><head><style>body{margin:0;min-height:900px}h1{position:absolute;left:40px;top:50px;width:650px;margin:0;font-size:60px;line-height:1.3}#accent{color:green}#cover{position:absolute;left:40px;top:290px;margin:0;width:450px;height:80px;font-size:24px;z-index:2}#neighbor{position:absolute;left:210px;top:320px;margin:0;font-size:24px}</style></head><body><h1 id="heading">让想法落地，<br>让品牌<span id="accent">生长。</span></h1><p id="neighbor">旁边组件</p><p id="cover">前面组件</p></body></html>`);
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const p=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();const browser=await chromium.launch();
try{const page=await browser.newPage({viewport:{width:1700,height:1050}});page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`${base}/editor/editor.html?project=${p.id}&entry=index.html`);const f=page.frameLocator('#prototype-frame');await f.locator('body[data-ve-editor-ready="true"]').waitFor();await page.locator('[data-mode="edit"]').click();
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await settle();
const selected=()=>f.locator('.ve-selected').evaluateAll(ns=>ns.map(n=>n.id));
async function clickPoint(selector,{x=null,y=null,alt=false}={}){const rect=await f.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};});const frame=await page.locator('#prototype-frame').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,scale:r.width/el.clientWidth};});if(alt)await page.keyboard.down('Alt');await page.mouse.click(frame.left+(rect.left+(x??rect.width/2))*frame.scale,frame.top+(rect.top+(y??rect.height/2))*frame.scale);if(alt)await page.keyboard.up('Alt');await settle();}
await clickPoint('#heading',{x:60,y:35});assert.deepEqual(await selected(),['heading']);
await clickPoint('#accent');assert.deepEqual(await selected(),['accent']);
await clickPoint('#heading',{x:60,y:35});assert.deepEqual(await selected(),['heading']);
// A neighboring text element is underneath only the blank part of a broad text wrapper.
await clickPoint('#neighbor');assert.deepEqual(await selected(),['neighbor'],'blank wrapper must not swallow neighboring text');
await clickPoint('#accent');assert.deepEqual(await selected(),['accent']);
await clickPoint('#accent',{alt:true});assert.deepEqual(await selected(),['heading'],'Alt click should select the containing component');
await clickPoint('#accent');assert.deepEqual(await selected(),['accent'],'normal click should return to the inner text');
assert.deepEqual(errors,[]);console.log('PASS: parent/child text switching, neighboring text beneath blank wrapper, Alt layer selection and normal click recovery');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
