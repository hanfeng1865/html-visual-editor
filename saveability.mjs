import {findTemplateText} from './template-text.mjs';
// Shared by the inspector, mutation guard and source compiler.
export function createSaveabilityChecker(sourceDoc, patches = {}, liveDoc = null, appliedPatches = patches) {
  const insertedDocs = Object.values(patches).filter(patch => patch.insert).map(patch =>
    new DOMParser().parseFromString(/^(?:\s*)<(?:td|th|tr)\b/i.test(patch.insert.html) ? `<table><tbody>${/^\s*<tr\b/i.test(patch.insert.html)?patch.insert.html:`<tr>${patch.insert.html}</tr>`}</tbody></table>` : patch.insert.html, 'text/html'));
  const matches = (doc, selector) => {
    try { return [...doc.querySelectorAll(selector)]; } catch { return []; }
  };
  const blocked = reason => ({kind:'blocked', reason});
  const stable = selector => /^#(?:\\[0-9a-fA-F]{1,6}\s?|\\.|[^\s#.\[\]:>+~,])+$/.test(selector) || /^\[data-ve-node="[^"\\]+"\]$/.test(selector);
  const bindings=new Map();
  function templateBinding(selector){
    if(bindings.has(selector))return bindings.get(selector);
    const patch=Object.values(patches).find(p=>p.selector===selector),applied=Object.values(appliedPatches).find(p=>p.selector===selector);
    let live=liveDoc && matches(liveDoc,selector)[0];
    const existing=patch?.templateText || applied?.templateText;
    const source=matches(sourceDoc,selector)[0];
    if(!existing && source && !source.closest('[data-ve-dynamic]') && !live?.closest('[data-ve-dynamic]')){bindings.set(selector,null);return null;}
    let binding=findTemplateText(sourceDoc,live,existing);
    if(!binding && applied?.ai?.context?.html){
      const snapshot=new DOMParser().parseFromString(applied.ai.context.html,'text/html').body.firstElementChild;
      if(snapshot && live?.tagName===snapshot.tagName)binding=findTemplateText(sourceDoc,snapshot);
    }
    bindings.set(selector,binding);return binding;
  }
  function target(selector) {
    const live = liveDoc ? matches(liveDoc, selector) : [];
    const source = matches(sourceDoc, selector);
    const added = insertedDocs.flatMap(doc => matches(doc, selector));
    if (source.length > 1 || live.length > 1 || (!source.length && added.length > 1))
      return blocked('元素标识重复，请为元素设置唯一的 id 或 data-ve-node 后刷新代码');
    if(!source.length && !added.length && !stable(selector) || live[0]?.closest('[data-ve-dynamic]') || source[0]?.closest('[data-ve-dynamic]')){
      const binding=templateBinding(selector);
      if(binding)return {kind:'template',node:live[0],binding,reason:'文字可直接写回页面生成模板，刷新后仍生效；其他修改会单独检查'};
    }
    if (live[0]?.closest('[data-ve-dynamic]') || source[0]?.closest('[data-ve-dynamic]'))
      return blocked('此区域由页面脚本持续更新，请修改其生成代码');
    if (source.length) {
      const node = source[0];
      if (live[0] && node.tagName !== live[0].tagName && !node.hasAttribute('data-lucide'))
        return blocked('脚本替换了源码元素的结构，请修改其生成代码');
      return {kind:'source', node, reason:'修改会直接写回 HTML；保存前会备份并检查代码冲突'};
    }
    if (added.length) return {kind:'added', node:added[0], reason:'新增组件会随修改写入 HTML'};
    if (!stable(selector)) return blocked('动态元素缺少稳定标识，请在生成代码中为它设置唯一且固定的 id 或 data-ve-node');
    return {kind:'runtime', node:live[0], reason:'修改会保存到 HTML 内的调整记录，打开页面时自动恢复；请保留元素标识'};
  }
  function check(patch) {
    const status = target(patch.selector);
    if (status.kind === 'blocked') return status.reason;
    if(status.kind==='template'){
      const fields=Object.keys(patch).filter(field=>!['selector','ai','templateText'].includes(field));
      return fields.every(field=>field==='text')?null:'此动态组件的文字可直接保存；其他修改需要修改生成逻辑';
    }
    const node = status.node;
    if (status.kind === 'source' && liveDoc && ('text' in patch || patch.textNodes)) {
      const live = matches(liveDoc, patch.selector)[0];
      const applied = Object.values(appliedPatches).find(value => value.selector === patch.selector);
      if ('text' in patch && live && !live.childElementCount && !node.childElementCount
        && live.textContent !== node.textContent && applied?.text !== live.textContent)
        return '页面脚本已改写这段文字，直接写回会被覆盖，请修改生成代码';
      for (const index of Object.keys(patch.textNodes || {})) {
        const actual = live?.childNodes[+index]?.textContent;
        if (actual !== undefined && actual !== node.childNodes[+index]?.textContent && applied?.textNodes?.[index] !== actual)
          return '页面脚本已改写这段文字，直接写回会被覆盖，请修改生成代码';
      }
    }
    if ('text' in patch && node?.childElementCount)
      return '此元素包含子元素，请选择内部的文字元素编辑';
    for (const index of Object.keys(patch.textNodes || {})) {
      if (node && node.childNodes[+index]?.nodeType !== 3)
        return '文字结构与源码不一致，请修改生成代码或刷新代码后重新选择';
    }
    if (patch.icon && status.kind !== 'runtime' && !node?.hasAttribute('data-lucide'))
      return '此图标没有可保存的图标声明，请修改图标源码';
    for (const parent of new Set([patch.insert?.parent, patch.position?.parent].filter(Boolean))) {
      const container = target(parent);
      if (container.kind === 'blocked') return container.reason;
      if (container.kind === 'runtime') return '目标容器由脚本生成，暂不支持在其中新增或重排组件；请修改生成代码';
    }
    return null;
  }
  return {target, check, templateBinding};
}
