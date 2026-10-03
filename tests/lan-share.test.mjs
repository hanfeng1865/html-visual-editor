import test from 'node:test';
import assert from 'node:assert/strict';
import {createLanShareService} from '../lan-share.mjs';

const mimeTypes={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png'};
test('LAN sharing serves a frozen project, scopes local assets, updates the same link and revokes it',async()=>{
  const share=createLanShareService({mimeTypes,addresses:()=>['127.0.0.1']});
  try {
    const files=[['pages/index.html',Buffer.from('<html><link href="/style.css"><h1>Before</h1><img src="../photo.png"></html>')],['style.css',Buffer.from('body{background:url(/photo.png)}')],['photo.png',Buffer.from([1,2,3])],['.env',Buffer.from('private')],['editor-config.json',Buffer.from('private')]];
    const result=await share.create('project:pages/index.html','pages/index.html',files),url=result.urls[0];
    const response=await fetch(url),html=await response.text();assert.equal(response.status,200);assert.match(response.url,/pages\/index.html$/);assert.match(html,/Before/);
    const root=url;assert.ok(html.includes(root.slice(new URL(root).origin.length)+'style.css'));
    assert.match(await (await fetch(root+'style.css')).text(),/\/s\/[a-f0-9]{48}\/photo.png/);
    assert.deepEqual(Buffer.from(await (await fetch(root+'photo.png')).arrayBuffer()),Buffer.from([1,2,3]));
    files[0][1]=Buffer.from('<h1>Changed locally</h1>');assert.match(await (await fetch(url)).text(),/Before/,'local mutations do not change the share');
    const updated=await share.create('project:pages/index.html','pages/index.html',files);assert.equal(updated.urls[0],url);assert.match(await (await fetch(url)).text(),/Changed locally/);
    assert.equal((await fetch(root+'editor-config.json')).status,404);assert.equal((await fetch(root+'.env')).status,404);
    assert.equal((await fetch(new URL('/api/projects',url))).status,404);assert.equal((await fetch(url,{method:'POST',body:'write'})).status,405);
    assert.equal((await fetch(root+'%2e%2e%2feditor-config.json')).status,404);assert.equal((await fetch(root.replace(/\/s\/[a-f0-9]{48}\//,'/s/'+'0'.repeat(48)+'/'))).status,404);
    share.stop('project:pages/index.html');assert.equal((await fetch(url)).status,404);
  }finally{await share.close();}
});
test('LAN sharing explains missing network connections without starting a public listener',async()=>{
  const share=createLanShareService({mimeTypes,addresses:()=>[]});
  await assert.rejects(share.create('p','index.html',[['index.html',Buffer.from('hi')]]),/Wi-Fi/);await share.close();
});
