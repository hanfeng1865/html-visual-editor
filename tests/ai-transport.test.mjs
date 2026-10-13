import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {createAITransport} from '../ai-transport.mjs';

test('AI requests use the configured proxy and keep local model requests direct',async()=>{
 const model=createServer((req,res)=>res.end('model connected'));
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 let tunnels=0;
 const proxy=createServer();
 proxy.on('connect',(req,client,head)=>{
  tunnels++;
  const upstream=connect(model.address().port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');upstream.write(head);upstream.pipe(client);client.pipe(upstream);});
  client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>upstream.destroy());
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const transport=createAITransport({readProxySettings:async()=>({http:`http://127.0.0.1:${proxy.address().port}`,https:`http://127.0.0.1:${proxy.address().port}`,exceptions:[]})});
 try{
  const remote=await transport.fetch('http://model.invalid/v1/models',{signal:AbortSignal.timeout(3000)});
  assert.equal(await remote.text(),'model connected');assert.equal(tunnels,1);
  const local=await transport.fetch(`http://127.0.0.1:${model.address().port}/v1/models`);
  assert.equal(await local.text(),'model connected');assert.equal(tunnels,1);
 }finally{await transport.close();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>model.close(r))]);}
});
