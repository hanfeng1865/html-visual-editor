import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {readLogicSources} from './logic-note-ai.mjs';
import {readAnnotations} from './change-annotations-store.mjs';
import {loadDefaultGenerationSkill} from './generation-skills.mjs';
import {confirmedRequirementAnswers} from './prd-knowledge.mjs';
import {projectUrl} from './project-workspaces.mjs';
import {sanitizeDiagram} from './diagram-sanitize.mjs';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function createDiagramService({ai,skills,requirements}){
 const candidates=new Map(),ttl=30*60*1000;
 const annotationWrites=new Map();
 const annotationFile=project=>join(dirname(project.annotationsFile),'business-diagrams.json');
 async function annotationDiagrams(project){
  try{return JSON.parse(await readFile(annotationFile(project),'utf8'));}
  catch(error){if(error.code==='ENOENT')return {};throw error;}
 }
 const key=p=>JSON.stringify([p.id,resolve(p.root),p.entry]);
 const prune=()=>{for(const [id,c]of candidates)if(Date.now()-c.created>ttl)candidates.delete(id);};
 async function generate(project,input,{onProgress}={}){
  if(!input||!['component','document'].includes(input.mode)||!['flowchart','swimlane','architecture','sequence'].includes(input.type))throw fail('图解形式或类型无效');
  for(const [field,max]of [['request',12000],['current',350000],['context',20000]])if(input[field]!==undefined&&(typeof input[field]!=='string'||input[field].length>max))throw fail('图解输入过长或无效');
  if(!input.request?.trim())throw fail('请填写图解描述');
  onProgress?.({type:'phase',message:'正在整理当前页面、业务说明和已确认需求。'});
  const [{files,excluded},annotations,state,generationSkill,reference]=await Promise.all([readLogicSources(project),readAnnotations(project.annotationsFile),requirements.read(project),skills?skills.load('diagram-design'):loadDefaultGenerationSkill('diagram-design'),readFile(new URL('./generation-skills/diagram-design/references/type-'+input.type+'.md',import.meta.url),'utf8')]);
  const confirmedRequirements=(state.iterations||[]).filter(i=>i.pages?.includes(project.entry)||i.scope==='all').map(i=>({name:i.name,document:i.document,confirmedAnswers:confirmedRequirementAnswers(i),questions:i.questions,conflicts:i.conflicts}));
  onProgress?.({type:'phase',message:'页面内容已整理，正在梳理业务流程。'});
  let result,clean;const layoutFeedback=[];
  for(let attempt=0;attempt<2;attempt++){
  result=await ai.discussRequirements({onProgress,instruction:generationSkill.instruction+'\n类型参考（只用布局与结构，输出及安全约束以上述编辑器协议为准）：\n'+reference+'\n本轮固定输出协议：仅 JSON {"summary":"面向用户的业务梳理摘要","title":"标题","html":"静态 HTML/SVG"}。summary 必须是第一个字段，用 200–600 字说明图中主要业务环节、关键规则与待确认事项，作为最终产物的公开摘要，不包含内部推理。随后输出 title 和 html。所有图解内容必须在单个 div data-editor-component="diagram" 中。HTML 不得包含资源、脚本或事件。本轮展示要求优先于类型参考：读者是产品经理，只用业务语言描述用户操作、条件和结果。避免“加载、持久化、固定编号、校验”等实现术语，不展示源码路径、文件名、函数名或“依据”“来源”说明；未知规则列入待确认。卡片互不重叠，间距至少 24px，连线不能穿过其他卡片；异常分支必须明确结束或返回操作，不能跳过条件直接接回正常流程。若本轮提供 layoutFeedback，按指出的位置重新排版，保持业务含义不变。SVG 必须 width:100%;min-width:0;height:auto，采用紧凑纵向流程或拆分为多图，不设置横向滚动或固定最小宽度。',task:{mode:input.mode,type:input.type,request:input.request,current:attempt?result.html:input.current||'',layoutFeedback:[...layoutFeedback],context:input.context||'',entry:project.entry,files,excludedSources:excluded,annotations,confirmedRequirements,evidenceNote:'源码与逻辑说明为已保存版本。需求正文是人工维护文档；未回答问题和冲突不视为已确认。当前选区和旧图仅作补充。来源路径只供内部核对，不出现在输出内容中。图中只展示业务流程、规则和待确认事项，不把未知规则写成已确认。'}});
  if(typeof result?.title!=='string'||!result.title.trim()||result.title.length>150)throw fail('AI 未返回有效图解标题',502);
  onProgress?.({type:'phase',message:'图解已生成，正在检查文字、卡片和连线是否清楚。'});
  clean=await sanitizeDiagram(result.html,result.title.trim());
  if(!clean.layoutIssues.length)break;
  if(attempt===1)throw fail('图解排布仍然拥挤，未替换原预览。请重试，或将流程拆成两张图。',502);
  layoutFeedback.splice(0,layoutFeedback.length,...clean.layoutIssues);
  onProgress?.({type:'phase',message:'发现部分卡片或连线排布拥挤，正在重新排版。'});
  }
  prune();while(candidates.size>=30)candidates.delete(candidates.keys().next().value);
  const value={id:randomUUID(),title:result.title.trim(),type:input.type,...clean,skill:generationSkill.skill};
  candidates.set(value.id,{...value,mode:input.mode,project:key(project),created:Date.now()});return value;
 }
 async function save(project,input){
  prune();const candidate=candidates.get(input?.id);
  if(!candidate||candidate.project!==key(project))throw fail('图解候选不存在或已过期，请重新生成',404);
  if(input.annotationId!==undefined){
   const annotationId=input.annotationId;
   if(typeof annotationId!=='string'||!annotationId||annotationId.length>500)throw fail('逻辑说明编号无效');
   const file=annotationFile(project);
   const pending=(annotationWrites.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const annotations=await readAnnotations(project.annotationsFile);
    if(!annotations.boxes.some(box=>box.id===annotationId))throw fail('对应的逻辑说明已不存在，请重新选择。',404);
    const records=await annotationDiagrams(project);
    const diagram={title:candidate.title,type:candidate.type,html:candidate.html,component:candidate.component};
    const active=new Set(annotations.boxes.map(box=>box.id));
    const next=Object.fromEntries(Object.entries(records).filter(([id])=>active.has(id)));
    Object.defineProperty(next,annotationId,{value:diagram,enumerable:true,configurable:true});
    await mkdir(dirname(file),{recursive:true});
    const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next)+'\n');await rename(temp,file);
    return {annotationId,diagram};
   });
   annotationWrites.set(file,pending);
   try{return await pending;}finally{if(annotationWrites.get(file)===pending)annotationWrites.delete(file);}
  }
  if(candidate.mode!=='document')throw fail('组件请在编辑器中采用后保存');
  if(candidate.saved)return candidate.saved;
  if(candidate.saving)return candidate.saving;
  candidate.saving=(async()=>{
  const entry='diagram-'+randomUUID()+'.html';
  await writeFile(join(project.root,entry),candidate.html,{flag:'wx',mode:0o600});
  const url=projectUrl(project.id,entry),editorUrl='/editor/editor.html?'+new URLSearchParams({project:project.id,entry});
  candidate.saved={entry,url,editorUrl};return candidate.saved;
  })();
  try{return await candidate.saving;}finally{delete candidate.saving;}
 }
 return {generate,save,annotationDiagrams};
}
