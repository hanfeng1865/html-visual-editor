import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const catalog=[{id:'requirements',name:'需求文档',usage:'需求分析、补充理解、回答整理与文档修改预览'},{id:'prd-annotations',name:'PRD 标注说明',usage:'区块说明生成、需求核对与标注修改建议'}];
const queues=new Map();
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const revision=content=>createHash('sha256').update(content).digest('hex');
function validate(id,content){
 if(typeof content!=='string'||content.length>50000||!content.trim())throw fail('Skill 内容需为 1–50000 个字符');
 const match=/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(content);
 if(!match||!new RegExp(`^name: ${id}$`,'m').test(match[1])||!/^description: \S.+$/m.test(match[1])||!match[2].trim())throw fail(`保留顶部 name: ${id} 和 description，正文不能为空`);
 return match[2].trim();
}
export function createGenerationSkills(editorDir){
 const folder=join(editorDir,'.editor-workspaces','generation-skills');
 const meta=id=>{const item=catalog.find(item=>item.id===id);if(!item)throw fail('Skill 不存在');return item;};
 async function get(id){
  const item=meta(id),defaultContent=await readFile(new URL(`./generation-skills/${id}/SKILL.md`,import.meta.url),'utf8');
  let saved=null;try{saved=JSON.parse(await readFile(join(folder,id+'.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const content=saved?.content??defaultContent;validate(id,content);
  return {...item,content,defaultContent,revision:saved?.revision??revision(defaultContent),source:saved?.content===defaultContent||!saved?'default':'custom',updatedAt:saved?.updatedAt??null,history:saved?.history??[]};
 }
 async function list(){return {skills:await Promise.all(catalog.map(item=>get(item.id)))};}
 async function save(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Skill 请求无效');
  meta(input.id);const key=join(folder,input.id+'.json'),previous=queues.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
   const current=await get(input.id);
   if(input.revision!==current.revision)throw fail('Skill 已在其他窗口更新，请重新打开后再保存',409);
   if(input.action!==undefined&&!['save','reset'].includes(input.action))throw fail('Skill 操作无效');
   const content=input.action==='reset'?current.defaultContent:input.content;validate(input.id,content);
   if(content===current.content)return current;
   const value={content,revision:randomUUID(),updatedAt:new Date().toISOString(),history:[{content:current.content,revision:current.revision,updatedAt:current.updatedAt},...current.history].slice(0,20)};
   await mkdir(folder,{recursive:true});const temp=key+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,key);return get(input.id);
  });queues.set(key,next);try{return await next;}finally{if(queues.get(key)===next)queues.delete(key);}
 }
 async function load(id){const current=await get(id);return {instruction:validate(id,current.content),skill:{id,name:current.name,revision:current.revision,source:current.source}};}
 return {list,get,save,load};
}

export async function loadDefaultGenerationSkill(id){
 const item=catalog.find(item=>item.id===id);if(!item)throw fail('Skill 不存在');
 const content=await readFile(new URL(`./generation-skills/${id}/SKILL.md`,import.meta.url),'utf8');
 return {instruction:validate(id,content),skill:{id,name:item.name,revision:revision(content),source:'default'}};
}
