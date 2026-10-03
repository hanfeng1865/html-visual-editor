import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'alignment-ui-')),project=join(temp,'project');
await mkdir(project);
await writeFile(join(project,'index.html'),'<!doctype html><html><head><style>body{margin:0;min-height:900px;background:#fafafa}.card{position:absolute;width:160px;height:80px;border:1px solid #ddd;border-radius:10px;background:white;box-sizing:border-box}#reference{left:40px;top:80px}#moving{left:260px;top:180px}</style></head><body><div id="reference" class="card"></div><div id="moving" class="card"></div></body></html>');
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
  assert.equal(await page.locator('#pointer-move').getAttribute('aria-pressed'),'true');
  await f.locator('#moving').click();
  const box=await f.locator('#moving').boundingBox();
  const scale=await page.locator('#prototype-frame').evaluate(el=>el.getBoundingClientRect().width/el.clientWidth);
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x,y-98*scale,{steps:8});
  const lines=page.locator('#editor-alignment-guides .alignment-guide[data-axis="y"]');
  assert.equal(await lines.count(),2);
  const dimensions=await lines.evaluateAll(nodes=>nodes.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,color:getComputedStyle(el).backgroundColor})));
  assert.ok(dimensions.every(d=>d.width>500 && d.height===1 && d.color==='rgba(57, 120, 255, 0.42)'));
  assert.equal(await page.locator('.alignment-guide-segment').count(),0);
  await page.keyboard.down('Alt');await page.mouse.move(x+scale,y-98*scale);
  assert.equal(await page.locator('#editor-alignment-guides').count(),0);
  await page.keyboard.up('Alt');await page.mouse.move(x,y-98*scale);
  assert.equal(await lines.count(),2);
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.locator('#editor-alignment-guides').count(),0);
  assert.equal(await f.locator('#moving').evaluate(el=>el.style.translate),'');
  console.log('PASS: two edge guides without a redundant center, no extra dashed selection segments, Alt bypass, Escape cleanup');
} finally {
  await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});
}
