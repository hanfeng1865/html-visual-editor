export function installAIErrorMonitor() {
  window.__veAIErrors=[];
  window.addEventListener('error',event=>{
    const target=event.target;
    window.__veAIErrors.push(event.message
      ? {kind:'script',message:event.message,url:event.filename||location.href}
      : {kind:'resource',message:`${target?.tagName||'资源'} 加载失败`,url:target?.src||target?.href||''});
  },true);
  window.addEventListener('unhandledrejection',event=>{
    window.__veAIErrors.push({kind:'promise',message:String(event.reason?.message||event.reason||'脚本执行失败'),url:location.href});
  });
}

export function compareAIErrors(previewErrors, baselineErrors) {
  const normalize=value=>String(value).replace(/\/ai-(?:preview|baseline)\/[^/]+\//g,'/');
  const key=error=>typeof error==='string'?normalize(error):JSON.stringify([error.kind,normalize(error.message),normalize(error.url)]);
  const remaining=new Map();
  for(const error of baselineErrors){const identity=key(error);remaining.set(identity,(remaining.get(identity)||0)+1);}
  const inherited=[],introduced=[];
  for(const error of previewErrors) {
    const identity=key(error),count=remaining.get(identity)||0;
    if(count){inherited.push(error);remaining.set(identity,count-1);}else introduced.push(error);
  }
  return {inherited,introduced};
}

export function loadAIFrame(frame,url,container=null) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);frame.removeEventListener('load',loaded);};
    const loaded=()=>{cleanup();resolve();};
    const timer=setTimeout(()=>{cleanup();reject(new Error('预览或原页面基线加载超时'));},12000);
    frame.addEventListener('load',loaded);
    frame.src=url;
    if(container)container.append(frame);
  });
}

