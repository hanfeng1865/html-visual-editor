// Runs in the isolated rendering page; coordinates are measured after styling.
export function inspectDiagramLayout(){
 const issues=[];
 const contains=(outer,inner)=>outer.left<=inner.left+1&&outer.top<=inner.top+1&&outer.right>=inner.right-1&&outer.bottom>=inner.bottom-1;
 for(const [index,svg]of [...document.querySelectorAll('[data-editor-component="diagram"] svg')].entries()){
  const scale=Math.hypot(svg.getScreenCTM().a,svg.getScreenCTM().b),inset=3*scale;
  const shapes=[...svg.querySelectorAll('rect,ellipse,polygon')].filter(node=>!node.closest('defs,marker,clipPath')).map(node=>({node,box:node.getBoundingClientRect()})).filter(({box})=>box.width>60*scale&&box.height>32*scale).slice(0,200);
  const nodes=shapes.filter(item=>!shapes.some(other=>other!==item&&contains(item.box,other.box)));
  const add=text=>{if(issues.length<12)issues.push(`第 ${index+1} 张图：${text}`);};
  for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++){
   const x=nodes[a].box,y=nodes[b].box,overlapX=Math.min(x.right,y.right)-Math.max(x.left,y.left),overlapY=Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top);
   if(overlapX>2*scale&&overlapY>2*scale){add(`卡片 ${a+1} 与 ${b+1} 重叠，请分开摆放。`);continue;}
   const verticalGap=Math.max(x.top,y.top)-Math.min(x.bottom,y.bottom),horizontalGap=Math.max(x.left,y.left)-Math.min(x.right,y.right);
   if((overlapX>Math.min(x.width,y.width)*.5&&verticalGap>=-2*scale&&verticalGap<24*scale)||(overlapY>Math.min(x.height,y.height)*.5&&horizontalGap>=-2*scale&&horizontalGap<24*scale))add(`卡片 ${a+1} 与 ${b+1} 间距不足，请至少留出 24 个画布单位。`);
  }
  const inside=(point,box)=>point.x>box.left+inset&&point.x<box.right-inset&&point.y>box.top+inset&&point.y<box.bottom-inset;
  for(const edge of [...svg.querySelectorAll('path,line,polyline')].filter(node=>!node.closest('defs,marker,clipPath')).slice(0,200)){
   const style=getComputedStyle(edge);if(style.stroke==='none'||(edge.localName==='path'&&style.fill!=='none'&&style.markerEnd==='none'&&style.markerStart==='none'))continue;
   const matrix=edge.getScreenCTM(),length=edge.getTotalLength();if(!length)continue;
   const pointAt=distance=>{const p=edge.getPointAtLength(distance);return new DOMPoint(p.x,p.y).matrixTransform(matrix);};
   const start=pointAt(0),end=pointAt(length),bounds=edge.getBoundingClientRect();
   for(const [i,{box}]of nodes.entries()){
    // Endpoints may touch their own cards; icons entirely inside a card are not connectors.
    if(contains(box,bounds)||inside(start,box)||inside(end,box))continue;
    const steps=Math.min(1500,Math.max(2,Math.ceil(length/4)));
    for(let step=1;step<steps;step++)if(inside(pointAt(length*step/steps),box)){add(`连线穿过卡片 ${i+1}，请沿卡片外侧绕行。`);break;}
   }
  }
 }
 return [...new Set(issues)];
}
