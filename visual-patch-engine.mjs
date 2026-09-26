// Shared by the editor, project preview and standalone export. Keep self-contained
// so the exporter can embed this function without any external dependencies.
export function createVisualPatchEngine(doc) {
  const identities = new WeakMap();
  const targets = new Map();
  const baselines = new WeakMap();
  const concealedStyles = new WeakMap();
  const escape = value => (doc.defaultView?.CSS || globalThis.CSS).escape(value);
  const clean = selector => selector?.replace(/\.ve-(?:hover|selected|dragging)\b/g, '');

  function originalSelector(element) {
    if (identities.has(element)) return identities.get(element);
    if (element.dataset.veNode) return `[data-ve-node="${escape(element.dataset.veNode)}"]`;
    if (element.id) return `#${escape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current !== doc.body) {
      if (identities.has(current)) { parts.unshift(identities.get(current)); break; }
      if (current.id) { parts.unshift(`#${escape(current.id)}`); break; }
      let part = current.tagName.toLowerCase();
      const classes = [...current.classList].filter(name =>
        !['active', 'open', 'selected'].includes(name) && !name.startsWith('ve-') && !name.startsWith('lucide')).slice(0, 2);
      part += classes.map(name => `.${escape(name)}`).join('');
      const siblings = [...(current.parentElement?.children || [])].filter(node => node.tagName === current.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ') || 'body';
  }

  function capture() {
    // Capture descendants too: a move of a container changes every positional path.
    for (const element of doc.querySelectorAll('body, body *')) {
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
      if (patch.deleted === true) {
        const marker = doc.createElement('template');
        marker.id = `ve-deleted-${key}`;
        const siblings = baselines.get(element.parentElement);
        if (siblings) siblings.splice(siblings.indexOf(element), 1, marker);
        element.replaceWith(marker);
        continue;
      }
      const hasDynamicText = Boolean(element.closest('[data-ve-dynamic]'));
      if (!hasDynamicText && !element.isContentEditable && typeof patch.text === 'string' && element.childElementCount === 0 && element.textContent !== patch.text) element.textContent = patch.text;
      if (!hasDynamicText && !element.isContentEditable) for (const [index, text] of Object.entries(patch.textNodes || {})) {
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
      for (const [name, value] of Object.entries(patch.attributes || {})) element.setAttribute(name, value);
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
  }

  capture();
  return { apply, capture, selectorFor: originalSelector, resolve };
}
