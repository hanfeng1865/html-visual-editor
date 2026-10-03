import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {extname} from 'node:path';
import {scopeRootUrls} from './project-workspaces.mjs';

export function lanAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flat().filter(item=>item && !item.internal && (item.family==='IPv4' || item.family===4)).map(item=>item.address))];
}

// A separate listener serves only explicitly shared snapshots, never editor APIs.
export function createLanShareService({mimeTypes,addresses=lanAddresses}) {
  const shares=new Map();let server=null,starting=null;
  function handler(request,response) {
    const fail=status=>{response.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});response.end(status===404?'分享不存在或已停止':'仅支持浏览页面');};
    if(!['GET','HEAD'].includes(request.method))return fail(405);
    try {
      const url=new URL(request.url,'http://localhost'),match=/^\/s\/([a-f0-9]{48})\/(.*)$/.exec(url.pathname);
      if(!match)return fail(404);
      const share=[...shares.values()].find(item=>item.token===match[1]);
      if(!share)return fail(404);
      let path=decodeURIComponent(match[2]);
      if(!path){response.writeHead(302,{location:`/s/${share.token}/${share.entry.split('/').map(encodeURIComponent).join('/')}`,'cache-control':'no-store'});return response.end();}
      if(path.includes('\\') || path.split('/').some(part=>part.startsWith('.')))return fail(404);
      if(path.endsWith('/'))path+='index.html';
      const bytes=share.files.get(path);if(!bytes)return fail(404);
      const extension=extname(path).toLowerCase(),prefix=`/s/${share.token}/`;
      const content=['.html','.htm','.css'].includes(extension)?scopeRootUrls(bytes.toString('utf8'),prefix,extension==='.css'):bytes;
      response.writeHead(200,{'content-type':mimeTypes[extension]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
      response.end(request.method==='HEAD'?undefined:content);
    } catch {fail(404);}
  }
  async function start() {
    if(starting)return starting;
    if(server)return;
    server=createServer(handler);
    starting=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});
    try {await starting;}catch(error){server=null;throw error;}finally{starting=null;}
  }
  return {
    async create(key,entry,files) {
      const hosts=addresses();
      if(!hosts.length)throw Object.assign(new Error('未找到局域网地址，请先连接 Wi-Fi 或有线网络'),{statusCode:409});
      const allowed=new Map(files.filter(([path])=>Object.hasOwn(mimeTypes,extname(path).toLowerCase()) && !path.split('/').some(part=>part.startsWith('.') || ['editor-config.json','ai-config.json','visual-edits.json','change-annotations.json'].includes(part))));
      if(!allowed.has(entry))throw new Error('分享页面不存在');
      await start();
      const token=shares.get(key)?.token || randomBytes(24).toString('hex');
      shares.set(key,{token,entry,files:allowed});
      return {urls:hosts.map(host=>`http://${host}:${server.address().port}/s/${token}/`),sharedAt:new Date().toISOString()};
    },
    stop(key){shares.delete(key);return {ok:true};},
    async close(){shares.clear();if(starting)await starting.catch(()=>{});if(server){const current=server;server=null;current.closeAllConnections();await new Promise(resolve=>current.close(resolve));}},
  };
}
