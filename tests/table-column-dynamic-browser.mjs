import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'dynamic-column-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json','output'].includes(path.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),`<!doctype html><style>th,td{padding:15px}table{min-width:600px}.sticky{position:sticky;left:200px}</style>
<button id="filter" onclick="render()">查询</button><div id="cards"><table><colgroup><col><col><col><col></colgroup><thead><tr><th>编号</th><th>公司</th><th class="sticky">使用人</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table></div>
<script>function view(button){button.textContent="已查看";}let round=0;function render(){round++;document.querySelector('#rows').innerHTML=[1,2,3].map(i=>'<tr><td>'+round+'-'+i+'</td><td>公司'+i+'</td><td class="sticky">使用人'+i+'</td><td><button onclick="view(this)">查看</button></td></tr>').join('');}render();</script>`);
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const config=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
 const legacyContext=await browser.newContext({viewport:{width:1700,height:1050}}),legacy=await legacyContext.newPage();
 await legacy.goto(`${base}/editor/editor.html?project=${config.id}&entry=index.html`);
 await legacy.frameLocator('#prototype-frame').locator('tbody tr').first().waitFor();
 await legacy.evaluate(async projectId=>{
   const doc=document.querySelector('#prototype-frame').contentDocument;
   const {createVisualPatchEngine}=await import('./visual-patch-engine.mjs'),engine=createVisualPatchEngine(doc);
   const patches={};
   for(const [i,cell] of [...doc.querySelectorAll('tr')].map(row=>row.cells[1]).entries()) {
     const selector=engine.selectorFor(cell);patches['legacy-'+i]={selector,deleted:true,...(cell.tagName==='TD'?{ai:{fields:{deleted:'动态元素缺少稳定标识'},context:{html:cell.outerHTML,label:cell.textContent,path:selector}}}:{})};
   }
   const key='html-editor-draft:'+projectId+':index.html';localStorage.setItem(key,JSON.stringify({version:1,patches}));localStorage.setItem(key+'-dirty','1');
 },config.id);
 await legacy.reload();await legacy.frameLocator('#prototype-frame').getByRole('columnheader',{name:'公司',exact:true}).waitFor({state:'detached'});
 assert.match(await legacy.locator('#saveability-summary').textContent(),/待 AI 写入：0 项/,'legacy whole-column deletions should migrate out of AI');
 await legacy.frameLocator('#prototype-frame').locator('#filter').click();
 await legacy.waitForFunction(()=>[...document.querySelector('#prototype-frame').contentDocument.querySelectorAll('tbody tr')].every(row=>row.cells.length===3));
 await legacyContext.close();
 const page=await browser.newPage({viewport:{width:1700,height:1050}});page.setDefaultTimeout(7000);
 const f=page.frameLocator('#prototype-frame');
 await page.goto(`${base}/editor/editor.html?project=${config.id}&entry=index.html`);
 await f.locator('body[data-ve-editor-ready=true]').waitFor();await f.locator('tbody tr').first().waitFor();await page.locator('[data-mode=edit]').click();
 async function remove(label){await f.getByRole('columnheader',{name:label,exact:true}).click({modifiers:['Alt']});await page.locator('#delete-table-column').click();}
 async function expectColumns(labels){await f.locator('table').evaluate((table,labels)=>{if(JSON.stringify([...table.tHead.rows[0].cells].map(c=>c.textContent))!==JSON.stringify(labels))throw Error('wrong headers');},labels);await page.waitForFunction(labels=>{const t=document.querySelector('#prototype-frame').contentDocument.querySelector('table');return [...t.tBodies[0].rows].every(r=>r.cells.length===labels.length);},labels);}
 await remove('公司');await expectColumns(['编号','使用人','操作']);
 assert.match(await page.locator('#saveability-summary').textContent(),/待 AI 写入：0 项/,'deleting a dynamic column must not require AI');
 await page.locator('[data-mode=preview]').click();await f.locator('#filter').click();await expectColumns(['编号','使用人','操作']);
 assert.equal(await f.locator('tbody td').first().textContent(),'2-1');
 await page.locator('#undo-button').click();await f.getByRole('columnheader',{name:'公司',exact:true}).waitFor();await expectColumns(['编号','公司','使用人','操作']);
 await page.locator('#redo-button').click();await f.getByRole('columnheader',{name:'公司',exact:true}).waitFor({state:'detached'});await expectColumns(['编号','使用人','操作']);
 await page.locator('[data-mode=edit]').click();await remove('使用人');await expectColumns(['编号','操作']);
 const saved=page.waitForResponse(r=>r.url().includes('/api/source-save')&&r.request().method()==='POST');await page.locator('#save-button').click();assert.equal((await saved).status(),200);
 await page.waitForFunction(()=>!document.querySelector('#save-button').disabled&&!document.querySelector('#source-dialog').open);
 await page.reload();await f.locator('body[data-ve-editor-ready=true]').waitFor();await expectColumns(['编号','操作']);
 await f.locator('#filter').click();await expectColumns(['编号','操作']);
 const standalone=await browser.newPage();await standalone.goto(`file://${join(project,'index.html')}`);
 await standalone.waitForFunction(()=>document.querySelector('tbody tr')?.cells.length===2);
 await standalone.locator('#filter').click();await standalone.waitForFunction(()=>document.querySelector('tbody tr')?.cells.length===2);
 assert.deepEqual(await standalone.locator('thead th').allTextContents(),['编号','操作']);
 assert.equal(await standalone.locator('col').count(),2);
 await standalone.locator('tbody button').first().click();assert.equal(await standalone.locator('tbody button').first().textContent(),'已查看');
 await standalone.evaluate(()=>{document.querySelector('tbody tr').innerHTML='<td>新编号</td><td>新公司</td><td>新使用人</td><td>新操作</td>';});
 await standalone.waitForFunction(()=>document.querySelector('tbody tr').cells.length===2);
 assert.deepEqual(await standalone.locator('tbody tr').first().locator('td').allTextContents(),['新编号','新操作']);
 await page.locator('[data-mode=edit]').click();await remove('编号');await expectColumns(['操作']);
 await f.getByRole('columnheader',{name:'操作',exact:true}).click({modifiers:['Alt']});
 assert.equal(await page.locator('#delete-table-column').isEnabled(),false);
 console.log('PASS: dynamic columns delete without AI, survive re-render, undo/redo, consecutive deletion, save/reload and standalone interaction');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
