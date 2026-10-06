import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createDevServer} from '../dev-server.mjs';

const server=createDevServer({rootDir:process.cwd(),editorDir:process.cwd()});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const base=`http://127.0.0.1:${server.address().port}`;
const state={version:1,iterations:[{id:'test',name:'关闭测试',status:'active',scene:'new',scope:'all',pages:[],document:'# 需求正文\n\n'+('已有需求。\n\n'.repeat(100)),questions:[],suggestions:[],materials:[],messages:[],interviews:[{id:'round',questions:[{id:'question',text:'待确认的业务规则。'.repeat(40),options:[],hint:'',status:'pending',choice:null,textAnswer:'',answer:''}]}]}]};
let release,started;
try{
 const page=await browser.newPage();
 await page.route('**/close-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><head><link rel="stylesheet" href="/editor/editor.css"><link rel="stylesheet" href="/editor/requirements.css"></head><body></body>'}));
 await page.route('**/api/requirements',route=>route.fulfill({json:state}));
 await page.route('**/api/requirements/chat',async route=>{started();await new Promise(resolve=>{release=resolve;});await route.fulfill({json:state});});
 await page.goto(base+'/close-test');
 await page.evaluate(async()=>{const {createRequirementsWorkspace}=await import('/editor/requirements-ui.mjs');window.workspace=createRequirementsWorkspace({endpoint:path=>path,getProject:()=>({id:'test'}),hasDraft:()=>false});await window.workspace.open();});
 const dialog=page.locator('.req-workspace');
 for(const width of [1788,600,375]){
  await page.setViewportSize({width,height:888});
  await dialog.evaluate(el=>{el.scrollTop=1000;el.querySelector('[name="question-answer"]').focus();});
  assert.ok(await dialog.evaluate(el=>{const h=el.querySelector('.req-header').getBoundingClientRect(),d=el.getBoundingClientRect();return h.top>=d.top&&h.bottom<=innerHeight;}),'workspace header stays visible when an input scrolls into view');
  const exit=page.getByRole('button',{name:'关闭需求工作区',exact:true});
  assert.equal(await exit.isVisible(),true);
  assert.ok(await exit.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'close control fits desktop and mobile viewports');
 }
 await page.locator('[name="question-answer"]').fill('尚未提交的答案');
 await page.getByRole('button',{name:'关闭需求工作区',exact:true}).click();
 assert.equal(await dialog.isVisible(),false,'closed dialog is actually hidden');
 await page.evaluate(()=>window.workspace.open());
 assert.equal(await page.locator('[name="question-answer"]').inputValue(),'尚未提交的答案');
 await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
 await page.evaluate(()=>window.workspace.open());
 await page.click('[data-action="leave-questions"]');
 const requested=new Promise(resolve=>{started=resolve;});
 await page.click('[data-action="analyze"]');await requested;
 try{
  await page.getByRole('button',{name:'关闭需求工作区',exact:true}).click();
  assert.equal(await dialog.isVisible(),false,'can leave while analysis is in progress');
 }finally{release();}
 await page.waitForFunction(()=>!document.querySelector('[data-action="close"]').disabled);
 assert.equal(await dialog.isVisible(),false,'background completion does not reopen workspace');
 await page.evaluate(()=>window.workspace.open());
 const nextRequest=new Promise(resolve=>{started=resolve;});await page.click('[data-action="analyze"]');await nextRequest;
 try{await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false,'Escape also works during analysis');}finally{release();}
 console.log('Visible close control, desktop/mobile layout, hidden closed dialog, draft retention and closing during analysis passed.');
}finally{release?.();await browser.close();await new Promise(resolve=>server.close(resolve));}
