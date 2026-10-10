import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {insideProject} from './project-workspaces.mjs';

// Runs in a fresh browser context: prototype storage, cookies and form actions
// cannot change the user's working preview. All requests are fulfilled locally.
export async function checkProjectInteractions({root,entry,source,html,originalFiles={},files={}}) {
  if(typeof html!=='string' || typeof source!=='string')throw new Error('缺少待检查的页面源码');
  const {chromium}=await import('playwright');
  let browser;
  try{browser=await chromium.launch({headless:true});}
  catch{throw new Error('入口检查浏览器不可用，请在编辑器目录运行 npx playwright install chromium 后重试；草稿未写入');}
  const origin='http://interaction-check.invalid';
  const url=origin+'/'+entry.split('/').map(encodeURIComponent).join('/');
  let blockedRequests=0;
  const resources=new Map();
  const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
  async function load(content,overrides={}) {
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
    await context.routeWebSocket('**/*',socket=>{blockedRequests++;socket.close();});
    await context.route('**/*',async route=>{
      const request=route.request(),target=new URL(request.url());
      if(request.method()!=='GET' || target.origin!==origin || (request.isNavigationRequest() && target.pathname!==new URL(url).pathname)) {
        blockedRequests++;return route.abort();
      }
      try {
        const path=decodeURIComponent(target.pathname.slice(1));
        let body=content;
        if(path!==entry) {
          if(Object.hasOwn(overrides,path))body=overrides[path];
          else {
            if(!resources.has(path))resources.set(path,await readFile(await insideProject(root,path)));
            body=resources.get(path);
          }
        }
        await route.fulfill({status:200,contentType:types[extname(path)]||'application/octet-stream',body});
      }catch{await route.fulfill({status:404,body:''});}
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
    page.on('popup',popup=>popup.close().catch(()=>{}));
    page.setDefaultTimeout(1500);
    await page.goto(url,{waitUntil:'load',timeout:6000});
    await page.waitForTimeout(100);
    return {context,page,errors};
  }
  // Browser-side helpers are kept self-contained for Playwright serialization.
  function inspect() {
    const visible=e=>!!e && !!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && !e.closest('[hidden],[inert],[data-ve-deleted]');
    const selector=e=>{if(e.id && document.querySelectorAll('#'+CSS.escape(e.id)).length===1)return '#'+CSS.escape(e.id);const parts=[];for(let n=e;n&&n!==document.body;n=n.parentElement)parts.unshift(n.tagName.toLowerCase()+':nth-of-type('+([...n.parentElement.children].filter(c=>c.tagName===n.tagName).indexOf(n)+1)+')');return 'body > '+parts.join(' > ');};
    const controls=[...document.querySelectorAll('button,[role="button"],a[href]')].filter(e=>visible(e)&&!e.disabled&&!(e.form&&e.type==='submit')&&(!e.matches('a')||e.getAttribute('href')?.startsWith('#')));
    const entries=controls.filter(e=>/^(查看|详情|明细|打开(?:详情|明细)?|view|details|open)$/i.test(e.textContent.trim())).map(e=>({selector:selector(e),label:e.textContent.trim()}));
    const close=controls.filter(e=>/^(返回(?:列表|车辆列表)?|关闭(?:详情|明细)?|close|back|return(?: to list)?)$/i.test(e.textContent.trim())).map(e=>({selector:selector(e),label:e.textContent.trim()}));
    const surfaces=[...document.querySelectorAll('dialog,[role="dialog"],aside,section,main,.drawer,.modal,[id*="detail"],[id*="panel"]')].map(e=>({selector:selector(e),visible:visible(e)}));
    return {entries,close,surfaces};
  }
  async function exercise(run,step,expected) {
    const {page}=run;
    const before=await page.evaluate(inspect);
    await page.locator(step.selector).click();await page.waitForTimeout(100);
    const after=await page.evaluate(inspect);
    const surface=expected?.surface || after.surfaces.find(s=>s.visible && before.surfaces.some(b=>b.selector===s.selector&&!b.visible))?.selector;
    if(!surface)return {unchecked:'无法识别入口对应的子页面'};
    try{await page.locator(surface).waitFor({state:'visible'});}catch{throw new Error('点击入口后，子页面没有显示');}
    const close=expected?.close || after.close.find(c=>!before.close.some(b=>b.selector===c.selector)) || after.close[0];
    if(!close)return {unchecked:'未识别到返回或关闭按钮'};
    await page.locator(close.selector).click();await page.waitForTimeout(60);
    try{await page.locator(surface).waitFor({state:'hidden'});}catch{throw new Error('返回或关闭后，子页面仍遮挡主页面');}
    await page.locator(step.selector).click();await page.waitForTimeout(100);
    try{await page.locator(surface).waitFor({state:'visible'});}catch{throw new Error('返回后再次点击入口，子页面没有显示');}
    return {surface,close};
  }
  const failures=[],inherited=[],skipped=[];
  let checked=0;
  const addedErrors=(after,before)=>{
    const counts=new Map();for(const message of before)counts.set(message,(counts.get(message)||0)+1);
    return after.filter(message=>{const count=counts.get(message)||0;if(count){counts.set(message,count-1);return false;}return true;});
  };
  try {
    const baseline=await load(source,originalFiles),candidate=await load(html,files);
    inherited.push(...baseline.errors);
    failures.push(...addedErrors(candidate.errors,baseline.errors).map(message=>({label:'页面加载',message})));
    const entries=(await baseline.page.evaluate(inspect)).entries;
    await baseline.context.close();await candidate.context.close();
    for(const step of entries.slice(0,6)) {
      const before=await load(source,originalFiles);
      let expected;
      try{expected=await exercise(before,step);}
      catch(error){skipped.push({label:step.label,message:'原页面入口未通过检查：'+error.message.split('\n')[0]});}
      if(expected?.unchecked)skipped.push({label:step.label,message:expected.unchecked});
      const beforeErrors=[...before.errors];await before.context.close();
      if(!expected || expected.unchecked)continue;
      const after=await load(html,files);
      try {
        await exercise(after,step,expected);
        const errors=addedErrors(after.errors,beforeErrors);
        if(errors.length)throw new Error(errors.join('；'));
        checked++;
      }catch(error){failures.push({label:step.label,selector:step.selector,message:error.message.split('\n')[0]});}
      finally{await after.context.close();}
    }
    if(entries.length>6)skipped.push({label:'其他入口',message:`还有 ${entries.length-6} 个入口未检查`});
    if(!entries.length)skipped.push({label:'入口检查',message:'未识别到可自动检查的查看/详情入口'});
    if(blockedRequests)skipped.push({label:'网络交互',message:'网络请求已隔离，依赖这些请求的交互需手动验证'});
    return {status:failures.length?'failed':skipped.length?'partial':'passed',checked,failures,inherited,skipped,blockedRequests};
  } finally {await browser.close();}
}
