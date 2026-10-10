import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type',path.endsWith('.mjs')?'text/javascript':'text/html');res.end(path==='/'?'<body></body>':await readFile(new URL('..'+path,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:660}});await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async()=>{
  document.body.innerHTML='<style>td{padding:12px;color:#234567}input{padding:10px}</style><h2>驾驶舱</h2><input id="query" value="已保存值"><table>'+Array.from({length:1600},(_,i)=>`<tr><td>第${i+1}项</td><td>统计字段</td><td>规则说明</td></tr>`).join('')+'</table><script>window.snapshotExecuted=true<\/script><div id="ve-editor-prd">不应截图的标注工具</div>';
  document.querySelector('#query').value='正在编辑的值';
  const {snapshotPRDPage,encodePRDSnapshot}=await import('/prd-annotations-review.mjs');const snapshot=snapshotPRDPage(document);return {snapshot,encoded:await encodePRDSnapshot(snapshot)};
 });
 assert.ok(result.snapshot.html.length>1500000,'fixture exceeds the former snapshot limit');assert.ok(result.encoded.htmlGzip.length<1500000);assert.equal(result.encoded.html,undefined);
 const html=gunzipSync(Buffer.from(result.encoded.htmlGzip,'base64')).toString('utf8');assert.equal(html,result.snapshot.html);assert.ok(!html.includes('<script'));assert.ok(!html.includes('ve-editor-prd'));assert.ok(html.includes('正在编辑的值'));
 const rendering=await browser.newPage({viewport:{width:1440,height:660},javaScriptEnabled:false});await rendering.setContent(html);assert.equal(await rendering.locator('#query').inputValue(),'正在编辑的值');assert.equal(await rendering.locator('td').count(),4800);assert.equal(await rendering.locator('td').first().evaluate(el=>getComputedStyle(el).color),'rgb(35, 69, 103)');
 console.log(`PRD snapshot: ${(result.snapshot.html.length/1024/1024).toFixed(2)} MB HTML → ${(result.encoded.htmlGzip.length/1024).toFixed(0)} KB transport; styles, unsaved values and sanitization preserved`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
