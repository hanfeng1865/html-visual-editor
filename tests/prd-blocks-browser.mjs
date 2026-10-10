import {collectPRDEvidence,summarizeKnownNavigation} from '../prd-annotations-evidence.mjs';
import {createPRDViewContext} from '../prd-annotations-view.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {groupPRDBlocks} from '../prd-annotations-groups.mjs';
import {collectPRDTargets} from '../prd-annotations-ui.mjs';
import {mountPRDAnnotations,layoutPRDMarkers,prdAnnotationsScript} from '../prd-annotations-runtime.mjs';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 await page.setContent(`<style>section{margin:60px;padding:20px;border:1px solid;width:700px}.filter-bar{margin-bottom:60px}.bar-chart{height:100px}button{padding:10px}article{margin:60px;height:100px}</style><section id="overtime"><h2>加班时长排行</h2><div id="filters" class="filter-bar">${['人员','部门','累计','平均','昨日','本周','上周','自定义'].map((v,i)=>`<button id="f${i}">${v}</button>`).join('')}</div><div id="chart" class="bar-chart" role="img">${Array.from({length:5},(_,i)=>`<button id="b${i}">${i}人</button>`).join('')}</div></section><section id="second" hidden data-panel="two"><h2>第二页</h2><table id="table"><tr><td><button id="a">查看甲</button></td></tr><tr><td><button id="b">查看乙</button></td></tr></table></section>`);
 const items=['f0','f1','f2','f3','f4','f5','f6','f7','b0','b1','b2','b3','b4','a','b'].map(id=>({id,selector:'#'+id,type:'rule',title:id,content:'规则 '+id}));
 const groups=await page.evaluate(({source,items})=>eval('('+source+')')(document,items),{source:groupPRDBlocks.toString(),items});
 assert.equal(groups.length,3);assert.equal(groups[0].item.selector,'#filters');assert.equal(groups[0].members.length,8);assert.equal(groups[1].item.selector,'#chart');assert.equal(groups[1].members.length,5);assert.equal(groups[2].item.selector,'#table');
 await page.evaluate(()=>{const note=document.createElement('p');note.id='old-note';note.textContent='演示数据不能作为真实规则';document.querySelector('#overtime').append(note);});
 const collected=await page.evaluate(({collect,group})=>{const groupPRDBlocks=eval('('+group+')');return eval('('+collect+')')(document,groupPRDBlocks,[{id:'note',selector:'#old-note',title:'原提示',content:'原边界'}]);},{collect:collectPRDTargets.toString(),group:groupPRDBlocks.toString()});
 assert.ok(collected.some(t=>t.existingIds?.includes('note')));assert.ok(!collected.some(t=>t.selector==='#old-note'));
 // Close anchors and substantial overlap merge upward. Hidden tabs are never measured as overlapping zero boxes.
 await page.setContent('<section id="parent" style="padding:20px"><div id="left" class="card" style="width:100px;height:100px">甲</div><div id="right" class="card" style="position:absolute;left:35px;top:35px;width:100px;height:100px">乙</div></section>');
 let merged=await page.evaluate(({source})=>eval('('+source+')')(document,[{id:'a',selector:'#left'},{id:'b',selector:'#right'}]),{source:groupPRDBlocks.toString()});assert.equal(merged.length,1);assert.equal(merged[0].item.selector,'#parent');
 await page.setContent(`<main id="page">${Array.from({length:24},(_,i)=>`<section id="s${i}" style="margin:70px"><article id="c${i}" class="card">指标${i}</article></section>`).join('')}</main>`);
 merged=await page.evaluate(({source})=>eval('('+source+')')(document,[...document.querySelectorAll('article')].map(e=>({id:e.id,selector:'#'+e.id,content:e.textContent}))),{source:groupPRDBlocks.toString()});assert.ok(merged.length<=15);assert.equal(merged.flatMap(g=>g.members).length,24);
 // Sharing a grid does not make two different charts homogeneous metric cards.
 await page.setContent('<div class="chart-grid" style="display:flex;gap:80px"><article id="chartA" class="panel" style="width:300px"><h2>账龄分布</h2><button id="legendA">账龄</button><svg id="svgA" role="img" width="200" height="100"></svg></article><article id="chartB" class="panel" style="width:300px"><h2>收款趋势</h2><button id="legendB">实际收款</button><svg id="svgB" role="img" width="200" height="100"></svg></article></div>');
 const separateCharts=await page.evaluate(({source})=>eval('('+source+')')(document,['legendA','svgA','legendB','svgB'].map(id=>({id,selector:'#'+id}))),{source:groupPRDBlocks.toString()});assert.equal(separateCharts.length,2);assert.deepEqual(separateCharts.map(g=>g.item.selector),['#chartA','#chartB']);
 // A parent pin owns folded child rules. Editing its summary must not overwrite children.
 await page.setContent('<section id="block" style="margin:60px;width:600px;height:200px"><h2>筛选条</h2><button>甲</button><button>乙</button></section>');
 const blockPoint={id:'parent',selector:'#block',selectors:['#block'],granularity:'block',type:'rule',title:'筛选条',content:'这是筛选条。切换条件刷新数据。',children:[{id:'child',selector:'#block > button:first-of-type',type:'boundary',title:'手改的子项',content:'用户手改规则保留',manual:true}]};
 await page.evaluate(({mount,layout,group,view,evidence,navigation,point})=>{const collectPRDEvidence=eval('('+evidence+')'),summarizeKnownNavigation=eval('('+navigation+')');const createPRDViewContext=eval('('+view+')');const layoutPRDMarkers=eval('('+layout+')'),groupPRDBlocks=eval('('+group+')');window.runtime=eval('('+mount+')')(document,{points:[point]},{editable:true,onChange:points=>window.changed=points});},{evidence:collectPRDEvidence.toString(),navigation:summarizeKnownNavigation.toString(),view:createPRDViewContext.toString(),mount:mountPRDAnnotations.toString(),layout:layoutPRDMarkers.toString(),group:groupPRDBlocks.toString(),point:blockPoint});
 assert.equal(await page.locator('.marker').count(),1);await page.locator('.number').click();assert.equal(await page.locator('.child-details').getAttribute('open'),null);assert.equal(await page.getByText('用户手改规则保留',{exact:true}).isVisible(),false);
 await page.locator('.item > .edit').click();await page.getByRole('textbox',{name:'标注内容',exact:true}).fill('新的父说明');await page.getByRole('button',{name:'应用修改'}).click();assert.equal((await page.evaluate(()=>window.changed))[0].children[0].content,'用户手改规则保留');
 await page.locator('.number').click();await page.locator('.child-details > summary').click();await page.locator('.child-item .edit').click();await page.getByRole('textbox',{name:'标注内容',exact:true}).fill('新的子项规则');await page.getByRole('button',{name:'应用修改'}).click();assert.equal((await page.evaluate(()=>window.changed))[0].content,'新的父说明');assert.equal((await page.evaluate(()=>window.changed))[0].children[0].content,'新的子项规则');
 await page.evaluate(()=>window.runtime.destroy());await page.addScriptTag({content:prdAnnotationsScript({points:[blockPoint]}).slice(8,-9)});await page.locator('.number').click();assert.equal(await page.getByRole('button',{name:'修改标注'}).count(),0);assert.equal(await page.locator('.child-details').getAttribute('open'),null);
 console.log('PRD blocks: 8 filters / 5 bars / table rows grouped, block anchors, geometry merge, 15 cap, hidden scopes and source preservation passed');
}finally{await browser.close();}
