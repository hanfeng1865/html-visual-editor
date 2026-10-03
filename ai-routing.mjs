// Partition by operation, so a generated text edit does not hold up a normal style edit.
export function splitEditRoutes(patches, check=()=>null, dependsOnPending=()=>false) {
  const direct={},pending={};
  for(const [key,patch] of Object.entries(patches)) {
    const saved={selector:patch.selector},queued={selector:patch.selector};const reasons={};
    for(const [field,value] of Object.entries(patch)) {
      if(['selector','ai','templateText'].includes(field) || field==='styles' && !Object.keys(value).length)continue;
      const reason=patch.ai?.fields?.[field] || check({selector:patch.selector,[field]:value});
      (reason?queued:saved)[field]=structuredClone(value);if(reason)reasons[field]=reason;
    }
    if(Object.keys(saved).length>1){if(patch.templateText && 'text' in saved)saved.templateText=structuredClone(patch.templateText);direct[key]=saved;}
    if(Object.keys(queued).length>1)pending[key]={...queued,ai:{fields:reasons,context:patch.ai?.context || {}}};
  }
  let changed=true;
  while(changed) {
    changed=false;
    for(const [key,patch] of Object.entries(direct)) {
      const queued=pending[key] || {selector:patch.selector,ai:{fields:{},context:patches[key].ai?.context || {}}};
      for(const field of Object.keys(patch).filter(name=>!['selector','templateText'].includes(name))) {
        if(!dependsOnPending(patch.selector,pending) && !dependsOnPending(patch[field]?.parent,pending))continue;
        queued[field]=patch[field];queued.ai.fields[field]='依赖另一个待 AI 写入的组件';delete patch[field];changed=true;
      }
      if(Object.keys(queued).length>2)pending[key]=queued;
      if(!('text' in patch))delete patch.templateText;
      if(Object.keys(patch).length===1)delete direct[key];
    }
  }
  return {direct,pending};
}
