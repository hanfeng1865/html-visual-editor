export function installGenerationSkillsUI({notify=()=>{}}={}){
 const dialog=document.getElementById('generation-skills-dialog'),open=document.getElementById('generation-skills-button');
 const list=document.getElementById('generation-skills-list'),editor=document.getElementById('generation-skill-content'),status=document.getElementById('generation-skill-status');
 const save=document.getElementById('generation-skill-save'),reset=document.getElementById('generation-skill-reset'),history=document.getElementById('generation-skill-history');
 const drafts=new Map();let skills=[],selected='requirements',busy=false;
 const body=content=>content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim();
 const current=()=>skills.find(skill=>skill.id===selected);
 const draft=()=>drafts.get(selected)??body(current()?.content||'');
 const dirty=()=>current()&&draft()!==body(current().content);
 const message=text=>{status.textContent=text;};
 function setBusy(value){busy=value;editor.disabled=value;reset.disabled=value;history.disabled=value;save.disabled=value||!dirty();for(const button of list.querySelectorAll('button'))button.disabled=value;}
 function render(){
  list.replaceChildren();for(const skill of skills){const button=document.createElement('button');button.type='button';button.className='generation-skill-choice'+(selected===skill.id?' selected':'');button.setAttribute('aria-pressed',String(selected===skill.id));const title=document.createElement('strong'),usage=document.createElement('span');title.textContent=skill.name;usage.textContent=skill.usage;button.append(title,usage);button.onclick=()=>{selected=skill.id;render();message(dirty()?'有未保存的规范修改。':'保存后将在下次生成时自动应用。');};list.append(button);}
  const skill=current();if(!skill)return;
  document.getElementById('generation-skill-title').textContent=skill.name+' Skill';
  document.getElementById('generation-skill-meta').textContent=(skill.source==='default'?'默认规范':'自定义规范')+' · 版本 '+skill.revision.slice(0,8)+(skill.updatedAt?' · '+new Date(skill.updatedAt).toLocaleString():'');
  editor.value=draft();history.replaceChildren(new Option('查看历史版本（加载为草稿）',''));
  skill.history.forEach((entry,index)=>history.add(new Option('版本 '+entry.revision.slice(0,8)+(entry.updatedAt?' · '+new Date(entry.updatedAt).toLocaleString():' · 默认规范'),String(index))));
  setBusy(busy);
 }
 editor.oninput=()=>{drafts.set(selected,editor.value);save.disabled=busy||!dirty();message(dirty()?'未保存：当前生成仍使用已保存的规范。':'当前内容与已保存版本一致。');};
 reset.onclick=()=>{drafts.set(selected,body(current().defaultContent));render();message('已载入默认规范草稿；点击“保存并应用”后生效。');};
 history.onchange=()=>{if(history.value==='')return;drafts.set(selected,body(current().history[Number(history.value)].content));render();message('已载入历史版本草稿；点击“保存并应用”后生效。');};
 save.onclick=async()=>{
  if(busy||!dirty())return;const skill=current(),text=editor.value;setBusy(true);message('正在保存规范…');
  try{const header=skill.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)[0];const response=await fetch('/api/generation-skills',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:skill.id,revision:skill.revision,content:header+'\n'+text.trim()+'\n'})});const value=await response.json();if(!response.ok)throw new Error(value.error||'保存失败');skills=skills.map(item=>item.id===value.id?value:item);drafts.delete(value.id);render();message('已保存；下次生成自动使用此版本，已有文档和标注由你重新生成后审核。');notify('生成 Skill 已保存，下次生成自动应用');}
  catch(error){message(error.message);}
  finally{setBusy(false);}
 };
 open.onclick=async()=>{if(!dialog.open)dialog.showModal();setBusy(true);message('正在读取生成规范…');try{const response=await fetch('/api/generation-skills'),value=await response.json();if(!response.ok)throw new Error(value.error||'读取失败');skills=value.skills;render();message(dirty()?'有未保存的规范修改。':'保存后将在下次生成时自动应用。');}catch(error){message(error.message);}finally{setBusy(false);}};
 document.getElementById('generation-skills-close').onclick=()=>dialog.close();
}
