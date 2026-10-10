// Self-contained: also embedded in exported/read-only annotation pages.
export function createPRDViewContext(doc){
 const win=doc.defaultView,selector='dialog,[role="dialog"],[aria-modal="true"],.drawer,.detail-drawer,.modal,[data-prd-view]';
 const clean=t=>(t||'').replace(/\s+/g,' ').trim();
 function path(el){if(!el)return '';const parts=[];for(let e=el;e&&e!==doc.documentElement;e=e.parentElement){if(e.id){parts.unshift('#'+win.CSS.escape(e.id));break;}const siblings=[...(e.parentElement?.children||[])].filter(n=>n.localName===e.localName);parts.unshift(`${e.localName}:nth-of-type(${siblings.indexOf(e)+1})`);}return parts.join(' > ');}
 function shown(el){
  if(!el?.getClientRects().length)return false;
  for(let e=el;e;e=e.parentElement){const s=win.getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||e.hidden||e.getAttribute('aria-hidden')==='true'||e.getAttribute('data-state')==='closed')return false;}
  const r=el.getBoundingClientRect(),left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(win.innerWidth,r.right),bottom=Math.min(win.innerHeight,r.bottom);
  if(right-left<2||bottom-top<2)return false;
  // innerWidth includes the scrollbar gutter. A translated, closed drawer can
  // intersect that gutter without painting any content in the actual page.
  // Hit testing also excludes panels clipped by ancestors or covered by a newer view.
  for(const x of [.5,.15,.85])for(const y of [.5,.15,.85]){
   const hit=doc.elementFromPoint(left+(right-left)*x,top+(bottom-top)*y);
   if(hit&&el.contains(hit))return true;
  }
  return false;
 }
 const roots=[...doc.querySelectorAll(selector)].filter(el=>!el.closest('#ve-editor-prd,#ve-prd-review-overlay,.prd-review-panel')&&shown(el));
 roots.sort((a,b)=>{if(a.contains(b))return -1;if(b.contains(a))return 1;const modal=e=>e.matches('dialog:modal')?1:0;return modal(a)-modal(b)||(parseInt(win.getComputedStyle(a).zIndex)||0)-(parseInt(win.getComputedStyle(b).zIndex)||0);});
 const active=roots.at(-1)||null;
 const titleFor=root=>clean(root?.getAttribute('data-prd-view')||root?.getAttribute('aria-label')||root?.querySelector('h1,h2,h3,[role="heading"]')?.textContent||root?.id||'穿透页').slice(0,200);
 const keyForRoot=root=>root?JSON.stringify([path(root),titleFor(root),clean(root.querySelector('thead')?.textContent).slice(0,1000)]):'';
 const key=keyForRoot(active);
 function rootFor(el){return el?.closest(selector)||null;}
 function accepts(el,record){
  if(!el)return !active&&!record?.viewKey;
  const root=rootFor(el);
  if(active?root!==active:!!root)return false;
  // Never apply an old drawer description to a different page rendered in that shell.
  if(record?.viewKey!==undefined)return record.viewKey===key;
  return !root; // Older unscoped drawer notes need a fresh partition review.
 }
 function rectFor(el){
  if(!el?.getClientRects().length)return null;let r=el.getBoundingClientRect();let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(win.innerWidth,r.right),bottom=Math.min(win.innerHeight,r.bottom);
  for(let e=el;e;e=e.parentElement){const s=win.getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||e.hidden)return null;
   if(e===el)continue;const box=e.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,box.left+e.clientLeft);right=Math.min(right,box.left+e.clientLeft+e.clientWidth);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,box.top+e.clientTop);bottom=Math.min(bottom,box.top+e.clientTop+e.clientHeight);}
  }
  if(active){const box=active.getBoundingClientRect();left=Math.max(left,box.left);top=Math.max(top,box.top);right=Math.min(right,box.right);bottom=Math.min(bottom,box.bottom);}
  return right>left&&bottom>top?{left,top,right,bottom,width:right-left,height:bottom-top}:null;
 }
 return {active,key,title:active?titleFor(active):'主页面',path:active?path(active):'',accepts,rectFor,keyFor:el=>keyForRoot(rootFor(el)),scopeFor:el=>path(rootFor(el)),titleFor:el=>titleFor(rootFor(el))};
}
