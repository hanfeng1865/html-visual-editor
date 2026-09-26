import test from 'node:test';
import assert from 'node:assert/strict';
import { textToolbarStyles, isTextToolbarTarget } from '../text-toolbar.mjs';

test('text toolbar toggles independent decorations without losing the other one', () => {
  assert.deepEqual(textToolbarStyles('underline', {textDecorationLine:'line-through'}), {textDecorationLine:'line-through underline'});
  assert.deepEqual(textToolbarStyles('strike', {textDecorationLine:'underline line-through'}), {textDecorationLine:'underline'});
});

test('text toolbar adjusts size and clears text formatting', () => {
  assert.deepEqual(textToolbarStyles('size-step', {fontSize:'16px'}, 1), {fontSize:'17px'});
  assert.deepEqual(textToolbarStyles('size', {}, 22), {fontSize:'22px'});
  assert.equal(textToolbarStyles('clear', {}).fontStyle, '');
  assert.equal(textToolbarStyles('clear', {}).textDecorationLine, '');
});

test('text toolbar accepts a writable leaf or empty table cell only', () => {
  assert.equal(isTextToolbarTarget({tagName:'TD',childElementCount:0,textContent:''}),true);
  assert.equal(isTextToolbarTarget({tagName:'DIV',childElementCount:0,textContent:''}),false);
  assert.equal(isTextToolbarTarget({tagName:'DIV',childElementCount:1,textContent:'文字'}),false);
});
