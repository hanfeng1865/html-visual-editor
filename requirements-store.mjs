import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateAIContext} from './ai-context.mjs';

export const MAX_PENDING_QUESTIONS=500;
const queues=new Map();
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const clone=value=>structuredClone(value);
const now=()=>new Date().toISOString();
function string(value,label,max=2000,required=false){
  if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(`${label}格式无效`);
  return value;
}
function pages(value){
  if(!Array.isArray(value)||value.length>500)fail('关联页面格式无效');
  return [...new Set(value.map(v=>{string(v,'页面',1000,true);if(v.startsWith('/')||v.includes('\\')||v.split('/').includes('..')||v.includes('\0'))fail('页面路径无效');return v;}))];
}
function metadata(input,current={}){
  const out={};
  for(const key of ['name','scene','scope','pages','note'])if(key in input)out[key]=input[key];
  const merged={...current,...out};
  string(merged.name,'迭代名称',200,true);
  if(!['new','continue','redraw','other'].includes(merged.scene))fail('迭代场景无效');
  if(!['all','partial','unknown'].includes(merged.scope))fail('迭代范围无效');
  merged.pages=pages(merged.pages??[]);string(merged.note??'','补充说明',20000);
  if(merged.scope==='partial'&&!merged.pages.length)fail('请选择关联页面');
  return {name:merged.name,scene:merged.scene,scope:merged.scope,pages:merged.pages,note:merged.note??''};
}
function publicState(state){
  // Snapshot content is used by the server only, never shipped to the browser.
  const clean=(value,archive=false)=>{
    if(Array.isArray(value))return value.map(item=>clean(item,archive));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='files'&&key!=='documentBase'&&(!archive||!['materials','history','messages'].includes(key))).map(([key,val])=>[key,clean(val,archive||key==='completions'||key==='baseline')]));
    return value;
  };
  return clean(state);
}
function material(value){
  if(!value||!['text','image','audio'].includes(value.kind))fail('资料类型无效');
  const result={id:randomUUID(),kind:value.kind,name:string(value.name??'资料','资料名称',200,true),text:string(value.text??'','资料文字',100000),createdAt:now()};
  if(value.kind==='image')result.url=validateAIContext({images:[{name:result.name,url:value.url}]}).images[0].url;
  if(value.kind==='audio'){
    if(typeof value.url!=='string'||value.url.length>21*1024*1024)fail('录音超过 15MB');
    const match=/^data:audio\/(?:webm|mpeg|mp3|mp4|wav|x-wav|ogg|aac)(?:;codecs=[\w-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.url);
    if(!match||match[1].length%4||Buffer.from(match[1],'base64').length>15*1024*1024)fail('录音格式无效或超过 15MB');
    result.url=value.url;
  }
  return result;
}
function archiveDocument(it,source){
  it.documentArchive??=[];
  if(it.document)it.documentArchive.push({id:randomUUID(),document:it.document,createdAt:now(),source});
  it.documentArchive=it.documentArchive.slice(-50);
}
function updateDocument(it,document,source){
  string(document,'需求文档',250000);
  if(document===it.document)return;
  archiveDocument(it,source);it.documentRedo=[];
  it.documentHistory.push({id:randomUUID(),document:it.document,createdAt:now(),source});
  it.documentHistory=it.documentHistory.slice(-50);it.document=document;
}

function applyAIResult(it,input,time){
          if(it.scope==='all'&&input.analyzedPages)it.pages=pages(input.analyzedPages);
          const result=input.result;if(!result||typeof result!=='object')fail('AI 结果无效');
          if(typeof input.message==='string'&&input.message.trim())it.messages.push({id:randomUUID(),role:'user',content:string(input.message,'消息',100000),createdAt:time});
          it.messages.push({id:randomUUID(),role:'assistant',content:string(result.reply??'','回复',100000),createdAt:time});it.messages=it.messages.slice(-100);
          if(result.document!==undefined)updateDocument(it,result.document,'ai');
          if(input.syncedQuestionIds){for(const q of [...(it.interviews||[]).flatMap(r=>r.questions),...(it.extraAnswers||[])])if(input.syncedQuestionIds.includes(q.id)){q.needsDocumentSync=false;q.documentSyncedAt=time;}}
          if(input.interviewId){const round=it.interviews?.find(r=>r.id===input.interviewId);if(round)round.submittedAt=time;}
          if(result.questions!==undefined){if(!Array.isArray(result.questions)||result.questions.length>MAX_PENDING_QUESTIONS)fail('待确认问题格式无效');it.questions=[...new Set(result.questions.map(q=>string(q,'问题',5000)))];
            const round=it.interviews?.findLast(r=>r.source==='pending'&&!r.submittedAt);
            if(round){const old=new Map(round.questions.map(q=>[q.text,q]));round.questions=[...round.questions.filter(q=>q.status==='answered'),...it.questions.filter(text=>old.get(text)?.status!=='answered').map(text=>old.get(text)||{id:randomUUID(),text,options:[],hint:'',status:'pending',choice:null,textAnswer:'',answer:''})];}
          }
          if(result.suggestions!==undefined){
            if(!Array.isArray(result.suggestions)||result.suggestions.length>30)fail('同步建议格式无效');
            for(const item of result.suggestions){
              const suggestion={id:randomUUID(),title:string(item.title,'建议标题',300,true),reason:string(item.reason??'','建议原因',5000),request:string(item.request??'','原型修改要求',20000),entry:string(item.entry??'','关联页面',1000),status:'pending',createdAt:time};
              if(suggestion.entry)pages([suggestion.entry]);
              if(item.document!==undefined){suggestion.document=string(item.document,'建议文档',250000);suggestion.documentBase=it.document;}
              if(!it.suggestions.some(s=>s.status==='pending'&&s.title===suggestion.title&&s.request===suggestion.request&&s.document===suggestion.document&&s.documentBase===suggestion.documentBase))it.suggestions.push(suggestion);
            }
            if(it.suggestions.length>200)fail('同步建议数量已达上限');
          }
          if(result.conflicts!==undefined){
            if(!Array.isArray(result.conflicts)||result.conflicts.length>100)fail('逻辑冲突格式无效');it.conflicts??=[];
            for(const item of result.conflicts){
              const title=string(item.title,'冲突标题',300,true),impact=string(item.impact??'','冲突影响',4000);
              if(!Array.isArray(item.statements)||item.statements.length<2||item.statements.length>6)fail('冲突须提供至少两种说法');
              const statements=item.statements.map(s=>({source:string(s.source,'冲突来源',1000,true),text:string(s.text,'冲突内容',5000,true)}));
              if(!it.conflicts.some(c=>c.title===title&&JSON.stringify(c.statements)===JSON.stringify(statements)))it.conflicts.push({id:randomUUID(),title,impact,statements,status:'pending',explanation:'',createdAt:time});
            }
            if(it.conflicts.length>500)fail('逻辑冲突超过容量');
          }
          if(input.resolvedConflictId){
            const conflict=it.conflicts?.find(c=>c.id===input.resolvedConflictId);if(!conflict||!conflict.explanation?.trim()||!result.document?.trim())fail('冲突解释尚未整理到文档');
            Object.assign(conflict,{status:'resolved',resolvedAt:time,needsDocumentSync:false,resolutionReply:result.reply,documentUpdatedAt:time});
          }
          if(input.snapshot)it.lastAnalysis=clone(input.snapshot);
}

export function createRequirementsStore(editorDir,{snapshot}={}){
  if(typeof snapshot!=='function')throw new Error('snapshot callback required');
  const path=project=>join(resolve(editorDir),'.editor-workspaces','requirements',createHash('sha256').update(resolve(project.root)).digest('hex'),'state.json');
  async function readFull(project){
    try{return JSON.parse(await readFile(path(project),'utf8'));}catch(error){if(error.code==='ENOENT')return {version:0,iterations:[]};throw error;}
  }
  async function read(project){return publicState(await readFull(project));}
  async function apply(project,input){
    if(!input||typeof input!=='object')fail('迭代请求无效');
    const state=await readFull(project);
    if(!Number.isInteger(input.version)||input.version!==state.version)fail('迭代已更新，请刷新后重试',409);
    const time=now();let it;
    if(input.action==='create'){
      if(state.iterations.length>=200)fail('迭代数量已达上限');
      let baseline=null;
      if(input.baselineId){const base=state.iterations.find(i=>i.id===input.baselineId);if(!base?.completions?.length)fail('参考迭代尚未完成');baseline=clone(base.completions.at(-1));}
      it={id:randomUUID(),...metadata(input),status:'pending',baselineId:input.baselineId??null,baseline,initialSnapshot:null,lastAnalysis:null,completions:[],document:'',documentHistory:[],questions:[],suggestions:[],materials:[],messages:[],createdAt:time,updatedAt:time};
      state.iterations.push(it);
    }else{
      it=state.iterations.find(value=>value.id===input.id);if(!it)fail('迭代不存在');
      if(!['reopen','delete'].includes(input.action)&&it.status==='done')fail('请先重新打开已完成迭代',409);
      switch(input.action){
        case 'delete':
          if(input.confirmed!==true)fail('请确认后再删除迭代');
          state.iterations=state.iterations.filter(value=>value.id!==it.id);
          for(const remaining of state.iterations)if(remaining.baselineId===it.id)remaining.baselineId=null;
          break;
        case 'metadata':{
          Object.assign(it,metadata(input,it));
          if('baselineId' in input&&input.baselineId!==it.baselineId){
            if(input.baselineId){const base=state.iterations.find(i=>i.id===input.baselineId&&i.id!==it.id);if(!base?.completions?.length)fail('参考迭代尚未完成');it.baseline=clone(base.completions.at(-1));}
            else it.baseline=null;
            it.baselineId=input.baselineId||null;
          }
          it.lastAnalysis=null;break;
        }
        case 'start':
          if(it.status!=='pending')fail('仅待开始迭代可以开始',409);
          if(it.scope==='all'&&project.pages)it.pages=pages(project.pages);
          it.initialSnapshot=clone(await snapshot(project,it.pages.length?it.pages:project.pages));it.status='active';it.startedAt=time;break;
        case 'finish':{
          if(it.status!=='active')fail('仅进行中迭代可以结束',409);
          if(it.scope==='all'&&project.pages)it.pages=pages(project.pages);
          const captured=clone(await snapshot(project,it.pages.length?it.pages:project.pages));
          it.completions.push({id:randomUUID(),completedAt:time,note:string(input.note??'','结束说明',20000),snapshot:captured,document:it.document,questions:clone(it.questions),suggestions:clone(it.suggestions),messages:clone(it.messages),materials:clone(it.materials),history:clone(it.documentHistory),metadata:metadata(it)});
          it.status='done';it.completedAt=time;break;
        }
        case 'reopen':if(it.status!=='done')fail('仅已完成迭代可以重新打开',409);it.status='active';it.reopenedAt=time;break;
        case 'document':updateDocument(it,input.document,'manual');break;
        case 'undoDocument':{
          const previous=it.documentHistory.at(-1);if(!previous)fail('没有可撤销的文档修改');
          archiveDocument(it,'undo');it.documentRedo??=[];it.documentRedo.push({id:randomUUID(),document:it.document,createdAt:time,source:'undo'});it.documentRedo=it.documentRedo.slice(-50);
          it.documentHistory.pop();it.document=previous.document;break;
        }
        case 'redoDocument':{
          const next=it.documentRedo?.at(-1);if(!next)fail('没有可重做的文档修改');
          archiveDocument(it,'redo');it.documentHistory.push({id:randomUUID(),document:it.document,createdAt:time,source:'redo'});it.documentHistory=it.documentHistory.slice(-50);
          it.documentRedo.pop();it.document=next.document;break;
        }
        case 'pendingQuestions':{
          if(it.status!=='active')fail('请先开始迭代');
          it.interviews??=[];
          if(it.interviews.some(r=>!r.submittedAt))break;
          if(!it.questions.length)fail('当前没有待回答问题');
          if(it.interviews.length>=20)fail('本次迭代最多保留 20 轮问题');
          it.interviews.push({id:randomUUID(),createdAt:time,source:'pending',questions:[...new Set(it.questions)].map(text=>({id:randomUUID(),text,options:[],hint:'',status:'pending',choice:null,textAnswer:'',answer:''}))});break;
        }
        case 'questionnaire':{
          if(it.status!=='active')fail('请先开始迭代');
          it.interviews??=[];if(it.interviews.length>=20)fail('本次迭代最多保留 20 轮问题');
          if(!Array.isArray(input.questions)||!input.questions.length||input.questions.length>20)fail('问题格式无效');
          it.interviews.push({id:randomUUID(),createdAt:time,questions:input.questions.map(q=>({id:randomUUID(),text:q.text,options:q.options,hint:q.hint||'',status:'pending',choice:null,textAnswer:'',answer:''}))});break;
        }
        case 'questionAnswer':{
          if(it.status!=='active')fail('请先开始迭代');
          const round=it.interviews?.find(r=>r.id===input.interviewId);if(!round)fail('未找到本轮问题');if(round.submittedAt)fail('本轮回答已整理，不能再修改',409);
          const q=round.questions.find(q=>q.id===input.questionId);if(!q)fail('未找到当前问题');
          if(input.skip===true){Object.assign(q,{status:'skipped',choice:null,textAnswer:'',answer:'',answeredAt:time,needsDocumentSync:false});if(round.source==='pending'&&!it.questions.includes(q.text))it.questions.push(q.text);break;}
          const choice=input.choice??null,text=string(input.text??'','手写答案',1000).trim();
          if(choice!==null&&(!Number.isInteger(choice)||choice<0||choice>=q.options.length))fail('请选择有效选项');
          if(choice===null&&!text)fail('请选择选项、手写答案，或跳过');
          Object.assign(q,{status:'answered',choice,textAnswer:text,answer:[choice===null?'':q.options[choice],text].filter(Boolean).join('；补充：'),answeredAt:time,needsDocumentSync:true});
          if(round.source==='pending')it.questions=it.questions.filter(text=>text!==q.text);
          break;
        }
        case 'reviseAnswer':{
          if(it.status!=='active')fail('请先开始或重新打开迭代',409);
          let q=[...(it.interviews||[]).flatMap(r=>r.questions),...(it.extraAnswers||[])].find(q=>q.id===input.questionId);
          if(!q){const text=string(input.pendingQuestion??'','待补充问题',5000,true);if(!it.questions.includes(text))fail('待补充事项已变化，请刷新后重试',409);
            it.extraAnswers??=[];if(it.extraAnswers.length>=100)fail('补充回答已达上限');q={id:randomUUID(),text,options:[],status:'pending',choice:null,textAnswer:'',answer:''};it.extraAnswers.push(q);
          }
          const choice=input.choice??null,text=string(input.text??'','手写答案',1000).trim();
          if(choice!==null&&(!Number.isInteger(choice)||choice<0||choice>=q.options.length))fail('请选择有效选项');
          if(choice===null&&!text)fail('请选择选项或填写答案');
          q.answerHistory??=[];if(q.status==='answered')q.answerHistory.push({answer:q.answer,choice:q.choice,textAnswer:q.textAnswer,createdAt:q.answeredAt});q.answerHistory=q.answerHistory.slice(-30);
          Object.assign(q,{status:'answered',choice,textAnswer:text,answer:[choice===null?'':q.options[choice],text].filter(Boolean).join('；补充：'),answeredAt:time,needsDocumentSync:true});
          it.questions=it.questions.filter(text=>text!==q.text);break;
        }
        case 'finishQuestions':{
          const round=it.interviews?.find(r=>r.id===input.interviewId);if(!round)fail('未找到本轮问题');
          if(round.submittedAt)fail('本轮问题已结束',409);
          if(round.questions.some(q=>q.status!=='skipped'))fail('有回答的题目请先整理到需求草稿');round.submittedAt=time;it.questions=[...new Set([...it.questions,...round.questions.map(q=>q.text)])];if(it.questions.length>MAX_PENDING_QUESTIONS)fail('待回答问题超过容量，请先整理现有问题');break;
        }
        case 'material':if(it.materials.length>=50)fail('资料数量已达上限');it.materials.push(material(input.material));break;
        case 'transcript':{const audio=it.materials.find(m=>m.id===input.materialId&&m.kind==='audio');if(!audio)fail('录音资料不存在');audio.text=string(input.text,'录音转写',100000);audio.transcriptStatus='unconfirmed';audio.updatedAt=time;break;}
        case 'confirmTranscript':{const audio=it.materials.find(m=>m.id===input.materialId&&m.kind==='audio');if(!audio)fail('录音资料不存在');audio.text=string(input.text,'录音文字',100000,true);audio.transcriptStatus='confirmed';audio.updatedAt=time;break;}
        case 'removeMaterial':if(!it.materials.some(m=>m.id===input.materialId))fail('资料不存在');it.materials=it.materials.filter(m=>m.id!==input.materialId);break;
        case 'conflictExplanation':{
          if(it.status!=='active')fail('请先开始或重新打开迭代',409);
          const conflict=it.conflicts?.find(c=>c.id===input.conflictId);if(!conflict)fail('未找到逻辑冲突');
          const explanation=string(input.explanation,'冲突解释',8000,true).trim();if(!explanation)fail('请填写你的解释');
          if(conflict.explanation===explanation&&conflict.needsDocumentSync)break;
          conflict.explanationHistory??=[];
          if(conflict.explanation)conflict.explanationHistory.push({explanation:conflict.explanation,createdAt:conflict.explainedAt});
          conflict.explanationHistory=conflict.explanationHistory.slice(-20);
          Object.assign(conflict,{explanation,explainedAt:time,needsDocumentSync:true,status:'pending'});break;
        }
        case 'reviewFeedback':{
          const review=it.documentReviews?.find(r=>r.id===input.reviewId);if(!review||review.status!=='pending')fail('修改预览已失效',409);
          review.feedback=string(input.feedback,'修改意见',8000,true).trim();if(!review.feedback)fail('请填写修改意见');break;
        }
        case 'rejectReview':{
          const review=it.documentReviews?.find(r=>r.id===input.reviewId);if(!review||review.status!=='pending')fail('修改预览已失效',409);
          review.status='rejected';review.rejectedAt=time;break;
        }
        case 'acceptReview':{
          const review=it.documentReviews?.find(r=>r.id===input.reviewId);if(!review||review.status!=='pending')fail('修改预览已失效',409);
          if(review.baseDocument!==it.document)fail('正文已变化，请填写意见重新生成预览，避免覆盖你的修改',409);
          const answers=[...(it.interviews||[]).flatMap(r=>r.questions),...(it.extraAnswers||[])];
          if(review.answerSnapshots.some(old=>answers.find(q=>q.id===old.id)?.answer!==old.answer))fail('回答已变化，请重新生成修改预览',409);
          if(review.context.resolvedConflictId&&it.conflicts?.find(c=>c.id===review.context.resolvedConflictId)?.explanation!==review.conflictExplanation)fail('冲突解释已变化，请重新生成修改预览',409);
          applyAIResult(it,{result:review.result,...review.context},time);if(review.context.suggestionId){const suggestion=it.suggestions.find(s=>s.id===review.context.suggestionId);if(suggestion){suggestion.status='applied';suggestion.documentAcceptedAt=time;}}review.status='accepted';review.acceptedAt=time;if(review.acceptedIterationHash&&review.analysisRevision===it.lastAnalysis?.revision)it.lastAnalysis.iterationHash=review.acceptedIterationHash;break;
        }
        case 'aiResult':{
          if(it.status!=='active')fail('请先开始迭代',409);
          const result=input.result;
          if(input.reviewBeforeApply&&typeof result?.document==='string'&&result.document!==it.document){
            it.documentReviews??=[];if(it.documentReviews.filter(r=>r.status==='pending').length>=30)fail('请先处理现有待确认修改');
            const context={syncedQuestionIds:clone(input.syncedQuestionIds||[]),interviewId:input.interviewId||null,resolvedConflictId:input.resolvedConflictId||null,suggestionId:input.reviewSuggestionId||null};
            const answers=[...(it.interviews||[]).flatMap(r=>r.questions),...(it.extraAnswers||[])];
            const review={id:randomUUID(),status:'pending',createdAt:time,baseDocument:it.document,document:result.document,summary:result.reply,result:clone(result),context,acceptedIterationHash:input.acceptedIterationHash,analysisRevision:input.snapshot?.revision,answerSnapshots:answers.filter(q=>context.syncedQuestionIds.includes(q.id)).map(q=>({id:q.id,answer:q.answer})),conflictExplanation:it.conflicts?.find(c=>c.id===context.resolvedConflictId)?.explanation||'',feedback:''};
            it.documentReviews.push(review);
            if(input.replacedReviewId){const old=it.documentReviews.find(r=>r.id===input.replacedReviewId);if(!old||old.status!=='pending')fail('原修改预览已失效',409);old.status='replaced';old.replacedBy=review.id;}
            if(input.message?.trim())it.messages.push({id:randomUUID(),role:'user',content:string(input.message,'消息',100000),createdAt:time});
            it.messages.push({id:randomUUID(),role:'assistant',content:'已生成待确认修改。正文尚未更新，请查看修改前后差异，再接受、拒绝或填写意见重改。',createdAt:time});it.messages=it.messages.slice(-100);
            if(input.snapshot)it.lastAnalysis=clone(input.snapshot);break;
          }
          if(input.replacedReviewId){const old=it.documentReviews?.find(r=>r.id===input.replacedReviewId);if(old?.status==='pending')old.status='replaced';}
          applyAIResult(it,input,time);break;
        }
        case 'suggestion':case 'previewSuggestion':case 'acceptDocument':{
          if(it.status!=='active')fail('请先开始迭代',409);
          const suggestion=it.suggestions.find(s=>s.id===input.suggestionId);if(!suggestion)fail('同步建议不存在');
          if(suggestion.status==='applied')fail('此建议已应用',409);
          if(['acceptDocument','previewSuggestion'].includes(input.action)){
            let document=suggestion.document;
            if(document!==undefined){if(suggestion.documentBase!==it.document)fail('文档已变化，请重新生成文档建议',409);}
            else{
              if(!suggestion.request?.trim())fail('此建议没有需求内容');
              const addition='\n\n### '+suggestion.title+'\n\n'+suggestion.request.trim()+'\n';
              const headings=[...it.document.matchAll(/^##\s+.+$/gm)],how=headings.find(h=>/\bHow\b(?!\s+much)/i.test(h[0]));
              const next=how?headings.find(h=>h.index>how.index):null,position=next?.index??it.document.length;
              document=how?it.document.slice(0,position).trimEnd()+addition+'\n'+it.document.slice(position):it.document.trimEnd()+'\n\n## 已确认补充需求'+addition;
            }
            if(input.action==='previewSuggestion'){
              it.documentReviews??=[];it.documentReviews.push({id:randomUUID(),status:'pending',createdAt:time,baseDocument:it.document,document,summary:suggestion.reason||suggestion.title,result:{reply:'已接受建议：'+suggestion.title,document},context:{suggestionId:suggestion.id,syncedQuestionIds:[]},answerSnapshots:[],feedback:''});break;
            }
            updateDocument(it,document,'accepted-suggestion');suggestion.documentAcceptedAt=time;suggestion.status='applied';
          }else{
            if(!['pending','deferred','applying','applied','failed'].includes(input.status))fail('建议状态无效');
            suggestion.status=input.status;if(input.error!==undefined)suggestion.error=string(input.error,'失败原因',5000);
          }
          suggestion.updatedAt=time;break;
        }
        default:fail('不支持的迭代操作');
      }
      it.updatedAt=time;
    }
    state.version++;
    const file=path(project);await mkdir(dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify(state));await rename(temp,file);return publicState(state);
  }
  function mutate(project,input){
    const file=path(project);const task=(queues.get(file)??Promise.resolve()).catch(()=>{}).then(()=>apply(project,input));
    queues.set(file,task);task.finally(()=>{if(queues.get(file)===task)queues.delete(file);}).catch(()=>{});return task;
  }
  return {read,readFull,mutate};
}
