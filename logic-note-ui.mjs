// Format plain text only; saved notes remain editable as their original text.
export function renderLogicNote(element,value){
 const doc=element.ownerDocument;
 element.replaceChildren();
 const lines=String(value).split(/\r?\n/).filter(line=>line.trim());
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
export function mountLogicNoteAI({key,card,editor,textarea,note,edit,cancel,save,generate,onLayoutChange}){
 let state=drafts.get(key);
 if(!state){state={text:textarea.value,editing:false,busy:false,result:'',error:''};drafts.set(key,state);}
 const row=document.createElement('div');row.className='annotation-card-actions annotation-ai-actions';
 const button=(label,fn)=>{const el=document.createElement('button');el.type='button';el.textContent=label;el.onclick=event=>{event.stopPropagation();fn();};return el;};
 const fold=button('放大查看',()=>{
  const dialog=document.createElement('dialog');dialog.className='annotation-reader';
  const title=document.createElement('h2');title.textContent=(card.querySelector('.annotation-card-title > span')?.textContent||'逻辑说明')+' · 完整说明';
  title.id='annotation-reader-title';dialog.setAttribute('aria-labelledby',title.id);
  const header=document.createElement('div');header.className='annotation-reader-header';
  const close=button('关闭',()=>dialog.close());close.autofocus=true;header.append(title,close);
  const content=document.createElement('div');content.className='annotation-reader-content';renderLogicNote(content,note.textContent);
  dialog.append(header,content);document.body.append(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();if(fold.isConnected)fold.focus({preventScroll:true});},{once:true});
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.showModal();
 });
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
 const use=button('采用草稿',()=>{state.text=state.result;state.result='';state.editing=true;render();textarea.focus();});
 const discard=button('放弃草稿',()=>{state.result='';render();});controls.append(discard,use);preview.append(heading,result,controls);
 async function run(mode){
  if(state.busy)return;
  state.text=textarea.value;
  if(mode==='polish'&&!state.text.trim()){state.error='请先填写说明，再进行润色';state.editing=true;render();textarea.focus();return;}
  state.busy=true;state.error='';state.result='';render();
  try{const value=await generate(mode,state.text);state.result=value.content;}
  catch(error){state.error=error.message;}
  finally{state.busy=false;state.render?.();}
 }
 const generateButton=button('AI 生成说明',()=>run('generate'));
 const polishButton=button('AI 润色',()=>run('polish'));
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
  preview.hidden=!state.result;renderLogicNote(result,state.result);
  status.textContent=state.busy?'正在结合代码与界面分析…':state.error||(state.result?'采用后可继续编辑，保存说明后生效。':'');status.hidden=!status.textContent;
  requestAnimationFrame(()=>{fitEditor();measureNote();onLayoutChange?.();});
 }
 state.render=()=>{if(card.isConnected)render();};
 textarea.addEventListener('input',()=>{state.text=textarea.value;fitEditor();});
 edit.addEventListener('click',()=>{state.editing=true;render();});
 cancel.addEventListener('click',()=>{state.text=textarea.value;state.editing=false;state.result='';state.error='';render();});
 // Capture runs before the save handler rebuilds the card.
 save.addEventListener('click',()=>{drafts.delete(key);},{capture:true});
 card.append(row,status,preview);render();
}
