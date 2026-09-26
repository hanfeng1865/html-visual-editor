import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonVersions, initialComparisonId } from '../version-comparison.mjs';

test('the first version stays available before later saves and remains the default', () => {
  const versions=comparisonVersions([{id:'code-2',savedAt:'2026-09-25T00:00:00Z'},{id:'code-1',savedAt:'2026-09-20T00:00:00Z'}],false);
  assert.equal(versions[0].id,'original');
  assert.equal(initialComparisonId(versions),'original');
  assert.deepEqual(versions.slice(1).map(item=>item.id),['code-1','code-2']);
});

test('all projects compare against a separate initial snapshot, not a named working HTML', () => {
  const versions=comparisonVersions([]);
  assert.equal(versions.length,1);
  assert.equal(initialComparisonId(versions),'original');
  assert.match(versions[0].label,/初版副本/);
});
