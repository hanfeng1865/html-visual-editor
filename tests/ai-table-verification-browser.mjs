import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto('about:blank');
 const source=await readFile(new URL('../ai-editor.mjs',import.meta.url),'utf8');
 const result=await page.evaluate(async source=>{
  const {verifyAIPage}=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  const baseline=document.createElement('iframe'),preview=document.createElement('iframe');document.body.append(baseline,preview);
  baseline.contentDocument.body.innerHTML='<table><tr id="row"><td><span id="mileage">45000</span></td><td id="content">保养</td></tr></table>';
  preview.contentDocument.body.innerHTML='<table><tr id="row"><td id="content">保养</td><td style="width:165px"><span id="mileage">45000</span></td></tr></table>';
  const pending={cell:{selector:'#row > td:nth-of-type(1)',position:{parent:'#row',index:1},styles:{width:'165px'}}};
  const correct=await verifyAIPage(preview.contentDocument,pending,baseline.contentDocument);
  preview.contentDocument.querySelector('#mileage').parentElement.style.width='120px';
  const wrong=await verifyAIPage(preview.contentDocument,pending,baseline.contentDocument);
  return {correct,wrong};
 },source);
 assert.deepEqual(result.correct,[],'moved cell is verified by stable descendant identity, not its old column');
 assert.ok(result.wrong.some(error=>error.includes('width')),'incorrect width still fails');
 const dynamic=await page.evaluate(async source=>{
  const {verifyAIPage}=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  const baseline=document.createElement('iframe'),preview=document.createElement('iframe');document.body.append(baseline,preview);
  const css='<style>.detail-section{height:100px}.detail-stat{height:20px;background-color:rgb(246,248,251)}</style>';
  baseline.contentDocument.body.innerHTML=css+'<div id="detail-body"><div class="detail-section"><div class="detail-meta"><span>说明</span><span>创建日期</span></div><p class="muted">描述</p></div><div class="detail-stats"><div class="detail-stat">发布人数3</div><div class="detail-stat">已回收2</div></div></div>';
  preview.contentDocument.body.innerHTML=css+'<div id="detail-body"><div class="detail-stats"><div class="detail-stat highlight" id="audience">发布人数3</div><div class="detail-stat" id="recovered">已回收2</div></div></div>';
  const pending={
   description:{selector:'#detail-body > div.detail-section:nth-of-type(1) > p.muted',deleted:true},
   first:{selector:'#detail-body > div.detail-section:nth-of-type(1) > div.detail-meta > span:nth-of-type(1)',deleted:true},
   second:{selector:'#detail-body > div.detail-section:nth-of-type(1) > div.detail-meta > span:nth-of-type(2)',deleted:true},
   card:{selector:'#detail-body > div.detail-stats:nth-of-type(2) > div.detail-stat:nth-of-type(1)',styles:{backgroundColor:'rgb(246, 248, 251)',position:'absolute',top:'100px'},position:{parent:'#detail-body > div.detail-section:nth-of-type(1)',index:1}}
  };
  const correct=await verifyAIPage(preview.contentDocument,pending,baseline.contentDocument);
  preview.contentDocument.querySelector('#detail-body').insertAdjacentHTML('afterbegin','<div class="detail-section"><div class="detail-meta"><span>说明</span><span>创建日期</span></div><p class="muted">描述</p></div>');
  const wrong=await verifyAIPage(preview.contentDocument,pending,baseline.contentDocument);
  baseline.remove();preview.remove();return {correct,wrong};
 },source);
 assert.deepEqual(dynamic.correct,[],'dynamic siblings can be deleted and cards can move into a responsive layout');
 assert.ok(dynamic.wrong.some(error=>error.includes('组件仍存在')),'undeleted dynamic content still fails');
 console.log('PASS: moved table cell identity and real width failure');
} finally {await browser.close();}
