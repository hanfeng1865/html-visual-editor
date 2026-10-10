const icons={pen:'<path d="m5 19 3-1 12-12a2 2 0 0 0-4-4L4 14l-1 6 5-2"/>',select:'<path d="m5 3 14 9-7 1-3 7z"/>',text:'<path d="M4 5h16M12 5v15M8 20h8"/>',rectangle:'<rect x="4" y="5" width="16" height="14" rx="2"/>',ellipse:'<ellipse cx="12" cy="12" rx="9" ry="7"/>',arrow:'<path d="M4 20 20 4M10 4h10v10"/>',eraser:'<path d="m4 13 9-9a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-9 9H7l-3-4a2 2 0 0 1 0-3zM9 8l7 7"/>',undo:'<path d="m9 4-5 5 5 5M4 9h10a6 6 0 0 1 0 12"/>',redo:'<path d="m15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12"/>',close:'<path d="m5 5 14 14M19 5 5 19"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',table:'<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',button:'<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M8 12h8"/>',input:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 9v6M5 9h4M5 15h4"/>',dropdown:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="m14 10 3 3 3-3M6 12h4"/>',check:'<path d="m5 12 5 5L20 7"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
export function createAISketch({onAttach,onError}) {
 const dialog=document.createElement('dialog');dialog.id='ai-sketch-dialog';dialog.className='ai-sketch-dialog';dialog.setAttribute('aria-label','手绘草图');
 const tools=[['select','选择 / 移动'],['pen','画笔'],['text','文字'],['rectangle','矩形'],['ellipse','椭圆'],['arrow','箭头'],['eraser','橡皮擦'],['image','插入图片'],['table','表格'],['button','按钮'],['input','输入框'],['dropdown','下拉框']];
 const colors=[['#171717','黑色'],['#6b7280','灰色'],['#92400e','棕色'],['#dc2626','红色'],['#f97316','橙色'],['#f59e0b','黄色'],['#16a34a','绿色'],['#0d9488','青绿色'],['#06b6d4','青色'],['#2563eb','蓝色'],['#4f46e5','靛色'],['#9333ea','紫色'],['#db2777','粉色']];
 dialog.innerHTML=`<header class="sketch-header"><button id="ai-sketch-close" class="sketch-icon" type="button" aria-label="关闭手绘画板" title="关闭，保留草稿">${icon('close')}</button><div class="sketch-tools" role="toolbar" aria-label="绘图工具">${tools.map(([name,label])=>`<button type="button" class="sketch-icon" data-sketch-tool="${name}" aria-label="${label}" title="${label}" aria-pressed="${name==='pen'}">${icon(name)}</button>`).join('')}</div><div class="sketch-history"><button id="ai-sketch-undo" class="sketch-icon" type="button" aria-label="撤销手绘" title="撤销 (⌘/Ctrl Z)">${icon('undo')}</button><button id="ai-sketch-redo" class="sketch-icon" type="button" aria-label="重做手绘" title="重做 (⌘/Ctrl Shift Z)">${icon('redo')}</button></div></header><input id="ai-sketch-image" type="file" accept="image/*" multiple hidden><div class="sketch-stage"><canvas id="ai-sketch-canvas" width="1400" height="900" tabindex="0" aria-label="手绘画布"></canvas><textarea id="ai-sketch-text" placeholder="输入文字，⌘/Ctrl + Enter 完成" aria-label="草图文字" hidden></textarea><div id="ai-sketch-selection" class="sketch-selection" hidden><span id="ai-sketch-selection-label"></span><button id="ai-sketch-edit" type="button">编辑内容</button><span id="ai-sketch-table-settings" hidden><label>行 <input id="ai-sketch-table-rows" type="number" min="1" max="20" value="3" aria-label="表格行数"></label><label>列 <input id="ai-sketch-table-cols" type="number" min="1" max="20" value="3" aria-label="表格列数"></label><button id="ai-sketch-table-apply" type="button">调整表格</button></span><button id="ai-sketch-delete" type="button" title="删除选中元素 (Delete / Backspace)">删除</button></div></div><label class="sketch-width"><span>粗细</span><input id="ai-sketch-width" type="range" min="1" max="20" value="3" aria-label="画笔粗细"><output>3</output></label><footer class="sketch-footer"><p id="ai-sketch-hint" role="status">画出你的需求，完成后作为图片附到 AI 修改</p><div class="sketch-colors" role="toolbar" aria-label="画笔颜色"><label class="sketch-custom" title="自定义颜色"><input id="ai-sketch-color" type="color" value="#171717" aria-label="自定义画笔颜色"></label>${colors.map(([color,label])=>`<button type="button" data-sketch-color="${color}" style="--sketch-color:${color}" aria-label="${label}" aria-pressed="${color==='#171717'}" title="${label}"></button>`).join('')}</div><button id="ai-sketch-done" type="button" title="完成并附上草图" aria-label="完成并附上草图">${icon('check')}<span>完成</span></button></footer>`;
 document.body.append(dialog);
 const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d'),stage=dialog.querySelector('.sketch-stage'),text=dialog.querySelector('textarea'),done=dialog.querySelector('#ai-sketch-done'),undo=dialog.querySelector('#ai-sketch-undo'),redo=dialog.querySelector('#ai-sketch-redo'),hint=dialog.querySelector('#ai-sketch-hint');
 const inspector=dialog.querySelector('#ai-sketch-selection'),imageInput=dialog.querySelector('#ai-sketch-image'),images=new Map();
 const componentTypes=['table','button','input','dropdown'];
 let imageSerial=0,reading=0,editing=null;
 let items=[],past=[],future=[],tool='pen',color='#171717',width=3,gesture=null,selected=-1,textPoint=null,attaching=false,returnFocus=null;
 const clone=value=>structuredClone(value);
 const point=event=>{const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};};
 function bounds(item){if(item.w!=null)return {x:item.start.x,y:item.start.y,w:item.w,h:item.h};const points=item.points||[item.start,item.end];const xs=points.map(p=>p.x),ys=points.map(p=>p.y);let x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;if(item.type==='text'){ctx.font=`${item.size}px sans-serif`;w=Math.max(...item.text.split('\n').map(line=>ctx.measureText(line).width));h=item.text.split('\n').length*item.size*1.3;}return {x,y,w,h};}
 function draw(item){
  ctx.save();ctx.strokeStyle=item.color;ctx.fillStyle=item.color;ctx.lineWidth=item.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  if(item.type==='image'){const img=images.get(item.imageId);if(img)ctx.drawImage(img,item.start.x,item.start.y,item.w,item.h);}
  else if(componentTypes.includes(item.type)){
   const {x,y,w,h}=bounds(item);ctx.lineWidth=2;ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
   const size=Math.max(12,Math.min(24,item.type==='table'?h/item.rows*.42:h*.42));ctx.font=`${size}px sans-serif`;ctx.textBaseline='middle';ctx.fillStyle=item.color;
   function label(value,left,top,maxWidth,align='left'){ctx.save();ctx.beginPath();ctx.rect(x+2,y+2,w-4,h-4);ctx.clip();ctx.textAlign=align;ctx.fillText(value,left,top,Math.max(1,maxWidth));ctx.restore();}
   if(item.type==='table'){
    ctx.fillStyle='#f3f4f6';ctx.fillRect(x+1,y+1,w-2,h/item.rows-1);ctx.fillStyle=item.color;
    for(let row=1;row<item.rows;row++){ctx.beginPath();ctx.moveTo(x,y+h*row/item.rows);ctx.lineTo(x+w,y+h*row/item.rows);ctx.stroke();}
    for(let col=1;col<item.cols;col++){ctx.beginPath();ctx.moveTo(x+w*col/item.cols,y);ctx.lineTo(x+w*col/item.cols,y+h);ctx.stroke();}
    for(let row=0;row<item.rows;row++)for(let col=0;col<item.cols;col++)label(item.cells[row]?.[col]||'',x+w*col/item.cols+8,y+h*(row+.5)/item.rows,w/item.cols-16);
   }else if(item.type==='button')label(item.text,x+w/2,y+h/2,w-20,'center');
   else{label(item.type==='dropdown'?(item.options[0]||'请选择'):item.text,x+12,y+h/2,w-(item.type==='dropdown'?46:24));if(item.type==='dropdown'){ctx.beginPath();ctx.moveTo(x+w-27,y+h/2-3);ctx.lineTo(x+w-20,y+h/2+4);ctx.lineTo(x+w-13,y+h/2-3);ctx.stroke();}}
  }
  else if(item.type==='pen'){const [first,...rest]=item.points;ctx.moveTo(first.x,first.y);if(!rest.length){ctx.arc(first.x,first.y,item.width/2,0,Math.PI*2);ctx.fill();}else{rest.forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();}}
  else if(item.type==='text'){ctx.font=`${item.size}px sans-serif`;ctx.textBaseline='top';item.text.split('\n').forEach((line,i)=>ctx.fillText(line,item.start.x,item.start.y+i*item.size*1.3));}
  else {const a=item.start,b=item.end;if(item.type==='rectangle')ctx.rect(a.x,a.y,b.x-a.x,b.y-a.y);else if(item.type==='ellipse')ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2);else {ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);const angle=Math.atan2(b.y-a.y,b.x-a.x),len=Math.max(14,item.width*4);for(const offset of [-Math.PI/6,Math.PI/6]){ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-len*Math.cos(angle+offset),b.y-len*Math.sin(angle+offset));}}ctx.stroke();}
  ctx.restore();
 }
 function handles(item){const b=bounds(item);return [{x:b.x,y:b.y,sx:-1,sy:-1,cursor:'nwse-resize'},{x:b.x+b.w,y:b.y,sx:1,sy:-1,cursor:'nesw-resize'},{x:b.x,y:b.y+b.h,sx:-1,sy:1,cursor:'nesw-resize'},{x:b.x+b.w,y:b.y+b.h,sx:1,sy:1,cursor:'nwse-resize'}];}
 function resizeHandle(p){const item=items[selected];if(tool!=='select'||item?.w==null)return null;const r=canvas.getBoundingClientRect();return handles(item).find(h=>Math.abs(p.x-h.x)<=12*canvas.width/r.width&&Math.abs(p.y-h.y)<=12*canvas.height/r.height);}
 function updateCursor(p){canvas.style.cursor=tool==='select'?(resizeHandle(p)?.cursor||(hit(p)>=0?'move':'default')):tool==='text'?'text':'crosshair';}
 function render(selection=true){
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);items.forEach(draw);
  const item=items[selected];inspector.hidden=!selection||!item;
  if(selection&&item){const b=bounds(item);ctx.save();ctx.strokeStyle='#2563eb';ctx.lineWidth=1.5;ctx.setLineDash([6,5]);ctx.strokeRect(b.x-8,b.y-8,b.w+16,b.h+16);ctx.setLineDash([]);if(item.w!=null){ctx.fillStyle='#fff';const r=canvas.getBoundingClientRect(),hw=12*canvas.width/r.width,hh=12*canvas.height/r.height;for(const h of handles(item)){ctx.fillRect(h.x-hw/2,h.y-hh/2,hw,hh);ctx.strokeRect(h.x-hw/2,h.y-hh/2,hw,hh);}}ctx.restore();
   inspector.dataset.bounds=JSON.stringify(b);dialog.querySelector('#ai-sketch-selection-label').textContent=tools.find(([name])=>name===item.type)?.[1]||'图片';
   dialog.querySelector('#ai-sketch-edit').hidden=!['text',...componentTypes].includes(item.type);
   dialog.querySelector('#ai-sketch-table-settings').hidden=item.type!=='table';
   if(item.type==='table'&&!inspector.contains(document.activeElement)){dialog.querySelector('#ai-sketch-table-rows').value=item.rows;dialog.querySelector('#ai-sketch-table-cols').value=item.cols;}
  }
  undo.disabled=attaching||!past.length;redo.disabled=attaching||!future.length;done.disabled=attaching||reading>0||(!items.length&&!text.value.trim());
 }
 function commit(before){if(JSON.stringify(before)===JSON.stringify(items))return;past.push(before);if(past.length>80)past.shift();future=[];render();}
 function finishText(cancel=false){
  if(!textPoint)return;const before=clone(items),value=text.value.trim();
  if(!cancel){if(editing){const item=items[editing.index];if(item){if(item.type==='table')item.cells[editing.row][editing.col]=value;else if(item.type==='dropdown')item.options=value.split('\n').map(s=>s.trim()).filter(Boolean);else item.text=value;}}
   else if(value)items.push({type:'text',text:value,start:textPoint,end:textPoint,color,width,size:Math.max(24,width*5)});}
  text.hidden=true;textPoint=null;editing=null;text.value='';commit(before);render();
 }
 function startText(p,value='',target=null){
  textPoint=p;editing=target;text.value=value;text.hidden=false;
  text.style.left=`${Math.min(p.x/canvas.width*100,Math.max(0,100-270/stage.clientWidth*100))}%`;text.style.top=`${Math.max(0,Math.min(p.y/canvas.height*100,70))}%`;
  text.placeholder=target&&items[target.index]?.type==='dropdown'?'每行一个选项，第一项为默认值':target&&items[target.index]?.type==='table'?'输入单元格内容':'输入文字，⌘/Ctrl + Enter 完成';text.focus();text.select();
 }
 function editItem(index,p){
  const item=items[index];if(!item||!['text',...componentTypes].includes(item.type))return;
  finishText();selected=index;const b=bounds(item),target={index};let value=item.text||'';
  if(item.type==='table'){target.row=Math.max(0,Math.min(item.rows-1,Math.floor(((p?.y??b.y)-b.y)/b.h*item.rows)));target.col=Math.max(0,Math.min(item.cols-1,Math.floor(((p?.x??b.x)-b.x)/b.w*item.cols)));value=item.cells[target.row][target.col];}
  if(item.type==='dropdown')value=item.options.join('\n');render();startText(p||item.start,value,target);
 }
 function finishGesture(cancel=false){if(!gesture)return;const g=gesture;gesture=null;if(canvas.hasPointerCapture(g.id))canvas.releasePointerCapture(g.id);if(cancel)items=g.before;else commit(g.before);if(!cancel&&componentTypes.includes(tool)){tool='select';canvas.style.cursor='default';dialog.querySelectorAll('[data-sketch-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sketchTool==='select')));hint.textContent='双击编辑内容，拖动四角缩放，Delete / Backspace 删除';}render();}
 function history(back){finishText();finishGesture();const from=back?past:future,to=back?future:past;if(!from.length)return;to.push(clone(items));items=from.pop();selected=-1;render();}
 function hit(p){for(let i=items.length-1;i>=0;i--){const b=bounds(items[i]),pad=Math.max(10,items[i].width);if(p.x>=b.x-pad&&p.x<=b.x+b.w+pad&&p.y>=b.y-pad&&p.y<=b.y+b.h+pad)return i;}return -1;}
 function choose(name){finishText();finishGesture();if(name==='image'){imageInput.click();return;}tool=name;selected=-1;canvas.style.cursor=tool==='select'?'default':tool==='text'?'text':'crosshair';dialog.querySelectorAll('[data-sketch-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sketchTool===name)));hint.textContent=componentTypes.includes(tool)?'点击或拖动画布插入；双击编辑内容，选择后拖动四角缩放':tool==='select'?'拖动移动，拖动四角缩放；双击编辑内容，Delete / Backspace 删除，可粘贴图片':tool==='text'?'点击画布输入文字，⌘/Ctrl + Enter 完成':tool==='eraser'?'点击或拖动，擦除经过的笔画和形状':'画出你的需求，完成后作为图片附到 AI 修改';render();}
 dialog.querySelectorAll('[data-sketch-tool]').forEach(b=>b.onclick=()=>choose(b.dataset.sketchTool));
 function setColor(value){color=value;dialog.querySelector('#ai-sketch-color').value=value;dialog.querySelectorAll('[data-sketch-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sketchColor===value)));}
 dialog.querySelectorAll('[data-sketch-color]').forEach(b=>b.onclick=()=>setColor(b.dataset.sketchColor));dialog.querySelector('#ai-sketch-color').oninput=e=>setColor(e.target.value);
 dialog.querySelector('#ai-sketch-width').oninput=e=>{width=Number(e.target.value);dialog.querySelector('output').value=width;};
 canvas.onpointerdown=event=>{
  if(event.button!==0||gesture||attaching||reading)return;finishText();const p=point(event);event.preventDefault();canvas.focus({preventScroll:true});
  if(tool==='text'){startText(p);return;}
  gesture={before:clone(items),start:p,id:event.pointerId};canvas.setPointerCapture(event.pointerId);
  if(tool==='select'){const handle=resizeHandle(p);if(handle){gesture.index=selected;gesture.resize=handle;}else{selected=hit(p);gesture.index=selected;}updateCursor(p);}
  else if(tool==='eraser'){const index=hit(p);if(index>=0)items.splice(index,1);}
  else{const defaults=tool==='table'?{w:360,h:150,rows:3,cols:3,cells:Array.from({length:3},()=>Array(3).fill(''))}:tool==='button'?{w:160,h:50,text:'按钮'}:tool==='input'?{w:260,h:50,text:'请输入内容'}:tool==='dropdown'?{w:240,h:50,options:['请选择','选项一','选项二']}:{};items.push({type:tool,color,width,start:p,end:p,...defaults,...(tool==='pen'?{points:[p]}:{})});gesture.index=items.length-1;if(componentTypes.includes(tool))selected=gesture.index;}
  render();
 };
 canvas.onpointermove=event=>{const p=point(event);if(!gesture){updateCursor(p);return;}if(gesture.id!==event.pointerId)return;const g=gesture;
  if(tool==='eraser'){const index=hit(p);if(index>=0)items.splice(index,1);}
  else if(tool==='select'&&g.index>=0){const item=clone(g.before[g.index]),dx=p.x-g.start.x,dy=p.y-g.start.y;const move=q=>({x:q.x+dx,y:q.y+dy});if(g.resize){const original=g.before[g.index],{sx,sy}=g.resize;if(item.type==='image'){const ratio=original.h/original.w;item.w=Math.max(20,20/ratio,original.w+(sx*dx+ratio*sy*dy)/(1+ratio*ratio));item.h=item.w*ratio;}else{item.w=Math.max(40,original.w+sx*dx);item.h=Math.max(28,original.h+sy*dy);}if(sx<0)item.start.x=original.start.x+original.w-item.w;if(sy<0)item.start.y=original.start.y+original.h-item.h;}else{if(item.points)item.points=item.points.map(move);item.start=move(item.start);item.end=move(item.end);}items[g.index]=item;}
  else if(tool!=='select'){const item=items[g.index];if(item.w!=null){const dx=p.x-g.start.x,dy=p.y-g.start.y;if(Math.abs(dx)+Math.abs(dy)>8){item.start={x:Math.min(p.x,g.start.x),y:Math.min(p.y,g.start.y)};item.w=Math.max(40,Math.abs(dx));item.h=Math.max(28,Math.abs(dy));}}else{if(item.points)item.points.push(p);item.end=p;}}
  render();
 };
 canvas.onpointerup=event=>{if(gesture?.id===event.pointerId)finishGesture();};canvas.onpointercancel=()=>finishGesture(true);
 canvas.onlostpointercapture=()=>finishGesture();
 text.oninput=()=>{done.disabled=attaching||reading>0||(!items.length&&!text.value.trim());};text.onblur=()=>finishText();text.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();finishText();canvas.focus();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finishText(true);}};
 canvas.ondblclick=event=>{if(attaching)return;finishGesture();editItem(hit(point(event)),point(event));};
 function deleteSelected(){finishText();if(selected<0||attaching)return;const before=clone(items);items.splice(selected,1);selected=-1;commit(before);}
 dialog.querySelector('#ai-sketch-edit').onclick=()=>editItem(selected);
 dialog.querySelector('#ai-sketch-delete').onclick=deleteSelected;
 dialog.querySelector('#ai-sketch-table-apply').onclick=()=>{
  const item=items[selected];if(item?.type!=='table'||attaching)return;
  const rows=Number(dialog.querySelector('#ai-sketch-table-rows').value),cols=Number(dialog.querySelector('#ai-sketch-table-cols').value);
  if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||rows>20||cols<1||cols>20){hint.textContent='表格行列数请输入 1–20 的整数';return;}
  const before=clone(items);item.cells=Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>item.cells[r]?.[c]||''));item.rows=rows;item.cols=cols;commit(before);
 };
 async function addImages(files){
  const imageFiles=Array.from(files).filter(file=>file.type.startsWith('image/'));if(!imageFiles.length||attaching)return;
  finishText();finishGesture();reading++;render();
  try{for(const file of imageFiles){const url=URL.createObjectURL(file),img=new Image();
   try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('图片无法读取，请换一张图片重试'));img.src=url;});}finally{URL.revokeObjectURL(url);}
   const before=clone(items),scale=Math.min(1,canvas.width*.6/img.naturalWidth,canvas.height*.6/img.naturalHeight),w=img.naturalWidth*scale,h=img.naturalHeight*scale,id=++imageSerial;
   images.set(id,img);items.push({type:'image',imageId:id,color,width:2,start:{x:(canvas.width-w)/2,y:(canvas.height-h)/2},end:{x:0,y:0},w,h});
   choose('select');selected=items.length-1;commit(before);hint.textContent='图片已插入：拖动四角等比缩放，Delete / Backspace 删除';if(dialog.open)canvas.focus({preventScroll:true});
  }}catch(error){onError(error.message);}finally{reading--;render();}
 }
 imageInput.onchange=()=>{addImages(imageInput.files);imageInput.value='';};
 dialog.addEventListener('paste',event=>{
  if(event.target.matches('textarea,input,select'))return;
  const files=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
  if(!files.length)return;event.preventDefault();event.stopPropagation();addImages(files);
 });
 undo.onclick=()=>history(true);redo.onclick=()=>history(false);
 function close(){if(attaching)return;finishText();finishGesture();dialog.close();returnFocus?.focus();}
 dialog.querySelector('#ai-sketch-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.target.matches('textarea,input,select')||attaching)return;if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();history(event.key.toLowerCase()==='z'&&!event.shiftKey);}else if(['Delete','Backspace'].includes(event.key)&&selected>=0){event.preventDefault();deleteSelected();}});
 done.onclick=async()=>{finishText();finishGesture();if(!items.length||attaching||reading)return;attaching=true;render(false);try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('无法生成草图');const accepted=await onAttach(new File([blob],`手绘草图-${Date.now()}.png`,{type:'image/png'}));if(!accepted){hint.textContent='草图未添加，请检查附件数量后重试';return;}items=[];past=[];future=[];images.clear();selected=-1;attaching=false;close();}catch(error){onError(error.message);}finally{attaching=false;render();}};
 render();return {open(){returnFocus=document.activeElement;dialog.showModal();if(!items.length){canvas.height=Math.max(1,Math.round(canvas.width*stage.clientHeight/stage.clientWidth));}choose(tool);},close};
}
