import {diffLines} from './source-diff.mjs';
const short=text=>text.replace(/\s+/g,' ').trim().slice(0,24);
const decode=text=>text.replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name]);
function htmlParts(source) {
  const markup=source.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi,'');
  const nodes=new Map();
  for(const match of markup.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const attrs=Object.fromEntries([...match[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],m[2]??m[3]]));
    const id=attrs.id||attrs['data-ve-node'];
    if(id)nodes.set(id,{style:attrs.style||'',tag:match[1],text:short(decode(/^([^<]*)/.exec(markup.slice(match.index+match[0].length))[1]))});
  }
  const texts=[...markup.matchAll(/>([^<>]+)</g)].map(m=>short(decode(m[1]))).filter(Boolean);
  return {nodes,texts};
}
function styleParts(value) {return Object.fromEntries(value.split(';').map(item=>{const index=item.indexOf(':');return [item.slice(0,index).trim(),item.slice(index+1).trim()];}).filter(([key])=>key));}
function styleSummary(names) {
  const results=[];
  if(names.some(name=>/^(gap|row-gap|column-gap|margin(?:-.*)?|padding(?:-.*)?)$/.test(name)))results.push('调整间距');
  if(names.some(name=>/^(position|inset(?:-.*)?|left|right|top|bottom|translate|transform)$/.test(name)))results.push('调整位置');
  if(names.some(name=>/^(width|height|min-width|max-width|min-height|max-height)$/.test(name)))results.push('调整尺寸');
  if(names.some(name=>/^(display|grid.*|flex.*|align.*|justify.*|order)$/.test(name)))results.push('调整排列布局');
  if(names.some(name=>/^(font.*|line-height|letter-spacing|text.*)$/.test(name)))results.push('调整文字样式');
  if(names.some(name=>/^(color|background.*|border.*|box-shadow|opacity)$/.test(name)))results.push('调整颜色或外观');
  return results.length?results:['调整样式'];
}
export function summarizeSourceChanges(before={},after={}) {
  const parts=new Set();
  for(const path of new Set([...Object.keys(before),...Object.keys(after)])) {
    const a=before[path]||'',b=after[path]||'';if(a===b)continue;
    if(/\.html?$/i.test(path)) {
      const old=htmlParts(a),next=htmlParts(b);
      const textChanges=diffLines(old.texts.join('\n'),next.texts.join('\n')).filter(row=>row.type!=='same' && row.text);
      const removed=textChanges.filter(row=>row.type==='remove'),added=textChanges.filter(row=>row.type==='add');
      let replacement=false;
      for(const [id,node] of next.nodes) {
        const previous=old.nodes.get(id);
        if(previous?.text && node.text && previous.text!==node.text){parts.add(`文字“${previous.text}”改为“${node.text}”`);replacement=true;}
      }
      if(!replacement) {
        if(!old.nodes.size && !next.nodes.size && removed.length===1 && added.length===1)parts.add(`文字“${removed[0].text}”改为“${added[0].text}”`);
        else {
          if(added.length)parts.add(`新增文字“${added[0].text}”`);
          if(removed.length)parts.add(`删除文字“${removed[0].text}”`);
        }
      }
      if([...next.nodes.keys()].some(id=>!old.nodes.has(id)))parts.add('新增组件');
      if([...old.nodes.keys()].some(id=>!next.nodes.has(id)))parts.add('删除组件');
      const changedStyles=new Set();
      for(const [id,node] of next.nodes) {
        const previous=old.nodes.get(id);if(!previous || previous.style===node.style)continue;
        const x=styleParts(previous.style),y=styleParts(node.style);
        for(const name of new Set([...Object.keys(x),...Object.keys(y)]))if(x[name]!==y[name])changedStyles.add(name);
      }
      if(changedStyles.size)styleSummary([...changedStyles]).forEach(part=>parts.add(part));
      if(!textChanges.length && !changedStyles.size && old.nodes.size===next.nodes.size)parts.add('更新页面结构或内容');
    }else if(/\.css$/i.test(path)) {
      const declarations=source=>{
        const values=new Map();
        for(const match of source.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g))values.set(match[1],[...(values.get(match[1])||[]),match[2].trim()]);
        return values;
      };
      const old=declarations(a),next=declarations(b);
      const names=[...new Set([...old.keys(),...next.keys()])].filter(name=>JSON.stringify(old.get(name))!==JSON.stringify(next.get(name)));
      styleSummary(names).forEach(part=>parts.add(part));
    }else if(/\.(js|mjs)$/i.test(path))parts.add('更新交互逻辑');
    else parts.add('更新项目文件');
  }
  return [...parts].slice(0,5).join('；')||'无源码改动';
}
export function summarizeDraft(patches={}) {
  const parts=new Set();
  for(const patch of Object.values(patches)) {
    if(patch.insert)parts.add('新增组件');if(patch.deleted)parts.add('删除组件');
    if(typeof patch.text==='string')parts.add(`修改文字为“${short(patch.text)}”`);
    if(patch.textNodes)parts.add('修改文字');
    if(patch.styles)styleSummary(Object.keys(patch.styles)).forEach(part=>parts.add(part));
    if(patch.position)parts.add('调整排列顺序');
    if(patch.attributes)parts.add('修改组件属性');
    if(patch.concealed!==undefined)parts.add(patch.concealed?'隐藏组件':'显示组件');
    if(patch.locked!==undefined)parts.add(patch.locked?'锁定组件':'解锁组件');
    if(patch.icon||patch.image)parts.add('更换图标或图片');
  }
  return [...parts].slice(0,3).join('；');
}
