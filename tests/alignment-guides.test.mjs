import test from 'node:test';
import assert from 'node:assert/strict';
import {alignmentSnap,alignmentMatches,unionRects} from '../alignment-guides.mjs';

const box=(left,top,width=100,height=40)=>({left,top,right:left+width,bottom:top+height});
test('snapped equal-sized elements expose both edges without redundant center or duplicate guides',()=>{
  const moving=box(202,102),target=box(0,100);
  const snap=alignmentSnap(moving,[target],6);
  assert.equal(snap.y.delta,-2);
  const actual=box(202,100);
  assert.deepEqual(alignmentMatches(actual,[target,target],.6),[
    {axis:'y',value:100,index:0},{axis:'y',value:140,index:2}
  ]);
});
test('guides include opposing edges but omit nearby unaligned coordinates',()=>{
  assert.deepEqual(alignmentMatches(box(100,80),[box(0,0)],.6),[{axis:'x',value:100,index:0}]);
  assert.deepEqual(alignmentMatches(box(101,81),[box(0,0)],.6),[]);
});
test('screen-pixel snapping tolerance scales with zoom and uses a group bounding box',()=>{
  const group=unionRects([box(10,10),box(140,60)]);
  assert.deepEqual(group,{left:10,right:240,top:10,bottom:100});
  assert.equal(alignmentSnap(group,[box(18,200)],6).x,null);
  assert.equal(alignmentSnap(group,[box(18,200)],6/.5).x.delta,8);
});

test('center guides remain available when differently sized elements only share a center',()=>{
  assert.deepEqual(alignmentMatches(box(200,100),[box(0,90,100,60)],.6),[{axis:'y',value:120,index:1}]);
});
