import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPRDAnnotationsService} from '../prd-annotations-service.mjs';
const block=(signature='a')=>({id:'stable',selector:'#card',title:'统计',text:'统计',fingerprint:{heading:'统计',path:'#card',signature},children:[]});
test('saving a snapped manual block creates its partition and preserves reviewed partitions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-snap-')),project={entry:'a.html',annotationsFile:join(root,'notes.json')};
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{}});
 try{
  let state=await service.save(project,{action:'confirm-partitions',blocks:[block()]});
  const added={...block(),id:'manual-card',selector:'#new-card',manual:true};
  const point={id:'snapped',blockId:added.id,type:'rule',title:'手动区块',content:'填写的说明。',source:'unconfirmed',status:'confirmed',manual:true};
  await assert.rejects(service.save(project,{...state,blocks:[...state.blocks,{...added,manual:false}],points:[point]}),/手动框选/);
  state=await service.save(project,{...state,blocks:[{...state.blocks[0],selector:'#changed'},added],points:[point]});
  assert.equal(state.blocks[0].selector,'#card');assert.equal(state.blocks[1].selector,'#new-card');assert.equal(state.points[0].selector,'#new-card');
  const reopened=await service.read(project);assert.equal(reopened.points[0].blockId,added.id);assert.equal(reopened.blocks[1].manual,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('manual drawn regions persist their geometry without an AI partition',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-drawn-')),project={entry:'a.html',annotationsFile:join(root,'notes.json')};
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{}});
 try{
  let state=await service.save(project,{action:'confirm-partitions',blocks:[]});
  const point={id:'drawn',blockId:null,selector:'#custom',region:{x:.1,y:.2,width:.4,height:.3},viewKey:'drawer',scope:'#drawer',scopeTitle:'详情',type:'rule',title:'人工区域',content:'选区规则。',source:'unconfirmed',status:'confirmed',manual:true};
  state=await service.save(project,{...state,points:[point]});const saved=(await service.read(project)).points[0];
  assert.deepEqual(saved.region,point.region);assert.equal(saved.selector,'#custom');assert.equal(saved.viewKey,'drawer');
  await assert.rejects(service.save(project,{...state,points:[{...point,region:{...point.region,width:2}}]}),/框选区域/);
  state=await service.save(project,{action:'confirm-partitions',revision:state.revision,blocks:[block()]});
  assert.equal(state.points[0].id,'drawn');assert.deepEqual(state.points[0].region,point.region);assert.equal(state.points[0].status,'confirmed');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('review before generation; unchanged blocks skipped, changed confirmed notes preserved with suggestions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-review-')),project={entry:'a.html',annotationsFile:join(root,'notes.json')};let calls=0;
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async({task})=>{calls++;return {points:task.targets.map(b=>({target:b.id,title:'统计口径',type:'rule',content:'范围待确认。',source:'unconfirmed'}))};}}});
 try{
 let state=await service.save(project,{action:'confirm-partitions',blocks:[block()]});assert.equal(calls,0);assert.equal(state.version,2);
 state=await service.generate(project,{revision:state.revision});assert.equal(state.points[0].status,'draft');const id=state.points[0].id;
 state.points[0].status='confirmed';state.points[0].content='人工规则。';state=await service.save(project,state);
 state=await service.generate(project,{revision:state.revision});assert.equal(calls,1);
 state=await service.save(project,{revision:state.revision,action:'confirm-partitions',blocks:[{...block('changed'),selector:'#moved'}]});
 assert.equal(state.points[0].status,'stale');assert.equal(state.points[0].selector,'#moved');
 state=await service.generate(project,{revision:state.revision});assert.equal(calls,2);assert.equal(state.points[0].content,'人工规则。');assert.equal(state.points[0].id,id);assert.ok(state.points[0].suggestion);
 await assert.rejects(service.save(project,{...state,points:[{...state.points[0],blockId:'outside'}]}),/区块/);
 const saved=await service.save(project,state);assert.ok(saved.points[0].manual);
 await assert.rejects(service.generate(project,{revision:state.revision}),/更新/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('AI may omit irrelevant blocks and cannot merge reviewed regions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-review-')),project={entry:'a.html',annotationsFile:join(root,'notes.json')};let reply={points:[]},calls=0;
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async()=>{calls++;return reply;}}});
 try{let state=await service.save(project,{action:'confirm-partitions',blocks:[block()]});state=await service.generate(project,{revision:state.revision});assert.equal(state.points.length,0);state=await service.generate(project,{revision:state.revision});assert.equal(calls,1);
 state=await service.save(project,{action:'confirm-partitions',blocks:[block('new')],revision:state.revision});reply={points:[{target:'stable',targets:['stable','outside'],type:'rule',title:'非法合并',content:'说明'}]};await assert.rejects(service.generate(project,{revision:state.revision}),/分区/);assert.equal((await service.read(project)).revision,state.revision);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing blocks stay stale, manual additions persist and a failed model call keeps approved geometry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-review-')),project={entry:'a.html',annotationsFile:join(root,'notes.json')};let calls=0;
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async()=>{calls++;throw new Error('model unavailable');}}});
 try{let state=await service.save(project,{action:'confirm-partitions',blocks:[block()]});
 await assert.rejects(service.generate(project,{revision:state.revision}),/unavailable/);assert.equal((await service.read(project)).blocks[0].id,'stable');
 state=await service.save(project,{...state,points:[{id:'manual',blockId:'stable',type:'rule',title:'人工说明',content:'人工口径。',source:'visible',status:'confirmed'}]});
 state=await service.save(project,{action:'confirm-partitions',revision:state.revision,blocks:[{...block(),missing:true}]});assert.equal(state.points[0].status,'stale');
 state=await service.generate(project,{revision:state.revision});assert.equal(calls,1);assert.equal(state.points[0].content,'人工口径。');assert.equal(state.points[0].manual,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('different drilldown views persist independent notes at the same DOM location',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-views-')),project={entry:'a.html',annotationsFile:join(root,'notes.json')};
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async({task})=>({points:task.targets.map(t=>({target:t.id,type:'rule',title:t.title,content:t.title+'规则。',source:'visible'}))})}});
 try{
  const a={...block(),id:'changes',viewKey:'changes',selector:'#drawer table',title:'异动记录'},b={...block(),id:'contracts',viewKey:'contracts',selector:'#drawer table',title:'劳动合同'};
  let state=await service.save(project,{action:'confirm-partitions',blocks:[a,b]});state=await service.generate(project,{revision:state.revision});
  assert.deepEqual(state.points.map(p=>p.viewKey),['changes','contracts']);state=await service.save(project,state);assert.deepEqual((await service.read(project)).points.map(p=>p.viewKey),['changes','contracts']);
  const oldContract=state.points.find(p=>p.viewKey==='contracts');state=await service.save(project,{action:'confirm-partitions',revision:state.revision,blocks:[{...a,fingerprint:{...a.fingerprint,signature:'new'}},b]});
  assert.equal(state.points.find(p=>p.viewKey==='changes').status,'stale');assert.deepEqual(state.points.find(p=>p.viewKey==='contracts'),{...oldContract,orphaned:false});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('document and saved answers refresh unchanged blocks with non-destructive parent and child suggestions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-knowledge-')),project={entry:'a.html',annotationsFile:join(root,'notes.json')};
 let iteration={id:'it',status:'active',pages:['a.html'],document:'刷新频率待确认。',extraAnswers:[]},calls=[];
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[iteration]})},ai:{discussRequirements:async({task})=>{calls.push(task);const content=task.confirmedAnswers.length?'每 5 分钟刷新一次。':'刷新频率待确认。';return {points:task.targets.map(b=>({target:b.id,title:'刷新规则',type:'rule',content,source:'visible',details:[{title:'刷新',type:'interaction',content,source:'visible'}]}))};}}});
 try{
  let state=await service.save(project,{action:'confirm-partitions',blocks:[block()]});state=await service.generate(project,{revision:state.revision});
  state.points[0].status='confirmed';state.points[0].children[0].status='confirmed';state.points[0].manual=true;state.points[0].children[0].manual=true;state=await service.save(project,state);const original=structuredClone(state.points[0]);
  state=await service.generate(project,{revision:state.revision});assert.equal(calls.length,1);
  iteration={...iteration,extraAnswers:[{id:'answer',text:'刷新频率？',answer:'每 5 分钟',status:'answered'}]};
  state=await service.generate(project,{revision:state.revision});assert.equal(calls.length,2);assert.equal(calls[1].confirmedAnswers[0].answer,'每 5 分钟');assert.equal(calls[1].document,'刷新频率待确认。');assert.equal(calls[1].knowledgeChanged,true);
  assert.equal(state.points[0].content,original.content);assert.equal(state.points[0].status,'confirmed');assert.equal(state.points[0].id,original.id);assert.match(state.points[0].suggestion.content,/5 分钟/);
  assert.equal(state.points[0].children[0].content,original.children[0].content);assert.equal(state.points[0].children[0].id,original.children[0].id);assert.match(state.points[0].children[0].suggestion.content,/5 分钟/);
  state=await service.save(project,state);assert.ok(state.points[0].children[0].suggestion);state=await service.generate(project,{revision:state.revision});assert.equal(calls.length,2);
  iteration={...iteration,document:'每 5 分钟刷新一次。'};state=await service.generate(project,{revision:state.revision});assert.equal(calls.length,3);
  const point={...state.points[0],content:'人工填写，仍需审核。',status:'draft'};state=await service.save(project,{...state,points:[point]});assert.equal(state.points[0].status,'draft','saving a manual edit must respect the chosen review state');
 }finally{await rm(root,{recursive:true,force:true});}
});


