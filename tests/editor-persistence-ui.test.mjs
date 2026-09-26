import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('editor exposes project persistence instead of a browser-only save action', async () => {
  const html = await readFile(new URL('../editor.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../editor.js', import.meta.url), 'utf8');

  assert.match(html, /id="save-button"[^>]*>保存到项目</);
  assert.match(html, /浏览器草稿自动保存/);
  assert.match(script, /from '\.\/project-persistence\.mjs'/);
  assert.match(script, /saveToSource\(/);
  assert.match(script, /loadProjectEdits\(fetch\)/);
});
