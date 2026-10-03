import {createVisualPatchEngine} from './visual-patch-engine.mjs';

const DATA_ID = 'visual-editor-source-patches';
const RUNTIME_ID = 'visual-editor-source-runtime';

export function readSourcePatches(doc) {
  const data = doc.getElementById(DATA_ID);
  return data ? JSON.parse(data.textContent) : {};
}

export function mergeSourcePatches(saved, draft) {
  const merged = {...saved};
  for (const [key, patch] of Object.entries(draft)) {
    const previousKey = Object.keys(merged).find(id => merged[id].selector === patch.selector);
    const previous = merged[previousKey] || {};
    if (previousKey) delete merged[previousKey];
    merged[key] = {...previous, ...patch};
    for (const field of ['styles', 'attributes', 'textNodes']) {
      if (previous[field] && patch[field]) merged[key][field] = {...previous[field], ...patch[field]};
    }
  }
  return merged;
}

export function writeSourcePatches(doc, patches) {
  doc.getElementById(DATA_ID)?.remove();
  doc.getElementById(RUNTIME_ID)?.remove();
  if (!Object.keys(patches).length) return;
  const data = doc.createElement('script');
  data.id = DATA_ID;
  data.type = 'application/json';
  data.textContent = JSON.stringify(patches).replace(/</g, '\\u003c');
  const runtime = doc.createElement('script');
  runtime.id = RUNTIME_ID;
  runtime.textContent = `(() => {
    // The editor applies saved patches together with the current draft in one engine.
    if (new URLSearchParams(location.search).get('visual-editor') === '1' && parent !== window) return;
    const patches = JSON.parse(document.getElementById('${DATA_ID}').textContent);
    const engine = (${createVisualPatchEngine.toString()})(document);
    let timer;
    const apply = () => { engine.apply(patches); observer.takeRecords(); };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 60); });
    observer.observe(document.documentElement, {subtree:true, childList:true, characterData:true});
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', apply);
    else apply();
  })();`;
  doc.body.append(data, runtime);
}
