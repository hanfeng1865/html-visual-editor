function responseError(response, body) {
  return new Error(body?.error || `项目保存失败（HTTP ${response.status}）`);
}

export function mergeProjectAndDraft(project, draft, draftIsDirty) {
  return {
    version: 1,
    patches: draftIsDirty
      ? { ...(draft?.patches || {}) }
      : { ...(project?.patches || {}) },
  };
}

export async function loadProjectEdits(fetchImpl = fetch, endpoint = '/api/visual-edits') {
  const response = await fetchImpl(endpoint, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw responseError(response, body);
  return body;
}

export async function saveProjectEdits(fetchImpl = fetch, state, endpoint = '/api/visual-edits') {
  const payload = { version: 1, patches: state?.patches || {} };
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw responseError(response, body);
  return body;
}
