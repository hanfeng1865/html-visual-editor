// Rectangles are measured in the same canvas coordinate system. Distribution
// preserves the outside edges and equalizes empty space, including unequal sizes.
export function selectionLayoutOffsets(rects, action) {
  const offsets=rects.map(()=>({x:0,y:0}));
  const distribution=action==='distribute-x'||action==='distribute-y';
  if(rects.length<(distribution?3:2))return offsets;
  const horizontal=['left','center-x','right','distribute-x'].includes(action);
  if(!['left','center-x','right','top','center-y','bottom','distribute-x','distribute-y'].includes(action))return offsets;
  const [start,end,axis]=horizontal?['left','right','x']:['top','bottom','y'];
  const low=Math.min(...rects.map(r=>r[start])),high=Math.max(...rects.map(r=>r[end]));
  if(distribution) {
    const order=rects.map((rect,index)=>({rect,index})).sort((a,b)=>a.rect[start]-b.rect[start] || a.rect[end]-b.rect[end]);
    const first=order[0].rect,last=order.at(-1).rect;
    const total=rects.reduce((sum,r)=>sum+r[end]-r[start],0);
    const gap=(last[end]-first[start]-total)/(rects.length-1);
    let position=first[end]+gap;
    for(const {rect,index} of order.slice(1,-1)) {
      offsets[index][axis]=position-rect[start];position+=rect[end]-rect[start]+gap;
    }
  } else {
    const center=action==='center-x'||action==='center-y';
    const trailing=action==='right'||action==='bottom';
    rects.forEach((rect,index)=>{
      offsets[index][axis]=center?(low+high-rect[start]-rect[end])/2:trailing?high-rect[end]:low-rect[start];
    });
  }
  return offsets;
}
