import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkProjectInteractions} from '../interaction-check.mjs';
const source=`<!doctype html><button id="view" type="button">查看</button><section id="detail" hidden><button id="close" type="button">返回</button><span id="value">Value</span></section><script>
view.onclick=()=>{document.getElementById('value').textContent='Updated';detail.hidden=false;view.hidden=true;};
close.onclick=()=>{detail.hidden=true;view.hidden=false;};
</script>` .replace('close.onclick','document.getElementById("close").onclick');
test('preflight catches broken entry before writing, including non-throwing regressions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'interaction-check-'));
 try {
  await writeFile(join(root,'index.html'),source);
  const run=html=>checkProjectInteractions({root,entry:'index.html',source,html});
  const good=await run(source.replace('Value','Changed'));
  assert.equal(good.failures.length,0);assert.equal(good.checked,1);
  const broken=await run(source.replace('<span id="value">Value</span>',''));
  assert.equal(broken.status,'failed');assert.match(JSON.stringify(broken.failures),/查看/);
  const hidden=await run(source.replace('detail.hidden=false','detail.hidden=true'));
  assert.equal(hidden.status,'failed');
  const missing=await run(source.replace('id="view"','id="missing"'));
  assert.equal(missing.status,'failed');
  const unchanged=await checkProjectInteractions({root,entry:'index.html',source:source+'<script>throw Error("existing")</script>',html:source+'<script>throw Error("existing")</script>'});
  assert.equal(unchanged.failures.length,0,'inherited errors must not block unrelated edits');
  assert.ok(unchanged.inherited.length);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('preflight reports limited coverage and never submits forms or sends writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'interaction-check-'));
 try {
  const html='<form action="https://example.com"><button>删除</button></form><script>fetch("https://example.com/write",{method:"POST"}).catch(()=>{});</script>';
  const result=await checkProjectInteractions({root,entry:'index.html',source:html,html});
  assert.equal(result.checked,0);assert.equal(result.status,'partial');assert.ok(result.blockedRequests>0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('preflight also checks changed JavaScript in an AI proposal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'interaction-ai-check-'));
 try {
  const html=source.replace(/<script>[\s\S]*<\/script>/,'<script src="app.js"></script>');
  const script=source.match(/<script>([\s\S]*)<\/script>/)[1];
  const result=await checkProjectInteractions({root,entry:'index.html',source:html,html,originalFiles:{'app.js':script},files:{'app.js':script.replace('detail.hidden=false','detail.hidden=true')}});
  assert.equal(result.status,'failed');
 }finally{await rm(root,{recursive:true,force:true});}
});
