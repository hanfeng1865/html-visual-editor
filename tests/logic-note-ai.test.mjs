import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const mod=await import('../logic-note-ai.mjs').catch(()=>({}));
test('manual generation combines page source, dependencies and rendered screenshot without writing notes',async()=>{
 assert.equal(typeof mod.generateLogicNote,'function');
 const root=await mkdtemp(join(tmpdir(),'logic-note-'));
 try{
  await mkdir(join(root,'js'));await writeFile(join(root,'index.html'),'<button onclick="openVehicle()">新增车辆</button><script src="js/app.js"></script>');
  await writeFile(join(root,'js/app.js'),'function openVehicle(){ return "打开新增车辆表单"; }');
  let call;
  const project={root,entry:'index.html'};
  const input={mode:'polish',note:'新增时车牌号必填',selector:'button',region:{x:10,y:10,width:100,height:40},snapshot:{width:800,height:600,html:'<button style="margin:10px">新增车辆</button>',scrollY:0}};
  const result=await mod.generateLogicNote(project,input,{ai:{discussRequirements:async value=>{call=value;return {content:'点击新增车辆打开表单；车牌号必填。'};}}});
  assert.equal(result.content,'点击新增车辆打开表单；车牌号必填。');
  assert.equal(call.task.originalNote,input.note);assert.match(call.task.files['js/app.js'],/openVehicle/);
  assert.match(call.images[0].url,/^data:image\/png;base64,/);assert.match(call.instruction,/产品经理/);assert.match(call.instruction,/待确认/);
  assert.equal(await readFile(join(root,'js/app.js'),'utf8'),'function openVehicle(){ return "打开新增车辆表单"; }');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('rejects empty polishing, missing visual evidence and invalid modes before calling model',async()=>{
 assert.equal(typeof mod.generateLogicNote,'function');
 for(const input of [{mode:'polish',note:''},{mode:'generate',note:''},{mode:'anything'}]){
  await assert.rejects(()=>mod.generateLogicNote({root:'/unused',entry:'index.html'},input,{ai:{discussRequirements:()=>assert.fail('must not call model')}}));
 }
});
test('source collection excludes bundled libraries and navigation pages while retaining application imports',async()=>{
 assert.equal(typeof mod.readLogicSources,'function');
 const root=await mkdtemp(join(tmpdir(),'logic-note-scope-'));
 try{
  await mkdir(join(root,'vendor'));await mkdir(join(root,'js'));
  await writeFile(join(root,'index.html'),'<button onclick="addVehicle()">新增车辆</button><script src="vendor/xlsx.full.min.js"></script><script src="js/app.js"></script><a href="rental.html">租赁管理</a>');
  await writeFile(join(root,'vendor/xlsx.full.min.js'),'/*'+ 'x'.repeat(2000000)+'*/');
  await writeFile(join(root,'rental.html'),'租赁'.repeat(400000));
  await writeFile(join(root,'js/app.js'),'import {validate} from "./rules.js"; function addVehicle(){validate();}');
  await writeFile(join(root,'js/rules.js'),'export function validate(){return "车牌号必填";}');
  const context=await mod.readLogicSources({root,entry:'index.html'});
  assert.deepEqual(Object.keys(context.files).sort(),['index.html','js/app.js','js/rules.js']);
  assert.match(context.files['js/rules.js'],/车牌号必填/);
  assert.ok(context.excluded.some(item=>item.path==='vendor/xlsx.full.min.js'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('large pure data assignments keep field examples and counts without truncating executable business code',async()=>{
 const root=await mkdtemp(join(tmpdir(),'logic-note-data-'));
 try{
  await writeFile(join(root,'index.html'),'<script src="data.js"></script><script src="rules.js"></script>');
  const rows=Array.from({length:12000},(_,id)=>({id,plate:'示例车牌',required:true}));
  await writeFile(join(root,'data.js'),'// generated examples\nwindow.VehicleData = '+JSON.stringify({rows})+';');
  const rules='/*'+ 'x'.repeat(70000)+'*/\nfunction validate(){return "车牌号必填";}';
  await writeFile(join(root,'rules.js'),rules);
  const result=await mod.readLogicSources({root,entry:'index.html'});
  assert.ok(Buffer.byteLength(result.files['data.js'])<10000);
  assert.match(result.files['data.js'],/plate/);assert.match(result.files['data.js'],/12000/);
  assert.equal(result.files['rules.js'],rules);
 }finally{await rm(root,{recursive:true,force:true});}
});
