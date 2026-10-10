import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createVisualPatchEngine} from '../visual-patch-engine.mjs';
import {createStandaloneHtml} from '../export-html.mjs';
import assert from 'node:assert/strict';

const server=createServer(async(req,res)=>{
 try {const path=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type',path.endsWith('.mjs')?'text/javascript':'text/html');res.end(path==='/'?'<body></body>':await readFile(new URL('..'+path,import.meta.url)));}
 catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
const base=`http://127.0.0.1:${server.address().port}`;
function fixture(type) {
 const tag=type==='dialog'?'dialog':'section';
 return `<!doctype html><html><head><style>#surface{padding:20px;background:white}#surface[hidden]{display:none}#surface.drawer{position:fixed;right:0;top:0;width:400px;height:90vh}section.module{padding:10px}</style></head><body>
 <main id="main"><button id="entry">Open</button><p>Main page</p></main>
 <${tag} id="surface" ${type==='dialog'?'':`hidden class="${type==='drawer'?'drawer':''}"`}>
 <button id="close">Close</button><h1 id="title">Details</h1><div id="content">
 <section id="module" class="module"><h2 id="label">Maintenance</h2><span id="value">Initial</span><input id="field" value="10"></section>
 <section id="other" class="module"><button id="action">Inner action</button><output id="result">0</output></section></div></${tag}>
 <script>
 const surface=document.getElementById('surface'),cached=document.getElementById('field');
 document.getElementById('entry').onclick=()=>{
  document.getElementById('value').textContent='Updated';cached.value='20';
  ${type==='dialog'?'surface.showModal()':"surface.hidden=false;document.getElementById('main').hidden=true"};
 };
 document.getElementById('close').onclick=()=>{${type==='dialog'?'surface.close()':"surface.hidden=true;document.getElementById('main').hidden=false"};};
 document.getElementById('content').addEventListener('click',e=>{if(e.target.id==='action')document.getElementById('result').textContent=String(+document.getElementById('result').textContent+1);});
 </script></body></html>`;
}
const edits={
 text:{label:{selector:'#label',text:'Edited maintenance'}},
 style:{module:{selector:'#module',styles:{padding:'25px',backgroundColor:'rgb(230, 240, 255)',borderRadius:'12px'}}},
 deletion:{module:{selector:'#module',deleted:true}},
 conceal:{module:{selector:'#module',concealed:true}},
 reorder:{module:{selector:'#module',position:{parent:'#content',index:1}},other:{selector:'#other',position:{parent:'#content',index:0}}},
 insert:{new:{selector:'#new-note',insert:{parent:'#content',html:'<p id="new-note">Added note</p>'},position:{parent:'#content',index:1}}},
 closeText:{close:{selector:'#close',text:'Return to list'}},
};
let cases=0;
try {
 const compiler=await browser.newPage();await compiler.goto(base);
 const unsafe=await compiler.evaluate(async()=>{
  const {compileSource}=await import('/source-compiler.mjs');
  const source='<form id="form"><input id="control" name="control"></form><div id="outside"></div>';
  const base={source,hashes:{},entry:'index.html'};
  return compileSource({base,current:base,patches:{move:{selector:'#control',position:{parent:'#outside',index:0}}},projectId:'builtin'});
 });
 assert.equal(unsafe.html,undefined,'saving must not silently persist a cross-form move');
 assert.match(unsafe.unsupported.join(' '),/跨区域/);
 for(const type of ['page','drawer','dialog'])for(const [operation,patches] of Object.entries(edits))for(const mode of ['live','saved','export']) {
  const page=await browser.newPage();page.setDefaultTimeout(3000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let html=fixture(type);
  if(mode==='saved')html=await compiler.evaluate(async({source,patches})=>{
   const {compileSource}=await import('/source-compiler.mjs');const base={source,hashes:{},entry:'index.html'};
   const result=compileSource({base,current:base,patches,projectId:'builtin'});
   if(!result.html)throw Error(JSON.stringify(result));return result.html;
  },{source:html,patches});
  if(mode==='export')html=await createStandaloneHtml({source:html,patches,fetchImpl:async()=>({ok:true,text:async()=>'',arrayBuffer:async()=>new ArrayBuffer(0),headers:{get:()=>null}})});
  await page.setContent(html);await page.locator('#entry').click();
  if(mode==='live')await page.evaluate(({engine,patches})=>{window.engine=eval('('+engine+')')(document);window.engine.apply(patches);},{engine:createVisualPatchEngine.toString(),patches});
  if(mode==='export')await page.waitForFunction(()=>document.getElementById('visual-editor-export-patches'));
  for(let round=0;round<3;round++) {
   assert.equal(await page.locator('#surface').isVisible(),true,`${type}/${operation}/${mode}: opens`);
   await page.locator('#action').click();assert.equal(await page.locator('#result').textContent(),String(round+1),'delegated events remain attached');
   if(operation==='deletion' || operation==='conceal')assert.equal(await page.locator('#module').isVisible(),false);
   if(operation==='text')assert.equal(await page.locator('#label').textContent(),'Edited maintenance');
   if(operation==='insert')assert.equal(await page.locator('#new-note').count(),1);
   await page.locator('#close').click();assert.equal(await page.locator('#surface').isVisible(),false);
   await page.locator('#entry').click();
   if(mode==='live')await page.evaluate(patches=>window.engine.apply(patches),patches);
   assert.deepEqual(errors,[],`${type}/${operation}/${mode}`);
  }
  cases++;await page.close();
 }
 console.log(`PASS: ${cases} drilldown edit/lifecycle cases; 3 reopen cycles each; detail pages, drawers, modal dialogs; live, compiled source and standalone export`);
} finally {await browser.close();await new Promise(r=>server.close(r));}
