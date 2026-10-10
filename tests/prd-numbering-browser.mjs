import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {prdAnnotationsScript} from '../prd-annotations-runtime.mjs';
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1200,height:600}});
 await page.setContent('<style>body{margin:0;padding:50px}section{width:600px;height:230px;margin:0 0 80px;padding:20px;box-sizing:border-box;border:1px solid #ddd}</style>'+Array.from({length:8},(_,i)=>`<section id="b${i+1}"><h2>区块 ${i+1}</h2><p>区块内容</p></section>`).join(''));
 const points=Array.from({length:8},(_,i)=>({id:'p'+(i+1),selector:'#b'+(i+1),granularity:'block',viewKey:'',type:i%2?'rule':'interaction',title:'区块 '+(i+1),content:'区块说明',source:'visible',status:'confirmed',children:[]}));
 // AI response order and category grouping must not determine page ordinals.
 await page.addScriptTag({content:prdAnnotationsScript({version:2,points:[{id:'global',selector:'html',type:'global',title:'统一规则',content:'全局说明',source:'visible',status:'confirmed',children:[]},...points.reverse()]}).slice(8,-9)});
 const marker=number=>page.locator('#ve-editor-prd').locator(`.number[aria-label$="区块 ${number}：区块说明"]`);
 await page.waitForFunction(()=>document.querySelector('#ve-editor-prd').shadowRoot.querySelectorAll('.marker:not([hidden])').length>0);
 assert.equal(await marker(1).innerText(),'1','first block must be numbered by reading order');
 await page.evaluate(()=>document.querySelector('#b6').scrollIntoView({block:'center'}));await page.waitForFunction(()=>[...document.querySelector('#ve-editor-prd').shadowRoot.querySelectorAll('.marker:not([hidden]) .number')].some(b=>b.getAttribute('aria-label')?.includes('区块 6：')));
 assert.equal(await marker(6).innerText(),'6','scrolling must not restart numbering from one');
 await page.getByRole('button',{name:'标注说明',exact:true}).click();const rows=await page.locator('#ve-editor-prd').locator('.item').evaluateAll(items=>items.map(item=>({title:item.querySelector('.title').textContent,index:item.querySelector('.index').textContent})));
 assert.equal(rows.find(r=>r.title.endsWith('区块 6')).index,'6','sidebar and marker numbers must agree');
 const numbered=rows.filter(r=>r.index!=='•').map(r=>r.index);assert.equal(new Set(numbered).size,8,'a page must have unique numbers');
 assert.equal(await page.locator('.filters').count(),0);assert.equal(await page.locator('.badge').count(),0);
 await page.getByRole('button',{name:'关闭标注说明'}).click();
 await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>[...document.querySelector('#ve-editor-prd').shadowRoot.querySelectorAll('.marker:not([hidden]) .number')].some(b=>b.getAttribute('aria-label')?.includes('区块 1：')));assert.equal(await marker(1).innerText(),'1');
 const nested=await browser.newPage({viewport:{width:1200,height:600}});await nested.setContent('<style>body{margin:0;padding:40px}.scroll{height:470px;overflow:auto;width:700px}section{width:600px;height:230px;margin:30px;padding:20px}</style><div class="scroll">'+Array.from({length:8},(_,i)=>`<section id="b${i+1}"><h2>区块 ${i+1}</h2></section>`).join('')+'</div>');await nested.addScriptTag({content:prdAnnotationsScript({version:2,points}).slice(8,-9)});
 await nested.locator('.scroll').evaluate(el=>el.scrollTop=1400);await nested.waitForFunction(()=>[...document.querySelector('#ve-editor-prd').shadowRoot.querySelectorAll('.marker:not([hidden]) .number')].some(b=>b.getAttribute('aria-label')?.includes('区块 6：')));assert.equal(await nested.locator('#ve-editor-prd').locator('.number[aria-label$="区块 6：区块说明"]').innerText(),'6');
 const gutter=await browser.newPage({viewport:{width:600,height:300}});await gutter.setContent('<style>body{margin:0}.scroll{height:290px;overflow:auto;scrollbar-gutter:stable}.scroll::-webkit-scrollbar{width:22px}header{margin:12px 8px 0 20px;height:76px}main{height:1500px}</style><div class="scroll"><header id="header">标题</header><main></main></div>');
 await gutter.addScriptTag({content:prdAnnotationsScript({version:2,points:[{...points[0],id:'header-note',selector:'#header',title:'标题区'}]}).slice(8,-9)});
 const clearance=await gutter.evaluate(()=>{const scroll=document.querySelector('.scroll'),pin=document.querySelector('#ve-editor-prd').shadowRoot.querySelector('.marker:not([hidden]) .number').getBoundingClientRect();return {right:pin.right,track:scroll.getBoundingClientRect().left+scroll.clientWidth};});
 assert.ok(clearance.right<=clearance.track-4,'marker must clear the nested scrollbar gutter completely');
 console.log('PRD numbering: reading order, page and nested scrolling, unique sidebar numbers, no type controls and return passed');
}finally{await browser.close();}
