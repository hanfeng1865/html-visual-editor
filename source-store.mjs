import {readFile,writeFile,rename,mkdir,readdir,unlink} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {insideProject} from './project-workspaces.mjs';
import {readVisualEdits,validateVisualEdits,readVisualHistory,listVisualHistory} from './visual-edits-store.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const queues=new Map();
async function exclusive(root,action){const previous=queues.get(root)||Promise.resolve();const next=previous.catch(()=>{}).then(action);queues.set(root,next);try{return await next;}finally{if(queues.get(root)===next)queues.delete(root);}}
const historyDir=project=>join(dirname(project.editsFile),'.source-history');
async function atomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,value);try{await rename(temp,path);}finally{await unlink(temp).catch(()=>{});}}
export async function readSourceState(project,editorDir) {
  const files={};let bytes=0;
  const add=async entry=>{const path=await insideProject(project.root,entry);const value=await readFile(path,'utf8');bytes+=Buffer.byteLength(value);if(bytes>20*1024*1024)throw fail('源码超过 20MB，请选择更具体的项目目录',413);files[entry]=value;};
  await add(project.entry);
  async function walk(folder='') {
    for(const item of await readdir(join(project.root,folder),{withFileTypes:true})) {
      if(item.name.startsWith('.') || item.isSymbolicLink() || ['node_modules','vendor','dist'].includes(item.name))continue;
      const entry=folder?`${folder}/${item.name}`:item.name;
      if(resolve(project.root,entry)===resolve(editorDir))continue;
      if(item.isDirectory())await walk(entry);
      else if(/\.(css|js|mjs)$/i.test(entry))await add(entry);
      if(Object.keys(files).length>1000)throw fail('源码文件超过 1000 个，请选择更具体的目录',413);
    }
  }
  await walk();
  const patches=await readVisualEdits(project.editsFile);
  const hashes=Object.fromEntries(Object.keys(files).sort().map(path=>[path,hash(files[path])]));
  return {source:files[project.entry],files,hashes,revision:hash(JSON.stringify([hashes,patches])),entry:project.entry};
}
async function snapshot(project,current,patches,kind,id=`code-${Date.now()}-${randomUUID()}`) {
  const record={id,createdAt:new Date().toISOString(),entry:project.entry,files:current.files,patches,kind};
  await atomic(join(historyDir(project),`${id}.json`),JSON.stringify(record));return record;
}
export async function ensureSourceOrigin(project,editorDir) {
  const current=await readSourceState(project,editorDir);
  await mkdir(historyDir(project),{recursive:true});
  try {await writeFile(join(historyDir(project),'original.json'),JSON.stringify({id:'original',createdAt:new Date().toISOString(),entry:project.entry,files:current.files,patches:{},kind:'original'}),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  return current;
}
export async function readSourceVersion(project,id) {
  if(typeof id==='string' && id.startsWith('legacy:')) {
    const original=await readSourceVersion(project,'original');
    const value=await readVisualHistory({filePath:project.editsFile,backupDir:project.backupDir,id:id.slice(7)});
    return {...original,id,patches:value.patches,kind:'legacy'};
  }
  if(id!=='original' && !/^code-\d+-[a-f0-9-]+$/.test(id||''))throw fail('源码版本无效',400);
  const value=JSON.parse(await readFile(join(historyDir(project),`${id}.json`),'utf8'));
  if(value.entry!==project.entry)throw fail('版本不属于当前页面',400);return value;
}
export async function listSourceVersions(project) {
  let names=[];try{names=await readdir(historyDir(project));}catch(error){if(error.code!=='ENOENT')throw error;}
  const records=await Promise.all(names.filter(name=>name.startsWith('code-')&&name.endsWith('.json')).map(name=>readSourceVersion(project,name.slice(0,-5))));
  const versions=records.map(record=>({id:record.id,savedAt:record.createdAt,patchCount:Object.keys(record.patches).length,sourceVersion:true,beforeRestore:record.kind==='before-restore',summary:`${record.kind==='saved'?'已写入源码':record.kind==='restored'?'恢复后的源码':record.kind==='before-save'?'保存前的源码与草稿':'恢复前的源码与草稿'} · ${Object.keys(record.files).length} 个源码文件`}));
  versions.push(...(await listVisualHistory({filePath:project.editsFile,backupDir:project.backupDir})).filter(v=>!records.length || v.id!=='current').map(v=>({...v,id:`legacy:${v.id}`,summary:`旧版调整记录 · ${v.summary}`})));
  return versions.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
}
async function writeTransaction(project,files,patches) {
  const paths=[];
  for(const [entry,value] of Object.entries(files)) {
    if(typeof value!=='string')throw fail('版本源码无效',400);
    const path=await insideProject(project.root,entry);paths.push({path,value,before:await readFile(path,'utf8')});
  }
  let oldEdits=null;try{oldEdits=await readFile(project.editsFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  try {
    for(const item of paths)if(item.before!==item.value)await atomic(item.path,item.value);
    await atomic(project.editsFile,JSON.stringify({version:1,patches},null,2));
  }catch(error){
    for(const item of paths)await atomic(item.path,item.before);
    if(oldEdits!==null)await atomic(project.editsFile,oldEdits);else await unlink(project.editsFile).catch(()=>{});
    throw error;
  }
}
export async function saveSource(project,editorDir,{revision,html,draft}) {
  return exclusive(project.root,async()=>{
    validateVisualEdits(draft);
    if(typeof html!=='string' || !html.trim() || Buffer.byteLength(html)>10*1024*1024)throw fail('HTML 内容无效或超过 10MB',400);
    const current=await ensureSourceOrigin(project,editorDir);
    if(current.revision!==revision)throw fail('源码又发生变化，请重新检查后保存');
    await snapshot(project,current,draft.patches,'before-save');
    if((await readSourceState(project,editorDir)).revision!==revision)throw fail('备份期间源码发生变化，未写入任何修改');
    await writeTransaction(project,{[project.entry]:html},{});
    const result=await readSourceState(project,editorDir);await snapshot(project,result,{},'saved');return result;
  });
}
export async function restoreSource(project,editorDir,{id,revision,draft}) {
  return exclusive(project.root,async()=>{
    validateVisualEdits(draft);const target=await readSourceVersion(project,id);
    const current=await readSourceState(project,editorDir);
    if(current.revision!==revision)throw fail('源码发生变化，请重新预览并确认恢复');
    await snapshot(project,current,draft.patches,'before-restore');
    if((await readSourceState(project,editorDir)).revision!==revision)throw fail('备份期间源码发生变化，未恢复');
    await writeTransaction(project,target.files,target.patches);
    const result=await readSourceState(project,editorDir);await snapshot(project,result,target.patches,'restored');
    return {...result,version:1,patches:target.patches};
  });
}
