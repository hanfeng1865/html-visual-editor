import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'selection-layout-ui-')),project=join(temp,'project');
await mkdir(project);
// Keep the project registry isolated from the user's running editor and other tests.
const editorDir=join(temp,'editor');
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(path.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),'<!doctype html><html><head><style>body{margin:0;min-height:900px;background:#fafafa}.card{position:absolute;width:160px;height:80px;border:1px solid #ddd;border-radius:10px;background:white;box-sizing:border-box}#reference{left:40px;top:80px;width:100px;height:60px}#moving{left:240px;top:180px;width:140px;height:80px}#third{left:500px;top:300px;width:80px;height:100px}</style></head><body><div id="reference" class="card"></div><div id="moving" class="card"></div><div id="third" class="card"></div></body></html>');
const server=createDevServer({rootDir:temp,editorDir});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const projectData=await (await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  await page.goto(`${base}/editor/editor.html?project=${projectData.id}&entry=index.html`);
  const f=page.frameLocator('#prototype-frame');
  await f.locator('#moving').waitFor();
  await page.locator('[data-mode="edit"]').click();
  await f.locator('#reference').click();
  assert.equal(await page.locator('#selection-layout-section').isVisible(),false);
  await f.locator('#moving').click({modifiers:['Shift']});
  assert.equal(await page.locator('#selection-layout-section').isVisible(),true);
  assert.equal(await page.locator('[data-selection-layout="distribute-x"]').isDisabled(),true);
  await f.locator('#third').click({modifiers:['Shift']});
  assert.equal(await page.locator('[data-selection-layout="distribute-x"]').isEnabled(),true);
  const rectangles=()=>f.locator('.card').evaluateAll(nodes=>nodes.map(el=>{
    const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
  }));
  const near=(a,b)=>assert.ok(Math.abs(a-b)<.1,`${a} != ${b}`);
  async function history(button) {
    const navigation=page.waitForEvent('framenavigated',{predicate:frame=>frame.parentFrame()!==null && frame.url().includes('editor-reload=')});
    await page.locator(button).click();await navigation;
    await f.locator('body[data-ve-editor-ready="true"]').waitFor();
  }
  async function selectAll() {
    await f.locator('#reference').click();
    await f.locator('#moving').click({modifiers:['Shift']});
    await f.locator('#third').click({modifiers:['Shift']});
  }
  const original=await rectangles();
  await page.locator('[data-selection-layout="top"]').click();
  let rects=await rectangles();rects.forEach(r=>near(r.top,80));
  await history('#undo-button');assert.deepEqual(await rectangles(),original);
  await history('#redo-button');rects=await rectangles();rects.forEach(r=>near(r.top,80));
  await history('#undo-button');
  await selectAll();
  await page.locator('[data-selection-layout="bottom"]').click();
  rects=await rectangles();rects.forEach(r=>near(r.bottom,400));
  await history('#undo-button');assert.deepEqual(await rectangles(),original);
  await selectAll();
  await page.locator('[data-selection-layout="distribute-x"]').click();
  rects=await rectangles();near(rects[1].left-rects[0].right,rects[2].left-rects[1].right);
  near(rects[0].left,original[0].left);near(rects[2].left,original[2].left);
  rects.forEach((r,i)=>near(r.top,original[i].top));
  const distributed=rects;
  await history('#undo-button');assert.deepEqual(await rectangles(),original);
  await history('#redo-button');assert.deepEqual(await rectangles(),distributed);
  await page.reload();await f.locator('#third').waitFor();assert.deepEqual(await rectangles(),distributed);
  console.log('PASS: multi-selection controls, top/bottom alignment, equal horizontal gaps, single-step undo/redo, draft reload');
} finally {
  await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});
}
