import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAITasks} from '../ai-task-steering.mjs';
const element=(selector,x=0)=>({selector,label:selector,html:'<div></div>',rect:{x,y:0,width:10,height:10}});
const task=(request,images=[],selection=null)=>({request,attachments:{images,selection}});
test('steering preserves original goals and appends newer directions with precedence',()=>{
 const original=task('把标题改成红色'),next=task('改成蓝色，并增大字号');
 const merged=mergeAITasks(original,next);
 assert.match(merged.request,/把标题改成红色[\s\S]*冲突时以此为准[\s\S]*改成蓝色，并增大字号/);
 assert.equal(original.request,'把标题改成红色');
 assert.match(mergeAITasks(merged,task('保留蓝色，加一个按钮')).request,/增大字号[\s\S]*加一个按钮/);
});
test('both instructions retain image and selection context without duplicate attachments',()=>{
 const image={name:'original',url:'data:a'},additional={name:'additional',url:'data:b'};
 const original=task('原要求',[image],{kind:'elements',elements:[element('#a')]});
 const next=task('补充',[image,additional],{kind:'elements',elements:[element('#b'),{...element('#a'),label:'最新定位'}]});
 const merged=mergeAITasks(original,next);
 assert.deepEqual(merged.attachments.images,[image,additional]);
 assert.deepEqual(merged.attachments.selection.elements.map(e=>e.selector),['#a','#b']);
 assert.equal(merged.attachments.selection.elements[0].label,'最新定位');
 merged.attachments.images[0].name='changed';assert.equal(image.name,'original');
});
test('empty region references and selected elements keep their full spatial context',()=>{
 const merged=mergeAITasks(task('原区域',[],{kind:'region',rect:{x:0,y:0,width:10,height:10},elements:[]}),task('新增元素',[],{kind:'elements',elements:[element('#b',20)]}));
 assert.equal(merged.attachments.selection.kind,'region');
 assert.deepEqual(merged.attachments.selection.rect,{x:0,y:0,width:30,height:10});
});
test('oversized merges are rejected before either task is consumed',()=>{
 assert.throws(()=>mergeAITasks(task('a'.repeat(12000)),task('b')),/12000/);
 assert.throws(()=>mergeAITasks(task('a',[{url:'a'},{url:'b'},{url:'c'}]),task('b',[{url:'d'}])),/3 张/);
 assert.throws(()=>mergeAITasks(task('a',[],{kind:'elements',elements:Array.from({length:8},(_,i)=>element('#'+i))}),task('b',[],{kind:'elements',elements:[element('#9')]})),/8 个/);
});
