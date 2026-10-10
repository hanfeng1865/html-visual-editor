import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type',path.endsWith('.css')?'text/css':path.endsWith('.mjs')?'text/javascript':'text/html');res.end(path==='/'?'<body></body>':await readFile(new URL('..'+path,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(async()=>{
  document.body.innerHTML=`<style>body{margin:0}article{margin:50px;width:480px;height:250px}.drawer{position:fixed;top:20px;left:160px;width:540px;height:500px;background:white;z-index:21;transform:translateX(150vw)}.drawer.open{transform:none}.drawer-head{height:70px}.drawer-body{height:420px;overflow:auto}.table-wrap{width:520px;overflow:auto}table{min-width:950px}td{height:70px}#side{position:fixed;right:0;top:0;width:360px;height:100vh}</style><article id="main"><h2>主页面统计</h2><button id="open">打开明细</button></article><aside id="drawer" class="drawer"><div class="drawer-head"><h2 id="drawer-title">占位内容</h2><button id="close">关闭明细</button></div><div class="drawer-body" id="body"><button>占位操作</button></div></aside><aside id="side"></aside>`;
  window.show=(title)=>{document.querySelector('#drawer-title').textContent=title;document.querySelector('#body').innerHTML=`<div class="drill-summary"><div>人数 6</div><div>记录 8</div></div><div class="table-wrap"><table><thead><tr><th>${title}字段</th></tr></thead><tbody>${'<tr><td><button>查看人员</button></td></tr>'.repeat(10)}</tbody></table></div>`;document.querySelector('#drawer').classList.add('open');};
  document.querySelector('#open').onclick=()=>show('人事异动');document.querySelector('#close').onclick=()=>document.querySelector('#drawer').classList.remove('open');
  const review=await import('/prd-annotations-review.mjs');window.review=review;window.initial=review.scanPRDBlocks(document);window.result=review.reviewPRDBlocks(document,initial,{panelContainer:document.querySelector('#side')});
 });
 const original=await page.evaluate(()=>initial.map(b=>({selector:b.selector,title:b.title})));
 assert.ok(!original.some(b=>b.selector.includes('drawer')),'closed drawer placeholders must not be scanned');
 await page.getByLabel('区块名称').first().fill('人工改过的主页面');
 await page.locator('#open').click();await page.waitForFunction(()=>[...document.querySelectorAll('.prd-review-name')].some(n=>n.value.includes('人事异动')));
 assert.equal(await page.getByLabel('区块名称').filter({visible:true}).evaluateAll(nodes=>nodes.some(n=>n.value==='人工改过的主页面')),false,'parent records must not leak into the drilldown');
 const firstIds=await page.evaluate(()=>[...document.querySelectorAll('#ve-prd-review-overlay > div')].map(n=>({left:parseFloat(n.style.left),width:parseFloat(n.style.width)})));
 assert.ok(firstIds.length>0);assert.ok(firstIds.every(r=>r.left>=160&&r.left+r.width<=700),'ranges must clip to the drawer and scrolling table viewport');
 await page.evaluate(()=>show('劳动合同'));await page.waitForFunction(()=>[...document.querySelectorAll('.prd-review-name')].some(n=>n.value.includes('劳动合同')));
 assert.ok(!(await page.locator('#side').innerText()).includes('人事异动'));
 await page.locator('#close').click();await page.waitForFunction(()=>document.querySelector('.prd-review-name')?.value==='人工改过的主页面');
 await page.getByRole('button',{name:'确认分区并生成说明'}).click();
 const blocks=await page.evaluate(async()=>await result);assert.ok(blocks.some(b=>b.title==='人工改过的主页面'));assert.ok(new Set(blocks.filter(b=>b.selector.includes('drawer')).map(b=>b.viewKey)).size>=2,'reused drawer locations must have distinct view identities');
 // Persisted descriptions and the exported share runtime obey the same view identity.
 const points=blocks.map(b=>({...b,blockId:b.id,granularity:'block',type:'rule',content:b.title,status:'confirmed',source:'visible',children:[]}));
 const script=await page.evaluate(async points=>{const {prdAnnotationsScript}=await import('/prd-annotations-runtime.mjs');return prdAnnotationsScript({version:2,points});},points);await page.addScriptTag({content:script.slice(8,-9)});
 await page.getByRole('button',{name:'标注说明',exact:true}).click();await page.evaluate(()=>show('劳动合同'));await page.waitForFunction(()=>document.querySelector('#ve-editor-prd').shadowRoot.querySelector('.panel').textContent.includes('劳动合同'));
 const panel=await page.locator('#ve-editor-prd').locator('.panel').innerText();assert.ok(!panel.includes('人工改过的主页面'));assert.ok(!panel.includes('人事异动'));
 assert.deepEqual(errors,[]);console.log('PRD drilldown: closed placeholders, view isolation, dynamic reuse, clipping, parent edits and shared runtime passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
