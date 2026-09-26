import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnnotations } from '../change-annotations-store.mjs';

test('annotation notes are persisted while older files default to an empty note map', () => {
  assert.deepEqual(validateAnnotations({ version:1, hidden:[], boxes:[] }).notes, {});

  const value = validateAnnotations({
    version:1,
    hidden:[],
    boxes:[],
    notes:{ 'box:box-1':'审核状态字段调整为新的审批口径' },
  });

  assert.deepEqual(value.notes, { 'box:box-1':'审核状态字段调整为新的审批口径' });
});

test('annotation marker colors persist and only allow supported values', () => {
  const result = validateAnnotations({
    version: 1,
    hidden: [],
    boxes: [],
    notes: {},
    colors: { 'patch:one': 'red', 'box:two': 'blue' },
  });

  assert.deepEqual(result.colors, { 'patch:one': 'red', 'box:two': 'blue' });
  assert.throws(() => validateAnnotations({ version:1, hidden:[], boxes:[], notes:{}, colors:{ 'patch:one':'green' } }), /颜色/);
});

test('annotation notes reject invalid or oversized values', () => {
  assert.throws(() => validateAnnotations({ version:1, hidden:[], boxes:[], notes:{ bad:42 } }), /格式无效/);
  assert.throws(() => validateAnnotations({ version:1, hidden:[], boxes:[], notes:{ bad:'x'.repeat(2001) } }), /格式无效/);
});
