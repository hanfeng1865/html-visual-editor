// Group for display while retaining exact source ranges for inline editing.
export function parseLogicNote(raw){
 raw=String(raw);
 const topics=[];let current=null,explicit=false,block=null;
 const range=(value,start)=>{const left=start+value.length-value.trimStart().length;return {start:left,end:Math.max(left,start+value.trimEnd().length)};};
 function cells(line,start){
  const values=[],ranges=[];let from=1;
  for(let i=1;i<line.length;i++){
   if(line[i]==='\\'){i++;continue;}
   if(line[i]!=='|')continue;
   const value=line.slice(from,i);values.push(value.trim().replace(/\\([\\|])/g,'$1'));
   ranges.push({...range(value,start+from),encoding:'table'});from=i+1;
  }
  return {values,ranges};
 }
 function topic(title){let found=topics.find(t=>t.title===title);if(!found){found={id:'topic-'+topics.length,title,groups:[]};topics.push(found);}return found;}
 function infer(text){
  if(/^(?:保养|剩余保养)/.test(text))return '保养提醒';
  if(/^(?:维保|登记维保|送修)/.test(text))return '维保台账';
  if(/^(?:当前里程|初始里程|累计里程|里程记录|记录日期|行驶里程)/.test(text))return '里程记录';
  if(/^(?:车牌号|车辆类别|点击.*(?:新增|添加)车辆)/.test(text))return '基本资料';
  return '';
 }
 const lines=[...raw.matchAll(/[^\r\n]+/g)];
 for(let lineIndex=0;lineIndex<lines.length;lineIndex++){
  const match=lines[lineIndex];
  const original=match[0];if(!original.trim())continue;
  const line=original.trim(),lineStart=range(original,match.index).start,heading=/^(?:【([^】]{1,30})】|#{1,3}\s+(.{1,30}))$/.exec(line);
  if(heading){explicit=true;current=topic(heading[1]||heading[2]);block=null;continue;}
  const groupHeading=/^#### (文字|列表|表格|提示)：(.*)$/.exec(line);
  if(groupHeading){
   current ||= topic('规则说明');
   block={kind:({'文字':'paragraph','列表':'list','表格':'rules','提示':'note'})[groupHeading[1]],title:groupHeading[2],items:[]};
   current.groups.push(block);continue;
  }
  if(block&&block.kind!=='rules'&&/^(?:-|>)(?: |$)/.test(line)){
   const start=lineStart+Math.min(2,line.length),value=line.slice(2);
   block.items.push({text:value,textRange:{start,end:start+value.length}});continue;
  }
  if(block?.kind==='rules'&&line.startsWith('|')&&line.endsWith('|')){
   const row=cells(line,lineStart);
   if(!block.columns){block.columns=row.values;block.columnRanges=row.ranges;block.separatorPending=true;}
   else if(block.separatorPending&&row.values.every(cell=>/^:?-{3,}:?$/.test(cell))){block.separatorPending=false;}
   else{
    block.separatorPending=false;
    while(row.values.length<block.columns.length){row.values.push('');row.ranges.push(null);}
    block.items.push({cells:row.values,cellRanges:row.ranges,label:row.values[0]||'',text:row.values[1]||''});
   }
   continue;
  }
  const pair=/^(?:\d+[.、)]\s*)?(概述|展示|操作|记录操作|校验|字段|规则|填写规则|保存|保存规则|更新|提示|备注|待确认)[：:]\s*([\s\S]*)$/.exec(line);
  const label=pair?.[1]||'',text=pair?.[2]||line;
  const textStart=lineStart+(pair?pair[0].length-pair[2].length:0);
  const inferred=!explicit?infer(text):'';
  if(inferred)current=topic(inferred);
  current ||= topic('规则说明');
  if(label==='概述'){current.summary=text;current.summaryRange=range(text,textStart);continue;}
  let kind=['校验','字段','填写规则'].includes(label)?'rules':['提示','备注','待确认'].includes(label)?'note':'list';
  const title=kind==='rules'?'填写规则':label==='待确认'?'待确认':['保存','保存规则'].includes(label)?'保存规则':label==='更新'?'更新规则':label==='展示'?'展示说明':kind==='note'?'补充说明':label==='规则'?'业务规则':'操作说明';
  let group=current.groups.find(g=>g.title===title);if(!group){group={kind,title,items:[]};current.groups.push(group);}
  // Split only explicit field/condition separators; clauses without a field stay complete.
  for(const part of text.matchAll(/[^；;]+/g)){
   const clause=part[0].trim();if(!clause)continue;
   const clauseRange=range(part[0],textStart+part.index);
   const field=kind==='rules'?/^([^｜|]{1,30})[｜|]([\s\S]+)$/.exec(clause):null;
   const subject=!field&&kind==='rules'?/^(.{1,18}?)(必填|须|应|不得|为|允许|可为空|选填)([\s\S]*)$/.exec(clause):null;
   const prefix=field?field[1].length+1:subject?subject[1].length:0;
   group.items.push({label:field?.[1].trim()||subject?.[1].trim()||'',text:field?.[2].trim()||(subject?subject[2]+subject[3]:clause),
    textRange:range(clause.slice(prefix),clauseRange.start+prefix),
    ...(field||subject?{labelRange:range((field||subject)[1],clauseRange.start)}:{})});
  }
 }
 if(!topics.length)topic('规则说明');
 return {raw,topics};
}

// A readable interchange format for visual blocks, including arbitrary table columns.
export function serializeLogicNote(model){
 const clean=value=>String(value??'').replace(/[\r\n]+/g,' ');
 const cell=value=>clean(value).replace(/\\/g,'\\\\').replace(/\|/g,'\\|');
 const row=values=>'| '+values.map(cell).join(' | ')+' |';
 return model.topics.map(topic=>{
  const lines=['## '+clean(topic.title).trim()];
  if(topic.summary)lines.push('概述：'+clean(topic.summary));
  for(const group of topic.groups){
   const type=({paragraph:'文字',list:'列表',rules:'表格',note:'提示'})[group.kind]||'列表';
   lines.push('#### '+type+'：'+clean(group.title));
   if(group.kind==='rules'){
    const columns=group.columns||['字段','规则'];lines.push(row(columns),row(columns.map(()=>'---')));
    for(const [i,item] of group.items.entries())lines.push(row(item.cells||[item.label||'规则 '+(i+1),item.text]));
   }else for(const item of group.items)lines.push((group.kind==='paragraph'?'> ':'- ')+clean(item.text));
  }
  return lines.join('\n');
 }).join('\n\n');
}

// Apply replacements against the original text; never serialize the display groups.
export function applyLogicNoteEdits(raw,edits){
 let result='',offset=0;
 for(const edit of [...edits].sort((a,b)=>a.start-b.start)){
  if(edit.start<offset||edit.end<edit.start||edit.end>raw.length)throw new Error('说明编辑范围无效');
  result+=raw.slice(offset,edit.start)+edit.text;offset=edit.end;
 }
 return result+raw.slice(offset);
}
