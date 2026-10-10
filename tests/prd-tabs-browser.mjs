import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {collectPRDTargets} from '../prd-annotations-ui.mjs';
import {groupPRDBlocks} from '../prd-annotations-groups.mjs';
import {prdAnnotationsScript} from '../prd-annotations-runtime.mjs';
const b=await chromium.launch({headless:true});try{
 const page=await b.newPage({viewport:{width:1000,height:700}});
 await page.setContent('<nav><button data-tab="one">经营总览</button><button data-tab="two">资金调度</button><button data-tab="three">应收与逾期</button></nav><section id="one" data-panel="one"><article id="overview-card">总览金额</article></section><section id="two" data-panel="two" hidden><h2>资金调度</h2><article id="funds">可用资金</article><article id="due">未来7日待支付</article><table id="schedule"><tr><td>近期资金安排</td></tr></table></section><section id="three" data-panel="three" hidden><h2>应收与逾期</h2><button id="details">查看应收明细</button><button id="overdue">查看逾期明细</button></section><script>document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>document.querySelectorAll("[data-panel]").forEach(p=>p.hidden=p.id!==b.dataset.tab));</script>');
 const targets=await page.evaluate(({collect,group})=>{const groupPRDBlocks=eval('('+group+')');return eval('('+collect+')')(document);},{collect:collectPRDTargets.toString(),group:groupPRDBlocks.toString()});
 assert.ok(targets.some(t=>t.selectors.includes('#funds')));assert.ok(targets.some(t=>t.selectors.includes('#details')));
 const points=targets.filter(t=>t.required).map(t=>({id:t.id,selector:t.selector,type:'rule',title:t.title,content:'需求规则：'+t.text,selectors:t.selectors,granularity:'block',scope:t.scope,scopeTitle:t.scopeTitle}));
 await page.addScriptTag({content:prdAnnotationsScript({points}).slice(8,-9)});
 await page.getByRole('button',{name:'标注说明',exact:true}).click();assert.match(await page.locator('.panel').innerText(),/总览金额/);assert.doesNotMatch(await page.locator('.panel').innerText(),/可用资金/);
 await page.locator('[data-tab="two"]').click();await page.waitForTimeout(350);assert.match(await page.locator('.panel').innerText(),/可用资金/);assert.doesNotMatch(await page.locator('.panel').innerText(),/总览金额/);assert.equal(await page.locator('.marker:visible').count(),2);
 await page.locator('[data-tab="three"]').click();await page.waitForTimeout(350);assert.match(await page.locator('.panel').innerText(),/查看应收明细/);assert.doesNotMatch(await page.locator('.panel').innerText(),/可用资金/);assert.equal(await page.locator('.marker:visible').count(),2);
 console.log('PRD tabs: hidden cards, tables and controls collected; switching tabs updates markers and sidebar without cross-tab duplication');
}finally{await b.close();}
