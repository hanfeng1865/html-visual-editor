import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('visual editor only shows manually drawn change markers', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../editor.html', import.meta.url), 'utf8'),
    readFile(new URL('../editor.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="editor-changes-toggle"/);
  assert.match(html, /id="editor-box-toggle"/);
  assert.match(html, />显示手动标记</);
  assert.match(script, /fetch\(projectEndpoint\(['"]\/api\/change-annotations/);
  assert.match(script, /editor-change-overlay/);
  assert.match(script, /annotationNoteKey/);
  assert.match(script, /改动说明/);
  assert.match(script, /annotations\.notes/);
  assert.match(script, /annotations\.colors/);
  assert.match(script, /标记颜色/);
  assert.doesNotMatch(script, /savedProjectPatches/);
  assert.doesNotMatch(script, /patchHasVisibleDifference/);
  assert.doesNotMatch(script, /patchTarget/);
  assert.match(script, /annotations\.boxes/);
  assert.match(script, /startBoxSelection/);
  assert.match(script, /editor-box-selection/);
  assert.match(script, /const storageAnchor = scrollContainer \|\| anchor/);
  assert.match(script, /addDismissButton/);
  assert.match(script, /移除此改动标识/);
  assert.match(script, /annotations\.boxes = annotations\.boxes\.filter/);
  assert.match(script, /textarea\.scrollHeight/);
  assert.match(script, /overflowY:'hidden'/);
  assert.match(script, /min\(520px, calc\(100vw - 16px\)\)/);
  assert.match(script, /addResizeHandles/);
  assert.match(script, /调整手动标记范围/);
  assert.match(script, /tabViewForTarget/);
  assert.match(script, /boxViewMatches/);
});

test('editor maps numbered markers to a right-side annotation rail', async () => {
  const html = await readFile(new URL('../editor.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../editor.js', import.meta.url), 'utf8');

  assert.match(html, /id="annotation-rail"/);
  assert.match(html, /id="annotation-connectors"/);
  assert.match(script, /annotation-card-number/);
  assert.match(script, /drawAnnotationConnectors/);
  assert.match(script, /C \$\{startX \+ bend\}/);
  assert.match(script, /查看右侧改动说明/);
});

test('editor pencil selects manual markers without swallowing note clicks', async () => {
  const script = await readFile(new URL('../editor.js', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /function createResizableBoxFromMarker/);
  assert.match(script, /editButton\.textContent = '✎'/);
  assert.match(script, /editButton\.addEventListener\('click'/);
  assert.doesNotMatch(script, /annotations\.hidden/);
  assert.match(script, /button\.addEventListener\('pointerdown', event => event\.stopPropagation\(\)\)/);
});

test('editor explains why page markers are unavailable while a dialog is open', async () => {
  const script = await readFile(new URL('../editor.js', import.meta.url), 'utf8');

  assert.match(script, /当前正在查看明细弹窗，关闭后可调整页面上的改动框/);
});
