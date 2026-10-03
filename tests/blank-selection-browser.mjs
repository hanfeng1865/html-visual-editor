import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'blank-selection-ui-')),project=join(temp,'project');
await mkdir(project);
await writeFile(join(project,'index.html'),'<!doctype html><html><head><style>body{margin:0;min-height:900px;background:#fafafa}.card{position:absolute;width:160px;height:80px;border:1px solid #ddd;border-radius:10px;background:white;box-sizing:border-box}#reference{left:40px;top:80px;width:100px;height:60px}#moving{left:240px;top:180px;width:140px;height:80px}#third{left:500px;top:300px;width:80px;height:100px}#layout{position:absolute;left:0;top:0;width:900px;height:700px}</style></head><body><main id="layout"><div id="reference" class="card"></div><div id="moving" class="card"></div><div id="third" class="card"></div></main></body></html>');
const server=createDevServer({rootDir:temp,editorDir:process.cwd()});
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
  async function selectMultiple() {
    await f.locator('#reference').click();
    await f.locator('#moving').click({modifiers:['Shift']});
    assert.equal(await f.locator('.ve-selected').count(),2);
  }
  async function clickCanvas(x,y,exact=false) {
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const geometry=await page.locator('#prototype-frame').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,scale:r.width/el.clientWidth};});
    if(exact)await page.keyboard.down('Alt');
    await page.mouse.click(geometry.left+x*geometry.scale,geometry.top+y*geometry.scale);
    if(exact)await page.keyboard.up('Alt');
  }
  async function verifyClear() {
    assert.equal(await f.locator('.ve-selected').count(),0);
    assert.equal(await page.locator('#inspector-fields').isVisible(),false);
    assert.equal(await page.locator('#editor-alignment-guides').count(),0);
  }
  await selectMultiple();
  // Click the space between components inside a layout wrapper.
  await clickCanvas(700,500);
  await verifyClear();
  await f.locator('#reference').click();
  assert.equal(await f.locator('.ve-selected').count(),1);
  // Page background beyond the layout wrapper.
  await clickCanvas(1000,500);
  await verifyClear();
  await selectMultiple();
  // Editor canvas gutter, outside the iframe.
  await page.locator('#canvas-scroll').click({position:{x:2,y:2}});
  await verifyClear();
  await selectMultiple();
  // Empty workspace above the iframe, as in the reported screenshot.
  await page.locator('.canvas-status').click();
  await verifyClear();
  await selectMultiple();
  await page.locator('.canvas-area').click({position:{x:400,y:3}});
  await verifyClear();
  // Zoom controls must not clear the active selection.
  await selectMultiple();
  await page.locator('#canvas-zoom').selectOption('0.75');
  assert.equal(await f.locator('.ve-selected').count(),2);
  // Exact selection still lets users intentionally select a container.
  await clickCanvas(700,500,true);
  assert.equal(await f.locator('#layout.ve-selected').count(),1);
  console.log('PASS: multi/single selection clears on layout gaps, page background and canvas gutter; exact container picking preserved');
} finally {
  await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});
}
