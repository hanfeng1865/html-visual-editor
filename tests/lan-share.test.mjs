import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
    await share.stop('project:pages/index.html');assert.equal((await fetch(url)).status,404);
  }finally{await share.close();}
});
test('LAN sharing explains missing network connections without starting a public listener',async()=>{
  const share=createLanShareService({mimeTypes,addresses:()=>[]});
  await assert.rejects(share.create('p','index.html',[['index.html',Buffer.from('hi')]]),/Wi-Fi/);await share.close();
});

test('live sharing tracks changed, added and removed assets while excluding private files and links',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lan-share-live-'));
  const service=createLanShareService({mimeTypes,addresses:()=>['127.0.0.1']});
  const revision=async url=>(await(await fetch(url+'__share_revision')).json()).revision;
  const rescan=()=>new Promise(resolve=>setTimeout(resolve,550));
  try {
    await writeFile(join(root,'index.html'),'<body>First</body>');
    const {urls:[url]}=await service.create('live','index.html',[['index.html',Buffer.from('First')]],{root});
    const before=await revision(url);
    assert.match(await(await fetch(url)).text(),/__share_revision/);
    await writeFile(join(root,'index.html'),'<body>Second</body>');
    assert.match(await(await fetch(url)).text(),/Second/);
    await writeFile(join(root,'new.css'),'body{color:red}');
    await rescan();assert.notEqual(await revision(url),before);
    assert.match(await(await fetch(url+'new.css')).text(),/color:red/);
    await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','private.js'),'secret');
    await writeFile(join(root,'ai-config.json'),'secret');await writeFile(join(root,'.env'),'secret');
    await symlink(join(root,'index.html'),join(root,'alias.html'));
    await rescan();
    for(const path of ['node_modules/private.js','ai-config.json','.env','alias.html'])assert.equal((await fetch(url+path)).status,404);
    await rm(join(root,'new.css'));assert.equal((await fetch(url+'new.css')).status,404);
    assert.equal((await fetch(url,{method:'HEAD'})).status,200);
    await service.stop('live');assert.equal((await fetch(url)).status,404);
  }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('persistent shares restore the same URL and port automatically and retain stop across restarts',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'lan-share-persist-')),root=join(temp,'project'),stateFile=join(temp,'private','lan-shares.json');
  await mkdir(root);await writeFile(join(root,'index.html'),'<body>Persistent</body>');
  let service=createLanShareService({mimeTypes,addresses:()=>['127.0.0.1'],stateFile});
  try {
    const {urls:[url]}=await service.create('live','index.html',[['index.html',Buffer.from('Persistent')]],{root,viewportWidth:1440});
    const {urls:[snapshotUrl]}=await service.create('snapshot','index.html',[['index.html',Buffer.from('<body>Snapshot</body>')]]);
    await service.close();
    service=createLanShareService({mimeTypes,addresses:()=>['127.0.0.1'],stateFile});
    await service.ready();
    assert.equal((await fetch(url)).status,200,'saved share is restored without re-sharing');
    assert.match(await(await fetch(url+'index.html?__share_content=1')).text(),/Persistent/);
    assert.match(await(await fetch(snapshotUrl)).text(),/Snapshot/,'built-in snapshots survive restart');
    const {urls:[same]}=await service.create('live','index.html',[['index.html',Buffer.from('Persistent')]],{root,viewportWidth:1440});
    assert.equal(same,url,'token and listener port stay the same');
    await service.stop('live');await service.close();
    service=createLanShareService({mimeTypes,addresses:()=>['127.0.0.1'],stateFile});await service.ready();
    assert.equal((await fetch(url)).status,404,'stopped links do not revive on restart');
    assert.equal((await fetch(snapshotUrl)).status,200);
  }finally{await service.close();await rm(temp,{recursive:true,force:true});}
});
