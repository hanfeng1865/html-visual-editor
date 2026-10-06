import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequirementsStore} from '../requirements-store.mjs';

async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'requirements-'));t.after(()=>rm(root,{recursive:true,force:true}));let revision=1;
 const options={snapshot:async()=>({revision:revision++,files:{'index.html':'<html>original</html>'},hashes:{'index.html':'hash'}})};
 const store=createRequirementsStore(root,options),project={root:join(root,'project')};
 let state=await store.mutate(project,{version:0,action:'create',name:'测试迭代',scene:'new',scope:'all',pages:[],note:''});
 const id=state.iterations[0].id;
 const edit=async(action,input={})=>{state=await store.mutate(project,{version:state.version,id,action,...input});return state.iterations[0];};
 return {root,options,store,project,id,edit,get state(){return state;}};
}
test('lifecycle persists and completed documents are protected',async t=>{
 const c=await setup(t);await c.edit('start');await c.edit('document',{document:'# 文档'});await c.edit('finish');
 const store=createRequirementsStore(c.root,c.options);const state=await store.read(c.project);assert.equal(state.iterations[0].status,'done');assert.equal(state.iterations[0].document,'# 文档');
 await assert.rejects(store.mutate(c.project,{version:state.version,id:c.id,action:'document',document:'bad'}),{statusCode:409});
 assert.equal(state.iterations[0].initialSnapshot.files,undefined);assert.equal(state.iterations[0].completions[0].snapshot.files,undefined);
 assert.equal((await store.readFull(c.project)).iterations[0].initialSnapshot.files['index.html'],'<html>original</html>');
});
test('serialized concurrent edits reject stale updates across instances',async t=>{
 const c=await setup(t);const second=createRequirementsStore(c.root,c.options);
 const results=await Promise.allSettled([c.store,second].map((store,n)=>store.mutate(c.project,{version:c.state.version,id:c.id,action:'document',document:`change ${n}`})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
});
test('reopen and baseline references preserve completed snapshots',async t=>{
 const c=await setup(t);await c.edit('start');await c.edit('document',{document:'first'});await c.edit('finish');
 const original=(await c.store.readFull(c.project)).iterations[0].completions[0];
 const created=await c.store.mutate(c.project,{version:c.state.version,action:'create',name:'second',scene:'continue',scope:'all',baselineId:c.id});
 let state=await c.store.mutate(c.project,{version:created.version,id:c.id,action:'reopen'});
 state=await c.store.mutate(c.project,{version:state.version,id:c.id,action:'document',document:'revised'});
 await c.store.mutate(c.project,{version:state.version,id:c.id,action:'finish'});
 const full=await c.store.readFull(c.project);assert.deepEqual(full.iterations[0].completions[0],original);assert.deepEqual(full.iterations[1].baseline,original);assert.equal(full.iterations[0].initialSnapshot.revision,1);assert.equal(full.iterations[0].completions.length,2);
});
test('AI results use version checks, preserve initial snapshot and require suggestion acceptance',async t=>{
 const c=await setup(t);await c.edit('start');const version=c.state.version;await c.edit('document',{document:'human edit'});
 await assert.rejects(c.store.mutate(c.project,{version,id:c.id,action:'aiResult',result:{reply:'late',document:'stale'}}),{statusCode:409});
 let it=await c.edit('aiResult',{message:'新增导出',snapshot:{files:{'index.html':'new'},revision:99},result:{reply:'建议',questions:['格式？'],suggestions:[{title:'调整文档',reason:'补充',document:'candidate',request:'新增导出'}]}});
 assert.equal(it.document,'human edit');assert.equal(it.initialSnapshot.revision,1);assert.equal(it.lastAnalysis.revision,99);
 it=await c.edit('acceptDocument',{suggestionId:it.suggestions[0].id});assert.equal(it.document,'candidate');
 it=await c.edit('undoDocument');assert.equal(it.document,'human edit');
});
test('IDs cannot act as paths and malformed inputs cannot persist',async t=>{
 const c=await setup(t);
 await assert.rejects(c.store.mutate(c.project,{version:c.state.version,id:'../../secret',action:'document',document:'bad'}),{statusCode:400});
 await assert.rejects(c.edit('metadata',{scope:'partial',pages:['../secret']}),{statusCode:400});
 await assert.rejects(c.edit('material',{material:{kind:'image',name:'bad',url:'file:///etc/passwd'}}),{statusCode:400});
 await assert.rejects(c.edit('material',{material:{kind:'audio',name:'bad',url:'https://example.com/audio'}}),{statusCode:400});
 assert.equal((await c.store.read(c.project)).version,c.state.version);
});
test('audio transcription retains original and is explicitly unconfirmed',async t=>{
 const c=await setup(t);let it=await c.edit('material',{material:{kind:'audio',name:'会议录音',url:'data:audio/webm;base64,AQIDBA=='}});const audio=it.materials[0];
 it=await c.edit('transcript',{materialId:audio.id,text:'月息 8%，需确认单位'});
 assert.equal(it.materials[0].url,audio.url);assert.equal(it.materials[0].transcriptStatus,'unconfirmed');assert.equal(it.materials[0].text,'月息 8%，需确认单位');
 it=await c.edit('confirmTranscript',{materialId:audio.id,text:'已核实的文字稿'});assert.equal(it.materials[0].transcriptStatus,'confirmed');
 await c.edit('start');await c.edit('finish');
 const publicState=await c.store.read(c.project),full=await c.store.readFull(c.project);
 assert.equal(publicState.iterations[0].completions[0].materials,undefined);
 assert.equal(full.iterations[0].completions[0].materials[0].url,audio.url);
});
test('stale document suggestion is rejected and pending duplicates are merged',async t=>{
 const c=await setup(t);await c.edit('start');const result={reply:'建议',suggestions:[{title:'补充',request:'',document:'候选'}]};
 let it=await c.edit('aiResult',{message:'',result});const suggestionId=it.suggestions[0].id;assert.equal(it.messages.length,1);
 it=await c.edit('aiResult',{message:'',result});assert.equal(it.suggestions.length,1);
 await c.edit('document',{document:'人工新内容'});await assert.rejects(c.edit('acceptDocument',{suggestionId}),{statusCode:409});
 assert.equal((await c.store.read(c.project)).iterations[0].document,'人工新内容');
 it=await c.edit('aiResult',{message:'重新生成',result});assert.equal(it.suggestions.length,2);
 it=await c.edit('acceptDocument',{suggestionId:it.suggestions[1].id});assert.equal(it.document,'候选');
});

test('undo preserves the displaced document across reload and supports redo',async t=>{
 const c=await setup(t);await c.edit('start');await c.edit('document',{document:'# 已确认需求\n正文不可丢失'});
 const undone=await c.edit('undoDocument');assert.equal(undone.document,'');
 const reopened=createRequirementsStore(c.root,c.options);const saved=await reopened.read(c.project);
 assert.equal(saved.iterations[0].documentRedo?.at(-1)?.document,'# 已确认需求\n正文不可丢失');
 const redone=await c.edit('redoDocument');assert.equal(redone.document,'# 已确认需求\n正文不可丢失');
 await c.edit('undoDocument');const branched=await c.edit('document',{document:'# 新草稿'});
 assert.ok(branched.documentArchive.some(h=>h.document==='# 已确认需求\n正文不可丢失'),'editing after undo retains recoverable old text');
 assert.equal(branched.documentRedo.length,0);
});

test('accepting a legacy prototype suggestion only adds confirmed requirements to How',async t=>{
 const c=await setup(t);await c.edit('start');const original='# 5W2H\n\n## 6. How | 功能规则\n原有规则。\n\n## 7. How much\n预算待确认。';await c.edit('document',{document:original});
 let it=await c.edit('aiResult',{result:{reply:'建议',suggestions:[{title:'明确收款口径',request:'增长率采用固定 30 天口径。',entry:'index.html'}]}});const suggestionId=it.suggestions[0].id;
 it=await c.edit('acceptDocument',{suggestionId});assert.match(it.document,/原有规则/);assert.match(it.document,/增长率采用固定 30 天口径/);assert.ok(it.document.indexOf('明确收款口径')<it.document.indexOf('## 7. How much'));assert.ok(it.suggestions[0].documentAcceptedAt);assert.equal(it.suggestions[0].status,'applied');
 await assert.rejects(c.edit('acceptDocument',{suggestionId}),{statusCode:409});it=await c.edit('undoDocument');assert.equal(it.document,original);
});

test('submitted interview answers can be revised without changing the submitted document',async t=>{
 const c=await setup(t);await c.edit('start');await c.edit('document',{document:'已整理文档'});let it=await c.edit('questionnaire',{questions:[{text:'产品端？',options:['Web','H5']}]});const round=it.interviews[0],question=round.questions[0];await c.edit('questionAnswer',{interviewId:round.id,questionId:question.id,choice:0});await c.edit('aiResult',{interviewId:round.id,result:{reply:'已整理',document:'Web 文档'}});
 it=await c.edit('reviseAnswer',{questionId:question.id,choice:1,text:'供现场人员使用'});assert.equal(it.document,'Web 文档');assert.equal(it.interviews[0].questions[0].answer,'H5；补充：供现场人员使用');assert.equal(it.interviews[0].questions[0].answerHistory[0].answer,'Web');assert.ok(it.interviews[0].submittedAt);assert.ok(it.interviews[0].questions[0].needsDocumentSync);
});

test('analysis questions become one persisted round without regenerating or losing any of twelve questions',async t=>{
 const c=await setup(t);await c.edit('start');
 const questions=Array.from({length:12},(_,i)=>`待回答问题 ${i+1}？`);
 await c.edit('aiResult',{result:{reply:'请补充',questions}});
 let it=await c.edit('pendingQuestions');const round=it.interviews[0];
 assert.deepEqual(round.questions.map(q=>q.text),questions);
 await c.edit('pendingQuestions');assert.equal(c.state.iterations[0].interviews.length,1);
 it=await c.edit('questionAnswer',{interviewId:round.id,questionId:round.questions[0].id,text:'第一题答案'});
 assert.equal(it.questions.length,11);assert.equal(it.interviews[0].questions[0].needsDocumentSync,true);
 const reloaded=await createRequirementsStore(c.root,c.options).read(c.project);
 assert.equal(reloaded.iterations[0].interviews[0].questions.findIndex(q=>q.status==='pending'),1);
 it=await c.edit('questionAnswer',{interviewId:round.id,questionId:round.questions[0].id,skip:true});
 assert.ok(it.questions.includes(questions[0]));assert.equal(it.interviews[0].questions[0].needsDocumentSync,false);
});

test('refined question coverage exceeds one hundred and updates an unfinished queue without losing answers',async t=>{
 const c=await setup(t);await c.edit('start');
 await c.edit('aiResult',{result:{reply:'需要澄清',questions:['来源？','所有公式？']}});
 let it=await c.edit('pendingQuestions');const round=it.interviews[0];
 await c.edit('questionAnswer',{interviewId:round.id,questionId:round.questions[0].id,text:'企微'});
 const questions=Array.from({length:125},(_,i)=>`[Q${i+1}] 子功能规则${i+1}？`);
 it=await c.edit('aiResult',{result:{reply:'按子功能继续确认',questions,document:'# 细化文档'}});
 assert.equal(it.questions.length,125);
 const revised=it.interviews[0];assert.equal(revised.questions.length,126);
 assert.equal(revised.questions[0].answer,'企微');assert.ok(revised.questions[0].needsDocumentSync);
 assert.equal(revised.questions[1].text,questions[0]);assert.equal(revised.questions[1].status,'pending');
 assert.equal(revised.questions.some(q=>q.text==='所有公式？'),false);
});

test('finishing a skipped large round retains every pending question',async t=>{
 const c=await setup(t);await c.edit('start');
 const questions=Array.from({length:125},(_,i)=>`规则${i}？`);
 await c.edit('aiResult',{result:{reply:'逐个回答',questions}});
 const round=(await c.edit('pendingQuestions')).interviews[0];
 for(const q of round.questions)await c.edit('questionAnswer',{interviewId:round.id,questionId:q.id,skip:true});
 const it=await c.edit('finishQuestions',{interviewId:round.id});assert.deepEqual(it.questions,questions);
});

test('iteration deletion requires confirmation and preserves referenced baseline snapshots',async t=>{
 const c=await setup(t);await c.edit('start');await c.edit('document',{document:'# 原迭代'});await c.edit('finish');
 const state=await c.store.mutate(c.project,{version:c.state.version,action:'create',name:'后续迭代',scene:'continue',scope:'all',baselineId:c.id});
 const baseline=(await c.store.readFull(c.project)).iterations[1].baseline;
 await assert.rejects(c.store.mutate(c.project,{version:state.version,id:c.id,action:'delete'}),/确认/);
 assert.equal((await c.store.read(c.project)).iterations.length,2);
 await assert.rejects(c.store.mutate(c.project,{version:state.version-1,id:c.id,action:'delete',confirmed:true}),{statusCode:409});
 const deleted=await c.store.mutate(c.project,{version:state.version,id:c.id,action:'delete',confirmed:true});
 assert.equal(deleted.iterations.length,1);assert.equal(deleted.iterations[0].baselineId,null);
 assert.deepEqual((await c.store.readFull(c.project)).iterations[0].baseline,baseline);
 const empty=await c.store.mutate(c.project,{version:deleted.version,id:deleted.iterations[0].id,action:'delete',confirmed:true});
 assert.deepEqual(empty.iterations,[]);
 assert.deepEqual((await createRequirementsStore(c.root,c.options).read(c.project)).iterations,[]);
});

test('active iterations can be deleted without changing other iterations',async t=>{
 const c=await setup(t);await c.edit('start');
 const state=await c.store.mutate(c.project,{version:c.state.version,action:'create',name:'保留',scene:'new',scope:'all'});
 const retained=(await c.store.readFull(c.project)).iterations[1];
 await c.store.mutate(c.project,{version:state.version,id:c.id,action:'delete',confirmed:true});
 assert.deepEqual((await c.store.readFull(c.project)).iterations,[retained]);
});
