import { createVisualPatchEngine } from './visual-patch-engine.mjs';

const LOCAL_IMAGE_ASSETS = [
  'collection.png',
  'customers.png',
  'dashboard.png',
  'declared.png',
  'details.png',
  'ordered.png',
  'pending.png',
  'profit.png',
  'receivable.png',
  'retained.png',
];

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

async function readRequired(fetchImpl, path, mode) {
  const response = await fetchImpl(path);
  if (!response.ok) throw new Error(`无法打包本地资源：${path}`);
  return mode === 'text' ? response.text() : response.arrayBuffer();
}

function contentType(response, path) {
  const fromHeader = response.headers?.get?.('content-type')?.split(';')[0];
  if (fromHeader) return fromHeader;
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

async function loadDataUri(fetchImpl, path) {
  const response = await fetchImpl(path);
  if (!response.ok) throw new Error(`无法打包本地资源：${path}`);
  const buffer = await response.arrayBuffer();
  return `data:${contentType(response, path)};base64,${arrayBufferToBase64(buffer)}`;
}

function createPatchRuntime(patches) {
  const serializedPatches = JSON.stringify(patches).replace(/</g, '\\u003c');
  return `
<script id="visual-editor-export-patches">
(() => {
  const patches = ${serializedPatches};
  const engine = (${createVisualPatchEngine.toString()})(document);
  const apply = () => { engine.apply(patches); observer.takeRecords(); };
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(apply, 60);
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  addEventListener('DOMContentLoaded', apply);
  addEventListener('hashchange', () => setTimeout(apply, 80));
  setTimeout(apply, 0);
  setTimeout(apply, 300);
  setTimeout(apply, 900);
})();
</script>`;
}

export async function createStandaloneHtml({ source, patches, fetchImpl = fetch }) {
  const assetEntries = await Promise.all(LOCAL_IMAGE_ASSETS.map(async name => {
    const path = `assets/${name}`;
    return [name, await loadDataUri(fetchImpl, path)];
  }));
  const assetMap = Object.fromEntries(assetEntries);
  const lucideSource = await readRequired(fetchImpl, 'assets/lucide.min.js', 'text');

  function packagePage(source, pagePatches) {
    source = source.replace(/<script\s+src=["'](?:editor\/)?visual-edits-runtime\.js["']\s*><\/script>/gi, '');
    let output = source.replace(
      /<script\s+src=["']assets\/lucide\.min\.js["']\s*><\/script>/i,
      () => `<script>\n${lucideSource.replace(/<\/script/gi, '<\\/script')}\n</script>`,
    );
    Object.entries(assetMap).forEach(([name, dataUri]) => {
      output = output.replaceAll(`assets/${name}`, dataUri);
    });
    const assetBootstrap = `<script>window.__visualEditorAssets=${JSON.stringify(assetMap).replace(/</g, '\\u003c')};</script>`;
    output = output.replace(/<head>/i, () => `<head>\n${assetBootstrap}`);
    output = output.replaceAll('assets/${icon}', "${window.__visualEditorAssets[icon] || ''}");
    output = output.replaceAll("(location.hash || '')", "(location.hash || window.__visualEditorCockpit || '')");
    return output.replace(/<\/body>/i, () => `${createPatchRuntime(pagePatches)}\n</body>`);
  }

  const output = packagePage(source, patches);
  if (!source.includes('version-compare-link') && !source.includes('version-v1-link')) return output;
  const [baselineSource, comparison] = await Promise.all([
    readRequired(fetchImpl, 'index-v1.0.html', 'text'),
    readRequired(fetchImpl, 'compare-versions.html', 'text'),
  ]);
  const annotationResponse = await fetchImpl('change-annotations.json');
  const annotations = annotationResponse.ok ? JSON.parse(await annotationResponse.text()) : {version:1, hidden:[], boxes:[], notes:{}, colors:{}};
  const bundle = { current: output, baseline: packagePage(baselineSource, {}), comparison, patches, annotations };
  const bootstrap = `<script>(${installOfflineNavigation.toString()})(${JSON.stringify(bundle).replace(/</g, '\\u003c')});</script>`;
  return output.replace(/<\/body>/i, () => `${bootstrap}\n</body>`);
}

// One self-contained download: every navigation target stays inside the file.
function installOfflineNavigation(bundle) {
  let viewer;
  let annotations = bundle.annotations;
  let hash = 2166136261;
  for (const char of JSON.stringify([bundle.patches, bundle.annotations, bundle.current.length])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const storageKey = 'jx-offline-annotations-' + (hash >>> 0).toString(36);
  try { annotations = JSON.parse(localStorage.getItem(storageKey)) || annotations; } catch {}
  const api = {
    get annotations() { return annotations; },
    saveAnnotations(value) {
      annotations = value;
      try { localStorage.setItem(storageKey, JSON.stringify(value)); return true; } catch { return false; }
    },
    patches: bundle.patches,
    page(kind, cockpit) {
      const init = `<script>window.__visualEditorOffline=parent.__visualEditorOffline;window.__visualEditorCockpit=${JSON.stringify(cockpit).replace(/</g, '\\u003c')};window.__visualEditorOffline.bind(document);<\/script>`;
      return bundle[kind].replace(/<head>/i, () => `<head>${init}`);
    },
    open(kind, cockpit) {
      if (!viewer) {
        viewer = document.createElement('div');
        viewer.id = 'offline-version-viewer';
        Object.assign(viewer.style, { position:'fixed', inset:'0', zIndex:'2147483647', background:'#fff', display:'flex', flexDirection:'column' });
        const close = document.createElement('button');
        close.textContent = '← 返回当前页面';
        Object.assign(close.style, { flex:'0 0 38px', textAlign:'left', padding:'0 16px', border:'0', background:'#eef5fc', color:'#1f5d9d', cursor:'pointer' });
        close.onclick = () => api.close();
        const frame = document.createElement('iframe');
        frame.title = '离线版本查看';
        Object.assign(frame.style, { flex:'1', width:'100%', minHeight:'0', border:'0' });
        viewer.append(close, frame);
        document.body.append(viewer);
      }
      viewer.querySelector('iframe').srcdoc = api.page(kind, cockpit);
    },
    close() { viewer?.remove(); viewer = null; },
    bind(doc) {
      doc.addEventListener('click', event => {
        const link = event.target.closest?.('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        const filename = href.split(/[?#]/)[0].split('/').pop();
        const kind = { 'compare-versions.html':'comparison', 'index-v1.0.html':'baseline', 'prototype.html':'current' }[filename];
        if (!kind) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const cockpit = href.split('#')[1] || doc.defaultView.__visualEditorCockpit || 'human-admin';
        if (kind === 'current') api.close();
        else api.open(kind, cockpit);
      }, true);
    },
  };
  window.__visualEditorOffline = api;
  api.bind(document);
}
