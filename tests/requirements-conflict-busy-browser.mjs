import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createDevServer} from '../dev-server.mjs';

const server=createDevServer({rootDir:process.cwd(),editorDir:process.cwd()});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const state={version:1,iterations:[{id:'iteration',name:'冲突测试',status:'active',scene:'continue',scope:'all',pages:[],document:'',questions:[],messages:[],materials:[],suggestions:[],interviews:[],conflicts:['first','second'].map(id=>({id,title:id,status:'pending',statements:[{source:'来源一',text:'规则一'},{source:'来源二',text:'规则二'}]}))}]};
let release,started,fail=false,chatRequests=0;
try{
 const page=await browser.newPage();
 await page.route('**/conflict-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 await page.route('**/api/requirements',async route=>{
  const body=route.request().postDataJSON();
  if(body){assert.equal(body.action,'conflictExplanation');state.iterations[0].conflicts.find(c=>c.id===body.conflictId).explanation=body.explanation;state.version++;}
  await route.fulfill({json:state});
 });
 await page.route('**/api/requirements/chat',async route=>{
  chatRequests++;started();await new Promise(resolve=>{release=resolve;});
  await route.fulfill(fail?{status:503,json:{error:'测试失败'}}:{json:state});
 });
 const mount=()=>page.evaluate(async()=>{const {createRequirementsWorkspace}=await import('/editor/requirements-ui.mjs');await createRequirementsWorkspace({endpoint:path=>path,getProject:()=>({id:'test',name:'测试'}),hasDraft:()=>false}).open();});
 await page.goto(base+'/conflict-test');await mount();await page.click('[data-tab="conflicts"]');
 const first=page.locator('[data-conflict-form="first"]'),second=page.locator('[data-conflict-form="second"]');
 const secondLabel=await second.locator('button').textContent();
 for(const failure of [false,true]){
  fail=failure;const requestStarted=new Promise(resolve=>{started=resolve;});
  await first.locator('textarea').fill('第一项解释');
  await first.locator('button').click();await requestStarted;
  try{
   assert.equal(await first.locator('button').textContent(),'正在更新…');
   assert.equal(await second.locator('button').textContent(),secondLabel,'only the submitted conflict shows updating');
   assert.equal(await second.locator('textarea').isEnabled(),true,'other explanations remain editable during AI work');
   assert.equal(await first.locator('textarea').isDisabled(),true,'submitted explanation remains stable');
   assert.equal(await second.locator('button').isDisabled(),true,'document updates remain serialized');
   await second.locator('textarea').fill(failure?'失败期间继续写的草稿':'成功期间继续写的草稿');
   await second.evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   assert.equal(chatRequests,failure?2:1,'no overlapping AI requests');
  }finally{release();}
  await page.waitForFunction(()=>!document.querySelector('[data-action="close"]').disabled);
  assert.equal(await second.locator('textarea').inputValue(),failure?'失败期间继续写的草稿':'成功期间继续写的草稿');
  assert.equal(await second.locator('button').isEnabled(),true);
 }
 await page.reload();await mount();await page.click('[data-tab="conflicts"]');
 assert.equal(await second.locator('textarea').inputValue(),'失败期间继续写的草稿','draft survives reload');
 console.log('Conflict loading isolation, editable drafts, serialized requests and draft recovery passed.');
}finally{release?.();await browser.close();await new Promise(resolve=>server.close(resolve));}
