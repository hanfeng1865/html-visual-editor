// Coordinates are iframe CSS pixels. The caller converts a small screen-pixel
// threshold to CSS pixels so snapping feels the same at every canvas zoom.
export function unionRects(rects) {
  return {left:Math.min(...rects.map(r=>r.left)),right:Math.max(...rects.map(r=>r.right)),top:Math.min(...rects.map(r=>r.top)),bottom:Math.max(...rects.map(r=>r.bottom))};
}
export function alignmentSnap(rect, candidates, tolerance) {
  const result={x:null,y:null};
  for(const axis of ['x','y']) {
    const [start,end]=axis==='x'?['left','right']:['top','bottom'];
    const anchors=r=>[r[start],(r[start]+r[end])/2,r[end]];
    const moving=anchors(rect);
    for(const target of candidates) {
      const distance=Math.hypot((target.left+target.right-rect.left-rect.right)/2,(target.top+target.bottom-rect.top-rect.bottom)/2);
      anchors(target).forEach((value,index)=>{
        const delta=value-moving[index];
        if(Math.abs(delta)>tolerance)return;
        const score=Math.abs(delta)+distance*.0001;
        if(!result[axis] || score<result[axis].score)result[axis]={delta,value,index,target,score};
      });
    }
  }
  return result;
}

// Report every aligned anchor after snapping, so equal-sized elements can show
// both edges at once. Deduplicate shared coordinates across nearby references.
export function alignmentMatches(rect, candidates, tolerance) {
  const matches=[];
  for(const axis of ['x','y']) {
    const [start,end]=axis==='x'?['left','right']:['top','bottom'];
    const anchors=r=>[r[start],(r[start]+r[end])/2,r[end]];
    anchors(rect).forEach((value,index)=>{
      if(candidates.some(target=>anchors(target).some(anchor=>Math.abs(anchor-value)<=tolerance)))
        matches.push({axis,value,index});
    });
  }
  // An edge already communicates alignment; omit a redundant center line.
  return matches.filter(match=>match.index!==1 || !matches.some(other=>other.axis===match.axis && other.index!==1));
}
