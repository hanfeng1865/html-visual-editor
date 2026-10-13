import {ProxyAgent} from 'undici';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

async function readProxySettings(){
 const env=process.env;
 const http=env.http_proxy||env.HTTP_PROXY||env.all_proxy||env.ALL_PROXY;
 const https=env.https_proxy||env.HTTPS_PROXY||http;
 const exceptions=(env.no_proxy||env.NO_PROXY||'').split(',').map(value=>value.trim()).filter(Boolean);
 if(http||https)return {http,https,exceptions};
 if(process.platform!=='darwin')return {exceptions};
 try{
  const {stdout}=await run('/usr/sbin/scutil',['--proxy'],{timeout:2000,maxBuffer:32768});
  const values=Object.fromEntries([...stdout.matchAll(/^\s*(\w+)\s*:\s*(.+)$/gm)].map(([,key,value])=>[key,value.trim()]));
  const address=prefix=>values[`${prefix}Enable`]==='1'&&values[`${prefix}Proxy`]&&values[`${prefix}Port`]?`http://${values[`${prefix}Proxy`]}:${values[`${prefix}Port`]}`:undefined;
  const block=/ExceptionsList\s*:\s*<array>\s*\{([^}]+)\}/.exec(stdout)?.[1]||'';
  return {http:address('HTTP'),https:address('HTTPS'),exceptions:[...exceptions,...[...block.matchAll(/\d+\s*:\s*(\S+)/g)].map(([,value])=>value)]};
 }catch{return {exceptions};}
}

function bypass(host,exceptions){
 if(host==='localhost'||host==='[::1]'||host.startsWith('127.'))return true;
 return exceptions.some(raw=>{
  const rule=raw.toLowerCase();
  if(rule==='*')return true;
  if(rule==='<local>')return !host.includes('.');
  if(rule.includes('/')){
   const [network,bits]=rule.split('/'),octets=host.split('.').map(Number),base=network.split('.').map(Number),width=Number(bits);
   if(octets.length!==4||base.length!==4||!Number.isInteger(width)||width<0||width>32||[...octets,...base].some(n=>!Number.isInteger(n)||n<0||n>255))return false;
   const number=parts=>parts.reduce((value,n)=>(value<<8)|n,0),mask=width===0?0:-1<<(32-width);
   return (number(octets)&mask)===(number(base)&mask);
  }
  const domain=rule.replace(/^\*?\./,'').replace(/:\d+$/,'');
  return host===domain||host.endsWith(`.${domain}`);
 });
}

export function createAITransport({readProxySettings:readSettings=readProxySettings}={}){
 let settingsPromise,expires=0;
 const agents=new Map();
 return {
  async fetch(endpoint,options={}){
   const url=new URL(endpoint);
   if(!settingsPromise||Date.now()>expires){settingsPromise=readSettings();expires=Date.now()+30000;}
   const settings=await settingsPromise;
   const proxy=url.protocol==='https:'?settings.https:settings.http;
   if(!proxy||bypass(url.hostname,settings.exceptions||[]))return globalThis.fetch(endpoint,options);
   if(!agents.has(proxy))agents.set(proxy,new ProxyAgent(proxy));
   const agent=agents.get(proxy);
   const dispatcher=options.dispatcher?{dispatch(request,handler){return agent.dispatch({...request,headersTimeout:20*60*1000,bodyTimeout:20*60*1000},handler);}}:agent;
   return globalThis.fetch(endpoint,{...options,dispatcher});
  },
  async close(){await Promise.all([...agents.values()].map(agent=>agent.close()));agents.clear();}
 };
}
