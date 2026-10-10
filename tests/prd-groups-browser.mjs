import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {groupRepeatedPRDItems} from '../prd-annotations-groups.mjs';
import {collectPRDTargets} from '../prd-annotations-ui.mjs';
import {prdAnnotationsScript,mountPRDAnnotations,layoutPRDMarkers} from '../prd-annotations-runtime.mjs';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:900,height:500}});
 await page.setContent('<table id="orders"><tbody><tr><td>客户A</td><td><button id="a">跟进</button></td></tr><tr><td>客户B</td><td><button id="b">跟进</button></td></tr><tr><td>客户C</td><td><button id="c">跟进</button></td></tr></tbody></table><table id="other"><tr><td><button id="d">跟进</button></td></tr></table><button id="standalone">跟进</button>');
 const points=['a','b','c','d','standalone'].map((id,i)=>({id,selector:'#'+id,type:'interaction',title:'客户'+id+'跟进',content:i===0?'按所选记录打开跟进':i===1?'逾期记录需额外提醒':'按所选记录打开跟进'}));
 const groups=await page.evaluate(({source,items})=>eval('('+source+')')(document,items),{source:groupRepeatedPRDItems.toString(),items:points});
 assert.equal(groups.length,3);assert.deepEqual(groups[0].selectors,['#a','#b','#c']);assert.equal(groups[1].members.length,1);
 console.log('Repeated-control utility: scopes retained and distinct descriptions preserved');
}finally{await browser.close();}