test('known current-page navigation is supplied as evidence and never turned into an unknown URL',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-navigation-')),project={entry:'index.html',annotationsFile:join(root,'notes.json')};let captured;
 const evidence=[{tag:'a',text:'首页',href:'index.html',navigation:true,current:true,samePage:true},{tag:'a',text:'关于我们',href:'about.html',navigation:true,current:false}];
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async({task})=>{captured=task;return {points:[{target:'stable',type:'interaction',title:'页头导航',content:'现有信息未提供链接地址或跳转方式。',source:'unconfirmed',details:[{title:'首页',type:'interaction',content:'具体链接地址待确认。',source:'unconfirmed'}]}]};}}});
 try{let state=await service.save(project,{action:'confirm-partitions',blocks:[{...block(),evidence}]});state=await service.generate(project,{revision:state.revision});assert.equal(captured.targets[0].evidence[0].current,true);assert.equal(captured.targets[0].evidence[1].href,'about.html');assert.doesNotMatch(state.points[0].content,/待确认|未提供/);assert.match(state.points[0].content,/当前选中页面/);assert.doesNotMatch(state.points[0].children[0].content,/待确认/);assert.equal(state.points[0].children[0].source,'visible');assert.equal(state.points[0].children[0].status,'draft','AI review state remains separate from business uncertainty');
 }finally{await rm(root,{recursive:true,force:true});}
});


