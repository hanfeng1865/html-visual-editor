import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutPRDMarkers} from '../prd-annotations-runtime.mjs';

test('dense nested markers stay inside the viewport without overlapping',()=>{
 const candidates=Array.from({length:20},(_,index)=>({id:String(index),rect:{left:index<4?-8:20+(index-4)*22,top:index<4?-10:5,width:100,height:80}}));
 const placed=layoutPRDMarkers(candidates,{width:600,height:300});
 assert.equal(placed.length,20);
 for(const item of placed){assert.ok(item.x>=4&&item.y>=4&&item.x+22<=596&&item.y+22<=296);}
 for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)assert.ok(Math.abs(placed[i].x-placed[j].x)>=26||Math.abs(placed[i].y-placed[j].y)>=26,'number buttons must not overlap');
});
test('offscreen targets and targets covered by the open panel do not leave floating numbers',()=>{
 const placed=layoutPRDMarkers([{id:'visible',rect:{left:20,top:20,width:100,height:50}},{id:'offscreen',rect:{left:20,top:-200,width:100,height:50}},{id:'covered',rect:{left:450,top:20,width:40,height:40}}],{width:600,height:300,reserved:{left:400,top:0,right:600,bottom:300}});
 assert.deepEqual(placed.map(p=>p.id),['visible']);
});

test('block pins stay at their own upper-left corner and clear scrollbar tracks',()=>{
 const placed=layoutPRDMarkers([{id:'header',rect:{left:20,top:12,width:550,height:76}}],{width:600,height:300,exterior:true,obstacles:[{left:578,right:600,top:0,bottom:300}]});
 assert.equal(placed.length,1);
 assert.ok(placed[0].x+22<=578,'the full marker must remain clear of the scrollbar');
 assert.deepEqual(placed[0],{id:'header',x:9,y:4});
});

test('blocked upper-left anchors never migrate to the next section',()=>{
 const placed=layoutPRDMarkers([{id:'header',rect:{left:40,top:40,width:500,height:100}}],{width:600,height:300,exterior:true,obstacles:[{left:0,right:100,top:0,bottom:90}]});
 assert.deepEqual(placed,[],'keep the sidebar entry instead of moving the pin to a lower or right corner');
});
