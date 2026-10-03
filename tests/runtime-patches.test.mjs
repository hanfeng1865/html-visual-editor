import test from 'node:test';
import assert from 'node:assert/strict';
import {isRuntimeOnlySelector, removeRuntimeOnlyPatches} from '../runtime-patches.mjs';

test('identifies generated workforce cards as runtime-only', () => {
  assert.equal(isRuntimeOnlySelector('#ha-organization-section .ha-business-roles > button.ha-business-role:nth-of-type(2)'), true);
  assert.equal(isRuntimeOnlySelector('#ha-organization-section h2'), false);
});

test('removes only runtime-only patches and keeps normal edits', () => {
  const result = removeRuntimeOnlyPatches({patches:{dynamic:{selector:'.ha-business-role'}, title:{selector:'#title',text:'新标题'}}});
  assert.deepEqual(result.patches, {title:{selector:'#title',text:'新标题'}});
});
