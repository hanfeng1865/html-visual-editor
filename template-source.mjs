import {staticTemplateSegments,encodeTemplateText} from './template-text.mjs';
const normalize=text=>text.trim().replace(/\s+/g,' ');
const classes=node=>[...node.classList].filter(name=>!name.startsWith('ve-') && !['active','open','selected'].includes(name));
const matchesShape=(a,b)=>a?.tagName===b.tagName && a.id===b.id && classes(b).every(name=>a.classList.contains(name));
const indexes=new WeakMap();
function scriptSources(doc,files,entry){
  return [...doc.querySelectorAll('script')].flatMap((script,scriptIndex)=>{
    if(script.type && !['module','text/javascript','application/javascript'].includes(script.type))return [];
    if(!script.hasAttribute('src'))return [{file:entry,scriptIndex,source:script.textContent}];
    try{
      const url=new URL(script.getAttribute('src'),new URL(entry,'https://editor.local/'));
      const file=decodeURIComponent(url.pathname.slice(1));
      return url.origin==='https://editor.local' && typeof files[file]==='string'?[{file,scriptIndex:null,source:files[file]}]:[];
    }catch{return [];}
  });
}
function sourceIndex(doc,files,entry){
  const cached=indexes.get(doc);if(cached?.files===files && cached.entry===entry)return cached.items;
  const items=[],seen=new Set();
  for(const source of scriptSources(doc,files,entry)){
    const key=source.file+':'+source.scriptIndex;if(seen.has(key))continue;seen.add(key);
    for(const segment of staticTemplateSegments(source.source)){
      // Escaped or interpolated attributes cannot be rewritten as plain HTML.
      if(!segment.text.includes('<') || segment.text.includes('\\') || segment.text.length>200000 || source.source.split(segment.text).length!==2)continue;
      const openings=[];
      const annotated=segment.text.replace(/<[a-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi,(opening,offset)=>{
        const index=openings.push({opening,offset})-1;
        return opening.replace(/\s*\/?>$/,end=>` data-ve-source-token="${index}"${end}`);
      });
      const fragment=new DOMParser().parseFromString(annotated,'text/html');
      items.push({...source,segment,openings,fragment});
    }
  }
  indexes.set(doc,{files,entry,items});return items;
}
export function findTemplateSource(doc,live,files={},entry='index.html',existing=null){
  const sources=scriptSources(doc,files,entry);
  if(existing){
    const source=sources.find(item=>item.file===existing.file && item.scriptIndex===existing.scriptIndex);
    return source && source.source.split(existing.segment).length===2
      && staticTemplateSegments(source.source).some(segment=>segment.text===existing.segment && segment.quote===existing.quote)
      && existing.segment.slice(existing.offset,existing.offset+existing.opening.length)===existing.opening?existing:null;
  }
  if(!live)return null;
  const candidates=[];
  for(let container=live,depth=0;container && depth<(live.childElementCount?1:2);container=container.parentElement,depth++){
    const labels=[container,...container.querySelectorAll('span,small,label,p,h1,h2,h3,h4,strong,b')].filter(node=>!node.childElementCount && /\p{L}/u.test(node.textContent) && !/\d/.test(node.textContent) && normalize(node.textContent).length<=120 && !node.matches('script,style,textarea,option'));
    for(const label of labels){
      const text=normalize(label.textContent);if(!text)continue;
      if([...live.ownerDocument.querySelectorAll(label.tagName)].filter(node=>!node.childElementCount && normalize(node.textContent)===text).length!==1)continue;
      let up=0;for(let node=label;node!==container;node=node.parentElement)up++;
      const path=[];for(let node=live;node!==container;node=node.parentElement)path.unshift([...node.parentElement.children].indexOf(node));
      for(const item of sourceIndex(doc,files,entry))for(const leaf of item.fragment.querySelectorAll(label.tagName)){
        if(leaf.childElementCount || normalize(leaf.textContent)!==text)continue;
        let target=leaf;for(let i=0;i<up;i++)target=target?.parentElement;
        if(!matchesShape(target,container))continue;
        for(const index of path)target=target?.children[index];
        if(!matchesShape(target,live) || !target.hasAttribute('data-ve-source-token'))continue;
        let sourceParent=target.parentElement,liveParent=live.parentElement,compatible=true;
        while(sourceParent && !sourceParent.matches('body,html')){
          if(!liveParent || !matchesShape(sourceParent,liveParent)){compatible=false;break;}
          sourceParent=sourceParent.parentElement;liveParent=liveParent.parentElement;
        }
        if(!compatible)continue;
        const token=item.openings[Number(target.getAttribute('data-ve-source-token'))];
        const binding={file:item.file,scriptIndex:item.scriptIndex,segment:item.segment.text,offset:token.offset,opening:token.opening,quote:item.segment.quote};
        if(!candidates.some(value=>JSON.stringify(value)===JSON.stringify(binding)))candidates.push(binding);
      }
    }
    if(candidates.length)break;
  }
  return candidates.length===1?candidates[0]:null;
}
export function compileTemplateStyles(doc,files,entry,patches){
  const groups=new Map();
  for(const patch of patches){
    const binding=findTemplateSource(doc,null,files,entry,patch.templateSource);
    if(!binding)return {error:'生成模板已变化或无法唯一定位，请刷新代码后重新编辑'};
    const key=JSON.stringify([binding.file,binding.scriptIndex]);
    if(!groups.has(key))groups.set(key,{...binding,edits:new Map()});
    const group=groups.get(key),script=binding.scriptIndex===null?files[binding.file]:doc.querySelectorAll('script')[binding.scriptIndex].textContent;
    const start=script.indexOf(binding.segment)+binding.offset;
    let element=group.edits.get(start)?.element;
    if(!element){
      element=new DOMParser().parseFromString(binding.opening,'text/html').body.firstElementChild;
      if(!element)return {error:'模板元素不支持直接写入'};
      group.edits.set(start,{element,opening:binding.opening});
    }
    for(const [name,value] of Object.entries(patch.styles||{}))element.style[name]=value;
  }
  const changedFiles={};
  for(const group of groups.values()){
    let source=group.scriptIndex===null?files[group.file]:doc.querySelectorAll('script')[group.scriptIndex].textContent;
    for(const [start,{element,opening}] of [...group.edits].sort(([a],[b])=>b-a)){
      const style=`style="${encodeTemplateText(element.getAttribute('style')||'')}"`;
      const next=/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/i.test(opening)?opening.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/i,' '+style):opening.replace(/\s*\/?>$/,end=>' '+style+end);
      source=source.slice(0,start)+next+source.slice(start+opening.length);
    }
    if(group.scriptIndex===null)changedFiles[group.file]=source;
    else doc.querySelectorAll('script')[group.scriptIndex].textContent=source;
  }
  return {files:changedFiles};
}
