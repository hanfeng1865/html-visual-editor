import {chromium} from 'playwright';
import {createVisualPatchEngine} from '../visual-patch-engine.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 await page.setContent('<button id="entry">Open</button><dialog id="drawer"><form id="form"><section id="a"><input id="field" name="vehicle"><button id="close" type="button">Close</button></section><section id="b"></section></form></dialog><aside id="other"></aside>');
 await page.evaluate(()=>{document.getElementById('entry').onclick=()=>{document.getElementById('form').elements.namedItem('vehicle').value='Car';document.getElementById('drawer').showModal();};document.getElementById('close').onclick=()=>document.getElementById('drawer').close();});
 await page.evaluate(engine=>window.engine=eval('('+engine+')')(document),createVisualPatchEngine.toString());
 await page.locator('#entry').click();
 await page.evaluate(()=>window.engine.apply({move:{selector:'#field',position:{parent:'#other',index:0}}}));
 assert.equal(await page.locator('#field').evaluate(e=>e.form?.id),'form','moving a control outside its form must preserve interaction ownership');
 await page.locator('#close').click();await page.locator('#entry').click();
 assert.equal(await page.locator('#drawer').isVisible(),true);
 await page.evaluate(()=>window.engine.apply({move:{selector:'#field',position:{parent:'#b',index:0}}}));
 assert.equal(await page.locator('#field').evaluate(e=>e.parentElement.id),'b','rearranging within the form is allowed');
 await page.evaluate(()=>window.engine.apply({move:{selector:'#close',position:{parent:'#other',index:0}}}));
 assert.equal(await page.locator('#close').evaluate(e=>!!e.closest('dialog')),true,'close control remains inside its dialog');
 console.log('PASS: cross-form/dialog moves cannot break reopening; moves inside the same form still work');
}finally{await browser.close();}
