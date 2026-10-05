import {chromium} from 'playwright';
import {createLanShareService} from '../lan-share.mjs';
import assert from 'node:assert/strict';
const service=createLanShareService({mimeTypes:{'.html':'text/html'},addresses:()=>['127.0.0.1']});
const html=`<!doctype html><style>body{margin:0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:44px}.card{height:179px;background:green}.fixed{position:absolute;left:722px;top:44px;width:322px}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style><div class="grid"><div id="first" class="card"></div><div id="second" class="card"></div></div><div id="third" class="card fixed"></div><button id="counter" onclick="this.textContent='clicked'">Click</button>`;
const {urls:[url]}=await service.create('viewport','index.html',[['index.html',Buffer.from(html)]],{viewportWidth:1440});
const browser=await chromium.launch();
try{
  const reference=await browser.newPage({viewport:{width:1440,height:900}});await reference.setContent(html);
  const rects=frame=>frame.locator('.card').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  const expected=await rects(reference);
  const page=await browser.newPage({viewport:{width:1920,height:900}});page.setDefaultTimeout(2500);
  await page.goto(url);
  assert.equal(await page.locator('#share-page-frame').count(),1,'shared page must preserve the editor canvas viewport');
  const content=page.frameLocator('#share-page-frame');
  await content.locator('#third').waitFor();
  for(const width of [1920,1100,430]){
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(()=>{const f=document.getElementById('share-page-frame');return Math.abs(f.getBoundingClientRect().width-innerWidth)<1;});
    assert.equal(await content.locator('body').evaluate(()=>innerWidth),1440,'layout viewport stays fixed');
    assert.deepEqual(await rects(content),expected,'card positions and media queries match editor at every viewer width');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'viewer has no horizontal overflow');
  }
  await content.locator('#counter').click();assert.equal(await content.locator('#counter').textContent(),'clicked','page interaction stays usable');
  const direct=await browser.newPage({viewport:{width:1920,height:900}});await direct.goto(url+'index.html');
  assert.equal(await direct.locator('#share-page-frame').count(),1,'direct HTML links must preserve the canvas too');
  const directContent=direct.frameLocator('#share-page-frame');await directContent.locator('#third').waitFor();
  assert.deepEqual(await rects(directContent),expected,'direct HTML links match editor layout');
  console.log('PASS: shared canvas matches 1440px editor at desktop, narrow and mobile widths, with functional interaction');
}finally{await browser.close();await service.close();}
