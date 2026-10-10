import {chromium} from 'playwright';
import {createVisualPatchEngine} from '../visual-patch-engine.mjs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
assert.ok(process.argv[2],'Pass the vehicle-management project directory');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const id of ['vehicle-detail-maintenance','detail-field-reminder','vehicle-detail-license-empty','detail-maintenance-ledger-summary','detail-maintenance-ledger-scroll']) {
  errors.length=0;
  await page.goto(pathToFileURL(join(resolve(process.argv[2]),'index.html')).href);
  const view=page.getByRole('button',{name:'查看',exact:true}).first();
  await view.click();
  await page.evaluate(({id,engine})=>{
   const target=document.getElementById(id);if(!target)throw Error('Missing fixture '+id);
   eval('('+engine+')')(document).apply({deleted:{selector:'#'+id,deleted:true}});
  },{id,engine:createVisualPatchEngine.toString()});
  for(let i=0;i<3;i++) {
   await page.locator('#vehicle-detail-back').click();await view.click();
   assert.equal(await page.locator('#vehicle-detail-page').isVisible(),true,id);
   assert.equal(await page.locator('#'+id).isVisible(),false,id);
   assert.deepEqual(errors,[],id);
  }
 }
 console.log('PASS: actual vehicle detail reopens after deleting maintenance, reminder, license and ledger modules (15 return/view cycles)');
}finally{await browser.close();}
