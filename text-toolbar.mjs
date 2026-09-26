const TEXT_TAGS = /^(H[1-6]|P|SPAN|STRONG|B|EM|I|SMALL|LABEL|BUTTON|A|TD|TH|LI|BLOCKQUOTE)$/;
export function isTextToolbarTarget(element) {
  if (!element || element.childElementCount || /^(IMG|SVG|INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) return false;
  return Boolean(element.textContent?.trim() || TEXT_TAGS.test(element.tagName));
}

const clearStyles = {fontSize:'',fontWeight:'',fontStyle:'',textDecorationLine:'',fontFamily:'',color:'',textAlign:'',backgroundColor:''};
export function textToolbarStyles(action, style, value) {
  const size = Math.round(parseFloat(style.fontSize)) || 16;
  const lines = new Set((style.textDecorationLine || '').split(/\s+/).filter(line => line !== 'none' && line));
  switch (action) {
    case 'bold': return {fontWeight: Number(style.fontWeight) >= 600 ? '400' : '700'};
    case 'italic': return {fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic'};
    case 'underline':
    case 'strike': {
      const line = action === 'strike' ? 'line-through' : 'underline';
      if (lines.has(line)) lines.delete(line); else lines.add(line);
      return {textDecorationLine:[...lines].join(' ') || 'none'};
    }
    case 'size-step': return {fontSize:`${Math.min(200,Math.max(8,size + Number(value)))}px`};
    case 'size': return {fontSize:`${Math.min(200,Math.max(8,Number(value) || size))}px`};
    case 'align': return {textAlign:value};
    case 'color': return {color:value};
    case 'background': return {backgroundColor:value};
    case 'preset': return value === 'body' ? {fontSize:'16px',fontWeight:'400',lineHeight:'1.6'}
      : {fontSize:({h1:32,h2:26,h3:21}[value] || 16)+'px',fontWeight:'700',lineHeight:'1.3'};
    case 'clear': return {...clearStyles,lineHeight:''};
    default: return {};
  }
}
