// Locate static HTML text inside JavaScript literals, excluding comments,
// regular expressions and template interpolation code.
export function staticTemplateLeaves(source) {
  const segments=[];let i=0;
  function string(quote) {
    i++;let start=i;
    while(i<source.length){
      if(source[i]==='\\'){i+=2;continue;}
      if(source[i]===quote){segments.push(source.slice(start,i));i++;return;}
      if(quote==='\x60' && source[i]==='$' && source[i+1]==='{'){segments.push(source.slice(start,i));i+=2;code(true);start=i;continue;}
      i++;
    }
  }
  function code(stop=false){
    let depth=0;
    while(i<source.length){
      const c=source[i];
      if(c==='"'||c==="'"||c==='\x60'){string(c);continue;}
      if(c==='/' && source[i+1]==='/'){i+=2;while(i<source.length && source[i]!=='\n')i++;continue;}
      if(c==='/' && source[i+1]==='*'){i+=2;while(i<source.length && !(source[i]==='*'&&source[i+1]==='/'))i++;i+=2;continue;}
      if(c==='/'){i++;let bracket=false;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i]==='[')bracket=true;if(source[i]===']')bracket=false;if(source[i]==='/'&&!bracket){i++;break;}if(source[i]==='\n')break;i++;}continue;}
      if(c==='{')depth++;
      if(c==='}'){if(stop && !depth){i++;return;}depth--;}
      i++;
    }
  }
  code();
  const leaves=[];
  for(const segment of segments)for(const match of segment.matchAll(/<([a-z][a-z0-9-]*)\b[^<>]*>([^<>]+)<\/\1\s*>/gi)){
    if(match[2].includes('\\') || ['script','style','textarea','title'].includes(match[1].toLowerCase()))continue;
    leaves.push({tag:match[1].toLowerCase(),needle:match[0],rawText:match[2]});
  }
  return leaves;
}
export function encodeTemplateText(text){
  return String(text).replace(/[&<>"'\\\x60$\r\n]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','\\':'&#92;','\x60':'&#96;','$':'&#36;','\r':'&#13;','\n':'&#10;'}[c]));
}
const templateIndexes=new WeakMap();
function templateIndex(doc){
  if(templateIndexes.has(doc))return templateIndexes.get(doc);
  const all=[],byLabel=new Map(),scripts=[...doc.querySelectorAll('script')];
  scripts.forEach((script,scriptIndex)=>{
    if(script.hasAttribute('src') || script.type && !['module','text/javascript','application/javascript'].includes(script.type))return;
    for(const leaf of staticTemplateLeaves(script.textContent)){
      const probe=doc.createElement('template');probe.innerHTML=leaf.needle;
      if(!probe.content.firstElementChild || probe.content.firstElementChild.childElementCount)continue;
      const entry={...leaf,scriptIndex},key=leaf.tag+'\0'+probe.content.firstElementChild.textContent;
      all.push(entry);if(!byLabel.has(key))byLabel.set(key,[]);byLabel.get(key).push(entry);
    }
  });
  const index={all,byLabel};templateIndexes.set(doc,index);return index;
}
export function findTemplateText(doc,element,binding=null) {
  if(!binding && (!element || element.childElementCount))return null;
  const index=templateIndex(doc),candidates=binding?index.all.filter(leaf=>leaf.scriptIndex===binding.scriptIndex && leaf.needle===binding.needle):index.byLabel.get(element.tagName.toLowerCase()+'\0'+element.textContent)||[];
  if(candidates.length!==1)return null;
  const match=candidates[0],script=doc.querySelectorAll('script')[match.scriptIndex].textContent;
  if(script.split(match.needle).length!==2)return null;
  if(element && !binding){
    const copies=[...element.ownerDocument.querySelectorAll(match.tag)].filter(node=>!node.childElementCount && node.textContent===element.textContent);
    if(copies.length!==1)return null;
  }
  return match;
}
export function applyTemplateText(doc,binding,text){
  const found=findTemplateText(doc,null,binding);if(!found)return false;
  const script=doc.querySelectorAll('script')[found.scriptIndex],needle=found.needle,start=needle.indexOf('>')+1,end=needle.lastIndexOf('</');
  script.textContent=script.textContent.replace(needle,needle.slice(0,start)+encodeTemplateText(text)+needle.slice(end));return true;
}
