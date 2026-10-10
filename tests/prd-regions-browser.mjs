import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {collectPRDTargets} from '../prd-annotations-ui.mjs';
import {groupPRDBlocks} from '../prd-annotations-groups.mjs';
import {prdAnnotationsScript} from '../prd-annotations-runtime.mjs';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.setContent('<section id="overtime"><h3>加班时长排行</h3><button id="people">人员</button><button id="department">部门</button><button id="day">昨日</button><div role="img" id="trend" aria-label="加班时长趋势图">1.8h 1.4h</div></section><section id="leave"><h3>请假审批</h3><button id="approve">审批</button></section><section role="tabpanel" id="hidden" hidden><article id="hidden-chart"><h3>资金趋势</h3><button id="week">本周</button></article></section>');
 const targets=await page.evaluate(({collect,group})=>{const groupPRDBlocks=eval('('+group+')');return eval('('+collect+')')(document);},{collect:collectPRDTargets.toString(),group:groupPRDBlocks.toString()});
 assert.equal(targets.find(t=>t.selectors.includes('#people')).region,'#overtime');
 assert.equal(targets.find(t=>t.selectors.includes('#trend')).region,'#overtime');
 assert.equal(targets.find(t=>t.selectors.includes('#approve')).region,'#leave');
 assert.equal(targets.find(t=>t.selectors.includes('#week')).scope,'#hidden');
 assert.match(targets.find(t=>t.selectors.includes('#people')).regionTitle,/加班时长/);
 const selectors=targets.filter(t=>t.region==='#overtime').map(t=>t.selector);
 await page.addScriptTag({content:prdAnnotationsScript({points:[{id:'one',selector:'#overtime',selectors,type:'rule',title:'加班时长',content:'对象：人员/部门；日期范围：昨日。趋势图：展示排序、单位及空数据状态。'}]}).slice(8,-9)});
 assert.equal(await page.locator('.marker').count(),1);
 await page.locator('.number').click();assert.match(await page.locator('.panel').innerText(),/对象：人员/);
 console.log('PRD regions: shared context, independent areas, hidden tabs and single region pin passed');
}finally{await browser.close();}
