export function createAIAttachments({getSelected,getDocument,contextFor,onChange,onError,onRegionStart}) {
  const input=document.getElementById('ai-chat-input'),file=document.getElementById('ai-image-file'),upload=document.getElementById('ai-image-upload'),list=document.getElementById('ai-images');
  const selectedButton=document.getElementById('ai-attach-selection'),regionButton=document.getElementById('ai-attach-region'),selectionBox=document.getElementById('ai-selection-context'),summary=document.getElementById('ai-selection-summary'),clearSelection=document.getElementById('ai-selection-clear');
  let images=[],selection=null,busy=false,reading=0,cancelRegion=null;
  function render(){
    list.replaceChildren();list.hidden=!images.length;
    images.forEach((image,index)=>{const card=document.createElement('figure'),preview=document.createElement('img'),name=document.createElement('figcaption'),remove=document.createElement('button');preview.src=image.url;preview.alt=image.name;name.textContent=image.name;remove.type='button';remove.textContent='×';remove.title='移除截图';remove.setAttribute('aria-label','移除截图 '+image.name);remove.disabled=busy;remove.onclick=()=>{images.splice(index,1);render();onChange();};card.append(preview,name,remove);list.append(card);});
    selectionBox.hidden=!selection;
    if(selection)summary.textContent=(selection.kind==='region'?'框选区域':'已引用选区')+' · '+(selection.elements.map(item=>item.label).join('、')||'页面区域');
    [upload,selectedButton,regionButton,clearSelection].forEach(button=>button.disabled=busy || !!reading);
  }
  const dataURL=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取截图失败'));reader.readAsDataURL(blob);});
  async function prepare(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPEG 或 WebP 图片');
    if(file.size>20*1024*1024)throw new Error('原始截图超过 20MB，请缩小后上传');
    const bitmap=await createImageBitmap(file);
    try {
      if(Math.max(bitmap.width,bitmap.height)<=1600 && file.size<=1024*1024)return {name:(file.name||'粘贴截图').slice(0,200),url:await dataURL(file)};
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      let blob;for(const quality of [.85,.7,.5]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob && blob.size<=1024*1024)break;}
      if(!blob || blob.size>1024*1024)throw new Error('压缩后图片仍超过 1MB，请裁剪目标区域后重试');
      return {name:(file.name||'粘贴截图').slice(0,200),url:await dataURL(blob)};
    }finally{bitmap.close();}
  }
  async function addFiles(files){
    if(busy || reading)return;
    const incoming=[...files];reading++;render();onChange();
    try{for(const image of incoming){if(images.length>=3){onError('每次最多附上 3 张截图');break;}try{images.push(await prepare(image));}catch(error){onError('无法添加截图：'+error.message);}}}
    finally{reading--;render();onChange();}
  }
  upload.onclick=()=>{file.value='';file.click();};file.onchange=()=>addFiles(file.files);
  input.addEventListener('paste',event=>{const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file' && item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length && !busy){event.preventDefault();void addFiles(files);}});
  selectedButton.onclick=()=>{const nodes=getSelected().slice(0,8);if(!nodes.length){onError('请先在画布中点击要修改的元素，再引用选区；也可直接框选区域。');return;}selection={kind:'elements',elements:nodes.map(contextFor)};render();onChange();};
  clearSelection.onclick=()=>{selection=null;render();onChange();};
  regionButton.onclick=()=>{
    if(cancelRegion){cancelRegion();return;}
    const doc=getDocument();if(!doc?.body){onError('页面尚未加载，请稍后重试');return;}
    onRegionStart();
    const layer=doc.createElement('div');layer.id='editor-box-selection';Object.assign(layer.style,{position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',touchAction:'none'});
    const box=doc.createElement('div');Object.assign(box.style,{position:'fixed',border:'2px dashed #2468d8',background:'#2468d818',pointerEvents:'none'});layer.append(box);doc.body.append(layer);
    let start=null;
    const cancel=()=>{layer.remove();doc.removeEventListener('keydown',key,true);document.removeEventListener('keydown',key,true);doc.removeEventListener('scroll',cancel,true);regionButton.textContent='框选区域';regionButton.setAttribute('aria-pressed','false');cancelRegion=null;};
    const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}};
    cancelRegion=cancel;regionButton.textContent='取消框选';regionButton.setAttribute('aria-pressed','true');
    doc.addEventListener('keydown',key,true);document.addEventListener('keydown',key,true);doc.addEventListener('scroll',cancel,true);
    layer.onpointerdown=event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY};layer.setPointerCapture(event.pointerId);event.preventDefault();};
    layer.onpointermove=event=>{if(!start)return;Object.assign(box.style,{left:Math.min(start.x,event.clientX)+'px',top:Math.min(start.y,event.clientY)+'px',width:Math.abs(start.x-event.clientX)+'px',height:Math.abs(start.y-event.clientY)+'px'});};
    layer.onpointerup=event=>{
      if(!start)return;const rect={x:Math.min(start.x,event.clientX),y:Math.min(start.y,event.clientY),width:Math.abs(start.x-event.clientX),height:Math.abs(start.y-event.clientY)};
      cancel();event.preventDefault();event.stopPropagation();
      if(rect.width<8 || rect.height<8){onError('请拖出一个有效区域');return;}
      const candidates=[...doc.body.querySelectorAll('*')].slice(0,10000).filter(node=>{
        if(node.closest('script,style,template,[hidden],#editor-change-overlay,[data-ve-locked]') || !node.getClientRects().length)return false;
        if(!node.matches('img,svg,canvas,video,button,input,textarea,select') && node.childElementCount)return false;
        const inside=b=>b.width && b.height && b.left>=rect.x-2 && b.top>=rect.y-2 && b.right<=rect.x+rect.width+2 && b.bottom<=rect.y+rect.height+2;
        if(inside(node.getBoundingClientRect()))return true;
        if(!node.textContent.trim())return false;
        const range=doc.createRange();range.selectNodeContents(node);return [...range.getClientRects()].some(inside);
      }).filter(node=>!node.closest('svg') || node.matches('svg')).slice(0,8);
      selection={kind:'region',rect,elements:candidates.map(contextFor)};render();onChange();input.focus();
    };
    layer.onpointercancel=cancel;
  };
  render();
  return {
    payload:()=>({images:images.map(image=>({...image})),selection}),
    fingerprint:()=>JSON.stringify({images,selection}),
    reading:()=>!!reading,
    setBusy(value){busy=value;if(value)cancelRegion?.();render();},
    cancelRegion(){cancelRegion?.();},
    clear(){images=[];selection=null;cancelRegion?.();render();onChange();},
  };
}
