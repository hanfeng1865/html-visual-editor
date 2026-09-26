import {interactiveHistorySource} from './history-preview.mjs';

export function comparisonVersions(versions) {
  return [{id:'original',label:'初版副本 · 首次记录的源码'},...versions.slice().sort((a,b)=>a.savedAt.localeCompare(b.savedAt)).map(v=>({...v,label:`${new Date(v.savedAt).toLocaleString('zh-CN')} · ${v.summary||'历史保存'}`}))];
}
export const initialComparisonId=versions=>versions[0]?.id;

export function installVersionComparison({projectId,projectEntry,getPages,getCurrent,commit,getWidth}) {
  const dialog=document.getElementById('comparison-dialog'),select=document.getElementById('comparison-version'),pages=document.getElementById('comparison-page');
  const status=document.getElementById('comparison-status'),oldFrame=document.getElementById('comparison-old'),nowFrame=document.getElementById('comparison-now');
  let versions=[],generation=0,currentEntry=projectEntry;
  const endpoint=(path,entry=currentEntry)=>`${path}?${new URLSearchParams({project:projectId,entry})}`;
  const pageUrl=entry=>new URL(projectId==='builtin'?`/${entry}`:`/project/${projectId}/${entry.split('/').map(encodeURIComponent).join('/')}`,location.href).href;
  async function json(url){const response=await fetch(url,{cache:'no-store'}),value=await response.json();if(!response.ok)throw new Error(value.error||'读取失败');return value;}
  function clean(source){const doc=new DOMParser().parseFromString(source,'text/html');doc.querySelectorAll('#version-v1-link,#version-compare-link').forEach(node=>{node.hidden=true;});return '<!doctype html>'+doc.documentElement.outerHTML;}
  function size(){for(const frame of [oldFrame,nowFrame]){const box=frame.parentElement,width=getWidth(),scale=box.clientWidth/width;if(scale>0)Object.assign(frame.style,{width:`${width}px`,height:`${box.clientHeight/scale}px`,transform:`scale(${scale})`});}}
  new ResizeObserver(size).observe(document.getElementById('comparison-panes'));
  async function render(){
    const token=++generation,version=versions.find(v=>v.id===select.value);if(!version)return;
    status.textContent='正在载入版本…';oldFrame.srcdoc='';nowFrame.srcdoc='';
    try {
      const oldUrl=pageUrl(currentEntry);
      const historical=await json(endpoint('/api/source-history')+`&id=${encodeURIComponent(version.id)}`);
      const latest=await json(endpoint('/api/source-state'));
      const edits=currentEntry===projectEntry?getCurrent():await json(endpoint('/api/visual-edits'));
      if(token!==generation||!dialog.open)return;
      oldFrame.srcdoc=interactiveHistorySource(clean(historical.source),oldUrl,historical.patches,`compare-old-${token}`,historical.assetBase);
      nowFrame.srcdoc=interactiveHistorySource(clean(latest.source),pageUrl(currentEntry),edits.patches,`compare-now-${token}`);
      document.getElementById('comparison-old-label').textContent=version.label;
      status.textContent=`${currentEntry} · 上方是所选历史版本，下方是当前源码${currentEntry===projectEntry?'与编辑器草稿':''}。可以分别切换页内 Tab；查看不会保存或恢复。`;
      size();
    }catch(error){if(token===generation)status.textContent=`无法对比：${error.message}`;}
  }
  async function loadVersions(){
    const token=++generation;select.disabled=true;status.textContent='正在读取版本…';
    try{const result=await json(endpoint('/api/source-history'));if(token!==generation||!dialog.open)return;
      versions=comparisonVersions(result.versions);
      select.replaceChildren(...versions.map(v=>new Option(v.label,v.id)));select.value=initialComparisonId(versions);select.disabled=false;await render();
    }catch(error){if(token===generation)status.textContent=`无法读取版本：${error.message}`;}
  }
  function open(single){commit();currentEntry=projectEntry;dialog.classList.toggle('single-version',single);document.getElementById('comparison-title').textContent=single?'查看初版 / 历史版本':'上下对比';pages.replaceChildren(...getPages().map(p=>new Option(p,p)));pages.value=currentEntry;dialog.showModal();loadVersions();}
  select.onchange=render;pages.onchange=()=>{currentEntry=pages.value;loadVersions();};
  document.getElementById('view-first-button').onclick=()=>open(true);
  document.getElementById('compare-button').onclick=()=>open(false);
  document.getElementById('comparison-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{generation++;oldFrame.srcdoc='';nowFrame.srcdoc='';});
  window.addEventListener('message',event=>{
    if(!dialog.open||![oldFrame.contentWindow,nowFrame.contentWindow].includes(event.source)||event.data?.kind!=='history-navigate')return;
    status.textContent='切换项目页面请使用上方“页面”选项；页内 Tab 可直接点击。';
  });
}
