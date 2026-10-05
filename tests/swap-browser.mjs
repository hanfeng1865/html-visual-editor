import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'swap-ui-')),project=join(temp,'project');
await mkdir(project);
// Keep the project registry isolated from the user's running editor and other tests.
const editorDir=join(temp,'editor');
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(path.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),`<!doctype html><html><head><style>
body{margin:0;padding:20px;background:#fafafa}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-bottom:20px}
.metric-card{height:110px;background:white;border:1px solid #ddd;border-radius:10px;padding:15px;box-sizing:border-box;text-align:left}
.metric-card span{display:block;margin:10px}.charts{display:grid;grid-template-columns:2fr 1fr;gap:20px}
.panel{height:250px;background:white;border:1px solid #ddd;border-radius:10px;box-sizing:border-box;padding:20px}
#trend{width:680px}#aging{width:340px}.tabs-panel{height:160px;margin-top:20px}.tabs{display:flex;gap:6px;margin-top:20px;border-bottom:1px solid #ddd}.tabs button{background:white;border:0;border-bottom:2px solid #ddd;padding:12px;font-size:13px;color:#617568}.tabs button:first-child{border-bottom-color:#387b5e;color:#387b5e}
</style></head><body><section class="metrics" id="metrics">
<button class="metric-card" id="m1"><span>今日应收</span><span>300</span></button>
<button class="metric-card" id="m2"><span>累计未收</span><span>2486.50</span></button>
<button class="metric-card" id="m3"><span>逾期金额</span><span>186.80</span></button></section>
<section class="charts" id="charts"><article class="panel" id="trend"><h2>收款趋势</h2></article><article class="panel" id="aging"><h2>账龄分布</h2></article></section><section class="panel tabs-panel" id="tabs-panel"><h2>重点应收跟进</h2><nav class="tabs" id="tabs"><button id="tab1">全部款项 6</button><button id="tab2">今日到期 2</button><button id="tab3">已逾期 4</button></nav></section></body></html>`);
const server=createDevServer({rootDir:temp,editorDir});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const projectData=await (await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1000}});
  page.setDefaultTimeout(8000);
  await page.goto(`${base}/editor/editor.html?project=${projectData.id}&entry=index.html`);
  const f=page.frameLocator('#prototype-frame');
  await f.locator('#m1').waitFor();
  await page.locator('[data-mode="edit"]').click();
  await f.locator('#m3').click({position:{x:5,y:5}});
  await page.locator('#pointer-swap').click();
  async function drag(from,to,{edge=false,screenshot=false}={}) {
    const originals=await f.locator('body').evaluate(el=>Object.fromEntries([...el.querySelectorAll('.metrics > *, .charts > *, .tabs > *')].map(n=>[n.id,n.style.translate])));
    const a=await f.locator(from).boundingBox(),b=await f.locator(to).boundingBox();
    await page.mouse.move(a.x+8,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(edge?b.x-4:b.x+b.width/2,b.y+b.height/2,{steps:10});
    assert.equal(await page.locator('#editor-swap-feedback').count(),1,'swap feedback appears while dragging');
    assert.equal(await page.locator('.swap-slot.is-source').count(),1);
    assert.equal(await page.locator('.swap-slot.is-target').count(),1);
    assert.match(await page.locator('.swap-hint').innerText(),/松手交换/);
    assert.equal(await page.locator('#element-resize-handle').isVisible(),false,'resize handle stays out of the swap gesture');
    const source=await f.locator('.ve-swap-source').evaluate(el=>({id:el.id,translate:el.style.translate}));
    assert.equal(source.translate,originals[source.id],'source stays in its original slot');
    if(screenshot) {
      const panel=await f.locator('#tabs-panel').boundingBox();
      await page.screenshot({path:'/tmp/html-editor-swap-feedback.png',clip:{x:panel.x-8,y:panel.y-8,width:400,height:panel.height+60}});
    }
    await page.mouse.up();
    assert.equal(await page.locator('#editor-swap-feedback').count(),0,'feedback is removed on drop');
    assert.equal(await f.locator('.ve-swap-source').count(),0);
  }
  async function ready() {
    await f.locator('body.ve-edit-mode').waitFor();
    await f.locator('#m3').click({position:{x:5,y:5}});
    await page.locator('#pointer-swap').click();
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  }
  async function history(key) {
    await Promise.all([page.waitForEvent('framenavigated',frame=>frame.parentFrame()!==null),page.keyboard.press(key)]);
    await ready();
  }
  const order=id=>f.locator(id).evaluate(el=>[...el.children].map(n=>n.id));
  await page.locator('#pointer-move').click();
  await f.locator('#m1 span:first-child').click({position:{x:8,y:8}});
  await page.locator('#pointer-swap').click();
  await drag('#m1 span:first-child','#m2');
  assert.deepEqual(await order('#metrics'),['m2','m1','m3'],'dragging card text swaps whole cards');
  assert.equal(await f.locator('#m1').innerText(),'今日应收\n300');
  await history('ControlOrMeta+z');
  await f.locator('body.ve-edit-mode').waitFor();
  assert.deepEqual(await order('#metrics'),['m1','m2','m3']);
  await drag('#m1 span:first-child','#m2',{edge:true});
  assert.deepEqual(await order('#metrics'),['m2','m1','m3'],'small gap before a card is a valid target');
  await history('ControlOrMeta+z');
  await f.locator('body.ve-edit-mode').waitFor();
  const geometry=()=>f.locator('#charts').evaluate(el=>{
    const p=el.getBoundingClientRect(),children=[...el.children].map(n=>{const r=n.getBoundingClientRect();return {id:n.id,left:r.left,right:r.right,width:r.width};});
    return {left:p.left,right:p.right,children};
  });
  const before=await geometry();
  await drag('#trend h2','#aging');
  assert.deepEqual(await order('#charts'),['aging','trend']);
  const after=await geometry();
  assert.ok(Math.abs(after.children[1].left-after.children[0].right-20)<1,'swapped charts retain the 20px gap');
  assert.ok(after.children[1].right<=after.right+1,'wide chart does not overflow the row');
  assert.ok(after.children[1].width>after.children[0].width,'wide chart keeps the wide track after swapping');
  await history('ControlOrMeta+z');
  await f.locator('body.ve-edit-mode').waitFor();
  assert.deepEqual(await geometry(),before,'undo restores order and all layout styles');
  await history('ControlOrMeta+Shift+z');
  await f.locator('body.ve-edit-mode').waitFor();
  assert.deepEqual(await geometry(),after,'redo restores swapped layout');
  await page.reload();await f.locator('#aging').waitFor();await page.locator('[data-mode="edit"]').click();await ready();
  assert.deepEqual(await geometry(),after,'saved draft retains swapped layout after reload');
  await page.locator('#canvas-zoom').selectOption('0.5');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await drag('#aging h2','#trend');
  assert.deepEqual(await order('#charts'),['trend','aging'],'swap works again at 50% zoom');
  const half=await geometry();
  assert.ok(Math.abs(half.children[1].left-half.children[0].right-20)<1);
  assert.ok(half.children[1].right<=half.right+1);
  assert.ok(half.children[0].width>half.children[1].width);
  const start=await f.locator('#trend h2').boundingBox();
  await page.mouse.move(start.x+8,start.y+8);await page.mouse.down();
  await page.mouse.move(start.x+8,start.y+180,{steps:5});
  assert.match(await page.locator('.swap-hint').innerText(),/拖到虚线框/);
  assert.equal(await page.locator('.swap-slot.is-target').count(),0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#editor-swap-feedback').count(),0,'Escape clears feedback');
  assert.equal(await f.locator('.ve-swap-source').count(),0);
  await page.mouse.up();
  assert.deepEqual(await geometry(),half,'drop outside sibling slots keeps the layout');
  await page.locator('#canvas-zoom').selectOption('1');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await drag('#tab1','#tab2',{screenshot:true});
  assert.deepEqual(await order('#tabs'),['tab2','tab1','tab3'],'small tabs swap without overlapping selection rectangles');
  console.log('PASS: swap feedback, small tabs, selected text, gap targeting, unequal grid tracks, undo/redo, reload, 50% zoom and Escape cleanup.');
} finally {
  await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});
}
