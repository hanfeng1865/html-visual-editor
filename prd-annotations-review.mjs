import {collectPRDEvidence} from './prd-annotations-evidence.mjs';
import {createPRDViewContext} from './prd-annotations-view.mjs';
import {collectPRDTargets} from './prd-annotations-ui.mjs';
import {groupPRDBlocks} from './prd-annotations-groups.mjs';
export function describePRDBlock(doc,el,previous={}){
 const selector=element=>{
  const parts=[];for(let e=element;e&&e!==doc.documentElement;e=e.parentElement){
   if(e.id&&doc.querySelectorAll('#'+doc.defaultView.CSS.escape(e.id)).length===1){parts.unshift('#'+doc.defaultView.CSS.escape(e.id));break;}
   const siblings=[...(e.parentElement?.children||[])].filter(n=>n.localName===e.localName);parts.unshift(`${e.localName}:nth-of-type(${siblings.indexOf(e)+1})`);
  }return parts.join(' > ')||'html';
 };
 const clean=t=>(t||'').replace(/\s+/g,' ').trim();
 const heading=clean(el.getAttribute('aria-label')||el.querySelector('h1,h2,h3,h4,h5,h6')?.textContent).slice(0,200);
 const clone=el.cloneNode(true);clone.querySelectorAll('#ve-editor-prd,script,style').forEach(e=>e.remove());
 const content=clean(clone.textContent),structure=[clone,...clone.querySelectorAll('*')].map(e=>[e.localName,e.getAttribute('role'),e.getAttribute('type'),e.getAttribute('name'),e.getAttribute('href'),e.getAttribute('disabled'),e.getAttribute('required')].join(':')).join('|');
 let hash=2166136261;for(const ch of content+'|'+structure){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
 const path=selector(el);
 const view=createPRDViewContext(doc),viewKey=view.keyFor(el);
 return {...previous,viewKey,...(viewKey?{scope:view.scopeFor(el),scopeTitle:view.titleFor(el)}:{}),id:previous.id||crypto.randomUUID(),selector:path,title:previous.title||heading||content.slice(0,60)||'手动区块',text:content.slice(0,1500),evidence:collectPRDEvidence(doc,el),fingerprint:{heading,path,signature:(hash>>>0).toString(16)},children:previous.children||[]};
}
export function scanPRDBlocks(doc,existing=[],ignored=[]){
 const view=createPRDViewContext(doc);
 existing=existing.filter(b=>(b.viewKey||'')===view.key);
 const scanned=collectPRDTargets(doc,(doc,items)=>groupPRDBlocks(doc,items.filter(t=>{const el=doc.querySelector(t.selector);return view.accepts(el,{viewKey:view.keyFor(el)})&&(!view.active||el?.getClientRects().length);}),{limit:500})).map(t=>{
  const el=doc.querySelector(t.selector),block=describePRDBlock(doc,el,{...t,id:undefined});
  if(view.active){const kind=el.matches('table,[role="table"],[role="grid"]')?'数据表':/(?:^|[\s-])summary(?:$|[\s-])/.test(el.className||'')?'汇总指标':'';if(kind)block.title=view.title+' · '+kind;}
  return block;
 });
 const families=new Map();
 for(const b of scanned){const el=doc.querySelector(b.selector),parent=el?.parentElement;if(!parent||parent===doc.body||el.matches('[data-prd-independent],[data-prd-block]'))continue;
  const shape=[el,...el.querySelectorAll('*')].map(n=>n.localName+':'+(n.getAttribute('role')||'')).join('|');let groups=families.get(parent);if(!groups){groups=new Map();families.set(parent,groups);}const key=(b.scope||'')+'|'+shape;const group=groups.get(key)||[];group.push(b);groups.set(key,group);
 }
 for(const [parent,groups] of families)for(const members of groups.values())if(members.length>1&&members.length===parent.children.length){
  for(const member of members){const index=scanned.indexOf(member);if(index>=0)scanned.splice(index,1);}
  scanned.push(describePRDBlock(doc,parent,{scope:members[0].scope,scopeTitle:members[0].scopeTitle,title:members[0].title+'等集合',children:members.map(b=>({selector:b.selector,title:b.title,text:b.text}))}));
 }
 const used=new Set();
 for(const b of scanned){
  let matches=existing.filter(o=>!used.has(o.id)&&o.selector===b.selector&&(b.selector.startsWith('#')||!o.fingerprint?.heading||o.fingerprint.heading===b.fingerprint.heading));
  if(!matches.length)matches=existing.filter(o=>!used.has(o.id)&&o.scope===b.scope&&o.fingerprint?.heading&&o.fingerprint.heading===b.fingerprint.heading);
  if(matches.length===1){b.id=matches[0].id;used.add(b.id);}
 }
 // Reviewed manual geometry survives subsequent scans, unless its anchor disappeared.
 for(const old of existing.filter(b=>b.manual)){
  let el;try{el=doc.querySelector(old.selector);}catch{}if(!el)continue;
  const fresh=describePRDBlock(doc,el,old);
  for(let i=scanned.length-1;i>=0;i--){const target=doc.querySelector(scanned[i].selector);if(el.contains(target)||target?.contains(el))scanned.splice(i,1);}
  scanned.push(fresh);
 }
 for(const old of existing){if(!scanned.some(b=>b.id===old.id)&&!doc.querySelector(old.selector))scanned.push({...old,missing:true});}
 for(let i=scanned.length-1;i>=0;i--)if(ignored.includes(JSON.stringify([view.key,scanned[i].selector]))||!view.key&&ignored.includes(scanned[i].selector))scanned.splice(i,1);
 scanned.sort((a,b)=>{const x=doc.querySelector(a.selector),y=doc.querySelector(b.selector);return !x||!y?Number(!x)-Number(!y):x===y?0:x.compareDocumentPosition(y)&doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING?-1:1;});
 return scanned.filter(b=>view.accepts(doc.querySelector(b.selector),b));
}
export function reviewPRDBlocks(doc,initial,{panelContainer,existing=[]}={}){return new Promise(resolve=>{
 let blocks=structuredClone(initial),cleanupPick=null;
 let currentView=createPRDViewContext(doc),viewKey=currentView.key;blocks.push(...structuredClone(existing.filter(b=>(b.viewKey||'')!==viewKey&&!blocks.some(n=>n.id===b.id))));const visitedViews=new Set([viewKey]);
 const inView=()=>blocks.filter(b=>currentView.accepts(doc.querySelector(b.selector),b));
 function displayed(b){const el=doc.querySelector(b.selector);if(!el?.getClientRects().length)return false;for(let e=el;e;e=e.parentElement){const css=doc.defaultView.getComputedStyle(e);if(e.hidden||e.getAttribute('aria-hidden')==='true'||css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;}return true;}
 const visibleBlocks=()=>inView().filter(displayed);
 let displayKey='';

 const dialog=document.createElement('section');dialog.className='prd-review-dialog prd-review-panel'+(panelContainer?'':' prd-review-standalone');dialog.setAttribute('aria-labelledby','prd-review-title');
 const element=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 const header=element('header','prd-review-header'),steps=element('div','prd-review-steps');
 steps.append(element('span','is-current','01  确认分区'),element('span','prd-review-step-line'),element('span','','02  审核说明'));
 const close=element('button','prd-review-close','×');close.type='button';close.setAttribute('aria-label','关闭分区审核');close.onclick=()=>finish(null);
 header.append(steps,close);
 const title=element('h3','prd-review-title','第一步 · 确认分区');title.id='prd-review-title';
 const help=element('p','prd-review-help','先确认每个区块的范围，AI 再为它撰写说明。悬停查看范围，点击编号可定位到页面对应位置。');help.setAttribute('aria-live','polite');header.append(title,help);
 const list=element('div','prd-review-list'),toolbar=element('div','prd-review-toolbar'),summary=element('div','prd-review-summary'),tools=element('div','prd-review-tools'),actions=element('footer','prd-review-footer'),footerActions=element('div','prd-review-footer-actions');
 toolbar.append(summary,tools);actions.append(element('span','prd-review-footer-hint','确认后生成 AI 草稿，说明仍由你审核。'),footerActions);
 let mergeButton;
 function updateSelection(){summary.replaceChildren(element('strong','',`${visibleBlocks().length} 个区块 · ${currentView.title}`),element('span','',selected.size?`已选 ${selected.size} 项`:'可编辑名称与范围'));if(mergeButton)mergeButton.disabled=selected.size<2;}
 const selected=new Set();let outline=null,hoveredId=null,locatedId=null,picking=false,finished=false;
 const overlays=doc.createElement('div');overlays.id='ve-prd-review-overlay';overlays.setAttribute('data-ve-locked','true');overlays.style.cssText='position:fixed;inset:0;z-index:2147483645;pointer-events:none;overflow:hidden';doc.body.append(overlays);
 function clear(){outline?.remove();outline=null;hoveredId=null;updateOverlays();}
 function updateOverlays(){
  if(finished)return;
  currentView=createPRDViewContext(doc);
  if(currentView.key!==viewKey&&!picking){
   viewKey=currentView.key;selected.clear();hoveredId=null;locatedId=null;
   if(!visitedViews.has(viewKey)){const fresh=scanPRDBlocks(doc,blocks);blocks=blocks.filter(b=>(b.viewKey||'')!==viewKey);blocks.push(...fresh);visitedViews.add(viewKey);}
   draw();return;
  }
  const nextDisplay=visibleBlocks().map(b=>b.id).join('|');if(nextDisplay!==displayKey&&!picking){displayKey=nextDisplay;selected.clear();hoveredId=null;locatedId=null;help.textContent='当前只显示可见区块。悬停查看范围，点击「定位」滚动到对应区块。';draw();return;}
  overlays.hidden=picking;overlays.replaceChildren();if(picking)return;
  visibleBlocks().forEach((b,i)=>{const el=doc.querySelector(b.selector),r=currentView.rectFor(el);if(!r?.width||!r.height||r.bottom<=0||r.top>=doc.defaultView.innerHeight||doc.defaultView.getComputedStyle(el).visibility==='hidden')return;
   const active=b.id===(hoveredId||locatedId),box=doc.createElement('div'),badge=doc.createElement('span');box.dataset.blockId=b.id;box.style.cssText=`position:absolute;box-sizing:border-box;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:${active?'2px solid #2563eb':'1px dashed #93b4ef'};border-radius:6px;background:${active?'#2563eb12':'transparent'}`;badge.textContent=String(i+1).padStart(2,'0');badge.style.cssText=`position:absolute;left:0;top:0;transform:translateY(-50%);background:${active?'#2563eb':'#eef4ff'};color:${active?'white':'#2563eb'};border:1px solid #93b4ef;border-radius:5px;padding:1px 5px;font:600 12px/18px sans-serif`;box.append(badge);overlays.append(box);
  });
 }
 function highlight(b){hoveredId=b.id;updateOverlays();}
 function locate(b){const el=doc.querySelector(b.selector);if(!el?.getClientRects().length){help.textContent='该区块当前未显示，请先切换到对应页面区域或 Tab。';return;}locatedId=b.id;el.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});updateOverlays();}
 const timer=doc.defaultView.setInterval(updateOverlays,250);
 doc.defaultView.addEventListener('scroll',updateOverlays,true);doc.defaultView.addEventListener('resize',updateOverlays);
 function button(label,fn,parent=tools){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;parent.append(b);return b;}
 function draw(){displayKey=visibleBlocks().map(b=>b.id).join('|');list.replaceChildren();updateSelection();if(!visibleBlocks().length)list.append(element('p','prd-review-empty','还没有区块，点击「手动框选加区块」添加。'));visibleBlocks().forEach((b,i)=>{const row=element('div','prd-review-row');row.classList.toggle('is-selected',selected.has(b.id));
 const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(b.id);check.setAttribute('aria-label','选择区块 '+(i+1));check.onchange=()=>{check.checked?selected.add(b.id):selected.delete(b.id);row.classList.toggle('is-selected',check.checked);updateSelection();};
 const name=document.createElement('input');name.value=b.title;name.title=b.missing?'区块已不在页面上；原说明保留为已过期':b.selector;name.setAttribute('aria-label','区块名称');name.className='prd-review-name';name.oninput=()=>b.title=name.value.slice(0,200);
 const number=element('button','prd-review-number',String(i+1).padStart(2,'0')),body=element('div','prd-review-row-body'),meta=element('div','prd-review-meta',b.missing?'原位置已失效':b.manual?'手动调整的区块':b.children?.length?`包含 ${b.children.length} 个子项`:'独立区块'),rowActions=element('div','prd-review-row-actions');
 number.type='button';number.setAttribute('aria-label','定位区块 '+(i+1));number.title='在页面中定位';number.onclick=()=>locate(b);if(b.scopeTitle&&b.scopeTitle!=='公共区域')meta.textContent+=' · 所属：'+b.scopeTitle;body.append(name,meta);row.append(check,number,body,rowActions);row.onmouseenter=()=>highlight(b);row.onmouseleave=clear;
 button('定位',()=>locate(b),rowActions);
 button('拆分',()=>{const el=doc.querySelector(b.selector),children=[...(el?.children||[])].filter(e=>!e.matches('h1,h2,h3,h4,h5,h6,script,style')&&(e.children.length||e.matches('button,input,select,textarea,canvas,table')));if(children.length<2){help.textContent='这个区块没有可拆分的子容器，可删除后手动框选。';return;}blocks.splice(blocks.indexOf(b),1,...children.map((e,index)=>describePRDBlock(doc,e,{manual:true,...(index===0?{id:b.id}:{})})));selected.delete(b.id);draw();},rowActions);
 button('删除',()=>{blocks.splice(blocks.indexOf(b),1);selected.delete(b.id);draw();clear();},rowActions).className='prd-review-delete';list.append(row);
 });
 const hidden=inView().filter(b=>!displayed(b));if(hidden.length){const details=element('details','prd-review-hidden'),heading=element('summary','',`其他 Tab / 未显示区块（${hidden.length}）`);details.append(heading,element('p','prd-review-meta','切换到对应 Tab 后，可查看范围、编辑和定位。这些分区仍会保留。'));for(const b of hidden)details.append(element('p','prd-review-meta',b.title+' · '+(b.scopeTitle||'当前未显示')));list.append(details);}
 updateOverlays();}
 mergeButton=button('合并所选',()=>{const chosen=visibleBlocks().filter(b=>selected.has(b.id));if(chosen.length<2)return;const elements=chosen.map(b=>doc.querySelector(b.selector));if(elements.some(e=>!e)){help.textContent='无法合并已不在页面上的区块。';return;}let parent=elements[0];while(parent&&!elements.every(e=>parent.contains(e)))parent=parent.parentElement;if(!parent||parent===doc.body||parent===doc.documentElement){help.textContent='这些区块跨越了整页，请选择同一区域的区块。';return;}const merged=describePRDBlock(doc,parent,{id:chosen[0].id,manual:true,children:chosen.map(b=>({selector:b.selector,title:b.title,text:b.text}))});blocks=blocks.filter(b=>b.viewKey!==viewKey||!parent.contains(doc.querySelector(b.selector)));blocks.push(merged);selected.clear();draw();});
 button('手动框选加区块',()=>{
  if(picking)return;picking=true;dialog.classList.add('is-picking');help.textContent='在左侧页面拖动框选，松开完成；按 Esc 取消。';clear();const cover=doc.createElement('div');cover.style.cssText='position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:#2563eb08';doc.body.append(cover);let start;
  const end=()=>{cover.remove();doc.removeEventListener('keydown',escape,true);cleanupPick=null;picking=false;dialog.classList.remove('is-picking');help.textContent='悬停查看范围，点击编号可定位。确认分区后再生成说明。';clear();};
  const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end();}};doc.addEventListener('keydown',escape,true);cleanupPick=end;
  cover.onpointerdown=e=>{e.stopPropagation();start={x:e.clientX,y:e.clientY};cover.setPointerCapture(e.pointerId);};
  cover.onpointermove=e=>{if(!start)return;cover.style.background=`#2563eb08`;clear();outline=doc.createElement('div');outline.style.cssText=`position:fixed;pointer-events:none;z-index:2147483647;border:2px dashed #2563eb;left:${Math.min(start.x,e.clientX)}px;top:${Math.min(start.y,e.clientY)}px;width:${Math.abs(start.x-e.clientX)}px;height:${Math.abs(start.y-e.clientY)}px`;doc.body.append(outline);};
  cover.onpointerup=e=>{e.stopPropagation();if(!start)return;clear();cover.style.display='none';const x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY),right=Math.max(start.x,e.clientX),bottom=Math.max(start.y,e.clientY);
   let el=doc.elementFromPoint((x+right)/2,(y+bottom)/2);
   if(Math.abs(right-x)>8&&Math.abs(bottom-y)>8){const inside=[...doc.body.querySelectorAll('*')].filter(n=>!n.closest('#ve-editor-prd,#ve-prd-review-overlay')&&n!==cover&&!n.matches('script,style')&&(()=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=x&&r.top>=y&&r.right<=right&&r.bottom<=bottom;})());if(inside.length){el=inside[0];while(el&&!inside.every(n=>el.contains(n)))el=el.parentElement;}}
   if(el&&el!==doc.body&&el!==doc.documentElement&&!el.closest('#ve-editor-prd,#ve-prd-review-overlay')){const b=describePRDBlock(doc,el,{manual:true});if(!blocks.some(o=>o.selector===b.selector&&o.viewKey===b.viewKey))blocks.push(b);}end();draw();};
 });
 button('确认分区并生成说明',()=>{if(blocks.some(b=>!b.title.trim())){help.textContent='请填写区块名称。';return;}blocks.sort((a,b)=>{if(a.viewKey!==b.viewKey)return 0;const x=doc.querySelector(a.selector),y=doc.querySelector(b.selector);return !x||!y?Number(!x)-Number(!y):x===y?0:x.compareDocumentPosition(y)&doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING?-1:1;});finish(blocks);},footerActions).className='prd-review-primary';const cancel=button('取消',()=>finish(null),footerActions);footerActions.prepend(cancel);
 function finish(result){if(finished)return;cleanupPick?.();finished=true;outline?.remove();overlays.remove();doc.defaultView.clearInterval(timer);doc.defaultView.removeEventListener('scroll',updateOverlays,true);doc.defaultView.removeEventListener('resize',updateOverlays);dialog.remove();resolve(result);}
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(cleanupPick)cleanupPick();else finish(null);}});
 for(const event of ['pointerdown','pointerup','click','dblclick','keydown','keyup'])dialog.addEventListener(event,e=>e.stopPropagation());
 dialog.append(header,toolbar,list,actions);(panelContainer||document.body).append(dialog);draw();close.focus({preventScroll:true});
 });}

