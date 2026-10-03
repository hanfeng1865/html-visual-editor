// One hit test drives hover, click, double-click and drag selection.
// Text is hit by its rendered glyph bounds, not a full-width wrapper box.
function pickFromHit(doc, hit, x, y, {cardSelector, exact=false}) {
  if(!hit || hit.closest('script,style,template,#editor-change-overlay,#editor-box-selection,[data-ve-locked],[contenteditable="true"]'))return null;
  const icon=hit.closest('svg,img,video,canvas');
  if(icon)return icon;
  const control=hit.closest('input,textarea,select');
  if(control)return control;
  const walker=doc.createTreeWalker(hit,doc.defaultView.NodeFilter.SHOW_TEXT);
  let node,count=0;
  while((node=walker.nextNode()) && count++<500) {
    if(!node.textContent.trim() || node.parentElement.closest('script,style,template,[hidden],[data-ve-locked]'))continue;
    const range=doc.createRange(),text=node.textContent;
    range.setStart(node,text.length-text.trimStart().length);
    range.setEnd(node,text.trimEnd().length);
    for(const rect of range.getClientRects()) {
      if(x>=rect.left-2 && x<=rect.right+2 && y>=rect.top-2 && y<=rect.bottom+2)return node.parentElement;
    }
  }
  if(hit.matches('html,body'))return null;
  if(exact)return hit;
  const component=hit.closest(cardSelector) || hit.closest('button,a,[role="button"]');
  if(component)return component;
  // Space around text and between children is canvas background. Containers
  // remain selectable through exact (Alt) picking and the layer tree.
  if(hit.childElementCount || hit.textContent.trim())return null;
  return hit;
}

// Search the hit stack so a text wrapper's unused area does not hide nearby text.
export function pickElementsAtPoint(doc, x, y, {cardSelector, exact=false}={}) {
  const top=doc.elementFromPoint(x,y);
  if(!top || top.closest('[data-ve-locked],[contenteditable="true"],#editor-change-overlay,#editor-box-selection'))return [];
  const result=[];
  const add=node=>{if(node && !result.includes(node))result.push(node);};
  for(const hit of doc.elementsFromPoint(x,y)) {
    if(hit.matches('html,body'))continue;
    if(hit.closest('[data-ve-locked],script,style,template'))continue;
    add(pickFromHit(doc,hit,x,y,{cardSelector,exact}));
    if(exact)add(hit.closest('svg,img,video,canvas') || hit);
    if(result.length && !exact)break;
  }
  return result;
}
export function pickElementAtPoint(doc, x, y, options={}) {
  return pickElementsAtPoint(doc,x,y,options)[0] || null;
}
