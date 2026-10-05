import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'resize-alignment-ui-')),project=join(temp,'project');
await mkdir(project);
// Keep the project registry isolated from the user's running editor and other tests.
const editorDir=join(temp,'editor');
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(path.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),'<!doctype html><html><head><style>body{margin:0;min-height:900px;background:#fafafa}.card{position:absolute;width:160px;height:80px;border:1px solid #ddd;border-radius:10px;background:white;box-sizing:border-box}#reference{left:300px;top:220px}#moving{left:40px;top:80px}</style></head><body><div id="reference" class="card"></div><div id="moving" class="card"></div></body></html>');
const server=createDevServer({rootDir:temp,editorDir});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const projectData=await (await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  page.setDefaultTimeout(8000);
  await page.goto(`${base}/editor/editor.html?project=${projectData.id}&entry=index.html`);
  const f=page.frameLocator('#prototype-frame');
  await f.locator('#moving').waitFor();
  await page.locator('[data-mode="edit"]').click();
  assert.equal(await page.locator('#pointer-move').getAttribute('aria-pressed'),'true');
  await f.locator('#moving').click();
  for(const zoom of ['1','0.5']) {
    await page.locator('#canvas-zoom').selectOption(zoom);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const scale=await page.locator('#prototype-frame').evaluate(el=>el.getBoundingClientRect().width/el.clientWidth);
    const handle=await page.locator('#element-resize-handle').boundingBox();assert.ok(handle);
    const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+98*scale,y+138*scale,{steps:8});
    assert.ok(await page.locator('.alignment-guide[data-axis="x"]').count()>0);
    assert.ok(await page.locator('.alignment-guide[data-axis="y"]').count()>0);
    const rect=await f.locator('#moving').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};});
    assert.deepEqual(rect,{left:40,top:80,right:300,bottom:300});
    await page.keyboard.down('Alt');await page.mouse.move(x+98*scale,y+137*scale);
    assert.equal(await page.locator('#editor-alignment-guides').count(),0);
    await page.keyboard.up('Alt');await page.mouse.move(x+98*scale,y+138*scale);
    assert.ok(await page.locator('.alignment-guide').count()>0);
    if(zoom==='1') {
      await page.keyboard.press('Escape');await page.mouse.up();
      assert.equal(await f.locator('#moving').evaluate(el=>el.getBoundingClientRect().width),160);
    } else {
      await page.mouse.up();
      assert.equal(await f.locator('#moving').evaluate(el=>el.getBoundingClientRect().width),260);
      await page.keyboard.press('ControlOrMeta+z');
      assert.equal(await f.locator('#moving').evaluate(el=>el.getBoundingClientRect().width),160);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      assert.equal(await f.locator('#moving').evaluate(el=>el.getBoundingClientRect().width),260);
    }
    assert.equal(await page.locator('#editor-alignment-guides').count(),0);
  }
  console.log('PASS: resize edge guides and snapping at 100% and 50%, fixed corner, Alt bypass, Escape cleanup, undo/redo.');
} finally {
  await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});
}