// Serialize the current preview (including unsaved styles) for an isolated screenshot.
export function snapshotPRDPage(doc,blocks=[]){
 const clone=doc.documentElement.cloneNode(true),originals=[doc.documentElement,...doc.documentElement.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
 originals.forEach((el,i)=>{const copy=copies[i];if(!copy)return;const style=doc.defaultView.getComputedStyle(el);copy.setAttribute('style','display position top right bottom left width height min-width min-height max-width max-height box-sizing margin padding border border-radius background color font-family font-size font-weight line-height text-align white-space overflow opacity visibility flex flex-direction flex-wrap align-items justify-content gap grid-template-columns grid-template-rows transform box-shadow z-index'.split(' ').map(k=>`${k}:${style.getPropertyValue(k)}`).join(';'));for(const a of [...copy.attributes])if(/^on/i.test(a.name))copy.removeAttribute(a.name);if(el.matches('input,textarea'))copy.setAttribute('value',el.value);if(el.matches('canvas')){try{const img=doc.createElement('img');img.src=el.toDataURL();img.setAttribute('style',copy.getAttribute('style'));copy.replaceWith(img);}catch{}}});
 clone.querySelectorAll('script,link,style,iframe,object,embed,#ve-editor-prd,#editor-change-overlay').forEach(e=>e.remove());
 const html='<!doctype html>'+clone.outerHTML;
 if(new TextEncoder().encode(html).length>16*1024*1024)throw new Error('页面截图数据超过处理范围，请减少页面内容后重试');
 return {html,evidence:blocks.slice(0,500).map(b=>({selector:b.selector,controls:collectPRDEvidence(doc,doc.querySelector(b.selector))})),width:Math.round(doc.defaultView.innerWidth),height:Math.round(doc.defaultView.innerHeight),scrollY:doc.defaultView.scrollY};
}


// Repeated computed styles compress well; keep large pages below the API body limit.
export async function encodePRDSnapshot(snapshot){
 const {html,...viewport}=snapshot;
 if(typeof CompressionStream==='undefined'){
  if(html.length<=1500000)return snapshot;
  throw new Error('当前浏览器不支持截图压缩，请使用新版 Chrome 或 Edge');
 }
 const stream=new Blob([html]).stream().pipeThrough(new CompressionStream('gzip'));
 const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
 const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
 const htmlGzip=btoa(chunks.join(''));
 if(htmlGzip.length>1500000)throw new Error('页面中的图片数据过多，截图压缩后仍超出处理范围');
 return {...viewport,htmlGzip};
}
