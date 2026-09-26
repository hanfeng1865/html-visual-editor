import {createVisualPatchEngine} from './visual-patch-engine.mjs';

// Runs only inside the history iframe, before the prototype's scripts.
function previewRuntime(patches,token,engineFactory) {
  window.__visualEditorHistoryPreview=true;
  for(const name of ['localStorage','sessionStorage']) {
    const values=new Map();
    Object.defineProperty(window,name,{value:{getItem:key=>values.get(String(key))??null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear(),key:index=>[...values.keys()][index]??null,get length(){return values.size;}}});
  }
  const realFetch=window.fetch.bind(window);
  window.fetch=(resource,options={})=>{
    const method=(options.method||resource?.method||'GET').toUpperCase();
    if(!['GET','HEAD'].includes(method))return Promise.reject(new Error('历史预览不提交数据'));
    const url=new URL(resource instanceof Request?resource.url:String(resource),document.baseURI);
    if(url.pathname.endsWith('/visual-edits.json') || url.pathname==='/api/visual-edits')return Promise.resolve(new Response(JSON.stringify({version:1,patches}),{headers:{'content-type':'application/json'}}));
    return realFetch(resource,options);
  };
  const realOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,...args){if(!['GET','HEAD'].includes(String(method).toUpperCase()))throw new Error('历史预览不提交数据');return realOpen.call(this,method,...args);};
  navigator.sendBeacon=()=>false;
  document.addEventListener('submit',event=>event.preventDefault(),true);
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!link)return;
    const raw=link.getAttribute('href');
    if(raw.startsWith('#')) {event.preventDefault();location.hash=raw;return;}
    event.preventDefault();event.stopImmediatePropagation();
    parent.postMessage({kind:'history-navigate',token,url:new URL(raw,document.baseURI).href},new URL(document.baseURI).origin);
  },true);
  addEventListener('DOMContentLoaded',()=>{
    const engine=engineFactory(document);let timer;
    const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(apply,30);});
    function apply(){engine.apply(patches);observer.takeRecords();}
    observer.observe(document.documentElement,{childList:true,subtree:true});
    apply();setTimeout(apply,0);setTimeout(apply,300);
    addEventListener('hashchange',()=>setTimeout(apply,0));
  });
}

export function interactiveHistorySource(source,baseUrl,patches,token,assetBase=null) {
  const doc=new DOMParser().parseFromString(source,'text/html');
  doc.querySelectorAll('base,meta[http-equiv="refresh"]').forEach(node=>node.remove());
  const base=doc.createElement('base');base.href=baseUrl;
  if(assetBase) {
    const root=new URL(baseUrl);root.pathname=root.pathname.replace(/\/project\/[^/]+\/.*/,match=>match.split('/').slice(0,3).join('/')+'/');
    if(!root.pathname.startsWith('/project/'))root.pathname='/';
    for(const node of doc.querySelectorAll('script[src],link[rel="stylesheet"][href]')) {
      const attr=node.tagName==='SCRIPT'?'src':'href',url=new URL(node.getAttribute(attr),baseUrl);
      if(!url.pathname.startsWith('/editor/') && url.origin===root.origin && url.pathname.startsWith(root.pathname))node.setAttribute(attr,new URL(assetBase+url.pathname.slice(root.pathname.length),baseUrl).href);
    }
  }
  const bootstrap=doc.createElement('script');
  bootstrap.textContent=`(${previewRuntime.toString()})(${JSON.stringify(patches).replace(/</g,'\\u003c')},${JSON.stringify(token)},${createVisualPatchEngine.toString()});`;
  doc.head.prepend(base,bootstrap);
  return '<!doctype html>'+doc.documentElement.outerHTML;
}
