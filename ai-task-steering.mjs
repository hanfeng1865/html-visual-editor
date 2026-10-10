// Keep earlier goals while applying each later instruction with precedence.
export function mergeAITasks(current,additional) {
  const request=[current.request,'后续调整（保留原目标，补充以下要求；与原要求冲突时以此为准）：',additional.request].filter(Boolean).join('\n\n');
  if(request.length>12000)throw new Error('合并后的修改要求超过 12000 字，请缩短补充内容。');
  const images=[...new Map([...current.attachments.images,...additional.attachments.images].map(image=>[image.url,image])).values()];
  if(images.length>3)throw new Error('原任务与补充内容合计最多 3 张截图，请移除多余截图。');
  const selections=[current.attachments.selection,additional.attachments.selection].filter(Boolean);
  let selection=null;
  if(selections.length===1)selection=selections[0];
  else if(selections.length){
    const elements=[...new Map(selections.flatMap(item=>item.elements).map(element=>[element.selector,element])).values()];
    if(elements.length>8)throw new Error('原任务与补充内容合计最多引用 8 个元素，请缩小引用范围。');
    const regions=selections.filter(item=>item.kind==='region');
    selection={kind:regions.length?'region':'elements',elements};
    if(regions.length){
      const rects=[...regions.map(item=>item.rect),...elements.map(item=>item.rect)];
      const x=Math.min(...rects.map(rect=>rect.x)),y=Math.min(...rects.map(rect=>rect.y));
      selection.rect={x,y,width:Math.max(...rects.map(rect=>rect.x+rect.width))-x,height:Math.max(...rects.map(rect=>rect.y+rect.height))-y};
    }
  }
  return {request,attachments:structuredClone({images,selection})};
}
