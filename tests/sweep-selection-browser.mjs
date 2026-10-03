import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'sweep-selection-ui-')),project=join(temp,'project');
await mkdir(project);
// Keep the project registry isolated from the user's running editor and other tests.
const editorDir=join(temp,'editor');
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(path.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),'<!doctype html><html><head><style>body{margin:0;min-height:900px;background:#fafafa}.card{position:absolute;top:200px;width:60px;height:60px;background:white;border:1px solid #ddd}#first{left:80px}#second{left:210px}#third{left:340px}#locked{left:470px}#extra{left:80px;top:340px}#label{position:absolute;left:250px;top:350px;width:140px;height:60px;margin:0;font-size:12px;}</style></head><body><div id="first" class="card"></div><div id="second" class="card"></div><div id="third" class="card"></div><div id="locked" class="card" data-ve-locked="true"></div><div id="extra" class="card"></div><p id="label">Small text</p></body></html>');
const server=createDevServer({rootDir:temp,editorDir});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const projectData=await (await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  await page.goto(`${base}/editor/editor.html?project=${projectData.id}&entry=index.html`);
  const f=page.frameLocator('#prototype-frame');
  await f.locator('#first').waitFor();
  await page.locator('[data-mode="edit"]').click();
  assert.equal(await page.locator('#pointer-select').count(),0);
  const original=await f.locator('.card').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().toJSON()));
  const geometry=await page.locator('#prototype-frame').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,scale:r.width/el.clientWidth};});
  const point=(x,y)=>({x:geometry.left+x*geometry.scale,y:geometry.top+y*geometry.scale});
  const start=point(20,230),end=point(550,230);
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.waitForTimeout(350);
  // One fast move must pick intermediate components as well.
  await page.mouse.move(end.x,end.y);
  await page.mouse.move(start.x,start.y);
  assert.equal(await f.locator('.ve-selected').count(),3);
  assert.equal(await f.locator('#locked.ve-selected').count(),0);
  assert.deepEqual(await f.locator('.card').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().toJSON())),original);
  await page.mouse.up();
  assert.equal(await f.locator('.ve-selected').count(),3);
  assert.equal(await page.locator('#selected-name').textContent(),'已选择 3 个元素');
  assert.equal(await page.locator('[data-selection-layout="distribute-x"]').isEnabled(),true);
  // Shift adds a new component on another row to the retained selection.
  const extra=await f.locator('#extra').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(extra.x+10,extra.y+10);await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(extra.x+25,extra.y+25);await page.mouse.up();
  await page.keyboard.up('Shift');
  assert.equal(await f.locator('.ve-selected').count(),4);
  // Escape restores the selection before the next stroke.
  const box=await f.locator('#first').boundingBox();
  await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(box.x+20,box.y+20);
  assert.equal(await f.locator('.ve-selected').count(),1);
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await f.locator('.ve-selected').count(),4);
  // Release returns to ordinary movement; drag any selected member as a group.
  const groupBefore=await f.locator('.ve-selected').evaluateAll(nodes=>nodes.map(el=>({id:el.id,left:el.getBoundingClientRect().left,top:el.getBoundingClientRect().top})));
  const member=await f.locator('#first').boundingBox();
  await page.mouse.move(member.x+20,member.y+20);await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(member.x+50,member.y+35,{steps:3});await page.mouse.up();
  await page.keyboard.up('Alt');
  const groupAfter=await f.locator('.ve-selected').evaluateAll(nodes=>nodes.map(el=>({id:el.id,left:el.getBoundingClientRect().left,top:el.getBoundingClientRect().top})));
  assert.equal(groupAfter.length,4);
  const dx=groupAfter[0].left-groupBefore[0].left,dy=groupAfter[0].top-groupBefore[0].top;
  assert.ok(dx>0 && dy>0);
  groupAfter.forEach((rect,i)=>{assert.ok(Math.abs(rect.left-groupBefore[i].left-dx)<.1);assert.ok(Math.abs(rect.top-groupBefore[i].top-dy)<.1);});
  await page.locator('.canvas-status').click();
  assert.equal(await f.locator('.ve-selected').count(),0);
  // Sweep through the empty lower part of a text wrapper: glyph-only hit tests
  // used to miss this component entirely.
  const current=await page.locator('#prototype-frame').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,scale:r.width/el.clientWidth};});
  await page.mouse.move(current.left+20*current.scale,current.top+390*current.scale);await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(current.left+440*current.scale,current.top+390*current.scale);await page.mouse.up();
  assert.equal(await f.locator('#label.ve-selected').count(),1);
  console.log('PASS: fast stroke selects all crossed components, repeated crossings keep them selected, locked components excluded, no movement, release preserves selection, Escape restores, blank clears');
} finally {
  await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});
}
