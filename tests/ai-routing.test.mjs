import test from 'node:test';import assert from 'node:assert/strict';
import {splitEditRoutes} from '../ai-routing.mjs';
test('splits individual fields and retains the exact AI intent',()=>{
 const patches={x:{selector:'#x',text:'new',styles:{color:'red'},ai:{fields:{text:'generated'},context:{label:'标题'}}},y:{selector:'#y',text:'normal'}};
 const result=splitEditRoutes(patches,()=>null);
 assert.deepEqual(result.direct,{x:{selector:'#x',styles:{color:'red'}},y:{selector:'#y',text:'normal'}});
 assert.equal(result.pending.x.text,'new');assert.equal(result.pending.x.ai.context.label,'标题');assert.equal(result.pending.x.styles,undefined);
});
test('routes dependencies of AI insertions together without losing unrelated edits',()=>{
 const patches={parent:{selector:'#new',insert:{parent:'#dynamic',html:'<div id="new"></div>'},ai:{fields:{insert:'runtime parent'},context:{}}},child:{selector:'#new',text:'value'},other:{selector:'#old',text:'direct'}};
 const result=splitEditRoutes(patches,()=>null,(selector,pending)=>Object.values(pending).some(p=>p.insert && p.selector===selector));
 assert.equal(result.pending.child.text,'value');assert.equal(result.direct.child,undefined);assert.equal(result.direct.other.text,'direct');
});
