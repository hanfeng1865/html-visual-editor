import {normalizeDiagramDocument} from './diagram-presentation.mjs';

// A read-only viewer shared with LAN guests; it has no editor or generation actions.
export function openDiagramReader({diagram,opener}){
 const doc=opener.ownerDocument,win=doc.defaultView;
 const dialog=doc.createElement('dialog');dialog.className='diagram-dialog is-preview-expanded';
 dialog.setAttribute('aria-label','业务图解');
 dialog.innerHTML='<header class="diagram-head"><div><span class="diagram-eyebrow">AI 图解 · 只读</span><h2></h2></div><button type="button" aria-label="关闭业务图解">×</button></header><div class="diagram-workspace"><div class="diagram-output"><div class="diagram-preview-pane"><div class="diagram-preview-tools" role="group" aria-label="图解查看方式"><button type="button" data-fit="width" aria-pressed="true">适合宽度</button><button type="button" data-fit="page" aria-pressed="false">整页总览</button><div class="diagram-zoom"><button type="button" data-zoom="out" aria-label="缩小图解">−</button><output aria-live="polite">100%</output><button type="button" data-zoom="in" aria-label="放大图解">+</button></div></div><div class="diagram-preview-stage"><div id="diagram-preview-canvas"><iframe id="diagram-preview" title="业务图解预览" sandbox="allow-same-origin"></iframe></div></div></div></div></div>';
 const $=s=>dialog.querySelector(s),stage=$('.diagram-preview-stage'),canvas=$('#diagram-preview-canvas'),preview=$('iframe');
 $('h2').textContent=diagram.title||'业务图解';
 let fit='width',zoom=1,scheduled=0;
 function layout(){
  const content=preview.contentDocument;if(!dialog.open||!content?.querySelector('[data-editor-component="diagram"]'))return;
  const width=Math.max(240,stage.clientWidth-32);preview.style.width=width+'px';preview.style.height='1px';
  const height=Math.ceil(Math.max(content.body.scrollHeight,content.documentElement.scrollHeight));
  if(fit==='width')zoom=1;else if(fit==='page')zoom=Math.min(1,(stage.clientHeight-32)/height);
  preview.style.height=height+'px';preview.style.transform=`scale(${zoom})`;canvas.style.width=width*zoom+'px';canvas.style.height=height*zoom+'px';
  $('output').textContent=Math.round(zoom*100)+'%';
  for(const button of dialog.querySelectorAll('[data-fit]'))button.setAttribute('aria-pressed',String(fit===button.dataset.fit));
 }
 const schedule=()=>{win.cancelAnimationFrame(scheduled);scheduled=win.requestAnimationFrame(layout);};
 preview.onload=()=>{if(preview.contentDocument)normalizeDiagramDocument(preview.contentDocument);schedule();};
 for(const button of dialog.querySelectorAll('[data-fit]'))button.onclick=()=>{fit=button.dataset.fit;stage.scrollTo(0,0);schedule();};
 for(const button of dialog.querySelectorAll('[data-zoom]'))button.onclick=()=>{fit='manual';zoom=Math.max(.1,Math.min(3,zoom+(button.dataset.zoom==='in'?.2:-.2)));schedule();};
 $('.diagram-head button').onclick=()=>dialog.close();
 const observer=new win.ResizeObserver(schedule);observer.observe(stage);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 dialog.addEventListener('close',()=>{observer.disconnect();win.cancelAnimationFrame(scheduled);dialog.remove();if(opener.isConnected)opener.focus({preventScroll:true});},{once:true});
 doc.body.append(dialog);dialog.showModal();preview.srcdoc=diagram.html;schedule();return dialog;
}
