import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorState} from '../editor-core.mjs';

test('old selection halos are removed while genuine component shadows survive',()=>{
  const saved={patches:{image:{selector:'#image',styles:{boxShadow:'rgba(45, 121, 230, 0.133333) 0px 0px 0px 5px',left:'120px'}},card:{selector:'#card',styles:{boxShadow:'rgba(0, 0, 0, 0.2) 0px 2px 8px 0px'}}}};
  const state=createEditorState(saved);
  assert.deepEqual(state.patches.image.styles,{left:'120px'});
  assert.equal(state.patches.card.styles.boxShadow,saved.patches.card.styles.boxShadow);
  assert.ok(saved.patches.image.styles.boxShadow);
});