const viewHistories=new WeakMap(),restoredViews=new WeakMap();
function isViewControl(element) {
  if(!element || element.disabled)return false;
  if(element.matches('button') && element.type!=='button')return false;
  if(element.matches('[role="tab"]'))return true;
  if(element.matches('a[href]')) {
    const url=new URL(element.href,element.ownerDocument.URL),current=new URL(element.ownerDocument.URL);
    return url.origin===current.origin && url.pathname===current.pathname && url.search===current.search;
  }
  return element.matches('button') && /^(查看|详情|返回(?:列表)?|返回车辆列表|关闭)$/.test(element.textContent.trim());
}
export function trackAIView(doc,selectorFor) {
  const history=[];viewHistories.set(doc,history);
  // Bubble phase excludes clicks intercepted by the editor to select components.
  doc.addEventListener('click',event=>{
    const control=event.target.closest?.('button,a[href],[role="tab"]');
    if(!isViewControl(control))return;
    const selector=selectorFor(control);
    if(!selector || doc.querySelectorAll(selector).length!==1)return;
    history.push({selector,label:control.textContent.trim()});
  });
}
export function captureAIView(element) {
  if(!element || element.closest('[hidden]'))return {};
  const actions=viewHistories.get(element.ownerDocument);
  return actions?.length && actions.length<=32?{viewActions:JSON.stringify(actions)}:{};
}
export async function restoreAIView(doc,context={}) {
  const serialized=context.viewActions;
  if(!serialized || restoredViews.get(doc)===serialized)return;
  let actions;
  try{actions=JSON.parse(serialized);}catch{throw new Error('页面进入步骤格式无效');}
  if(!Array.isArray(actions) || actions.length>32)throw new Error('页面进入步骤格式无效');
  for(const step of actions) {
    if(!step || typeof step.selector!=='string' || typeof step.label!=='string')throw new Error('页面进入步骤格式无效');
    const controls=doc.querySelectorAll(step.selector),control=controls[0];
    if(controls.length!==1 || !isViewControl(control) || control.textContent.trim()!==step.label)throw new Error('无法重现目标页面：'+step.selector);
    control.click();
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  restoredViews.set(doc,serialized);
}

// Model results are checked in a fresh page without the editor's preview patches.
export async function verifyAIPage(doc, pending, baselineDoc=null) {
  const failures=[];
  for(const patch of Object.values(pending)) {
    try{await restoreAIView(doc,patch.ai?.context);}catch(error){failures.push(patch.selector+'：'+error.message);continue;}
    const path=patch.ai?.context?.path||patch.selector;
    let element=doc.querySelector(path);
    // Positional selectors describe the source order, not the order after a column move.
    // Resolve anonymous cells through their existing stable child identifiers.
    const original=baselineDoc?.querySelector(path);
    if(original?.matches('td,th') && /:nth-(?:of-type|child)\(/.test(path)) {
      const identities=[...original.querySelectorAll('[id],[data-ve-node]')].map(node=>node.id?`[id=${JSON.stringify(node.id)}]`:`[data-ve-node=${JSON.stringify(node.getAttribute('data-ve-node'))}]`).filter(selector=>baselineDoc.querySelectorAll(selector).length===1);
      if(identities.length){
        const matches=identities.map(selector=>{const nodes=doc.querySelectorAll(selector);return nodes.length===1?nodes[0].closest(original.tagName.toLowerCase()):null;});
        element=matches[0] && matches.every(node=>node===matches[0])?matches[0]:null;
      }
    }
    if(patch.deleted){if(element)failures.push(patch.selector+'：组件仍存在');continue;}
    if(!element){failures.push(patch.selector+'：找不到组件');continue;}
    if(patch.insert) {
      const template=doc.createElement('template'),tag=/^\s*<([a-z][a-z0-9]*)/i.exec(patch.insert.html)?.[1];
      template.innerHTML=['td','th'].includes(tag)?'<table><tbody><tr>'+patch.insert.html+'</tr></tbody></table>':tag==='tr'?'<table><tbody>'+patch.insert.html+'</tbody></table>':patch.insert.html;
      const expected=['td','th','tr'].includes(tag)?template.content.querySelector(tag):template.content.firstElementChild;
      const editedText=Object.values(pending).some(p=>('text' in p || p.textNodes) && element.contains(doc.querySelector(p.selector)));
      if(!expected || expected.tagName!==element.tagName || !editedText && expected.textContent.trim()!==element.textContent.trim())failures.push(patch.selector+'：新增组件内容未生效');
    }
    if('text' in patch && element.textContent!==patch.text)failures.push(patch.selector+'：文字未生效');
    for(const [index,text] of Object.entries(patch.textNodes||{})) {
      const node=element.childNodes[+index];
      const actual=node?.nodeType===3?node.textContent:'';
      if(actual!==text)failures.push(patch.selector+'：文字节点未生效');
    }
    for(const [name,value] of Object.entries(patch.attributes||{}))if(element.getAttribute(name)!==value)failures.push(patch.selector+'：属性未生效');
    for(const [property,value] of Object.entries(patch.styles||{})) {
      const probe=doc.createElement('span');probe.style[property]=value;element.parentElement.append(probe);
      const expected=doc.defaultView.getComputedStyle(probe)[property],actual=doc.defaultView.getComputedStyle(element)[property];probe.remove();
      if(element.style[property]!==value && actual!==expected)failures.push(patch.selector+'：样式 '+property+' 未生效');
    }
    if(patch.icon && element.getAttribute('data-lucide')!==patch.icon)failures.push(patch.selector+'：图标未生效');
    if(patch.image && !element.getAttribute('src')?.endsWith(patch.image))failures.push(patch.selector+'：图片未生效');
    if('locked' in patch && element.hasAttribute('data-ve-locked')!==patch.locked)failures.push(patch.selector+'：锁定状态未生效');
    if('concealed' in patch && (doc.defaultView.getComputedStyle(element).display==='none')!==patch.concealed)failures.push(patch.selector+'：显示状态未生效');
    const position=patch.position||patch.insert;
    if(position && (element.parentElement!==doc.querySelector(position.parent) || [...element.parentElement.children].filter(n=>!n.matches('template')).indexOf(element)!==position.index))failures.push(patch.selector+'：位置未生效');
  }
  return failures;
}
