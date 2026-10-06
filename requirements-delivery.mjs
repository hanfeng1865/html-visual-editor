// Structural clues help locate gaps; they do not certify business correctness.
const dimensions=[['数据来源',/来源|数据对象|取数/],['字段与关联',/字段|关联键|唯一标识/],['处理逻辑',/公式|计算|处理|流程|操作路径/],['异常与边界',/异常|缺失|失败|边界|校验|无记录|分母为0/],['验收场景',/验收|期望结果/]];
export function deliveryChecklist(it){
  const text=it.document||'',headings=[...text.matchAll(/^##\s+(.+)$/gm)];
  const chapterNames=['Why','What','Who','When','Where','How','How much'];
  const missingChapters=chapterNames.filter(name=>!headings.some(h=>new RegExp('^(?:\\d+[.、]\\s*)?'+name.replace(' ','\\s+')+'(?:\\s*[｜|]|$)','i').test(h[1])));
  const how=headings.find(h=>/^(?:6[.、]\s*)?How\s*[｜|]/i.test(h[1])),next=how?headings.find(h=>h.index>how.index):null;
  const body=how?text.slice(how.index,next?.index??text.length):'';
  const parts=[...body.matchAll(/^(#{3,4})\s+(.+)$/gm)];
  const features=parts.flatMap((h,i)=>{
    if(!/^6\.\d+(?:\.\d+)?(?:\s|[.、])/.test(h[2]))return [];
    if(parts[i+1]?.[1].length>h[1].length)return [];
    const content=body.slice(h.index,parts[i+1]?.index??body.length);
    return [{title:h[2],missing:dimensions.filter(([,pattern])=>!pattern.test(content)).map(([name])=>name),unsettled:/待回答|待确认|待定|尚未定案|未经.*确认/.test(content)}];
  });
  const answers=[...(it.interviews||[]).flatMap(r=>r.questions||[]),...(it.extraAnswers||[])];
  return {missingChapters,features,questions:it.questions||[],conflicts:(it.conflicts||[]).filter(c=>c.status!=='resolved'),unsynced:answers.filter(q=>q.status==='answered'&&q.needsDocumentSync),reviews:(it.documentReviews||[]).filter(r=>r.status==='pending'),hasUnsettledText:/待回答|待确认|待定|尚未定案/.test(text),hasDocument:!!text.trim()};
}
export function deliveryCopy(it){
  const c=deliveryChecklist(it),question=q=>typeof q==='string'?q:q.text||q.question||q.title||'';
  const list=items=>items.length?items.map(v=>'- '+v).join('\n'):'- 无已记录事项';
  return (it.document||'（正文为空）')+'\n\n---\n\n## 开发交接附录｜未定案事项\n\n'
    +'迭代：'+it.name+'。本稿仅包含当前已保存正文，不包含尚未接受的 AI 修改。以下为当前工作区记录，不表示需求已经全部澄清。\n\n'
    +'### 待回答问题\n'+list(c.questions.map(question))+'\n\n'
    +'### 尚未解决的逻辑冲突\n'+list(c.conflicts.map(v=>v.title+'：'+v.statements.map(s=>s.source+' — '+s.text).join('；')+(v.explanation?'；用户解释（尚未写入正文）：'+v.explanation:'')))+'\n\n'
    +'### 已回答但尚未写入正文\n'+list(c.unsynced.map(q=>q.text+'：'+q.answer))+'\n\n'
    +'### 待确认修改\n'+(c.reviews.length?'- '+c.reviews.length+' 份候选修改尚未接受，开发不得据此实施。':'- 无待确认修改')+'\n\n'
    +'### 交付前仍需核对\n'+list([...c.missingChapters.map(v=>'缺少 '+v+' 章节'),...c.features.filter(v=>v.missing.length||v.unsettled).map(v=>v.title+'：'+[v.missing.length?'缺少说明线索（'+v.missing.join('、')+'）':'',v.unsettled?'仍有未定案规则':''].filter(Boolean).join('；')), ...(!c.features.length?['尚未识别到逐功能 How 小节，请核对功能覆盖。']:[])])+'\n';
}
