import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createPRDViewContext} from '../prd-annotations-view.mjs';
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:660}});
 await page.setContent('<style>html{scrollbar-gutter:stable}body{height:1600px;margin:0}.drawer{position:fixed;right:0;top:0;width:900px;height:100vh;transform:translateX(100%);background:white;z-index:20}.drawer.open{transform:none}</style><main>父页面</main><aside class="drawer" id="drawer"><h2>待申请加班</h2><button>查看</button></aside>');
 const context=()=>page.evaluate(source=>{const view=eval('('+source+')')(document);return {title:view.title,key:view.key,left:document.querySelector('#drawer').getBoundingClientRect().left,width:innerWidth};},createPRDViewContext.toString());
 const closed=await context();assert.ok(closed.left<closed.width,'fixture reproduces the scrollbar gutter overlap');assert.equal(closed.title,'主页面','a closed drawer within the scrollbar gutter is not the current view');
 await page.locator('#drawer').evaluate(el=>el.classList.add('open'));assert.equal((await context()).title,'待申请加班');
 await page.locator('#drawer').evaluate(el=>el.setAttribute('aria-hidden','true'));assert.equal((await context()).title,'主页面');
 await page.locator('#drawer').evaluate(el=>{el.removeAttribute('aria-hidden');el.classList.remove('open');});assert.equal((await context()).title,'主页面');
 // View detection is also correct inside a scaled editor iframe.
 await page.setContent('<iframe style="width:1440px;height:660px;transform:scale(.73);transform-origin:top left"></iframe>');
 const frame=page.frames()[1];await frame.setContent('<style>html{scrollbar-gutter:stable}body{height:1600px}.drawer{position:fixed;right:0;top:0;width:900px;height:100vh;transform:translateX(100%);background:white}</style><aside class="drawer"><h2>旧的穿透页</h2></aside>');
 assert.equal(await frame.evaluate(source=>eval('('+source+')')(document).title,createPRDViewContext.toString()),'主页面');
 console.log('PRD view visibility: scrollbar gutter, actual opening, aria-hidden, closing and scaled iframe passed');
}finally{await browser.close();}
