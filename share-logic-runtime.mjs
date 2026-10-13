// Read-only manual logic annotations for LAN viewers. No editor APIs or mutations.
export function mountLogicAnnotations(doc,value){
 const win=doc.defaultView;
 const framed=win.frameElement?.id==='share-page-frame';
 const outer=framed?win.parent.document:doc;
 const outerWin=outer.defaultView;
 let sidebar=framed?outer.getElementById('share-logic-sidebar'):null;
 if(!sidebar){sidebar=doc.createElement('aside');sidebar.id='share-logic-sidebar';sidebar.style.cssText='position:fixed;right:0;top:0;width:300px;height:100%;z-index:2147483001;background:#fffcf2';doc.body.append(sidebar);}
 const panel=outer.createElement('div');sidebar.replaceChildren(panel);
 const shadow=panel.attachShadow({mode:'open'});
 const style=outer.createElement('style');style.textContent=`:host{display:block;height:100%;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#69532d}*{box-sizing:border-box}.rail{height:100%;overflow:auto;padding:16px 12px;background:#fffcf2}.heading{display:flex;justify-content:space-between;border-bottom:1px solid #f1dfb7;padding-bottom:14px;margin-bottom:12px}.hint{font-size:12px;color:#a68a53}.card{padding:14px;border:1px solid #f0dba3;border-radius:12px;background:#fffef8;margin:0 0 12px;overflow-wrap:anywhere;cursor:pointer}.card.active{box-shadow:0 0 0 2px var(--color)}.title{display:flex;align-items:center;gap:8px;font-weight:700}.number{display:inline-grid;place-items:center;border-radius:50%;width:28px;height:28px;background:var(--color);color:white;flex-shrink:0}p{white-space:pre-wrap;margin:8px 0 0 36px}`;
 const rail=outer.createElement('div');rail.className='rail';shadow.append(style,rail);
 const overlay=doc.createElement('div');overlay.id='share-logic-overlay';overlay.setAttribute('data-ve-locked','true');overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:visible';doc.body.append(overlay);
 const svg=outer.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='share-logic-connectors';svg.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';outer.body.append(svg);
 const storageKey=`share-logic-visible:${win.location.pathname}`;
 let visible=true;
 try{visible=win.sessionStorage.getItem(storageKey)!=='false';}catch{}
 const controls=outer.createElement('div');controls.id='share-logic-controls';
 const toggleRail=outer.getElementById('share-logic-toggle-rail');
 if(toggleRail){toggleRail.hidden=false;controls.style.cssText='position:absolute;right:0;top:12px;z-index:2';toggleRail.append(controls);}
 else{controls.style.cssText='position:fixed;right:0;top:12px;z-index:2147483002';outer.body.append(controls);}
 outerWin.dispatchEvent(new outerWin.Event('resize'));
 const controlsShadow=controls.attachShadow({mode:'open'});
 const controlsStyle=outer.createElement('style');controlsStyle.textContent='button{display:grid;place-items:center;width:28px;height:28px;box-sizing:border-box;border:0;border-radius:4px;background:transparent;padding:4px;color:#53647a;cursor:pointer}svg{width:16px;height:16px;pointer-events:none}button:hover{background:#eff5ff;border-color:#8ab8ff}button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}';
 const toggle=outer.createElement('button');toggle.type='button';toggle.setAttribute('aria-controls','share-logic-sidebar');controlsShadow.append(controlsStyle,toggle);
 const icon=outer.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','2');icon.setAttribute('aria-hidden','true');
 const arrow=outer.createElementNS(icon.namespaceURI,'path');icon.append(arrow);toggle.append(icon);
 toggle.onclick=()=>{visible=!visible;try{win.sessionStorage.setItem(storageKey,String(visible));}catch{}render();};
 let layout=[],signature='',activeId=null,scheduled=0;
 const cards=new Map();
 const element=(tag,cls,text)=>{const el=outer.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 const select=id=>{activeId=id;for(const [key,card] of cards)card.classList.toggle('active',key===id);cards.get(id)?.scrollIntoView({block:'nearest'});};

function queryPatchElement(doc, selector) {
  try { return doc?.querySelector(selector) || null; } catch { return null; }
}

function visibleElement(element) {
  if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function activeChangeScope(doc) {
  return [...doc.querySelectorAll('.drawer.open, dialog[open], [role="dialog"][aria-modal="true"], .modal.open, .modal.show')]
    .filter(visibleElement)
    .reduce((top, element) => !top ||
      (parseInt(doc.defaultView.getComputedStyle(element).zIndex) || 0) >=
      (parseInt(doc.defaultView.getComputedStyle(top).zIndex) || 0) ? element : top, null);
}
function boxScrollContainer(target, rawRect) {
  const win = target.ownerDocument.defaultView;
  const centerX = (rawRect.left + rawRect.right) / 2;
  const centerY = (rawRect.top + rawRect.bottom) / 2;
  return [...target.querySelectorAll('*')].filter(element => {
    const style = win.getComputedStyle(element);
    const scrollsX = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    const scrollsY = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    if (!scrollsX && !scrollsY) return false;
    const bounds = element.getBoundingClientRect();
    return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
  }).sort((first, second) => {
    const a = first.getBoundingClientRect(), b = second.getBoundingClientRect();
    return a.width * a.height - b.width * b.height;
  })[0] || null;
}

function visibleChangeRect(target, scope, customRect, scrollContainer) {
  if (!visibleElement(target) || (scope && !scope.contains(target))) return null;
  if (!scope && target.closest('.drawer, dialog, [role="dialog"], .modal')) return null;
  const rect = customRect || target.getBoundingClientRect();
  const win = target.ownerDocument.defaultView;
  let left = Math.max(2, rect.left - 2), top = Math.max(2, rect.top - 2);
  let right = Math.min(win.innerWidth - 2, rect.right + 2), bottom = Math.min(win.innerHeight - 2, rect.bottom + 2);
  let clipTop = 2, clipRight = win.innerWidth - 2;
  for (let parent = scrollContainer || (customRect ? target : target.parentElement); parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (parent === scope || /auto|scroll|hidden|clip/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft);
      clipRight = Math.min(clipRight, bounds.left + parent.clientLeft + parent.clientWidth);
      right = Math.min(right, clipRight);
    }
    if (parent === scope || /auto|scroll|hidden|clip/.test(style.overflowY)) {
      clipTop = Math.max(clipTop, bounds.top + parent.clientTop);
      top = Math.max(top, clipTop);
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
    }
  }
  return rect.width > 0 && rect.height > 0 && right > left && bottom > top
    ? { left, top, right, bottom, clipTop, clipRight } : null;
}
function activeTabValue(group) {
  const active = group?.querySelector('button.active, button[aria-selected="true"], button[aria-pressed="true"]');
  return active?.textContent.trim().replace(/\s+/g, ' ') || '';
}
function boxViewMatches(doc, box) {
  if (!box.view?.selector || !box.view?.value) return true;
  return activeTabValue(queryPatchElement(doc, box.view.selector)) === box.view.value;
}
 function renderCards(){
  const next=JSON.stringify(layout.map(({box,color})=>[box.id,color,value.notes?.[`box:${box.id}`]]));
  if(next===signature)return;signature=next;cards.clear();rail.replaceChildren();
  const heading=element('div','heading');const title=element('div','',undefined);
  title.append(element('strong','','逻辑说明'),element('div','hint','框选标记与右侧说明对应 · 只读'));
  heading.append(title,element('span','hint',`${layout.length} 项`));rail.append(heading);
  layout.forEach(({box,color},i)=>{
   const card=element('article','card');card.dataset.annotationId=box.id;card.style.setProperty('--color',color);
   const title=element('div','title');title.append(element('span','number',String(i+1)),element('span','',`逻辑 ${i+1}`));
   card.append(title,element('p','',value.notes?.[`box:${box.id}`]||'尚未填写说明'));
   card.classList.toggle('active',activeId===box.id);card.addEventListener('click',()=>select(box.id));cards.set(box.id,card);rail.append(card);
  });
 }
 function draw(){
  svg.replaceChildren();if(sidebar.hidden)return;
  svg.setAttribute('viewBox',`0 0 ${outerWin.innerWidth} ${outerWin.innerHeight}`);
  const frameBounds=framed?win.frameElement.getBoundingClientRect():{left:0,top:0,width:win.innerWidth};
  const scale=frameBounds.width/win.innerWidth;
  for(const {box,rect,color} of layout){
   const card=cards.get(box.id),r=card?.getBoundingClientRect();if(!r)continue;
   const startX=frameBounds.left+rect.right*scale,startY=frameBounds.top+(rect.top+rect.bottom)/2*scale;
   const endX=r.left,endY=Math.max(sidebar.getBoundingClientRect().top,Math.min(sidebar.getBoundingClientRect().bottom,r.top+r.height/2));
   const bend=Math.max(28,Math.abs(endX-startX)*.45);
   const path=outer.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${startX} ${startY} C ${startX+bend} ${startY}, ${endX-bend} ${endY}, ${endX} ${endY}`);
   path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','2.5');path.setAttribute('opacity','.78');
   const dot=outer.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',startX);dot.setAttribute('cy',startY);dot.setAttribute('r','4');dot.setAttribute('fill',color);svg.append(path,dot);
  }
 }
 function render(){
  scheduled=0;overlay.replaceChildren();layout=[];
  const scope=activeChangeScope(doc);
  const cockpit=doc.querySelector('.cockpit-view.active')?.id.replace(/^cockpit-/,'')||win.location.hash.slice(1)||value.defaultCockpit||'page';
  const context=scope?(scope.querySelector('h2,h1,[role="heading"]')?.textContent.trim()||scope.id||'dialog'):'';
  for(const box of value.boxes||[]){
   if(box.cockpit!==cockpit||box.context!==context||!boxViewMatches(doc,box))continue;
   const target=queryPatchElement(doc,box.selector);if(!target)continue;
   const bounds=target.getBoundingClientRect(),width=Math.max(target.scrollWidth,bounds.width),height=Math.max(target.scrollHeight,bounds.height);
   const rawRect={left:bounds.left+box.x*width,top:bounds.top+box.y*height};rawRect.right=rawRect.left+box.width*width;rawRect.bottom=rawRect.top+box.height*height;
   const scroll=boxScrollContainer(target,rawRect);
   if(scroll&&!Number.isFinite(box.nestedScrollLeft))box.nestedScrollLeft=rawRect.right>=scroll.getBoundingClientRect().right-3?scroll.scrollWidth-scroll.clientWidth:scroll.scrollLeft;
   if(scroll&&!Number.isFinite(box.nestedScrollTop))box.nestedScrollTop=scroll.scrollTop;
   const left=rawRect.left-target.scrollLeft-(scroll?scroll.scrollLeft-box.nestedScrollLeft:0),top=rawRect.top-target.scrollTop-(scroll?scroll.scrollTop-box.nestedScrollTop:0);
   const rect=visibleChangeRect(target,scope,{left,top,right:left+box.width*width,bottom:top+box.height*height,width:box.width*width,height:box.height*height},scroll);if(!rect)continue;
   const color=value.colors?.[`box:${box.id}`]==='red'?'#e5484d':'#2f80ed';layout.push({box,rect,color});
   const marker=doc.createElement('div');marker.className='share-logic-marker';marker.dataset.annotationId=box.id;
   marker.style.cssText=`position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.right-rect.left}px;height:${rect.bottom-rect.top}px;border:2px solid ${color};border-radius:9px;pointer-events:none;box-sizing:border-box`;
   const badge=doc.createElement('button');badge.type='button';badge.textContent=String(layout.length);badge.setAttribute('aria-label',`查看第 ${layout.length} 项逻辑说明`);
   badge.style.cssText=`position:absolute;left:0;top:-20px;width:18px;height:18px;min-width:18px;min-height:18px;box-sizing:border-box;padding:0;border:2px solid white;border-radius:50%;background:${color};color:white;font:700 10px sans-serif;cursor:pointer;pointer-events:auto`;
   badge.onclick=event=>{event.preventDefault();event.stopPropagation();select(box.id);};marker.append(badge);overlay.append(marker);
  }
  const hidden=!visible||!layout.length,changed=sidebar.hidden!==hidden;
  sidebar.hidden=hidden;overlay.hidden=!visible;svg.style.display=hidden?'none':'';
  const label=visible?'隐藏说明':'显示说明';toggle.setAttribute('aria-label',label);toggle.title=label;toggle.setAttribute('aria-expanded',String(!hidden));
  arrow.setAttribute('d',visible?'M9 5l7 7-7 7':'M15 5l-7 7 7 7');
  renderCards();
  if(changed)outerWin.dispatchEvent(new outerWin.Event('resize'));
  outerWin.requestAnimationFrame(draw);
 }
 function schedule(event){
  if(event?.target?.closest?.('#share-logic-overlay,#ve-editor-prd'))return;
  if(!scheduled)scheduled=win.requestAnimationFrame(render);
 }
 for(const event of ['scroll','resize','click','change','transitionend','hashchange'])win.addEventListener(event,schedule,true);
 outerWin.addEventListener('resize',schedule);rail.addEventListener('scroll',draw);
 const observer=new win.MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('#share-logic-overlay,#ve-editor-prd,#share-logic-sidebar,#share-logic-connectors,#share-logic-controls')))schedule();});
 observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-hidden','aria-selected','aria-pressed','open','style']});
 win.addEventListener('pagehide',()=>{
  observer.disconnect();win.cancelAnimationFrame(scheduled);
  outerWin.removeEventListener('resize',schedule);rail.removeEventListener('scroll',draw);
  controls.remove();svg.remove();if(toggleRail)toggleRail.hidden=true;
  if(panel.parentNode===sidebar){panel.remove();sidebar.hidden=true;outerWin.dispatchEvent(new outerWin.Event('resize'));}
 },{once:true});
 render();
}
export function logicAnnotationsScript(value){
 const data=JSON.stringify(value).replace(/</g,'\\u003c');
 return `<script>(${mountLogicAnnotations.toString()})(document,${data});</script>`;
}
