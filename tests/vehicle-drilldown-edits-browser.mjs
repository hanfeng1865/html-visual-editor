import {chromium} from 'playwright';
import {createVisualPatchEngine} from '../visual-patch-engine.mjs';
import {readFile,mkdtemp,cp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
assert.ok(process.argv[2],'Pass the vehicle-management directory');
const temp=await mkdtemp(join(tmpdir(),'vehicle-interactions-'));
await cp(resolve(process.argv[2]),temp,{recursive:true});
const source=await readFile(join(temp,'index.html'),'utf8');
const browser=await chromium.launch();let cases=0;
try {
 const page=await browser.newPage();page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const targets={detail:['vehicle-detail-maintenance','detail-field-reminder','vehicle-detail-license-empty','detail-maintenance-ledger-summary','detail-maintenance-ledger-scroll'],drawer:['archive-field-company','archive-field-plate','archive-field-license','archive-license-primary','archive-field-reminder','archive-form-message','archive-field-maintenance-date']};
 for(const [view,ids] of Object.entries(targets))for(const id of ids)for(const operation of ['delete','style','reorder'])for(const mode of ['live','saved']) {
  const patches={change:{selector:'#'+id,...(operation==='delete'?{deleted:true}:operation==='style'?{styles:{padding:'12px',borderRadius:'8px'}}:{})}};
  errors.length=0;await writeFile(join(temp,'index.html'),source);
  await page.goto(pathToFileURL(join(temp,'index.html')).href);
  if(operation==='reorder')patches.change.position=await page.locator('#'+id).evaluate(e=>({parent:'#'+e.parentElement.id,index:e.parentElement.children.length-1}));
  if(mode==='saved') {
   const html=await page.evaluate(({source,patches,engine})=>{
    const doc=new DOMParser().parseFromString(source,'text/html');eval('('+engine+')')(doc).apply(patches);return '<!doctype html>'+doc.documentElement.outerHTML;
   },{source,patches,engine:createVisualPatchEngine.toString()});
   await writeFile(join(temp,'index.html'),html);await page.reload();
  }
  const entry=view==='detail'?page.getByRole('button',{name:'查看',exact:true}).first():page.locator('#add-vehicle');
  const close=page.locator(view==='detail'?'#vehicle-detail-back':'#vehicle-dialog-close');
  const surface=page.locator(view==='detail'?'#vehicle-detail-page':'#vehicle-archive-dialog');
  await entry.click();
  if(mode==='live')await page.evaluate(({patches,engine})=>eval('('+engine+')')(document).apply(patches),{patches,engine:createVisualPatchEngine.toString()});
  for(let i=0;i<2;i++){await close.click();await entry.click();assert.equal(await surface.isVisible(),true);assert.deepEqual(errors,[],`${view}/${id}/${operation}/${mode}`);}
  await close.click();
  // Another record's edit entry must still work after editing the detail/add view.
  await page.locator('.row-button[id$="-edit"]').first().click();assert.equal(await page.locator('#vehicle-archive-dialog').isVisible(),true);
  assert.deepEqual(errors,[],`${view}/${id}/${operation}/${mode}: edit`);
  cases++;
 }
 console.log(`PASS: ${cases} actual vehicle detail/drawer cases, live and saved deletion/style/reordering; return, reopen and edit entry all work`);
}finally{await browser.close();await rm(temp,{recursive:true,force:true});}