test('a known CTA jump is one code-derived sentence with no duplicate AI child',async()=>{
 const root=await mkdtemp(join(tmpdir(),'prd-cta-')),project={entry:'index.html',annotationsFile:join(root,'notes.json')};
 const evidence=[{tag:'a',text:'认识原点',href:'about.html',destinationTitle:'关于我们'}];
 const service=createPRDAnnotationsService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async()=>({points:[{target:'stable',type:'interaction',title:'认识原点入口',content:'目标地址与打开方式待确认。',source:'unconfirmed',details:[{title:'认识原点',type:'interaction',content:'目标待确认。',source:'unconfirmed'}]}]})}});
 try{let state=await service.save(project,{action:'confirm-partitions',blocks:[{...block(),evidence}]});state=await service.generate(project,{revision:state.revision});assert.equal(state.points[0].content,'点击“认识原点”，跳转到“关于我们”。');assert.equal(state.points[0].children.length,0);assert.equal(state.points[0].status,'confirmed');assert.equal(state.points[0].source,'visible');}finally{await rm(root,{recursive:true,force:true});}
});

test('updated PRD skill reaches the model and rechecks unchanged blocks',async t=>{
 const {createGenerationSkills}=await import('../generation-skills.mjs');
 const root=await mkdtemp(join(tmpdir(),'prd-skills-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const skills=createGenerationSkills(root),project={entry:'a.html',annotationsFile:join(root,'notes.json')};const calls=[];
 const service=createPRDAnnotationsService({skills,requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async input=>{calls.push(input);return {points:input.task.targets.map(b=>({target:b.id,type:'rule',title:'规则',content:'等待业务确认',source:'unconfirmed'}))};}}});
 let state=await service.save(project,{action:'confirm-partitions',blocks:[block()]});state=await service.generate(project,{revision:state.revision});const first=state.skill.revision;
 state=await service.generate(project,{revision:state.revision});assert.equal(calls.length,1);
 const initial=await skills.get('prd-annotations'),saved=await skills.save({id:initial.id,revision:initial.revision,content:initial.content+'\nPRD_CUSTOM_RULE: 说明应按业务任务组织。\n'});
 state=await service.generate(project,{revision:state.revision});assert.equal(calls.length,2);assert.match(calls[1].instruction,/PRD_CUSTOM_RULE/);assert.equal(calls[1].task.skill.revision,saved.revision);assert.notEqual(state.skill.revision,first);assert.equal(state.skill.revision,saved.revision);
});
