import {chromium} from 'playwright';
import {createLanShareService} from '../lan-share.mjs';
import assert from 'node:assert/strict';
const value={version:1,hidden:[],boxes:[{id:'one',selector:'#target',cockpit:'page',context:'',x:0,y:0,width:1,height:1},{id:'tab',selector:'#target',cockpit:'page',context:'',view:{selector:'.tabs',value:'B'},x:0,y:0,width:.5,height:.5}],notes:{'box:one':'同事可见 <script>window.bad=true</script>','box:tab':'B页说明'},colors:{'box:one':'red'}};
const service=createLanShareService({mimeTypes:{'.html':'text/html'},addresses:()=>['127.0.0.1'],readLogic:async()=>value,readPRD:async()=>({revision:'prd-1',points:[{id:'prd-1',selector:'#target',type:'rule',title:'独立PRD',content:'原有PRD说明'}]})});
const html=`<style>body{margin:0}#target{margin:70px;width:300px;height:150px;background:#eee}</style><div class="tabs"><button class="active" onclick="this.classList.remove('active');this.nextElementSibling.classList.add('active')">A</button><button>B</button></div><div id="target"></div><button id="counter" onclick="this.textContent='clicked'">Click</button>`;
const {urls:[url]}=await service.create('test:index.html','index.html',[['index.html',Buffer.from(html)]],{viewportWidth:1440});
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1600,height:900}});page.on('pageerror',error=>console.error(error.message));page.setDefaultTimeout(3000);
 await page.goto(url);const content=page.frameLocator('#share-page-frame');
 await page.locator('#share-logic-sidebar').getByText(value.notes['box:one'],{exact:true}).waitFor();
 assert.equal(await page.locator('#share-logic-sidebar textarea, #share-logic-sidebar input').count(),0);
 assert.equal(await page.getByText('编辑说明',{exact:true}).count(),0);
 assert.equal(await content.locator('.share-logic-marker').count(),1,'only active tab annotations appear');
 const pin=await content.getByRole('button',{name:'查看第 1 项逻辑说明',exact:true}).evaluate(e=>({width:e.offsetWidth,left:e.offsetLeft,top:e.offsetTop}));
 assert.ok(pin.width<=18&&pin.left<10&&pin.top<10,'shared number stays small in upper-left');
 assert.equal(await page.locator('#share-logic-connectors path').count(),1);
 assert.equal(await content.locator('body').evaluate(()=>window.bad),undefined,'notes stay plain text');
 await content.getByRole('button',{name:'查看第 1 项逻辑说明',exact:true}).click();
 assert.equal(await page.locator('#share-logic-sidebar .active').count(),1);
 const control=page.locator('#share-logic-controls button');
 assert.equal(await control.textContent(),'','collapse control uses an icon');
 const bounds=await control.boundingBox(),canvas=await page.locator('#share-page-frame').boundingBox();
 assert.ok(bounds.width<=28&&bounds.x>=canvas.x+canvas.width-1,'toggle stays in its own sidebar strip');
 const hide=page.getByRole('button',{name:'隐藏说明',exact:true});
 await hide.click();
 await page.waitForFunction(()=>document.getElementById('share-logic-sidebar').hidden&&Math.abs(document.getElementById('share-page-frame').getBoundingClientRect().width-(innerWidth-28))<1);
 assert.equal(await content.locator('#share-logic-overlay').isVisible(),false);
 assert.equal(await page.locator('#share-logic-connectors').isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'显示说明',exact:true}).getAttribute('aria-expanded'),'false');
 await page.reload();await content.locator('#target').waitFor();
 await page.getByRole('button',{name:'显示说明',exact:true}).waitFor();
 assert.equal(await page.locator('#share-logic-sidebar').isVisible(),false,'refresh preserves collapsed preference');
 await page.getByRole('button',{name:'显示说明',exact:true}).click();
 await page.locator('#share-logic-sidebar').getByText(value.notes['box:one'],{exact:true}).waitFor();
 assert.equal(await content.locator('#share-logic-overlay').isVisible(),true);
 await page.waitForFunction(()=>document.querySelectorAll('#share-logic-connectors path').length===1);

 for(const width of [1100,430]){
  await page.setViewportSize({width,height:900});
  await page.waitForFunction(()=>document.documentElement.scrollWidth===innerWidth);
  assert.equal(await content.locator('body').evaluate(()=>innerWidth),1440);
  await page.getByRole('button',{name:'隐藏说明',exact:true}).click();
  await page.getByRole('button',{name:'显示说明',exact:true}).click();
  await page.locator('#share-logic-sidebar').getByText(value.notes['box:one'],{exact:true}).waitFor();
 }
 await content.getByRole('button',{name:'标注说明',exact:true}).click();
 await page.locator('#share-prd-sidebar').getByText('原有PRD说明',{exact:true}).waitFor();
 await page.locator('#share-logic-sidebar').getByText(value.notes['box:one'],{exact:true}).waitFor();
 await content.locator('#counter').click();assert.equal(await content.locator('#counter').textContent(),'clicked');
 await content.getByRole('button',{name:'A',exact:true}).click();
 await page.locator('#share-logic-sidebar').getByText('B页说明',{exact:true}).waitFor();
 assert.equal(await content.locator('.share-logic-marker').count(),2);
 const inner=page.frame({name:'share-page'});
 await inner.evaluate(()=>{
  const dialog=document.createElement('dialog');dialog.id='detail';dialog.innerHTML='<h2>明细</h2><div id="dialog-target" style="width:200px;height:100px">明细内容</div>';document.body.append(dialog);dialog.showModal();
 });
 await page.waitForFunction(()=>document.getElementById('share-logic-sidebar').hidden);
 assert.equal(await content.locator('.share-logic-marker').count(),0,'page markers hide behind modal dialogs');
 await inner.evaluate(()=>document.getElementById('detail').close());
 await page.locator('#share-logic-sidebar').getByText('B页说明',{exact:true}).waitFor();
 value.notes['box:one']='自动更新说明';
 await page.locator('#share-logic-sidebar').getByText('自动更新说明',{exact:true}).waitFor({timeout:7000});
 assert.equal(await page.locator('#share-logic-controls').count(),1,'automatic refresh keeps a single toggle');
 await page.getByRole('button',{name:'隐藏说明',exact:true}).click();
 await page.getByRole('button',{name:'显示说明',exact:true}).click();
 console.log('PASS: LAN logic notes, markers, connectors, read-only controls, tabs, mobile, interaction and live updates');
}finally{await browser.close();await service.close();}
