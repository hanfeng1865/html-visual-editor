import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const source=await readFile(new URL('../ai-editor.mjs',import.meta.url));
const server=createServer((req,res)=>{
  res.setHeader('content-type',req.url==='/ai-editor.mjs'?'text/javascript':'text/html');
  res.end(req.url==='/ai-editor.mjs'?source:'<!doctype html><body></body>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results=await page.evaluate(async()=>{
    const {trackAIView,captureAIView,verifyAIPage}=await import('/ai-editor.mjs');
    const results=[];
    for(const label of ['设置范围','回收列表','查看结果','预览']) {
      const frame=document.createElement('iframe');document.body.append(frame);
      const doc=frame.contentDocument;
      doc.body.innerHTML=`<button id="open">${label}</button><dialog id="editor"><h2 id="editor-title">新建考试</h2></dialog><button id="submit" type="submit">${label}</button><form><button id="form-submit">${label}</button></form>`;
      let submitted=0;
      doc.querySelector('#open').onclick=()=>{doc.querySelector('#editor-title').textContent='办公环境满意度调查';doc.querySelector('#editor').showModal();};
      doc.querySelector('#submit').onclick=()=>submitted++;
      doc.querySelector('#form-submit').onclick=event=>{event.preventDefault();submitted++;};
      trackAIView(doc,element=>'#'+element.id);
      doc.querySelector('#open').click();
      const context=captureAIView(doc.querySelector('#editor-title'));
      doc.querySelector('#editor').close();doc.querySelector('#editor-title').textContent='新建考试';
      const pending={title:{selector:'#editor-title',text:'办公环境满意度调查',ai:{context}}};
      const valid=await verifyAIPage(doc,pending);
      const wrong=await verifyAIPage(doc,{title:{...pending.title,text:'错误标题'}});
      const unsafe=[];
      for(const selector of ['#submit','#form-submit'])unsafe.push(...await verifyAIPage(doc,{title:{...pending.title,ai:{context:{viewActions:JSON.stringify([{selector,label}])}}}}));
      results.push({label,context,valid,wrong,unsafe,submitted});frame.remove();
    }
    return results;
  });
  for(const result of results) {
    assert.equal(typeof result.context.viewActions,'string',`${result.label} must record its dialog entry`);
    assert.deepEqual(result.valid,[],`${result.label} must open the dialog before validation`);
    assert.equal(result.wrong.length,1);
    assert.equal(result.unsafe.length,2);
    assert.equal(result.submitted,0);
  }
  console.log('PASS: dialog entry replay validates generated titles and rejects submit actions');
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
