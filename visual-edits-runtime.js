(async () => {
  if(window.__visualEditorHistoryPreview)return;
  // The editor owns its iframe state, including unsaved drafts and undo history.
  if (new URLSearchParams(location.search).get('visual-editor') === '1' && window.parent !== window) return;
  const { createVisualPatchEngine } = await import('/editor/visual-patch-engine.mjs');
  const engine = createVisualPatchEngine(document);
  let patches = {};
  let timer;
  const apply = () => {
    engine.apply(patches);
    observer.takeRecords();
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(apply, 60);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  try {
    const project = window.__visualEditorProject;
    const endpoint = project ? `/api/visual-edits?${new URLSearchParams({project:project.id,entry:project.entry})}` : 'visual-edits.json';
    const response = project ? await fetch(endpoint, { cache: 'no-store' }) : await fetch('visual-edits.json', { cache: 'no-store' });
    if (response.ok) patches = (await response.json()).patches || {};
    apply();
  } catch (error) { console.warn('无法加载项目调整', error); }
  addEventListener('hashchange', () => setTimeout(apply, 80));
})();
