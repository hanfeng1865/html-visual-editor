import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDevServer} from '../dev-server.mjs';

test('LAN share API excludes large spreadsheets and private configuration before export limits',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'lan-share-api-')),project=join(temp,'project'),editorDir=join(temp,'editor');
  await mkdir(project);await mkdir(editorDir);
  await writeFile(join(project,'index.html'),'<body><link href="/style.css"><img src="/icon.svg">Shared page</body>');
  await writeFile(join(project,'style.css'),'body{color:red}');
  await writeFile(join(project,'icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  for(const name of ['vehicles.xlsx','ai-config.json']) {
    const file=await open(join(project,name),'w');
    try{await file.truncate(400*1024*1024);}finally{await file.close();}
  }
  const server=createDevServer({rootDir:temp,editorDir});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    const projectConfig=await(await post('/api/projects/open',{path:project})).json();
    const response=await post(`/api/lan-share?project=${projectConfig.id}&entry=index.html`,{action:'create'});
    const result=await response.json();
    assert.equal(response.status,200,JSON.stringify(result));
    const url=new URL(result.urls[0]);url.hostname='127.0.0.1';
    assert.match(await(await fetch(new URL('index.html?__share_content=1',url))).text(),/Shared page/);
    assert.match(await(await fetch(new URL('style.css',url))).text(),/color:red/);
    assert.equal((await fetch(new URL('icon.svg',url))).status,200);
    for(const path of ['vehicles.xlsx','ai-config.json'])assert.equal((await fetch(new URL(path,url))).status,404);
    await post(`/api/lan-share?project=${projectConfig.id}&entry=index.html`,{action:'stop'});
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
});
