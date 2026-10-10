import {describePRDBlock,scanPRDBlocks,reviewPRDBlocks,snapshotPRDPage,encodePRDSnapshot} from './prd-annotations-review.mjs';
import {groupPRDBlocks} from './prd-annotations-groups.mjs';
import {mountPRDAnnotations} from './prd-annotations-runtime.mjs';

export function collectPRDTargets(doc,computeBlocks=groupPRDBlocks,existing=[]){
 const escape=doc.defaultView.CSS.escape;
 function selector(el){
  if(el.id&&doc.querySelectorAll('#'+escape(el.id)).length===1)return '#'+escape(el.id);
  const path=[];let current=el;
  while(current&&current!==doc.documentElement){
   if(current.id&&doc.querySelectorAll('#'+escape(current.id)).length===1){path.unshift('#'+escape(current.id));break;}
   const siblings=[...(current.parentElement?.children||[])].filter(n=>n.tagName===current.tagName);
   path.unshift(current.localName+`:nth-of-type(${siblings.indexOf(current)+1})`);current=current.parentElement;
  }
  return path.join(' > ');
 }
 function blockText(el){if(!el)return '';const clone=el.cloneNode(true);for(const nested of clone.querySelectorAll('[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel,[data-detail],dialog,[role="dialog"],.drawer,.detail-drawer'))nested.remove();return clone.textContent||'';}
 const targets=[...doc.querySelectorAll('input,select,textarea,button,a[href],table,[role="button"],[role="tab"],[role="switch"],[role="table"],[role="grid"],[role="img"],canvas,svg[data-chart],article,.panel,.card,.widget,form,fieldset,[data-prd-block],section:has(> h2),section:has(> h3),ul,ol,.drill-summary,.summary,.metric-card,.kpi-card,.stat-card,[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel')]
  .filter(el=>!el.closest('#ve-editor-prd,#ve-prd-review-overlay,.prd-review-panel,#editor-change-overlay,script,style,template')&&!el.matches('input[type="hidden"]')&&(!el.matches('article,.panel,[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel')||!el.querySelector('button,input,select,textarea,table,article,.panel,[role="img"],canvas')))
  .map((el,i)=>{
   const panel=el.closest('[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel,[data-detail],[role="dialog"]');
   const region=el.closest('section,article,.panel,.card,.widget,.chart-card,.metric-card,.kpi-card,.stat-card,[data-prd-region],[role="region"],[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel')||[el.parentElement,el.parentElement?.parentElement].find(parent=>parent&&parent!==doc.body&&parent!==doc.documentElement&&[...parent.children].some(child=>child.matches('h1,h2,h3,h4,h5,h6')));
   const control=el.matches('input,select,textarea,button,a[href],[role="button"],[role="tab"],[role="switch"]');
   const table=el.matches('table,[role="table"],[role="grid"]');
   const chart=el.matches('[role="img"],canvas,svg[data-chart]')&&!el.closest('button,a[href],[role="button"]')&&el.getAttribute('aria-hidden')!=='true';
   const card=el.matches('article,.panel,.metric-card,.kpi-card,.stat-card')&&!el.querySelector('table,button,input,select,textarea,a[href]');
   const content=el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.textContent||el.value||'';
   return {id:'t'+(i+1),selector:selector(el),tag:el.localName,text:content.replace(/\s+/g,' ').trim().slice(0,1500),kind:control?'control':table?'table':chart?'chart':card?'card':'section',required:control||table||chart||card||el.matches('.drill-summary,.summary,.card,.widget,form,fieldset,section,ul,ol,[data-prd-block]'),region:region?selector(region):'',regionTitle:(region?.getAttribute('aria-label')||region?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent||'').trim().slice(0,200),regionText:(region?.textContent||'').replace(/\s+/g,' ').trim().slice(0,1500),scope:panel?selector(panel):'',scopeTitle:panel?(panel.getAttribute('aria-label')||panel.querySelector('h1,h2,h3')?.textContent||panel.id||'隐藏面板').trim().slice(0,200):'公共区域',rowContext:el.closest('tr,[role="row"],li,[role="listitem"]')?.textContent.replace(/\s+/g,' ').trim().slice(0,500)||''};
  });
 const blocks=computeBlocks(doc,targets).map((group,i)=>({...group.item,id:'block'+(i+1),kind:'block',granularity:'block',required:true,region:group.item.selector,regionTitle:group.label,text:(blockText(doc.querySelector(group.item.selector))||group.members.map(t=>t.text).join(' ')).replace(/\s+/g,' ').trim().slice(0,1500),title:group.label,regionText:blockText(doc.querySelector(group.item.selector)).replace(/\s+/g,' ').trim().slice(0,1500),selectors:group.selectors,repeatedCount:group.members.length,examples:[...new Set(group.members.map(t=>t.rowContext||t.text))].filter(Boolean).slice(0,30),children:group.members.map(t=>({selector:t.selector,title:t.text.slice(0,100),kind:t.kind,text:t.text})),parentSelector:doc.querySelector(group.item.selector)?.parentElement?selector(doc.querySelector(group.item.selector).parentElement):''}));
 for(const point of existing){
  let el;try{el=doc.querySelector(point.selector);}catch{}if(!el)continue;
  const scope=el.closest('[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel,[data-detail],dialog,[role="dialog"],.drawer,.detail-drawer');
  const sameView=blocks.filter(t=>(t.scope||'')===(scope?selector(scope):'')).map(t=>({t,el:doc.querySelector(t.selector)})).filter(b=>b.el);
  let candidates=sameView.filter(b=>b.el.contains(el)||el.contains(b.el));
  if(!candidates.length){const order=[...doc.querySelectorAll('*')],index=order.indexOf(el);candidates=[...sameView].sort((a,b)=>Math.abs(order.indexOf(a.el)-index)-Math.abs(order.indexOf(b.el)-index)).slice(0,1);}
  candidates.sort((a,b)=>Number(!a.el.contains(el))-Number(!b.el.contains(el))||a.el.querySelectorAll('*').length-b.el.querySelectorAll('*').length);
  if(candidates[0]){const t=candidates[0].t;(t.existingIds??=[]).push(point.id);}
 }
 return blocks;
}
export function createPRDAnnotationsUI({endpoint,getDocument,getProject,getIterationId,onLayoutChange,notify}){
 const generateButton=document.getElementById('prd-generate-button'),toggleButton=document.getElementById('prd-toggle-button'),listButton=document.getElementById('prd-list-button');
 const sidebar=document.getElementById('prd-sidebar'),canvas=document.querySelector('.canvas-area');
 const key=()=>`prd-annotations-draft:${getProject()?.id}:${getProject()?.entry}`;
 let value={points:[],pendingIds:[],revision:null},dirty=false,loaded=false,visible=true,runtime=null,busy=false,reviewing=false;
 async function request(path,body){const response=await fetch(endpoint(path),body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'标注操作失败');return data;}
 function remember(){localStorage.setItem(key(),JSON.stringify(value));dirty=true;toggleButton.textContent=visible?'隐藏 PRD 标注 *':'显示 PRD 标注 *';}
 function render(){if(reviewing)return;runtime?.destroy();const doc=getDocument();if(!doc?.body)return;runtime=mountPRDAnnotations(doc,value,{editable:true,controls:false,visible,describeBlock:describePRDBlock,onRefresh:refreshFromRequirements,onSync:value.pendingIds?.length?syncToRequirements:undefined,panelContainer:sidebar,onPanelVisibility:open=>{sidebar.hidden=!open;canvas.classList.toggle('prd-open',open);onLayoutChange?.();},onChange:(points,id,blocks)=>{if(blocks)value.blocks=blocks;value.points=points;value.pendingIds=[...new Set([...(value.pendingIds||[]),...(Array.isArray(id)?id:[id])])];remember();}});toggleButton.textContent=(visible?'隐藏 PRD 标注':'显示 PRD 标注')+(dirty?' *':'');toggleButton.setAttribute('aria-pressed',String(visible));if(!busy)generateButton.textContent='AI 分区与标注';}
 async function mount(){if(!loaded){value=await request('/api/prd-annotations');const draft=localStorage.getItem(key());if(draft){try{const parsed=JSON.parse(draft);if(parsed.revision===value.revision){value=parsed;dirty=true;}else if(parsed.revision===value.supplementBaseRevision&&parsed.points.every(p=>value.points.some(saved=>saved.id===p.id&&saved.selector===p.selector))){const edits=new Map(parsed.points.map(p=>[p.id,p]));value.points=value.points.map(p=>edits.get(p.id)||p);value.pendingIds=[...new Set([...(value.pendingIds||[]),...(parsed.pendingIds||[])])];dirty=true;localStorage.setItem(key(),JSON.stringify(value));notify('其他 Tab 的标注已补齐，你的本地手改草稿已保留。');}else notify('PRD 标注已更新，本地旧草稿仍保留，当前显示最新标注。');}catch{}}loaded=true;}render();}
 async function persistAnnotations(revise=false){
  try{value=await request('/api/prd-annotations',{...value,revise});dirty=false;localStorage.removeItem(key());render();return true;}catch(error){notify(error.message);return false;}
 }
 async function beforeSave(){
  if(busy){notify('AI 正在生成 PRD 标注，请完成后再保存。');return false;}
  if(!loaded||!dirty)return true;
  return persistAnnotations();
 }
 async function syncToRequirements(){
  if(busy||reviewing)return;
  busy=true;
  try{if(await persistAnnotations(true)){runtime?.open();notify('标注已同步到需求文档');}}finally{busy=false;}
 }
 async function refreshFromRequirements(){
  if(busy||reviewing)return;if(dirty&&!await beforeSave())return;
  busy=true;generateButton.disabled=true;generateButton.textContent='正在核对需求依据…';
  try{value=await request('/api/prd-annotations/generate',{revision:value.revision,iterationId:getIterationId?.()||undefined,snapshot:await encodePRDSnapshot(snapshotPRDPage(getDocument(),value.blocks||[]))});dirty=false;localStorage.removeItem(key());render();runtime?.open();const count=value.points.reduce((n,p)=>n+Number(!!p.suggestion)+(p.children||[]).filter(c=>c.suggestion).length,0);notify(count?`已参考需求文档和回答，${count} 条修改建议待审核；原说明保留。`:'已核对需求文档和回答，暂无修改建议。');}catch(error){notify(error.message);}finally{busy=false;generateButton.disabled=false;generateButton.textContent='AI 分区与标注';}
 }
 generateButton.onclick=async()=>{
  if(busy||!getProject())return;
  if(dirty&&!await beforeSave())return;
  busy=true;generateButton.disabled=true;generateButton.textContent=value.points.length?'AI 正在整理…':'AI 正在标注…';
  try{
   await mount();const scanned=scanPRDBlocks(getDocument(),value.blocks||[],value.ignoredSelectors||[]);runtime?.destroy();runtime=null;reviewing=true;sidebar.replaceChildren();sidebar.hidden=false;sidebar.setAttribute('aria-label','分区审核');canvas.classList.add('prd-open','prd-reviewing');onLayoutChange?.();generateButton.textContent='等待确认分区…';
   let blocks;try{blocks=await reviewPRDBlocks(getDocument(),scanned,{panelContainer:sidebar,existing:value.blocks||[]});}finally{reviewing=false;canvas.classList.remove('prd-reviewing');sidebar.setAttribute('aria-label','PRD 标注说明');render();}if(!blocks){runtime?.open();return;}
   value=await request('/api/prd-annotations',{action:'confirm-partitions',blocks,ignoredSelectors:[...new Set([...(value.ignoredSelectors||[]),...scanned.filter(b=>!blocks.some(n=>n.selector===b.selector&&n.viewKey===b.viewKey)).map(b=>JSON.stringify([b.viewKey||'',b.selector]))])].filter(s=>!blocks.some(b=>JSON.stringify([b.viewKey||'',b.selector])===s||!b.viewKey&&b.selector===s)),revision:value.revision});render();
   generateButton.textContent='AI 正在生成说明…';
   value=await request('/api/prd-annotations/generate',{revision:value.revision,iterationId:getIterationId?.()||undefined,snapshot:await encodePRDSnapshot(snapshotPRDPage(getDocument(),value.blocks||[]))});
   dirty=false;localStorage.removeItem(key());visible=true;render();runtime?.open();notify('分区已确认，AI 说明为待确认草稿；旧说明的修改会作为建议保留。');
  }catch(error){notify(error.message);}finally{busy=false;generateButton.disabled=false;generateButton.textContent='AI 分区与标注';}
 };
 toggleButton.onclick=()=>{if(reviewing)return;visible=!visible;runtime?.setVisible(visible);toggleButton.textContent=(visible?'隐藏 PRD 标注':'显示 PRD 标注')+(dirty?' *':'');toggleButton.setAttribute('aria-pressed',String(visible));};
 listButton.onclick=()=>{if(reviewing)return;visible=true;runtime?.open();toggleButton.textContent='隐藏 PRD 标注'+(dirty?' *':'');toggleButton.setAttribute('aria-pressed','true');};
 return {mount,beforeSave,hasDraft:()=>dirty};
}
