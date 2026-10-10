// Shared by the editor, project preview and standalone export. Keep self-contained
// so the exporter can embed this function without any external dependencies.
export function createVisualPatchEngine(doc) {
  const identities = new WeakMap();
  const targets = new Map();
  const baselines = new WeakMap();
  const concealedStyles = new WeakMap();
  const deletedMarkers = new Map();
  const columnBaselines = new WeakMap();
  const tableLayouts = new WeakMap();
  const interactionRoots = new WeakSet();
  const escape = value => (doc.defaultView?.CSS || globalThis.CSS).escape(value);
  const clean = selector => selector?.replace(/\.ve-(?:hover|selected|dragging)\b/g, '');

  function interactionRoot(element) {
    for (let node = element; node; node = node.parentElement) {
      if (interactionRoots.has(node) || node.matches('form,dialog,[role="dialog"],[role="tabpanel"],.drawer,.modal,.detail-page,[id$="-detail-page"],[data-ve-view]')) return node;
    }
    return null;
  }

  function moveBlockReason(element, parent) {
    if (!element || !parent || element.parentElement === parent) return null;
    if (interactionRoot(element) !== interactionRoot(parent))
      return '请在当前子页面、弹窗或表单内调整位置，跨区域移动会破坏入口或表单交互';
    return null;
  }

  function originalSelector(element) {
    if (identities.has(element)) return identities.get(element);
    if (element.dataset.veNode) return `[data-ve-node="${escape(element.dataset.veNode)}"]`;
    if (element.id && doc.querySelectorAll('#'+escape(element.id)).length===1) return `#${escape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current !== doc.body) {
      if (identities.has(current)) { parts.unshift(identities.get(current)); break; }
      if (current.id && doc.querySelectorAll('#'+escape(current.id)).length===1) { parts.unshift(`#${escape(current.id)}`); break; }
      let part = current.tagName.toLowerCase();
      const classes = [...current.classList].filter(name =>
        !['active', 'open', 'selected'].includes(name) && !name.startsWith('ve-') && !name.startsWith('lucide')).slice(0, 2);
      part += classes.map(name => `.${escape(name)}`).join('');
      const siblings = [...(current.parentElement?.children || [])].filter(node => node.tagName === current.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      current = current.parentElement;
    }
    if(parts.length && current===doc.body)parts.unshift('body');
    return parts.join(' > ') || 'body';
  }

  function capture() {
    // Capture descendants too: a move of a container changes every positional path.
    for (const element of doc.querySelectorAll('body, body *')) {
      // Remember initially closed views after their scripts remove `hidden`.
      if (element.matches('section[hidden],main[hidden],article[hidden],aside[hidden]')) interactionRoots.add(element);
      const previousSelector=identities.get(element);
      if(previousSelector?.startsWith('#') && doc.querySelectorAll(previousSelector).length>1) {
        identities.delete(element);targets.delete(previousSelector);
      }
      if (!identities.has(element)) {
        const selector = originalSelector(element);
        identities.set(element, selector);
        targets.set(selector, element);
      }
      const previous = baselines.get(element) || [];
      const children = [...element.children];
      baselines.set(element, [...previous.filter(node => node.parentElement === element),
        ...children.filter(node => !previous.includes(node))]);
    }
  }

  function resolve(selector) {
    selector = clean(selector);
    if (!selector) return null;
    // Positional selectors shift after deletion. While its marker is present,
    // the original target is gone; never resolve that selector to its neighbour.
    if (deletedMarkers.get(selector)?.isConnected) return null;
    const known = targets.get(selector);
    if (known?.isConnected) return known;
    try {
      const element = doc.querySelector(selector);
      if (element) targets.set(selector, element);
      return element;
    } catch { return null; }
  }

  // Inserted markup is a presentation snapshot; executable content is never copied.
  function materialize(html) {
    const template = doc.createElement('template');
    const tag = /^\s*<([a-z][a-z0-9]*)\b/i.exec(html)?.[1]?.toLowerCase();
    // Table cells parsed in a generic template fragment are wrapped in a row.
    // Parse them inside an explicit table, then return the requested node.
    template.innerHTML = tag === 'td' || tag === 'th'
      ? `<table><tbody><tr>${html}</tr></tbody></table>`
      : tag === 'tr' ? `<table><tbody>${html}</tbody></table>` : html;
    template.content.querySelectorAll('script,style,link,meta,iframe,object,embed,base,form,foreignObject').forEach(node => node.remove());
    for (const node of template.content.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || ['srcdoc','autofocus','contenteditable','draggable'].includes(attr.name)
          || (['href','src','action','xlink:href'].includes(attr.name) && !/^(?!(?:[a-z][a-z0-9+.-]*:|\/\/))[^\s]+$|^data:image\/(png|jpeg|webp|gif);base64,/i.test(attr.value))) node.removeAttribute(attr.name);
      }
      if (node.tagName === 'IMG') {
        const name = (node.getAttribute('src') || '').split('/').pop();
        if (doc.defaultView?.__visualEditorAssets?.[name]) node.src = doc.defaultView.__visualEditorAssets[name];
      }
    }
    return tag === 'td' || tag === 'th'
      ? template.content.querySelector(`table > tbody > tr > ${tag}`)
      : tag === 'tr' ? template.content.querySelector('table > tbody > tr')
      : template.content.firstElementChild;
  }

  function apply(patches) {
    capture();
    // Parents may themselves be newly inserted; resolve in dependency order.
    let pending = Object.values(patches).filter(patch => patch.insert);
    while (pending.length) {
      const remaining = [];
      let progress = false;
      for (const patch of pending) {
        if (resolve(patch.selector)) continue;
        const parent = resolve(patch.insert.parent);
        if (!parent) { remaining.push(patch); continue; }
        const element = materialize(patch.insert.html);
        if (!element) continue;
        parent.appendChild(element);
        identities.set(element, patch.selector);
        targets.set(patch.selector, element);
        progress = true;
      }
      capture();
      if (!progress) break;
      pending = remaining;
    }
    // Resolve every legacy selector BEFORE any deletion or move changes the DOM.
    const entries = Object.entries(patches).map(([key, patch]) => ({
      key, patch, element: resolve(patch.selector), parent: resolve(patch.position?.parent),
    }));
    const orders = new Map();
    for (const { key, patch, element, parent } of entries) {
      if (!element) continue;
      // Also defend old drafts and exported runtimes, not only editor gestures.
      if (patch.position && moveBlockReason(element, parent)) continue;
      if (patch.deleted === true) {
        // Column/row operations change the table grid itself (cells, spans and
        // sticky offsets); they retain the existing structural deletion path.
        if (element.matches('td,th,tr,col,colgroup')) {
          const marker = doc.createElement('template');
          marker.id = `ve-deleted-${key}`;
          deletedMarkers.set(clean(patch.selector), marker);
          const siblings = baselines.get(element.parentElement);
          if (siblings) siblings.splice(siblings.indexOf(element), 1, marker);
          element.replaceWith(marker);
          continue;
        }
        // Visual deletion must preserve IDs, cached references and event bindings:
        // imported scripts may still update this subtree when reopening a view.
        // Keeping its position also prevents nth-of-type patches drifting on reload.
        if (!doc.getElementById('visual-editor-deletion-style')) {
          const style = doc.createElement('style');
          style.id = 'visual-editor-deletion-style';
          style.textContent = '[data-ve-deleted]{display:none!important}';
          (doc.head || doc.documentElement).appendChild(style);
        }
        if (!element.hasAttribute('data-ve-deleted')) {
          element.setAttribute('data-ve-deleted', '');
          element.setAttribute('inert', '');
          element.setAttribute('aria-hidden', 'true');
        }
        continue;
      }
      const hasDynamicText = Boolean(element.closest('[data-ve-dynamic]'));
      if ((!hasDynamicText || patch.ai?.fields?.text || patch.templateText) && !element.isContentEditable && typeof patch.text === 'string' && element.childElementCount === 0 && element.textContent !== patch.text) element.textContent = patch.text;
      if ((!hasDynamicText || patch.ai?.fields?.textNodes) && !element.isContentEditable) for (const [index, text] of Object.entries(patch.textNodes || {})) {
        const node = element.childNodes[Number(index)];
        if (node?.nodeType === 3 && node.textContent !== text) node.textContent = text;
      }
      if (patch.icon && element.tagName.toLowerCase() === 'svg' && element.getAttribute('data-lucide') !== patch.icon) {
        const name = patch.icon.split('-').map(part => part[0].toUpperCase()+part.slice(1)).join('');
        const lucide = doc.defaultView?.lucide;
        if (lucide?.icons[name]) {
          const icon = lucide.createElement(lucide.icons[name]);
          element.replaceChildren(...icon.childNodes);
          element.setAttribute('data-lucide', patch.icon);
        }
      }
      if (patch.image && element.tagName === 'IMG') {
        const src = doc.defaultView?.__visualEditorAssets?.[patch.image] || `assets/${patch.image}`;
        if (element.getAttribute('src') !== src) element.setAttribute('src', src);
      }
      for (const [name, value] of Object.entries(patch.attributes || {})) {
        element.setAttribute(name, value);
        if(name==='value' && element.tagName==='INPUT' && element.value!==value)element.value=value;
      }
      for (const [property, value] of Object.entries(patch.styles || {})) {
        if (element.style[property] !== value) element.style[property] = value;
      }
      if ('locked' in patch) element.toggleAttribute('data-ve-locked', patch.locked);
      if (patch.concealed) {
        if (!concealedStyles.has(element)) concealedStyles.set(element, [element.style.display, element.style.getPropertyPriority('display')]);
        element.style.setProperty('display', 'none', 'important');
      } else if (concealedStyles.has(element)) {
        const [value, priority] = concealedStyles.get(element);
        element.style.setProperty('display', patch.styles?.display ?? value, priority);
        concealedStyles.delete(element);
      }
      if (parent && !element.contains(parent) && parent !== element) {
        if (element.parentElement !== parent) parent.appendChild(element);
        if (!orders.has(parent)) orders.set(parent, new Map());
        orders.get(parent).set(element, patch.position.index);
      }
    }
    // Compute a complete order from the original baseline, then reconcile once.
    // Duplicate legacy indices have a deterministic result, never an oscillation.
    for (const [parent, positions] of orders) {
      const original = baselines.get(parent) || [];
      const baseline = [...original.filter(node => node.parentElement === parent), ...[...parent.children].filter(node => !original.includes(node))];
      const order = new Array(baseline.length);
      for (const [node, index] of positions) {
        if (node.parentElement === parent) order[Math.min(index, order.length - 1)] = node;
      }
      const assigned = new Set(order.filter(Boolean));
      const remaining = baseline.filter(node => !assigned.has(node));
      for (let index = 0; index < order.length; index += 1) {
        const node = order[index] || remaining.shift();
        if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null);
      }
    }
    for(const {patch,element} of entries)if(patch.tableColumns && element?.tagName==='TABLE')applyTableColumns(element,patch.tableColumns);
  }

  function applyTableColumns(table,rules) {
    const view=doc.defaultView;
    if(!view)return;
    const removed=new Map(rules.map(rule=>[rule.index,rule.width]));
    function captureColumns(columns) {
      let start=0;
      return columns.map(cell=>{
        const span=cell.colSpan || cell.span || 1,style=view.getComputedStyle(cell);
        const saved={cell,start,span,left:style.left,right:style.right,sticky:style.position==='sticky'};
        start+=span;return saved;
      });
    }
    function baseline(element,columns) {
      const previous=columnBaselines.get(element);
      // Some renderers replace the cells while reusing the same <tr>.
      if(!previous || previous.some(entry=>entry.cell.parentNode!==element && entry.marker?.parentNode!==element)
        || columns.some(cell=>!previous.some(entry=>entry.cell===cell)))columnBaselines.set(element,captureColumns(columns));
      return columnBaselines.get(element);
    }
    function shrink(entries,attribute) {
      for(const entry of entries) {
        const {cell,start,span,left,right,sticky}=entry;
        const indices=[...removed.keys()].filter(index=>start<=index && index<start+span);
        if(indices.length>=span) {
          if(cell.isConnected) {
            const marker=doc.createElement('template');
            entry.marker=marker;
            deletedMarkers.set(originalSelector(cell),marker);
            cell.replaceWith(marker);
          }
          continue;
        }
        if(indices.length && cell.getAttribute(attribute)!==String(span-indices.length))cell.setAttribute(attribute,String(span-indices.length));
        if(sticky) {
          const before=[...removed].filter(([index])=>index<start).reduce((sum,[,width])=>sum+width,0);
          const after=[...removed].filter(([index])=>index>=start+span).reduce((sum,[,width])=>sum+width,0);
          for(const [property,value,delta] of [['left',left,before],['right',right,after]])if(delta && value.endsWith('px') && parseFloat(value)>0) {
            const next=Math.max(0,parseFloat(value)-delta)+'px';
            if(cell.style[property]!==next)cell.style[property]=next;
          }
        }
      }
    }
    for(const row of table.rows)shrink(baseline(row,[...row.cells]),'colspan');
    // Remember the original positions across all column groups as one sequence.
    if(!tableLayouts.has(table)) {
      const columns=[...table.children].filter(node=>node.tagName==='COLGROUP').flatMap(group=>group.children.length?[...group.children].filter(node=>node.tagName==='COL'):[group]);
      const style=view.getComputedStyle(table);
      tableLayouts.set(table,{columns:captureColumns(columns),minWidth:style.minWidth,width:table.style.width});
    }
    const layout=tableLayouts.get(table);
    shrink(layout.columns,'span');
    const total=[...removed.values()].reduce((sum,width)=>sum+width,0);
    for(const property of ['minWidth','width'])if(layout[property].endsWith('px')) {
      const next=Math.max(0,parseFloat(layout[property])-total)+'px';
      if(table.style[property]!==next)table.style[property]=next;
    }
  }

  capture();
  return { apply, capture, selectorFor: originalSelector, resolve, moveBlockReason };
}
