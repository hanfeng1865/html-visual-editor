import {applyTemplateText,findTemplateText} from './template-text.mjs';
import {createVisualPatchEngine} from './visual-patch-engine.mjs';
import {readSourcePatches, mergeSourcePatches, writeSourcePatches} from './source-runtime.mjs';
import {createSaveabilityChecker} from './saveability.mjs';
const parse=html=>new DOMParser().parseFromString(html,'text/html');
const find=(doc,selector)=>{try{return doc.querySelector(selector);}catch{return null;}};
const compact=value=>String(value??'').slice(0,220);

export function compileSource({base,current,patches,choices={},projectId,skipUnsupported=false}) {
  const before=parse(base.source),doc=parse(current.source),changes=structuredClone(patches),conflicts=[],unsupported=[];
  const runtimeChanges = {};
  const checker = createSaveabilityChecker(doc, changes);
  for (const [key, patch] of Object.entries(changes)) {
    const reason = checker.check(patch);
    if (reason) {
      unsupported.push(`${patch.selector}：${reason}`);
      if (skipUnsupported) delete changes[key];
    }
  }
  if (unsupported.length && !skipUnsupported) return {conflicts, unsupported};
  const templateChanges=[];
  for(const [key,patch] of Object.entries(changes))if(patch.templateText && 'text' in patch && findTemplateText(doc,null,patch.templateText)){
    templateChanges.push({binding:patch.templateText,text:patch.text});delete patch.text;delete patch.templateText;
    if(Object.keys(patch).length===1)delete changes[key];
  }
  function conflict(id,label,old,code,edit,skip,codeOnly=false) {
    if(choices[id]==='code'){skip();return;}
    if(choices[id]==='editor' && !codeOnly)return;
    conflicts.push({id,label,before:compact(old),code:compact(code),editor:compact(edit),codeOnly});
  }
  const changedDependencies=Object.keys({...base.hashes,...current.hashes}).filter(path=>path!==current.entry && base.hashes[path]!==current.hashes[path]);
  if(changedDependencies.length && Object.values(changes).some(patch=>patch.styles)) {
    conflict('dependencies','外部样式或脚本已修改',changedDependencies.join('、'),'使用最新 CSS/JS，不叠加旧的样式调整','保留 CSS/JS 的修改，并应用编辑器的样式调整',()=>{Object.values(changes).forEach(patch=>delete patch.styles);});
  }
  const inserted=new Set(Object.values(changes).filter(patch=>patch.insert).map(patch=>patch.selector));
  const insertedDocs=Object.values(changes).filter(patch=>patch.insert).map(patch=>parse(patch.insert.html));
  const isIntroduced=selector=>inserted.has(selector)||insertedDocs.some(doc=>find(doc,selector));
  for(const [key,patch] of Object.entries(changes)) {
    const old=find(before,patch.selector),node=find(doc,patch.selector);
    const introduced=isIntroduced(patch.selector);
    if(!node && !introduced) {
      if(!old) {
        runtimeChanges[key] = patch;
        delete changes[key];
      }
      else conflict(key,`${patch.selector} 已被代码删除`,old.outerHTML,'组件已删除','无法应用；保留代码会跳过此组件',()=>delete changes[key],true);
      continue;
    }
    if(patch.icon && node && !node.hasAttribute('data-lucide')) {
      unsupported.push(`${patch.selector}：图标由脚本生成，请通过 Codex 修改图标源码`);
      if(skipUnsupported) delete changes[key];
    }
    if(old && node) {
      if(patch.icon && old.getAttribute('data-lucide')!==node.getAttribute('data-lucide') && node.getAttribute('data-lucide')!==patch.icon)
        conflict(`${key}:icon`,`${patch.selector} 图标`,old.getAttribute('data-lucide'),node.getAttribute('data-lucide'),patch.icon,()=>delete patch.icon);
      if(patch.deleted && old.outerHTML!==node.outerHTML)conflict(`${key}:delete`,`${patch.selector} 删除冲突`,old.outerHTML,node.outerHTML,'删除组件',()=>delete patch.deleted);
      if('text' in patch && node.childElementCount)conflict(`${key}:text-structure`,`${patch.selector} 文字结构已变化`,old.innerHTML,node.innerHTML,'无法直接替换嵌套内容，请刷新后重新编辑',()=>delete patch.text,true);
      if('text' in patch && node.textContent!==old.textContent && node.textContent!==patch.text)conflict(`${key}:text`,`${patch.selector} 文字`,old.textContent,node.textContent,patch.text,()=>delete patch.text);
      for(const [index,value] of Object.entries(patch.textNodes||{})) {
        const a=old.childNodes[+index],b=node.childNodes[+index];
        if(b?.nodeType!==3 || a?.textContent!==b.textContent && b.textContent!==value)conflict(`${key}:node:${index}`,`${patch.selector} 文字片段`,a?.textContent,b?.textContent,value,()=>delete patch.textNodes[index],b?.nodeType!==3);
      }
      for(const [property,value] of Object.entries(patch.styles||{}))if(old.style[property]!==node.style[property] && node.style[property]!==value)conflict(`${key}:style:${property}`,`${patch.selector} · ${property}`,old.style[property],node.style[property],value,()=>delete patch.styles[property]);
      if(patch.position) {
        const oldParent=find(before,patch.position.parent),newParent=find(doc,patch.position.parent);
        if(oldParent && newParent && [...oldParent.children].map(n=>n.id||n.tagName).join('|')!==[...newParent.children].map(n=>n.id||n.tagName).join('|'))conflict(`${key}:position`,`${patch.selector} 排列结构`,oldParent.innerHTML,newParent.innerHTML,'应用编辑器排列顺序',()=>delete patch.position);
      }
    }
    const parent=patch.insert?.parent||patch.position?.parent;
    if(parent && !find(doc,parent) && !isIntroduced(parent)) {
      unsupported.push(`${patch.selector}：目标容器已不存在`);
      if(skipUnsupported) delete changes[key];
    }
  }
  if(conflicts.length || (unsupported.length && !skipUnsupported))return {conflicts,unsupported};
  for(const patch of Object.values(changes)) {
    if(projectId!=='builtin') {
      if(patch.insert)patch.insert.html=patch.insert.html.replaceAll(`/project/${projectId}/`,'/');
      for(const name of Object.keys(patch.styles||{}))patch.styles[name]=patch.styles[name].replaceAll(`/project/${projectId}/`,'/');
    }
  }
  for (const patch of Object.values(runtimeChanges)) {
    if (projectId !== 'builtin') {
      if (patch.insert) patch.insert.html = patch.insert.html.replaceAll(`/project/${projectId}/`, '/');
      for (const name of Object.keys(patch.styles || {})) patch.styles[name] = patch.styles[name].replaceAll(`/project/${projectId}/`, '/');
    }
  }
  for(const {binding,text} of templateChanges)if(!applyTemplateText(doc,binding,text))return {conflicts:[],unsupported:['模板文字定位已变化，请刷新代码后重新编辑']};
  const savedRuntime = readSourcePatches(doc);
  // Lucide replaces its source declaration with an SVG at runtime.
  for (const patch of Object.values(changes)) {
    if (patch.icon) find(doc, patch.selector)?.setAttribute('data-lucide', patch.icon);
  }
  createVisualPatchEngine(doc).apply(changes);
  writeSourcePatches(doc, mergeSourcePatches(savedRuntime, runtimeChanges));
  doc.querySelectorAll('template[id^="ve-deleted-"]').forEach(node=>node.remove());
  return {html:(doc.doctype?`<!DOCTYPE ${doc.doctype.name}>\n`:'')+doc.documentElement.outerHTML,conflicts:[],unsupported};
}
