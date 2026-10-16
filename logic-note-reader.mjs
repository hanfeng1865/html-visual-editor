import {parseLogicNote,applyLogicNoteEdits,serializeLogicNote} from './logic-note-document.mjs';
export function openLogicNoteReader({text,title='逻辑说明',context='',opener,onSave,initialSavedText=text,comparisonHost,requirementTitle=context||'需求说明',initialSavedTitle=requirementTitle}){
 const doc=opener?.ownerDocument||document,editable=typeof onSave==='function';
 const win=doc.defaultView,host=editable?(comparisonHost||opener?.closest('.canvas-area')):null;
 const existing=host?.querySelector('.annotation-reader-docked');if(existing){existing.focus();return existing;}
 let model=parseLogicNote(text),savedText=initialSavedText,saving=false,message='',active=0,structural=false;
 const edits=new Map(),draft=()=>structural?serializeLogicNote(model):applyLogicNoteEdits(model.raw,edits.values());
 let noteTitle=requirementTitle,savedTitle=initialSavedTitle;
 const isDirty=()=>draft()!==savedText||noteTitle!==savedTitle;
 const el=(tag,cls,value)=>{const node=doc.createElement(tag);node.className=cls||'';if(value!==undefined)node.textContent=value;return node;};
 const action=(label,handler,cls='annotation-add-button')=>{const b=el('button',cls,label);b.type='button';b.dataset.noteAction='';b.onclick=()=>{if(!saving)handler();};return b;};
 const dialog=el('dialog','annotation-reader annotation-topic-reader');
 const header=el('header','annotation-reader-header'),heading=el('h2'),headingName=el('span','annotation-requirement-title',noteTitle);
 heading.append(el('span','annotation-requirement-prefix',title+' · '),headingName);
 if(editable){
  headingName.contentEditable='plaintext-only';headingName.dataset.placeholder='填写需求名称';headingName.setAttribute('role','textbox');headingName.setAttribute('aria-label','需求名称');headingName.setAttribute('aria-multiline','false');headingName.title='点击修改需求名称';
  headingName.addEventListener('input',()=>{noteTitle=headingName.innerText.replace(/[\r\n]+/g,' ');message='';updateControls();});
  headingName.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();headingName.blur();}});
 }
 heading.id='annotation-reader-title';dialog.setAttribute('aria-labelledby',heading.id);
 const headingWrap=el('div','annotation-reader-heading');headingWrap.append(heading);
 const tools=el('div','annotation-reader-tools'),undo=action('撤销修改',revert,''),save=action('保存修改',persist,'annotation-reader-save'),close=action('关闭',requestClose,'');
 const layoutToggle=host?action('展开编辑',toggleLayout,'annotation-reader-layout-toggle'):null;
 if(layoutToggle)tools.append(layoutToggle);
 close.autofocus=true;
 const status=el('p','annotation-reader-edit-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 if(editable){tools.append(undo,save);headingWrap.append(status);}
 tools.append(close);header.append(headingWrap,tools);
 const body=el('div','annotation-reader-body'),nav=el('nav','annotation-topic-nav');nav.setAttribute('aria-label','内容目录');
 const content=el('article','annotation-reader-content');content.id='annotation-reader-topic';
 const footer=el('footer','annotation-reader-footer'),prev=action('',()=>select(active-1),'annotation-reader-prev'),next=action('',()=>select(active+1),'annotation-reader-next');footer.append(prev,next);
 let expanded=false,panelWidth=0,layoutObserver=null,restoreFrame=0,bookmark=null,drag=null;
 const shade=host?el('div','annotation-reader-shade'):null,divider=host?el('div','annotation-reader-divider'):null,dragShield=host?el('div','annotation-reader-drag-shield'):null;
 const oldWidth=host?.style.getPropertyValue('--note-panel-width')||'';
 function rememberSelection(){
  const selection=win.getSelection();if(!selection.rangeCount)return;
  const range=selection.getRangeAt(0),node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const editor=node.closest('[data-note-edit],.annotation-requirement-title[contenteditable]');
  if(editor&&(content.contains(editor)||editor===headingName))bookmark={node:editor,range:range.cloneRange()};
 }
 function widthLimits(){return {min:360,max:Math.max(360,host.clientWidth-348)};}
 function setPanelWidth(value){
  const {min,max}=widthLimits();panelWidth=Math.round(Math.max(min,Math.min(max,value)));
  host.style.setProperty('--note-panel-width',panelWidth+'px');
  divider.setAttribute('aria-valuemin',min);divider.setAttribute('aria-valuemax',max);divider.setAttribute('aria-valuenow',panelWidth);divider.setAttribute('aria-valuetext','说明宽度 '+panelWidth+' 像素');
 }
 function applyLayout(){
  if(!host||!dialog.isConnected)return;
  const canCompare=win.innerWidth>=900&&host.clientWidth>=740,comparing=canCompare&&!expanded;
  if(!panelWidth)panelWidth=host.clientWidth*.3;
  setPanelWidth(panelWidth);
  host.classList.add('note-reader-open');host.classList.toggle('note-reader-comparing',comparing);
  dialog.classList.toggle('is-comparing',comparing);dialog.classList.toggle('is-expanded',!comparing);
  const stage=host.querySelector('#canvas-scroll');
  host.style.setProperty('--note-panel-top',stage?stage.offsetTop+'px':'74px');
  shade.hidden=comparing;divider.hidden=!comparing;layoutToggle.hidden=!canCompare;
  layoutToggle.textContent=comparing?'展开编辑':'返回对照';
  dialog.setAttribute('aria-modal',String(!comparing));
 }
 function toggleLayout(){
  rememberSelection();const top=content.scrollTop,left=content.scrollLeft;
  expanded=!expanded;applyLayout();win.cancelAnimationFrame(restoreFrame);
  restoreFrame=win.requestAnimationFrame(()=>{
   content.scrollTop=top;content.scrollLeft=left;
   if(bookmark?.node.isConnected){
    bookmark.node.focus({preventScroll:true});const selection=win.getSelection();selection.removeAllRanges();selection.addRange(bookmark.range);
    bookmark.node.scrollIntoView({block:'nearest',inline:'nearest'});
   }
  });
 }
 function finishDrag(event){
  if(!drag)return;const previous=drag.width;drag=null;
  if(event?.type==='pointercancel')setPanelWidth(previous);
  dragShield.hidden=true;doc.body.classList.remove('annotation-reader-resizing');
  if(divider.hasPointerCapture(event?.pointerId))divider.releasePointerCapture(event.pointerId);
 }
 function protectDraft(event){if(isDirty()){event.preventDefault();event.returnValue='';}}
 if(host){
  dialog.classList.add('annotation-reader-docked');
  divider.tabIndex=0;divider.title='拖动调整说明宽度';divider.setAttribute('role','separator');divider.setAttribute('aria-label','调整说明宽度');divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-controls',content.id);
  dragShield.hidden=true;shade.setAttribute('aria-hidden','true');dragShield.setAttribute('aria-hidden','true');
  layoutToggle.addEventListener('pointerdown',rememberSelection);
  doc.addEventListener('selectionchange',rememberSelection);
  win.addEventListener('beforeunload',protectDraft);
  divider.addEventListener('pointerdown',event=>{
   if(event.button!==0||saving)return;event.preventDefault();
   drag={x:event.clientX,width:panelWidth};divider.setPointerCapture(event.pointerId);
   dragShield.hidden=false;doc.body.classList.add('annotation-reader-resizing');
  });
  divider.addEventListener('pointermove',event=>{if(drag)setPanelWidth(drag.width+drag.x-event.clientX);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])divider.addEventListener(type,finishDrag);
  divider.addEventListener('keydown',event=>{
   const {min,max}=widthLimits(),width=event.key==='ArrowLeft'?panelWidth+24:event.key==='ArrowRight'?panelWidth-24:event.key==='Home'?min:event.key==='End'?max:null;
   if(width===null||saving)return;event.preventDefault();event.stopPropagation();setPanelWidth(width);
  });
 }
 function validation(){
  if(!noteTitle.trim()||noteTitle.trim().length>60)return '需求名称请填写 1–60 个字。';
  const names=model.topics.map(t=>t.title.trim());
  if(names.some(n=>!n||n.length>30))return 'Tab 名称请填写 1–30 个字。';
  if(new Set(names).size!==names.length)return 'Tab 名称重复了，请换个名称。';
  if(draft().length>2000)return `说明最多 2000 字，当前 ${draft().length} 字，请缩短后保存。`;
  return '';
 }
 function updateControls(){
  for(const b of dialog.querySelectorAll('[data-note-action]'))b.disabled=saving;
  prev.disabled=saving||active===0;next.disabled=saving||active===model.topics.length-1;
  if(!editable)return;
  const dirty=isDirty(),error=validation();
  save.disabled=saving||!dirty||Boolean(error);undo.disabled=saving||!dirty;close.disabled=saving;
  status.textContent=saving?'正在保存…':error||message||(dirty?'有未保存的修改':'点击内容直接填写，完成后保存');
  status.classList.toggle('is-error',Boolean(error||message&&message!=='已保存到项目'));
  for(const node of content.querySelectorAll('[data-note-edit]'))node.contentEditable=saving?'false':'plaintext-only';
  headingName.contentEditable=saving?'false':'plaintext-only';
 }
 function editText(node,owner,key,range,label,placeholder='点击填写',afterInput){
  if(!editable)return node;
  node.dataset.noteEdit='';node.contentEditable='plaintext-only';node.dataset.placeholder=placeholder;
  node.setAttribute('role','textbox');node.setAttribute('aria-label',label);node.setAttribute('aria-multiline','false');
  node.textContent=owner[key]??'';
  node.addEventListener('input',()=>{
   const value=node.innerText.replace(/[\r\n]+/g,' ');owner[key]=value;
   if(range){
    const encoded=range.encoding==='table'?value.replace(/\\/g,'\\\\').replace(/\|/g,'\\|'):value;
    edits.set(range.start+':'+range.end,{...range,text:encoded});
    // Legacy rule delimiters must remain literal inside the cell being edited.
    if(!range.encoding&&/[;；｜|]/.test(value))structural=true;
   }else structural=true;
   message='';afterInput?.();updateControls();
  });
  node.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();node.blur();}});
  return node;
 }
 function focus(node,selectAll=false){
  if(!node)return;node.focus();node.scrollIntoView({block:'nearest',inline:'nearest'});
  const range=doc.createRange();range.selectNodeContents(node);if(!selectAll)range.collapse(false);
  const selection=doc.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);
 }
 function mutate(fn,focusSelector){
  if(saving)return;fn();structural=true;message='';select(active);
  if(focusSelector)focus(content.querySelector(focusSelector),true);
 }
 function renderNav(){
  nav.replaceChildren(el('p','','内容目录'));
  model.topics.forEach((topic,i)=>{
   const b=action(topic.title||'未命名 Tab',()=>select(i),'annotation-topic-tab'+(i===active?' selected':''));
   b.setAttribute('aria-controls',content.id);if(i===active)b.setAttribute('aria-current','true');nav.append(b);
  });
  if(editable)nav.append(action('＋ Tab',()=>{
   let name='新 Tab',n=2;while(model.topics.some(t=>t.title===name))name='新 Tab '+n++;
   mutate(()=>{model.topics.push({title:name,groups:[]});active=model.topics.length-1;},'.annotation-topic-title');
  },'annotation-add-tab'));
 }
 async function persist(){
  if(saving||!isDirty()||validation())return;
  const value=draft();saving=true;message='';updateControls();
  try{const name=noteTitle.trim();await onSave(value,name);savedText=value;savedTitle=noteTitle=name;headingName.textContent=name;model=parseLogicNote(value);structural=false;edits.clear();message='已保存到项目';select(active);}
  catch(error){message=error.message||'保存失败，请重试';}
  finally{saving=false;updateControls();}
 }
 function revert(){model=parseLogicNote(savedText);noteTitle=savedTitle;headingName.textContent=noteTitle;edits.clear();structural=false;message='';select(Math.min(active,model.topics.length-1));}
 function requestClose(){
  if(saving)return;
  if(editable&&isDirty()&&!doc.defaultView.confirm('说明有未保存的修改，确定放弃并关闭吗？'))return;
  dialog.close();
 }
 dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
 function addGroup(kind){
  const group={kind,title:kind==='paragraph'?'文字说明':kind==='list'?'列表':'表格',items:kind==='rules'?[{cells:['','']}]:[{text:''}]};
  if(kind==='rules')group.columns=['项目','说明'];
  mutate(()=>model.topics[active].groups.push(group),'.annotation-topic-section:last-of-type .annotation-item-input');
 }
 function select(index){
  active=Math.max(0,Math.min(index,model.topics.length-1));const topic=model.topics[active];renderNav();
  const titleRow=el('div','annotation-topic-title-row');
  titleRow.append(editText(el('h3','annotation-topic-title',topic.title),topic,'title',null,'Tab 名称','输入 Tab 名称',renderNav));
  if(editable&&model.topics.length>1)titleRow.append(action('删除 Tab',()=>{
   if(topic.groups.some(g=>g.items.length)&&!doc.defaultView.confirm('删除这个 Tab 及其中内容？保存前可撤销。'))return;
   mutate(()=>{model.topics.splice(active,1);active=Math.min(active,model.topics.length-1);});
  },'annotation-remove-button'));
  content.replaceChildren(titleRow);
  if(topic.summary)content.append(editText(el('p','annotation-topic-summary',topic.summary),topic,'summary',topic.summaryRange,'主题概述'));
  if(!topic.groups.length)content.append(el('p','annotation-topic-empty',editable?'选择一种形式，开始填写。':'暂无内容'));
  for(const [groupIndex,group] of topic.groups.entries()){
   const section=el('section','annotation-topic-section');section.setAttribute('aria-label',group.title||'内容');
   const groupHeading=el('div','annotation-group-heading');
   groupHeading.append(editText(el('h4','',group.title),group,'title',null,'分组名称：'+group.title,'输入标题'));
   if(editable)groupHeading.append(action('删除',()=>mutate(()=>topic.groups.splice(groupIndex,1)),'annotation-remove-button'));
   section.append(groupHeading);
   if(group.kind==='rules'){
    if(!group.columns)group.columns=[group.items.some(i=>i.label)?'字段':'条目','规则'];
    for(const [i,item] of group.items.entries())if(!item.cells){item.cells=[item.label||'规则 '+(i+1),item.text];item.cellRanges=[item.labelRange,item.textRange];}
    const scroller=el('div','annotation-table-scroll'),table=el('table','annotation-rule-table'),thead=el('thead'),tr=el('tr');
    group.columns.forEach((name,col)=>{
     const th=el('th');th.scope='col';
     th.append(editText(el('span','annotation-column-input',name),group.columns,col,group.columnRanges?.[col],'列名称：'+(col+1),'列名称'));
     if(editable&&col>1){const remove=action('×',()=>mutate(()=>{group.columns.splice(col,1);group.columnRanges?.splice(col,1);for(const item of group.items){item.cells.splice(col,1);item.cellRanges?.splice(col,1);}}),'annotation-cell-remove');remove.setAttribute('aria-label','删除第'+(col+1)+'列');th.append(remove);}
     tr.append(th);
    });
    if(editable)tr.append(el('th','annotation-row-tools'));
    thead.append(tr);table.append(thead);const tbody=el('tbody');
    group.items.forEach((item,i)=>{
     const row=el('tr');
     group.columns.forEach((_,col)=>{
      const label=col===0?'字段名称：'+item.cells[0]:col===1?group.title+'：'+(item.cells[0]||'规则 '+(i+1)):group.columns[col]+'：第'+(i+1)+'行';
      const cell=el('td');cell.append(editText(el('div','annotation-item-input',item.cells[col]||''),item.cells,col,item.cellRanges?.[col],label,col===0?'填写名称':'填写内容'));row.append(cell);
     });
     if(editable){const td=el('td','annotation-row-tools'),remove=action('×',()=>mutate(()=>group.items.splice(i,1)),'annotation-cell-remove');remove.setAttribute('aria-label','删除第'+(i+1)+'行');td.append(remove);row.append(td);}
     tbody.append(row);
    });table.append(tbody);scroller.append(table);section.append(scroller);
    if(editable){
     const controls=el('div','annotation-inline-actions');
     controls.append(action('＋ 新增行',()=>{mutate(()=>group.items.push({cells:group.columns.map(()=>'')}));focus(content.querySelectorAll('.annotation-topic-section')[groupIndex].querySelector('tbody tr:last-child .annotation-item-input'));}),
      action('＋ 新增列',()=>{mutate(()=>{group.columns.push('新列');for(const item of group.items)item.cells.push('');});focus(content.querySelectorAll('.annotation-topic-section')[groupIndex].querySelectorAll('.annotation-column-input')[group.columns.length-1],true);}));section.append(controls);
    }
   }else{
    const list=el(group.kind==='paragraph'?'div':'ul',group.kind==='paragraph'?'annotation-paragraphs':group.kind==='note'?'annotation-topic-notes':'');
    group.items.forEach((item,i)=>{
     const row=el(group.kind==='paragraph'?'div':'li','annotation-text-row');
     row.append(editText(el('div','annotation-item-input',item.text),item,'text',item.textRange,group.title+'：第'+(i+1)+'条',group.kind==='paragraph'?'输入文字…':'输入列表内容…'));
     if(editable){const remove=action('×',()=>mutate(()=>group.items.splice(i,1)),'annotation-cell-remove');remove.setAttribute('aria-label','删除第'+(i+1)+'条');row.append(remove);}
     list.append(row);
    });section.append(list);
    if(editable)section.append(action(group.kind==='paragraph'?'＋ 添加一段':'＋ 添加一条',()=>{mutate(()=>group.items.push({text:''}));focus(content.querySelectorAll('.annotation-topic-section')[groupIndex].querySelector('.annotation-text-row:last-child .annotation-item-input'));}));
   }
   content.append(section);
  }
  if(editable){
   const picker=el('div','annotation-content-picker');picker.append(el('span','','添加内容'),action('文字',()=>addGroup('paragraph')),action('列表',()=>addGroup('list')),action('表格',()=>addGroup('rules')));content.append(picker);
  }
  prev.textContent=active?'上一主题：'+model.topics[active-1].title:'已是第一主题';next.textContent=active<model.topics.length-1?'下一主题：'+model.topics[active+1].title:'已是最后主题';
  updateControls();
 }
 body.append(nav,content);dialog.append(header,body,footer);
 if(host){doc.body.append(shade,dragShield);host.append(dialog,divider);applyLayout();layoutObserver=new win.ResizeObserver(applyLayout);layoutObserver.observe(host);win.addEventListener('resize',applyLayout);}
 else doc.body.append(dialog);
 select(0);
 dialog.addEventListener('close',()=>{
  if(host){
   finishDrag();layoutObserver.disconnect();win.removeEventListener('resize',applyLayout);win.removeEventListener('beforeunload',protectDraft);doc.removeEventListener('selectionchange',rememberSelection);win.cancelAnimationFrame(restoreFrame);
   host.classList.remove('note-reader-open','note-reader-comparing');
   if(oldWidth)host.style.setProperty('--note-panel-width',oldWidth);else host.style.removeProperty('--note-panel-width');
   host.style.removeProperty('--note-panel-top');shade.remove();dragShield.remove();divider.remove();
  }
  dialog.remove();if(opener?.isConnected)opener.focus({preventScroll:true});
 },{once:true});
 dialog.addEventListener('keydown',event=>{
  event.stopPropagation();
  if(host&&event.key==='Escape'){event.preventDefault();requestClose();}
  if(host&&dialog.classList.contains('is-expanded')&&event.key==='Tab'){
   const nodes=[...dialog.querySelectorAll('button:not(:disabled),[contenteditable="plaintext-only"],select,input,textarea')].filter(node=>node.getClientRects().length);
   if(event.shiftKey&&doc.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}
   else if(!event.shiftKey&&doc.activeElement===nodes.at(-1)){event.preventDefault();nodes[0]?.focus();}
  }
  if(editable&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();persist();}
 });
 if(host){dialog.show();close.focus({preventScroll:true});}else dialog.showModal();return dialog;
}
