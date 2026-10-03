// Intersect the complete pointer segment with a component's visible bounds.
// This catches fast crossings and text padding without repeated DOM hit tests.
export function segmentIntersectsRect(from,to,rect,padding=2) {
  let low=0,high=1;
  for(const [axis,start,end] of [['x','left','right'],['y','top','bottom']]) {
    const delta=to[axis]-from[axis],min=rect[start]-padding,max=rect[end]+padding;
    if(!delta){if(from[axis]<min || from[axis]>max)return false;continue;}
    const a=(min-from[axis])/delta,b=(max-from[axis])/delta;
    low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));
    if(low>high)return false;
  }
  return true;
}
