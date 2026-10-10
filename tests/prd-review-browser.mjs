import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('content-type','text/html');res.end('<body></body>');return;}res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL('..'+path,import.meta.url)));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(async()=>{
  const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href='/editor.css';document.head.append(sheet);
  document.body.innerHTML='<style>section{margin:50px;padding:30px;border:1px solid;width:500px}#side{position:absolute;right:0;top:0;width:350px;height:700px}</style><section id="card"><h2>统计</h2><button>切换口径</button></section><section id="table"><h2>列表</h2><table><tr><td>项目</td></tr></table></section><aside id="side"></aside>';
  const review=await import('/prd-annotations-review.mjs');window.review=review;window.blocks=review.scanPRDBlocks(document);window.reviewResult=review.reviewPRDBlocks(document,blocks,{panelContainer:document.querySelector('#side')});
 });
 await page.getByRole('heading',{name:'第一步 · 确认分区'}).waitFor();assert.ok(await page.getByLabel('区块名称').count()>=2);
 assert.equal(await page.locator('dialog:modal').count(),0);await page.getByRole('button',{name:'切换口径',exact:true}).click();
 await page.getByRole('button',{name:'手动框选加区块'}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('.is-picking').count(),0);
 await page.getByRole('button',{name:'定位区块 1',exact:true}).click();
 await page.getByRole('button',{name:'确认分区并生成说明'}).click();assert.equal(await page.locator('#ve-prd-review-overlay').count(),0);
 await page.evaluate(async()=>{const approved=await window.reviewResult;window.blocks=approved;const {mountPRDAnnotations}=await import('/prd-annotations-runtime.mjs');window.value={version:2,points:[{id:'one',blockId:approved[0].id,selector:approved[0].selector,granularity:'block',title:'统计规则',type:'rule',content:'范围待确认。',status:'draft',source:'unconfirmed',children:[{id:'child',selector:'#card button',title:'切换',content:'切换后刷新。',type:'interaction'}]},{id:'global',type:'global',selector:'html',title:'统一口径',content:'时区待确认。',status:'draft',source:'unconfirmed'}]};window.runtime=mountPRDAnnotations(document,value,{editable:true,panelContainer:document.querySelector('#side'),onChange:points=>window.changed=points});runtime.open();});
 await page.getByRole('button',{name:'确认此说明',exact:true}).first().click();assert.equal(await page.evaluate(()=>changed.find(p=>p.id==='global').status),'confirmed');
 await page.getByText('批量确认区块草稿',{exact:true}).click();assert.equal(await page.evaluate(()=>changed.every(p=>p.status==='confirmed')),true);
 assert.equal(await page.locator('#ve-editor-prd').locator('.number').count(),2); // global exists internally, but never displays a pin
 assert.equal(await page.locator('#ve-editor-prd').locator('.marker:not([hidden])').count(),1);
 assert.equal(await page.getByRole('button',{name:'概览 · 切换详细'}).count(),0);await page.getByText('子项明细（1 项）',{exact:true}).click();assert.equal(await page.locator('details[open]').count(),1);assert.equal(await page.locator('.child-item .status-tag').innerText(),'待确认');await page.getByRole('button',{name:'确认此子项',exact:true}).click();assert.equal(await page.locator('.child-item .status-tag').innerText(),'已确认');assert.equal(await page.evaluate(()=>changed.find(p=>p.id==='one').children[0].status),'confirmed');assert.match(await page.locator('.item').first().innerText(),/时区待确认/);
 await page.evaluate(()=>{value.points.find(p=>p.id==='one').children[0].suggestion={title:'切换',type:'interaction',content:'切换后保留当前月份并刷新。',source:'visible'};runtime.setPoints(value.points);});
 await page.locator('.child-item').getByRole('button',{name:'接受建议',exact:true}).click();assert.equal(await page.evaluate(()=>changed.find(p=>p.id==='one').children[0].content),'切换后保留当前月份并刷新。');assert.equal(await page.evaluate(()=>changed.find(p=>p.id==='one').content),'范围待确认。');
 const snapshot=await page.evaluate(()=>review.snapshotPRDPage(document));assert.ok(snapshot.html.length<1500000);assert.ok(!snapshot.html.includes('ve-editor-prd'));
 // Stable IDs survive DOM path changes when the heading uniquely identifies a block.
 const ids=await page.evaluate(()=>{const old=blocks.find(b=>b.selector==='#card');document.querySelector('#card').id='moved';const next=review.scanPRDBlocks(document,blocks);return [old.id,next.find(b=>b.selector==='#moved').id];});assert.equal(ids[0],ids[1]);
 // Empty partitions must remain distinguishable from saved explanations; adding opens a real editor.
 await page.evaluate(()=>{runtime.destroy();value={version:2,blocks:[{id:'list',selector:'#table',title:'01员工数据'.repeat(20),viewKey:''}],points:[]};runtime=(null);});
 await page.evaluate(async()=>{const {mountPRDAnnotations}=await import('/prd-annotations-runtime.mjs');window.runtime=mountPRDAnnotations(document,value,{editable:true,panelContainer:document.querySelector('#side'),onChange:points=>window.changed=points});runtime.open();});
 assert.equal(await page.getByRole('button',{name:/手动添加：/}).count(),0);
 assert.equal(await page.locator('.add-section[open]').count(),0);assert.equal(await page.locator('.item').count(),0);
 await page.getByRole('button',{name:'框选区域添加说明',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('#ve-prd-region-selection').count(),0);
 await page.getByRole('button',{name:'框选区域添加说明',exact:true}).click();
 const tableBox=await page.locator('#table').boundingBox();await page.mouse.move(tableBox.x+3,tableBox.y+3);await page.mouse.down();await page.mouse.move(tableBox.x+tableBox.width-3,tableBox.y+tableBox.height-3,{steps:8});await page.mouse.up();
 assert.equal(await page.locator('#ve-prd-region-selection').count(),0);assert.equal(await page.evaluate(()=>changed[0].selector),'#table');assert.equal(await page.evaluate(()=>changed[0].blockId),'list');assert.equal(await page.evaluate(()=>changed[0].region),undefined);
 assert.equal(await page.getByLabel('标注标题').inputValue(),'列表');
 await page.getByLabel('标注内容').fill('选择月份后，列表刷新为当月记录。');await page.getByLabel('确认状态',{exact:true}).selectOption('confirmed');await page.getByRole('button',{name:'应用修改'}).click();
 assert.equal(await page.evaluate(()=>changed[0].content),'选择月份后，列表刷新为当月记录。');assert.equal(await page.evaluate(()=>changed[0].status),'confirmed');
 const drawnMarker=page.locator('#ve-editor-prd').locator('.marker').first();
 const regionBounds=await drawnMarker.boundingBox();assert.ok(Math.abs(regionBounds.width-tableBox.width)<2,'selection must snap to the full block width');
 await page.evaluate(()=>document.body.style.minHeight='1600px');await page.evaluate(()=>scrollTo(0,40));
 await page.waitForFunction(y=>Math.abs(parseFloat(document.querySelector('#ve-editor-prd').shadowRoot.querySelector('.marker').style.top)-(y-40))<2,regionBounds.y);
 await page.evaluate(()=>scrollTo(0,0));
 await page.getByRole('button',{name:'返回全部说明',exact:true}).click();assert.equal(await page.locator('.item').count(),1);
 // A visible area outside the reviewed partitions becomes a manual block.
 await page.evaluate(async()=>{runtime.destroy();value={version:2,blocks:[],points:[]};const {mountPRDAnnotations}=await import('/prd-annotations-runtime.mjs');runtime=mountPRDAnnotations(document,value,{editable:true,describeBlock:review.describePRDBlock,panelContainer:document.querySelector('#side'),onChange:points=>window.changed=points});runtime.open();});
 await page.getByRole('button',{name:'框选区域添加说明',exact:true}).click();const newArea=await page.locator('#moved').boundingBox();await page.mouse.move(newArea.x-4,newArea.y-4);await page.mouse.down();await page.mouse.move(newArea.x+newArea.width+4,newArea.y+newArea.height+4,{steps:8});await page.mouse.up();
 assert.equal(await page.evaluate(()=>value.blocks[0].manual),true);assert.equal(await page.evaluate(()=>changed[0].blockId===value.blocks[0].id),true);assert.equal(await page.evaluate(()=>changed[0].selector),'#moved');assert.equal(await page.evaluate(()=>changed[0].region),undefined);
 // Recover an earlier unsaved drawn note by attaching it to the same block.
 await page.evaluate(async()=>{runtime.destroy();value.points=[{...changed[0],blockId:null,region:{x:.05,y:.05,width:.9,height:.9},content:'之前未保存的说明。'}];const {mountPRDAnnotations}=await import('/prd-annotations-runtime.mjs');runtime=mountPRDAnnotations(document,value,{editable:true,describeBlock:review.describePRDBlock,panelContainer:document.querySelector('#side'),onChange:points=>window.changed=points});runtime.open();});
 assert.equal(await page.evaluate(()=>changed[0].blockId),await page.evaluate(()=>value.blocks[0].id));assert.equal(await page.evaluate(()=>changed[0].region),undefined);assert.equal(await page.evaluate(()=>changed[0].content),'之前未保存的说明。');
 // Hidden Tab partitions cannot masquerade as regions on the currently displayed page.
 await page.evaluate(()=>{runtime.destroy();document.body.insertAdjacentHTML('beforeend','<nav><button id="show-live">人力页面</button><button id="show-other">经营页面</button></nav><section id="live" data-panel="live"><h2>考勤分析</h2></section><section id="other" data-panel="other" hidden><h2>实况数据</h2></section>');document.querySelector('#show-other').onclick=()=>{document.querySelector('#live').hidden=true;document.querySelector('#other').hidden=false;};document.querySelector('#show-live').onclick=()=>{document.querySelector('#live').hidden=false;document.querySelector('#other').hidden=true;};window.tabReview=review.reviewPRDBlocks(document,[review.describePRDBlock(document,document.querySelector('#live'),{scopeTitle:'人力页面'}),review.describePRDBlock(document,document.querySelector('#other'),{scopeTitle:'经营页面'})],{panelContainer:document.querySelector('#side')});});
 assert.deepEqual(await page.getByLabel('区块名称',{exact:true}).evaluateAll(inputs=>inputs.map(el=>el.value)),['考勤分析']);assert.equal(await page.locator('#ve-prd-review-overlay > div').count(),1);
 await page.getByText('其他 Tab / 未显示区块（1）',{exact:true}).click();assert.match(await page.locator('.prd-review-hidden').innerText(),/实况数据 · 经营页面/);
 await page.getByLabel('区块名称',{exact:true}).fill('人工调整考勤');await page.getByRole('button',{name:'定位',exact:true}).click();
 await page.getByRole('button',{name:'经营页面',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.prd-review-name')?.value==='实况数据');
 assert.equal(await page.locator('#ve-prd-review-overlay > div').count(),1);await page.getByRole('button',{name:'人力页面',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.prd-review-name')?.value==='人工调整考勤');
 await page.getByRole('button',{name:'确认分区并生成说明',exact:true}).click();assert.equal(await page.evaluate(async()=> (await tabReview).length),2,'hidden partitions and manual edits must survive confirmation');
 const navFacts=await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<header id="nav-facts"><span>品牌展示</span><nav><a href="/" class="active">首页</a><a href="about.html">关于我们</a></nav></header>');return review.describePRDBlock(document,document.querySelector('#nav-facts')).evidence;});
 assert.equal(navFacts.length,2,'a plain brand label is not a link');assert.equal(navFacts[0].text,'首页');assert.equal(navFacts[0].current,true);assert.equal(navFacts[0].samePage,true);assert.equal(navFacts[1].href,'about.html');
 await page.evaluate(async()=>{document.querySelector('#nav-facts').insertAdjacentHTML('afterend','<section id="hero-facts"><h1>宣传标题</h1><p>静态宣传文案</p><a href="about.html">认识原点 <span aria-hidden="true">↗</span></a></section>');const {mountPRDAnnotations}=await import('/prd-annotations-runtime.mjs');window.runtime=mountPRDAnnotations(document,{version:2,partitionConfirmed:true,blocks:[{id:'hero',selector:'#hero-facts',title:'首屏'}],points:[{id:'hero-note',blockId:'hero',selector:'#hero-facts',granularity:'block',type:'interaction',title:'认识原点入口',content:'目标地址待确认。',status:'draft',source:'unconfirmed',children:[{id:'hero-child',selector:'#hero-facts a',type:'interaction',title:'认识原点',content:'需确认目标与打开方式。',status:'draft',source:'unconfirmed'}]}]},{editable:true,panelContainer:document.querySelector('#side'),onRefresh:()=>{}});});
 await page.locator('#ve-editor-prd').locator('.number').click();
 assert.equal(await page.locator('.item>p').first().innerText(),'点击“认识原点”，跳转到“关于我们”。');
 assert.equal(await page.locator('.filters').count(),0);assert.equal(await page.locator('.add-section').count(),0);assert.equal(await page.getByRole('button',{name:'批量确认区块草稿',exact:true}).count(),0);assert.equal(await page.locator('.child-details').count(),0);assert.equal(await page.getByRole('button',{name:'确认此说明',exact:true}).count(),0);assert.equal(await page.locator('.annotation-meta[open]').count(),0);
 assert.deepEqual(errors,[]);console.log('PRD review browser: partition review, states, detail view, snapshots and stable IDs passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
