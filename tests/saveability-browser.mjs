import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'saveability-ui-')),project=join(temp,'project');
await mkdir(project);
// Keep the project registry isolated from the user's running editor and other tests.
const editorDir=join(temp,'editor');
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(path.split(/[\\/]/).pop())});
const original=`<!doctype html><html><head><style>h1,p{margin:100px 8px}#empty{min-height:40px}</style></head><body>
<h1 id="title">Original</h1><div id="host"></div><p id="rewritten">Source text</p><div id="empty"></div>
<p id="duplicate">First</p><p id="duplicate">Second</p>
<div id="fragment"><span>Nested</span></div>
<script>
document.querySelector('#rewritten').textContent='Script text';
document.querySelector('#host').innerHTML='<p id="generated">Runtime</p><p class="unstable">Unstable</p><div id="runtime-container"><p id="child">Child</p></div><p id="中文标识">Chinese</p>';
</script></body></html>`;
await writeFile(join(project,'index.html'),original);
const server=createDevServer({rootDir:temp,editorDir});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const projectData=await (await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1050}});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/editor/editor.html?project=${projectData.id}&entry=index.html`);
  const f=page.frameLocator('#prototype-frame');
  await f.locator('body[data-ve-editor-ready="true"]').waitFor();
  assert.match(await page.locator('#saveability-summary').textContent(),/待 AI 写入：0 项/);
  await page.locator('[data-mode="edit"]').click();
  async function select(selector) {
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const element=f.locator(selector).first();
    await element.click({modifiers:['Alt']});
  }
  await select('#title');
  assert.equal(await page.locator('#saveability-section').getAttribute('data-kind'),'source');
  assert.equal(await page.locator('#prop-text').isEnabled(),true);
  await select('.unstable');
  assert.equal(await page.locator('#saveability-section').getAttribute('data-kind'),'template');
  assert.match(await page.locator('#saveability-detail').textContent(),/生成模板/);
  assert.equal(await page.locator('#prop-text').isEnabled(),true);
  assert.equal(await page.locator('#delete-button').isEnabled(),true);
  await page.locator('#prop-text').fill('AI unstable');await page.locator('#prop-text').dispatchEvent('change');
  assert.equal(await f.locator('.unstable').textContent(),'AI unstable');
  await select('#rewritten');
  assert.equal(await page.locator('#prop-text').isEnabled(),true);
  await page.locator('#prop-text').fill('AI rewritten');await page.locator('#prop-text').dispatchEvent('change');
  assert.equal(await f.locator('#rewritten').textContent(),'AI rewritten');
  await select('#duplicate');
  assert.equal(await page.locator('#saveability-section').getAttribute('data-kind'),'source');
  if(process.env.SAVEABILITY_SCREENSHOT)await page.screenshot({path:process.env.SAVEABILITY_SCREENSHOT});
  await select('#generated');
  assert.equal(await page.locator('#saveability-section').getAttribute('data-kind'),'runtime');
  assert.equal(await page.locator('#prop-text').isEnabled(),true);
  await page.locator('#prop-text').fill('Saved runtime');await page.locator('#prop-text').dispatchEvent('change');
  await select('#child');
  assert.equal(await page.locator('#duplicate-element').isEnabled(),true);
  await select('#runtime-container');
  const before=await f.locator('#runtime-container').innerHTML();
  if(!await page.locator('#structure-panel').isVisible())await page.locator('#layers-toggle').click();
  await page.locator('[data-structure-tab="insert"]').click();
  await page.locator('[data-insert="text"]').click();
  assert.notEqual(await f.locator('#runtime-container').innerHTML(),before);
  await select('#中文标识');assert.equal(await page.locator('#saveability-section').getAttribute('data-kind'),'runtime');
  await select('#empty');
  await page.locator('[data-insert="text"]').click();
  assert.equal(await page.locator('#saveability-section').getAttribute('data-kind'),'added');
  await page.locator('#prop-text').fill('Saved new text');await page.locator('#prop-text').dispatchEvent('change');
  await select('#title');
  assert.equal(await page.locator('#delete-button').isEnabled(),true);
  await page.locator('#prop-text').fill('Saved static');await page.locator('#prop-text').dispatchEvent('change');
  const saved=page.waitForResponse(response=>response.url().includes('/api/source-save') && response.request().method()==='POST');
  await page.locator('#save-button').click();assert.equal((await saved).status(),200);
  await page.waitForFunction(()=>!document.querySelector('#source-dialog').open);
  await page.locator('#ai-dialog[open]').waitFor();await page.locator('#ai-close').click();
  const html=await readFile(join(project,'index.html'),'utf8');
  assert.match(html,/Saved static/);assert.match(html,/Saved runtime/);assert.match(html,/AI unstable/);assert.doesNotMatch(html,/AI rewritten/);
  await page.reload();await f.locator('body[data-ve-editor-ready="true"]').waitFor();
  let exports=0,downloads=0;
  page.on('request',request=>{if(request.url().includes('/api/projects/export'))exports++;});
  page.on('download',()=>downloads++);
  await page.locator('#export-menu-button').click();await page.locator('#export-html-button').click();
  await page.locator('#ai-dialog[open]').waitFor();
  assert.equal(exports,0);assert.equal(downloads,0);
  assert.match(await page.locator('#save-status').textContent(),/未写入源码.*暂不可交付/);
  await page.locator('#ai-close').click();
  assert.equal(await f.locator('#generated').textContent(),'Saved runtime');
  assert.equal(await f.locator('.unstable').textContent(),'AI unstable');
  assert.equal(await f.locator('#rewritten').textContent(),'AI rewritten');
  assert.equal(await f.locator('#title').textContent(),'Saved static');
  assert.equal(await f.locator('#empty').textContent(),'Saved new text');
  await page.locator('[data-mode="edit"]').click();
  await select('#title');
  await f.locator('#title').dblclick({position:{x:16,y:16},modifiers:['Alt']});
  const caret=await f.locator('#title').evaluate(el=>{const s=el.ownerDocument.getSelection();return {collapsed:s.isCollapsed,inside:el.contains(s.anchorNode),focused:el.ownerDocument.activeElement===el};});
  assert.deepEqual(caret,{collapsed:true,inside:true,focused:true},'双击直接进入光标编辑，不全选文字');
  const offset=await f.locator('#title').evaluate(el=>el.ownerDocument.getSelection().anchorOffset);
  assert.ok(offset>0 && offset<'Saved static'.length,'光标位于双击文字的位置');
  await page.keyboard.insertText('!');
  assert.equal(await f.locator('#title').textContent(),'Saved static'.slice(0,offset)+'!'+'Saved static'.slice(offset),'在光标处输入，保留原有文字');
  await f.locator('#title[contenteditable="true"]').fill('Inline edit');
  await f.locator('#title').press('Tab');
  assert.equal(await f.locator('#title').textContent(),'Inline edit');
  await f.locator('#title').dblclick({position:{x:16,y:16},modifiers:['Alt']});
  assert.equal(await f.locator('#title').evaluate(el=>el.ownerDocument.getSelection().isCollapsed),true,'再次编辑也不全选');
  await f.locator('#title').press('Enter');
  assert.equal(await f.locator('#title').getAttribute('contenteditable'),'false','回车结束编辑');
  const inlineSaved=page.waitForResponse(response=>response.url().includes('/api/source-save') && response.request().method()==='POST');
  await page.locator('#save-button').click();assert.equal((await inlineSaved).status(),200);
  await page.waitForFunction(()=>!document.querySelector('#source-dialog').open);
  assert.match(await readFile(join(project,'index.html'),'utf8'),/Inline edit/);
  const checks=await page.evaluate(async()=>{
    const {createSaveabilityChecker}=await import('./saveability.mjs');
    const {compileSource}=await import('./source-compiler.mjs');
    const source='<html><body><div id="static"><p id="leaf">Leaf</p></div><i id="icon" data-lucide="users"></i><div id="nested"><span>Nested</span></div><p id="dup">a</p><p id="dup">b</p><div data-ve-dynamic><p id="live">live</p></div></body></html>';
    const doc=new DOMParser().parseFromString(source,'text/html');
    const checker=createSaveabilityChecker(doc);
    const base={source,entry:'index.html',hashes:{}};
    const compile=patches=>compileSource({base,current:base,patches,projectId:'builtin'});
    const icon=compile({i:{selector:'#icon',icon:'timer'}});
    const changedIcon={...base,source:source.replace('data-lucide="users"','data-lucide="heart"')};
    const iconConflict=compileSource({base,current:changedIcon,patches:{i:{selector:'#icon',icon:'timer'}},projectId:'builtin'});
    const iconResolved=compileSource({base,current:changedIcon,patches:{i:{selector:'#icon',icon:'timer'}},choices:{'i:icon':'code'},projectId:'builtin'});
    const added={a:{selector:'[data-ve-node="a"]',insert:{parent:'#static',html:'<div data-ve-node="a"><p data-ve-node="inside">New</p></div>',index:0}},b:{selector:'[data-ve-node="b"]',insert:{parent:'body',html:'<p data-ve-node="b">Second</p>',index:1}},t:{selector:'[data-ve-node="inside"]',text:'Updated'}};
    const insertion=compile(added);
    return {
      duplicate:checker.check({selector:'#dup',text:'x'}),
      unstable:checker.check({selector:'#static > p.runtime:nth-of-type(2)',text:'x'}),
      nested:checker.check({selector:'#nested',text:'x'}),
      fragment:checker.check({selector:'#nested',textNodes:{0:'x'}}),
      dynamic:checker.check({selector:'#live',styles:{color:'red'}}),
      parent:checker.check({selector:'#leaf',position:{parent:'#generated-container',index:0}}),
      compiledUnstable:compile({x:{selector:'#static > p.runtime:nth-of-type(2)',text:'x'}}).unsupported.length,
      iconConflict:iconConflict.conflicts.length,iconResolved:iconResolved.html?.includes('data-lucide="heart"'),
      icon:icon.html && new DOMParser().parseFromString(icon.html,'text/html').querySelector('#icon').getAttribute('data-lucide'),
      insertion:insertion.unsupported,inserted:insertion.html?.includes('Updated'),
    };
  });
  for(const key of ['duplicate','unstable','nested','fragment','dynamic','parent'])assert.ok(checks[key],key);
  assert.equal(checks.compiledUnstable,1);assert.equal(checks.icon,'timer');assert.equal(checks.iconConflict,1);assert.equal(checks.iconResolved,true);assert.deepEqual(checks.insertion,[]);assert.equal(checks.inserted,true);
  assert.deepEqual(errors,[]);
  console.log('PASS: saveability notices, AI preview and reload, unique duplicate selection, runtime-container AI insertion, direct static/runtime saves, Unicode IDs, strict compiler validation, Lucide declaration and nested insertions');
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});
}
