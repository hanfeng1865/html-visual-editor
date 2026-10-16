import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDiagramService} from '../diagram-service.mjs';
import {sanitizeDiagram} from '../diagram-sanitize.mjs';
import {writeAnnotations} from '../change-annotations-store.mjs';
const markup='<div data-editor-component="diagram"><h2>提交流程</h2><svg viewBox="0 0 400 150"><defs><marker id="arrow" markerWidth="6" markerHeight="6"><path d="M0 0 L6 3 L0 6"/></marker></defs><rect x="10" y="10" width="180" height="80" fill="#eee"/><text x="30" y="55">提交</text><path d="M200 50 L300 50" marker-end="url(#arrow)"/></svg><p>依据：index.html；待确认：审批权限</p></div>';
test('annotation diagrams persist with their note without changing the prototype or other notes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'note-diagram-'));
 try{
  const source='<h1>月份账单</h1>',project={id:'test',root,entry:'index.html',annotationsFile:join(root,'notes.json')};
  await writeFile(join(root,'index.html'),source);
  const box=id=>({id,selector:'h1',cockpit:'page',context:'',x:0,y:0,width:1,height:1});
  await writeAnnotations(project.annotationsFile,{version:1,hidden:[],boxes:[box('one'),box('two')],notes:{'box:one':'新增账单'},colors:{}});
  const options={requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async()=>({title:'账单流程',html:markup})}};
  const service=createDiagramService(options);
  assert.deepEqual(await service.annotationDiagrams(project),{});
  const candidate=await service.generate(project,{mode:'component',type:'flowchart',request:'新增账单'});
  await Promise.all(['one','two'].map(annotationId=>service.save(project,{id:candidate.id,annotationId})));
  const reopened=await createDiagramService(options).annotationDiagrams(project);
  assert.equal(reopened.one.html,candidate.html);assert.equal(reopened.two.title,'账单流程');assert.equal(reopened.one.type,'flowchart');
  assert.equal(await readFile(join(root,'index.html'),'utf8'),source);
  assert.equal(JSON.parse(await readFile(project.annotationsFile,'utf8')).notes['box:one'],'新增账单');
  assert.deepEqual(await service.annotationDiagrams({...project,annotationsFile:join(root,'other','notes.json')}),{});
  await assert.rejects(service.save(project,{id:candidate.id,annotationId:'missing'}),/逻辑说明.*不存在/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('generation includes saved context, remaps IDs and document saves stay isolated',async()=>{
 const root=await mkdtemp(join(tmpdir(),'diagram-'));try{
 await writeFile(join(root,'index.html'),'<html><script src="app.js"></script></html>');await writeFile(join(root,'app.js'),'const submit = true;');
 const project={id:'test',root,entry:'index.html',annotationsFile:join(root,'notes.json')};let task,invalid=false;
 const service=createDiagramService({ai:{discussRequirements:async input=>{task=input.task;input.onProgress?.({type:'summary',text:'先提交，再审批。'});return {title:'提交流程',html:invalid?'<script>bad()</script>'+markup:markup};}},requirements:{read:async()=>({iterations:[{name:'当前',pages:['index.html'],document:'提交须校验',extraAnswers:[{text:'必填？',status:'answered',answer:'名称'}]},{name:'其他',pages:['other.html']}]})}});
 const progress=[];
 const first=await service.generate(project,{mode:'document',type:'flowchart',request:'解释提交',current:'原图',context:'卡片'},{onProgress:event=>progress.push(event)});
 assert.ok(progress.some(event=>event.type==='summary'&&event.text==='先提交，再审批。'));
 assert.ok(progress.some(event=>event.type==='phase'&&event.message.includes('检查')));
 assert.equal(task.files['app.js'],'const submit = true;');assert.equal(task.current,'原图');assert.equal(task.context,'卡片');assert.equal(task.confirmedRequirements.length,1);assert.equal(task.confirmedRequirements[0].confirmedAnswers[0].answer,'名称');
 assert.match(first.component,/role="img"/);assert.match(first.component,/aria-labelledby=/);assert.doesNotMatch(first.component,/<style/);assert.doesNotMatch(first.component,/id="arrow"/);assert.match(first.component,/marker-end="url\(#diagram-/);
 const second=await service.generate(project,{mode:'component',type:'sequence',request:'再画'});assert.notEqual(first.component,second.component);
 await assert.rejects(service.save({...project,id:'other'},{id:first.id}),/不存在/);await assert.rejects(service.save(project,{id:second.id}),/组件/);
 invalid=true;await assert.rejects(service.generate(project,{mode:'document',type:'architecture',request:'失败重试'}),/危险标签/);
 const [saved,concurrent]=await Promise.all([service.save(project,{id:first.id,path:'index.html'}),service.save(project,{id:first.id})]);assert.deepEqual(saved,concurrent);assert.match(saved.editorUrl,/^\/editor\/editor.html\?/);assert.match(saved.entry,/^diagram-[\w-]+\.html$/);assert.equal(await readFile(join(root,saved.entry),'utf8'),first.html);assert.deepEqual(await service.save(project,{id:first.id}),saved);assert.equal((await readdir(root)).filter(n=>n.startsWith('diagram-')).length,1);assert.match(await readFile(join(root,'index.html'),'utf8'),/script/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('sanitizer rejects active markup, resources, duplicate IDs and text outside canvas',async()=>{
 for(const value of ['<script>alert(1)</script>','<img src="https://example.com/x">','<div onclick="alert(1)"></div>','<style>@import "x";</style>','<svg><use href="#x"/></svg>'])await assert.rejects(sanitizeDiagram(value+markup,'图解'));
 await assert.rejects(sanitizeDiagram(markup.replace('<rect ','<rect id="arrow" '),'图解'),/重复 ID/);
 await assert.rejects(sanitizeDiagram(markup.replace('x="30"','x="500"'),'图解'),/超出画布/);
 await assert.rejects(sanitizeDiagram(markup.replace('<text ','<text transform="translate(500 0)" '),'图解'),/超出画布/);
});
test('style tags become scoped inline styles',async()=>{
 const result=await sanitizeDiagram('<style>text {fill: rgb(20, 30, 40);font-size:16px}</style>'+markup,'图解');assert.doesNotMatch(result.component,/<style/);assert.match(result.component,/fill: rgb\(20, 30, 40\)/);
});
test('escaped SVG presentation resources cannot survive adoption',async()=>{
 for(const attr of ['fill','stroke','clip-path','marker-end','filter','mask','cursor']){
  await assert.rejects(sanitizeDiagram(markup.replace('<rect ',`<rect ${attr}="\\75rl(/probe)" `),'图解'),/CSS 资源/);
 }
});

test('large responsive multi-diagram fixture remains compact and can be sanitized twice',async()=>{
 const nodes=Array.from({length:60},(_,i)=>{const x=(i%6)*150+5,y=Math.floor(i/6)*70+5;return `<g transform="translate(${x} ${y})"><rect class="node" width="140" height="60"/><text x="10" y="35">节点 ${i+1}</text></g>`;}).join('');
 const svg=id=>`<svg viewBox="0 0 910 710"><defs><marker id="${id}" markerWidth="6" markerHeight="6"><path d="M0 0L6 3L0 6"/></marker></defs>${nodes}<path class="edge" style="stroke: #64748b; marker-end: url( '#${id}' ); fill: none" d="M10 705 L100 705"/></svg>`;
 const html=`<style>.diagram{width:100%;max-width:1100px}.diagram svg{display:block;width:100%;height:auto}.node{fill:#f1f5f9;stroke:#cbd5e1;stroke-width:1}text{font:14px system-ui;fill:#334155}</style><div class="diagram" data-editor-component="diagram">${svg('arrow-a')}${svg('arrow-b')}</div>`;
 const first=await sanitizeDiagram(html,'大型图解');assert.ok(Buffer.byteLength(first.component)<60000);const second=await sanitizeDiagram(first.html,'大型图解');assert.ok(Buffer.byteLength(second.component)<65000);assert.doesNotMatch(second.component,/url\([^)]*arrow-[ab]/);assert.match(second.component,/width: 100%/);assert.match(second.component,/transform="translate/);
 const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:600,height:900},javaScriptEnabled:false});await page.setContent(second.html);const sizes=await page.locator('svg').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));assert.ok(sizes.every(width=>width<=552&&width>400));const marker=await page.locator('.edge').first().getAttribute('style');assert.match(marker,/marker-end: url\(["']?#diagram-/);}finally{await browser.close();}
});
test('escaped CSS resources are rejected after DOM parsing',async()=>{
 await assert.rejects(sanitizeDiagram('<div style="background-image:&#92;75rl(/probe)">'+markup+'</div>','图解'),/CSS|资源/);
});

test('meta refresh is rejected even when combined with charset',async()=>{
 for(const html of [markup.replace('<h2>','<meta charset="utf-8" http-equiv="refresh" content="30;url=/probe"><h2>'),'<html><head><meta charset="utf-8" http-equiv="refresh" content="30;url=/probe"></head><body>'+markup+'</body></html>',markup.replace('<h2>','<meta charset="utf-8"><h2>')])await assert.rejects(sanitizeDiagram(html,'图解'),/元数据|重定向/);
});

test('wide diagrams fit their container and omit technical source footnotes without losing business rules',async()=>{
 const wide=markup.replace('<svg ', '<svg style="width:1600px;min-width:1600px;height:600px" ').replace('<p>依据：index.html；待确认：审批权限</p>','<p>依据：vehicle-management/rental.html「月份账单说明」；vehicle-management/rental.js「保存安排」。</p><p>部门筛选只改变查看范围，不缩小账单修改范围。</p><p>待确认：审批权限。</p>');
 const result=await sanitizeDiagram(wide.replace('</div>','<section style="display:grid;grid-template-columns:500px 500px;gap:16px"><p>查看账单</p><p>维护账单</p></section></div>'),'账单流程');
 assert.doesNotMatch(result.component,/rental\.(html|js)/);
 assert.match(result.component,/不缩小账单修改范围/);
 assert.match(result.component,/待确认：审批权限/);
 const {chromium}=await import('playwright'),browser=await chromium.launch();
 try{const page=await browser.newPage({viewport:{width:390,height:844},javaScriptEnabled:false});await page.setContent(result.html);const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,svgWidth:document.querySelector('svg').getBoundingClientRect().width}));assert.ok(layout.scrollWidth<=layout.width);assert.ok(layout.svgWidth<=342);}finally{await browser.close();}
});

test('custom properties and variable-based image resources are rejected',async()=>{
 for(const style of ["--pic:image-set('/probe' 1x);background-image:var(--pic)","--pic: url('/probe');background:var(--pic)","background-image:image-set('/probe' 1x)","mask-image:url('/probe')"]){const html=markup.replace('<h2>',`<p style="${style}">测试</p><h2>`);await assert.rejects(sanitizeDiagram(html,'图解'),/变量|CSS|资源/);}
 const clean=await sanitizeDiagram(markup.replace('<h2>','<p style="background:#ffffff;cursor:auto;unknown-property:secret">测试</p><h2>'),'图解');assert.match(clean.component,/background-color: rgb\(255, 255, 255\)/);assert.doesNotMatch(clean.component,/unknown-property|cursor:/);
});

test('crowded nodes and connectors through unrelated cards are reported for rearrangement',async()=>{
 const crowded='<div data-editor-component="diagram"><svg viewBox="0 0 600 400"><rect x="20" y="20" width="240" height="100"/><rect x="20" y="110" width="240" height="100"/><path d="M0 160H500" fill="none" stroke="#333"/></svg></div>';
 const result=await sanitizeDiagram(crowded,'账单流程');
 assert.ok(result.layoutIssues?.some(issue=>issue.includes('重叠')));
 assert.ok(result.layoutIssues.some(issue=>issue.includes('穿过')));
 const touching=await sanitizeDiagram(crowded.replace('y="110"','y="120"').replace('<path d="M0 160H500" fill="none" stroke="#333"/>',''),'账单流程');
 assert.ok(touching.layoutIssues.some(issue=>issue.includes('间距')));
});

test('generation rearranges a crowded draft before returning it and preserves business request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'diagram-layout-'));
 try{
  await writeFile(join(root,'index.html'),'<h1>月份账单</h1>');const calls=[],events=[];
  const crowded='<div data-editor-component="diagram"><svg viewBox="0 0 500 300"><rect x="20" y="20" width="200" height="100"/><rect x="20" y="90" width="200" height="100"/></svg></div>';
  let alwaysCrowded=false;
  const service=createDiagramService({requirements:{read:async()=>({iterations:[]})},ai:{discussRequirements:async input=>{calls.push(input);return {title:'账单流程',html:alwaysCrowded||calls.length===1?crowded:markup};}}});
  const project={id:'test',root,entry:'index.html',annotationsFile:join(root,'notes.json')};
  const result=await service.generate(project,{mode:'component',type:'flowchart',request:'讲清楚新增和修改账单'},{onProgress:event=>events.push(event)});
  assert.equal(calls.length,2);assert.equal(calls[1].task.request,'讲清楚新增和修改账单');assert.match(calls[1].task.current,/viewBox/);assert.ok(calls[1].task.layoutFeedback.some(issue=>issue.includes('重叠')));
  assert.match(calls[0].instruction,/产品经理/);assert.match(calls[0].instruction,/异常分支.*结束/);
  assert.deepEqual(result.layoutIssues,[]);assert.ok(events.some(event=>event.message?.includes('重新排版')));
  alwaysCrowded=true;await assert.rejects(service.generate(project,{mode:'component',type:'flowchart',request:'重试'}),/排布仍然拥挤/);assert.equal(calls.length,4);
 }finally{await rm(root,{recursive:true,force:true});}
});
