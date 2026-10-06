import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDevServer} from '../dev-server.mjs';
import {createAIService} from '../ai-service.mjs';

async function fixture(t,{autoAccept=true}={}){
 const base=await mkdtemp(join(tmpdir(),'requirements-api-')),root=join(base,'project'),editor=join(base,'editor');await mkdir(root);await mkdir(editor);
 const original='<!doctype html><html><head><title>原型</title></head><body><h1 id="title">Old</h1></body></html>';
 await writeFile(join(root,'index.html'),original);
 const calls=[];let result={reply:'已整理，请确认计算口径。',document:'# 初稿',questions:['计算口径？'],suggestions:[]};
 const model=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url.endsWith('/audio/transcriptions')){calls.push({audio:body});res.setHeader('content-type','application/json');res.end(JSON.stringify({text:'每天 22 点生成快照'}));return;}
  const parsed=JSON.parse(body),content=parsed.messages[1].content;const task=JSON.parse(typeof content==='string'?content:content[0].text);calls.push(task);
  const value=task.request?{edits:[{path:'index.html',before:'<h1 id="title">Old</h1>',after:'<h1 id="title">New</h1>'}],explanation:'修改标题'}:result;
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof value==='string'?value:JSON.stringify(value)}}]}));
 });
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 await createAIService(editor).settings({endpoint:`http://127.0.0.1:${model.address().port}/v1`,model:'test',apiKey:'test-key'});
 const server=createDevServer({rootDir:root,editorDir:editor});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();model.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>model.close(r))]);await rm(base,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const opened=await fetch(origin+'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:root})}).then(r=>r.json());
 const api=async(path,input,status=200)=>{
  const response=await fetch(`${origin}/api/requirements${path}?project=${opened.id}`,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));
  const review=value.iterations?.find(i=>i.id===input?.id)?.documentReviews?.findLast(r=>r.status==='pending');
  if(autoAccept&&path==='/chat'&&status===200&&review){const accepted=await fetch(`${origin}/api/requirements?project=${opened.id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'acceptReview',id:input.id,version:value.version,reviewId:review.id})});const state=await accepted.json();assert.equal(accepted.status,200,JSON.stringify(state));return state;}return value;
 };
 let state=await api('',{action:'create',version:0,name:'测试迭代',scene:'new',scope:'all'});const id=state.iterations[0].id;
 state=await api('',{action:'start',version:state.version,id});
 return {root,original,calls,id,api,get state(){return state;},set result(value){result=value;},async change(action,extra={}){state=await api('',{action,id,version:state.version,...extra});return state;},async chat(message){state=await api('/chat',{id,version:state.version,message});return state;},setState(value){state=value;}};
}

test('requirements routes lifecycle, automatic re-entry, external changes and safe document proposals',async t=>{
 const c=await fixture(t);assert.equal(c.state.iterations[0].status,'active');assert.deepEqual(c.state.iterations[0].pages,['index.html']);
 await c.chat('');assert.equal(c.state.iterations[0].document,'# 初稿');assert.equal(c.state.iterations[0].messages.length,2);assert.equal(c.calls.length,1);
 const version=c.state.version;await c.chat('');assert.equal(c.state.version,version);assert.equal(c.calls.length,1);
 await c.change('document',{document:'# 人工确认内容'});
 await writeFile(join(c.root,'index.html'),c.original.replace('Old','External'));
 c.result={reply:'原型已变化，建议更新文档。',document:'# 模型候选',questions:[],suggestions:[]};
 await c.chat('');assert.match(c.calls.at(-1).files['index.html'],/External/);assert.deepEqual(c.calls.at(-1).changedFiles,['index.html']);
 assert.equal(c.state.iterations[0].document,'# 模型候选');assert.equal(c.state.iterations[0].document,'# 模型候选');
 await c.api('/chat',{id:c.id,version:version,message:'过期'},409);
 const before=await c.api('');c.result='not JSON';await c.api('/chat',{id:c.id,version:before.version,message:'继续'},502);assert.deepEqual(await c.api(''),before);
 c.result={reply:'bad',questions:[],suggestions:[{title:'越界',reason:'',request:'修改',entry:'../outside.html'}]};await c.api('/chat',{id:c.id,version:before.version,message:'继续'},502);assert.deepEqual(await c.api(''),before);
 await c.change('finish');assert.equal(c.state.iterations[0].status,'done');await c.api('',{id:c.id,version:c.state.version,action:'document',document:'覆盖'},409);
 await c.change('reopen');assert.equal(c.state.iterations[0].status,'active');assert.equal(c.state.iterations[0].completions.length,1);
});

test('accepted sync is tied to its suggestion and verified before source save',async t=>{
 const c=await fixture(t);c.result={reply:'建议修改标题。',questions:[],suggestions:[{title:'修改标题',reason:'已确认',request:'把 Old 改为 New',entry:'index.html'},{title:'另一个修改',reason:'另一个',request:'其他要求',entry:'index.html'}]};await c.chat('修改标题');
 const [suggestion,other]=c.state.iterations[0].suggestions;const input={id:c.id,version:c.state.version,suggestionId:suggestion.id};
 const proposal=await c.api('/sync',{...input,phase:'generate'});assert.ok(proposal.id);assert.equal(await readFile(join(c.root,'index.html'),'utf8'),c.original);
 await c.api('/sync',{...input,suggestionId:other.id,phase:'apply',proposalId:proposal.id,verified:true},409);
 await c.api('/sync',{...input,phase:'apply',proposalId:proposal.id,verified:false},400);assert.equal(await readFile(join(c.root,'index.html'),'utf8'),c.original);
 const applied=await c.api('/sync',{...input,phase:'apply',proposalId:proposal.id,verified:true});assert.match(await readFile(join(c.root,'index.html'),'utf8'),/>New<\/h1>/);assert.equal(applied.state.iterations[0].suggestions[0].status,'applied');
});

test('audio route preserves the recording and marks transcription unconfirmed',async t=>{
 const c=await fixture(t);const url='data:audio/webm;base64,AQIDBA==';await c.change('material',{material:{name:'会议.webm',kind:'audio',url}});const material=c.state.iterations[0].materials[0];
 const result=await c.api('/transcribe',{id:c.id,version:c.state.version,materialId:material.id});assert.equal(result.iterations[0].materials[0].url,url);assert.equal(result.iterations[0].materials[0].text,'每天 22 点生成快照');assert.equal(result.iterations[0].materials[0].transcriptStatus,'unconfirmed');assert.match(c.calls.at(-1).audio,/whisper-1/);
});

test('question rounds persist choices, handwritten answers and skipped questions before synthesis',async t=>{
 const c=await fixture(t);
 c.result={questions:[{text:'本轮目标？',options:['演示验证','正式上线']},{text:'哪些人使用？',options:['经营负责人','财务']},{text:'预算？',options:[]}]};
 let state=await c.api('/interview',{id:c.id,version:c.state.version,count:3,optionCount:2});
 const round=state.iterations[0].interviews[0];assert.equal(round.questions.length,3);assert.equal(state.iterations[0].document,'');
 const answer=async(index,extra)=>{state=await c.api('',{id:c.id,version:state.version,action:'questionAnswer',interviewId:round.id,questionId:round.questions[index].id,...extra});};
 await answer(0,{choice:0,text:''});await answer(1,{choice:null,text:'财务和采购共同使用'});await answer(2,{skip:true});
 const saved=await c.api('');assert.equal(saved.iterations[0].interviews[0].questions[0].answer,'演示验证');assert.equal(saved.iterations[0].interviews[0].questions[1].answer,'财务和采购共同使用');assert.equal(saved.iterations[0].interviews[0].questions[2].status,'skipped');assert.equal(c.calls.length,1,'answers do not call AI individually');
 c.result={reply:'已补充草稿，预算仍待确认。',document:'# 5W2H\n预算待确认',questions:[],suggestions:[]};
 state=await c.api('/chat',{id:c.id,version:state.version,interviewId:round.id});
 assert.match(c.calls.at(-1).message,/财务和采购共同使用/);assert.match(c.calls.at(-1).message,/跳过/);assert.ok(state.iterations[0].interviews[0].submittedAt);assert.match(state.iterations[0].document,/预算待确认/);assert.ok(state.iterations[0].questions.includes('预算？'));
 await c.api('/chat',{id:c.id,version:state.version,interviewId:round.id},409);
});

test('invalid generated questions and out-of-range answers cannot replace state',async t=>{
 const c=await fixture(t);c.result={questions:[{text:'问题',options:['A',7]}]};await c.api('/interview',{id:c.id,version:c.state.version,count:1,optionCount:2},502);
 assert.equal((await c.api('')).version,c.state.version);
 c.result={questions:[{text:'目标？',options:['A','B']}]};const state=await c.api('/interview',{id:c.id,version:c.state.version,count:1,optionCount:2});const round=state.iterations[0].interviews[0];
 await c.api('',{id:c.id,version:state.version,action:'questionAnswer',interviewId:round.id,questionId:round.questions[0].id,choice:8,text:''},400);
});

 test('all skipped questions remain pending without another model call',async t=>{
 const c=await fixture(t);c.result={questions:[{text:'交付时间？',options:[]}]};let state=await c.api('/interview',{id:c.id,version:c.state.version,count:1,optionCount:0});const round=state.iterations[0].interviews[0];
 state=await c.api('',{id:c.id,version:state.version,action:'questionAnswer',interviewId:round.id,questionId:round.questions[0].id,skip:true});
 state=await c.api('',{id:c.id,version:state.version,action:'finishQuestions',interviewId:round.id});assert.ok(state.iterations[0].questions.includes('交付时间？'));assert.equal(c.calls.length,1);assert.ok(state.iterations[0].interviews[0].submittedAt);
 });

test('supplementing and revising saved answers persists separately before document synthesis',async t=>{
 const c=await fixture(t);c.result={reply:'等待补充',document:'# 原文档',questions:['资源投入？'],suggestions:[]};let state=await c.api('/chat',{id:c.id,version:c.state.version,message:'开始'});
 const change=async extra=>state=await c.api('',{id:c.id,version:state.version,...extra});
 await change({action:'reviseAnswer',pendingQuestion:'资源投入？',text:'十个人天'});let answer=state.iterations[0].extraAnswers[0];assert.equal(state.iterations[0].document,'# 原文档');assert.equal(state.iterations[0].questions.length,0);assert.equal(c.calls.length,1);
 await change({action:'reviseAnswer',questionId:answer.id,text:'二十个人天'});answer=state.iterations[0].extraAnswers[0];assert.equal(answer.answerHistory[0].answer,'十个人天');assert.ok(answer.needsDocumentSync);
 await c.api('',{id:c.id,version:state.version,action:'reviseAnswer',pendingQuestion:'已失效问题',text:'abc'},409);
 c.result={reply:'未更新',questions:[],suggestions:[]};await c.api('/chat',{id:c.id,version:state.version,syncAnswers:true},502);assert.ok((await c.api('')).iterations[0].extraAnswers[0].needsDocumentSync);
 c.result={reply:'按最新回答更新',document:'# 5W2H\n二十个人天',questions:[],suggestions:[]};state=await c.api('/chat',{id:c.id,version:state.version,syncAnswers:true});assert.match(c.calls.at(-1).message,/二十个人天/);assert.equal(state.iterations[0].extraAnswers[0].needsDocumentSync,false);assert.match(state.iterations[0].document,/二十个人天/);
});

test('project requirement references are supplied with provenance and their changes invalidate analysis cache',async t=>{
 const c=await fixture(t);await mkdir(join(c.root,'docs'));
 await writeFile(join(c.root,'人力5W2H需求文档.md'),'历史资料：绩效来自Excel。');
 await writeFile(join(c.root,'docs','开发交付说明.md'),'每个指标有独立来源、范围和公式。');
 await writeFile(join(c.root,'无关笔记.md'),'不作为需求参考');
 await mkdir(join(c.root,'docs','requirements-archive'));
 await writeFile(join(c.root,'docs','requirements-archive','旧需求.md'),'归档不自动读取');
 await c.chat('当前绩效来自CRM，审查各子功能。');
 const task=c.calls.at(-1);assert.equal(task.referenceDocuments['人力5W2H需求文档.md'],'历史资料：绩效来自Excel。');
 assert.equal(task.referenceDocuments['docs/开发交付说明.md'],'每个指标有独立来源、范围和公式。');
 assert.equal(Object.keys(task.referenceDocuments).length,2);assert.match(task.message,/CRM/);
 const before=c.calls.length;await writeFile(join(c.root,'人力5W2H需求文档.md'),'来源补充：CRM正式绩效结果。');
 const state=await c.api('/chat',{id:c.id,version:c.state.version});c.setState(state);
 assert.equal(c.calls.length,before+1);assert.match(c.calls.at(-1).referenceDocuments['人力5W2H需求文档.md'],/CRM/);
});

test('conflict explanations survive failed synthesis and only resolve after a document update',async t=>{
 const c=await fixture(t);const conflict={title:'绩效来源不一致',statements:[{source:'旧稿6.7',text:'Excel是正式来源'},{source:'本轮回答',text:'绩效来自CRM'}],impact:'导入去向未明确'};
 c.result={reply:'发现来源冲突',document:'# 原文',questions:['导入发布规则？'],conflicts:[conflict],suggestions:[]};await c.chat('检查来源');
 let current=c.state.iterations[0].conflicts[0];assert.equal(current.status,'pending');
 await c.change('conflictExplanation',{conflictId:current.id,explanation:'Excel导入CRM；驾驶舱只读CRM正式结果'});
 c.result={reply:'已处理',questions:[],suggestions:[]};await c.api('/chat',{id:c.id,version:c.state.version,conflictId:current.id},502);
 const failed=await c.api('');assert.equal(failed.iterations[0].document,'# 原文');assert.equal(failed.iterations[0].conflicts[0].status,'pending');assert.ok(failed.iterations[0].conflicts[0].needsDocumentSync);
 assert.match(failed.iterations[0].conflicts[0].explanation,/Excel导入CRM/);
 c.result={reply:'How已采用CRM正式结果',document:'# 正文\nExcel导入CRM，驾驶舱只读CRM正式结果',questions:['导入发布规则？'],conflicts:[conflict],suggestions:[]};
 const resolved=await c.api('/chat',{id:c.id,version:c.state.version,conflictId:current.id});c.setState(resolved);
 current=resolved.iterations[0].conflicts[0];assert.equal(current.status,'resolved');assert.equal(current.needsDocumentSync,false);assert.equal(resolved.iterations[0].conflicts.length,1);assert.match(c.calls.at(-1).message,/Excel导入CRM/);
 await c.api('/chat',{id:c.id,version:c.state.version,conflictId:current.id},409);
 await c.change('conflictExplanation',{conflictId:current.id,explanation:'改为驾驶舱补录，但CRM结果优先'});assert.equal(c.state.iterations[0].conflicts[0].status,'pending');assert.match(c.state.iterations[0].conflicts[0].explanationHistory[0].explanation,/Excel导入CRM/);
});

test('malformed conflict evidence cannot overwrite the document',async t=>{
 const c=await fixture(t);c.result={reply:'有冲突',document:'# 不应保存',questions:[],suggestions:[],conflicts:[{title:'无来源',statements:[{source:'',text:'方案一'}]}]};
 const before=await c.api('');await c.api('/chat',{id:c.id,version:c.state.version,message:'分析'},502);assert.deepEqual(await c.api(''),before);
});

test('AI edits remain candidates until accepted, can be rejected or revised, and protect newer manual text',async t=>{
 const c=await fixture(t,{autoAccept:false});await c.change('document',{document:'# 原文\n\n## 6. How\n保留规则。'});
 c.result={reply:'补充来源',document:'# 原文\n\n## 6. How\n保留规则。\n来源CRM。',questions:['来源字段？'],suggestions:[]};
 await c.chat('补充CRM来源');let it=c.state.iterations[0],review=it.documentReviews.at(-1);assert.equal(it.document,'# 原文\n\n## 6. How\n保留规则。');assert.equal(it.questions.length,0);assert.equal(review.status,'pending');
 await c.change('rejectReview',{reviewId:review.id});assert.equal(c.state.iterations[0].document,it.document);
 await c.chat('重新补充');review=c.state.iterations[0].documentReviews.at(-1);await c.change('reviewFeedback',{reviewId:review.id,feedback:'仅补充字段，不删除旧规则'});
 c.result={reply:'按意见重改',document:'# 原文\n\n## 6. How\n保留规则。\n字段：员工ID。',questions:['来源字段？'],suggestions:[]};
 const revised=await c.api('/chat',{id:c.id,version:c.state.version,reviewId:review.id});c.setState(revised);assert.equal(revised.iterations[0].documentReviews.find(r=>r.id===review.id).status,'replaced');assert.match(c.calls.at(-1).message,/仅补充字段/);
 review=revised.iterations[0].documentReviews.at(-1);await c.change('document',{document:'# 用户的新修改'});await c.api('',{action:'acceptReview',id:c.id,version:c.state.version,reviewId:review.id},409);assert.equal((await c.api('')).iterations[0].document,'# 用户的新修改');
 await c.change('reviewFeedback',{reviewId:review.id,feedback:'基于新正文补充'});c.result={reply:'补充字段',document:'# 用户的新修改\n字段：员工ID。',questions:['来源字段？'],suggestions:[]};c.setState(await c.api('/chat',{id:c.id,version:c.state.version,reviewId:review.id}));
 review=c.state.iterations[0].documentReviews.at(-1);await c.change('acceptReview',{reviewId:review.id});assert.match(c.state.iterations[0].document,/员工ID/);assert.deepEqual(c.state.iterations[0].questions,['来源字段？']);
 await c.change('undoDocument');assert.equal(c.state.iterations[0].document,'# 用户的新修改');
});

test('conflict synthesis remains unresolved until the user accepts the candidate',async t=>{
 const c=await fixture(t,{autoAccept:false});c.result={reply:'冲突',questions:[],suggestions:[],conflicts:[{title:'来源冲突',statements:[{source:'旧稿',text:'Excel'},{source:'当前',text:'CRM'}]}]};await c.chat('检查冲突');
 const conflict=c.state.iterations[0].conflicts[0];await c.change('conflictExplanation',{conflictId:conflict.id,explanation:'采用CRM'});
 c.result={reply:'拟采用CRM',document:'# 需求\n来源CRM',questions:[],suggestions:[]};c.setState(await c.api('/chat',{id:c.id,version:c.state.version,conflictId:conflict.id}));
 assert.equal(c.state.iterations[0].document,'');assert.equal(c.state.iterations[0].conflicts[0].status,'pending');
 const review=c.state.iterations[0].documentReviews.at(-1);await c.change('acceptReview',{reviewId:review.id});assert.equal(c.state.iterations[0].conflicts[0].status,'resolved');
});

test('changed saved answers prevent accepting an outdated synthesis preview',async t=>{
 const c=await fixture(t,{autoAccept:false});c.result={reply:'请补充',questions:['来源？'],suggestions:[]};await c.chat('继续');await c.change('reviseAnswer',{pendingQuestion:'来源？',text:'CRM'});
 c.result={reply:'拟写入CRM',document:'# 来源CRM',questions:[],suggestions:[]};c.setState(await c.api('/chat',{id:c.id,version:c.state.version,syncAnswers:true}));
 const it=c.state.iterations[0],review=it.documentReviews.at(-1),answer=it.extraAnswers[0];assert.ok(answer.needsDocumentSync);await c.change('reviseAnswer',{questionId:answer.id,text:'企业微信'});
 await c.api('',{action:'acceptReview',id:c.id,version:c.state.version,reviewId:review.id},409);const actual=await c.api('');assert.equal(actual.iterations[0].document,'');assert.equal(actual.iterations[0].extraAnswers[0].answer,'企业微信');assert.ok(actual.iterations[0].extraAnswers[0].needsDocumentSync);
});
