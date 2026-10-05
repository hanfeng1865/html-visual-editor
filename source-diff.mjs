// Myers diff keeps distant edits separate without allocating a whole-file matrix.
export function diffLines(before, after) {
  const a=before.split('\n'),b=after.split('\n');
  let frontier=new Map([[1,0]]),trace=[];
  for(let d=0;d<=Math.min(a.length+b.length,1000);d++) {
    trace.push(new Map(frontier));
    for(let k=-d;k<=d;k+=2) {
      let x=k===-d || (k!==d && (frontier.get(k-1)??-1)<(frontier.get(k+1)??-1)) ? frontier.get(k+1)??0 : (frontier.get(k-1)??0)+1;
      let y=x-k;
      while(x<a.length && y<b.length && a[x]===b[y]){x++;y++;}
      frontier.set(k,x);
      if(x>=a.length && y>=b.length) {
        const rows=[];
        for(let depth=d;depth>=0;depth--) {
          const v=trace[depth],diagonal=x-y;
          const previous=diagonal===-depth || (diagonal!==depth && (v.get(diagonal-1)??-1)<(v.get(diagonal+1)??-1))?diagonal+1:diagonal-1;
          const px=v.get(previous)??0,py=px-previous;
          while(x>px && y>py){rows.push({type:'same',text:a[--x]});y--;}
          if(depth>0){if(x===px)rows.push({type:'add',text:b[--y]});else rows.push({type:'remove',text:a[--x]});}
        }
        return numberRows(rows.reverse());
      }
    }
  }
  // Very large rewrites: retain common ends and show the rewritten section.
  let start=0,end=0;
  while(start<Math.min(a.length,b.length) && a[start]===b[start])start++;
  while(end<Math.min(a.length,b.length)-start && a[a.length-1-end]===b[b.length-1-end])end++;
  return numberRows([...a.slice(0,start).map(text=>({type:'same',text})),...a.slice(start,a.length-end).map(text=>({type:'remove',text})),...b.slice(start,b.length-end).map(text=>({type:'add',text})),...a.slice(a.length-end).map(text=>({type:'same',text}))]);
}
function numberRows(rows){let oldLine=0,newLine=0;return rows.map(row=>({...row,oldLine:row.type==='add'?null:++oldLine,newLine:row.type==='remove'?null:++newLine}));}
export function sourceDiffHunks(before,after,context=2) {
  const rows=diffLines(before,after),ranges=[];
  rows.forEach((row,index)=>{
    if(row.type==='same')return;
    const start=Math.max(0,index-context),end=Math.min(rows.length,index+context+1),last=ranges.at(-1);
    if(last && start<=last.end)last.end=end;else ranges.push({start,end});
  });
  return ranges.map(({start,end})=>rows.slice(start,end));
}
export function changedTextParts(text,other) {
  if(other==null)return {prefix:'',changed:text,suffix:''};
  let start=0,end=0;
  while(start<Math.min(text.length,other.length) && text[start]===other[start])start++;
  while(end<Math.min(text.length,other.length)-start && text[text.length-1-end]===other[other.length-1-end])end++;
  const prefix=text.slice(0,start),suffix=end?text.slice(-end):'';
  return {prefix:(prefix.length>80?'…':'')+prefix.slice(-80),changed:text.slice(start,text.length-end),suffix:suffix.slice(0,80)+(suffix.length>80?'…':'')};
}
export function renderSourceDiff(document,container,changes) {
  container.replaceChildren();
  for(const change of changes) {
    const details=document.createElement('details'),title=document.createElement('summary');
    title.textContent=change.path+' · 查看改动代码';details.append(title);
    const hunks=sourceDiffHunks(change.before,change.after);
    for(const [index,rows] of hunks.entries()) {
      const section=document.createElement('section');section.className='source-diff-hunk';
      if(hunks.length>1){const label=document.createElement('p');label.className='source-diff-location';label.textContent=`改动 ${index+1} / ${hunks.length}`;section.append(label);}
      for(const side of ['before','after']) {
        const label=document.createElement('p');label.className='source-diff-label';label.textContent=side==='before'?'修改前':'修改后';
        const pre=document.createElement('pre');
        const visible=rows.filter(row=>row.type!==(side==='before'?'add':'remove'));
        const removed=rows.filter(row=>row.type==='remove'),added=rows.filter(row=>row.type==='add');
        for(const row of visible) {
          const line=document.createElement('span');line.className='source-diff-line';
          const number=document.createElement('span');number.className='source-diff-number';number.textContent=String(side==='before'?row.oldLine:row.newLine);line.append(number);
          if(row.type==='same'){line.append(document.createTextNode(row.text.length>240?row.text.slice(0,240)+'…':row.text));}
          else {
            line.classList.add('source-diff-edited');
            const peers=row.type==='remove'?added:removed,own=row.type==='remove'?removed:added;
            const parts=changedTextParts(row.text,peers[own.indexOf(row)]?.text);
            line.append(document.createTextNode(parts.prefix));
            const mark=document.createElement('mark');mark.textContent=parts.changed || '（空）';line.append(mark,document.createTextNode(parts.suffix));
          }
          pre.append(line);
        }
        if(!visible.length){const empty=document.createElement('span');empty.className='source-diff-line';empty.textContent='（无代码）';pre.append(empty);}
        section.append(label,pre);
      }
      details.append(section);
    }
    if(!hunks.length){const note=document.createElement('p');note.textContent='没有代码变化';details.append(note);}
    container.append(details);
  }
}
