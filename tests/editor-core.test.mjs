import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEditorState,
  deleteElement,
  moveElementPatch,
  upsertElementPatch,
  undoState,
  redoState,
  serializeEditorState,
} from '../editor-core.mjs';

test('moveElementPatch keeps the selector captured before the DOM move', () => {
  const state = moveElementPatch(
    createEditorState(),
    've-yesterday',
    '.compact-segment > button:nth-of-type(2)',
    '.compact-segment',
    0,
  );

  assert.deepEqual(state.patches['ve-yesterday'], {
    selector: '.compact-segment > button:nth-of-type(2)',
    position: { parent: '.compact-segment', index: 0 },
  });
});

test('upsertElementPatch merges visual changes for the same element', () => {
  let state = createEditorState();
  state = upsertElementPatch(state, 've-card-1', { text: '在职人数' });
  state = upsertElementPatch(state, 've-card-1', { styles: { color: '#1677ff' } });

  assert.deepEqual(state.patches['ve-card-1'], {
    text: '在职人数',
    styles: { color: '#1677ff' },
  });
});

test('undo and redo restore patch history', () => {
  let state = createEditorState();
  state = upsertElementPatch(state, 've-card-1', { text: '原始标题' });
  state = upsertElementPatch(state, 've-card-1', { text: '新标题' });

  state = undoState(state);
  assert.equal(state.patches['ve-card-1'].text, '原始标题');

  state = redoState(state);
  assert.equal(state.patches['ve-card-1'].text, '新标题');
});

test('a new edit clears redo history', () => {
  let state = createEditorState();
  state = upsertElementPatch(state, 've-card-1', { text: '第一次' });
  state = upsertElementPatch(state, 've-card-1', { text: '第二次' });
  state = undoState(state);
  state = upsertElementPatch(state, 've-card-1', { text: '第三次' });

  const afterRedo = redoState(state);
  assert.equal(afterRedo.patches['ve-card-1'].text, '第三次');
});

test('serialized state excludes transient history', () => {
  let state = createEditorState();
  state = upsertElementPatch(state, 've-card-1', { styles: { fontSize: '18px' } });

  const exported = JSON.parse(serializeEditorState(state));
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.patches['ve-card-1'].styles, { fontSize: '18px' });
  assert.equal('past' in exported, false);
  assert.equal('future' in exported, false);
});

test('deleteElement replaces visual edits with a persistent deletion patch', () => {
  let state = createEditorState();
  state = upsertElementPatch(state, 've-card-1', {
    selector: '#card-1',
    text: '旧标题',
    styles: { color: '#1677ff' },
  });

  state = deleteElement(state, 've-card-1', '#card-1');

  assert.deepEqual(state.patches['ve-card-1'], {
    selector: '#card-1',
    deleted: true,
  });
  assert.equal(state.past.length, 2);
});

test('createEditorState migrates previously hidden elements to deletions', () => {
  const state = createEditorState({
    patches: {
      've-card-1': { selector: '#card-1', hidden: true },
    },
  });

  assert.deepEqual(state.patches['ve-card-1'], {
    selector: '#card-1',
    deleted: true,
  });
});
