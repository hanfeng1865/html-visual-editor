// One hit test drives hover, click, double-click and drag selection.
// Text is hit by its rendered glyph bounds, not a full-width wrapper box.
const componentSelector='[data-editor-component],[data-chart-type],[data-component],.panel,.finance-block,article,section,aside,header,footer,nav,figure,fieldset,details,dialog,table,ul,ol,[role="group"],[role="region"],[role="dialog"],[role="list"],[role="table"]';
const graphicsSelector='svg,img,video,canvas';
const componentShadows=new WeakMap();

// Shared by point picking and sweep selection. Source node IDs alone are not
// component boundaries: the editor assigns them to every inserted descendant.
export function isSelectableComponent(element, {cardSelector}={}) {
  if(!element || element.matches('html,body,main,svg,svg *'))return false;
  if(element.matches(componentSelector) || (cardSelector && element.matches(cardSelector)))return true;
  if(!element.matches('div,span'))return false;
  const style=element.ownerDocument.defaultView.getComputedStyle(element);
  if(style.display==='contents' || style.display==='inline' || style.visibility==='hidden')return false;
  const visibleColor=color=>color && color!=='transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(color);
  const border=['Top','Right','Bottom','Left'].some(side=>parseFloat(style[`border${side}Width`])>0 && !['none','hidden'].includes(style[`border${side}Style`]) && visibleColor(style[`border${side}Color`]));
  // Remember the real shadow before the editor replaces it with a selection
  // halo. Hover only adds an outline, so its shadow remains authoritative.
  if(!element.matches('.ve-selected'))componentShadows.set(element,style.boxShadow!=='none');
  const shadow=componentShadows.get(element) || false;
  return border || visibleColor(style.backgroundColor) || style.backgroundImage!=='none' || shadow;
}

function containingComponent(hit,options) {
  for(let node=hit;node && !node.matches('html,body');node=node.parentElement) {
    if(node.matches('button,a,[role="button"]') || isSelectableComponent(node,options))return node;
  }
  return null;
}

function pickFromHit(doc, hit, x, y, {cardSelector, exact=false}) {
  if(!hit || hit.closest('script,style,template,#editor-change-overlay,#editor-box-selection,[data-ve-locked],[contenteditable="true"]'))return null;
  const icon=hit.closest(graphicsSelector);
  if(icon)return (!exact && icon.closest('[data-chart-type]')) || icon;
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
  const component=containingComponent(hit,{cardSelector});
  if(component)return component;
  // Unrecognized wrappers remain canvas background. Content panels can be
  // selected from their padding without swallowing text, controls or charts.
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
