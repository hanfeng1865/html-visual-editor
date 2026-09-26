import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDevServer } from '../dev-server.mjs';

test('development server serves files and persists visual edits through the API', async t => {
  const root = await mkdtemp(join(tmpdir(), 'visual-server-'));
  await mkdir(join(root, 'editor'));
  await writeFile(join(root, 'editor', 'editor.html'), '<h1>编辑器</h1>');
  await writeFile(join(root, 'visual-edits.json'), '{"version":1,"patches":{}}');
  const server = createDevServer({ rootDir: root, editorDir: join(root, 'editor') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${base}/editor/editor.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /编辑器/);

  const payload = { version: 1, patches: { title: { selector: 'h1', text: '持久化' } } };
  const response = await fetch(`${base}/api/visual-edits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, patchCount: 1 });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'visual-edits.json'), 'utf8')), payload);
});

test('development server rejects paths outside the project root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'visual-server-path-'));
  await writeFile(join(root, 'visual-edits.json'), '{"version":1,"patches":{}}');
  const server = createDevServer({ rootDir: root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();

  const response = await fetch(`http://127.0.0.1:${address.port}/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(response.status, 403);
});
