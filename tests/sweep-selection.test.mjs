import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentIntersectsRect} from '../sweep-selection.mjs';
const rect={left:100,right:105,top:30,bottom:50};
test('a fast segment crosses a narrow component even if neither endpoint is inside',()=>{
  assert.equal(segmentIntersectsRect({x:0,y:40},{x:300,y:40},rect),true);
});
test('segment intersection includes padding and rejects near misses and empty diagonal areas',()=>{
  assert.equal(segmentIntersectsRect({x:0,y:52},{x:300,y:52},rect),true);
  assert.equal(segmentIntersectsRect({x:0,y:54},{x:300,y:54},rect),false);
  assert.equal(segmentIntersectsRect({x:0,y:0},{x:300,y:300},rect),false);
  assert.equal(segmentIntersectsRect({x:102,y:40},{x:102,y:40},rect),true);
});
