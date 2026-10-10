import {collectPRDEvidence,summarizeKnownNavigation} from './prd-annotations-evidence.mjs';
import {createPRDViewContext} from './prd-annotations-view.mjs';
import {groupPRDBlocks} from './prd-annotations-groups.mjs';
// Place compact block pins at their upper-left anchors and avoid toolbar collisions.
export function layoutPRDMarkers(candidates,{width,height,reserved,exterior=false,obstacles=[]}={}){
 const size=22,gap=6,padding=4,placed=[];
 for(const {id,rect:r} of candidates){
  const right=r.left+r.width,bottom=r.top+r.height;
  if(right<=0||bottom<=0||r.left>=width||r.top>=height)continue;
  const minX=Math.max(padding,r.left-8),maxX=Math.min(width-size-padding,right-size);
  const minY=Math.max(padding,r.top-12),maxY=Math.min(height-size-padding,bottom-size);
  const x0=Math.min(Math.max(minX,padding),width-size-padding),y0=Math.min(Math.max(minY,padding),height-size-padding);
  let found=null;
  if(exterior){
   const spots=[[Math.max(padding,r.left-size/2),Math.max(padding,r.top-size/2)],[r.left,r.top-size-4],[r.left-size-4,r.top],[r.left+4,r.top+4]];
   for(const [x,y] of spots){if(x<padding||y<padding||x+size>width-padding||y+size>height-padding)continue;
    if(reserved&&x<reserved.right+gap&&x+size>reserved.left-gap&&y<reserved.bottom+gap&&y+size>reserved.top-gap)continue;
    if(obstacles.some(o=>x<o.right&&x+size>o.left&&y<o.bottom&&y+size>o.top)||placed.some(p=>Math.abs(p.x-x)<size+gap&&Math.abs(p.y-y)<size+gap))continue;
    found={id,x,y};break;
   }
   if(found)placed.push(found);continue;
  }
  for(let ring=0;ring<=10&&!found;ring++){
   const offsets=[];
   for(let y=0;y<=ring;y++)for(let x=0;x<=ring;x++)if(Math.max(x,y)===ring)offsets.push([x,y]);
   for(const [dx,dy] of offsets){
    const x=x0+dx*(size+gap),y=y0+dy*(size+gap);
    if(dx&&x>maxX||dy&&y>maxY||x+size>width-padding||y+size>height-padding)continue;
    if(reserved&&x<reserved.right+gap&&x+size>reserved.left-gap&&y<reserved.bottom+gap&&y+size>reserved.top-gap)continue;
    if(placed.some(p=>Math.abs(p.x-x)<size+gap&&Math.abs(p.y-y)<size+gap))continue;
    found={id,x,y};break;
   }
  }
  if(found)placed.push(found);
 }
 return placed;
}

