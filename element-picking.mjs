// One hit test drives hover, click, double-click and drag selection.
// Text is hit by its rendered glyph bounds, not a full-width wrapper box.
export function pickElementAtPoint(doc, x, y, {cardSelector, exact=false}={}) {
  const hit=doc.elementFromPoint(x,y);
  if(!hit || hit.closest('script,style,template,#editor-change-overlay,#editor-box-selection,[data-ve-locked],[data-ve-dynamic],[contenteditable="true"]'))return null;
  const icon=hit.closest('svg,img,video,canvas');
  if(icon)return icon;
  const control=hit.closest('input,textarea,select');
  if(control)return control;
  const walker=doc.createTreeWalker(hit,doc.defaultView.NodeFilter.SHOW_TEXT);
  let node,count=0;
  while((node=walker.nextNode()) && count++<500) {
    if(!node.textContent.trim() || node.parentElement.closest('script,style,template,[hidden],[data-ve-dynamic]'))continue;
    const range=doc.createRange(),text=node.textContent;
    range.setStart(node,text.length-text.trimStart().length);
    range.setEnd(node,text.trimEnd().length);
    for(const rect of range.getClientRects()) {
      if(x>=rect.left-2 && x<=rect.right+2 && y>=rect.top-2 && y<=rect.bottom+2)return node.parentElement;
    }
  }
  if(hit.matches('html,body'))return null;
  if(exact)return hit;
  return hit.closest(cardSelector) || hit.closest('button,a,[role="button"]') || hit;
}
