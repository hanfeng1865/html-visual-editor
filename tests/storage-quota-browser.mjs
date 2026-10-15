import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDevServer} from '../dev-server.mjs';

const temp=await mkdtemp(join(tmpdir(),'editor-quota-')),project=join(temp,'project');
await mkdir(project);
await cp(new URL('../',import.meta.url),join(temp,'editor'),{recursive:true,filter:source=>!['.git','node_modules','.editor-workspaces','output'].includes(source.split(/[\\/]/).pop())});
await writeFile(join(project,'index.html'),'<!doctype html><html><body><h1 id="title">Original</h1></body></html>');
const server=createDevServer({rootDir:temp,editorDir:join(temp,'editor')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const opened=await (await fetch(base+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:project})})).json();
const url=`${base}/editor/editor.html?project=${opened.id}&entry=index.html`;
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1050}});
  page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    if(localStorage.getItem('quota-test-seeded'))return;
    localStorage.setItem('html-editor-draft:legacy:large.html-source-base',JSON.stringify({source:'x'.repeat(256*1024)}));
    localStorage.setItem('html-editor-draft:legacy:large.html','unrelated draft');
    localStorage.setItem('quota-test-seeded','1');
  });
    await page.goto(url);
  await page.waitForFunction(()=>document.querySelector('#prototype-frame').contentDocument?.body.dataset.veEditorReady==='true');
  assert.equal(await page.evaluate(()=>localStorage.getItem('html-editor-draft:legacy:large.html-source-base')),null,'large legacy baselines are migrated');
  assert.equal(await page.evaluate(()=>localStorage.getItem('html-editor-draft:legacy:large.html')),'unrelated draft','migration preserves unrelated drafts');
  await page.evaluate(()=>{
    const key='html-editor-draft:'+new URLSearchParams(location.search).get('project')+':index.html';
    window.quotaKey=key;
    const set=Storage.prototype.setItem;
    window.originalSetItem=set;
    Storage.prototype.setItem=function(k,v){
      if(this===localStorage&&k===key+'-source-base')throw new DOMException('Storage quota exceeded','QuotaExceededError');
      return set.call(this,k,v);
    };
  });
  await page.locator('#save-button').click();
  await page.waitForFunction(()=>!document.querySelector('#save-button').disabled);
  assert.equal(await page.evaluate(()=>document.querySelector('#save-status').textContent),'已保存到项目','source cache quota must not report a failed project save');
  console.log('PASS: source cache quota does not turn a committed save into failure');
  const savedSource=await readFile(join(project,'index.html'),'utf8');
  assert.match(savedSource,/Original/);
  // Fill the real localStorage quota, including its last available bytes.
  await page.evaluate(()=>{
    Storage.prototype.setItem=window.originalSetItem;
    for(const size of [64*1024,1024,1]) {
      for(let i=0;;i++) {
        try{localStorage.setItem('quota-filler-'+size+'-'+i,'x'.repeat(size));}
        catch(error){if(error.name!=='QuotaExceededError')throw error;break;}
      }
    }
    window.fillerCount=Object.keys(localStorage).filter(key=>key.startsWith('quota-filler-')).length;
  });
  await page.locator('[data-mode="edit"]').click();
  await page.frameLocator('#prototype-frame').locator('#title').click({modifiers:['Alt']});
  await page.locator('#prop-text').fill('Unsaved at full quota');
  await page.locator('#prop-text').dispatchEvent('change');
  await page.waitForFunction(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('html-editor-drafts',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{return await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get(window.quotaKey);r.onsuccess=()=>resolve(r.result?.includes('Unsaved at full quota'));r.onerror=()=>reject(r.error);});}finally{db.close();}
  });
  await writeFile(join(project,'index.html'),savedSource.replace('Original','External edit'));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#prototype-frame').contentDocument?.querySelector('#title')?.textContent==='Unsaved at full quota');
  await page.locator('#save-button').click();
  await page.locator('#source-conflicts select').waitFor();
  assert.match(await readFile(join(project,'index.html'),'utf8'),/External edit/,'restored source baseline still detects conflicts');
  await page.locator('#source-conflicts select').selectOption('editor');
  await page.locator('#source-confirm').click();
  await page.waitForFunction(()=>!document.querySelector('#source-dialog').open&&!document.querySelector('#save-button').disabled);
  assert.equal(await page.locator('#save-status').textContent(),'已保存到项目');
  assert.match(await readFile(join(project,'index.html'),'utf8'),/Unsaved at full quota/);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#prototype-frame').contentDocument?.body.dataset.veEditorReady==='true');
  assert.equal(await page.frameLocator('#prototype-frame').locator('#title').textContent(),'Unsaved at full quota');
  assert.equal(await page.evaluate(()=>localStorage.getItem('html-editor-draft:legacy:large.html')),'unrelated draft');
  assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('quota-filler-'))),'quota handling does not clear other browser data');
  assert.deepEqual(errors,[]);
  console.log('PASS: full real quota, draft recovery, conflict detection, disk save, clean reload, non-destructive migration');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
