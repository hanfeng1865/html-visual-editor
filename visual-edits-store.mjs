import { access, copyFile, mkdir, readFile, readdir, stat, utimes, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

const allowedPatchKeys = new Set(['selector', 'text', 'styles', 'position', 'deleted', 'textNodes', 'icon', 'image', 'insert', 'concealed', 'locked', 'attributes', 'ai', 'templateText', 'tableColumns']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateVisualEdits(value) {
  if (!plainObject(value) || value.version !== 1 || !plainObject(value.patches)) {
    throw new Error('调整文件必须包含 version: 1 和 patches 对象');
  }
  if (Object.keys(value.patches).length > 5000) throw new Error('调整数量超过限制');

  for (const [key, patch] of Object.entries(value.patches)) {
    if (!key || !plainObject(patch)) throw new Error(`补丁 ${key || '(空)'} 格式无效`);
    for (const property of Object.keys(patch)) {
      if (!allowedPatchKeys.has(property)) throw new Error(`补丁 ${key} 包含不支持的字段 ${property}`);
    }
    if (typeof patch.selector !== 'string' || !patch.selector.trim()) throw new Error(`补丁 ${key} 缺少 selector`);
    if ('ai' in patch) {
      if (!plainObject(patch.ai) || !plainObject(patch.ai.fields) || !plainObject(patch.ai.context)
        || !Object.entries(patch.ai.fields).every(([field,reason])=>allowedPatchKeys.has(field) && !['selector','ai'].includes(field) && typeof reason==='string' && reason.length<=2000)
        || JSON.stringify(patch.ai.context).length>40000) throw new Error('AI 修改要求格式无效');
      for (const value of Object.values(patch.ai.context)) if (typeof value!=='string') throw new Error('AI 组件上下文必须是文字');
    }
    if('templateText' in patch && (!plainObject(patch.templateText) || !Number.isInteger(patch.templateText.scriptIndex) || patch.templateText.scriptIndex<0 || typeof patch.templateText.needle!=='string' || !patch.templateText.needle || patch.templateText.needle.length>20000))throw new Error('模板文字定位格式无效');
    if ('text' in patch && typeof patch.text !== 'string') throw new Error(`补丁 ${key} 的 text 必须是字符串`);
    if ('deleted' in patch && patch.deleted !== true) throw new Error(`补丁 ${key} 的 deleted 只能为 true`);
    if('tableColumns' in patch && (!Array.isArray(patch.tableColumns) || patch.tableColumns.length>1000
      || !patch.tableColumns.every(rule=>plainObject(rule) && Object.keys(rule).every(name=>['index','width'].includes(name))
        && Number.isInteger(rule.index) && rule.index>=0 && rule.index<1000 && Number.isFinite(rule.width) && rule.width>=0)
      || new Set(patch.tableColumns.map(rule=>rule.index)).size!==patch.tableColumns.length))throw new Error('表格删列规则格式无效');
    if ('textNodes' in patch && (!plainObject(patch.textNodes) || !Object.entries(patch.textNodes).every(([index,text]) => /^(0|[1-9]\d*)$/.test(index) && typeof text === 'string'))) throw new Error('文字片段格式无效');
    if ('attributes' in patch && (!plainObject(patch.attributes) || !Object.entries(patch.attributes).every(([name,value]) => typeof value === 'string' && (['value','placeholder'].includes(name) || name === 'colspan' && /^[1-9]\d*$/.test(value) && Number(value) <= 1000)))) throw new Error('组件属性格式无效');
    if ('icon' in patch && (typeof patch.icon !== 'string' || !/^[a-z][a-z0-9-]*$/.test(patch.icon))) throw new Error('图标格式无效');
    if ('image' in patch && !['collection.png','customers.png','dashboard.png','declared.png','details.png','ordered.png','pending.png','profit.png','receivable.png','retained.png'].includes(patch.image)) throw new Error('仅支持项目内的图标');
    if ('styles' in patch) {
      if (!plainObject(patch.styles)) throw new Error(`补丁 ${key} 的 styles 必须是对象`);
      for (const [name, styleValue] of Object.entries(patch.styles)) {
        if (!name || typeof styleValue !== 'string') throw new Error(`补丁 ${key} 包含无效样式`);
      }
    }
    for (const flag of ['concealed', 'locked']) if (flag in patch && typeof patch[flag] !== 'boolean') throw new Error(`补丁 ${key} 的 ${flag} 必须为布尔值`);
    if ('insert' in patch) {
      const insert = patch.insert;
      if (!plainObject(insert) || typeof insert.parent !== 'string' || !insert.parent.trim()
        || typeof insert.html !== 'string' || !insert.html.trim() || insert.html.length > 200000) {
        throw new Error(`补丁 ${key} 的新增内容格式无效`);
      }
    }
    if ('position' in patch) {
      const position = patch.position;
      if (!plainObject(position) || typeof position.parent !== 'string' || !position.parent.trim()
        || !Number.isInteger(position.index) || position.index < 0) {
        throw new Error(`补丁 ${key} 的 position 格式无效`);
      }
    }
  }
  return value;
}

export async function readVisualEdits(filePath) {
  try {
    return validateVisualEdits(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, patches: {} };
    throw error;
  }
}

function backupName(now) {
  return `visual-edits-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
}

export async function writeVisualEdits({ filePath, backupDir, value, now = new Date() }) {
  const validated = validateVisualEdits(value);
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await access(filePath, constants.F_OK);
    await mkdir(backupDir, { recursive: true });
    const previous=await stat(filePath),backup=join(backupDir,backupName(now));
    await copyFile(filePath, backup);
    await utimes(backup,previous.atime,previous.mtime);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
  return validated;
}

export async function listVisualHistory({filePath,backupDir,all=false}) {
  let names=[];
  try {names=await readdir(backupDir);}catch(error){if(error.code!=='ENOENT')throw error;}
  const candidates=[{id:'current',path:filePath},...names.filter(name=>/^visual-edits-[\w.-]+\.json$/.test(name)).map(id=>({id,path:join(backupDir,id)}))];
  const versions=[];
  for(const item of candidates) {
    try {
      const value=validateVisualEdits(JSON.parse(await readFile(item.path,'utf8'))),info=await stat(item.path);
      const patches=Object.values(value.patches);
      const texts=patches.flatMap(patch=>[patch.text,...Object.values(patch.textNodes||{})]).filter(text=>typeof text==='string' && text.trim()).slice(0,2).map(text=>text.trim().slice(0,28));
      const parts=[];
      if(texts.length)parts.push(`文字：${texts.map(text=>`“${text}”`).join('、')}`);
      const additions=patches.filter(patch=>patch.insert && !patch.deleted).length,deletions=patches.filter(patch=>patch.deleted).length;
      if(additions)parts.push(`新增 ${additions} 个组件`);
      if(deletions)parts.push(`删除 ${deletions} 个组件`);
      if(patches.some(patch=>patch.styles))parts.push('含样式或位置调整');
      versions.push({id:item.id,savedAt:info.mtime.toISOString(),patchCount:patches.length,beforeRestore:item.id.includes('-draft-'),summary:parts.join(' · ')||'页面布局调整',fingerprint:JSON.stringify(canonical(value.patches))});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const seen=new Set();
  if(all)return versions.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).map(({fingerprint,...version})=>version);
  return versions.sort((a,b)=>(a.id==='current'?-1:b.id==='current'?1:b.savedAt.localeCompare(a.savedAt))).filter(version=>{
    if(!version.patchCount || seen.has(version.fingerprint))return false;
    seen.add(version.fingerprint);return true;
  }).map(({fingerprint,...version})=>version);
}

export async function visualHistoryAt({filePath,backupDir,at}) {
  if(!Number.isFinite(Date.parse(at)))throw new Error('历史时间无效');
  const versions=await listVisualHistory({filePath,backupDir,all:true});
  const match=versions.find(version=>!version.beforeRestore && Date.parse(version.savedAt)<=Date.parse(at));
  return {value:await readVisualHistory({filePath,backupDir,id:match?.id||'original'}),savedAt:match?.savedAt||null};
}

function canonical(value) {
  if(!value || typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
export async function readVisualHistory({filePath,backupDir,id}) {
  if(id==='original')return {version:1,patches:{}};
  if(id!=='current' && (typeof id!=='string' || !/^visual-edits-[\w.-]+\.json$/.test(id)))throw new Error('历史版本无效');
  return validateVisualEdits(JSON.parse(await readFile(id==='current'?filePath:join(backupDir,id),'utf8')));
}

export async function restoreVisualHistory({filePath,backupDir,id,draft}) {
  validateVisualEdits(draft);
  const value=await readVisualHistory({filePath,backupDir,id});
  await mkdir(backupDir,{recursive:true});
  await writeFile(join(backupDir,`visual-edits-draft-${Date.now()}-${randomUUID()}.json`),JSON.stringify(draft,null,2),'utf8');
  await writeVisualEdits({filePath,backupDir,value});
  return value;
}