// Shared by the editor and the read-only LAN preview; shadow DOM isolates page CSS.
export function mountPRDAnnotations(doc,value,{editable=false,onChange,visible=true,controls=true,computeLayout=layoutPRDMarkers,computeGroups=groupPRDBlocks,computeView=createPRDViewContext,computeEvidence=collectPRDEvidence,computeNavigation=summarizeKnownNavigation,panelContainer,onPanelVisibility,onRefresh,onSync,describeBlock}={}){
 const win=doc.defaultView;
 if(!panelContainer&&controls&&win.frameElement?.id==='share-page-frame'){
  panelContainer=win.parent.document.getElementById('share-prd-sidebar');
  if(panelContainer)onPanelVisibility=open=>{panelContainer.hidden=!open;win.parent.dispatchEvent(new win.parent.Event('resize'));};
 }
 doc.getElementById('ve-editor-prd')?.remove();
 const host=doc.createElement('div');host.id='ve-editor-prd';host.setAttribute('data-ve-locked','true');
 host.style.cssText='position:fixed!important;inset:0!important;z-index:2147483000!important;pointer-events:none!important;overflow:hidden!important;';
 doc.body.append(host);const shadow=host.attachShadow({mode:'open'});
 const style=doc.createElement('style');style.textContent=`
 :host{all:initial}*{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer}button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}[hidden]{display:none!important}
 .root{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17243b;pointer-events:none}
 .toolbar{position:fixed;right:16px;top:16px;display:flex;gap:8px;pointer-events:auto}.toolbar button,.filters button,.actions button{border:1px solid #dce2eb;border-radius:10px;background:white;padding:7px 12px;color:#253650;box-shadow:0 2px 8px #13264512}
 .marker{position:fixed;border:1px dashed transparent;border-radius:8px;pointer-events:none}.marker.draft .number{border-style:dashed;border-width:2px}.item.draft{border:1px dashed #94a3b8;padding:12px;margin-top:8px}.marker.active{border-color:var(--color);background:color-mix(in srgb,var(--bg) 16%,transparent)}.number{position:absolute;width:22px;height:22px;border-radius:50%;border:1px solid var(--color);background:var(--bg);color:var(--color);pointer-events:auto;padding:0;font-size:11px;font-weight:600;box-shadow:0 1px 4px #17243b15;line-height:20px}.marker.active .number{box-shadow:0 0 0 3px white,0 0 0 4px var(--color)}
 .tip{position:fixed;max-width:340px;padding:14px 16px;background:white;box-shadow:0 8px 32px #17243b30;border:1px solid #e1e6ee;border-radius:12px;white-space:pre-wrap;pointer-events:none}.tip strong{display:block;margin-bottom:6px;color:var(--color)}
 .panel{position:fixed;right:16px;top:62px;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 80px);overflow:auto;background:white;border:1px solid #e1e6ee;border-radius:16px;box-shadow:0 8px 32px #17243b20;pointer-events:auto;padding:16px}.heading{display:flex;justify-content:space-between;margin-bottom:12px}.heading button{border:0;background:transparent;font-size:20px}.filters{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}.filters button{padding:4px 9px;box-shadow:none}.filters .selected{background:#eaf2ff;border-color:#8ab8ff}.item{padding:14px 0;border-top:1px solid #e5e7eb}.title{display:flex;align-items:center;gap:8px;font-weight:650}.badge{color:var(--color);background:var(--bg);border:1px solid var(--color);border-radius:9px;padding:2px 7px;font-weight:400}.item p{white-space:pre-wrap;margin:8px 0;color:#535d6e}.index{display:inline-grid;place-items:center;min-width:28px;height:28px;background:var(--bg);border:1px solid var(--color);color:var(--color);border-radius:50%}.annotation-meta{margin:8px 0;font-size:12px;color:#7b8798}.annotation-meta summary{cursor:pointer}.status-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}.status-tag{display:inline-block;font-size:12px;font-weight:600;border-radius:6px;padding:3px 8px;background:#fff4db;color:#925b08;border:1px solid #f0d18c}.status-tag.confirmed{background:#e9f6ef;color:#187448;border-color:#b8dfc8}.status-tag.stale{background:#fff0ed;color:#b23c2c;border-color:#edc1b9}.status-line .hint{margin:0}.confirm{border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:white;padding:5px 10px;font-size:12px}.child-item{padding:12px 0;border-top:1px solid #edf0f5}.pending-note{font-size:12px;color:#925b08;background:#fff8e9;padding:8px;border-radius:6px}.panel-intro{font-size:13px;color:#64748b;margin:0 0 14px}.add-section{margin:12px 0;padding:12px;background:#f5f8fc;border:1px solid #e1e6ee;border-radius:10px}.add-section summary{cursor:pointer;font-weight:600}.add-section label{display:block;font-size:12px;color:#64748b;margin:10px 0 6px}.add-section select{width:100%;min-width:0;padding:8px;border:1px solid #ccd5e2;border-radius:7px;background:white;color:#17243b}.title>span:last-child{min-width:0;overflow-wrap:anywhere}.index,.badge{flex-shrink:0}.panel>.edit{display:flex;align-items:center;justify-content:center;width:100%;min-height:38px;margin:0 0 8px;padding:8px 12px;border:1px solid #bfd3f5;border-radius:8px;background:#eff5ff;color:#1d4ed8;font-size:13px;font-weight:600;line-height:1.5;text-align:center;transition:background .15s,border-color .15s,box-shadow .15s}.panel>.edit:hover:not(:disabled){background:#dfeaff;border-color:#7da7ec;box-shadow:0 2px 5px #2563eb12}.panel>.edit:active:not(:disabled),.panel>.edit[aria-pressed="true"]{background:#cfe0fc;border-color:#2563eb;box-shadow:inset 0 1px 2px #2563eb18}.panel>.edit:disabled{cursor:wait;background:#f3f5f8;border-color:#dce2eb;color:#94a3b8;box-shadow:none}.edit{background:transparent;border:0;color:#2563eb;padding:4px 0}.form{display:grid;gap:8px;margin-top:8px}.form input,.form textarea,.form select{width:100%;padding:8px;border:1px solid #ccd5e2;border-radius:7px;background:white;color:#17243b}.actions{display:flex;gap:8px}.hint{font-size:12px;color:#7b8798;margin:8px 0}.empty{color:#7b8798;padding:12px 0}

 .panel>.action-card{justify-content:flex-start;gap:16px;min-height:64px;padding:12px 15px;text-align:left;border-color:#e8edf5;border-radius:10px;background:linear-gradient(110deg,#fff,#f9fbff);color:#17243b}.panel>.action-card.sync{background:#eef4ff;border-color:#bfd6ff}.action-card-icon{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;border-radius:10px;background:#e1ecff;color:#3478f6}.action-card-icon svg{width:21px;height:21px}.action-card.refresh .action-card-icon{background:#e8f8f2;color:#00ac80}.action-card.region .action-card-icon{background:#eeebff;color:#7657ff}.action-card-copy{display:grid;gap:2px;min-width:0}.action-card-title{font-size:13px;font-weight:650;line-height:1.5}.action-card-description{font-size:11px;font-weight:400;line-height:1.5;color:#7b8798}.panel>.action-card:disabled .action-card-icon{background:#e9edf3;color:#94a3b8}.panel>.action-card:disabled .action-card-title{color:#94a3b8}
 .icon-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:#64748b;vertical-align:middle}.icon-button svg{width:16px;height:16px;pointer-events:none}.icon-button:hover{background:#edf3fc;color:#2563eb}.icon-button.delete:hover{background:#fff0ed;color:#b23c2c}.annotation-actions{display:flex;gap:4px;margin-left:auto;flex-shrink:0}.status-line{flex-wrap:nowrap}
 `;shadow.append(style);
 const root=doc.createElement('div');root.className='root';shadow.append(root);
 const palette={global:['#7351b5','#ede3ff'],interaction:['#2563b0','#d7e9ff'],field:['#23851b','#d8efcf'],rule:['#a36711','#ffe1aa'],boundary:['#be3333','#ffdddd']};
 const node=(tag,cls,text)=>{const el=doc.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
 const iconButton=(label,kind)=>{const button=node('button',`edit icon-button ${kind}`);button.type='button';button.title=label;button.setAttribute('aria-label',label);const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',kind==='delete'?'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6':'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6z');svg.append(path);button.append(svg);return button;};
 const actionCard=(kind,label,description)=>{const button=node('button',`edit action-card ${kind}`);button.type='button';button.setAttribute('aria-label',label);const icon=node('span','action-card-icon');icon.setAttribute('aria-hidden','true');const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',kind==='sync'?'M12 5v14M5 12h14':kind==='refresh'?'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6z':'M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4M11 4h2M20 11v2M11 20h2M4 11v2');svg.append(path);icon.append(svg);const copy=node('span','action-card-copy');copy.append(node('span','action-card-title',label),node('span','action-card-description',description));button.append(icon,copy);return button;};
 const setActionLabel=(button,label)=>{const title=button.querySelector('.action-card-title');if(title)title.textContent=label;else button.textContent=label;button.setAttribute('aria-label',label);};
 const theme=(el,p)=>{el.style.setProperty('--color',palette.interaction[0]);el.style.setProperty('--bg',palette.interaction[1]);};
 let sourcePoints=value.points||[],points=[],panelOpen=false,activeId=null,hoveredId=null,showInactive=false,viewKey='',scopeKey='',timer=0,destroyed=false;
 const toolbar=node('div','toolbar'),toggle=node('button','','隐藏标注'),listButton=node('button','','标注说明');
 toggle.type=listButton.type='button';toolbar.append(toggle,listButton);toolbar.hidden=!controls;root.append(toolbar);
 const markers=node('div'),panel=node('aside','panel'),tip=node('div','tip');tip.hidden=true;panel.hidden=true;root.append(markers,tip,panel);
 let panelRoot=null,lastPanelVisible=false;
 if(panelContainer){
  panelRoot=panelContainer.ownerDocument.createElement('div');panelRoot.style.height='100%';panelContainer.replaceChildren(panelRoot);
  const panelShadow=panelRoot.attachShadow({mode:'open'}),panelStyle=style.cloneNode(true);
  panelStyle.textContent+=' .root{height:100%}.panel{position:relative;inset:auto;width:100%;height:100%;max-height:100%;border:0;border-radius:0;box-shadow:none;padding:18px}.heading{position:sticky;top:-18px;background:white;z-index:1;padding:8px 0}';
  const panelBody=node('div','root');panelBody.append(panel);panelShadow.append(panelStyle,panelBody);
  for(const event of ['pointerdown','pointerup','click','dblclick','keydown','keyup','dragstart'])panelBody.addEventListener(event,e=>e.stopPropagation());
 }
 const expandedChildren=new Set();
 let cancelRegion=null;
 let layouts=[],indices=new Map(),context=computeView(doc);
 function regionRect(point,target){
  const clip=context.rectFor(target);if(!clip||!point.region)return clip;
  const r=target.getBoundingClientRect(),g=point.region,w=Math.max(target.scrollWidth,r.width),h=Math.max(target.scrollHeight,r.height);
  const x=r.left+g.x*w-target.scrollLeft,y=r.top+g.y*h-target.scrollTop;
  const left=Math.max(clip.left,x),top=Math.max(clip.top,y),right=Math.min(clip.right,x+g.width*w),bottom=Math.min(clip.bottom,y+g.height*h);
  return right>left&&bottom>top?{left,top,right,bottom,width:right-left,height:bottom-top}:null;
 }
 function snapRegion(rect){
  const overlap=r=>{const area=Math.max(0,Math.min(r.right,rect.right)-Math.max(r.left,rect.left))*Math.max(0,Math.min(r.bottom,rect.bottom)-Math.max(r.top,rect.top));return area/(r.width*r.height+rect.width*rect.height-area);};
  const existing=(value.blocks||[]).flatMap(block=>{let el;try{el=doc.querySelector(block.selector);}catch{}if(!el||block.missing||!context.accepts(el,block))return [];const r=context.rectFor(el);return r?[{el,r,block,score:overlap(r)}]:[];}).sort((a,b)=>b.score-a.score);
  if(existing[0]?.score>=.25)return existing[0];
  const candidates=[...doc.body.querySelectorAll('section,article,figure,table,fieldset,header,footer,nav,img,svg,canvas,div,[role="region"],[data-prd-block]')].filter(el=>!el.closest('[data-ve-locked],script,style,template')&&context.accepts(el,{viewKey:context.key})&&(!el.matches('div')||el.matches('.panel,.card,.widget,[data-prd-block],[role="region"]')||(()=>{const css=win.getComputedStyle(el);return css.backgroundColor!=='rgba(0, 0, 0, 0)'&&css.backgroundColor!=='transparent'||css.backgroundImage!=='none'||parseFloat(css.borderTopWidth)>0;})())).flatMap(el=>{const r=context.rectFor(el);return r?[{el,r,score:overlap(r)}]:[];}).sort((a,b)=>b.score-a.score);
  const best=candidates[0];if(best?.score>=.15&&(!existing[0]||best.score>existing[0].score))return best;
  return existing[0]?.score>=.1?existing[0]:null;
 }
 function startRegionSelection(button){
  if(cancelRegion){cancelRegion();return;}
  const layer=node('div');layer.id='ve-prd-region-selection';layer.setAttribute('data-ve-locked','true');
  Object.assign(layer.style,{position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',touchAction:'none',pointerEvents:'auto'});
  const box=node('div');Object.assign(box.style,{position:'fixed',border:'2px dashed #2563eb',background:'#2563eb18',pointerEvents:'none',display:'none'});layer.append(box);root.append(layer);
  let start=null;const panelDoc=panel.ownerDocument;
  const cancel=()=>{layer.remove();doc.removeEventListener('keydown',key,true);panelDoc.removeEventListener('keydown',key,true);doc.removeEventListener('scroll',cancel,true);setActionLabel(button,'框选区域添加说明');button.setAttribute('aria-pressed','false');cancelRegion=null;};
  const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}};
  cancelRegion=cancel;setActionLabel(button,'取消框选');button.setAttribute('aria-pressed','true');
  doc.addEventListener('keydown',key,true);panelDoc.addEventListener('keydown',key,true);doc.addEventListener('scroll',cancel,true);
  layer.onpointerdown=e=>{if(e.button!==0)return;start={x:e.clientX,y:e.clientY};layer.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();};
  const selection=e=>{const left=Math.min(start.x,e.clientX),top=Math.min(start.y,e.clientY),width=Math.abs(start.x-e.clientX),height=Math.abs(start.y-e.clientY);return {left,top,right:left+width,bottom:top+height,width,height};};
  layer.onpointermove=e=>{if(!start)return;const rect=selection(e),snapped=rect.width>=8&&rect.height>=8?snapRegion(rect):null,r=snapped?.r||rect;Object.assign(box.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
  layer.onpointerup=e=>{
   if(!start)return;const rect=selection(e);const snapped=rect.width>=8&&rect.height>=8?snapRegion(rect):null;cancel();e.preventDefault();e.stopPropagation();
   if(!snapped)return;
   let block=snapped.block;
   if(!block&&describeBlock){block=describeBlock(doc,snapped.el,{manual:true});(value.blocks??=[]).push(block);}
   if(!block)return;
   const p={id:win.crypto.randomUUID(),blockId:block.id,selector:block.selector,fingerprint:block.fingerprint,viewKey:block.viewKey||'',scope:block.scope||'',scopeTitle:block.scopeTitle||'',title:block.title.length>50?(snapped.el.querySelector('h1,h2,h3,h4')?.textContent?.trim()||'区域说明').slice(0,200):block.title,content:'请填写说明。',type:'rule',source:'unconfirmed',status:'draft',manual:true,granularity:'block',children:[]};
   sourcePoints.push(p);activeId=p.id;onChange?.(sourcePoints,[p.id],value.blocks);render();panel.querySelector('.item .icon-button.pencil')?.click();
  };
  layer.onpointercancel=cancel;
 }
 function targetFor(point){
  let fallback=null;
  for(const selector of point.granularity==='block'?[point.selector]:(point.selectors||[point.selector])){let target;try{target=doc.querySelector(selector);}catch{}if(!target)continue;fallback??=target;const r=target.getBoundingClientRect();if(r.width&&r.height&&r.bottom>0&&r.right>0&&r.top<win.innerHeight&&r.left<win.innerWidth&&win.getComputedStyle(target).visibility!=='hidden')return target;}
  return fallback;
 }
 // Ordinals belong to all blocks in the page/view, regardless of scroll or filters.
 function updateNumbering(){
  const numbered=points.filter(p=>p.type!=='global'&&context.accepts(targetFor(p),p)).map((point,order)=>({point,order,target:targetFor(point)}));
  numbered.sort((a,b)=>{
   if(!a.target||!b.target||a.target===b.target)return a.order-b.order;
   const position=a.target.compareDocumentPosition(b.target);
   if(position&win.Node.DOCUMENT_POSITION_DISCONNECTED)return a.order-b.order;
   return position&win.Node.DOCUMENT_POSITION_FOLLOWING?-1:1;
  });
  indices=new Map(numbered.map(({point},i)=>[point.id,i+1]));
 }
 function update(){
  if(destroyed||cancelRegion)return;
  markers.hidden=!visible;panel.hidden=!visible||!panelOpen;toggle.textContent=visible?'隐藏标注':'显示标注';toggle.setAttribute('aria-pressed',String(visible));
  const panelVisible=visible&&panelOpen;
  if(panelVisible!==lastPanelVisible){lastPanelVisible=panelVisible;onPanelVisibility?.(panelVisible);}
  // Hidden/empty annotations have no pins to position. Do not repeatedly hit-test
  // drawers and read layout while the user operates the prototype underneath.
  if(!visible||!sourcePoints.length)return;
  const previousContext=context.key;context=computeView(doc);if(previousContext!==context.key){activeId=null;hoveredId=null;tip.hidden=true;showInactive=false;}
  const currentScope=context.key+'|'+sourcePoints.map(p=>{let el;try{el=doc.querySelector(p.selector);}catch{}return p.id+':'+Boolean(el?.getClientRects().length&&win.getComputedStyle(el).visibility!=='hidden');}).join('|');
  if(scopeKey!==currentScope&&!panel.querySelector('form')){scopeKey=currentScope;render();return;}
  updateNumbering();
  const candidates=[];
  for(const entry of layouts){const {point,box}=entry;const target=targetFor(point),rect=regionRect(point,target);
   box.classList.toggle('active',visible&&(activeId===point.id||hoveredId===point.id));
   box.hidden=true;
   if(!context.accepts(target,point)||point.type==='global'||!visible||!rect?.width||!rect.height||win.getComputedStyle(target).visibility==='hidden'||rect.right<=0||rect.left>=win.innerWidth)continue;
   candidates.push({id:point.id,rect,entry});
  }
  const nextView=candidates.map(({id})=>id).join('|');
  if(nextView!==viewKey){viewKey=nextView;if(activeId&&!candidates.some(c=>c.id===activeId))activeId=null;if(panelOpen&&!panel.querySelector('form'))renderPanel();}
  const reserved=panel.hidden||panelContainer?null:panel.getBoundingClientRect();
  const obstacles=value.version===2?[...doc.querySelectorAll('button,input,select,textarea,a,h1,h2,h3,h4,p,label')].filter(e=>!e.closest('#ve-editor-prd')).map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height):[];
  // Pins are outside their target boxes, so ancestor scrollbars also need clearance.
  if(value.version===2){
   const ancestors=new Set();for(const {entry:{point}} of candidates)for(let el=targetFor(point)?.parentElement;el;el=el.parentElement)ancestors.add(el);
   for(const el of ancestors){const css=win.getComputedStyle(el);if(!/auto|scroll/.test(css.overflowX+' '+css.overflowY))continue;const r=el.getBoundingClientRect(),scaleX=r.width/el.offsetWidth||1,scaleY=r.height/el.offsetHeight||1;
    const left=r.left+el.clientLeft*scaleX,right=left+el.clientWidth*scaleX,top=r.top+el.clientTop*scaleY,bottom=top+el.clientHeight*scaleY;
    if(r.right-right-(parseFloat(css.borderRightWidth)||0)*scaleX>1)obstacles.push({left:right-6,right:r.right,top:r.top,bottom:r.bottom});
    if(el.clientLeft-(parseFloat(css.borderLeftWidth)||0)>1)obstacles.push({left:r.left,right:left+6,top:r.top,bottom:r.bottom});
    if(r.bottom-bottom-(parseFloat(css.borderBottomWidth)||0)*scaleY>1)obstacles.push({left:r.left,right:r.right,top:bottom-6,bottom:r.bottom});
   }
  }
  const positioned=computeLayout(candidates,{width:Math.min(win.innerWidth,doc.documentElement.clientWidth||win.innerWidth),height:Math.min(win.innerHeight,doc.documentElement.clientHeight||win.innerHeight),reserved,exterior:value.version===2,obstacles});
  const positions=new Map(positioned.map(p=>[p.id,p]));
  for(const {id,rect,entry:{point,box,button}} of candidates){const pin=positions.get(id);if(!pin)continue;box.hidden=false;
   const properties={left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'};
   for(const [key,next] of Object.entries(properties))if(box.style[key]!==next)box.style[key]=next;
   theme(box,point);button.style.left=(pin.x-rect.left-1)+'px';button.style.top=(pin.y-rect.top-1)+'px';
   button.textContent=String(indices.get(point.id)||points.indexOf(point)+1);
   button.setAttribute('aria-label',`${indices.get(point.id)||points.indexOf(point)+1} ${point.title}：${point.content}`);
  }
 }
 function tooltip(point,button){tip.replaceChildren(node('strong','',point.title),node('span','',point.content));if(point.selectors.length>1)tip.append(node('p','hint',`适用于 ${point.itemCount} 个子项${point.extraContents.length?'；展开侧栏查看子项明细':''}。`));theme(tip,point);tip.hidden=false;const r=button.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(r.left+24,win.innerWidth-350))+'px';tip.style.top=Math.max(8,Math.min(r.top+30,win.innerHeight-tip.offsetHeight-8))+'px';}
 function appendStatus(container,record,ownerId,childId){
  if(value.version!==2)return;
  const state=record.codeDerived?'confirmed':record.status||'draft',line=node('div','status-line');line.append(node('span','status-tag '+state,record.codeDerived?'代码已识别':{draft:'待确认',confirmed:'已确认',stale:'已过期'}[state]||'待确认'));
  if(editable&&state!=='confirmed'&&!record.codeDerived){const confirm=node('button','confirm',childId?'确认此子项':'确认此说明');confirm.type='button';confirm.onclick=()=>{const owner=sourcePoints.find(p=>p.id===ownerId),target=childId?owner?.children?.find(c=>c.id===childId):owner;if(!target)return;target.status='confirmed';onChange?.(sourcePoints,[ownerId]);render();};line.append(confirm);}
  container.append(line);
  if(record.suggestion){container.append(node('p','pending-note','AI 修改建议：'+record.suggestion.content));if(editable){const actions=node('div','actions');for(const [text,accept] of [['接受建议',true],['拒绝建议',false]]){const button=node('button','edit',text);button.type='button';button.onclick=()=>{const owner=sourcePoints.find(p=>p.id===ownerId),target=childId?owner?.children?.find(c=>c.id===childId):owner;if(!target)return;if(accept)Object.assign(target,target.suggestion,{status:'confirmed'});delete target.suggestion;onChange?.(sourcePoints,[ownerId]);render();};actions.append(button);}container.append(actions);}}

 }
 function renderPanel(){updateNumbering();panel.replaceChildren();const head=node('div','heading'),close=node('button','','×');close.type='button';close.setAttribute('aria-label','关闭标注说明');close.onclick=()=>{cancelRegion?.();panelOpen=false;activeId=null;update();};head.append(node('strong','','PRD 标注说明'),close);panel.append(head);if(activeId){const back=node('button','edit','返回全部说明');back.onclick=()=>{activeId=null;renderPanel();update();};panel.append(back);}
  const inView=points.filter(p=>p.type==='global'||context.accepts(targetFor(p),p));
  const currentPoints=inView.filter(p=>{const el=targetFor(p);return p.type==='global'||el?.getClientRects().length&&win.getComputedStyle(el).visibility!=='hidden';});
  if(context.active)panel.append(node('p','hint','当前穿透页：'+context.title));
  const specific=p=>Boolean(p.scope||targetFor(p)?.closest('[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel,[data-detail],[role="dialog"]'));
  const displayed=value.version===2?[...(showInactive?inView:currentPoints)].sort((a,b)=>Number(b.type==='global')-Number(a.type==='global')||(indices.get(a.id)||0)-(indices.get(b.id)||0)):showInactive?inView:[...currentPoints].sort((a,b)=>Number(specific(b))-Number(specific(a)));
  if(value.version===2&&!activeId){if(editable&&onSync){const sync=actionCard('sync','将页面标注写入需求文档','将修改过的页面标注同步到需求文档，更新对应功能规则');sync.type='button';sync.onclick=async()=>{sync.disabled=true;try{await onSync();}finally{sync.disabled=false;}};panel.append(sync);}if(editable&&onRefresh&&value.partitionConfirmed){const refresh=actionCard('refresh','根据需求核对页面标注','AI 根据需求文档和已确认回答生成修改建议，审核后再更新标注');refresh.type='button';refresh.onclick=()=>onRefresh();panel.append(refresh);}
   if(editable){
    const add=actionCard('region','框选区域添加说明','框选指定区域，为选中内容添加标注说明');add.type='button';add.title='在页面上拖动框选，按 Esc 取消';add.onclick=()=>startRegionSelection(add);panel.append(add);
    if(sourcePoints.some(p=>p.status==='draft'&&context.accepts(targetFor(p),p))){const accept=node('button','edit','批量确认区块草稿');accept.onclick=()=>{const accepted=sourcePoints.filter(p=>p.status==='draft'&&context.accepts(targetFor(p),p));accepted.forEach(p=>p.status='confirmed');onChange?.(sourcePoints,accepted.map(p=>p.id));render();};panel.append(accept);}}
  }
  if(!activeId&&!context.active&&currentPoints.length<inView.length){const allViews=node('button','edit',showInactive?'只看当前 Tab':`查看全部 Tab（共 ${points.length} 条）`);allViews.type='button';allViews.onclick=()=>{showInactive=!showInactive;activeId=null;renderPanel();update();};panel.append(allViews);}
  if(editable&&!activeId)panel.append(node('p','hint','确认或修改后，点击「保存到项目」保存。区块与子项的审核状态分别记录。'));
  displayed.forEach(p=>{const i=(indices.get(p.id)||points.indexOf(p)+1)-1;if(activeId&&activeId!==p.id)return;const item=node('section','item'+(p.status==='draft'&&!p.codeDerived?' draft':''));item.onmouseenter=()=>{hoveredId=p.id;update();};item.onmouseleave=()=>{hoveredId=null;update();};theme(item,p);const title=node('div','title');title.append(node('span','index',p.type==='global'?'•':String(i+1)),node('span','',p.title));item.append(title);if(showInactive&&p.scopeTitle)item.append(node('p','hint',p.scopeTitle));item.append(node('p','',p.content));
   appendStatus(item,p,p.id);
   if(p.selectors.length>1)item.append(node('p','hint',`适用于本功能的 ${p.itemCount} 个子项，仅显示一个编号。`));
   if(p.children.length&&!(activeId&&p.children.length===1&&p.children[0].content===p.content)){const details=node('details','child-details'),summary=node('summary','',`子项明细（${p.children.length} 项）`);details.open=!activeId&&expandedChildren.has(p.id);details.ontoggle=()=>{if(details.open)expandedChildren.add(p.id);else expandedChildren.delete(p.id);};details.append(summary);for(const child of p.children){const entry=node('section','child-item');entry.append(node('strong','',child.title),node('p','',child.content));appendStatus(entry,child,child.ownerId,child.childId);entry.onmouseenter=()=>{if(!details.open)return;const target=targetFor(child);if(!target)return;const r=target.getBoundingClientRect();tip.replaceChildren(node('strong','',child.title),node('span','',child.content));tip.style.left=Math.max(8,Math.min(r.left,win.innerWidth-350))+'px';tip.style.top=Math.max(8,Math.min(r.bottom,win.innerHeight-160))+'px';tip.hidden=false;};entry.onmouseleave=()=>{tip.hidden=true;};if(editable&&child.ownerId)appendEditor(entry,child,child.ownerId,child.childId);details.append(entry);}item.append(details);}
   const target=targetFor(p);if(!target?.getClientRects().length)item.append(node('p','hint','当前页面未显示该控件；编号会在控件出现后显示。'));
   if(editable){appendEditor(item,p,p.id);
    if(value.version===2){const actions=item.querySelector(':scope > .status-line > .annotation-actions');
     const action=(label,fn)=>{const b=iconButton(label,'delete');b.onclick=()=>{fn();onChange?.(sourcePoints,[p.id]);render();};actions.append(b);};
     action('删除',()=>{sourcePoints=sourcePoints.filter(o=>o.id!==p.id);});
    }
   }panel.append(item);
  });if(!displayed.length)panel.append(node('p','empty',editable?'当前页面还没有标注说明。可以用「AI 一键标注」生成草稿，也可以展开「手动添加说明」填写。':'当前页面还没有标注说明。'));
 }
 function appendEditor(container,record,ownerId,childId){
  const edit=iconButton('修改标注','pencil');edit.onclick=()=>{
   edit.hidden=true;const form=node('form','form'),name=node('input'),content=node('textarea');
   name.value=record.title;name.maxLength=200;name.setAttribute('aria-label','标注标题');content.value=record.content;content.maxLength=4000;content.rows=5;content.setAttribute('aria-label','标注内容');
   const actions=node('div','actions'),save=node('button','','应用修改'),cancel=node('button','','取消');save.type='submit';cancel.type='button';actions.append(save,cancel);let state;if(value.version===2){state=node('select');state.setAttribute('aria-label','确认状态');for(const [key,text] of Object.entries({draft:'待确认',confirmed:'已确认',stale:'已过期'})){const option=node('option','',text);option.value=key;state.append(option);}state.value=record.status||'draft';}form.append(name,content);if(state){const label=node('label','','确认状态');label.append(state);form.append(label);}form.append(actions);container.append(form);
   cancel.onclick=()=>{form.remove();edit.hidden=false;};form.onsubmit=e=>{
    e.preventDefault();if(!name.value.trim()||!content.value.trim())return;
    const original=sourcePoints.find(p=>p.id===ownerId),changed=childId?original?.children?.find(c=>c.id===childId):original;if(!changed)return;
    Object.assign(changed,{title:name.value.trim(),content:content.value.trim(),manual:true,...(value.version===2?{status:state.value}:{})});
    onChange?.(sourcePoints.map(p=>({...p})),[ownerId]);render();
   };content.focus();
  };const line=container.querySelector(':scope > .status-line');if(line){const actions=node('div','annotation-actions');actions.append(edit);line.append(actions);}else container.append(edit);
 }
 function render(){points=(value.version===2?sourcePoints.map(p=>({item:p,members:[p],selectors:[p.selector]})):computeGroups(doc,sourcePoints)).map(group=>{
  let primary=group.members.find(p=>p.granularity==='block')||group.members[0],children=[];
  for(const member of group.members){
   if(group.members.length>1&&(member!==primary||primary.granularity!=='block'))children.push({...member,ownerId:member.id});
   for(const child of member.children||[])children.push({...child,ownerId:member.id,childId:child.id});
  }
  let unique=[...new Map(children.map(c=>[c.id||JSON.stringify([c.selector,c.title,c.content]),c])).values()];
  const target=targetFor(primary),evidence=computeEvidence(doc,target),navigation=!primary.manual&&primary.type==='interaction'&&!/权限|保存|失败|异常|审批|统计|公式|校验/.test(primary.content+(primary.children||[]).map(c=>c.content).join(''))?computeNavigation(evidence):'';
  if(navigation){primary={...primary,content:navigation,title:evidence.length===1?evidence[0].text:primary.title,codeDerived:true};unique=unique.filter(c=>c.manual);}
  return {...group.item,...(navigation?{codeDerived:true,source:'visible',suggestion:undefined}:{}),id:primary.id,type:primary.type,granularity:'block',members:group.members,selectors:group.selectors,title:primary.granularity==='block'?primary.title:group.members.length>1?group.label:primary.title,content:primary.content,children:unique,itemCount:primary.itemCount||value.mergeReport?.find(t=>t.selector===primary.selector)?.count||group.members.length,extraContents:unique.map(c=>c.content)};
 });markers.replaceChildren();layouts=[];points.forEach((p,i)=>{const box=node('div','marker'+(p.status==='draft'&&!p.codeDerived?' draft':'')),button=node('button','number',String(i+1));button.type='button';theme(box,p);box.append(button);markers.append(box);button.onmouseenter=button.onfocus=()=>{hoveredId=p.id;tooltip(p,button);update();};button.onmouseleave=button.onblur=()=>{hoveredId=null;tip.hidden=true;update();};button.onclick=()=>{activeId=p.id;tip.hidden=true;panelOpen=true;renderPanel();update();};layouts.push({point:p,box,button});});renderPanel();update();}
 toggle.onclick=()=>{visible=!visible;tip.hidden=true;update();};listButton.onclick=()=>{panelOpen=!panelOpen;activeId=null;renderPanel();update();};
 // Internal controls must not trigger editor shortcuts or page click handlers.
 for(const event of ['pointerdown','pointerup','click','dblclick','keydown','keyup','dragstart'])root.addEventListener(event,e=>e.stopPropagation());
 const hideTip=()=>{tip.hidden=true;hoveredId=null;update();};const resized=()=>{cancelRegion?.();tip.hidden=true;hoveredId=null;if(!panel.querySelector('form'))render();else update();};win.addEventListener('scroll',hideTip,true);win.addEventListener('resize',resized);
 const repaired=[];
 for(const p of sourcePoints.filter(p=>p.manual&&p.region)){
  const target=targetFor(p),rect=regionRect(p,target);if(!rect)continue;
  let block=(value.blocks||[]).find(b=>b.selector===p.selector&&context.accepts(target,b));
  if(!block){const snapped=snapRegion(rect);block=snapped?.block;if(!block&&snapped&&describeBlock){block=describeBlock(doc,snapped.el,{manual:true});(value.blocks??=[]).push(block);}}
  if(!block)continue;
  Object.assign(p,{blockId:block.id,selector:block.selector,fingerprint:block.fingerprint,viewKey:block.viewKey||'',scope:block.scope||'',scopeTitle:block.scopeTitle||''});delete p.region;repaired.push(p.id);
 }
 if(repaired.length)onChange?.(sourcePoints,repaired,value.blocks);
 timer=win.setInterval(update,250);render();
 return {setVisible(next){if(!next)cancelRegion?.();visible=next;tip.hidden=true;update();},setPoints(next){sourcePoints=next;render();},open(){visible=true;panelOpen=true;activeId=null;renderPanel();update();},destroy(){cancelRegion?.();destroyed=true;win.clearInterval(timer);win.removeEventListener('scroll',hideTip,true);win.removeEventListener('resize',resized);host.remove();panelRoot?.remove();onPanelVisibility?.(false);}};
}
export function prdAnnotationsScript(value){const data=JSON.stringify(value).replace(/</g,'\\u003c');return `<script>(${mountPRDAnnotations.toString()})(document,${data},{computeLayout:(${layoutPRDMarkers.toString()}),computeGroups:(${groupPRDBlocks.toString()}),computeView:(${createPRDViewContext.toString()}),computeEvidence:(${collectPRDEvidence.toString()}),computeNavigation:(${summarizeKnownNavigation.toString()})});</script>`;}
