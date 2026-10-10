import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPRDAnnotationsService,revisePRDDocument} from '../prd-annotations-service.mjs';

test('generation uses requirements, validates targets and persists with conflict protection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-'));
 const project={root,entry:'index.html',annotationsFile:join(root,'private','notes.json')};
 let task;
 const requirements={read:async()=>({version:1,iterations:[{id:'it',status:'active',pages:['index.html'],document:'## 6. How\n输入后自动搜索。\n\n## 7. How much\n待确认'}]})};
 const ai={discussRequirements:async input=>{task=input.task;return {points:[{target:'t1',type:'interaction',title:'搜索框',content:'输入后自动搜索'}]};}};
 const service=createPRDAnnotationsService({ai,requirements});
 try {
  const generated=await service.generate(project,{targets:[{id:'t1',selector:'#search',text:'搜索'}]});
  assert.match(task.document,/自动搜索/);assert.equal(generated.points[0].selector,'#search');
  assert.equal((await service.read(project)).points.length,1);
  const edited={...generated,points:generated.points.map(p=>({...p,content:'回车立即搜索'}))};
  const saved=await service.save(project,{...edited,revise:false});assert.equal(saved.points[0].content,'回车立即搜索');
  await assert.rejects(service.save(project,edited),/更新/);
  ai.discussRequirements=async()=>({points:[{target:'other',type:'rule',title:'未知',content:'未知'}]});
  await assert.rejects(service.generate(project,{targets:[{id:'t1',selector:'#search',text:'搜索'}],revision:saved.revision}),/定位/);
  assert.equal((await service.read(project)).points[0].content,'回车立即搜索');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('revision keeps other chapters and replaces previous annotation rules without duplication',()=>{
 const doc='## 6. How｜功能规则\n原有需求\n\n## 7. How much｜投入\n预算待确认';
 const points=[{id:'1',type:'interaction',title:'搜索框',content:'回车立即搜索'}];
 const result=revisePRDDocument(doc,'index.html',points);
 assert.match(result,/原有需求/);assert.match(result,/回车立即搜索/);assert.ok(result.indexOf('回车立即搜索')<result.indexOf('## 7.'));
 const again=revisePRDDocument(result,'index.html',[{...points[0],content:'输入300ms后搜索'}]);
 assert.doesNotMatch(again,/回车立即搜索/);assert.equal(again.split('输入300ms后搜索').length,2);assert.match(again,/预算待确认/);
});

test('failed document revision preserves saved annotations and a retry merges only hand-edited rules',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-sync-')),project={root,entry:'index.html',annotationsFile:join(root,'notes.json')};
 let state={version:1,iterations:[{id:'it',status:'active',pages:['index.html'],document:'## 6. How\n保留原文\n\n## 7. How much\n待确认'}]},reject=true;
 const requirements={read:async()=>state,change:async(_p,input)=>{if(reject)throw new Error('需求已更新');state={...state,version:state.version+1,iterations:[{...state.iterations[0],document:input.document}]};}};
 const service=createPRDAnnotationsService({requirements,ai:{discussRequirements:async()=>({points:[{target:'t1',type:'interaction',title:'搜索',content:'原说明'},{target:'t2',type:'rule',title:'导出',content:'未经手改的说明'}]})}});
 try{
  const first=await service.generate(project,{targets:[{id:'t1',selector:'#search',text:'搜索'},{id:'t2',selector:'#export',text:'导出'}]});
  const input={...first,revise:true,points:first.points.map((p,i)=>i===0?{...p,content:'修订搜索规则'}:p)};
  await assert.rejects(service.save(project,input),/需求已更新/);assert.equal((await service.read(project)).revision,first.revision);
  reject=false;const saved=await service.save(project,input);assert.deepEqual(saved.pendingIds,[]);assert.match(state.iterations[0].document,/保留原文/);assert.match(state.iterations[0].document,/修订搜索规则/);assert.doesNotMatch(state.iterations[0].document,/未经手改/);
  saved.points[0].content='第二次修订';await service.save(project,{...saved,revise:true});assert.match(state.iterations[0].document,/第二次修订/);assert.doesNotMatch(state.iterations[0].document,/修订搜索规则/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('generated repeated controls persist one rule with all anchors and cannot move during manual save',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-repeated-')),project={root,entry:'index.html',annotationsFile:join(root,'notes.json')};
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async()=>({points:[{target:'t1',type:'interaction',title:'行级跟进',content:'按所选行查看跟进，逾期状态需提醒'}]})}});
 try{
 const generated=await service.generate(project,{targets:[{id:'t1',selector:'#a',selectors:['#a','#b'],text:'跟进',repeatedCount:2}]});assert.equal(generated.points.length,1);assert.deepEqual(generated.points[0].selectors,['#a','#b']);
 const saved=await service.save(project,{...generated,points:[{...generated.points[0],content:'手改共享规则'}]});assert.deepEqual(saved.points[0].selectors,['#a','#b']);
 await assert.rejects(service.save(project,{...saved,points:[{...saved.points[0],selectors:['#a','#different']}]}),/定位/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('supplement generates hidden tab requirements while preserving existing manual annotations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-tabs-')),project={root,entry:'index.html',annotationsFile:join(root,'notes.json')};
 let calls=[];const ai={discussRequirements:async({task})=>{calls.push(task.targets);return {points:task.targets.map(t=>({target:t.id,type:'rule',title:t.text,content:'依据需求说明 '+t.text}))};}};
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai});
 try{
 const first=await service.generate(project,{targets:[{id:'first',selector:'#overview',text:'总览'}]});
 const saved=await service.save(project,{...first,points:[{...first.points[0],content:'用户手改规则'}]});
 const completed=await service.generate(project,{mode:'supplement',revision:saved.revision,targets:[{id:'first',selector:'#overview',text:'总览'},{id:'capital',selector:'#available',text:'可用资金',scope:'#capital-panel',scopeTitle:'资金调度',required:true},{id:'third',selector:'#open-detail',text:'查看应收',scope:'#receivables-panel',scopeTitle:'应收与逾期',required:true}]});
 assert.equal(completed.points.length,3);assert.equal(completed.points[0].content,'用户手改规则');assert.deepEqual(completed.pendingIds,saved.pendingIds);assert.equal(completed.points[1].scope,'#capital-panel');assert.equal(calls.slice(1).flat().some(t=>t.id==='first'),false);
 ai.discussRequirements=async()=>({points:[]});await assert.rejects(service.generate(project,{mode:'supplement',revision:completed.revision,targets:[{id:'missing',selector:'#other-card',text:'漏掉的指标',required:true}]}),/标注|遗漏|覆盖/);assert.equal((await service.read(project)).points.length,3);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('one region annotation covers multiple required controls without creating duplicate pins',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-region-')),project={entry:'index.html',annotationsFile:join(root,'notes.json')};
 let response={points:[{target:'chart',targets:['chart','people','period','total'],type:'rule',title:'加班时长',content:'对象：人员或部门；时间：昨日、本周、上周、自定义；口径：累计或平均。趋势图：展示排序、单位与空数据状态，未知统计规则待确认。'}]};
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async()=>response}});
 const targets=['chart','people','period','total'].map(id=>({id,selector:'#'+id,text:id,required:true,region:'#overtime'}));
 try{
  const generated=await service.generate(project,{targets});
  assert.equal(generated.points.length,1);assert.deepEqual(generated.points[0].selectors,['#chart','#people','#period','#total']);
  response={points:[{...response.points[0],targets:['chart','people','unknown']}]};
  await assert.rejects(service.generate(project,{targets,revision:generated.revision}),/定位/);
  assert.equal((await service.read(project)).revision,generated.revision);
  response={points:[{...response.points[0],targets:['chart','people','period','total','outside']}]};
  await assert.rejects(service.generate(project,{revision:generated.revision,targets:[...targets,{id:'outside',selector:'#outside',text:'独立流程',required:true,region:'#other'}]}),/区域/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('reorganizing dense automatic annotations retains saved manual rules and covers the remaining region',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-organize-')),project={entry:'index.html',annotationsFile:join(root,'notes.json')};
 let compact=false;
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async({task})=>({points:compact?[{target:task.targets[0].id,targets:task.targets.map(t=>t.id),type:'rule',title:'趋势图',content:'整块图表规则'}]:task.targets.map(t=>({target:t.id,type:'rule',title:t.text,content:'原说明'}))})}});
 const targets=['chart','period','total'].map(id=>({id,selector:'#'+id,text:id,required:true,region:'#overtime'}));
 try{
  const first=await service.generate(project,{targets});
  const saved=await service.save(project,{...first,points:first.points.map((p,i)=>i===0?{...p,content:'手改统计规则'}:p)});
  compact=true;const organized=await service.generate(project,{targets,revision:saved.revision,mode:'organize'});
  assert.equal(organized.points.length,2);assert.equal(organized.points[0].content,'手改统计规则');assert.equal(organized.points[0].id,saved.points[0].id);
  assert.deepEqual(organized.points[1].selectors,['#period','#total']);assert.deepEqual(organized.pendingIds,saved.pendingIds);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('block regeneration retains manual records, folds old child rules, caps pages and protects child anchors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-block-save-')),project={entry:'index.html',annotationsFile:join(root,'notes.json')};
 let block=false;
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async({task})=>({points:task.targets.map(t=>({target:t.id,type:'rule',title:t.title||t.text,content:block?'这是筛选区块。切换条件刷新数据。':'原始规则',...(block?{details:[{title:'例外',content:'无权限时隐藏导出',type:'boundary'}]}:{})}))})}});
 try{
  const first=await service.generate(project,{targets:['one','two'].map(id=>({id,selector:'#'+id,text:id,required:true}))});
  const saved=await service.save(project,{...first,points:first.points.map((p,i)=>i? p:{...p,content:'用户手改必须保留'})});block=true;
  const result=await service.generate(project,{revision:saved.revision,mode:'organize',granularity:'block',targets:[{id:'block',selector:'#filters',selectors:['#filters','#one','#two'],text:'筛选条',title:'筛选条',required:true,granularity:'block',repeatedCount:2,existingIds:first.points.map(p=>p.id)}]});
  assert.deepEqual(result.points[0],saved.points[0]);assert.equal(result.points[1].granularity,'block');assert.match(result.points[1].content,/共 2 项/);assert.equal(result.points[1].children.length,2);assert.equal(result.points[1].children.find(p=>p.id===first.points[1].id).content,'原始规则');
  const archive=JSON.parse(await readFile(join(root,'.prd-annotation-history',saved.revision+'.json'),'utf8'));assert.deepEqual(archive.points,saved.points);
  const changed=structuredClone(result);changed.points[1].children[0].content='修改子项边界';changed.points[1].children[0].manual=true;const edited=await service.save(project,changed);assert.ok(edited.manualIds.includes(result.points[1].id));assert.equal(edited.points[1].children[0].content,'修改子项边界');
  const moved=structuredClone(edited);moved.points[1].children[0].selector='#outside';await assert.rejects(service.save(project,moved),/定位/);
  await assert.rejects(service.generate(project,{revision:edited.revision,granularity:'block',targets:Array.from({length:16},(_,i)=>({id:'b'+i,selector:'#b'+i,text:'block',required:true}))}),/15/);
 }finally{await rm(root,{recursive:true,force:true});}
});
