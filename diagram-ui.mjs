import {readAIEvents} from './ai-stream.mjs';
import {normalizeDiagramDocument} from './diagram-presentation.mjs';
// Shared generation workspace for inline diagrams and standalone explanations.
export function installDiagramUI({endpoint,getContext,insert,notify=()=>{},onBusyChange=()=>{},onAnnotationSaved=()=>{}}){
 const dialog=document.createElement('dialog');dialog.id='diagram-dialog';dialog.className='diagram-dialog';
 dialog.setAttribute('aria-labelledby','diagram-heading');
 dialog.innerHTML=`<header class="diagram-head"><div><span class="diagram-eyebrow">AI 图解</span><h2 id="diagram-heading">把业务逻辑讲清楚</h2></div><button type="button" data-action="close" aria-label="关闭图解工作区">×</button></header>
 <div class="diagram-workspace"><div class="diagram-controls">
 <label>输出形式<select id="diagram-mode"><option value="component">图解组件 · 插入当前页面</option><option value="document">业务逻辑说明页 · 独立保存</option></select></label>
 <label>主要图型<select id="diagram-type"><option value="flowchart">流程图</option><option value="swimlane">泳道图</option><option value="architecture">架构图</option><option value="sequence">时序图</option></select></label>
 <p id="diagram-scope" class="diagram-help"></p>
 <label for="diagram-request">描述内容或修改意见</label><textarea id="diagram-request" maxlength="12000" placeholder="例如：梳理员工学习流程，区分日常学习和闯关计划，标出完成条件与待确认规则。"></textarea>
 <p class="diagram-help">参考已保存源码、逻辑说明与已确认需求。当前选区或说明也会随请求提供；页面有未保存修改时，先保存可获得更完整的依据。</p>
 <button type="button" class="primary" data-action="generate">生成预览</button>
 <p id="diagram-status" role="status" aria-live="polite"></p>
 </div><div class="diagram-output"><div id="diagram-empty"><span aria-hidden="true">◇ → ◇</span><h3>先梳理，再成图</h3><p>组件解释局部流程；说明页用总览、关键流程、规则和待确认事项讲清整个业务。</p></div><section id="diagram-progress" class="diagram-progress" hidden aria-labelledby="diagram-progress-heading"><div class="diagram-progress-heading"><span class="diagram-spinner" aria-hidden="true"></span><h3 id="diagram-progress-heading">正在梳理业务与绘制图解</h3><span id="diagram-elapsed"></span></div><p id="diagram-phase" role="status" aria-live="polite"></p><p id="diagram-output-count"></p><div id="diagram-summary" class="diagram-summary"></div><p class="diagram-help">可以关闭窗口继续操作，稍后点击顶部“业务逻辑图”查看进度和结果。</p></section><div id="diagram-preview-pane" class="diagram-preview-pane" hidden><div class="diagram-preview-tools" role="group" aria-label="图解查看方式"><button id="diagram-fit-width" type="button" aria-pressed="true">适合宽度</button><button id="diagram-fit-page" type="button" aria-pressed="false">整页总览</button><div class="diagram-zoom"><button id="diagram-zoom-out" type="button" aria-label="缩小图解">−</button><output id="diagram-zoom-label" aria-live="polite">100%</output><button id="diagram-zoom-in" type="button" aria-label="放大图解">+</button></div><button id="diagram-view-fullscreen" type="button" hidden>全屏查看</button><button id="diagram-expand" type="button" aria-pressed="false">全屏查看</button></div><div id="diagram-preview-stage" class="diagram-preview-stage"><div id="diagram-preview-canvas"><iframe id="diagram-preview" title="图解生成预览" sandbox="allow-same-origin"></iframe></div></div></div></div></div>
 <footer class="diagram-footer"><span id="diagram-result-hint">生成后先预览，再采用。</span><div><button type="button" data-action="new">新建</button><a id="diagram-open" target="_blank" rel="noopener" hidden>打开说明页</a><button type="button" data-action="download" disabled>下载 HTML</button><button type="button" data-action="apply" class="primary" disabled>插入当前页面</button></div></footer>`;
 document.body.append(dialog);
 const divider=document.createElement('div');divider.className='diagram-comparison-divider';
 divider.setAttribute('role','separator');divider.setAttribute('aria-label','调整原页面与图解宽度');
 divider.setAttribute('aria-orientation','vertical');divider.tabIndex=0;divider.title='左右拖动，调整原页面和图解的宽度';
 document.body.append(divider);
 let comparisonRatio=.5;
 function sizeComparison(width){
  const available=Math.max(1,window.innerWidth-24);
  const minimum=Math.min(320,available*.3),maximum=available-minimum;
  const next=Math.max(minimum,Math.min(maximum,width??available*comparisonRatio));
  comparisonRatio=next/available;
  document.body.style.setProperty('--diagram-dock-width',next+'px');
  divider.style.top=dialog.style.getPropertyValue('--diagram-dock-top')||'120px';
  divider.setAttribute('aria-valuemin',String(Math.round(minimum/available*100)));
  divider.setAttribute('aria-valuemax',String(Math.round(maximum/available*100)));
  divider.setAttribute('aria-valuenow',String(Math.round(comparisonRatio*100)));
  divider.setAttribute('aria-valuetext','图解占 '+Math.round(comparisonRatio*100)+'%');
 }
 divider.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  event.preventDefault();divider.focus();divider.setPointerCapture(event.pointerId);
  document.body.classList.add('is-diagram-resizing');
 });
 divider.addEventListener('pointermove',event=>{
  if(!divider.hasPointerCapture(event.pointerId))return;
  sizeComparison(window.innerWidth-event.clientX-18);
 });
 const stopResizing=()=>document.body.classList.remove('is-diagram-resizing');
 for(const type of ['pointerup','pointercancel','lostpointercapture'])divider.addEventListener(type,stopResizing);
 dialog.addEventListener('close',stopResizing);
 divider.addEventListener('keydown',event=>{
  const available=Math.max(1,window.innerWidth-24);
  let width=available*comparisonRatio;
  if(event.key==='ArrowLeft')width+=32;else if(event.key==='ArrowRight')width-=32;
  else if(event.key==='Home')width=0;else if(event.key==='End')width=available;else return;
  event.preventDefault();sizeComparison(width);
 });
 window.addEventListener('resize',()=>sizeComparison());

 const $=s=>dialog.querySelector(s),mode=$('#diagram-mode'),type=$('#diagram-type'),request=$('#diagram-request'),status=$('#diagram-status'),preview=$('#diagram-preview');
 const generate=$('[data-action="generate"]'),apply=$('[data-action="apply"]'),download=$('[data-action="download"]'),openLink=$('#diagram-open');
 const progress=$('#diagram-progress'),phase=$('#diagram-phase'),summary=$('#diagram-summary'),outputCount=$('#diagram-output-count');
 const previewPane=$('#diagram-preview-pane'),stage=$('#diagram-preview-stage'),canvas=$('#diagram-preview-canvas');
 let fitMode='width',zoom=1,layoutFrame=0;
 function resetPreviewZoom(){fitMode='width';zoom=1;$('#diagram-zoom-label').textContent='100%';$('#diagram-fit-width').setAttribute('aria-pressed','true');$('#diagram-fit-page').setAttribute('aria-pressed','false');stage.scrollTo(0,0);}
 function layoutPreview(){
  const doc=preview.contentDocument;if(previewPane.hidden||!dialog.open||!doc?.querySelector('[data-editor-component="diagram"]'))return;
  const width=Math.max(240,stage.clientWidth-32);preview.style.width=width+'px';preview.style.height='1px';
  const height=Math.ceil(Math.max(doc.body.scrollHeight,doc.documentElement.scrollHeight));
  if(fitMode==='width')zoom=1;else if(fitMode==='page')zoom=Math.min(1,(stage.clientHeight-32)/height);
  preview.style.height=height+'px';preview.style.transform=`scale(${zoom})`;canvas.style.width=width*zoom+'px';canvas.style.height=height*zoom+'px';
  $('#diagram-zoom-label').textContent=Math.round(zoom*100)+'%';
  $('#diagram-fit-width').setAttribute('aria-pressed',String(fitMode==='width'));$('#diagram-fit-page').setAttribute('aria-pressed',String(fitMode==='page'));
 }
 function scheduleLayout(){cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(layoutPreview);}
 preview.onload=()=>{if(preview.contentDocument){normalizeDiagramDocument(preview.contentDocument);scheduleLayout();}};
 new ResizeObserver(scheduleLayout).observe(stage);
 $('#diagram-fit-width').onclick=()=>{fitMode='width';stage.scrollTo(0,0);scheduleLayout();};
 $('#diagram-fit-page').onclick=()=>{fitMode='page';stage.scrollTo(0,0);scheduleLayout();};
 for(const [id,delta]of [['diagram-zoom-out',-.2],['diagram-zoom-in',.2]])$('#'+id).onclick=()=>{fitMode='manual';zoom=Math.max(.1,Math.min(3,zoom+delta));scheduleLayout();};
 $('#diagram-view-fullscreen').onclick=()=>{const expanded=dialog.classList.toggle('is-viewer-fullscreen');$('#diagram-view-fullscreen').textContent=expanded?'返回对照':'全屏查看';scheduleLayout();};
 $('#diagram-expand').onclick=()=>{if(dialog.classList.contains('is-docked')){dialog.classList.remove('is-docked','is-viewer-fullscreen');dialog.close();dialog.showModal();$('#diagram-view-fullscreen').hidden=true;}const expanded=dialog.classList.toggle('is-preview-expanded');$('#diagram-expand').textContent=expanded?(context?.annotationId?'修改图解':'退出全屏'):'全屏查看';$('#diagram-expand').setAttribute('aria-pressed',String(expanded));scheduleLayout();};
 let candidate=null,busy=false,context=null,initial='',applied=false,opener=null;
 function render(){
  onBusyChange(busy);
  mode.disabled=type.disabled=busy;request.disabled=busy;generate.disabled=busy;$('[data-action="new"]').disabled=busy;
  apply.disabled=download.disabled=busy||!candidate;apply.disabled ||= applied;
  generate.textContent=candidate||initial?'按意见修改预览':'生成预览';
  const linked=Boolean(context?.annotationId);
  $('#diagram-view-fullscreen').hidden=!dialog.classList.contains('is-docked');
  mode.closest('label').hidden=linked;$('[data-action="new"]').hidden=linked;apply.hidden=linked&&applied;
  apply.textContent=linked?'保存业务图解':mode.value==='document'?'保存说明页':context?.target?'替换选中图解':'插入当前页面';
  $('#diagram-scope').textContent=linked?'生成完成后自动保存到当前逻辑说明，点击“查看业务图解”可放大查看。':mode.value==='document'?'生成独立说明页，不改动原型。保存后可打开编辑器继续编辑和分享。':context?.target?'更新选中图解，保留当前位置；采用后可撤销。':'插入所选容器或所选元素之后；采用后可移动、调整大小和撤销。';
  $('#diagram-expand').textContent=dialog.classList.contains('is-preview-expanded')?(linked?'修改图解':'退出全屏'):'全屏查看';
 }
 function resetResult(){candidate=null;applied=false;initial='';previewPane.hidden=true;preview.removeAttribute('srcdoc');resetPreviewZoom();dialog.classList.remove('is-preview-expanded','is-docked','is-viewer-fullscreen');$('#diagram-expand').textContent='全屏查看';$('#diagram-expand').setAttribute('aria-pressed','false');progress.hidden=true;$('#diagram-empty').hidden=false;openLink.hidden=true;status.textContent='';$('#diagram-result-hint').textContent='生成后先预览，再采用。';render();}
 mode.onchange=()=>{context=getContext({});resetResult();};
 type.onchange=()=>{const previous=candidate?.html||initial;resetResult();initial=previous;render();};
 $('[data-action="new"]').onclick=()=>open({mode:mode.value});
 async function post(path,body){const response=await fetch(endpoint(path),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||'操作失败，请重试');return value;}
 async function saveAnnotationDiagram(){
  const result=await post('/api/diagrams/save',{id:candidate.id,annotationId:context.annotationId});
  applied=true;context.savedDiagram=result.diagram;onAnnotationSaved(context.annotationId,result.diagram);
  status.textContent='已保存到当前逻辑说明，可点击“查看业务图解”放大查看，也可填写修改意见继续调整。';
  $('#diagram-result-hint').textContent='图解已关联当前逻辑说明';
  notify('业务图解已保存，可在对应逻辑说明中查看');
 }
 async function generatePreview(body){
  const response=await fetch(endpoint('/api/diagrams/generate'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,stream:true})});
  if(!response.ok){const value=await response.json();throw new Error(value.error||'生成失败，请重试');}
  if(!response.headers.get('content-type')?.includes('text/event-stream'))return response.json();
  let result;
  await readAIEvents(response,event=>{
   if(event.type==='error')throw new Error(event.message||'生成失败，请重试');
   if(event.type==='phase')phase.textContent=event.message;
   if(event.type==='summary'){summary.textContent=event.text;phase.textContent='正在输出业务梳理并绘制图解。';}
   if(event.type==='output')outputCount.textContent=`已接收 ${event.characters.toLocaleString()} 字符，图解仍在生成中。`;
   if(event.type==='result')result=event.result;
  });
  if(!result)throw new Error('生成连接已中断，未收到完整图解，请重试');
  return result;
 }
 generate.onclick=async()=>{
  if(busy)return;if(!request.value.trim()){status.textContent='请先填写要表达的业务或修改意见。';request.focus();return;}
  busy=true;status.textContent='正在梳理业务并绘制图解，完成前可关闭窗口，稍后回来查看。';render();
  progress.hidden=false;progress.setAttribute('aria-busy','true');progress.classList.remove('is-error');progress.querySelector('.diagram-spinner').hidden=false;$('#diagram-progress-heading').textContent='正在梳理业务与绘制图解';
  previewPane.hidden=true;$('#diagram-empty').hidden=true;phase.textContent='正在准备业务资料。';summary.textContent='';outputCount.textContent='模型输出后将在这里实时展示业务梳理。';
  const started=Date.now(),updateElapsed=()=>{$('#diagram-elapsed').textContent=`已用时 ${Math.floor((Date.now()-started)/1000)} 秒`;};updateElapsed();const timer=setInterval(updateElapsed,1000);
  try{
   const result=await generatePreview({mode:mode.value,type:type.value,request:request.value.trim(),current:candidate?.html||initial,context:context?.text||''});
   candidate=result;applied=false;openLink.hidden=true;resetPreviewZoom();preview.srcdoc=result.html;previewPane.hidden=false;stage.scrollTo(0,0);$('#diagram-empty').hidden=true;
   progress.hidden=true;
   status.textContent='预览已生成，可填写修改意见继续调整。'+(result.warnings?.length?' '+result.warnings.join('；'):'');
   $('#diagram-result-hint').textContent=result.title||'核对图中业务规则后采用。';
   if(context?.annotationId){
    try{await saveAnnotationDiagram();}
    catch(error){status.textContent='图解已生成，但保存失败：'+error.message+'。请点击“保存业务图解”重试。';}
   }
  }catch(error){status.textContent=error.message+(candidate?'；上次预览仍保留。':'');phase.textContent=error.message;$('#diagram-progress-heading').textContent='本次生成未完成';progress.classList.add('is-error');if(candidate){previewPane.hidden=false;progress.hidden=true;scheduleLayout();}}
  finally{clearInterval(timer);updateElapsed();progress.setAttribute('aria-busy','false');progress.querySelector('.diagram-spinner').hidden=true;busy=false;render();}
 };
 apply.onclick=async()=>{
  if(!candidate||busy||applied)return;busy=true;render();
  try{
   if(context?.annotationId){await saveAnnotationDiagram();}
   else if(mode.value==='document'){
    const result=await post('/api/diagrams/save',{id:candidate.id});applied=true;
    openLink.href=result.editorUrl||result.url;openLink.hidden=false;
    status.textContent='已保存为 '+result.entry+'。打开后可继续编辑，并使用“局域网分享”。';notify('业务逻辑说明页已保存');
   }else{
    await insert(candidate.component,context);applied=true;dialog.close();notify('图解已加入编辑草稿，可撤销；点击“保存到项目”写入源码。');
   }
  }catch(error){status.textContent=error.message;}
  finally{busy=false;render();}
 };
 download.onclick=()=>{if(!candidate)return;const url=URL.createObjectURL(new Blob([candidate.html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=(candidate.title||'业务图解').replace(/[\\/:*?"<>|]/g,'-').slice(0,80)+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('[data-action="close"]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>opener?.focus());
 function showWorkspace(){
  const top=document.querySelector('.editor-main')?.getBoundingClientRect().top||12;
  dialog.style.setProperty('--diagram-dock-top',Math.max(12,top)+'px');
  sizeComparison();
  if(dialog.classList.contains('is-docked'))dialog.show();else dialog.showModal();
 }
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.classList.contains('is-docked')){event.preventDefault();event.stopPropagation();dialog.close();}});
 function open(options={}){
  if(busy&&options.annotationId&&options.annotationId!==context?.annotationId){notify('另一张图解正在生成，请完成后再打开这条说明的图解');return;}
  opener=document.activeElement;
  // Reopening while a request runs must retain that request's target and context.
  if(!busy){
   context=getContext(options);mode.value=options.mode||'document';resetResult();initial=context.current||'';request.value=options.request||'';
   if(context.savedDiagram){
    candidate=context.savedDiagram;applied=true;type.value=candidate.type||'flowchart';initial=candidate.html;
    preview.srcdoc=candidate.html;previewPane.hidden=false;$('#diagram-empty').hidden=true;
    dialog.classList.add('is-preview-expanded','is-docked');$('#diagram-view-fullscreen').textContent='全屏查看';$('#diagram-expand').setAttribute('aria-pressed','true');
    status.textContent='图解已保存到当前逻辑说明。';$('#diagram-result-hint').textContent=candidate.title;
   }
   render();
  }
  $('#diagram-heading').textContent=context?.annotationId?'业务图解':'把业务逻辑讲清楚';
  if(!dialog.open){resetPreviewZoom();showWorkspace();}if(!busy)request.focus();
  if(context?.savedDiagram)$('#diagram-fit-width').focus();scheduleLayout();
 }
 // Keep a completed or in-flight draft when reopening from the main entry.
 function resume(options={}){if((candidate||busy||!progress.hidden)&&!options.fresh){opener=document.activeElement;if(!dialog.open){resetPreviewZoom();showWorkspace();}render();scheduleLayout();}else open(options);}
 return {open,resume};
}
