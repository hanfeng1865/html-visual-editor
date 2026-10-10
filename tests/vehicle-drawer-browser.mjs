import {chromium} from 'playwright';
import {readFile, mkdtemp, cp, writeFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

assert.ok(process.argv[2], 'Pass the vehicle-management project directory');
const project=resolve(process.argv[2]);
const temp=await mkdtemp(join(tmpdir(),'vehicle-drawer-'));
await cp(project,temp,{recursive:true});
const original=await readFile(join(temp,'index.html'),'utf8');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const id of ['archive-license-help','archive-field-reminder','archive-field-remaining','archive-field-license','archive-form-message','vehicle-archive-save','vehicle-mode-add','archive-field-company','archive-field-plate','archive-license-primary','archive-license-secondary','archive-license-upload','archive-reminder','vehicle-archive-form']) {
  for(const saved of [false,true]) {
   errors.length=0;
   await writeFile(join(temp,'index.html'),original);
   await page.goto(pathToFileURL(join(temp,'index.html')).href);
   if(saved) {
    const html=await page.evaluate(id=>{document.getElementById(id)?.remove();return '<!doctype html>'+document.documentElement.outerHTML;},id);
    await writeFile(join(temp,'index.html'),html);await page.reload();
   } else {
    await page.locator('#add-vehicle').click();
    await page.evaluate(id=>document.getElementById(id)?.remove(),id);
    await page.locator('#vehicle-dialog-close').click();
   }
   await page.locator('#add-vehicle').click();
   assert.equal(await page.locator('#vehicle-archive-dialog').evaluate(dialog=>dialog.open),true,`${id}: drawer reopens (${saved?'saved':'live'}) errors: ${errors}`);
   await page.locator('#vehicle-dialog-close').click();
   await page.locator('.row-button[id$="-edit"]').first().click();
   assert.equal(await page.locator('#vehicle-archive-dialog').evaluate(dialog=>dialog.open),true,`${id}: edit drawer opens`);
   assert.deepEqual(errors,[],`${id}: no script errors`);
  }
 }
 await writeFile(join(temp,'index.html'),original);
 await page.goto(pathToFileURL(join(temp,'index.html')).href);
 const row=page.locator('tr[data-vehicle]').first();
 const company=await row.locator('[data-field=company]').textContent();
 await row.locator('.row-button[id$="-edit"]').click();
 await page.evaluate(()=>document.getElementById('archive-field-company').remove());
 await page.locator('#vehicle-archive-save').click();
 assert.equal(await page.locator('#vehicle-archive-dialog').evaluate(dialog=>dialog.open),false);
 assert.equal(await row.locator('[data-field=company]').textContent(),company,'deleted fields retain existing record values');
 console.log('PASS: add/edit drawers reopen after live deletion and saved deletion of 14 field/section elements');
}finally{await browser.close();await rm(temp,{recursive:true,force:true});}
