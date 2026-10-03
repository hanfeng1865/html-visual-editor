import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectHtml } from '../project-workspaces.mjs';

test('linked HTML loads a shared runtime that reapplies durable visual edits', async () => {
  const prototype = projectHtml(await readFile(new URL('../examples/demo/index.html', import.meta.url), 'utf8'), 'demo', 'index.html');
  const runtime = await readFile(new URL('../visual-edits-runtime.js', import.meta.url), 'utf8');

  assert.match(prototype, /<script src="\/editor\/visual-edits-runtime\.js" defer><\/script>/);
  assert.match(runtime, /fetch\(['"]visual-edits\.json/);
  const engine = await readFile(new URL('../visual-patch-engine.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /createVisualPatchEngine/);
  assert.match(engine, /patch\.text/);
  assert.match(engine, /patch\.styles/);
  assert.match(engine, /patch\.deleted/);
  assert.match(engine, /patch\.position/);
  assert.match(runtime, /MutationObserver/);
});

test('dynamic runtime text is not overwritten by saved visual-editor patches', async () => {
  const engine = await readFile(new URL('../visual-patch-engine.mjs', import.meta.url), 'utf8');
  const editor = await readFile(new URL('../editor.js', import.meta.url), 'utf8');

  assert.match(engine, /closest\('\[data-ve-dynamic\]'\)/);
  assert.match(engine, /patch\.ai\?\.fields\?\.text/);
});
