import test from 'node:test';
import assert from 'node:assert/strict';

import { loadProjectEdits, mergeProjectAndDraft, saveProjectEdits } from '../project-persistence.mjs';

test('mergeProjectAndDraft only overlays browser patches when the draft is dirty', () => {
  const project = { version: 1, patches: { title: { selector: 'h1', text: '项目版本' } } };
  const draft = { version: 1, patches: { title: { selector: 'h1', text: '浏览器草稿' } } };

  assert.equal(mergeProjectAndDraft(project, draft, false).patches.title.text, '项目版本');
  assert.equal(mergeProjectAndDraft(project, draft, true).patches.title.text, '浏览器草稿');
});

test('loadProjectEdits reads the durable project patch file through the API', async () => {
  const expected = { version: 1, patches: { title: { selector: 'h1', text: '项目标题' } } };
  const fetchImpl = async (url, options) => {
    assert.equal(url, '/api/visual-edits');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => expected };
  };

  assert.deepEqual(await loadProjectEdits(fetchImpl), expected);
});

test('saveProjectEdits posts serialized patches and reports the server result', async () => {
  const state = { version: 1, patches: { card: { selector: '.card', styles: { padding: '16px' } } } };
  const fetchImpl = async (url, options) => {
    assert.equal(url, '/api/visual-edits');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), state);
    return { ok: true, json: async () => ({ ok: true, patchCount: 1 }) };
  };

  assert.deepEqual(await saveProjectEdits(fetchImpl, state), { ok: true, patchCount: 1 });
});

test('saveProjectEdits exposes a useful server error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: '磁盘写入失败' }) });
  await assert.rejects(() => saveProjectEdits(fetchImpl, { version: 1, patches: {} }), /磁盘写入失败/);
});
