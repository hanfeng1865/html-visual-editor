import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionLayoutOffsets} from '../selection-layout.mjs';
const rects=[{left:20,right:70,top:40,bottom:80},{left:110,right:190,top:100,bottom:120},{left:250,right:280,top:180,bottom:240}];
test('six alignment actions use selection bounds and preserve the other axis',()=>{
  const expected={left:[0,-90,-230],'center-x':[105,0,-115],right:[210,90,0],top:[0,-60,-140],'center-y':[80,30,-70],bottom:[160,120,0]};
  for(const [action,values] of Object.entries(expected)) {
    const axis=['left','center-x','right'].includes(action)?'x':'y';
    assert.deepEqual(selectionLayoutOffsets(rects,action),values.map(value=>axis==='x'?{x:value,y:0}:{x:0,y:value}),action);
  }
});
test('distribution equalizes edge gaps for unequal sizes and keeps both endpoints',()=>{
  const shuffled=[rects[2],rects[0],rects[1]];
  const offsets=selectionLayoutOffsets(shuffled,'distribute-x');
  assert.deepEqual(offsets,[{x:0,y:0},{x:0,y:0},{x:10,y:0}]);
  assert.deepEqual(selectionLayoutOffsets(rects,'distribute-y'),[{x:0,y:0},{x:0,y:20},{x:0,y:0}]);
});
test('distribution requires three elements and alignment requires two',()=>{
  assert.deepEqual(selectionLayoutOffsets(rects.slice(0,2),'distribute-x'),[{x:0,y:0},{x:0,y:0}]);
  assert.deepEqual(selectionLayoutOffsets(rects.slice(0,1),'top'),[{x:0,y:0}]);
});
