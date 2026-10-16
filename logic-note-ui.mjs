import {openLogicNoteReader} from './logic-note-reader.mjs';
import {parseLogicNote} from './logic-note-document.mjs';
// Format plain text only; saved notes remain editable as their original text.
export function renderLogicNote(element,value){
 const doc=element.ownerDocument;
 element.replaceChildren();
 const structured=/^#### (?:文字|列表|表格|提示)：/m.test(String(value));
 const lines=structured?parseLogicNote(value).topics.flatMap(topic=>[topic.title,topic.summary,...topic.groups.flatMap(group=>group.items.map(item=>item.cells?item.cells.filter(Boolean).join(' · '):item.text))]).filter(Boolean):String(value).split(/\r?\n/).filter(line=>line.trim());
 lines.forEach((text,i)=>{
  if(i)element.append(doc.createTextNode('\n'));
  const line=doc.createElement('span');line.className='annotation-note-line';
  const label=/^((?:\d+[.、)]\s*)?[^：:\n]{1,8}[：:])\s*([\s\S]*)$/.exec(text);
  if(label){const strong=doc.createElement('strong');strong.className='annotation-note-label';strong.textContent=label[1];line.append(strong,doc.createTextNode(label[2]));}
  else line.textContent=text;
  element.append(line);
 });
}

// Keep local drafts and in-flight results when canvas scrolling rebuilds the rail.
const drafts=new Map();
export function mountLogicNoteAI({key,card,editor,textarea,note,edit,cancel,save,generate,onLayoutChange,onSaveNote,onNoteSaved,requirementTitle=''}){
 let state=drafts.get(key);
 if(!state){state={text:textarea.value,title:requirementTitle,editing:false,busy:false,result:'',resultTitle:'',error:''};drafts.set(key,state);}
 const row=document.createElement('div');row.className='annotation-card-actions annotation-ai-actions';
 const button=(label,fn)=>{const el=document.createElement('button');el.type='button';el.textContent=label;el.onclick=event=>{event.stopPropagation();fn();};return el;};
 const currentTitle=()=>state.title||textarea.dataset.contextTitle||'需求说明';
 const openEditor=(value=textarea.value,opener=edit,name=currentTitle())=>openLogicNoteReader({text:value,initialSavedText:textarea.value,title:card.dataset.logicLabel||card.querySelector('.annotation-card-title > span')?.textContent||'逻辑说明',context:textarea.dataset.contextTitle||'',requirementTitle:name,initialSavedTitle:currentTitle(),opener,
  onSave:onSaveNote?async(value,name)=>{await onSaveNote(value,name);state.text=value;state.title=name;state.result='';state.resultTitle='';state.error='';textarea.value=value;renderLogicNote(note,value||'尚未填写说明');note.classList.toggle('annotation-card-empty',!value);drafts.delete(key);onNoteSaved?.();}:undefined});
 const editableText=()=>state.mode==='generate'&&state.result?state.result:textarea.value;
 const editableTitle=()=>state.mode==='generate'&&state.result?(state.title||state.resultTitle||currentTitle()):currentTitle();
 const fold=button('放大查看',()=>openEditor(editableText(),fold,editableTitle()));
 fold.className='annotation-note-toggle';fold.hidden=true;
 note.id ||= 'logic-note-'+card.dataset.annotationId;
 fold.setAttribute('aria-haspopup','dialog');
 card.insertBefore(fold,editor);
 function measureNote(){
  if(!card.isConnected||state.editing)return;
  const long=note.scrollHeight>146;
  fold.hidden=!long;

 }
 const status=document.createElement('p');status.className='annotation-ai-status';status.setAttribute('role','status');
 const preview=document.createElement('div');preview.className='annotation-ai-preview';
 const heading=document.createElement('strong');heading.textContent='AI 草稿';
 const result=document.createElement('p');result.className='annotation-card-note';
 const controls=document.createElement('div');controls.className='annotation-card-actions';
 const use=button('采用草稿',()=>openEditor(state.result,use,state.title||state.resultTitle||currentTitle()));
 const discard=button('放弃草稿',()=>{state.result='';render();});controls.append(discard,use);preview.append(heading,result,controls);
 async function run(mode){
  if(state.busy)return;
  state.text=textarea.value;
  if(mode==='polish'&&!state.text.trim()){state.error='请先填写说明，再进行润色';render();openEditor();return;}
  state.mode=mode;state.busy=true;state.error='';state.result='';state.resultTitle='';render();
  try{const value=await generate(mode,state.text);state.result=value.content;state.resultTitle=typeof value.title==='string'?value.title.trim().replace(/[\r\n]+/g,' ').slice(0,60):'';}
  catch(error){state.error=error.message;}
  finally{state.busy=false;state.render?.();}
  if(mode==='generate'&&state.result)state.openGenerated?.();
 }
 const generateButton=button('AI说明',()=>run('generate'));
 const polishButton=button('AI润色',()=>run('polish'));
 // Use the newest mounted card if scrolling rebuilt it while AI was running.
 state.openGenerated=()=>{if(card.isConnected)openEditor(state.result,generateButton,state.title||state.resultTitle||currentTitle());};
 generateButton.title='根据当前页面和业务代码生成说明';
 polishButton.title='仅优化当前文案的表达，保留原意和业务规则';
 row.append(generateButton,polishButton);
 function fitEditor(){
  if(!state.editing||!card.isConnected)return;
  textarea.style.height='auto';
  textarea.style.height=Math.max(260,textarea.scrollHeight+2)+'px';
 }
 function render(){
  card.classList.toggle('is-editing',state.editing);
  note.classList.add('annotation-note-collapsed');
  fold.hidden=state.editing;
  textarea.value=state.text;editor.hidden=!state.editing;note.hidden=state.editing;edit.hidden=state.editing;
  generateButton.disabled=polishButton.disabled=state.busy;
  save.disabled=cancel.disabled=state.busy;
  preview.hidden=!state.result||state.mode==='generate';renderLogicNote(result,state.result);
  heading.textContent=(state.mode==='polish'?'润色草稿':'AI 草稿')+(state.title||state.resultTitle?' · '+(state.title||state.resultTitle):'');
  status.textContent=state.busy?(state.mode==='polish'?'正在润色当前文案…':'正在结合代码与界面分析…'):state.error||(state.result?(state.mode==='generate'?'生成结果待保存，可点击编辑说明继续修改。':'采用后可继续编辑，保存说明后生效。'):'');status.hidden=!status.textContent;
  requestAnimationFrame(()=>{fitEditor();measureNote();onLayoutChange?.();});
 }
 state.render=()=>{if(card.isConnected)render();};
 textarea.addEventListener('input',()=>{state.text=textarea.value;fitEditor();});
 edit.setAttribute('aria-haspopup','dialog');
 edit.addEventListener('click',event=>{event.stopImmediatePropagation();openEditor(editableText(),edit,editableTitle());},{capture:true});
 cancel.addEventListener('click',()=>{state.text=textarea.value;state.editing=false;state.result='';state.error='';render();});
 // Capture runs before the save handler rebuilds the card.
 save.addEventListener('click',()=>{drafts.delete(key);},{capture:true});
 card.append(row,status,preview);render();
}
