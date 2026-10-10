import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'table-column-delete-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json','output'].includes(path.split(/[\\/]/).pop())});
const table=(id,cols='')=>`<div class="scroll"><table id="${id}">${cols}<thead><tr><th class="check">选择</th><th class="code">编号</th><th class="plate">车牌</th><th>类型</th><th class="action">操作</th></tr></thead><tbody><tr><td class="check">勾选</td><td class="code">001</td><td class="plate">赣A001</td><td>商务车</td><td class="action">详情</td></tr></tbody></table></div>`;
await writeFile(join(project,'index.html'),`<!doctype html><style>
*{box-sizing:border-box}.scroll{width:400px;overflow:auto;margin:20px}table{border-spacing:0;table-layout:fixed;width:100%;min-width:600px}th,td{width:150px;height:45px;background:#fff;border-bottom:1px solid #ddd;padding:0}
.check{position:sticky;left:0;width:50px}.code{position:sticky;left:50px;width:100px}.plate{position:sticky;left:150px}.action{position:sticky;right:0;width:150px}.right-neighbour{position:sticky;right:150px}
</style>${table('plain')}${table('grouped','<colgroup><col style="width:50px"><col style="width:100px"><col span="2" style="width:150px"><col style="width:150px"></colgroup>')}${table('right').replace('<th>类型</th>','<th class="right-neighbour">类型</th>').replace('<td>商务车</td>','<td class="right-neighbour">商务车</td>')}${table('merged').replace('<td class="check">勾选</td><td class="code">001</td>','<td colspan="2">合并内容</td>')}`);
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const config=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(7000);
 const f=page.frameLocator('#prototype-frame');
 await page.goto(`${base}/editor/editor.html?project=${config.id}&entry=index.html`);
 await f.locator('body[data-ve-editor-ready=true]').waitFor();await page.locator('[data-mode=edit]').click();
 async function remove(id,cell){await f.locator(`#${id} thead ${cell}`).click({modifiers:['Alt']});await page.locator('#delete-table-column').click();}
 async function metrics(id){return f.locator('#'+id).evaluate(table=>({
  cells:[...table.rows].map(row=>[...row.cells].map(cell=>cell.textContent)),
  left:[...table.querySelectorAll('.plate')].map(cell=>getComputedStyle(cell).left),
  width:table.getBoundingClientRect().width,
  columns:[...table.querySelectorAll('col')].reduce((sum,col)=>sum+col.span,0),
 }));}
 for(const id of ['plain','grouped']) {
  await remove(id,'.code');
  let result=await metrics(id);
  assert.deepEqual(result.cells,[['选择','车牌','类型','操作'],['勾选','赣A001','商务车','详情']]);
  assert.deepEqual(result.left,['50px','50px'],'remaining sticky cells must close the deleted column gap');
  assert.equal(result.width,500,'table width must shrink with its deleted column');
  if(id==='grouped')assert.equal(result.columns,4,'colgroup must lose the corresponding column');
  await f.locator(`#${id} thead .plate`).click({modifiers:['Alt']});
  await page.locator('#prop-text').fill('当前车牌');await page.locator('#prop-text').dispatchEvent('change');
  result=await metrics(id);assert.equal(result.cells[0].length,4);
  if(id==='grouped')assert.equal(result.columns,4,'later edits must not delete the next colgroup column');
  await page.locator('#undo-button').click();
  await page.locator('#undo-button').click();await f.locator(`#${id} .code`).first().waitFor();
  result=await metrics(id);assert.equal(result.width,600);assert.deepEqual(result.left,['150px','150px']);
  await page.locator('#redo-button').click();await f.locator(`#${id} .code`).first().waitFor({state:'detached'});
  result=await metrics(id);assert.equal(result.cells[0].length,4);assert.deepEqual(result.left,['50px','50px']);
  if(id==='grouped') {
   await remove(id,'.plate');result=await metrics(id);
   assert.equal(result.columns,3,'consecutive deletions skip removed-column placeholders');
   assert.equal(result.cells[0].length,3);
   await page.locator('#undo-button').click();await f.locator(`#${id} .plate`).first().waitFor();
  }
 }
 const saved=page.waitForResponse(response=>response.url().includes('/api/source-save')&&response.request().method()==='POST');
 await page.locator('#save-button').click();assert.equal((await saved).status(),200);
 await page.waitForFunction(()=>!document.querySelector('#save-button').disabled&&!document.querySelector('#source-dialog').open);
 await page.reload();await f.locator('body[data-ve-editor-ready=true]').waitFor();
 for(const id of ['plain','grouped']){const result=await metrics(id);assert.equal(result.cells[0].length,4);assert.deepEqual(result.left,['50px','50px']);assert.equal(result.width,500);}
 await page.locator('[data-mode=edit]').click();await remove('grouped','.plate');
 const result=await metrics('grouped');assert.equal(result.cells[0].length,3);assert.equal(result.width,400,'percentage table width still fills its container');assert.equal(result.columns,3,'deleting a column represented by col span shrinks its span');
 await remove('right','.action');
 assert.deepEqual(await f.locator('#right .right-neighbour').evaluateAll(cells=>cells.map(cell=>getComputedStyle(cell).right)),['0px','0px']);
 await remove('merged','.code');
 assert.equal(await f.locator('#merged tbody td').first().getAttribute('colspan'),'1');
 assert.equal(await f.locator('#merged tbody td').first().textContent(),'合并内容');
 console.log('PASS: generic column deletion closes sticky gaps, adjusts table width and colgroup, supports undo/redo, saves and reloads');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
