import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('editor opens in preview mode by default', async () => {
  const html = await readFile(new URL('../editor.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../editor.js', import.meta.url), 'utf8');

  assert.match(html, /<button class="active"[^>]*data-mode="preview">预览<\/button>/);
  assert.doesNotMatch(html, /<button class="active"[^>]*data-mode="edit">编辑<\/button>/);
  assert.match(html, /id="mode-label">预览模式</);
  assert.match(script, /let mode = 'preview';/);
});

test('canvas defaults to filling width and retains manual zoom', async () => {
  const html = await readFile(new URL('../editor.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../editor.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../editor.css', import.meta.url), 'utf8');

  assert.match(html, /id="canvas-zoom"/);
  assert.match(html, /<option value="width">铺满宽度/);
  assert.match(html, /<option value="1">100%/);
  assert.match(script, /zoomSelect.value==='width' \? widthScale/);
  assert.match(script, /Math\.min\(height,availableHeight\/scale\)/);
  assert.match(css, /\.canvas-stage \{[^}]*margin:0 auto;/);
});
