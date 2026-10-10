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
 console.log('PASS: moved table cell identity and real width failure');
} finally {await browser.close();}
