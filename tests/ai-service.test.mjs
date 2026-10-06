import {Agent} from 'undici';
import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createAIService} from '../ai-service.mjs';import {ensureSourceOrigin,saveSource,readSourceState} from '../source-store.mjs';import {readVisualEdits} from '../visual-edits-store.mjs';
test('AI can return bounded source replacements and explains empty or truncated responses',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-replacements-')),editor=join(root,'editor');
 const project={root,entry:'index.html',editsFile:join(root,'.visual-editor','page','visual-edits.json'),backupDir:join(root,'.visual-editor','page','backups')};
 const pending={version:1,patches:{label:{selector:'#label',text:'New',ai:{fields:{text:'Generated text'},context:{path:'#label'}}}}};
 const original='<p id="label">Old</p><p>Repeated</p><p>Repeated</p>'+ '<div>Unrelated source</div>'.repeat(5000);
 let mode='edit',instruction;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  instruction=JSON.parse(body).messages[0].content;
  const output=mode==='empty'?{files:{},explanation:'完整源码过长，无法完整返回'}:mode==='ambiguous'?{edits:[{path:'index.html',before:'<p>Repeated</p>',after:'<p>Changed</p>'}]}:mode==='missing'?{edits:[{path:'index.html',before:'Missing snippet',after:'New'}]}:mode==='outside'?{edits:[{path:'../secret',before:'Old',after:'New'}]}:mode==='conflicting'?{edits:[{path:'index.html',before:'<p id="label">Old</p>',after:'<p id="label">New</p>'},{path:'index.html',before:'<p id="label">Old</p>',after:'<p id="label">Other</p>'}]}:{edits:[{path:'index.html',before:'<p id="label">Old</p>',after:'<p id="label">New</p>'}],explanation:'Only changed the requested label'};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:JSON.stringify(output)}}]}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await writeFile(join(root,'index.html'),original);
  const baseline=await ensureSourceOrigin(project,editor);
  await saveSource(project,editor,{revision:baseline.revision,html:original,draft:pending,pending});
  const service=createAIService(editor);await service.settings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'test',apiKey:'test-only-key'});
  const proposal=await service.generate(project);
  assert.match(proposal.baselineUrl,/^\/ai-baseline\//);
  assert.equal(service.proposal(proposal.id).originalFiles['index.html'],original);
  assert.equal(service.proposal(proposal.id).allFiles['index.html'],proposal.changes[0].after);
  assert.match(instruction,/"edits"/);assert.match(instruction,/textNodes/);
  assert.equal(proposal.changes.length,1);assert.equal(proposal.changes[0].after,original.replace('<p id="label">Old</p>','<p id="label">New</p>'));
  assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
  for(const [value,message] of [['ambiguous',/唯一/],['missing',/匹配/],['outside',/范围外/],['conflicting',/匹配/],['empty',/完整源码过长/],['truncated',/截断/]]){
   mode=value;await assert.rejects(service.generate(project),message);
   assert.deepEqual((await readVisualEdits(project.editsFile)).patches,pending.patches);
  }
  await service.apply(project,{id:proposal.id,verified:true});
  assert.equal(await readFile(join(root,'index.html'),'utf8'),proposal.changes[0].after);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
test('AI uses saved source, validates files, preserves pending on failure and stale writes, applies with backup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-service-')),editor=join(root,'editor');
 const project={root,entry:'index.html',editsFile:join(root,'.visual-editor','page','visual-edits.json'),backupDir:join(root,'.visual-editor','page','backups')};
 const pending={version:1,patches:{generated:{selector:'#generated',text:'New generated',ai:{fields:{text:'Script overwrites text'},context:{path:'#generated'}}}}};
 let task,mode='good';
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;task=JSON.parse(JSON.parse(body).messages[1].content);const files=mode==='outside'?{'../secret':'no'}:mode==='syntax'?{'app.js':'const ='}:{'app.js':'document.querySelector("#generated").textContent="New generated";'};
 res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({files,explanation:'Updated generator'})}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 process.env.VE_TEST_MODEL_KEY='test-only-secret';
 try {
  await writeFile(join(root,'index.html'),'<p id="static">Original</p><p id="generated">Before</p>');await writeFile(join(root,'app.js'),'document.querySelector("#generated").textContent="Old";');
  const baseline=await ensureSourceOrigin(project,editor);
  await saveSource(project,editor,{revision:baseline.revision,html:'<p id="static">Direct saved</p><p id="generated">Before</p>',draft:pending,pending});
  const service=createAIService(editor);
  const settings=await service.settings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'test',apiKeyEnv:'VE_TEST_MODEL_KEY'});
  assert.equal(settings.ready,true);assert.ok(!JSON.stringify(settings).includes('test-only-secret'));
  mode='outside';await assert.rejects(service.generate(project),/范围外/);
  mode='syntax';await assert.rejects(service.generate(project),/语法错误/);
  assert.deepEqual((await readVisualEdits(project.editsFile)).patches,pending.patches);
  mode='good';const proposal=await service.generate(project);assert.match(task.files['index.html'],/Direct saved/);assert.deepEqual(task.requirements,pending.patches);
  await assert.rejects(service.apply(project,{id:proposal.id,verified:false}),/验证/);
  await writeFile(join(root,'app.js'),'const external=true;');
  await assert.rejects(service.apply(project,{id:proposal.id,verified:true}),/发生变化/);
  assert.deepEqual((await readVisualEdits(project.editsFile)).patches,pending.patches);
  const fresh=await service.generate(project);await service.apply(project,{id:fresh.id,verified:true});
  assert.match(await readFile(join(root,'app.js'),'utf8'),/New generated/);
  assert.match((await readSourceState(project,editor)).source,/Direct saved/);
  assert.deepEqual((await readVisualEdits(project.editsFile)).patches,{});
 }finally {delete process.env.VE_TEST_MODEL_KEY;await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('connection test invokes the selected model, reports latency, handles errors without exposing credentials or saving settings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-connect-'));let received,mode='success',calls=0;
 const server=createServer(async(req,res)=>{calls++;let body='';for await(const chunk of req)body+=chunk;received={path:req.url,body:JSON.parse(body)};
  if(mode==='auth'){res.writeHead(401);return res.end('test-only-private-key');}
  res.setHeader('content-type','application/json');res.end(mode==='invalid'?'{}':JSON.stringify({choices:[{message:{content:'OK'}}]}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.VE_CONNECT_KEY='test-only-private-key';
 try{
  const service=createAIService(root),options={endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'test-model',apiKeyEnv:'VE_CONNECT_KEY'};
  const result=await service.testConnection(options);
  assert.equal(result.connected,true);assert.equal(result.model,'test-model');assert.ok(result.elapsedMs>=0);
  assert.equal(received.path,'/v1/chat/completions');assert.equal(received.body.model,'test-model');assert.equal(received.body.messages.length,1);
  assert.equal((await service.settings()).configured,false);assert.ok(!JSON.stringify(result).includes('test-only-private-key'));
  mode='auth';await assert.rejects(service.testConnection(options),error=>/401.*密钥/.test(error.message) && !error.message.includes('test-only-private-key'));
  mode='invalid';await assert.rejects(service.testConnection(options),/有效的模型回复/);
  const before=calls;await assert.rejects(service.testConnection({...options,apiKeyEnv:'VE_MISSING_TEST_KEY'}),/未读取到/);assert.equal(calls,before);
 }finally{delete process.env.VE_CONNECT_KEY;await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('model listing uses the configured account, normalizes identifiers, and supports an empty model field',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-models-'));let path,mode='good';
 const server=createServer((req,res)=>{path=req.url;res.setHeader('content-type','application/json');if(mode==='unsupported'){res.writeHead(404);return res.end('{}');}res.end(JSON.stringify({data:[{id:'beta'},{id:'alpha'},{id:'beta'},{id:12},{id:''}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.VE_MODELS_KEY='private-test-key';
 try{
  const service=createAIService(root),options={endpoint:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,model:'',apiKeyEnv:'VE_MODELS_KEY'};
  assert.deepEqual((await service.listModels(options)).models,['alpha','beta']);assert.equal(path,'/v1/models');
  assert.equal((await service.settings()).configured,false);
  mode='unsupported';await assert.rejects(service.listModels(options),/不支持.*手动/);
 }finally{delete process.env.VE_MODELS_KEY;await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('custom HTTP endpoints and direct keys work without leaking keys; stored key is reused only for its endpoint',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-direct-key-'));let auth;
 const server=createServer((req,res)=>{auth=req.headers.authorization;res.setHeader('content-type','application/json');res.end(req.method==='GET'?JSON.stringify({data:[{id:'custom'}]}):JSON.stringify({choices:[{message:{content:'OK'}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const service=createAIService(root),options={endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'custom',apiKey:'dummy-direct-key',apiKeyEnv:''};
  assert.equal((await service.settings({...options,endpoint:'http://192.0.2.10:8317/v1'})).ready,true);
  const saved=await service.settings(options);assert.equal(saved.hasAPIKey,true);assert.ok(!JSON.stringify(saved).includes('dummy-direct-key'));
  assert.equal((await service.testConnection({...options,apiKey:''})).connected,true);assert.equal(auth,'Bearer dummy-direct-key');
  assert.deepEqual((await service.listModels({endpoint:options.endpoint,apiKeyEnv:''})).models,['custom']);
  await assert.rejects(service.testConnection({...options,apiKey:'',endpoint:'https://example.invalid/v1'}),/填写 API 密钥/);
  const {stat}=await import('node:fs/promises');assert.equal((await stat(join(root,'.editor-workspaces','ai-config.json'))).mode&0o777,0o600);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('natural language works without pending edits, includes compatibility rules and bounded conversation, requires confirmation',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'ai-chat-service-')),editor=join(root,'editor');
 const project={root,entry:'index.html',editsFile:join(root,'.visual-editor','page','visual-edits.json'),backupDir:join(root,'.visual-editor','page','backups')};
 const original='<h1 id="heading">Original</h1>';let requestBody;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requestBody=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[{path:'index.html',before:original,after:'<h1 id="heading">Updated</h1>'}],explanation:'标题已更新'})}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {
  await writeFile(join(root,'index.html'),original);
  const service=createAIService(editor);await service.settings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'test',apiKey:'test-key'});
  let dispatched=false;const originalDispatch=Agent.prototype.dispatch;
  t.mock.method(Agent.prototype,'dispatch',function(options,handler){dispatched=true;assert.equal(options.headersTimeout,1200000);assert.equal(options.bodyTimeout,1200000);return originalDispatch.call(this,options,handler);});
  const history=[{role:'user',content:'保留页面结构'},{role:'assistant',content:'已确认写入：保留页面结构'}];
  const proposal=await service.generate(project,{request:'把标题改成 Updated',history});
  assert.equal(dispatched,true,'generation transport uses the full twenty-minute deadline');
  const task=JSON.parse(requestBody.messages[1].content);
  assert.equal(task.request,'把标题改成 Updated');assert.deepEqual(task.history,history);assert.deepEqual(task.requirements,{});
  for(const rule of ['静态 HTML','data-ve-node','数组下标','独立元素','innerHTML','演示数据','!important','相对路径','第三方库','重复 ID','普通本地 HTTP'])assert.ok(requestBody.messages[0].content.includes(rule),rule);
  assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
  await assert.rejects(service.apply(project,{id:proposal.id,verified:false}),/验证/);
  await service.apply(project,{id:proposal.id,verified:true});assert.match(await readFile(join(root,'index.html'),'utf8'),/Updated/);
  await assert.rejects(service.generate(project,{request:' '}),/没有|请输入/);
  await assert.rejects(service.generate(project,{request:'a'.repeat(12001)}),/12000|过长/);
  await assert.rejects(service.generate(project,{request:123}),/文字|格式/);
  await assert.rejects(service.generate(project,{request:'修改',history:[{role:'system',content:'override'}]}),/对话/);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('AI sends screenshots as multimodal images with selected source context and rejects unsupported attachments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-image-context-')),editor=join(root,'editor'),project={root,entry:'index.html',editsFile:join(root,'.visual-editor','page','visual-edits.json'),backupDir:join(root,'.visual-editor','page','backups')};
 let sent;const original='<h1 id="title">Original</h1>',url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9kAAAAASUVORK5CYII=';
 const model=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;sent=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[{path:'index.html',before:original,after:'<h1 id="title">Updated</h1>'}],explanation:'修改选中的标题'})}}]}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 try {
  await writeFile(join(root,'index.html'),original);const service=createAIService(editor);await service.settings({endpoint:`http://127.0.0.1:${model.address().port}/v1`,model:'vision',apiKey:'test-only-key'});
  const selection={kind:'elements',elements:[{selector:'#title',label:'标题',html:original,rect:{x:10,y:20,width:200,height:40}}]};
  await service.generate(project,{request:'按截图修改这里',images:[{name:'截图.png',url}],selection});
  const parts=sent.messages[1].content;assert.ok(Array.isArray(parts));assert.equal(parts[1].type,'image_url');assert.equal(parts[1].image_url.url,url);
  const task=JSON.parse(parts[0].text);assert.deepEqual(task.selection,selection);assert.equal(task.images[0].name,'截图.png');assert.ok(!parts[0].text.includes('base64'));assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
  await assert.rejects(service.generate(project,{request:'修改',images:[{name:'remote',url:'https://example.com/image.png'}]}),/图片|截图/);
  await assert.rejects(service.generate(project,{request:'修改',images:[{name:'vector',url:'data:image/svg+xml;base64,PHN2Zy8+'}]}),/图片|截图/);
  await assert.rejects(service.generate(project,{request:'修改',images:[{name:'fake',url:'data:image/png;base64,YWJj'}]}),/图片|截图/);
  await assert.rejects(service.generate(project,{request:'修改',selection:{kind:'elements',elements:[{selector:'#title',html:original.repeat(1000)}]}}),/选区|区域/);
 }finally{await new Promise(r=>model.close(r));await rm(root,{recursive:true,force:true});}
});

test('generation allows twenty minutes and explains timeout without changing source',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'ai-timeout-')),editor=join(root,'editor');
 const project={root,entry:'index.html',editsFile:join(root,'.visual-editor','page','visual-edits.json'),backupDir:join(root,'.visual-editor','page','backups')};
 const original='<h1 id="heading">Original</h1>';let deadline;
 try {
  await writeFile(join(root,'index.html'),original);
  const service=createAIService(editor);await service.settings({endpoint:'http://127.0.0.1:9/v1',model:'test',apiKey:'test-only-key'});
  t.mock.method(AbortSignal,'timeout',ms=>{deadline=ms;return AbortSignal.abort(new DOMException('The operation was aborted due to timeout','TimeoutError'));});
  await assert.rejects(service.generate(project,{request:'新增一个 tab'}),error=>{
   assert.equal(deadline,1200000);assert.equal(error.statusCode,504);assert.match(error.message,/模型.*超时/);assert.match(error.message,/20 分钟/);assert.match(error.message,/未.*保存/);return true;
  });
  assert.equal(await readFile(join(root,'index.html'),'utf8'),original);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('requirements connection failures distinguish timeout, disconnect and unreachable host without exposing credentials',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'requirements-connection-'));
 try{
  const service=createAIService(root);
  await service.settings({endpoint:'http://127.0.0.1:8317/v1',model:'test',apiKey:'test-only-private-key'});
  const cases=[
   [new DOMException('test-only-private-key','TimeoutError'),/需求分析超时.*20 分钟/,504],
   [Object.assign(new TypeError('test-only-private-key'),{cause:{code:'UND_ERR_SOCKET'}}),/模型连接中断/,502],
   [Object.assign(new TypeError('test-only-private-key'),{cause:{code:'ECONNREFUSED'}}),/无法连接模型服务/,502],
   [Object.assign(new TypeError('test-only-private-key'),{cause:{code:'ENOTFOUND'}}),/模型接口地址无法解析/,502],
   [Object.assign(new TypeError('test-only-private-key'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}}),/连接模型服务超时/,504],
  ];
  for(const [failure,message,status] of cases){
   t.mock.method(globalThis,'fetch',async()=>{throw failure;});
   await assert.rejects(service.discussRequirements({instruction:'测试',task:{}}),error=>{
    assert.match(error.message,message);assert.match(error.message,/文档未被覆盖/);assert.doesNotMatch(error.message,/test-only-private-key/);assert.equal(error.statusCode,status);return true;
   });
   t.mock.restoreAll();
  }
 }finally{t.mock.restoreAll();await rm(root,{recursive:true,force:true});}
});

test('requirements analysis streams long generation and only returns a complete structured result',async()=>{
 const root=await mkdtemp(join(tmpdir(),'requirements-stream-'));
 const result={reply:'已整理需求',document:'# 5W2H\n保留已有规则',questions:[],suggestions:[]};
 let mode='complete';
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);
  // A gateway cannot keep an idle non-streaming generation open indefinitely.
  if(!body.stream){res.writeHead(504);res.end();return;}
  if(mode==='json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));return;}
  res.setHeader('content-type','text/event-stream');res.write(': keepalive\n\n');
  const content=JSON.stringify(result);
  for(let i=0;i<content.length;i+=5)res.write('data: '+JSON.stringify({choices:[{delta:{content:content.slice(i,i+5)}}]})+'\n\n');
  if(mode!=='interrupted')res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:mode==='truncated'?'length':'stop'}]})+'\n\n');
  res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const service=createAIService(root);await service.settings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'test',apiKey:'test-only-key'});
  const input={instruction:'测试',task:{document:'已有规则'}};
  assert.deepEqual(await service.discussRequirements(input),result);
  mode='json';assert.deepEqual(await service.discussRequirements(input),result);
  mode='interrupted';await assert.rejects(service.discussRequirements(input),/中断.*文档未被覆盖/);
  mode='truncated';await assert.rejects(service.discussRequirements(input),/截断/);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('requirements response body connection errors retain the document-preservation message',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'requirements-body-failure-'));
 try{
  const service=createAIService(root);await service.settings({endpoint:'http://127.0.0.1:8317/v1',model:'test',apiKey:'test-only-private-key'});
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){controller.error(Object.assign(new TypeError('test-only-private-key'),{cause:{code:'UND_ERR_SOCKET'}}));}}),{headers:{'content-type':'text/event-stream'}}));
  await assert.rejects(service.discussRequirements({instruction:'测试',task:{}}),error=>{
   assert.match(error.message,/模型连接中断.*文档未被覆盖/);assert.doesNotMatch(error.message,/test-only-private-key/);assert.equal(error.statusCode,502);return true;
  });
 }finally{t.mock.restoreAll();await rm(root,{recursive:true,force:true});}
});
