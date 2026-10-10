import {prdAnnotationsScript} from './prd-annotations-runtime.mjs';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readdir,stat,readFile,realpath,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {extname,join,resolve,dirname} from 'node:path';
import {insideProject,scopeRootUrls} from './project-workspaces.mjs';

export function lanAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flat().filter(item=>item && !item.internal && (item.family==='IPv4' || item.family===4)).map(item=>item.address))];
}

// A separate listener serves only shared project assets, never editor APIs.
const blockedNames=new Set(['node_modules','__pycache__','editor-config.json','ai-config.json','visual-edits.json','change-annotations.json']);
const publicPath=path=>!path.includes('\\') && !path.split('/').some(part=>part.startsWith('.') || blockedNames.has(part));
export const isShareableFile=(path,mimeTypes)=>publicPath(path) && Object.hasOwn(mimeTypes,extname(path).toLowerCase());
function reloadScript(prefix,revision,path) {
  return `<script>(()=>{const revision=${JSON.stringify(revision)};let checking=false;setInterval(async()=>{if(checking)return;checking=true;try{const response=await fetch(${JSON.stringify(prefix+'__share_revision?entry='+encodeURIComponent(path))},{cache:'no-store'});if(response.ok && (await response.json()).revision!==revision)location.reload();}catch{}finally{checking=false;}},2000);})();</script>`;
}
// Render the project in the same layout viewport as the editor. Scaling the
// outer frame preserves media queries and absolute coordinates together.
function sharedCanvasPage(share,path=share.entry,search='') {
  const entry=`/s/${share.token}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const query=new URLSearchParams(search);query.set('__share_content','1');
  const src=(entry+'?'+query).replaceAll('&','&amp;').replaceAll('"','&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>页面预览</title><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}
    body{display:flex}#share-canvas{flex:1;min-width:0;min-height:0;overflow:hidden}#share-prd-sidebar{width:340px;flex-shrink:0;border-left:1px solid #dce2eb;background:white;height:100%;box-sizing:border-box}#share-prd-sidebar[hidden]{display:none}@media(max-width:700px){body{flex-direction:column}#share-prd-sidebar{width:100%;height:40%;border-left:0;border-top:1px solid #dce2eb}}
    #share-page-frame{display:block;border:0;transform-origin:0 0;width:${share.viewportWidth}px}
  </style></head><body><main id="share-canvas"><iframe id="share-page-frame" name="share-page" title="分享页面" src="${src}"></iframe></main><aside id="share-prd-sidebar" hidden aria-label="PRD 标注说明"></aside><script>(()=>{
    const frame=document.getElementById('share-page-frame'),width=${share.viewportWidth};
    const resize=()=>{const canvas=document.getElementById('share-canvas'),scale=canvas.clientWidth/width;frame.style.height=(canvas.clientHeight/scale)+'px';frame.style.transform='scale('+scale+')';};
    if(location.hash)frame.src+=location.hash;
    addEventListener('resize',resize);resize();
  })();</script></body></html>`;
}
export function createLanShareService({mimeTypes,addresses=lanAddresses,stateFile,readPRD}) {
  const shares=new Map();let server=null,starting=null,port=0;
  let writes=Promise.resolve();
  async function restore() {
    if(!stateFile)return;
    let saved;
    try{saved=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(saved.version!==1 || !Number.isInteger(saved.port) || saved.port<1024 || saved.port>65535 || !Array.isArray(saved.shares))throw new Error('局域网分享记录无效，请检查本机分享配置');
    port=saved.port;
    for(const item of saved.shares) {
      if(typeof item.key!=='string' || !/^[a-f0-9]{48}$/.test(item.token) || typeof item.entry!=='string' || !publicPath(item.entry)
        || (item.viewportWidth!==undefined && (!Number.isInteger(item.viewportWidth) || item.viewportWidth<320 || item.viewportWidth>4096))
        || (item.root!==null && typeof item.root!=='string'))throw new Error('局域网分享记录无效');
      const files=new Map((item.files||[]).filter(([path])=>publicPath(path) && Object.hasOwn(mimeTypes,extname(path).toLowerCase())).map(([path,bytes])=>[path,Buffer.from(bytes,'base64')]));
      shares.set(item.key,{...item,files});
    }
    if(shares.size)await start();
  }
  function persist() {
    if(!stateFile)return Promise.resolve();
    const data=JSON.stringify({version:1,port,shares:[...shares.values()].map(item=>({
      key:item.key,token:item.token,entry:item.entry,root:item.root,viewportWidth:item.viewportWidth,revision:item.revision,
      files:item.root?[]:[...item.files].map(([path,bytes])=>[path,bytes.toString('base64')]),
    }))});
    const task=writes.catch(()=>{}).then(async()=>{
      await mkdir(dirname(stateFile),{recursive:true});
      const temp=stateFile+'.'+randomBytes(8).toString('hex')+'.tmp';
      try{await writeFile(temp,data,{mode:0o600});await rename(temp,stateFile);}finally{await rm(temp,{force:true});}
    });
    writes=task;return task;
  }
  async function liveFiles(share) {
    if(share.scan)return share.scan;
    if(share.manifest && Date.now()-share.scannedAt<500)return share.manifest;
    share.scan=(async()=>{
      const files=new Map(),hash=createHash('sha256');let size=0;
      async function walk(folder='') {
        const items=await readdir(join(share.root,folder),{withFileTypes:true});
        items.sort((a,b)=>a.name.localeCompare(b.name));
        for(const item of items) {
          const path=folder?`${folder}/${item.name}`:item.name;
          if(!publicPath(path) || item.isSymbolicLink())continue;
          if(item.isDirectory()){await walk(path);continue;}
          if(!item.isFile() || !isShareableFile(path,mimeTypes))continue;
          const file=await insideProject(share.root,path),info=await stat(file);size+=info.size;
          if(size>200*1024*1024 || files.size>=10000)throw new Error('分享项目超过大小限制');
          files.set(path,file);hash.update(JSON.stringify([path,info.size,info.mtimeMs,info.ctimeMs]));
        }
      }
      await walk();share.manifest={files,revision:hash.digest('hex')};share.scannedAt=Date.now();return share.manifest;
    })();
    try{return await share.scan;}finally{share.scan=null;}
  }
  async function handler(request,response) {
    const fail=status=>{response.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});response.end(status===404?'分享不存在或已停止':'仅支持浏览页面');};
    if(!['GET','HEAD'].includes(request.method))return fail(405);
    try {
      const url=new URL(request.url,'http://localhost'),match=/^\/s\/([a-f0-9]{48})\/(.*)$/.exec(url.pathname);
      if(!match)return fail(404);
      const share=[...shares.values()].find(item=>item.token===match[1]);
      if(!share)return fail(404);
      let path=decodeURIComponent(match[2]);
      if(!path){
        if(share.viewportWidth) {
          response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
          return response.end(request.method==='HEAD'?undefined:sharedCanvasPage(share,share.entry,url.search));
        }
        response.writeHead(302,{location:`/s/${share.token}/${share.entry.split('/').map(encodeURIComponent).join('/')}`,'cache-control':'no-store'});return response.end();
      }
      if(!publicPath(path))return fail(404);
      if(path.endsWith('/'))path+='index.html';
      const live=share.root?await liveFiles(share):null;
      const prd=readPRD&&(path==='__share_revision'||/\.html?$/i.test(path))?await readPRD(share,path==='__share_revision'?(url.searchParams.get('entry')||share.entry):path):null;
      const revision=createHash('sha256').update(JSON.stringify([live?.revision||share.revision,prd?.revision])).digest('hex');
      if(shares.get(share.key)!==share)return fail(404);
      if(path==='__share_revision') {
        response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
        return response.end(request.method==='HEAD'?undefined:JSON.stringify({revision}));
      }
      let bytes;
      if(live) {
        if(!live.files.has(path))return fail(404);
        const file=await insideProject(share.root,path);
        if(file!==resolve(share.root,path))return fail(404);
        bytes=await readFile(file);
      }else bytes=share.files.get(path);
      if(!bytes)return fail(404);
      const extension=extname(path).toLowerCase(),prefix=`/s/${share.token}/`;
      if(share.viewportWidth && ['.html','.htm'].includes(extension)
        && url.searchParams.get('__share_content')!=='1' && request.headers['sec-fetch-dest']!=='iframe') {
        response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
        return response.end(request.method==='HEAD'?undefined:sharedCanvasPage(share,path,url.search));
      }
      let content=['.html','.htm','.css'].includes(extension)?scopeRootUrls(bytes.toString('utf8'),prefix,extension==='.css'):bytes;
      if(['.html','.htm'].includes(extension)) {
        const script=reloadScript(prefix,revision,path)+(prd?.points?.length?prdAnnotationsScript({points:prd.points}):'');
        content=/<\/body\s*>/i.test(content)?content.replace(/<\/body\s*>/i,()=>script+'</body>'):content+script;
      }
      response.writeHead(200,{'content-type':mimeTypes[extension]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
      response.end(request.method==='HEAD'?undefined:content);
    } catch {fail(404);}
  }
  async function start() {
    if(starting)return starting;
    if(server)return;
    server=createServer(handler);
    starting=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>{port=server.address().port;server.removeListener('error',reject);resolve();});});
    try {await starting;}catch(error){server=null;throw error;}finally{starting=null;}
  }
  const initialized=restore();
  initialized.catch(()=>{});
  return {
    ready:()=>initialized,
    async create(key,entry,files,{root,viewportWidth}={}) {
      await initialized;
      if(viewportWidth!==undefined && (!Number.isInteger(viewportWidth) || viewportWidth<320 || viewportWidth>4096))throw Object.assign(new Error('分享画布宽度无效'),{statusCode:400});
      const hosts=addresses();
      if(!hosts.length)throw Object.assign(new Error('未找到局域网地址，请先连接 Wi-Fi 或有线网络'),{statusCode:409});
      const allowed=new Map(files.filter(([path])=>isShareableFile(path,mimeTypes)));
      if(!allowed.has(entry))throw new Error('分享页面不存在');
      await start();
      const token=shares.get(key)?.token || randomBytes(24).toString('hex');
      shares.set(key,{key,token,entry,viewportWidth,files:allowed,root:root?await realpath(root):null,revision:randomBytes(16).toString('hex')});
      await persist();
      return {urls:hosts.map(host=>`http://${host}:${server.address().port}/s/${token}/`),sharedAt:new Date().toISOString()};
    },
    async stop(key){await initialized;if(shares.delete(key))await persist();return {ok:true};},
    async close(){await initialized.catch(()=>{});await writes.catch(()=>{});shares.clear();if(starting)await starting.catch(()=>{});if(server){const current=server;server=null;current.closeAllConnections();await new Promise(resolve=>current.close(resolve));}},
  };
}
