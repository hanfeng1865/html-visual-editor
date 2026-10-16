// Shared by saved output and the isolated preview, including older candidates.
export function normalizeDiagramDocument(doc=document){
 const root=doc.querySelector('[data-editor-component="diagram"]');if(!root)return '';
 for(const node of root.querySelectorAll('p,small,figcaption,li,text')){
  const text=node.textContent.trim();
  if(!/^(?:依据|来源|源码依据|参考文件|来源文件)\s*[:：]/.test(text)||!/[\w/-]+\.(?:html?|[cm]?js|tsx?|jsx|css|vue|json|md)\b/i.test(text))continue;
  const pending=/[;；]\s*(待确认[\s\S]*)/.exec(text);
  if(pending)node.textContent=pending[1];else{
   const heading=node.previousElementSibling,next=node.nextElementSibling;
   node.remove();
   if(heading&&/^H[1-6]$/.test(heading.tagName)&&(!next||/^H[1-6]$/.test(next.tagName)))heading.remove();
  }
 }
 root.style.width='100%';root.style.maxWidth='100%';root.style.minWidth='0';
 for(const node of [root,...root.querySelectorAll('*')]){
  if(node.namespaceURI==='http://www.w3.org/2000/svg')continue;
  node.style.boxSizing='border-box';node.style.minWidth='0';node.style.maxWidth='100%';node.style.overflowWrap='anywhere';
  const computed=doc.defaultView.getComputedStyle(node);
  if(computed.display==='grid'&&computed.gridTemplateColumns!=='none'){
   const columns=computed.gridTemplateColumns.replace(/\[[^\]]*\]/g,'').trim().split(/\s+/).length;
   node.style.gridTemplateColumns=`repeat(${columns}, minmax(0, 1fr))`;
  }
 }
 for(const svg of root.querySelectorAll('svg')){
  svg.style.setProperty('width','100%','important');svg.style.setProperty('min-width','0','important');svg.style.setProperty('max-width','100%','important');svg.style.setProperty('height','auto','important');svg.style.display='block';
  for(let parent=svg.parentElement;parent&&parent!==root;parent=parent.parentElement){parent.style.width='100%';parent.style.overflowX='visible';}
 }
 return root.outerHTML;
}
