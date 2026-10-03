import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdtemp,cp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'lan-share-ui-')),project=join(temp,'project'),editorDir=join(temp,'editor');
await mkdir(project);await mkdir(join(project,'assets'));
await cp(new URL('../',import.meta.url),editorDir,{recursive:true,filter:path=>!['.git','node_modules','.editor-workspaces','editor-config.json'].includes(path.split(/[\\/]/).pop())});
const original='<html><head><link rel="stylesheet" href="/assets/style.css"><script src="/assets/app.js" defer></script></head><body><h1 id="title">Original</h1><img src="/assets/icon.svg"><button id="counter">Count</button><p id="number">0</p></body></html>';
await writeFile(join(project,'index.html'),original);
await writeFile(join(project,'assets/style.css'),'h1{color:rgb(12,34,56)}');
await writeFile(join(project,'assets/app.js'),'document.getElementById("counter").onclick=()=>document.getElementById("number").textContent="1";');
await writeFile(join(project,'assets/icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
const server=createDevServer({rootDir:temp,editorDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const projectConfig=await(await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),frame=page.frameLocator('#prototype-frame');
  await page.goto(`${base}/editor/editor.html?project=${projectConfig.id}&entry=index.html`);await frame.locator('body[data-ve-editor-ready=true]').waitFor();
  await page.locator('[data-mode=edit]').click();await frame.locator('#title').click({modifiers:['Alt']});await page.locator('#prop-text').fill('Shared edit');await page.locator('#prop-text').dispatchEvent('change');
  async function share(){await page.locator('#export-menu-button').click();await page.locator('#share-lan-button').click();await page.waitForFunction(()=>!document.getElementById('share-copy').disabled);return page.locator('#share-link').inputValue();}
  const link=await share();
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.locator('#share-copy').click();
  await page.waitForFunction(()=>document.getElementById('share-status').textContent.includes('链接已复制'));assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),link);
  assert.equal(await page.locator('#share-copy').textContent(),'✓ 复制成功');assert.equal(await page.locator('#share-copy').getAttribute('data-copied'),'true');
  assert.equal(await page.locator('#share-status').getAttribute('data-state'),'success');
  assert.match(await readFile(join(project,'index.html'),'utf8'),/Shared edit/,'sharing saves current edits first');
  const shared=await browser.newPage();const localLink=new URL(link);localLink.hostname='127.0.0.1';
  await shared.goto(localLink.href);assert.equal(await shared.locator('#title').textContent(),'Shared edit');assert.equal(await shared.locator('#title').evaluate(el=>getComputedStyle(el).color),'rgb(12, 34, 56)');
  assert.equal(await shared.locator('img').evaluate(el=>el.complete && el.naturalWidth>0),true);await shared.locator('#counter').click();assert.equal(await shared.locator('#number').textContent(),'1');
  assert.equal((await fetch(new URL('/api/projects',localLink))).status,404,'viewers cannot reach editor APIs');
  await writeFile(join(project,'index.html'),original.replace('Original','New source'));await shared.reload();assert.equal(await shared.locator('#title').textContent(),'Shared edit','share remains a snapshot until refreshed');
  await page.locator('#share-close').click();await page.reload();await frame.locator('body[data-ve-editor-ready=true]').waitFor();
  assert.equal(await share(),link,'re-sharing updates the same link');await shared.goto(localLink.href);assert.equal(await shared.locator('#title').textContent(),'New source');
  await page.locator('#share-stop').click();await page.waitForFunction(()=>document.getElementById('share-status').textContent.includes('已停止分享'));assert.equal((await fetch(localLink)).status,404);
  console.log('PASS: export share entry, save-before-sharing, local CSS/JS/images, read-only listener, stable-link updates and stop sharing');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
