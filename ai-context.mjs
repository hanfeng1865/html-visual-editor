const invalid=message=>Object.assign(new Error(message),{statusCode:400});
export function validateAIContext({images=[],selection=null}) {
  if(!Array.isArray(images)||images.length>3)throw invalid('最多添加 3 张截图');
  const checked=images.map(image=>{
    if(!image || typeof image.name!=='string' || image.name.length>200 || typeof image.url!=='string' || image.url.length>1500000)throw invalid('截图格式无效或图片过大');
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.url);
    if(!match || match[2].length%4!==0)throw invalid('图片须为本地 PNG、JPEG 或 WebP 截图');
    const bytes=Buffer.from(match[2],'base64');
    const signature=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255 && bytes[1]===216 && bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    if(!signature || bytes.length>1024*1024)throw invalid('截图格式无效或超过 1MB，请缩小图片后重试');
    return {name:image.name,url:image.url};
  });
  if(selection!==null) {
    const rectOK=rect=>rect && ['x','y','width','height'].every(key=>Number.isFinite(rect[key])) && rect.width>=0 && rect.height>=0;
    if(!selection || !['elements','region'].includes(selection.kind) || !Array.isArray(selection.elements) || selection.elements.length>8
      || selection.kind==='region' && !rectOK(selection.rect)
      || selection.elements.some(el=>!el || typeof el.selector!=='string' || el.selector.length>2000 || typeof el.label!=='string' || el.label.length>300 || typeof el.html!=='string' || el.html.length>6000 || !rectOK(el.rect)))throw invalid('选区上下文无效或过大，请重新引用区域');
  }
  return {images:checked,selection};
}
