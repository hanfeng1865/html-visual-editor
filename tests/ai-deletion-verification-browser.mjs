import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto('about:blank');
 const source=await readFile(new URL('../ai-editor.mjs',import.meta.url),'utf8');
 const results=await page.evaluate(async source=>{
  const {verifyAIPage}=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  const baseline=document.createElement('iframe'),preview=document.createElement('iframe');document.body.append(baseline,preview);
  const before='<table><tbody id="task-list"><tr><td><span>Training</span><span class="subline training-description">观看资料、提交培训题目和观后感。</span><span class="subline">2 份资料 · PPT / 视频</span></td></tr></tbody></table>';
  baseline.contentDocument.body.innerHTML=before;
  const pending=Object.fromEntries([2,3].map(i=>[i,{selector:`#task-list > tr > td:nth-of-type(1) > span${i===2?'.training-description':'.subline'}:nth-of-type(${i})`,deleted:true}]));
  const check=()=>verifyAIPage(preview.contentDocument,pending,baseline.contentDocument);
  preview.contentDocument.body.innerHTML=before;
  const unchanged=await check();
  for(const [i,node] of [...preview.contentDocument.querySelectorAll('.subline')].entries()){
   node.id=`training-list-demo-${i}`;node.setAttribute('hidden','');node.setAttribute('data-ve-deleted','');node.setAttribute('inert','');node.setAttribute('aria-hidden','true');
  }
  const persisted=await check();
  preview.contentDocument.head.innerHTML='<style>.subline[hidden]{display:inline!important}</style>';
  const overridden=await check();
  preview.contentDocument.head.innerHTML='';
  preview.contentDocument.body.innerHTML=before;preview.contentDocument.querySelector('table').hidden=true;
  const hiddenView=await check();
  preview.contentDocument.body.innerHTML=before;
  for(const node of preview.contentDocument.querySelectorAll('.subline'))node.remove();
  const removed=await check();
  preview.contentDocument.body.innerHTML=before;
  for(const node of preview.contentDocument.querySelectorAll('.subline'))node.setAttribute('data-ve-deleted','');
  const markerOnly=await check();
  return {unchanged,persisted,overridden,hiddenView,removed,markerOnly};
 },source);
 assert.deepEqual(results.persisted,[],'persisted hidden tombstones satisfy visual deletion');
 assert.deepEqual(results.removed,[]);
 for(const key of ['unchanged','overridden','hiddenView','markerOnly'])assert.equal(results[key].length,2,`${key} must still block saving`);
 console.log('PASS: deleted dynamic nodes, effective tombstones, CSS overrides, hidden views and incomplete markers');
} finally {await browser.close();}
