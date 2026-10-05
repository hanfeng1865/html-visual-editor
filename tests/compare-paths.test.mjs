import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('experimental comparison page loads the prototype copy as current version', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.match(html, /id="current"[\s\S]*prototype\.html/);
  assert.doesNotMatch(html, /current'\)\.src = `index\.html/);
});

test('comparison page only toggles manually drawn change markers on the current version', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.match(html, /id="changes-toggle"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, />显示手动标记</);
  assert.doesNotMatch(html, /id="restore-markers"/);
  assert.doesNotMatch(html, /fetch\(['"]visual-edits\.json/);
  assert.match(html, /comparison-change-overlay/);
  assert.match(html, /editButton\.textContent = '✎'/);
  assert.match(html, /隐藏手动标记/);
  assert.doesNotMatch(html, /patchHasVisibleDifference/);
  assert.doesNotMatch(html, /patchTarget/);
  assert.match(html, /comparison-inline-toggle/);
  assert.match(html, /version-compare-link/);
  assert.doesNotMatch(html, /changeRectForTarget/);
});

test('change markers are rendered inside the current iframe only', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.match(html, /const doc = currentFrame\.contentDocument/);
  assert.match(html, /overlay = doc\.createElement\(['"]div['"]\)/);
  assert.doesNotMatch(html, /baselineDoc\.createElement\(['"]div['"]\)/);
});

test('manual boxes follow and clip to nested horizontal scroll containers', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.match(html, /boxScrollContainer/);
  assert.match(html, /const storageAnchor=scrollContainer\|\|anchor/);
  assert.match(html, /nestedScrollLeft/);
  assert.match(html, /visibleChangeRect\(target, scope, customRect, scrollContainer\)/);
});

test('each change marker exposes a persistent view and edit note entry', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.match(html, /annotationNoteKey/);
  assert.match(html, /addNoteButton/);
  assert.match(html, /逻辑说明/);
  assert.match(html, /annotations\.notes/);
  assert.match(html, /annotations\.colors/);
  assert.match(html, /标记颜色/);
  assert.match(html, /textarea\.scrollHeight/);
  assert.match(html, /overflowY:'hidden'/);
  assert.match(html, /min\(520px, calc\(100vw - 16px\)\)/);
  assert.match(html, /addResizeHandles/);
  assert.match(html, /调整手动标记范围/);
  assert.match(html, /tabViewForTarget/);
  assert.match(html, /boxViewMatches/);
});

test('all marker labels use the same compact outside treatment', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.match(html, /editButton\.textContent = '✎'/);
  assert.doesNotMatch(html, /label\.textContent = box \? '✎  手动标记' : '✎  已改动'/);
  assert.match(html, /top:hasRoomAbove \? '-23px' : hasRoomBelow \? 'calc\(100% \+ 4px\)' : '3px'/);
  assert.match(html, /opacity:'0\.82'/);
  assert.match(html, /label\.addEventListener\('mouseenter'/);
});

test('clicking a pencil selects manual markers for resizing while note clicks stay independent', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /function createResizableBoxFromMarker/);
  assert.match(html, /editButton\.textContent = '✎'/);
  assert.match(html, /editButton\.addEventListener\('click'/);
  assert.doesNotMatch(html, /annotations\.hidden/);
  assert.match(html, /button\.addEventListener\('pointerdown', event => event\.stopPropagation\(\)\)/);
});

test('comparison toolbar distinguishes visibility from marker editing and explains dialog scope', async () => {
  const html = await readFile(new URL('../compare-versions.html', import.meta.url), 'utf8');

  assert.match(html, /#changes-toggle::before \{ content:"◉"/);
  assert.match(html, /当前正在查看明细弹窗，关闭后可调整页面上的改动框/);
});
