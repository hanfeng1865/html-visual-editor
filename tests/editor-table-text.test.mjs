import test from 'node:test';
import assert from 'node:assert/strict';
import { elementLabel, textTargetsForElement } from '../editor-components.mjs';

function element(tagName, textContent='', childElementCount=0) {
  return {
    tagName,
    textContent,
    childElementCount,
    matches(selector) { return selector.split(',').some(name => name.trim().toUpperCase() === tagName); },
  };
}

test('an empty table cell exposes a writable text target', () => {
  for (const tag of ['TD','TH']) {
    const cell=element(tag);
    assert.deepEqual(textTargetsForElement(cell),[{element:cell,index:null,value:''}]);
    assert.equal(elementLabel(cell),'表格单元格');
  }
});

test('a container and a nonempty cell retain their existing text behavior', () => {
  assert.deepEqual(textTargetsForElement(element('DIV','',0)),[]);
  const cell=element('TD','  新字段  ');
  assert.deepEqual(textTargetsForElement(cell),[{element:cell,index:null,value:'新字段'}]);
});
